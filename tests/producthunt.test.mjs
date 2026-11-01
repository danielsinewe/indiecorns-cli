import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {execFileSync,spawnSync} from 'node:child_process'
import {producthuntUser,producthuntFollow,observeProducthuntProfile} from '../indiecorns/lib/producthunt.mjs'
import {defaultPolicy,validatePolicy,runActions} from '../indiecorns/lib/actions.mjs'
import {credential,storeCredential} from '../indiecorns/lib/credentials.mjs'
import {targetKey} from '../indiecorns/lib/worker.mjs'
const actor={id:'10',username:'observer'},user={id:'20',username:'maker',url:'https://www.producthunt.com/@maker',isFollowing:false,isViewer:false}
const queryData=(a=actor,u=user)=>({data:{viewer:{user:a},user:u}})
function transport({following=false,change}={}){const calls=[];return{calls,request:async(url,options)=>{
 assert.equal(url,'https://api.producthunt.com/v2/api/graphql');assert.equal(options.method,'POST');assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,'Bearer ph-secret')
 const body=JSON.parse(options.body),mutating=body.query.startsWith('mutation ');calls.push({...body,mutating})
 const changed=change?.({number:calls.length,mutating,body});if(changed)return changed
 if(mutating){following=true;return Response.json({data:{userFollow:{clientMutationId:body.variables.input.clientMutationId,errors:[],node:{...user,isFollowing:true}}}})}
 return Response.json(queryData(actor,{...user,isFollowing:following}))
}}}
const job=(key,platform,url,priority=0)=>({key,status:'queued',priority,discoveredAt:1000,target:{platform,eventType:'follow',profileUrl:url},observation:{status:'observed',url,contentHash:key,observedAt:1000}})
const state=()=>({jobs:{ph:job('ph','producthunt',user.url)}})
const binding='a'.repeat(64),policy={...defaultPolicy,mode:'execute',accountRevision:binding,maxExternalPerDay:1,producthuntUsers:['maker']}
const options=s=>({state:s,policy,accountRevision:binding,producthuntToken:'ph-secret',token:'github-secret',now:()=>1000})
const proof={kind:'producthunt_follow',username:'maker',actorId:'10',targetId:'20',verified:true}

test('Product Hunt URLs and policy require exact public profile usernames; old policies permit none',()=>{
 assert.equal(producthuntUser({platform:'producthunt',eventType:'follow',profileUrl:user.url}),'maker')
 assert.equal(producthuntUser({platform:'producthunt',eventType:'inspect',profileUrl:'https://producthunt.com/@Maker/'}),'maker')
 for(const profileUrl of ['https://www.producthunt.com/posts/maker','https://www.producthunt.com/@maker/posts','https://producthunt.com/@maker?x=1','https://producthunt.com/@maker#bio','http://producthunt.com/@maker','https://user@producthunt.com/@maker','https://producthunt.com.evil.example/@maker','https://producthunt.com/@%6daker','https://producthunt.com//@maker'])assert.equal(producthuntUser({platform:'producthunt',eventType:'follow',profileUrl}),null)
 const old={...policy};delete old.producthuntUsers;assert.deepEqual(validatePolicy(old).producthuntUsers,[])
 assert.deepEqual(validatePolicy({...policy,producthuntUsers:['Maker']}).producthuntUsers,['maker'])
 for(const producthuntUsers of [['@maker'],['maker/project'],['../maker'],[''],Array(101).fill('maker'),'maker'])assert.throws(()=>validatePolicy({...policy,producthuntUsers}))
})

test('follow verifies viewer and target, mutates the proven target ID, and independently rechecks the relationship',async()=>{
 const mock=transport(),result=await producthuntFollow('Maker',{token:'ph-secret',request:mock.request})
 assert.deepEqual(result,{...proof,alreadyPresent:false});assert.deepEqual(mock.calls.map(c=>c.mutating),[false,true,false]);assert.deepEqual(mock.calls[0].variables,{username:'maker'})
 assert.equal(mock.calls[1].variables.input.userId,'20');assert.match(mock.calls[1].variables.input.clientMutationId,/^indiecorns-[a-f0-9]{64}$/)
 const recovered=transport({following:true});assert.equal((await producthuntFollow('maker',{token:'ph-secret',request:recovered.request})).alreadyPresent,true);assert.equal(recovered.calls.length,1)
})

