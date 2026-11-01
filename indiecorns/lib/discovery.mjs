import { setTimeout as sleep } from 'node:timers/promises'

export const discoverySources = [
  ...['peerlist', 'x', 'linkedin', 'producthunt'].map(platform => ({ platform, eventType: 'follow', targetSource: 'profiles' })),
  ...['x', 'linkedin'].flatMap(platform => ['like', 'reshare', 'comment'].map(eventType => ({ platform, eventType, targetSource: 'posts' }))),
  ...['upvote', 'rate'].map(eventType => ({ platform: 'peerlist', eventType, targetSource: 'projects' })),
  { platform: 'producthunt', eventType: 'upvote', targetSource: 'projects' },
]
export function retryDelay(value, now = Date.now()) {
  if (!value) return 60000
  const seconds = Number(value)
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now
  return Number.isFinite(delay) ? Math.max(1000, Math.min(delay, 86400000)) : 60000
}
export async function boundedText(response, limit = 2097152) {
  if (Number(response.headers.get('content-length')) > limit) throw new Error('Response too large')
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Missing response body')
  const chunks = []
  let total = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > limit) throw new Error('Response too large')
      chunks.push(value)
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
  return Buffer.concat(chunks).toString('utf8')
}
export async function discoverCommunity({ appUrl, endpoint, headers, signal, request = fetch,
  pause = (ms, signal) => sleep(ms, undefined, { signal }) }) {
  if (!headers) throw Object.assign(new Error('Authentication required'), { code: 'AUTH_REQUIRED' })
  const targets = []
  const sources = []
  for (const source of discoverySources) {
    if (sources.length) await pause(250, signal)
    const url = new URL(endpoint, appUrl)
    if (url.origin !== new URL(appUrl).origin) throw new Error('Invalid API origin')
    for (const [key, value] of Object.entries({ ...source, limit: '200' })) url.searchParams.set(key, value)
    const response = await request(url, { headers, redirect: 'error',
      signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(30000)]) })
    if ([401, 403].includes(response.status)) throw Object.assign(new Error('Authentication required'), { code: 'AUTH_REQUIRED' })
    if (response.status === 429 || response.status === 503) {
      const retryAfterMs = retryDelay(response.headers.get('retry-after'))
      await response.body?.cancel()
      return { targets, sources, retryAfterMs, partial: true }
    }
    if (!response.ok) {
      await response.body?.cancel()
      sources.push({ ...source, status: 'failed' })
      continue
    }
    const body = JSON.parse(await boundedText(response))
    if (!Array.isArray(body.targets)) throw new Error('Invalid discovery response')
    targets.push(...body.targets.map(target => ({ ...target, targetSource: source.targetSource })))
    // The current API exposes no cursor or total. A full page is therefore not
    // proof that discovery is complete; preserve its targets but report the gap.
    sources.push({ ...source, status: body.targets.length >= 200 ? 'capacity_limited' : 'ok', count: body.targets.length, atCapacity: body.targets.length >= 200 })
  }
  return { targets, sources, partial: sources.some(source => source.status !== 'ok') }
}
