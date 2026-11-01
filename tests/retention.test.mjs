import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { retainWorkerState } from '../indiecorns/lib/retention.mjs'
import { attachBacklog, compactJobs, collectBacklogGarbage, restoreJob } from '../indiecorns/lib/backlog.mjs'
import { saveState, runWorker } from '../indiecorns/lib/worker.mjs'
import { runActions } from '../indiecorns/lib/actions.mjs'
const DAY=86400000
const job=(key,extra={})=>({key,target:{profileUrl:`https://example.com/${key}`},priority:1,status:'queued',
  discoveredAt:1,observation:{status:'observed'},...extra})

test('retention retires inactive observed targets but preserves pending work, retries, receipts and budgets',()=>{
  const state={jobs:{old:job('old'),fresh:job('fresh',{lastDiscoveredAt:30*DAY}),
    pending:job('pending',{observation:undefined}),retry:job('retry'),unknown:job('unknown',{discoveredAt:undefined})},
    backlog:{cold:{key:'cold',discoveredAt:1,observed:true},waiting:{key:'waiting',discoveredAt:1}},
    actions:{remote:{kind:'github_star',jobKey:'old',status:'completed',completedAt:1},
      retry:{kind:'github_star',jobKey:'retry',status:'unverified',retryAt:99*DAY},
      oldBrief:{kind:'support_brief',jobKey:'old',completedAt:1},
      activeBrief:{kind:'support_brief',jobKey:'fresh',completedAt:1}},
    actionBudget:{day:'2026-11-01',attempts:1},hosts:{old:{robots:{expiresAt:1},nextRequestAt:1},
      delayed:{robots:{expiresAt:1},nextRequestAt:40*DAY},fresh:{robots:{expiresAt:40*DAY}}}}
  const receipts=structuredClone(state.actions.remote),budget=structuredClone(state.actionBudget)
  assert.equal(retainWorkerState(state,31*DAY),true)
  assert.deepEqual(Object.keys(state.jobs).sort(),['fresh','pending','retry','unknown'])
  assert.deepEqual(Object.keys(state.backlog),['waiting'])
  assert.equal(state.actions.oldBrief,undefined)
  assert.ok(state.actions.activeBrief)
  assert.deepEqual(state.actions.remote,receipts)
  assert.deepEqual(state.actionBudget,budget)
  assert.deepEqual(Object.keys(state.hosts).sort(),['delayed','fresh'])
  assert.equal(state.retention.retired,2)
  assert.equal(retainWorkerState(state,31*DAY+1),false)
})

test('retention waits for a committed state before deleting cold payloads and preserves live backlog files',()=>{
  const directory=mkdtempSync(join(tmpdir(),'indiecorns-retention-'))
  const a='a'.repeat(64),b='b'.repeat(64),c='c'.repeat(64)
  const path=join(directory,'state.json')
  try {
    const state={jobs:{[a]:job(a,{priority:0,lastDiscoveredAt:31*DAY}),
      [b]:job(b),[c]:job(c,{priority:2,observation:undefined})},actions:{}}
    attachBacklog(state,directory,saveState)
    compactJobs(state,1)
    saveState(path,state)
    const coldPath=key=>join(directory,'queue',key.slice(0,2),`${key}.json`)
    retainWorkerState(state,31*DAY)
    // A crash before committing retirement leaves the old checkpoint usable.
    const recovered=JSON.parse(readFileSync(path,'utf8'))
    attachBacklog(recovered,directory,saveState)
    restoreJob(recovered,b)
    assert.equal(recovered.jobs[b].observation.status,'observed')
    assert.ok(existsSync(coldPath(b)))
    // Commit retirement, then collect. The still-pending cold job survives.
    saveState(path,state)
    assert.equal(collectBacklogGarbage(state),1)
    assert.equal(existsSync(coldPath(b)),false)
    assert.equal(existsSync(coldPath(c)),true)
    const after=JSON.parse(readFileSync(path,'utf8'))
    attachBacklog(after,directory,saveState)
    restoreJob(after,c)
    assert.equal(after.jobs[c].status,'queued')
  } finally {rmSync(directory,{recursive:true})}
})

test('rediscovery after target retirement cannot replay a completed external action',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'indiecorns-retention-action-'))
  let clock=1000,writes=0
  const target={platform:'github',eventType:'inspect',profileUrl:'https://github.com/maker/project'}
  const options={directory,once:true,intervalMs:1000,now:()=>clock,
    observe:async()=>({status:'observed',url:target.profileUrl,contentHash:'same',observedAt:clock}),
    act:(state,signal,checkpoint)=>runActions({state,signal,checkpoint,now:()=>clock,token:'test',
      policy:{version:1,mode:'execute',maxExternalPerDay:1,githubRepositories:['maker/project']},
      external:async repository=>{writes++;return {kind:'github_star',repository,verified:true}}})}
  try {
    const first=await runWorker({...options,discover:async()=>[target]})
    const receipt=Object.values(first.actions).find(action=>action.kind==='github_star')
    clock=31*DAY
    const retired=await runWorker({...options,discover:async()=>[]})
    assert.equal(Object.keys(retired.jobs).length,0)
    assert.equal(Object.keys(retired.actions).length,1)
    clock=32*DAY
    const rediscovered=await runWorker({...options,discover:async()=>[target]})
    assert.equal(Object.keys(rediscovered.jobs).length,1)
    assert.equal(writes,1)
    assert.deepEqual(Object.values(rediscovered.actions).find(action=>action.kind==='github_star'),receipt)
    assert.equal(rediscovered.actionBudget.attempts,1)
  } finally {rmSync(directory,{recursive:true})}
})