test('missing or wrong identities, self-follow, foreign URLs and partial GraphQL errors fail before mutation',async()=>{
 for(const value of [queryData(null,user),queryData(actor,null),queryData(actor,{...user,username:'other'}),queryData(actor,{...user,url:'https://evil.example/@maker'}),queryData(actor,{...user,isViewer:true}),queryData({...actor,id:'20'},user),queryData(actor,{...user,id:''}),{...queryData(),errors:[{message:'private provider detail'}]}]){
  const mock=transport({change:({number})=>number===1?Response.json(value):undefined});await assert.rejects(producthuntFollow('maker',{token:'ph-secret',request:mock.request}));assert.equal(mock.calls.filter(c=>c.mutating).length,0)
 }
})

test('mutation errors, wrong correlation and unproven results never become completed proof',async()=>{
 for(const change of [r=>({...r,errors:[{field:'userId'}]}),r=>({...r,clientMutationId:'wrong'}),r=>({...r,node:{...r.node,id:'99'}}),r=>({...r,node:{...r.node,isFollowing:false}})]){
  const mock=transport({change:({mutating,body})=>mutating?Response.json({data:{userFollow:change({clientMutationId:body.variables.input.clientMutationId,errors:[],node:{...user,isFollowing:true}})}}):undefined})
  await assert.rejects(producthuntFollow('maker',{token:'ph-secret',request:mock.request}),error=>!error.message.includes('userId'));assert.equal(mock.calls.filter(c=>c.mutating).length,1)
 }
})

test('after-write actor/target changes and unavailable proof stay unverified; a retry reads before writing',async()=>{
 for(const value of [queryData({...actor,id:'99'},{...user,isFollowing:true}),queryData(actor,{...user,id:'99',isFollowing:true}),queryData(actor,user)]){
  const mock=transport({change:({number})=>number===3?Response.json(value):undefined});await assert.rejects(producthuntFollow('maker',{token:'ph-secret',request:mock.request}));assert.equal(mock.calls.filter(c=>c.mutating).length,1)
 }
 const recovered=transport({following:true});await producthuntFollow('maker',{token:'ph-secret',request:recovered.request});assert.equal(recovered.calls.filter(c=>c.mutating).length,0)
})

test('HTTP/GraphQL permissions, bounded bodies and rate limits are classified without exposing provider details',async()=>{
 for(const status of [401,403])await assert.rejects(producthuntFollow('maker',{token:'ph-secret',request:async()=>new Response('private provider detail',{status})}),e=>e.code==='PRODUCTHUNT_PERMISSION_REQUIRED'&&!e.message.includes('private'))
 await assert.rejects(producthuntFollow('maker',{token:'ph-secret',request:async()=>Response.json({errors:[{extensions:{code:'FORBIDDEN'},message:'private provider detail'}]})}),e=>e.code==='PRODUCTHUNT_PERMISSION_REQUIRED')
 for(const status of [429,503])await assert.rejects(producthuntFollow('maker',{token:'ph-secret',now:()=>1000,request:async()=>new Response('',{status,headers:{'retry-after':'7200'}})}),e=>e.retryAfterMs===7200000)
 await assert.rejects(producthuntFollow('maker',{token:'ph-secret',request:async()=>new Response('private invalid JSON')}),e=>e.code==='PRODUCTHUNT_PROOF_UNAVAILABLE')
 await assert.rejects(producthuntFollow('maker',{token:'ph-secret',request:async()=>new Response('x',{headers:{'content-length':'2097153'}})}),e=>e.code==='PRODUCTHUNT_PROOF_UNAVAILABLE')
 let calls=0;await assert.rejects(producthuntFollow('maker',{request:async()=>{calls++}}));assert.equal(calls,0)
})

