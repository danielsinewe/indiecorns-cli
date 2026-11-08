import test from 'node:test'
import assert from 'node:assert/strict'
import { discoverCommunity, boundedText, retryDelay, discoverySourceKey, discoverySources } from '../indiecorns/lib/discovery.mjs'
import {runWorker,workerStatus} from '../indiecorns/lib/worker.mjs'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {safeDiscoveryError} from '../indiecorns/lib/discovery-errors.mjs'

test('discovery explicitly queries profiles, projects, posts and all four platforms', async () => {
  const queries = []
  const result = await discoverCommunity({ appUrl: 'https://app.indiecorns.com', endpoint: '/targets', headers: {Authorization: 'Bearer test'}, pause: async () => {}, request: async (url, options) => {
    queries.push(Object.fromEntries(url.searchParams))
    assert.equal(options.redirect, 'error')
    return Response.json({ targets: [{profileUrl: 'https://peerlist.io/maker'}] })
  } })
  assert.equal(queries.length, 15)
  assert.deepEqual(new Set(queries.map(q => q.platform)), new Set(['x','linkedin','peerlist','producthunt']))
  assert.deepEqual(new Set(queries.map(q => q.targetSource)), new Set(['profiles','posts','projects']))
  assert.equal(result.targets.length, 15)
  assert.equal(result.partial, false)
  assert.deepEqual(queries.filter(q=>q.eventType==='inspect').map(q=>[q.platform,q.targetSource]),[['x','posts'],['linkedin','posts']])
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

test('a full API page remains useful but cannot claim complete discovery without pagination metadata',async()=>{
  let calls=0
  const result=await discoverCommunity({appUrl:'https://app.indiecorns.com',endpoint:'/targets',headers:{},pause:async()=>{},
    request:async()=>Response.json({targets:Array.from({length:++calls===1?200:1},(_,index)=>({profileUrl:`https://peerlist.io/maker${index}`}))})})
  assert.equal(calls,15)
  assert.equal(result.targets.length,214)
  assert.equal(result.partial,true)
  assert.equal(result.sources[0].status,'capacity_limited')
  assert.equal(result.sources[0].atCapacity,true)
  assert.equal(result.sources[1].status,'ok')
})

test('page budgets continue from durable progress and skip already-complete sources',async()=>{
  const calls=[]
  const options={appUrl:'https://app.indiecorns.com',endpoint:'/targets',headers:{},pause:async()=>{},request:async url=>{
    calls.push(url)
    const source=Object.fromEntries(url.searchParams)
    if(discoverySourceKey(source)!==discoverySourceKey(discoverySources[0])) return Response.json({targets:[],pagination:{hasMore:false,nextCursor:null}})
    const offset=Number(url.searchParams.get('cursor')??0)
    const count=Math.min(200,401-offset)
    return Response.json({targets:Array.from({length:count},(_,i)=>({profileUrl:`https://peerlist.io/maker${offset+i}`})),
      pagination:{hasMore:offset+count<401,nextCursor:offset+count<401?String(offset+count):null}})
  }}
  const first=await discoverCommunity(options)
  assert.equal(first.targets.length,400)
  assert.equal(first.partial,true)
  assert.equal(first.continuation,true)
  assert.equal(calls.length,16)
  assert.equal(first.progress[discoverySourceKey(discoverySources[0])].cursor,'400')
  calls.length=0
  const next=await discoverCommunity({...options,progress:first.progress})
  assert.equal(next.targets.length,1)
  assert.equal(calls.length,1)
  assert.equal(calls[0].searchParams.get('cursor'),'400')
  assert.equal(next.partial,false)
  assert.deepEqual(next.progress,{})
})

test('a crash between pages cannot advance the cursor past uncommitted targets',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'indiecorns-discovery-pages-'))
  let clock=1000,fail=true
  const key=discoverySourceKey(discoverySources[0]),offsets=[]
  const request=async url=>{
    if(discoverySourceKey(Object.fromEntries(url.searchParams))!==key)return Response.json({targets:[],pagination:{hasMore:false,nextCursor:null}})
    const cursor=url.searchParams.get('cursor')
    offsets.push(cursor)
    if(cursor==='200'){
      const checkpoint=workerStatus(directory).state
      assert.equal(Object.keys(checkpoint.jobs).length,200)
      assert.equal(checkpoint.discovery[key].cursor,'200')
      if(fail){fail=false;throw new Error('simulated connection failure')}
      return Response.json({targets:[{platform:'peerlist',eventType:'follow',profileUrl:'https://peerlist.io/last'}],pagination:{hasMore:false,nextCursor:null}})
    }
    return Response.json({targets:Array.from({length:200},(_,i)=>({platform:'peerlist',eventType:'follow',profileUrl:`https://peerlist.io/maker${i}`})),pagination:{hasMore:true,nextCursor:'200'}})
  }
  const options={directory,once:true,intervalMs:1000,now:()=>clock,
    discover:(signal,progress,onPage)=>discoverCommunity({appUrl:'https://app.indiecorns.com',endpoint:'/targets',headers:{},signal,progress,onPage,request,pause:async()=>{}})}
  try {
    const first=await runWorker(options)
    assert.equal(first.lastError,'discovery_failed')
    assert.equal(Object.keys(first.jobs).length,200)
    clock=4000
    const next=await runWorker(options)
    assert.equal(next.lastError,null)
    assert.equal(Object.keys(next.jobs).length,201)
    assert.deepEqual(offsets,[null,'200','200'])
    assert.deepEqual(next.discovery,{})
  }finally{rmSync(directory,{recursive:true})}
})

