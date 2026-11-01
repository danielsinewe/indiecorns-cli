import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultPolicy, validatePolicy, runActions, githubStar, githubFollow, githubUser } from '../indiecorns/lib/actions.mjs'
const state = () => ({jobs:{sample:{key:'sample',priority:1,discoveredAt:1000,
  target:{platform:'github',eventType:'star',profileUrl:'https://github.com/maker/project'},
  observation:{status:'observed',url:'https://github.com/maker/project',title:'Project',description:'Observed details',observedAt:1000,contentHash:'abc'}}}})

test('default action creates a reusable evidence brief without external writes', async () => {
  const s=state();let writes=0
  const options={state:s,external:async()=>{writes++},now:()=>1000}
  await runActions(options);await runActions(options)
  assert.equal(Object.keys(s.actions).length,1)
  assert.equal(writes,0)
  assert.equal(Object.values(s.actions)[0].proof.externallyPublished,false)
  assert.equal(s.jobs.sample.status,undefined)
})

test('external actions require execute mode, an exact allowlist and credentials', async () => {
  for (const policy of [defaultPolicy,{...defaultPolicy,mode:'execute'}, {...defaultPolicy,mode:'execute',githubRepositories:['other/project']}]) {
    let writes=0
    await runActions({state:state(),policy,token:'test',external:async()=>{writes++}})
    assert.equal(writes,0)
  }
  const s=state()
  await runActions({state:s,policy:{...defaultPolicy,mode:'execute',githubRepositories:['maker/project']},token:''})
  assert.equal(s.actionHealth,'github_credential_required')
})

test('intent and quota persist before external execution; verified actions are never replayed', async () => {
  const s=state();let writes=0;let saved=false
  const options={state:s,policy:{...defaultPolicy,mode:'execute',githubRepositories:['maker/project']},token:'test',now:()=>1000,
    checkpoint:()=>{saved=Object.values(s.actions).some(action=>action.status==='executing') || saved},
    external:async repository=>{assert.equal(saved,true);assert.equal(s.actionBudget.attempts,1);writes++;return {kind:'github_star',repository,verified:true}}}
  await runActions(options);await runActions({...options,state:JSON.parse(JSON.stringify(s))})
  assert.equal(writes,1)
  assert.equal(Object.values(s.actions).filter(action=>action.kind==='github_star')[0].status,'completed')
})

test('failed proof remains unverified and daily action quota limits retries', async () => {
  const s=state();let writes=0
  const options={state:s,policy:{...defaultPolicy,mode:'execute',maxExternalPerDay:1,githubRepositories:['maker/project']},token:'test',now:()=>1000,
    external:async()=>{writes++;return {verified:false}}}
  await runActions(options)
  await runActions({...options,now:()=>7200000})
  assert.equal(writes,1)
  assert.equal(Object.values(s.actions).filter(action=>action.kind==='github_star')[0].status,'unverified')
})

test('GitHub adapter verifies state before and after mutation, and reconciles a crash without rewriting', async () => {
  const methods=[]
  const proof=await githubStar('maker/project',{token:'secret',request:async(url,options)=>{
    assert.equal(url,'https://api.github.com/user/starred/maker/project')
    assert.equal(options.redirect,'error')
    methods.push(options.method)
    return new Response(null,{status:methods.length===1?404:204})
  }})
  assert.deepEqual(methods,['GET','PUT','GET'])
  assert.equal(proof.verified,true)
  const requests=[]
  const recovered=await githubStar('maker/project',{token:'secret',request:async(url,options)=>{requests.push(options.method);return new Response(null,{status:204})}})
  assert.deepEqual(requests,['GET'])
  assert.equal(recovered.alreadyPresent,true)
})

