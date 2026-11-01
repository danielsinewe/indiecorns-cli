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
  assert.equal(slackSeedTargets(s,5000).length,2)
})

test('expired or removed channel membership withdraws priority without deleting queued work',()=>{
  const state={jobs:{sample:{target:{profileUrl:'https://peerlist.io/maker/project/app'},priority:1}}}
  prioritizeSlack(state,snapshot(),5000)
  assert.equal(state.jobs.sample.priority,0)
  prioritizeSlack(state,snapshot(),100001)
  assert.equal(state.jobs.sample.priority,2)
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
  let clock=1000
  const result=await refreshSlackEvidence({snapshot:snapshot(),token:'secret',now:()=>clock++,request:async(url,options)=>Response.json(
    url.endsWith('auth.test')?{ok:true,team_id:'TTEST'}:
    url.endsWith('conversations.members')?{ok:true,members:['UMEMBER','UBOT','UDELETED']}:
    {ok:true,user:{id:new URLSearchParams(options.body).get('user'),is_bot:options.body.includes('UBOT'),deleted:options.body.includes('UDELETED')}})})
  assert.deepEqual(result.memberIds,['UMEMBER'])
  assert.equal(result.expiresAt-result.observedAt,86400000)
})

import {sharedTargets,discoverSlackShared} from '../indiecorns/lib/slack.mjs'

test('channel discovery includes community links without claiming external ownership',()=>{
  const s=snapshot()
  const targets=sharedTargets([
    {user:'UMEMBER',ts:'1000.000001',text:'My project <https://peerlist.io/maker/project/app|app> and https://github.com/maker/project'},
    {user:'UNONMEMBER',ts:'1000.000002',text:'https://other.example/'},
    {user:'UMEMBER',ts:'1000.000003',text:'<mailto:person@example.com> <https://user:secret@example.com/private>'},
  ],s,5000)
  assert.equal(targets.length,3)
  assert.equal(targets[0].attribution,'shared_link_owner_unverified')
  assert.ok(targets.every(target=>!target.slackMember))
  assert.equal(targets[1].platform,'github')
  assert.equal('text' in targets[0],false)
  const state={jobs:{shared:{target:targets[1]},other:{target:{profileUrl:'https://example.com/other'}}}}
  prioritizeSlack(state,s,5000)
  assert.equal(state.jobs.shared.priority,1)
  assert.equal(state.jobs.shared.target.slackMember,false)
  assert.equal(state.jobs.other.priority,2)
})

test('Slack history preserves precise timestamps and opaque pagination cursors',async()=>{
  const result=await discoverSlackShared({snapshot:snapshot(),token:'secret',oldest:'999.000000',cursor:'opaque',now:5000,
    request:async(url,options)=>{
      assert.equal(url,'https://slack.com/api/conversations.history')
      const form=new URLSearchParams(options.body)
      assert.equal(form.get('channel'),'CTEST')
      assert.equal(form.get('cursor'),'opaque')
      assert.equal(form.get('oldest'),'999.000000')
      return Response.json({ok:true,messages:[{user:'UMEMBER',ts:'1000.000001',text:'https://example.com/project'}],response_metadata:{next_cursor:'next'}})
    }})
  assert.equal(result.cursor,'next')
  assert.equal(result.latest,'1000.000001')
  assert.equal(result.targets.length,1)
  await assert.rejects(discoverSlackShared({snapshot:snapshot(),token:'secret',now:5000,
    request:async()=>new Response(null,{status:429,headers:{'retry-after':'180'}})}),e=>e.retryAfterMs===180000)
})


test('community app notifications are discovered without promoting bots as human members',()=>{
  const targets=sharedTargets([{bot_id:'BBOT',ts:'1000.000001',text:'',attachments:[{title_link:'https://github.com/maker/project',image_url:'https://example.com/private-video.mp4'}]}],snapshot(),5000)
  assert.equal(targets.length,1)
  assert.equal(targets[0].platform,'github')
  const state={jobs:{sample:{target:targets[0]}}}
  prioritizeSlack(state,snapshot(),5000)
  assert.equal(state.jobs.sample.priority,2)
  assert.equal(state.jobs.sample.target.slackMember,false)
})
