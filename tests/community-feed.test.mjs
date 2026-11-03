import test from 'node:test'
import assert from 'node:assert/strict'
import {syncCommunityFeed} from '../indiecorns/lib/community-feed.mjs'
import {prioritizeSlack} from '../indiecorns/lib/slack.mjs'
import {createHash} from 'node:crypto'

const snapshot={version:1,workspaceId:'TTEST',channelId:'CTEST',observedAt:1000,expiresAt:100000,
  memberIds:['UMEMBER'],identities:[{slackUserId:'UMEMBER',profileUrls:['https://peerlist.io/maker'],targets:[]}]}
const target=path=>({platform:'peerlist',eventType:'inspect',profileUrl:`https://peerlist.io/${path}`,
  sharedBySlackUserId:'UMEMBER',slackChannelId:'CTEST'})
const options={appUrl:'https://app.indiecorns.com',headers:{'x-indiecorns-cli-session':'member-session'}}

test('version metadata changes preserve feed cursors and cooldowns, including migration from legacy header hashes',async()=>{
  const oldHeaders={...options.headers,'x-indiecorns-cli-version':'0.4.10'}
  const state={jobs:{},communityFeed:{binding:createHash('sha256').update(JSON.stringify(['https://app.indiecorns.com/api/community/worker-feed',oldHeaders])).digest('hex'),cursor:'saved',oldest:'1.000000',nextPollAt:100000,snapshot}}
  await syncCommunityFeed({...options,state,headers:{...oldHeaders,'x-indiecorns-cli-version':'0.4.11'},headerAliases:[oldHeaders],now:()=>1000,request:()=>assert.fail('must honor cooldown')})
  assert.equal(state.communityFeed.cursor,'saved');assert.equal(state.communityFeed.nextPollAt,100000)
  await syncCommunityFeed({...options,state,headers:{...oldHeaders,'x-indiecorns-cli-version':'0.4.12'},now:()=>2000,request:()=>assert.fail('metadata must not reset auth')})
  assert.equal(state.communityFeed.cursor,'saved')
})

test('members without Slack credentials checkpoint feed targets, membership and cursors across restart',async()=>{
  let clock=1000,calls=0
  let state={jobs:{}}
  const checkpoints=[]
  const request=async(url,settings)=>{
    calls++
    assert.deepEqual(settings.headers,options.headers)
    assert.equal(settings.redirect,'error')
    assert.equal(url.origin,'https://app.indiecorns.com')
    if(calls===1)return Response.json({version:1,snapshot,targets:[target('maker/project/app')],cursor:'next',latest:'1000.000001'})
    assert.equal(url.searchParams.get('cursor'),'next')
    assert.equal(url.searchParams.get('oldest'),'0')
    return Response.json({version:1,snapshot,targets:[target('other/project/app')],cursor:'',latest:'999.000000'})
  }
  const sync=()=>syncCommunityFeed({...options,state,now:()=>clock,request,checkpoint:()=>checkpoints.push(structuredClone(state))})
  const first=await sync()
  prioritizeSlack(state,first,clock)
  assert.equal(Object.values(state.jobs)[0].priority,0)
  assert.equal(checkpoints.at(-1).communityFeed.cursor,'next')
  assert.equal(Object.keys(checkpoints.at(-1).jobs).length,1)
  state=JSON.parse(JSON.stringify(state))
  await sync()
  assert.equal(calls,1)
  clock=61001
  const second=await sync()
  prioritizeSlack(state,second,clock)
  assert.equal(Object.keys(state.jobs).length,2)
  assert.equal(Object.values(state.jobs).find(job=>job.target.profileUrl.includes('/other/')).priority,1)
  assert.equal(state.communityFeed.oldest,'1000.000001')
  assert.equal(state.communityFeed.cursor,'')
  assert.equal(state.communityFeed.health,'ok')
})

test('provider cooldown survives reload and expired membership withdraws priority without resetting receipts',async()=>{
  let state={jobs:{},actions:{external:{kind:'github_star',status:'completed'}}},clock=1000,calls=0
  const sync=()=>syncCommunityFeed({...options,state,now:()=>clock,request:async()=>{
    calls++
    return calls===1?Response.json({version:1,snapshot,targets:[target('maker')],cursor:'',latest:'1000.000001'}):
      new Response('',{status:429,headers:{'retry-after':'120'}})
  }})
  await sync()
  clock=301001
  await sync()
  assert.equal(state.communityFeed.nextPollAt,421001)
  assert.equal(state.communityFeed.health,'rate_limited')
  state=JSON.parse(JSON.stringify(state))
  prioritizeSlack(state,await sync(),clock)
  assert.equal(calls,2)
  assert.equal(Object.values(state.jobs)[0].priority,2)
  assert.equal(state.actions.external.status,'completed')
})

test('invalid feeds cannot inject targets, raw errors or advance a cursor',async()=>{
  const state={jobs:{}}
  await syncCommunityFeed({...options,state,now:()=>1000,request:async()=>Response.json({version:1,snapshot,
    targets:[target('uncommitted')],cursor:'next',latest:'invalid',secret:'never-persist-this'})})
  assert.equal(state.communityFeed.health,'invalid_feed')
  assert.equal(state.communityFeed.cursor,'')
  assert.equal(Object.keys(state.jobs).length,0)
  assert.doesNotMatch(JSON.stringify(state),/never-persist-this/)
  await assert.rejects(syncCommunityFeed({...options,state,endpoint:'https://other.example/feed'}),/origin/)
})

test('expired Slack cursors restart from the last completed watermark without losing queued targets',async()=>{
  const state={jobs:{}}
  let clock=1000,calls=0
  const fresh={...snapshot,expiresAt:1000000}
  const sync=()=>syncCommunityFeed({...options,state,now:()=>clock,request:async url=>{
    calls++
    if(calls===1)return Response.json({version:1,snapshot:fresh,targets:[target('maker')],cursor:'expired',latest:'1000.000001'})
    if(calls===2)return new Response('',{status:409})
    assert.equal(url.searchParams.has('cursor'),false)
    assert.equal(url.searchParams.get('oldest'),'0')
    return Response.json({version:1,snapshot:fresh,targets:[target('maker'),target('other')],cursor:'',latest:'999.000000'})
  }})
  await sync()
  clock=61001
  await sync()
  assert.equal(state.communityFeed.health,'cursor_reset')
  assert.equal(state.communityFeed.oldest,'0')
  assert.equal(Object.keys(state.jobs).length,1)
  clock=121002
  await sync()
  assert.equal(state.communityFeed.oldest,'1000.000001')
  assert.equal(state.communityFeed.health,'ok')
  assert.equal(Object.keys(state.jobs).length,2)
})

test('known revoked community authentication stops action eligibility immediately',async()=>{
  const state={jobs:{},lastError:null}
  await syncCommunityFeed({...options,state,now:()=>1000,request:async()=>new Response('',{status:401})})
  assert.equal(state.lastError,'auth_required')
  assert.equal(state.communityFeed.health,'auth_required')
})
