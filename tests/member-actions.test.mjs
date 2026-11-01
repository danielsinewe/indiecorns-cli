import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {targetKey} from '../indiecorns/lib/worker.mjs'
import {execFileSync,spawnSync} from 'node:child_process'
import {defaultPolicy,validatePolicy,runActions,githubActor,githubStar} from '../indiecorns/lib/actions.mjs'
const binding='a'.repeat(64)
const snapshot=()=>({version:1,workspaceId:'TTEST',channelId:'CTEST',observedAt:1000,expiresAt:86401000,
  memberIds:['UMEMBER'],identities:[{slackUserId:'UMEMBER',profileUrls:['https://github.com/Maker'],targets:[]}]})
const job=(key,url)=>({key,priority:0,discoveredAt:1000,target:{platform:'github',eventType:'inspect',profileUrl:url},
  observation:{status:'observed',url,contentHash:key,observedAt:1000}})
const state=()=>({jobs:{profile:job('profile','https://github.com/maker'),project:job('project','https://github.com/maker/project')}})
const policy={...defaultPolicy,mode:'execute',accountRevision:binding,maxExternalPerDay:1,githubMemberActions:['follow','star']}
const actorExternal=async()=>({id:123,username:'observer'})
const options=s=>({state:s,policy,accountRevision:binding,token:'test',memberSnapshot:snapshot(),now:()=>1000,actorExternal})
const followExternal=async(username,{authorize})=>{assert.equal(authorize(),true);return{kind:'github_follow',username,verified:true}}
const external=async(repository,{authorize})=>{assert.equal(authorize(),true);return{kind:'github_star',repository,verified:true}}

test('member scope shares quotas, persists intent and reuses the same receipts as exact allowlists',async()=>{
 const s=state();let follows=0,stars=0,saved=false,actorReads=0
 const opts={...options(s),actorExternal:async()=>{actorReads++;return actorExternal()},checkpoint:()=>{saved=Object.values(s.actions).some(a=>a.status==='executing')||saved},
  followExternal:async(...args)=>{assert.ok(saved);assert.equal(s.actionBudget.attempts,1);assert.equal(Object.values(s.actions).find(a=>a.status==='executing').authorization.githubActorId,123);follows++;return followExternal(...args)},
  external:async(...args)=>{stars++;return external(...args)}}
 await runActions(opts);assert.equal(follows,1);assert.equal(stars,0);assert.equal(actorReads,1)
 const receipt=Object.values(s.actions).find(a=>a.kind==='github_follow')
 assert.deepEqual(receipt.authorization,{scope:'verified_slack_member',workspaceId:'TTEST',channelId:'CTEST',slackUserId:'UMEMBER',owner:'maker',observedAt:1000,expiresAt:86401000,githubActorId:123,accountRevision:binding,authorizedAt:1000})
 await runActions({...opts,state:JSON.parse(JSON.stringify(s))});assert.equal(follows,1);assert.equal(actorReads,1)
 const recovered=JSON.parse(JSON.stringify(s))
 await runActions({...opts,state:recovered,policy:{...policy,githubMemberActions:[],githubRepositories:['maker/project'],githubUsers:['maker']},now:()=>86401000,
  external:async repository=>{stars++;return{kind:'github_star',repository,verified:true}}})
 assert.equal(follows,1);assert.equal(stars,1)
})

test('expired, future, departed, changed and forged member evidence cannot enable actions',async()=>{
 const cases=[null,{...snapshot(),expiresAt:1000},{...snapshot(),observedAt:1001},
  {...snapshot(),expiresAt:86401001},{...snapshot(),memberIds:[]},{...snapshot(),workspaceId:'wrong'},
  {...snapshot(),identities:[{slackUserId:'UMEMBER',profileUrls:['https://github.com/other']}]},
  {...snapshot(),identities:[{slackUserId:'UMEMBER',profileUrls:['https://github.com.evil.example/maker','https://github.com/maker?tab=repositories']}]},
  {...snapshot(),identities:[null]}]
 let reads=0,writes=0
 for(const memberSnapshot of cases){const s=state();for(const j of Object.values(s.jobs)){j.target.slackMember=true;j.priorityReason='verified_slack_owner';j.slackEvidence={...snapshot()}}
  await runActions({...options(s),memberSnapshot,actorExternal:async()=>{reads++;return actorExternal()},external:async()=>{writes++},followExternal:async()=>{writes++}})}
 assert.equal(reads,0);assert.equal(writes,0)
})

