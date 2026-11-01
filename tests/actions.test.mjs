import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultPolicy, validatePolicy, runActions, githubStar } from '../indiecorns/lib/actions.mjs'
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
