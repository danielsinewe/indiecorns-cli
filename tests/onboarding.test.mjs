import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync,existsSync,writeFileSync,statSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {setupWorker,inspectWorkerProcess} from '../indiecorns/lib/onboarding.mjs'
import {storeCredential} from '../indiecorns/lib/credentials.mjs'
import {saveState} from '../indiecorns/lib/worker.mjs'
import {spawn} from 'node:child_process'
import {createServer} from 'node:http'

const binding='a'.repeat(64)
const snapshot=()=>({version:1,workspaceId:'TTEST',channelId:'CTEST',observedAt:Date.now()-1000,expiresAt:Date.now()+3600000,
  memberIds:['UTEST','UOTHER'],identities:[{slackUserId:'UTEST',profileUrls:['https://github.com/maker'],targets:[]}]})
const fixture=()=>{
  const directory=mkdtempSync(join(tmpdir(),'indiecorns-onboarding-'))
  let installed=0,persisted=0
  const options={directory,appUrl:'https://app.indiecorns.com',headers:{Authorization:'Bearer community-secret'},accountRevision:binding,
    mode:'execute',environment:{},run:(name,args)=>{assert.equal(name,'gh');assert.deepEqual(args,['auth','token','--hostname','github.com']);return {status:0,stdout:'github-secret\n'}},
    inspect:()=>({registered:installed>0,running:installed>0,pid:123,appUrl:'https://app.indiecorns.com'}),install:()=>{installed++},persistAuth:()=>{persisted++},
    request:async(url,settings)=>{
      if(String(url).includes('api.github.com')) {
        assert.equal(settings.method,'GET');assert.equal(settings.headers.Authorization,'Bearer github-secret')
        return Response.json({id:123,login:'maker'},{headers:{'x-oauth-scopes':'public_repo, user:follow'}})
      }
      assert.equal(settings.headers.Authorization,'Bearer community-secret')
      return Response.json({version:1,snapshot:snapshot(),targets:[],cursor:'',latest:'1000.000001'})
    }}
  return {directory,options,counts:()=>({installed,persisted}),close:()=>rmSync(directory,{recursive:true,force:true})}
}

test('one setup imports a verified gh login, creates member scope and starts a service without local Slack secrets',async()=>{
  const f=fixture()
  try {
    const result=await setupWorker(f.options)
    assert.equal(result.state,'ready');assert.deepEqual(f.counts(),{installed:1,persisted:1})
    const policy=JSON.parse(readFileSync(join(f.directory,'policy.json')))
    assert.deepEqual(policy.githubMemberActions,['follow','star']);assert.equal(policy.accountRevision,binding);assert.equal(policy.maxExternalPerDay,1)
    assert.deepEqual(JSON.parse(readFileSync(join(f.directory,'credentials.json'))),{github:'github-secret'})
    assert.deepEqual(JSON.parse(readFileSync(join(f.directory,'slack-settings.json'))),{source:'community'})
    assert.doesNotMatch(JSON.stringify(result),/github-secret|community-secret/)
    if(process.platform!=='win32')assert.equal(statSync(join(f.directory,'credentials.json')).mode&0o777,0o600)
    const before=readFileSync(join(f.directory,'policy.json'),'utf8')
    // Repeated setup must neither raise a quota nor reinstall an existing service.
    const second=await setupWorker({...f.options,mode:'collect'})
    assert.equal(second.state,'ready');assert.equal(f.counts().installed,1)
    assert.equal(readFileSync(join(f.directory,'policy.json'),'utf8'),before)
  }finally{f.close()}
})

test('check mode performs only reads and does not install, save credentials, or modify queue and policy',async()=>{
  const f=fixture()
  try {
    saveState(join(f.directory,'state.json'),{jobs:{},actions:{receipt:{status:'completed'}},actionBudget:{day:'2026-11-02',attempts:1}})
    const before=readFileSync(join(f.directory,'state.json'),'utf8')
    const result=await setupWorker({...f.options,check:true})
    assert.equal(result.state,'setup_required');assert.deepEqual(f.counts(),{installed:0,persisted:0})
    assert.equal(existsSync(join(f.directory,'credentials.json')),false);assert.equal(existsSync(join(f.directory,'policy.json')),false)
    assert.equal(readFileSync(join(f.directory,'state.json'),'utf8'),before)
  }finally{f.close()}
})

test('missing/expired community auth and unsupported Node cannot install or import provider credentials',async()=>{
  const f=fixture()
  try {
    assert.equal((await setupWorker({...f.options,headers:null,run:()=>assert.fail()})).steps[0].status,'required')
    assert.equal((await setupWorker({...f.options,request:async()=>new Response('',{status:401}),run:()=>assert.fail()})).steps[0].status,'auth_required')
    await assert.rejects(setupWorker({...f.options,runtimeVersion:'20.20.0'}),/require Node/)
    assert.deepEqual(f.counts(),{installed:0,persisted:0});assert.equal(existsSync(join(f.directory,'policy.json')),false)
  }finally{f.close()}
})