test('repeated cursors and invalid page metadata cannot masquerade as completed discovery',async()=>{
  for(const pagination of [{hasMore:true,nextCursor:'again'},{hasMore:false,nextCursor:'unexpected'}]){
    const result=await discoverCommunity({appUrl:'https://app.indiecorns.com',endpoint:'/targets',headers:{},pause:async()=>{},
      request:async()=>Response.json({targets:[{profileUrl:'https://peerlist.io/maker'}],pagination})})
    assert.equal(result.partial,true)
    assert.equal(result.continuation,false)
    assert.ok(result.sources.every(source=>['repeated_cursor','invalid_pagination'].includes(source.status)))
  }
})

test('transport, DNS, timeout and malformed-body diagnostics retain no messages, URLs or secrets',async()=>{
  for(const [request,expected]of [
    [async()=>{throw Object.assign(new TypeError('Bearer secret-token https://private.example'),{cause:{code:'ENOTFOUND'}})}, {kind:'transport',stage:'request',code:'ENOTFOUND'}],
    [async()=>{throw Object.assign(new TypeError('secret-token'),{cause:{errors:[{code:'ENETUNREACH'}]}})}, {kind:'transport',stage:'request',code:'ENETUNREACH'}],
    [async()=>{throw new DOMException('secret-token','TimeoutError')}, {kind:'timeout',stage:'request'}],
    [async()=>new Response('<html>secret-token</html>'), {kind:'invalid_response',stage:'body'}],
  ]) {
    try{await discoverCommunity({appUrl:'https://app.indiecorns.com',endpoint:'/targets',headers:{},request,pause:async()=>{}});assert.fail('must fail')}
    catch(error){assert.deepEqual(safeDiscoveryError(error),{...expected,source:'peerlist/follow/profiles'});assert.doesNotMatch(JSON.stringify(safeDiscoveryError(error)),/secret-token|private.example/)}
  }
  assert.deepEqual(safeDiscoveryError({discoveryError:{kind:'bad',stage:'secret',token:'secret-token'}}),{kind:'unknown',stage:'request'})
})

test('a single bounded GET retry recovers a transient connection failure and reports the retry',async()=>{
  let calls=0;const pauses=[]
  const result=await discoverCommunity({appUrl:'https://app.indiecorns.com',endpoint:'/targets',headers:{},pause:async ms=>pauses.push(ms),
    request:async()=>{calls++;if(calls===1)throw Object.assign(new TypeError('private-message'),{cause:{code:'ECONNRESET'}});return Response.json({targets:[]})}})
  assert.equal(calls,16);assert.equal(result.partial,false);assert.equal(result.sources[0].transportRetries,1);assert.equal(pauses[0],1000)
  assert.doesNotMatch(JSON.stringify(result),/private-message/)
})

test('certificate failures are classified without an immediate retry',async()=>{
  for(const code of ['CERT_HAS_EXPIRED','DEPTH_ZERO_SELF_SIGNED_CERT','ERR_TLS_CERT_ALTNAME_INVALID']) {
    let calls=0
    await assert.rejects(discoverCommunity({appUrl:'https://app.indiecorns.com',endpoint:'/targets',headers:{},pause:async()=>assert.fail('must not retry'),
      request:async()=>{calls++;throw Object.assign(new TypeError('secret'),{cause:{code}})}}))
    assert.equal(calls,1)
  }
})

test('auth denial retains safe exact status and source while cancelling response',async()=>{
 let cancelled=false
 await assert.rejects(discoverCommunity({appUrl:'https://app.indiecorns.com',endpoint:'/api/community/action-targets',headers:{Authorization:'Bearer private'},
  request:async()=>new Response(new ReadableStream({cancel(){cancelled=true}}),{status:403})}),error=>{
   assert.deepEqual(safeDiscoveryError(error),{kind:'authentication',stage:'request',source:'peerlist/follow/profiles',httpStatus:403})
   return true
  })
 assert.equal(cancelled,true)
})