test('Product Hunt actions require their own credentials, account binding, allowlist and observed page',async()=>{
 let calls=0
 for(const patch of [{producthuntToken:''},{policy:{...policy,mode:'draft'}},{policy:{...policy,producthuntUsers:[]}},{accountRevision:undefined},{accountRevision:'b'.repeat(64)}])await runActions({...options(state()),...patch,producthuntExternal:async()=>{calls++;return proof}})
 const denied=state();denied.jobs.ph.observation.status='robots_denied';await runActions({...options(denied),producthuntExternal:async()=>{calls++;return proof}});assert.equal(calls,0)
 const wrong=state();wrong.jobs.ph.observation.url='https://www.producthunt.com/@other';await runActions({...options(wrong),producthuntExternal:async()=>{calls++;return proof}});assert.equal(calls,0)
 const missing=state();await runActions({...options(missing),producthuntToken:'',producthuntExternal:async()=>{calls++}});assert.equal(missing.actionHealth,'producthunt_credential_required');assert.equal(missing.actionBudget.attempts,0)
})

test('shared quota is reserved before Product Hunt work; Slack priority and completed receipts survive restart',async()=>{
 const s=state();s.jobs.gh=job('gh','github','https://github.com/other',1);let ph=0,gh=0,saved=false
 const opts={...options(s),policy:{...policy,githubUsers:['other']},checkpoint:()=>{saved=Object.values(s.actions).some(a=>a.status==='executing')||saved},producthuntExternal:async(username,{token})=>{assert.equal(token,'ph-secret');assert.ok(saved);assert.equal(s.actionBudget.attempts,1);ph++;return proof},followExternal:async username=>{gh++;return{kind:'github_follow',username,verified:true}}}
 await runActions(opts);await runActions({...opts,state:JSON.parse(JSON.stringify(s))});assert.equal(ph,1);assert.equal(gh,0)
 await runActions({...opts,state:JSON.parse(JSON.stringify(s)),now:()=>86401000});assert.equal(ph,1);assert.equal(gh,1)
})

test('provider cooldowns remain independent while all action attempts share one daily budget',async()=>{
 const s=state();s.jobs.gh=job('gh','github','https://github.com/other',1);let gh=0
 await runActions({...options(s),policy:{...policy,maxExternalPerDay:2,githubUsers:['other']},producthuntExternal:async()=>{throw Object.assign(new Error('private detail'),{retryAfterMs:7200000})},followExternal:async username=>{gh++;return{kind:'github_follow',username,verified:true}}})
 assert.equal(s.providerNextAttemptAt.producthunt,7201000);assert.equal(s.externalNextAttemptAt,undefined);assert.equal(gh,1);assert.equal(s.actionBudget.attempts,2);assert.doesNotMatch(JSON.stringify(s),/private detail/)
 const blocked=state();blocked.externalNextAttemptAt=7201000;let ph=0;await runActions({...options(blocked),producthuntExternal:async()=>{ph++;return proof}});assert.equal(ph,1)
 const recovered=JSON.parse(JSON.stringify(s));await runActions({...options(recovered),now:()=>600000,producthuntExternal:async()=>{ph++;return proof}});assert.equal(ph,1)
})

test('incomplete Product Hunt receipts cannot claim success',async()=>{
 for(const value of [{...proof,actorId:undefined},{...proof,targetId:proof.actorId},{...proof,username:'other'},{...proof,kind:'github_follow'}]){
  const s=state();await runActions({...options(s),producthuntExternal:async()=>value});assert.equal(Object.values(s.actions).find(a=>a.kind==='producthunt_follow').status,'unverified')
 }
})

test('a failed GitHub member actor check does not block another configured provider',async()=>{
 const s=state();s.jobs.gh=job('gh','github','https://github.com/maker',0);s.jobs.ph.priority=1;let ph=0
 await runActions({...options(s),policy:{...policy,maxExternalPerDay:2,githubMemberActions:['follow']},
  memberSnapshot:{version:1,workspaceId:'TTEST',channelId:'CTEST',observedAt:999,expiresAt:86400999,memberIds:['UMEMBER'],identities:[{slackUserId:'UMEMBER',profileUrls:['https://github.com/maker'],targets:[]}]},
  actorExternal:async()=>{throw Object.assign(new Error(),{code:'GITHUB_PERMISSION_REQUIRED'})},producthuntExternal:async()=>{ph++;return proof}})
 assert.equal(ph,1);assert.equal(s.actionBudget.attempts,1);assert.equal(s.externalNextAttemptAt,61000)
})

