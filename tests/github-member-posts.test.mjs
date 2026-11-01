import test from 'node:test'
import assert from 'node:assert/strict'
import {syncGithubMemberPosts,githubAuthoredMembership} from '../indiecorns/lib/github-member-posts.mjs'
import {prioritizeSlack} from '../indiecorns/lib/slack.mjs'

const NOW=Date.parse('2026-11-01T12:00:00Z')
const snapshot=()=>({version:1,workspaceId:'TTEST',channelId:'CTEST',memberIds:['UMEMBER'],observedAt:NOW-1,expiresAt:NOW+86400000,
  identities:[{slackUserId:'UMEMBER',profileUrls:['https://github.com/maker'],targets:[]}]})
const post=(number=12)=>({number,html_url:`https://github.com/vendor/project/issues/${number}`,repository_url:'https://api.github.com/repos/vendor/project',
  user:{id:7,login:'maker'},updated_at:'2026-10-30T10:00:00Z',body:'not persisted'})
function fixture({items=[post()],total=items.length,incomplete=false,wrongIdentity=false}={}) {
  const requests=[]
  return {requests,request:async(address,options)=>{
    const u=new URL(address);requests.push(u)
    assert.equal(options.method,'GET');assert.equal(options.redirect,'error')
    if(u.pathname==='/users/maker')return Response.json({id:wrongIdentity?8:7,login:'maker',type:'User',email:'never persist'})
    assert.equal(u.pathname,'/search/issues')
    assert.match(u.searchParams.get('q'),/^author:maker is:issue is:public updated:>=2026-10-02$/)
    return Response.json({items,total_count:total,incomplete_results:incomplete})
  }}
}

test('member-authored public posts are discovered outside owned repositories with numeric author proof',async()=>{
  const state={jobs:{},actions:{receipt:{status:'completed'}},actionBudget:{day:'2026-11-01',attempts:1}},api=fixture()
  let checkpoints=0
  await syncGithubMemberPosts({state,snapshot:snapshot(),token:'secret',now:()=>NOW,request:api.request,checkpoint:()=>{checkpoints++}})
  assert.equal(api.requests.length,2)
  assert.ok(checkpoints>=3)
  const job=Object.values(state.jobs)[0]
  assert.equal(job.target.profileUrl,post().html_url)
  prioritizeSlack(state,snapshot(),NOW)
  assert.equal(job.priority,0)
  assert.equal(job.priorityReason,'verified_slack_author')
  assert.equal(job.slackEvidence.githubAuthorId,7)
  assert.doesNotMatch(JSON.stringify(state),/not persisted|never persist|secret/)
  assert.deepEqual(state.actionBudget,{day:'2026-11-01',attempts:1})
  assert.equal(state.actions.receipt.status,'completed')
})

test('wrong actors, private/PR-shaped results and invalid metadata cannot forge membership priority',async()=>{
  for(const invalid of [{...post(),user:{id:8}},{...post(),pull_request:{}},{...post(),repository:{private:true}},{...post(),html_url:'https://other.example/issue'},
    {...post(),repository_url:'https://api.github.com/repos/other/project'},{...post(),updated_at:'2020-01-01T00:00:00Z'}]){
    const state={jobs:{}},api=fixture({items:[invalid]})
    await syncGithubMemberPosts({state,snapshot:snapshot(),token:'secret',now:()=>NOW,request:api.request})
    assert.equal(Object.keys(state.jobs).length,0)
    assert.equal(Object.keys(state.githubMemberPosts.proofs).length,0)
    assert.equal(state.githubMemberPosts.health,'partial')
  }
  const forged={jobs:{post:{target:{platform:'github',eventType:'inspect',profileUrl:post().html_url,username:'maker',githubAuthorId:7}}}}
  prioritizeSlack(forged,snapshot(),NOW)
  assert.equal(forged.jobs.post.priority,2)
})

