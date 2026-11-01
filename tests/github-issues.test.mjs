import test from 'node:test'
import assert from 'node:assert/strict'
import {githubIssue,parseGithubIssue,githubIssueReaction} from '../indiecorns/lib/github-issues.mjs'
import {defaultPolicy,validatePolicy,runActions} from '../indiecorns/lib/actions.mjs'
import {extractPage,memberCandidates} from '../indiecorns/lib/scraper.mjs'
import {prioritizeSlack} from '../indiecorns/lib/slack.mjs'
import {enqueue,runWorker} from '../indiecorns/lib/worker.mjs'
import {mkdtempSync,rmSync,statSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {execFileSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'

const url='https://github.com/maker/project/issues/12'
const target={platform:'github',eventType:'inspect',profileUrl:url}
const own={id:99,user:{id:7,login:'actor'},content:'+1'}
const proof={kind:'github_issue_reaction',issue:'maker/project#12',content:'+1',actorId:7,reactionId:99,verified:true}
const state=()=>({jobs:{post:{key:'post',priority:0,discoveredAt:1000,target,
  observation:{status:'observed',url,contentHash:'post',observedAt:1000}}}})
function api({already=false,afterMissing=false,pages=false,privateRepo=false,pullRequest=false,invalidWrite=false}={}) {
  let present=already
  const calls=[]
  const request=async(address,options)=>{
    const u=new URL(address);calls.push({path:u.pathname,method:options.method,page:u.searchParams.get('page')})
    assert.equal(options.redirect,'error')
    if(u.pathname==='/repos/maker/project')return Response.json({private:privateRepo,visibility:privateRepo?'private':'public',full_name:'maker/project'})
    if(u.pathname==='/user')return Response.json({id:7,login:'actor'})
    if(u.pathname==='/repos/maker/project/issues/12')return Response.json({number:12,html_url:url,...(pullRequest?{pull_request:{}}:{})})
    assert.equal(u.pathname,'/repos/maker/project/issues/12/reactions')
    if(options.method==='POST'){
      assert.deepEqual(JSON.parse(options.body),{content:'+1'})
      present=true;return Response.json(invalidWrite?{...own,user:{id:8}}:own,{status:201})
    }
    assert.equal(u.searchParams.get('content'),'+1')
    if(pages&&u.searchParams.get('page')==='1')return Response.json([{...own,id:20,user:{id:8,login:'actor'}}],{
      headers:{link:'<https://api.github.com/repos/maker/project/issues/12/reactions?content=%2B1&per_page=100&page=2>; rel="next"'}})
    return Response.json(present&&!afterMissing?[own]:[])
  }
  return {request,calls}
}

test('issue targets and allowlists require exact canonical public issue IDs',()=>{
  assert.equal(githubIssue(target),'maker/project#12')
  assert.equal(parseGithubIssue('Maker/Project#12').issue,'maker/project#12')
  for(const address of [url+'#comment',url+'?q=x','https://github.com/maker/project/pull/12','https://github.com/maker/project/issues/new',
    'https://github.com/maker/project/issues/012','https://github.com.evil.example/maker/project/issues/12','https://actor@github.com/maker/project/issues/12'])assert.equal(githubIssue({...target,profileUrl:address}),null)
  for(const id of ['maker/project#0','maker/project#01','maker/../project#12','maker/project#12/other','https://github.com/maker/project/issues/12'])assert.throws(()=>validatePolicy({...defaultPolicy,githubIssues:[id]}))
  assert.deepEqual(validatePolicy({...defaultPolicy,githubIssues:['Maker/Project#12']}).githubIssues,['maker/project#12'])
  const queued={jobs:{}};enqueue(queued,[{...target,targetType:'link'}],1000)
  assert.equal(Object.values(queued.jobs)[0].target.targetType,'post')
})

test('repository pages discover issue indexes and posts independently of unrelated link limits',()=>{
  const page=extractPage('<a href="/maker/project/issues">Issues</a><a href="/maker/project/issues/12">A post</a>'+Array.from({length:30},(_,i)=>`<a href="/unrelated${i}">Footer</a>`).join('')+
    '<a href="/maker/other/issues/9">Other project</a><a href="/maker/project/issues/new">New</a><a href="/maker/project/issues/13?q=x">Query</a>',
    'https://github.com/maker/project')
  assert.equal(page.links.length,20)
  assert.deepEqual(page.issueLinks,['https://github.com/maker/project/issues',url])
  const candidates=memberCandidates({platform:'github',profileUrl:'https://github.com/maker/project'},page)
  assert.deepEqual(candidates.map(c=>c.targetType),['listing','post'])
  assert.ok(candidates.every(c=>c.attribution==='repository_issue_author_unverified'))
  const index=extractPage('<a href="/maker/project/issues/12">Post</a>','https://github.com/maker/project/issues')
  assert.equal(memberCandidates({platform:'github',profileUrl:'https://github.com/maker/project/issues'},index)[0].profileUrl,url)
})

test('a member-owned repository prioritizes its issue without claiming the member authored the post',()=>{
  const s=state()
  prioritizeSlack(s,{version:1,workspaceId:'TTEST',channelId:'CTEST',memberIds:['UMEMBER'],observedAt:1000,expiresAt:100000,
    identities:[{slackUserId:'UMEMBER',profileUrls:['https://github.com/maker'],targets:[]}]},5000)
  assert.equal(s.jobs.post.priority,0)
  assert.equal(s.jobs.post.priorityReason,'verified_slack_project')
  assert.equal(s.jobs.post.slackEvidence.relationship,'member_project')
})

test('issue listings are searched again after fifteen minutes without resetting post observation cooldowns',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'indiecorns-issue-refresh-'));let clock=1000
  const listing={platform:'github',eventType:'inspect',targetType:'listing',profileUrl:'https://github.com/maker/project/issues'}
  const seen=[]
  const options={directory,once:true,now:()=>clock,discover:async()=>[listing,target],
    observe:async item=>{seen.push(item.profileUrl);return {status:'observed',observedAt:clock,contentHash:'page'}}}
  try {
    await runWorker(options)
    clock+=900000
    const next=await runWorker(options)
    assert.equal(seen.filter(address=>address===listing.profileUrl).length,2)
    assert.equal(seen.filter(address=>address===url).length,1)
    assert.equal(Object.values(next.jobs).find(j=>j.target.profileUrl===listing.profileUrl).nextObserveAt,clock+900000)
  }finally{rmSync(directory,{recursive:true,force:true})}
})

