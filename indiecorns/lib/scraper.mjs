import { lookup } from 'node:dns/promises'
import { request as httpsRequest } from 'node:https'
import { isIP } from 'node:net'
import { parse } from 'parse5'
import robotsParser from 'robots-parser'
import { createHash } from 'node:crypto'
import { gunzipSync, inflateSync, brotliDecompressSync } from 'node:zlib'

const agent = 'IndiecornsBot/0.1 (+https://indiecorns.com)'
export const isPublicIPv4 = address => {
  if (isIP(address) !== 4) return false
  const [a,b,c] = address.split('.').map(Number)
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99) || (b === 0 && c === 2))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113))
}
export function publicUrl(value) {
  if (String(value).length > 2048) throw new Error('URL too long')
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.port || url.username || url.password ||
    url.hostname === 'localhost' || url.hostname.endsWith('.local') ||
    (isIP(url.hostname) && !isPublicIPv4(url.hostname))) throw new Error('Unsupported public URL')
  url.hash = ''
  return url
}
// Pin the connection to the validated DNS result, preventing DNS rebinding.
// No cookies, API credentials, JavaScript execution or implicit redirects.
export function decodeText(bytes, encoding, limit) {
  const decoders={gzip:gunzipSync,deflate:inflateSync,br:brotliDecompressSync}
  const token=String(encoding ?? 'identity').toLowerCase()
  const decoded=token==='identity'?bytes:Object.hasOwn(decoders,token)?decoders[token](bytes,{maxOutputLength:limit}):null
  if (!decoded || decoded.length>limit) throw new Error('Unsupported or oversized page encoding')
  return decoded.toString('utf8')
}
export async function publicPage(value, { signal, limit = 1048576 } = {}) {
  const url = publicUrl(value)
  const addresses = await lookup(url.hostname, { all: true, family: 4 })
  if (!addresses.length || addresses.some(({address}) => !isPublicIPv4(address))) throw new Error('Non-public address')
  return new Promise((resolve, reject) => {
    const request = httpsRequest(url, {
      agent: false,
      signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(15000)]),
      headers: {'user-agent': agent, accept: 'text/html,text/plain;q=0.9', 'accept-encoding':'identity'},
      lookup: (_hostname, options, callback) => options.all
        ? callback(null, [{ address: addresses[0].address, family: 4 }])
        : callback(null, addresses[0].address, 4),
    }, response => {
      response.on('error', reject)
      // Inspect headers before consuming a body: media and files are never fetched
      // into the page parser, even when a channel includes those links.
      const contentType=String(response.headers['content-type'] ?? '')
      if (response.statusCode!==200 || !/^(text\/html|text\/plain|application\/xhtml\+xml)(?:;|$)/i.test(contentType)) {
        resolve({status:response.statusCode,headers:response.headers,text:'',bodyRejected:response.statusCode===200})
        response.destroy()
        return
      }
      if(Number(response.headers['content-length'])>limit) { response.destroy();reject(new Error('Response too large'));return }
      const chunks = []
      let length = 0
      response.on('data', chunk => {
        length += chunk.length
        if (length > limit) { response.destroy(new Error('Response too large')); return }
        chunks.push(chunk)
      })
      response.on('end', () => {
        try { resolve({status:response.statusCode,headers:response.headers,text:decodeText(Buffer.concat(chunks),response.headers['content-encoding'],limit)}) }
        catch(error){reject(error)}
      })
    })
    request.on('error', reject)
    request.end()
  })
}
const compact = (value, length) => String(value ?? '').replace(/\s+/g,' ').trim().slice(0,length)
export function extractPage(html, sourceUrl) {
  const root = parse(html)
  const metadata = {}
  let title = ''
  const links = new Set()
  const text = node => node.nodeName === '#text' ? node.value : (node.childNodes ?? []).map(text).join(' ')
  const nodes = [root]
  while (nodes.length) {
    const node = nodes.pop()
    const attrs = Object.fromEntries((node.attrs ?? []).map(attr => [attr.name, attr.value]))
    if (node.tagName === 'title') title = compact(text(node), 300)
    if (node.tagName === 'meta') {
      const key = (attrs.property ?? attrs.name ?? '').toLowerCase()
      if (['description','og:title','og:description','og:type'].includes(key)) metadata[key] = compact(attrs.content, 1000)
    }
    if (node.tagName === 'a' && attrs.href && links.size < 20) {
      try {
        const url = publicUrl(new URL(attrs.href, sourceUrl))
        if (url.origin === new URL(sourceUrl).origin) links.add(url.href)
      } catch {}
    }
    nodes.push(...(node.childNodes ?? []))
  }
  return { title: metadata['og:title'] ?? title, description: metadata['og:description'] ?? metadata.description ?? '',
    type: metadata['og:type'] ?? null, links: [...links].sort(), contentHash: createHash('sha256').update(html).digest('hex') }
}
export function memberCandidates(target, observation) {
  const username = target.username
  if (!username) return []
  return observation.links.flatMap(link => {
    const url = new URL(link)
    const path = url.pathname
    if (!path.startsWith(`/${username}/`)) return []
    const type = path.includes('/project/') ? 'project' : /\/(post|status)\//.test(path) ? 'post' : null
    return type ? [{ platform: target.platform, eventType: 'inspect', targetType: type,
      username, userId: target.userId, profileUrl: link,
      source: 'member_page_link', discoveredFrom: target.profileUrl,
      // A parent link establishes discovery provenance, not verified authorship.
      attribution: 'unverified_link' }] : []
  })
}
export async function scrapeTarget({ target, hosts, signal, now = Date.now, request = publicPage, checkpoint = () => {} }) {
  const url = publicUrl(target.profileUrl ?? target.targetUrl)
  const host = hosts[url.origin] ??= {nextRequestAt: 0}
  const reserve = () => {
    if (host.nextRequestAt > now()) throw Object.assign(new Error('Host cooldown'), {code:'HOST_DELAY', retryAt:host.nextRequestAt})
    host.lastRequestedAt = now()
    host.nextRequestAt = now() + Math.max(10000, host.crawlDelayMs ?? 0)
    checkpoint()
  }
  const honorRateLimit = response => {
    if (response.status === 429 || response.status === 503) {
      const retry = response.headers['retry-after']
      const seconds = Number(retry)
      const wait = retry ? (Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retry) - now()) : 60000
      host.nextRequestAt = now() + Math.max(60000, Number.isFinite(wait) ? Math.min(wait,86400000) : 60000)
      checkpoint()
      throw Object.assign(new Error('Host rate limited'), {code:'HOST_DELAY', retryAt:host.nextRequestAt})
    }
  }
  if (!host.robots || host.robots.expiresAt <= now()) {
    reserve()
    const response = await request(new URL('/robots.txt', url), {signal, limit:131072})
    honorRateLimit(response)
    if(response.bodyRejected) throw new Error('Robots content unavailable')
    if (response.status !== 200 && response.status !== 404) throw new Error('Robots unavailable')
    host.robots = {text:response.status === 404 ? '' : response.text, expiresAt:now() + 86400000}
    checkpoint()
  }
  const rules = robotsParser(new URL('/robots.txt', url).href, host.robots.text)
  const delay = Number(rules.getCrawlDelay(agent)) * 1000
  host.crawlDelayMs = Number.isFinite(delay) ? Math.max(10000, delay) : 10000
  if (Number.isFinite(host.lastRequestedAt)) host.nextRequestAt = Math.max(host.nextRequestAt, host.lastRequestedAt + host.crawlDelayMs)
  if (rules.isAllowed(url.href, agent) !== true) return {status:'robots_denied', url:url.href}
  reserve()
  const response = await request(url, {signal})
  honorRateLimit(response)
  if (response.status !== 200) return {status: response.status >= 300 && response.status < 400 ? 'redirect_requires_review' : 'http_unavailable', httpStatus:response.status, url:url.href}
  if (response.bodyRejected || !String(response.headers['content-type']).includes('text/html')) return {status:'unsupported_content', url:url.href}
  return {status:'observed', url:url.href, observedAt:now(), ...extractPage(response.text,url.href)}
}
