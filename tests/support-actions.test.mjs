import assert from 'node:assert/strict'
import test from 'node:test'
import { ingestSupportFeed } from '../indiecorns/lib/support-inbox.mjs'
import { defaultPolicy,validatePolicy } from '../indiecorns/lib/actions.mjs'
import { listBufferDestinations,runSupportShares,supportSharingStatus } from '../indiecorns/lib/support-actions.mjs'

const start=Date.UTC(2026,10,16,12), appUrl='https://app.indiecorns.com'
const rev = actor=>actor==='actorA'?'a'.repeat(64):'b'.repeat(64)
const targetUrl='https://peerlist.io/maker/project/launch'
const makeRequest = overrides=>({id:'f'.repeat(64),platform:'peerlist',targetUrl,source:'slack_launch_request',
  requesterSlackUserId:'UMAKER',requestedActions:['share'],createdAt:start-1000,expiresAt:start+86400000,
  status:'review_available',ownershipVerified:false,...overrides})
function fixture(actor='actorA', requested=[makeRequest()]) {
  let clock=start, permit=true, writeMode='scheduled', queries=[], writes=[], saved=[]
  const accountRevision=rev(actor), token=`fixture-${actor}`, accountId=`buffer-${actor}`, organizationId=`org-${actor}`,
    channelId=`channel-${actor}`, serviceId=`service-${actor}`
  const headers={'x-indiecorns-cli-session':actor,'x-indiecorns-cli-secret':token}
  const inboxContext={appUrl,headers,expectedActorId:actor}
  const channel={id:channelId,organizationId,serviceId,service:'linkedin',isDisconnected:false,isLocked:false,
    isQueuePaused:false,allowedActions:['scheduleUpdates'],name:'My LinkedIn'}
  const policy=validatePolicy({...defaultPolicy,maxExternalPerDay:2,supportSharing:{enabled:true,enabledAt:start-1000,provider:'buffer',
    accountRevision,accountId,organizationId,channelId,serviceId,platforms:['peerlist'],textTemplate:'From my Indiecorns community: {url}'}})
  let state={slackSource:'community_feed',communityFeed:{health:'ok'}}
  function sync(requests=requested) {
    const snapshot={version:1,workspaceId:'TTEST',channelId:'CTEST',memberIds:['UMAKER','UOTHER'],identities:[],observedAt:clock,expiresAt:clock+3600000}
    state.communityFeed.snapshot=snapshot
    state.supportInbox=ingestSupportFeed(state.supportInbox,{appUrl,headers,snapshot,expectedActorId:actor,now:clock,
      support:{version:1,actorId:actor,status:'ready',observedAt:clock,expiresAt:clock+300000,requests}})
  }
  sync()
  let currentAccount=accountId
  const request=async (address,options)=>{
    assert.equal(address,'https://api.buffer.com');assert.equal(options.method,'POST');assert.equal(options.redirect,'error')
    assert.equal(options.headers.Authorization,`Bearer ${token}`)
    const {query,variables}=JSON.parse(options.body)
    queries.push(query)
    if(query.includes('IndiecornsBufferAccount')) return Response.json({data:{account:{id:currentAccount,organizations:[{id:organizationId}]}}})
    if(query.includes('IndiecornsBufferChannels')) {
      assert.deepEqual(variables.input,{organizationId})
      return Response.json({data:{channels:[channel,{...channel,id:'paused',isQueuePaused:true},{...channel,id:'other',organizationId:'foreign'}]}})
    }
    if(query.includes('IndiecornsBufferChannel')) {
      assert.deepEqual(variables.input,{id:channelId})
      return Response.json({data:{channel}})
    }
    if(query.includes('IndiecornsBufferShare')) {
      assert.equal(permit,true)
      assert.equal(Object.values(saved.at(-1).supportShares).at(-1).status,'submitting')
      assert.deepEqual(variables.input,{text:`From my Indiecorns community: ${targetUrl}`,channelId,
        schedulingType:'automatic',mode:'shareNow'})
      writes.push(variables.input)
      if(writeMode==='lost_reply') throw new Error('simulated lost response')
      if(writeMode==='denied') return Response.json({data:{createPost:{__typename:'UnauthorizedError'}}})
      return Response.json({data:{createPost:{__typename:'PostActionSuccess',post:{id:`post-${actor}`,channelId}}}})
    }
    if(query.includes('IndiecornsBufferPost')) {
      assert.deepEqual(variables.input,{id:`post-${actor}`})
      if(writeMode==='lost_readback') return new Response('',{status:503,headers:{'retry-after':'900'}})
      return Response.json({data:{post:{id:`post-${actor}`,channelId,text:writes.at(-1).text,status:writeMode,
        sentAt:new Date(clock).toISOString(),dueAt:new Date(clock+300000).toISOString()}}})
    }
    assert.fail('unexpected Buffer API operation')
  }
  const options=overrides=>({state,policy,accountRevision,inboxContext,token,request,now:()=>clock,
    checkpoint:()=>saved.push(structuredClone(state)),authorize:()=>permit,...overrides})
  return {get state(){return state},policy,accountRevision,token,request,queries,writes,saved,channel,options,sync,
    policyStatus:includeReceipts=>supportSharingStatus(state,{accountRevision,policy,includeReceipts}),
    changeMode:mode=>{writeMode=mode},changeAccount:id=>{currentAccount=id},
    revoke:()=>{permit=false},advance:time=>{clock+=time},restart:()=>{state=structuredClone(saved.at(-1))}}
}

