import test from 'node:test'
import assert from 'node:assert/strict'
import { discoverCommunity, boundedText, retryDelay } from '../indiecorns/lib/discovery.mjs'

test('discovery explicitly queries profiles, projects, posts and all four platforms', async () => {
  const queries = []
  const result = await discoverCommunity({ appUrl: 'https://app.indiecorns.com', endpoint: '/targets', headers: {Authorization: 'Bearer test'}, pause: async () => {}, request: async (url, options) => {
    queries.push(Object.fromEntries(url.searchParams))
    assert.equal(options.redirect, 'error')
    return Response.json({ targets: [{profileUrl: 'https://peerlist.io/maker'}] })
  } })
  assert.equal(queries.length, 13)
  assert.deepEqual(new Set(queries.map(q => q.platform)), new Set(['x','linkedin','peerlist','producthunt']))
  assert.deepEqual(new Set(queries.map(q => q.targetSource)), new Set(['profiles','posts','projects']))
  assert.equal(result.targets.length, 13)
  assert.equal(result.partial, false)
})

test('rate limit preserves collected targets and stops remaining API requests', async () => {
  let requests = 0
  const result = await discoverCommunity({ appUrl: 'https://app.indiecorns.com', endpoint: '/targets', headers: {}, pause: async () => {}, request: async () => ++requests === 1
    ? Response.json({ targets: [{profileUrl: 'https://peerlist.io/maker'}] })
    : new Response('', {status: 429, headers: {'retry-after':'120'}}) })
  assert.equal(requests, 2)
  assert.equal(result.targets.length, 1)
  assert.equal(result.retryAfterMs, 120000)
  assert.equal(result.partial, true)
})

test('API redirects, malformed bodies and oversized responses do not become empty success', async () => {
  await assert.rejects(boundedText(new Response('x'.repeat(100)), 10), /large/)
  await assert.rejects(discoverCommunity({ appUrl:'https://app.indiecorns.com', endpoint:'https://evil.example/targets', headers:{} }), /origin/)
  await assert.rejects(discoverCommunity({ appUrl:'https://app.indiecorns.com', endpoint:'/targets', headers:{}, request:async () => Response.json({}) }), /response/)
  assert.equal(retryDelay(new Date(200000).toUTCString(), 100000), 100000)
})