test('scope is opt-in, account-bound, observed and specific to each action kind',async()=>{
 let writes=0,reads=0
 for(const patch of [{policy:{...policy,githubMemberActions:[]}},{policy:{...policy,mode:'draft'}},{accountRevision:undefined},{accountRevision:'b'.repeat(64)},
  {policy:{...policy,accountRevision:undefined}},{token:''}])
  await runActions({...options(state()),...patch,actorExternal:async()=>{reads++;return actorExternal()},external:async()=>{writes++},followExternal:async()=>{writes++}})
 assert.equal(writes,0);assert.equal(reads,0)
 const s=state();s.jobs.profile.observation.status='robots_denied';s.jobs.project.observation.url='https://github.com/other/project'
 await runActions({...options(s),external:async()=>{writes++},followExternal:async()=>{writes++}});assert.equal(writes,0)
 const onlyStar=state();await runActions({...options(onlyStar),policy:{...policy,githubMemberActions:['star']},external,followExternal:async()=>{writes++}})
 assert.equal(writes,0);assert.equal(Object.values(onlyStar.actions).filter(a=>a.kind==='github_star'&&a.status==='completed').length,1)
 const issue={jobs:{issue:job('issue','https://github.com/maker/project/issues/12')}}
 await runActions({...options(issue),reactionExternal:async()=>{writes++}});assert.equal(writes,0)
})

test('automatic scope excludes the credential owner without consuming write quota',async()=>{
 const s=state();let writes=0,reads=0
 await runActions({...options(s),actorExternal:async()=>{reads++;return{id:123,username:'Maker'}},external:async()=>{writes++},followExternal:async()=>{writes++}})
 assert.equal(reads,1);assert.equal(writes,0);assert.equal(s.actionBudget.attempts,0)
})

test('actor failures persist provider cooldown without consuming write quota or fabricating receipts',async()=>{
 const s=state();let reads=0,writes=0
 const opts={...options(s),actorExternal:async()=>{reads++;throw Object.assign(new Error('private detail'),{retryAfterMs:7200000})},external:async()=>{writes++},followExternal:async()=>{writes++}}
 await runActions(opts);await runActions({...opts,state:JSON.parse(JSON.stringify(s)),now:()=>600000})
 assert.equal(reads,1);assert.equal(writes,0);assert.equal(s.actionBudget.attempts,0);assert.equal(s.externalNextAttemptAt,7201000)
 assert.equal(s.actionHealth,'github_actor_unverified');assert.ok(Object.values(s.actions).every(a=>a.kind==='support_brief'))
 assert.doesNotMatch(JSON.stringify(s),/private detail/)
})

test('membership expiry is checked after actor lookup and immediately before a real adapter write',async()=>{
 let clock=1000,writes=0
 const memberSnapshot={...snapshot(),expiresAt:2000}
 const s=state();await runActions({...options(s),memberSnapshot,now:()=>clock,actorExternal:async()=>{clock=2000;return actorExternal()},external:async()=>{writes++},followExternal:async()=>{writes++}})
 assert.equal(writes,0);assert.equal(s.actionBudget.attempts,0)
 clock=1000;const project=state();delete project.jobs.profile
 await runActions({...options(project),memberSnapshot,now:()=>clock,external:(repository,opts)=>githubStar(repository,{...opts,request:async(url,{method})=>{
  if(method==='PUT')writes++;clock=2000;return new Response(null,{status:404})}})})
 assert.equal(writes,0);assert.equal(project.actionHealth,'member_scope_expired');assert.equal(project.actionBudget.attempts,1)
 assert.equal(Object.values(project.actions).find(a=>a.kind==='github_star').status,'unverified')
})

test('GitHub actor proof uses the credential and requires a numeric identity and canonical username',async()=>{
 const actual=await githubActor({token:'test',request:async(url,opts)=>{assert.equal(url,'https://api.github.com/user');assert.equal(opts.method,'GET');assert.equal(opts.headers.Authorization,'Bearer test');return Response.json({id:42,login:'Observer'})}})
 assert.deepEqual(actual,{id:42,username:'observer'})
 for(const value of [{id:0,login:'maker'},{id:'42',login:'maker'},{id:42,login:'bad--name'}])
  await assert.rejects(githubActor({token:'test',request:async()=>Response.json(value)}))
})

test('member policy CLI supports explicit opt-in and atomic revocation without altering exact lists or quota',()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'indiecorns-member-policy-'))
 const cli=fileURLToPath(new URL('../indiecorns/bin/indiecorns.mjs',import.meta.url))
 const env={...process.env,HOME:home,USERPROFILE:home}
 const run=args=>JSON.parse(execFileSync(process.execPath,[cli,'worker','policy','--mode','execute',...args,'--no-telemetry'],{encoding:'utf8',env}))
 try{
  const enabled=run(['--github-member-actions','follow,star','--github-user','maker','--max-external-per-day','1'])
  assert.deepEqual(enabled.githubMemberActions,['follow','star'])
  const file=path.join(home,'.indiecorns/worker/policy.json'),before=fs.readFileSync(file,'utf8')
  for(const args of [['--github-member-actions'],['--github-member-actions','react'],['--github-member-actions','star,star']]){
   const r=spawnSync(process.execPath,[cli,'worker','policy','--mode','execute',...args,'--no-telemetry'],{encoding:'utf8',env});assert.equal(r.status,1);assert.equal(fs.readFileSync(file,'utf8'),before)}
  const revoked=run(['--github-member-actions=']);assert.deepEqual(revoked.githubMemberActions,[]);assert.deepEqual(revoked.githubUsers,['maker']);assert.equal(revoked.maxExternalPerDay,1);assert.equal(revoked.accountRevision,enabled.accountRevision)
 }finally{fs.rmSync(home,{recursive:true,force:true})}
 const old={...policy};delete old.githubMemberActions;assert.deepEqual(validatePolicy(old).githubMemberActions,[])
})

