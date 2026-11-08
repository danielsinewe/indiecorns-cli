import test from 'node:test'
import assert from 'node:assert/strict'
import {observationFromSnapshot,readMemberActivity} from '../indiecorns/lib/browser-reader.mjs'
import {runBrowserDiscoveryOnce} from '../indiecorns/lib/browser-agent.mjs'
const now=1800000000000
const task={platform:'linkedin',profileUrl:'https://www.linkedin.com/in/juanzhang12/',checkUrl:'https://www.linkedin.com/in/juanzhang12/recent-activity/all/',leaseToken:'00000000-0000-4000-8000-000000000001',expiresAt:now+120000}
const own='https://www.linkedin.com/feed/update/urn:li:activity:7522911681006620672/'
const snapshot={url:task.checkUrl,cards:[{authorProfileUrl:task.profileUrl,links:[own]}]}
test('signed-in cards keep own posts and reject reposts, mentions and ambiguous quotes',()=>{
 const result=observationFromSnapshot(task,{...snapshot,cards:[...snapshot.cards,
  {authorProfileUrl:task.profileUrl,reposted:true,links:['https://www.linkedin.com/feed/update/urn:li:activity:123456789/']},
  {authorProfileUrl:'https://www.linkedin.com/in/another/',links:[own]},
  {authorProfileUrl:task.profileUrl,links:[own,'https://www.linkedin.com/feed/update/urn:li:activity:987654321/']}]},now)
 assert.equal(result.status,'observed');assert.equal(result.posts.length,1);assert.equal(result.posts[0].url,own)
 for(const patch of [{url:'https://www.linkedin.com/login',authRequired:true},{authRequired:true},{blocked:true},{cards:[]}]) {
  const observation=observationFromSnapshot(task,{...snapshot,...patch},now)
  assert.notEqual(observation.status,'observed');assert.equal(observation.posts.length,0)
 }
 assert.equal(observationFromSnapshot(task,{...snapshot,cards:[],emptyVisible:true},now).status,'observed')
})
test('reader closes its own tabs after success or failure and preserves supplied tabs',async()=>{
 let closed=0,opened=0
 const page={url:async()=>task.checkUrl,goto:async()=>{},ax:{get:async()=> 'Activity | Juan Zhang'},playwright:{evaluate:async()=>snapshot},close:async()=>{closed++}}
 const browser={tabs:{new:async()=>{opened++;return page}}}
 await readMemberActivity({browser,task,now:()=>now});assert.equal(closed,1)
 await readMemberActivity({browser,task,tab:page,now:()=>now});assert.equal(closed,1)
 page.playwright.evaluate=async()=>{throw new Error('Host browser unavailable')}
 await assert.rejects(readMemberActivity({browser,task}));assert.equal(closed,2)
 await assert.rejects(readMemberActivity({browser,task:{...task,checkUrl:'https://evil.test/'}}));assert.equal(opened,2)
})
test('active agent performs one lease/read/report cycle without recording continuous coverage',async()=>{
 const calls=[];let closed=0
 const browser={tabs:{new:async()=>({url:async()=>task.checkUrl,ax:{get:async()=> 'Activity'},playwright:{evaluate:async()=>snapshot},close:async()=>{closed++}})}}
 const result=await runBrowserDiscoveryOnce({browser,now:()=>now,execute:async(_connection,args,input)=>{
  calls.push({args,input});return args[0]==='claim'?{version:1,task}:{accepted:true,inserted:1}
 }})
 assert.equal(result.state,'observed');assert.equal(result.inserted,1);assert.equal(result.continuousSignedInCoverage,false)
 assert.equal(calls[1].input.posts[0].url,own);assert.equal(closed,1)
 assert.equal(calls[0].args[2],'browser')
})