test('expiry, changed mappings and channel departure withdraw author priority without deleting work',async()=>{
  const state={jobs:{}},api=fixture()
  await syncGithubMemberPosts({state,snapshot:snapshot(),token:'secret',now:()=>NOW,request:api.request})
  const job=Object.values(state.jobs)[0]
  assert.ok(githubAuthoredMembership(state,snapshot(),job.target,NOW))
  const proof=state.githubMemberPosts.proofs['vendor/project#12'],expires=proof.expiresAt
  proof.expiresAt='never'
  assert.equal(githubAuthoredMembership(state,snapshot(),job.target,NOW),null)
  proof.expiresAt=expires
  assert.equal(githubAuthoredMembership(state,snapshot(),job.target,NOW+21600001),null)
  const left={...snapshot(),memberIds:[]}
  prioritizeSlack(state,left,NOW)
  assert.equal(job.priority,2)
  await syncGithubMemberPosts({state,snapshot:left,token:'secret',now:()=>NOW,request:api.request})
  assert.equal(Object.keys(state.githubMemberPosts.proofs).length,0)
  assert.equal(Object.keys(state.jobs).length,1)
})

test('pagination checkpoints resume after restart and incomplete results never claim a full scan',async()=>{
  const state={jobs:{}},first=fixture({items:Array.from({length:100},(_,i)=>post(i+1)),total:101})
  await syncGithubMemberPosts({state,snapshot:snapshot(),token:'secret',now:()=>NOW,request:first.request})
  assert.equal(Object.values(state.githubMemberPosts.authors)[0].page,2)
  assert.equal(state.githubMemberPosts.health,'paging')
  const restored=JSON.parse(JSON.stringify(state)),next=fixture({items:[post(101)],total:101})
  await syncGithubMemberPosts({state:restored,snapshot:snapshot(),token:'secret',now:()=>NOW+6000,request:next.request})
  assert.equal(next.requests.length,1)
  assert.equal(next.requests[0].searchParams.get('page'),'2')
  assert.equal(Object.keys(restored.jobs).length,101)
  assert.equal(restored.githubMemberPosts.health,'ok')
  const partial={jobs:{}},api=fixture({incomplete:true})
  await syncGithubMemberPosts({state:partial,snapshot:snapshot(),token:'secret',now:()=>NOW,request:api.request})
  assert.equal(Object.values(partial.githubMemberPosts.authors)[0].page,1)
  assert.equal(partial.githubMemberPosts.health,'partial')
  assert.equal(Object.keys(partial.jobs).length,1)
  const short={jobs:{}},shortPage=fixture({total:101})
  await syncGithubMemberPosts({state:short,snapshot:snapshot(),token:'secret',now:()=>NOW,request:shortPage.request})
  assert.equal(short.githubMemberPosts.health,'partial')
  assert.equal(Object.values(short.githubMemberPosts.authors)[0].page,1)
})

test('provider search ceilings remain explicit and do not claim all matching posts were scanned',async()=>{
  const state={jobs:{}},first=fixture({items:Array.from({length:100},(_,i)=>post(i+1)),total:1001})
  await syncGithubMemberPosts({state,snapshot:snapshot(),token:'secret',now:()=>NOW,request:first.request})
  const author=Object.values(state.githubMemberPosts.authors)[0];author.page=10;author.pages=[]
  const last=fixture({items:Array.from({length:100},(_,i)=>post(i+901)),total:1001})
  await syncGithubMemberPosts({state,snapshot:snapshot(),token:'secret',now:()=>NOW+6000,request:last.request})
  assert.equal(author.health,'capacity_limited')
  assert.equal(state.githubMemberPosts.health,'partial')
  assert.equal(author.page,1)
})

