import test from 'node:test'
import assert from 'node:assert/strict'
import {validateSlackEvidence,slackMembership,slackSeedTargets,prioritizeSlack,refreshSlackEvidence} from '../indiecorns/lib/slack.mjs'
const snapshot=()=>({version:1,workspaceId:'TTEST',channelId:'CTEST',memberIds:['UMEMBER'],observedAt:1000,expiresAt:100000,
  identities:[{slackUserId:'UMEMBER',profileUrls:['https://peerlist.io/maker'],targets:[{platform:'peerlist',eventType:'inspect',profileUrl:'https://peerlist.io/maker/project/app'}]}]})

test('priority requires fresh membership and exact profile boundaries; names are never fuzzy matched',()=>{
  const s=validateSlackEvidence(snapshot())
  assert.ok(slackMembership(s,{profileUrl:'https://peerlist.io/maker/project/app'},5000))
  assert.equal(slackMembership(s,{profileUrl:'https://peerlist.io/maker2/project/app'},5000),null)
  assert.equal(slackMembership(s,{profileUrl:'https://other.example/maker/project/app'},5000),null)
  assert.equal(slackMembership(s,{profileUrl:'https://peerlist.io/maker'},100001),null)
  assert.equal(slackMembership({...s,memberIds:[]},{profileUrl:'https://peerlist.io/maker'},5000),null)
  assert.equal(slackSeedTargets(s,5000).length,1)
})

test('expired or removed channel membership withdraws priority without deleting queued work',()=>{
  const state={jobs:{sample:{target:{profileUrl:'https://peerlist.io/maker/project/app'},priority:1}}}
  prioritizeSlack(state,snapshot(),5000)
  assert.equal(state.jobs.sample.priority,0)
  prioritizeSlack(state,snapshot(),100001)
  assert.equal(state.jobs.sample.priority,1)
  assert.equal(state.slackHealth,'evidence_expired')
  assert.equal(Object.keys(state.jobs).length,1)
})

test('Slack refresh verifies workspace and follows all membership pages before replacing evidence',async()=>{
  const calls=[]
  const result=await refreshSlackEvidence({snapshot:snapshot(),token:'secret',now:()=>10000,request:async(url,options)=>{
    calls.push({url,body:options.body})
    assert.equal(options.redirect,'error')
    assert.equal(url.includes('secret'),false)
    return Response.json(url.endsWith('users.info')?{ok:true,user:{id:new URLSearchParams(options.body).get('user'),is_bot:false,deleted:false}}:url.endsWith('auth.test')?{ok:true,team_id:'TTEST'}:
      calls.length===2?{ok:true,members:['UMEMBER'],response_metadata:{next_cursor:'next'}}:
      {ok:true,members:['UOTHER'],response_metadata:{next_cursor:''}})
  }})
  assert.deepEqual(result.memberIds,['UMEMBER','UOTHER'])
  assert.equal(calls.length,5)
  assert.match(calls[2].body,/cursor=next/)
  assert.equal(result.expiresAt,86410000)
})

test('wrong workspace, rate limits and repeated cursors do not forge a fresh roster',async()=>{
  await assert.rejects(refreshSlackEvidence({snapshot:snapshot(),token:'secret',request:async()=>Response.json({ok:true,team_id:'TOTHER'})}),/mismatch/)
  await assert.rejects(refreshSlackEvidence({snapshot:snapshot(),token:'secret',request:async()=>new Response('',{status:429,headers:{'retry-after':'120'}})}),e=>e.retryAfterMs===120000)
  await assert.rejects(refreshSlackEvidence({snapshot:snapshot(),token:'secret',request:async url=>Response.json(url.endsWith('auth.test')?{ok:true,team_id:'TTEST'}:{ok:true,members:['UMEMBER'],response_metadata:{next_cursor:'same'}})}),/Repeated/)
})

test('Slack bots and deleted accounts are excluded from membership priority',async()=>{
  const result=await refreshSlackEvidence({snapshot:snapshot(),token:'secret',request:async(url,options)=>Response.json(
    url.endsWith('auth.test')?{ok:true,team_id:'TTEST'}:
    url.endsWith('conversations.members')?{ok:true,members:['UMEMBER','UBOT','UDELETED']}:
    {ok:true,user:{id:new URLSearchParams(options.body).get('user'),is_bot:options.body.includes('UBOT'),deleted:options.body.includes('UDELETED')}})})
  assert.deepEqual(result.memberIds,['UMEMBER'])
})
