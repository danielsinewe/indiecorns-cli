import test from 'node:test'
import assert from 'node:assert/strict'
import {canonicalPost,validatePostObservation,nextDiscoveryDelay} from '../indiecorns/lib/post-discovery-contract.mjs'
import {extractMemberPosts,syncPostDiscovery} from '../indiecorns/lib/post-discovery.mjs'
const time=1800000000000
const task={leaseToken:'00000000-0000-4000-8000-000000000001',userId:'member',platform:'linkedin',profileUrl:'https://www.linkedin.com/in/juanzhang12/',checkUrl:'https://www.linkedin.com/in/juanzhang12/recent-activity/all/',expiresAt:time+120000}
const post={url:'https://www.linkedin.com/posts/juanzhang12_denker-activity-1234567890123456789-abc?utm_source=share',authorProfileUrl:task.profileUrl}
test('LinkedIn variants deduplicate and wrong authors and fake post URLs are rejected',()=>{
 const canonical='https://www.linkedin.com/feed/update/urn:li:activity:1234567890123456789/'
 assert.equal(canonicalPost('linkedin',post.url,'juanzhang12'),canonical)
 assert.equal(canonicalPost('linkedin','https://www.linkedin.com/feed/','juanzhang12'),null)
 assert.equal(canonicalPost('linkedin',post.url,'another'),null)
 const body={status:'observed',observedAt:time,posts:[post,{...post,url:canonical}]}
 assert.equal(validatePostObservation(task,body,time).posts.length,1)
 for(const invalid of [{...body,posts:[{...post,authorProfileUrl:'https://www.linkedin.com/in/another/'}]},
   {...body,status:'blocked'}, {...body,observedAt:time-700000}, {...body,posts:[{...post,url:'https://linkedin.com.evil.test/posts/fake'}]}])
   assert.throws(()=>validatePostObservation(task,invalid,time))
 assert.equal(canonicalPost('x','https://twitter.com/maker/status/123456789?ref=feed','maker'),'https://x.com/maker/status/123456789')
 assert.equal(canonicalPost('x','https://x.com/other/status/123456789','maker'),null)
})
test('profile activity hints and another author never become discovered posts',()=>{
 assert.equal(extractMemberPosts('<p>Juan posted in the past 30 days</p>',task,time).status,'unavailable')
 const result=extractMemberPosts(`<a href="${post.url}">Post</a><a href="/posts/another_thing-activity-999999999-xyz">Recommended</a>`,task,time)
 assert.equal(result.posts.length,1)
 assert.equal(result.status,'observed')
})
test('failed uploads survive restart and are retried before claiming more work',async()=>{
 const state={jobs:{}},calls=[]
 let uploads=0
 const request=async(_url,options)=>{
  const body=JSON.parse(options.body);calls.push(body.operation)
  if(body.operation==='claim')return Response.json({version:1,task})
  if(++uploads===1)return new Response('',{status:503})
  return Response.json({accepted:true})
 }
 const options={state,appUrl:'https://app.indiecorns.com',headers:{authorization:'test'},request,now:()=>time,
   observe:async()=>({status:'observed',observedAt:time,posts:[post]})}
 await syncPostDiscovery(options)
 assert.equal(state.postDiscovery.health,'unavailable')
 assert.equal(state.postDiscovery.pendingReport.posts.length,1)
 state.postDiscovery.nextPollAt=0
 // No second fetch or claim is needed just to deliver the outbox.
 await syncPostDiscovery({...options,request:async(url,options)=>{
  const body=JSON.parse(options.body);calls.push(body.operation)
  return Response.json(body.operation==='report'?{accepted:true}:{version:1,task:null})
 }})
 assert.deepEqual(calls,['claim','report','report','claim'])
 assert.equal(state.postDiscovery.pendingReport,undefined)
})
test('robots cooldown keeps lease, unauthenticated pages report an explicit requirement',async()=>{
 const state={},calls=[]
 const options={state,appUrl:'https://app.indiecorns.com',headers:{authorization:'test'},now:()=>time,
  request:async(_url,options)=>{const body=JSON.parse(options.body);calls.push(body);return Response.json(body.operation==='claim'?{version:1,task}:{accepted:true})}}
 await syncPostDiscovery({...options,observe:async()=>{throw Object.assign(new Error('wait'),{code:'HOST_DELAY',retryAt:time+10000})}})
 assert.equal(state.postDiscovery.task.leaseToken,task.leaseToken)
 assert.equal(state.postDiscovery.nextPollAt,time+10000)
 await syncPostDiscovery({...options,now:()=>time+10000,observe:async()=>({status:'auth_required',observedAt:time+10000,posts:[]})})
 assert.equal(calls.length,2)
 assert.equal(calls[1].status,'auth_required')
 assert.equal(state.postDiscovery.health,'auth_required')
})
test('backoff is adaptive and paid providers are unnecessary',()=>{
 assert.equal(nextDiscoveryDelay({status:'observed',newPosts:1}),300000)
 assert.equal(nextDiscoveryDelay({status:'observed',emptyChecks:100}),3600000)
 assert.equal(nextDiscoveryDelay({status:'blocked',failures:100}),21600000)
})

import {mkdtempSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {localPostReader,validateReaderConfig} from '../indiecorns/lib/post-discovery.mjs'
test('configured local reader receives only public task fields and returns author-bound observations',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'indiecorns-reader-'))
 try {
  const script=`let input='';for await(const chunk of process.stdin)input+=chunk;const task=JSON.parse(input);if('leaseToken' in task||'userId' in task)process.exit(1);console.log(JSON.stringify({status:'observed',observedAt:Date.now(),posts:[{url:'https://www.linkedin.com/posts/juanzhang12_denker-activity-1234567890123456789-abc',authorProfileUrl:task.profileUrl}]}))`
  writeFileSync(join(directory,'post-reader.json'),JSON.stringify({command:process.execPath,args:['--input-type=module','-e',script]}))
  const result=await localPostReader({directory,task})
  assert.equal(result.posts.length,1)
  assert.equal(result.posts[0].author,'juanzhang12')
  writeFileSync(join(directory,'post-reader.json'),JSON.stringify({command:process.execPath,args:['-e',"console.log('x'.repeat(40000))"]}))
  await assert.rejects(localPostReader({directory,task}))
  assert.throws(()=>validateReaderConfig({command:'untrusted-server-command',args:[]}))
 } finally {rmSync(directory,{recursive:true,force:true})}
})