test('Product Hunt credentials persist privately and policy revocation preserves other scopes and quota',()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'indiecorns-ph-policy-')),directory=path.join(home,'.indiecorns/worker')
 const cli=fileURLToPath(new URL('../indiecorns/bin/indiecorns.mjs',import.meta.url)),env={...process.env,HOME:home,USERPROFILE:home}
 const run=args=>JSON.parse(execFileSync(process.execPath,[cli,'worker','policy','--mode','execute',...args,'--no-telemetry'],{encoding:'utf8',env}))
 try{
  assert.deepEqual(storeCredential(directory,'producthunt','private-token'),{provider:'producthunt',configured:true});assert.equal(credential(directory,'producthunt',{}),'private-token');assert.equal(credential(directory,'producthunt',{INDIECORNS_PRODUCTHUNT_TOKEN:'override'}),'override')
  if(process.platform!=='win32')assert.equal(fs.statSync(path.join(directory,'credentials.json')).mode&0o777,0o600)
  const enabled=run(['--producthunt-user','Maker','--github-member-actions','follow','--max-external-per-day','1']);assert.deepEqual(enabled.producthuntUsers,['maker'])
  const file=path.join(directory,'policy.json'),before=fs.readFileSync(file,'utf8');for(const args of [['--producthunt-user'],['--producthunt-user','@maker']]){const r=spawnSync(process.execPath,[cli,'worker','policy','--mode','execute',...args,'--no-telemetry'],{encoding:'utf8',env});assert.equal(r.status,1);assert.equal(fs.readFileSync(file,'utf8'),before)}
  const revoked=run(['--producthunt-user=']);assert.deepEqual(revoked.producthuntUsers,[]);assert.deepEqual(revoked.githubMemberActions,['follow']);assert.equal(revoked.maxExternalPerDay,1);assert.equal(revoked.accountRevision,enabled.accountRevision)
  storeCredential(directory,'producthunt',null);assert.equal(credential(directory,'producthunt',{}),null)
 }finally{fs.rmSync(home,{recursive:true,force:true})}
})

test('real CLI passes the stored Product Hunt credential into its worker and does not replay after restart',()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'indiecorns-ph-worker-')),directory=path.join(home,'.indiecorns/worker'),events=path.join(home,'events.jsonl'),stub=path.join(home,'fetch.mjs')
 const cli=fileURLToPath(new URL('../indiecorns/bin/indiecorns.mjs',import.meta.url)),env={...process.env,HOME:home,USERPROFILE:home,INDIECORNS_TOKEN:'community-test',INDIECORNS_GITHUB_TOKEN:'',INDIECORNS_SLACK_TOKEN:'',INDIECORNS_PRODUCTHUNT_TOKEN:'',INDIECORNS_TELEMETRY_DISABLED:'1'}
 try{
  storeCredential(directory,'producthunt','ph-secret');const now=Date.now(),s=state(),j=s.jobs.ph;j.key=targetKey(j.target);j.discoveredAt=now;j.lastDiscoveredAt=now;j.nextObserveAt=0;j.observation.status='http_unavailable';j.observation.observedAt=now;j.observation.links=[];j.observation.codeLinks=[];j.observation.issueLinks=[];s.jobs={[j.key]:j};s.version=1;s.failures=0;s.nextPollAt=0;fs.writeFileSync(path.join(directory,'state.json'),JSON.stringify(s))
  const snapshot={version:1,workspaceId:'TTEST',channelId:'CTEST',observedAt:now-1,expiresAt:now+3600000,memberIds:['UMEMBER'],identities:[]}
  fs.writeFileSync(stub,String.raw`import fs from 'node:fs';let following=false;globalThis.fetch=async(input,options={})=>{const u=new URL(input);if(u.host==='app.indiecorns.com'&&u.pathname.endsWith('/worker-feed'))return Response.json({version:1,snapshot:${JSON.stringify(snapshot)},targets:[],cursor:'',latest:'0.000000'});if(u.host==='app.indiecorns.com'&&u.pathname.endsWith('/community-targets'))return Response.json({targets:[],pagination:{hasMore:false,nextCursor:null}});if(u.host==='api.producthunt.com'&&u.pathname==='/v2/api/graphql'){if(options.headers.Authorization!=='Bearer ph-secret')throw new Error('Wrong provider credential');const b=JSON.parse(options.body),mutating=b.query.startsWith('mutation ');fs.appendFileSync(${JSON.stringify(events)},JSON.stringify({mutating})+'\n');if(b.query.startsWith('query IndiecornsProfile'))return Response.json({data:{user:{...${JSON.stringify(user)},name:'Maker',headline:'Builds apps',email:'not-requested-or-stored'}}});if(mutating){following=true;return Response.json({data:{userFollow:{clientMutationId:b.variables.input.clientMutationId,errors:[],node:{...${JSON.stringify(user)},isFollowing:true}}}})}return Response.json({data:{viewer:{user:${JSON.stringify(actor)}},user:{...${JSON.stringify(user)},isFollowing:following}}});}throw new Error('Unexpected test request');};`)
  execFileSync(process.execPath,[cli,'worker','policy','--mode','execute','--producthunt-user','maker','--max-external-per-day','1','--no-telemetry'],{env,encoding:'utf8'})
  const run=()=>execFileSync(process.execPath,['--import',pathToFileURL(stub).href,cli,'worker','run','--once','--no-telemetry'],{env,encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe']});run();run()
  const saved=JSON.parse(fs.readFileSync(path.join(directory,'state.json'))),calls=fs.readFileSync(events,'utf8').trim().split('\n').map(v=>JSON.parse(v));assert.equal(saved.actionBudget.attempts,1);assert.equal(saved.jobs[j.key].observation.source,'producthunt_api');assert.equal(calls.filter(c=>c.mutating).length,1);assert.equal(Object.values(saved.actions).find(a=>a.kind==='producthunt_follow').status,'completed');assert.equal(fs.existsSync(path.join(directory,'worker.lock')),false)
 }finally{fs.rmSync(home,{recursive:true,force:true})}
})