test('real CLI worker passes refreshed community evidence into member actions and does not replay on restart',()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'indiecorns-member-worker-'))
 const directory=path.join(home,'.indiecorns/worker'),events=path.join(home,'requests.jsonl'),stub=path.join(home,'fetch.mjs')
 const cli=fileURLToPath(new URL('../indiecorns/bin/indiecorns.mjs',import.meta.url))
 const env={...process.env,HOME:home,USERPROFILE:home,INDIECORNS_TOKEN:'community-test',INDIECORNS_GITHUB_TOKEN:'github-test',INDIECORNS_SLACK_TOKEN:'',INDIECORNS_TELEMETRY_DISABLED:'1'}
 try{
  fs.mkdirSync(directory,{recursive:true})
  const current=Date.now(),s={version:1,failures:0,nextPollAt:0,jobs:{}}
  const profile=job('profile','https://github.com/maker');profile.key=targetKey(profile.target);profile.nextObserveAt=current+3600000;profile.observation.observedAt=current;profile.observation.links=[];profile.observation.codeLinks=[];profile.observation.issueLinks=[]
  s.jobs[profile.key]=profile;fs.writeFileSync(path.join(directory,'state.json'),JSON.stringify(s))
  const member={...snapshot(),observedAt:current-1,expiresAt:current+3600000,identities:[{slackUserId:'UMEMBER',profileUrls:['https://github.com/maker'],targets:[]}]}
  fs.writeFileSync(stub,String.raw`import fs from 'node:fs';let following=false;globalThis.fetch=async(input,options={})=>{const u=new URL(input);const method=options.method??'GET';fs.appendFileSync(${JSON.stringify(events)},JSON.stringify({host:u.host,path:u.pathname,method})+'\n');
   if(u.host==='app.indiecorns.com'&&u.pathname.endsWith('/worker-feed'))return Response.json({version:1,snapshot:${JSON.stringify(member)},targets:[],cursor:'',latest:'0.000000'});
   if(u.host==='app.indiecorns.com'&&u.pathname.endsWith('/community-targets'))return Response.json({targets:[],pagination:{hasMore:false,nextCursor:null}});
   if(u.host==='api.github.com'&&u.pathname==='/users/maker')return Response.json({id:42,login:'maker',type:'User'});
   if(u.host==='api.github.com'&&u.pathname==='/search/issues')return Response.json({items:[],total_count:0,incomplete_results:false});
   if(u.host==='api.github.com'&&u.pathname==='/user')return Response.json({id:123,login:'observer'});
   if(u.host==='api.github.com'&&u.pathname==='/user/following/maker'){if(method==='PUT')following=true;return new Response(null,{status:following?204:404})}
   throw new Error('Unexpected test request');};`)
  execFileSync(process.execPath,[cli,'worker','policy','--mode','execute','--github-member-actions','follow','--max-external-per-day','1','--no-telemetry'],{env,encoding:'utf8'})
  const run=()=>execFileSync(process.execPath,['--import',pathToFileURL(stub).href,cli,'worker','run','--once','--no-telemetry'],{env,encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe']})
  run();run()
  const saved=JSON.parse(fs.readFileSync(path.join(directory,'state.json'))),requests=fs.readFileSync(events,'utf8').trim().split('\n').map(v=>JSON.parse(v))
  assert.equal(saved.communityFeed.health,'ok');assert.equal(saved.slackMemberCount,1);assert.equal(saved.actionBudget.attempts,1)
  assert.equal(Object.values(saved.actions).filter(a=>a.kind==='github_follow'&&a.status==='completed').length,1)
  assert.equal(Object.values(saved.actions).find(a=>a.kind==='github_follow').authorization.githubActorId,123)
  assert.equal(requests.filter(r=>r.method==='PUT').length,1)
  assert.equal(requests.filter(r=>r.path==='/user').length,1)
  assert.equal(fs.existsSync(path.join(directory,'worker.lock')),false)
 }finally{fs.rmSync(home,{recursive:true,force:true})}
})