test('reaction verifies public repository, actor, exact issue, and independent after-write evidence',async()=>{
  const fixture=api()
  const result=await githubIssueReaction('maker/project#12',{token:'secret',request:fixture.request})
  assert.deepEqual(result,{...proof,alreadyPresent:false})
  assert.deepEqual(fixture.calls.map(c=>c.method),['GET','GET','GET','GET','POST','GET'])
  const existing=api({already:true,pages:true})
  const recovered=await githubIssueReaction('maker/project#12',{token:'secret',request:existing.request})
  assert.equal(recovered.alreadyPresent,true)
  assert.equal(existing.calls.some(c=>c.method==='POST'),false)
  assert.equal(existing.calls.at(-1).page,'2')
})

test('private repositories, pull requests, wrong-actor responses and missing after-write proof cannot complete',async()=>{
  for(const options of [{privateRepo:true},{pullRequest:true},{invalidWrite:true},{afterMissing:true}]) {
    const fixture=api(options)
    await assert.rejects(githubIssueReaction('maker/project#12',{token:'secret',request:fixture.request}))
    if(options.privateRepo||options.pullRequest)assert.equal(fixture.calls.some(c=>c.method==='POST'),false)
    if(options.privateRepo)assert.equal(fixture.calls.length,1)
  }
})

test('incomplete or foreign reaction pagination fails before any write',async()=>{
  for(const foreign of [false,true]) {
    const fixture=api()
    let writes=0
    await assert.rejects(githubIssueReaction('maker/project#12',{token:'secret',request:async(address,options)=>{
      if(options.method==='POST')writes++
      const u=new URL(address)
      if(u.pathname.endsWith('/reactions'))return Response.json([], {headers:{link:`<https://${foreign?'other.example':'api.github.com'}/repos/maker/project/issues/12/reactions?content=%2B1&per_page=100&page=${Number(u.searchParams.get('page'))+1}>; rel="next"`}})
      return fixture.request(address,options)
    }}))
    assert.equal(writes,0)
  }
})