test('invalid policies and unavailable page evidence cannot authorize actions', async () => {
  assert.throws(()=>validatePolicy({...defaultPolicy,githubRepositories:['maker/../project']}))
  assert.throws(()=>validatePolicy({...defaultPolicy,maxExternalPerDay:1000}))
  const s=state();s.jobs.sample.observation.status='robots_denied'
  await runActions({state:s})
  assert.equal(Object.keys(s.actions).length,0)
})

test('provider rate limits pause all external actions without claiming success',async()=>{
  await assert.rejects(githubStar('maker/project',{token:'secret',request:async()=>new Response(null,{status:429,headers:{'retry-after':'7200'}})}),e=>e.retryAfterMs===7200000)
  const s=state()
  await runActions({state:s,token:'secret',now:()=>1000,policy:{...defaultPolicy,mode:'execute',githubRepositories:['maker/project']},
    external:async()=>{throw Object.assign(new Error(),{retryAfterMs:7200000})}})
  assert.equal(s.externalNextAttemptAt,7201000)
  assert.equal(Object.values(s.actions).filter(a=>a.kind==='github_star')[0].status,'unverified')
})

test('changing community accounts cannot reuse another account’s execution policy',async()=>{
  let writes=0
  const s=state()
  await runActions({state:s,token:'secret',accountRevision:'b'.repeat(64),policy:{...defaultPolicy,mode:'execute',accountRevision:'a'.repeat(64),githubRepositories:['maker/project']},external:async()=>{writes++}})
  assert.equal(writes,0)
  assert.equal(s.actionHealth,'account_policy_mismatch')
})

const profileState=()=>({jobs:{member:{key:'member',priority:0,discoveredAt:1000,
  target:{platform:'github',eventType:'inspect',profileUrl:'https://github.com/Maker'},
  observation:{status:'observed',url:'https://github.com/Maker',contentHash:'profile',observedAt:1000}}}})

test('GitHub follow requires an exact profile allowlist and rejects non-profile URLs',async()=>{
  const target=profileState().jobs.member.target
  assert.equal(githubUser(target),'maker')
  for(const url of ['https://github.com/maker/project','https://github.com/maker?tab=repositories',
    'https://github.com/maker#readme','https://github.com/%6daker','https://github.com.evil.example/maker','https://user@github.com/maker']) {
    assert.equal(githubUser({...target,profileUrl:url}),null)
  }
  assert.equal(githubUser({...target,eventType:'star'}),null)
  for(const users of [['maker/project'],['../maker'],['bad--name'],['-maker'],['maker-'],'maker']) {
    assert.throws(()=>validatePolicy({...defaultPolicy,githubUsers:users}))
  }
  assert.deepEqual(validatePolicy({...defaultPolicy,githubUsers:['Maker']}).githubUsers,['maker'])
  let calls=0
  for(const policy of [defaultPolicy,{...defaultPolicy,mode:'execute'},{...defaultPolicy,mode:'execute',githubUsers:['other']}]) {
    await runActions({state:profileState(),policy,token:'secret',followExternal:async()=>{calls++}})
  }
  assert.equal(calls,0)
  const oldPolicy={version:1,mode:'execute',maxExternalPerDay:5,githubRepositories:[]}
  await runActions({state:profileState(),policy:oldPolicy,token:'secret',followExternal:async()=>{calls++}})
  assert.equal(calls,0)
})

test('GitHub follow checks remote state before and after PUT and reconciles an existing follow without writing',async()=>{
  const methods=[]
  const proof=await githubFollow('maker',{token:'secret',request:async(url,options)=>{
    assert.equal(url,'https://api.github.com/user/following/maker')
    assert.equal(options.redirect,'error')
    if(options.method==='PUT')assert.equal(options.headers['Content-Length'],'0')
    methods.push(options.method)
    return new Response(null,{status:methods.length===1?404:204})
  }})
  assert.deepEqual(methods,['GET','PUT','GET'])
  assert.deepEqual(proof,{kind:'github_follow',username:'maker',verified:true,alreadyPresent:false})
  let reads=0
  const existing=await githubFollow('maker',{token:'secret',request:async(_,options)=>{assert.equal(options.method,'GET');reads++;return new Response(null,{status:204})}})
  assert.equal(reads,1)
  assert.equal(existing.alreadyPresent,true)
})