test('official API profile observation verifies exact identity and stores only bounded public metadata',async()=>{
 const target={platform:'producthunt',eventType:'follow',profileUrl:user.url}
 const request=async(url,options)=>{assert.equal(url,'https://api.producthunt.com/v2/api/graphql');assert.equal(options.redirect,'error');assert.match(JSON.parse(options.body).query,/query IndiecornsProfile/);return Response.json({data:{user:{...user,name:'Maker',headline:'x'.repeat(2000),email:'PRIVATE_SENTINEL',media:'PRIVATE_SENTINEL'}}})}
 const observed=await observeProducthuntProfile({target,token:'ph-secret',request,now:()=>1000})
 assert.equal(observed.status,'observed');assert.equal(observed.source,'producthunt_api');assert.equal(observed.providerUserId,'20');assert.equal(observed.description.length,1600);assert.equal(observed.observedAt,1000);assert.match(observed.contentHash,/^[a-f0-9]{64}$/);assert.doesNotMatch(JSON.stringify(observed),/PRIVATE_SENTINEL/)
 for(const value of [{...user,id:''},{...user,username:'other'},{...user,url:'https://evil.example/@maker'}])await assert.rejects(observeProducthuntProfile({target,token:'ph-secret',request:async()=>Response.json({data:{user:{name:'Maker',headline:null,...value}}})}))
})

test('observation rate limits are checkpointed and shared with actions before another API request',async()=>{
 const target={platform:'producthunt',eventType:'follow',profileUrl:user.url},state={};let calls=0,saved=0
 const options={target,token:'ph-secret',state,now:()=>1000,checkpoint:()=>{saved++},request:async()=>{calls++;return new Response('',{status:429,headers:{'retry-after':'7200'}})}}
 await assert.rejects(observeProducthuntProfile(options),e=>e.retryAt===7201000)
 assert.equal(saved,1);assert.equal(state.providerNextAttemptAt.producthunt,7201000)
 await assert.rejects(observeProducthuntProfile(options),e=>e.code==='HOST_DELAY'&&e.retryAt===7201000);assert.equal(calls,1)
 const s={...state,jobs:{ph:job('ph','producthunt',user.url)}};let mutations=0
 await runActions({...options,state:s,policy,accountRevision:binding,producthuntToken:'ph-secret',producthuntExternal:async()=>{mutations++;return proof}});assert.equal(mutations,0)
})