test('existing account policy, service origin and malformed configuration fail closed',async()=>{
  const f=fixture()
  try {
    await setupWorker(f.options)
    const before=readFileSync(join(f.directory,'policy.json'),'utf8')
    assert.equal((await setupWorker({...f.options,accountRevision:'b'.repeat(64),run:()=>assert.fail()})).state,'account_policy_mismatch')
    const result=await setupWorker({...f.options,inspect:()=>({registered:true,running:true,appUrl:'https://other.example'})})
    assert.equal(result.steps.at(-1).status,'app_mismatch')
    assert.equal(readFileSync(join(f.directory,'policy.json'),'utf8'),before)
    writeFileSync(join(f.directory,'policy.json'),'{broken')
    await assert.rejects(setupWorker(f.options),SyntaxError)
    assert.equal(f.counts().installed,1)
  }finally{f.close()}
})

test('missing and under-scoped GitHub login leave discovery running with explicit incomplete action setup',async()=>{
  const f=fixture()
  try {
    const request=async(url,settings)=>String(url).includes('api.github.com')?
      Response.json({id:123,login:'maker'},{headers:{'x-oauth-scopes':'read:user'}}):f.options.request(url,settings)
    const result=await setupWorker({...f.options,request})
    assert.equal(result.state,'running_with_action_requirements');assert.equal(result.capabilities.githubActions,false)
    assert.equal(result.steps.find(s=>s.id==='github').status,'permissions_required')
    assert.equal(existsSync(join(f.directory,'credentials.json')),false)
    assert.equal((await setupWorker({...f.options,run:()=>({status:1,stdout:''})})).state,'running_with_action_requirements')
  }finally{f.close()}
})

test('a registered but unhealthy service is diagnosed without reinstalling or treating stale PID files as live',async()=>{
  const f=fixture()
  try {
    const result=await setupWorker({...f.options,inspect:()=>({registered:true,running:false,appUrl:f.options.appUrl})})
    assert.equal(result.steps.at(-1).status,'attention_required');assert.equal(f.counts().installed,0)
    saveState(join(f.directory,'service-runtime.json'),{cli:'/member/cli.mjs',node:'/member/node'})
    saveState(join(f.directory,'worker.lock'),{pid:123,owner:'old'})
    const inspected=inspectWorkerProcess(f.directory,{system:'linux',run:()=>({status:0,stdout:'/member/node unrelated.mjs'})})
    assert.equal(inspected.running,false);assert.equal(inspected.processMatches,false)
  }finally{f.close()}
})