test('shares original opted-in copy in two distinct member destinations using Buffer readback', async()=>{
  const a=fixture('actorA'), b=fixture('actorB')
  for(const f of [a,b]) {
    assert.equal(f.policy.mode,'draft','support opt-in does not enable legacy actions')
    const available=await listBufferDestinations({token:f.token,request:f.request})
    assert.deepEqual(available,{accountId:f.policy.supportSharing.accountId,destinations:[{organizationId:f.channel.organizationId,
      channelId:f.channel.id,serviceId:f.channel.serviceId,service:'linkedin',name:'My LinkedIn'}]})
    await runSupportShares(f.options())
    assert.deepEqual(f.policyStatus(true).counts,{scheduled:1})
    assert.equal(f.state.actionBudget.attempts,1)
    assert.equal(f.writes.length,1)
    assert.doesNotMatch(JSON.stringify(f.saved.at(-1)),/From my Indiecorns|fixture-actor/)
    f.restart();f.advance(16*60000);f.sync();f.changeMode('sent')
    await runSupportShares(f.options())
    assert.deepEqual(f.policyStatus(true).counts,{sent:1})
    assert.equal(f.policyStatus(true).action,'share')
    assert.equal(f.policyStatus(true).receipts[0].action,'share')
    assert.equal(f.policyStatus(true).receipts[0].postId,`post-${f.channel.id.slice(8)}`)
    assert.equal(f.writes.length,1)
  }
  assert.deepEqual(supportSharingStatus(a.state,{accountRevision:b.accountRevision,policy:b.policy,includeReceipts:true}).receipts,[])
  assert.notDeepEqual(a.writes,b.writes)
})

test('off, wrong actor, private source, absent target and exhausted quota make no provider calls', async()=>{
  const f=fixture()
  assert.throws(()=>validatePolicy({...defaultPolicy,supportSharing:{...f.policy.supportSharing,textTemplate:'{url}'}}),/Invalid automatic support/)
  await runSupportShares(f.options({policy:defaultPolicy}))
  await runSupportShares(f.options({accountRevision:rev('actorB')}))
  await runSupportShares(f.options({inboxContext:{...f.options().inboxContext,expectedActorId:'actorB'}}))
  f.state.slackSource='local_slack'
  await runSupportShares(f.options())
  f.state.slackSource='community_feed'
  f.state.actionBudget={day:new Date(start).toISOString().slice(0,10),attempts:2}
  await runSupportShares(f.options())
  assert.equal(f.policyStatus().status,'daily_quota_reached')
  delete f.state.actionBudget
  f.state.supportInbox=undefined
  f.sync([makeRequest({status:'needs_link',targetUrl:undefined})])
  await runSupportShares(f.options())
  assert.equal(f.policyStatus().status,'needs_link')
  f.advance(300001)
  await runSupportShares(f.options())
  assert.equal(f.policyStatus().status,'community_sync_required')
  assert.deepEqual(f.queries,[])
})

test('checks provider identity and rechecks consent after provider reads',async()=>{
  const wrongActor=fixture()
  wrongActor.changeAccount('other')
  await runSupportShares(wrongActor.options())
  assert.equal(wrongActor.policyStatus().status,'buffer_account_mismatch')
  assert.equal(wrongActor.writes.length,0)
  const wrongChannel=fixture()
  wrongChannel.channel.serviceId='other-network-actor'
  await runSupportShares(wrongChannel.options())
  assert.equal(wrongChannel.policyStatus().status,'buffer_channel_unavailable')
  assert.equal(wrongChannel.writes.length,0)
  const revoked=fixture()
  const normal=revoked.request
  await runSupportShares(revoked.options({request:async (...args)=>{
    const result=await normal(...args)
    if(JSON.parse(args[1].body).query.includes('IndiecornsBufferChannel'))revoked.revoke()
    return result
  }}))
  assert.equal(revoked.policyStatus().status,'authorization_required')
  assert.equal(revoked.writes.length,0)
  assert.equal(revoked.state.actionBudget,undefined)
})