test('a shrinking search restarts from page one instead of remaining stuck past its final page',async()=>{
  const state={jobs:{}},first=fixture({items:Array.from({length:100},(_,i)=>post(i+1)),total:101})
  await syncGithubMemberPosts({state,snapshot:snapshot(),token:'secret',now:()=>NOW,request:first.request})
  const pending=JSON.parse(JSON.stringify(state)),partial=fixture({items:[],total:0,incomplete:true})
  await syncGithubMemberPosts({state:pending,snapshot:snapshot(),token:'secret',now:()=>NOW+6000,request:partial.request})
  assert.equal(Object.values(pending.githubMemberPosts.authors)[0].page,2)
  assert.equal(pending.githubMemberPosts.health,'partial')
  const shrunk=fixture({items:[],total:1})
  await syncGithubMemberPosts({state,snapshot:snapshot(),token:'secret',now:()=>NOW+6000,request:shrunk.request})
  assert.equal(state.githubMemberPosts.health,'paging')
  assert.equal(Object.values(state.githubMemberPosts.authors)[0].page,1)
  const refreshed=fixture({items:[post(999)]})
  await syncGithubMemberPosts({state,snapshot:snapshot(),token:'secret',now:()=>NOW+12000,request:refreshed.request})
  assert.equal(refreshed.requests[0].searchParams.get('page'),'1')
  assert.equal(state.githubMemberPosts.health,'ok')
  assert.equal(Object.keys(state.jobs).length,101)
})

test('missing credentials make no requests and a new credential retries without bypassing provider cooldowns',async()=>{
  const state={jobs:{}},api=fixture()
  await syncGithubMemberPosts({state,snapshot:snapshot(),token:null,now:()=>NOW,request:api.request})
  assert.equal(api.requests.length,0)
  assert.equal(state.githubMemberPosts.health,'credential_required')
  await syncGithubMemberPosts({state,snapshot:snapshot(),token:'secret',now:()=>NOW,request:api.request})
  assert.equal(api.requests.length,2)
  const limited={jobs:{}}
  await syncGithubMemberPosts({state:limited,snapshot:snapshot(),token:'secret',now:()=>NOW,
    request:async()=>new Response(null,{status:429,headers:{'retry-after':'3600'}})})
  assert.equal(limited.externalNextAttemptAt,NOW+3600000)
  let calls=0
  await syncGithubMemberPosts({state:limited,snapshot:snapshot(),token:'new-token',now:()=>NOW+1000,request:async()=>{calls++}})
  assert.equal(calls,0)
})

test('reserved polls and search spacing survive restart without starving the next mapped member',async()=>{
  const state={jobs:{}},s=snapshot();s.memberIds.push('UOTHER');s.identities.push({slackUserId:'UOTHER',profileUrls:['https://github.com/other'],targets:[]})
  let clock=NOW,lastSearch=0,searches=0
  await syncGithubMemberPosts({state,snapshot:s,token:'secret',now:()=>clock,pause:async ms=>{clock+=ms},request:async(address)=>{
    const u=new URL(address)
    if(u.pathname.startsWith('/users/'))return Response.json({id:u.pathname.endsWith('maker')?7:8,login:u.pathname.split('/').at(-1),type:'User'})
    if(lastSearch)assert.ok(clock-lastSearch>=2100)
    lastSearch=clock;searches++;return Response.json({items:[],total_count:0,incomplete_results:false})
  }})
  assert.equal(searches,2)
  const restored=JSON.parse(JSON.stringify(state))
  await syncGithubMemberPosts({state:restored,snapshot:s,token:'secret',now:()=>clock,request:async()=>{throw Error('Poll must stay reserved')}})
  assert.equal(restored.githubMemberPosts.health,'ok')
})

test('primary provider reset timestamps use the same clock as durable poll reservations',async()=>{
  const state={jobs:{}}
  await syncGithubMemberPosts({state,snapshot:snapshot(),token:'secret',now:()=>NOW,
    request:async()=>new Response(null,{status:403,headers:{'x-ratelimit-remaining':'0','x-ratelimit-reset':String((NOW+3600000)/1000)}})})
  assert.equal(state.externalNextAttemptAt,NOW+3600000)
})