test('actual CLI setup check uses shared community auth without creating a service or leaking env tokens',async()=>{
  const f=fixture();const calls=[]
  const server=createServer((req,res)=>{
    calls.push({url:req.url,auth:req.headers.authorization});res.setHeader('content-type','application/json')
    res.end(JSON.stringify({version:1,snapshot:snapshot(),targets:[],cursor:'',latest:'1000.000001'}))
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  try {
    const origin=`http://127.0.0.1:${server.address().port}`
    const child=spawn(process.execPath,['indiecorns/bin/indiecorns.mjs','worker','setup','--check','--json','--app-url',origin,'--no-telemetry'],{
      env:{...process.env,HOME:f.directory,USERPROFILE:f.directory,INDIECORNS_TOKEN:'community-secret',INDIECORNS_GITHUB_TOKEN:'',PATH:f.directory},stdio:['ignore','pipe','pipe']})
    let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b)
    const code=await new Promise(resolve=>child.on('close',resolve))
    assert.equal(code,1,stderr);const result=JSON.parse(stdout)
    assert.equal(result.state,'setup_required');assert.equal(calls[0].auth,'Bearer community-secret')
    assert.equal(existsSync(join(f.directory,'.indiecorns')),false)
    assert.doesNotMatch(stdout,/community-secret/)
  }finally{server.close();f.close()}
})

test('actual setup reuses its pending device authorization and returns the original resume command',async()=>{
  const f=fixture();let sessions=0,origin
  const server=createServer((req,res)=>{
    res.setHeader('content-type','application/json')
    if(req.method==='POST'&&req.url==='/api/public/cli/session') {
      sessions++
      res.end(JSON.stringify({code:'SETUP123',verification_url:`${origin}/collective?cli=SETUP123`,expires_at:'2099-01-01T00:00:00Z',poll_url:`${origin}/api/public/cli/session/SETUP123`,exchange_url:`${origin}/api/public/cli/session/SETUP123/exchange`}))
    }else if(req.url==='/api/public/cli/session/SETUP123')res.end(JSON.stringify({code:'SETUP123',status:'pending'}))
    else {res.statusCode=500;res.end('{}')}
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`
  const run=(includeMode=true)=>new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['indiecorns/bin/indiecorns.mjs','worker','setup',...(includeMode?['--mode','execute']:[]),'--app-url',origin,'--json','--no-open','--no-telemetry'],{
      env:{...process.env,HOME:f.directory,USERPROFILE:f.directory,INDIECORNS_TOKEN:'',INDIECORNS_GITHUB_TOKEN:''},stdio:['ignore','pipe','pipe']})
    let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.on('error',reject)
    child.on('close',code=>resolve({code,stdout,stderr}))
  })
  try {
    const first=await run(),second=await run(false)
    assert.equal(first.code,1,first.stderr);assert.equal(second.code,1,second.stderr)
    const a=JSON.parse(first.stdout),b=JSON.parse(second.stdout)
    assert.equal(a.status,'browser_auth_required');assert.equal(b.url,a.url);assert.equal(a.resumeCommand,b.resumeCommand)
    assert.match(a.resumeCommand,/worker setup --mode execute --app-url/);assert.equal(sessions,1)
    assert.equal(existsSync(join(f.directory,'.indiecorns','worker','service-runtime.json')),false)
  }finally{server.close();f.close()}
})

test('setup reuses a refreshed gh credential only for the same proven actor, without restarting or changing policy',async()=>{
  const f=fixture()
  try {
    await setupWorker(f.options)
    const policy=readFileSync(join(f.directory,'policy.json'),'utf8')
    storeCredential(f.directory,'github','expired-secret')
    const request=async(url,settings)=>String(url).includes('api.github.com')&&settings.headers.Authorization==='Bearer expired-secret'?
      new Response('',{status:401}):f.options.request(url,settings)
    const check=await setupWorker({...f.options,request,check:true})
    assert.equal(check.state,'setup_required');assert.equal(JSON.parse(readFileSync(join(f.directory,'credentials.json'))).github,'expired-secret')
    const renewed=await setupWorker({...f.options,request})
    assert.equal(renewed.state,'ready');assert.equal(renewed.steps.find(s=>s.id==='github').source,'github_cli_refreshed')
    assert.equal(JSON.parse(readFileSync(join(f.directory,'credentials.json'))).github,'github-secret')
    assert.equal(f.counts().installed,1);assert.equal(readFileSync(join(f.directory,'policy.json'),'utf8'),policy)
    storeCredential(f.directory,'github','expired-secret')
    const otherRequest=async(url,settings)=>String(url).includes('api.github.com')&&settings.headers.Authorization==='Bearer github-secret'?
      Response.json({id:456,login:'other'},{headers:{'x-oauth-scopes':'public_repo,user:follow'}}):request(url,settings)
    const mismatch=await setupWorker({...f.options,request:otherRequest})
    assert.equal(mismatch.state,'running_with_action_requirements');assert.equal(JSON.parse(readFileSync(join(f.directory,'credentials.json'))).github,'expired-secret')
  }finally{f.close()}
})

test('setup does not try other credentials to bypass provider throttling, or call unhealthy sources ready',async()=>{
  const f=fixture()
  try {
    await setupWorker(f.options)
    const result=await setupWorker({...f.options,run:()=>assert.fail('must honor rate limit'),request:async(url,settings)=>String(url).includes('api.github.com')?
      new Response('',{status:429,headers:{'retry-after':'600'}}):f.options.request(url,settings)})
    assert.equal(result.state,'running_with_action_requirements')
    const unhealthy=await setupWorker({...f.options,inspect:()=>({registered:true,running:true,pid:123,appUrl:f.options.appUrl,sourcesHealthy:false})})
    assert.equal(unhealthy.state,'running_with_source_requirements');assert.equal(f.counts().installed,1)
  }finally{f.close()}
})

for(const format of ['human','json','ndjson'])test(`waiting CLI setup completes device handoff and continues in the same process (${format})`,async()=>{
  const f=fixture();let origin,polls=0,feedCalls=0
  const server=createServer((req,res)=>{
    res.setHeader('content-type','application/json')
    if(req.method==='POST'&&req.url==='/api/public/cli/session')res.end(JSON.stringify({code:'WAIT123',verification_url:`${origin}/collective?cli=WAIT123`,expires_at:'2099-01-01T00:00:00Z',poll_url:`${origin}/api/public/cli/session/WAIT123`,exchange_url:`${origin}/api/public/cli/session/WAIT123/exchange`}))
    else if(req.url==='/api/public/cli/session/WAIT123') {polls++;res.end(JSON.stringify({code:'WAIT123',status:'completed',completed_at:'2026-11-03T06:00:00Z'}))}
    else if(req.url==='/api/public/cli/session/WAIT123/exchange')res.end(JSON.stringify({token:'wait-token',user_id:'11111111-1111-4111-8111-111111111111',token_expires_at:'2099-01-01T00:00:00Z'}))
    else if(req.url.startsWith('/api/public/cli/worker-feed')){feedCalls++;assert.equal(req.headers.authorization,'Bearer wait-token');res.statusCode=401;res.end('{}')}
    else {res.statusCode=404;res.end('{}')}
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`
  try {
    const child=spawn(process.execPath,['indiecorns/bin/indiecorns.mjs','worker','setup','--mode','execute','--wait',...(format==='ndjson'?['--ndjson']:format==='json'?['--json']:[]),'--timeout','10','--app-url',origin,'--no-telemetry'],{
      env:{...process.env,HOME:f.directory,USERPROFILE:f.directory,INDIECORNS_TOKEN:'',INDIECORNS_GITHUB_TOKEN:''},stdio:['ignore','pipe','pipe']})
    let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b)
    const code=await new Promise(resolve=>child.on('close',resolve))
    // Stop before native OS registration: this test proves the real auth-to-setup
    // transition; the feed intentionally refuses access after token exchange.
    assert.equal(code,1,stderr)
    if(format==='ndjson'){
      const events=stdout.trim().split('\n').map(line=>JSON.parse(line))
      assert.deepEqual(events.map(e=>e.type),['worker.setup.authorization_required','worker.setup.authenticated','worker.setup.completed'])
      assert.equal(events.at(-1).steps[0].status,'auth_required')
    }else{
      if(format==='json')assert.equal(JSON.parse(stdout).steps[0].status,'auth_required')
      else {assert.match(stdout,/INDIECORNS/);assert.match(stdout,/Indiecorns account: auth required/);assert.match(stdout,/Next step:/);assert.doesNotMatch(stdout,/"steps"|"version"/)}
      assert.ok(stderr.includes(`${origin}/collective?cli=WAIT123`));assert.match(stderr,/setup will continue automatically/)
      assert.match(stderr,/Signed in\. Continuing/)
    }
    assert.equal(feedCalls,1);assert.ok(polls>=1)
    assert.doesNotMatch(stdout,/wait-token/)
    const config=JSON.parse(readFileSync(join(f.directory,'.indiecorns','config.json')))
    assert.equal(config.browserSession.userId,'11111111-1111-4111-8111-111111111111');assert.equal(config.pendingCliSession,undefined)
  }finally{server.close();f.close()}
})

test('waiting setup recovers from auth-service outage without requesting login or touching live state',async()=>{
 const f=fixture();let clock=Date.now(),calls=0;const events=[];const original=f.options.request
 try {
  saveState(join(f.directory,'state.json'),{jobs:{},actions:{receipt:{status:'completed'}},actionBudget:{day:'2026-11-03',attempts:1}})
  const before=readFileSync(join(f.directory,'state.json'),'utf8')
  const result=await setupWorker({...f.options,now:()=>clock,retryForMs:180000,onProgress:e=>events.push(e),wait:async ms=>{assert.ok(ms>=60000);clock+=ms},
   request:async(url,options)=>!String(url).includes('api.github.com')&&calls++===0?new Response('',{status:503,headers:{'retry-after':'30'}}):original(url,options)})
  assert.equal(result.state,'ready');assert.equal(events.length,1);assert.equal(events[0].httpStatus,503)
  assert.equal(readFileSync(join(f.directory,'state.json'),'utf8'),before)
  assert.doesNotMatch(JSON.stringify(events),/secret|Bearer/)
 }finally{f.close()}
})
test('setup preserves provider cooldown beyond wait budget and never asks for login on an outage',async()=>{
 const f=fixture();let calls=0
 try {
  const result=await setupWorker({...f.options,retryForMs:180000,request:async()=>{calls++;return new Response('',{status:503,headers:{'retry-after':'600'}})},wait:async()=>assert.fail('must not wait past timeout')})
  assert.equal(result.state,'service_unavailable');assert.equal(calls,1)
  assert.equal(result.steps[0].id,'community_service');assert.ok(result.steps[0].retryAfterMs>500000)
  assert.doesNotMatch(JSON.stringify(result),/indiecorns login/);assert.equal(f.counts().installed,0)
 }finally{f.close()}
})
test('genuine denied credentials stop waiting without retry or granting access',async()=>{
 const f=fixture();let calls=0
 try {
  const result=await setupWorker({...f.options,retryForMs:180000,request:async()=>{calls++;return new Response('',{status:401})},wait:async()=>assert.fail('do not retry invalid auth')})
  assert.equal(result.state,'action_required');assert.equal(calls,1);assert.equal(result.steps[0].httpStatus,401)
  assert.equal(result.steps[0].id,'community_auth');assert.equal(f.counts().installed,0)
 }finally{f.close()}
})