test('old policies and repository allowlists do not authorize issue reactions; shared quota and receipts prevent replay',async()=>{
  let writes=0
  for(const policy of [{version:1,mode:'execute',maxExternalPerDay:1,githubRepositories:['maker/project']},{...defaultPolicy,mode:'execute',githubIssues:['maker/project#13']}]) {
    await runActions({state:state(),policy,token:'secret',reactionExternal:async()=>{writes++}})
  }
  assert.equal(writes,0)
  const s=state();s.jobs.star={key:'star',priority:2,discoveredAt:1000,target:{platform:'github',eventType:'star',profileUrl:'https://github.com/maker/project'},observation:{status:'observed',contentHash:'repo'}}
  let intents=0
  const options={state:s,policy:{...defaultPolicy,mode:'execute',maxExternalPerDay:1,githubRepositories:['maker/project'],githubIssues:['maker/project#12']},token:'secret',now:()=>1000,
    checkpoint:()=>{if(Object.values(s.actions).some(a=>a.status==='executing'))intents++},
    reactionExternal:async()=>{assert.ok(intents>0);assert.equal(s.actionBudget.attempts,1);writes++;return proof},external:async()=>{throw Error('Star must wait for shared quota')}}
  await runActions(options)
  await runActions({...options,state:JSON.parse(JSON.stringify(s))})
  assert.equal(writes,1)
  assert.equal(Object.values(s.actions).find(a=>a.kind==='github_issue_reaction').status,'completed')
})

test('interrupted reaction completion reconciles the actor’s existing reaction without a second POST',async()=>{
  const fixture=api();const s=state();let interrupted=true
  const options={state:s,policy:{...defaultPolicy,mode:'execute',githubIssues:['maker/project#12']},token:'secret',now:()=>1000,
    reactionExternal:async issue=>{const result=await githubIssueReaction(issue,{token:'secret',request:fixture.request});if(interrupted){interrupted=false;throw Error('Interrupted receipt')}return result}}
  await runActions(options)
  assert.equal(Object.values(s.actions).find(a=>a.kind==='github_issue_reaction').status,'unverified')
  const recovered=JSON.parse(JSON.stringify(s));await runActions({...options,state:recovered,now:()=>7201000})
  assert.equal(fixture.calls.filter(c=>c.method==='POST').length,1)
  assert.equal(Object.values(recovered.actions).find(a=>a.kind==='github_issue_reaction').proof.alreadyPresent,true)
})

test('reaction rate limits pause all GitHub actions, and incomplete receipt fields remain unverified',async()=>{
  const s=state()
  const policy={...defaultPolicy,mode:'execute',githubIssues:['maker/project#12']}
  await runActions({state:s,policy,token:'secret',now:()=>1000,
    reactionExternal:issue=>githubIssueReaction(issue,{token:'secret',request:async()=>new Response(null,{status:429,headers:{'retry-after':'7200'}})})})
  assert.equal(s.externalNextAttemptAt,7201000)
  assert.equal(Object.values(s.actions).find(a=>a.kind==='github_issue_reaction').status,'unverified')
  let requests=0
  await runActions({state:s,policy,token:'secret',now:()=>7200000,reactionExternal:async()=>{requests++}})
  assert.equal(requests,0)
  const wrong=state()
  await runActions({state:wrong,policy,token:'secret',now:()=>1000,reactionExternal:async()=>({...proof,actorId:undefined})})
  assert.equal(Object.values(wrong.actions).find(a=>a.kind==='github_issue_reaction').status,'unverified')
})

test('CLI policy can atomically enable and revoke an issue allowlist without changing other permissions',()=>{
  const home=mkdtempSync(join(tmpdir(),'indiecorns-issue-policy-'))
  const cli=fileURLToPath(new URL('../indiecorns/bin/indiecorns.mjs',import.meta.url))
  const env={...process.env,HOME:home,USERPROFILE:home}
  const policy=args=>JSON.parse(execFileSync(process.execPath,[cli,'worker','policy','--mode','execute',...args,'--no-telemetry'],{encoding:'utf8',env}))
  try {
    const enabled=policy(['--github-issue','Maker/Project#12','--github-user','maker','--max-external-per-day','1'])
    assert.deepEqual(enabled.githubIssues,['maker/project#12'])
    const revoked=policy(['--github-issue='])
    assert.deepEqual(revoked.githubIssues,[])
    assert.deepEqual(revoked.githubUsers,['maker'])
    assert.equal(revoked.maxExternalPerDay,1)
    assert.equal(revoked.accountRevision,enabled.accountRevision)
    if(process.platform!=='win32')assert.equal(statSync(join(home,'.indiecorns/worker/policy.json')).mode&0o777,0o600)
  }finally{rmSync(home,{recursive:true,force:true})}
})