test('follows and stars share quota and Slack priority, with follow receipts surviving restart',async()=>{
  const s=profileState();s.jobs.repository={...state().jobs.sample,priority:2}
  s.jobs.memberAgain={...structuredClone(s.jobs.member),key:'member-again',target:{...s.jobs.member.target,eventType:'follow'}}
  const calls=[]
  const options={state:s,token:'secret',now:()=>1000,policy:{...defaultPolicy,mode:'execute',maxExternalPerDay:1,
    githubUsers:['maker'],githubRepositories:['maker/project']},
    followExternal:async username=>{
      assert.equal(s.actionBudget.attempts,1)
      assert.ok(Object.values(s.actions).some(a=>a.kind==='github_follow'&&a.status==='executing'))
      calls.push('follow');return {kind:'github_follow',username,verified:true}
    },external:async repository=>{calls.push('star');return {kind:'github_star',repository,verified:true}}}
  await runActions(options)
  assert.deepEqual(calls,['follow'])
  const recovered=JSON.parse(JSON.stringify(s))
  await runActions({...options,state:recovered})
  assert.deepEqual(calls,['follow'])
  await runActions({...options,state:recovered,now:()=>86401000})
  assert.deepEqual(calls,['follow','star'])
  assert.equal(Object.values(recovered.actions).filter(a=>a.kind==='github_follow').length,1)
})

test('interrupted follow completion rechecks remote proof instead of sending another PUT',async()=>{
  const s=profileState();let followed=false,writes=0,interrupt=true
  const options={state:s,token:'secret',now:()=>1000,policy:{...defaultPolicy,mode:'execute',githubUsers:['maker']},
    followExternal:async username=>{
      const proof=await githubFollow(username,{token:'secret',request:async(_,options)=>{
        if(options.method==='PUT'){followed=true;writes++;return new Response(null,{status:204})}
        return new Response(null,{status:followed?204:404})
      }})
      if(interrupt){interrupt=false;throw new Error('Process lost before receipt commit')}
      return proof
    }}
  await runActions(options)
  assert.equal(Object.values(s.actions).find(a=>a.kind==='github_follow').status,'unverified')
  const recovered=JSON.parse(JSON.stringify(s))
  await runActions({...options,state:recovered,now:()=>7201000})
  const receipt=Object.values(recovered.actions).find(a=>a.kind==='github_follow')
  assert.equal(writes,1)
  assert.equal(receipt.status,'completed')
  assert.equal(receipt.proof.alreadyPresent,true)
})

test('missing follow permissions and provider cooldowns are persisted without success claims',async()=>{
  for(const status of [401,403]) {
    const s=profileState()
    await runActions({state:s,token:'secret',now:()=>1000,policy:{...defaultPolicy,mode:'execute',githubUsers:['maker']},
      followExternal:username=>githubFollow(username,{token:'secret',request:async()=>new Response(null,{status})})})
    assert.equal(s.actionHealth,'github_permission_required')
    assert.equal(Object.values(s.actions).find(a=>a.kind==='github_follow').status,'unverified')
  }
  await assert.rejects(githubFollow('maker',{token:'secret',request:async()=>new Response(null,{status:429,headers:{'retry-after':'900'}})}),e=>e.retryAfterMs===900000)
  await assert.rejects(githubFollow('maker',{token:'secret',now:()=>1000000,
    request:async()=>new Response(null,{status:403,headers:{'x-ratelimit-remaining':'0','x-ratelimit-reset':'1900'}})}),e=>e.retryAfterMs===900000 && e.code!=='GITHUB_PERMISSION_REQUIRED')
})