test('vote and feedback requests never call Buffer and removing share intent stops a pending post',async()=>{
  for (const requestedActions of [['upvote'],['feedback']]) {
    const f=fixture('actorA',[makeRequest({requestedActions})])
    await runSupportShares(f.options())
    assert.deepEqual(f.queries,[])
    assert.deepEqual(f.writes,[])
  }
  const edited=fixture()
  await runSupportShares(edited.options({request:async (...args)=>{
    const result=await edited.request(...args)
    if(JSON.parse(args[1].body).query.includes('IndiecornsBufferChannel')) {
      edited.sync([makeRequest({requestedActions:['upvote']})])
    }
    return result
  }}))
  assert.equal(edited.policyStatus().status,'authorization_required')
  assert.deepEqual(edited.writes,[])
  assert.equal(edited.state.actionBudget,undefined)
})

test('collect mode prevents provider calls and a later change to collect revokes a pending post',async()=>{
  const f=fixture()
  const collect={...f.policy,mode:'collect'}
  await runSupportShares(f.options({policy:collect}))
  assert.deepEqual(f.queries,[])
  const paused=supportSharingStatus(f.state,{accountRevision:f.accountRevision,policy:collect})
  assert.equal(paused.enabled,true)
  assert.equal(paused.status,'paused_by_collect_mode')

  let currentPolicy=f.policy
  await runSupportShares(f.options({
    authorize:()=>currentPolicy.mode!=='collect',
    request:async (...args)=>{
      const result=await f.request(...args)
      if(JSON.parse(args[1].body).query.includes('IndiecornsBufferChannel')) currentPolicy=collect
      return result
    },
  }))
  assert.equal(f.policyStatus().status,'authorization_required')
  assert.deepEqual(f.writes,[])
  assert.equal(f.state.actionBudget,undefined)
})

test('holds unknown submit outcome across restart and repeats only readback when post ID is known',async()=>{
  const lost=fixture()
  lost.changeMode('lost_reply')
  await runSupportShares(lost.options())
  assert.deepEqual(lost.policyStatus().counts,{uncertain:1})
  lost.restart();lost.advance(61*60000);lost.sync([makeRequest({id:'e'.repeat(64)})])
  await runSupportShares(lost.options())
  assert.equal(lost.writes.length,1,'different Slack message for same launch is not a new action')
  const pending=fixture()
  pending.changeMode('lost_readback')
  await runSupportShares(pending.options())
  assert.deepEqual(pending.policyStatus().counts,{uncertain:1})
  assert.ok(pending.policyStatus(true).receipts[0].postId)
  pending.restart();pending.advance(16*60000);pending.sync();pending.changeMode('error')
  await runSupportShares(pending.options())
  assert.deepEqual(pending.policyStatus().counts,{failed:1})
  assert.equal(pending.writes.length,1)
})

test('opt-in applies prospectively and new destinations do not reset the member cooldown',async()=>{
  const old=fixture('actorA',[makeRequest({createdAt:start-1001})])
  await runSupportShares(old.options())
  assert.deepEqual(old.queries,[])
  const f=fixture()
  await runSupportShares(f.options())
  assert.equal(f.writes.length,1,'request at opt-in time is eligible')
  f.advance(10*60000)
  f.sync([makeRequest({id:'e'.repeat(64),targetUrl:'https://peerlist.io/maker/project/next'})])
  const changed={...f.policy,supportSharing:{...f.policy.supportSharing,channelId:'new-channel'}}
  await runSupportShares(f.options({policy:changed}))
  assert.equal(f.policyStatus().status,'share_cooldown')
  assert.equal(f.writes.length,1)
})

test('explicit provider rejection remains failed and cannot become a sent receipt or retry',async()=>{
  const f=fixture()
  f.changeMode('denied')
  await runSupportShares(f.options())
  assert.deepEqual(f.policyStatus(true).counts,{failed:1})
  assert.equal(f.policyStatus().status,'buffer_permission_required')
  assert.equal(f.policyStatus(true).receipts[0].postId,undefined)
  f.restart();f.advance(61*60000);f.sync()
  f.changeMode('sent')
  await runSupportShares(f.options())
  assert.equal(f.writes.length,1)
  assert.deepEqual(f.policyStatus().counts,{failed:1})
})
