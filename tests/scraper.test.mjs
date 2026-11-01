import test from 'node:test'
import assert from 'node:assert/strict'
import { extractPage, isPublicIPv4, publicUrl, scrapeTarget, memberCandidates } from '../indiecorns/lib/scraper.mjs'

test('scraper rejects private, special and credential-bearing network targets', () => {
  for (const address of ['127.0.0.1','10.1.2.3','172.31.1.1','192.168.0.1','169.254.169.254','100.64.0.1','198.18.0.1','0.0.0.0','224.1.1.1','::1']) assert.equal(isPublicIPv4(address),false,address)
  assert.equal(isPublicIPv4('8.8.8.8'),true)
  for (const url of ['http://example.com','https://user:pass@example.com','https://localhost','https://example.local','https://10.1.2.3','https://example.com:8443']) assert.throws(() => publicUrl(url))
})

test('extracts bounded metadata without executing scripts or treating external links as member content', () => {
  const html = '<html><head><title>Fallback</title><meta property="og:title" content="Maker &amp; project"><meta name="description" content="Useful project"></head><body><script>throw new Error("never execute")</script><a href="/maker/project/app">App</a><a href="https://other.example/project/app">Other</a><a href="javascript:alert(1)">Bad</a><a href="/other/project/app">Other member</a></body></html>'
  const page = extractPage(html,'https://peerlist.io/maker')
  assert.equal(page.title,'Maker & project')
  assert.equal(page.description,'Useful project')
  assert.equal(page.links.length,2)
  const candidates = memberCandidates({platform:'peerlist',username:'maker',profileUrl:'https://peerlist.io/maker'},page)
  assert.equal(candidates.length,1)
  assert.equal(candidates[0].targetType,'project')
  assert.equal(candidates[0].attribution,'unverified_link')
})

test('robots denial prevents a page request', async () => {
  const requests = []
  const result = await scrapeTarget({ target:{profileUrl:'https://example.com/maker'}, hosts:{}, now:()=>1000,
    request:async url => { requests.push(url.href); return {status:200,text:'User-agent: *\nDisallow: /',headers:{}} } })
  assert.equal(requests.length,1)
  assert.equal(result.status,'robots_denied')
})

test('robots crawl delay and host request limits survive separate scraper invocations', async () => {
  const hosts = {}
  let time = 1000
  const requests = []
  const options = { target:{profileUrl:'https://example.com/maker'}, hosts, now:()=>time,
    request:async url => {requests.push(url.href);return url.pathname === '/robots.txt'
      ? {status:200,text:'User-agent: *\nCrawl-delay: 60',headers:{}}
      : {status:200,text:'<title>Maker</title>',headers:{'content-type':'text/html'}}} }
  await assert.rejects(scrapeTarget(options), e => e.code === 'HOST_DELAY' && e.retryAt === 61000)
  assert.equal(requests.length,1)
  time=61000
  const result=await scrapeTarget(options)
  assert.equal(result.status,'observed')
  assert.equal(result.title,'Maker')
  assert.equal(requests.length,2)
  await assert.rejects(scrapeTarget(options), e => e.code === 'HOST_DELAY')
})

test('redirects and access errors remain observations, never fabricated engagement receipts', async () => {
  const hosts = {'https://example.com':{nextRequestAt:0,robots:{text:'',expiresAt:999999}}}
  const result = await scrapeTarget({target:{profileUrl:'https://example.com/maker'}, hosts, now:()=>1000,
    request:async () => ({status:302, headers:{location:'https://private.example'},text:''})})
  assert.equal(result.status,'redirect_requires_review')
  assert.equal('completed' in result,false)
})

test('robots rate limits delay the entire host and persist before returning', async () => {
  const hosts={}
  let checkpoints=0
  await assert.rejects(scrapeTarget({target:{profileUrl:'https://example.com/maker'},hosts,now:()=>1000,
    checkpoint:()=>checkpoints++,request:async()=>({status:429,headers:{'retry-after':'3600'},text:''})}), e=>e.code==='HOST_DELAY' && e.retryAt===3601000)
  assert.equal(hosts['https://example.com'].nextRequestAt,3601000)
  assert.equal(checkpoints,2)
})
