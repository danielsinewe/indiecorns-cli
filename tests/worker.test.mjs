import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runWorker, workerStatus, targetKey } from '../indiecorns/lib/worker.mjs'
import {discoverCommunity} from '../indiecorns/lib/discovery.mjs'
const target = (path, slackMember = false) => ({ platform: 'x', eventType: 'like', profileUrl: `https://x.com/${path}`, slackMember })
const fixture = () => mkdtempSync(join(tmpdir(), 'indiecorns-worker-'))

test('persistent transport failures retry within five minutes, survive restart and recover without resetting receipts',async()=>{
  const directory=fixture();let clock=1000,calls=0,offline=true
  const options={directory,once:true,intervalMs:300000,now:()=>clock,discover:()=>discoverCommunity({appUrl:'https://app.indiecorns.com',endpoint:'/targets',headers:{},pause:async()=>{},
    request:async()=>{calls++;if(offline)throw Object.assign(new TypeError('secret-token'),{cause:{code:'ECONNRESET'}});return Response.json({targets:[]})}})}
  try {
    for(let n=0;n<30;n++){
      const failed=await runWorker(options)
      assert.equal(failed.nextPollAt-clock,300000)
      assert.equal(failed.discoveryError.kind,'transport');assert.equal(failed.discoveryError.code,'ECONNRESET');assert.deepEqual(failed.sources,[])
      const count=calls;await runWorker(options);assert.equal(calls,count)
      clock=failed.nextPollAt
    }
    const persisted=workerStatus(directory).state
    persisted.actions={original:{kind:'github_star',status:'completed',completedAt:1}};persisted.actionBudget={day:'2026-11-03',attempts:1}
    writeFileSync(join(directory,'state.json'),JSON.stringify(persisted))
    offline=false;const recovered=await runWorker(options)
    assert.equal(recovered.lastError,null);assert.equal(recovered.discoveryError,null);assert.equal(recovered.actions.original.completedAt,1);assert.equal(recovered.actionBudget.attempts,1)
    assert.equal(recovered.discoveryFailures.length,24);assert.doesNotMatch(JSON.stringify(recovered),/secret-token/)
  }finally{rmSync(directory,{recursive:true})}
})

test('server failures have bounded recovery while explicit provider retry-after remains honored',async()=>{
  const directory=fixture();let clock=1000
  try {
    const options={directory,once:true,intervalMs:300000,now:()=>clock,discover:async()=>({targets:[],partial:true,sources:[{status:'failed',httpStatus:502}]})}
    for(let n=0;n<10;n++){const s=await runWorker(options);assert.equal(s.nextPollAt-clock,300000);clock=s.nextPollAt}
    const limited=await runWorker({...options,discover:async()=>({targets:[],partial:true,sources:[{status:'rate_limited'}],retryAfterMs:7200000})})
    assert.equal(limited.nextPollAt-clock,7200000)
  }finally{rmSync(directory,{recursive:true})}
})

test('queue persists across restart, deduplicates, and prioritizes explicit Slack membership', async () => {
  const directory = fixture()
  let clock = 1000
  const options = { directory, once: true, intervalMs: 1000, now: () => clock,
    discover: async () => [target('Other'), target('Slack', true), target('Other'), target('other')] }
  try {
    const first = await runWorker(options)
    assert.equal(Object.keys(first.jobs).length, 3)
    assert.equal(first.jobs[first.pending[0]].target.slackMember, true)
    clock = 3000
    const second = await runWorker(options)
    assert.deepEqual(second.jobs, Object.fromEntries(Object.entries(first.jobs).map(([key,job])=>[key,{...job,lastDiscoveredAt:clock}])))
    assert.equal(workerStatus(directory).lock, null)
  } finally { rmSync(directory, { recursive: true }) }
})

test('failed polls persist backoff across restart and do not leak error secrets', async () => {
  const directory = fixture()
  let attempts = 0
  const options = { directory, once: true, intervalMs: 1000, now: () => 1000,
    discover: async () => { attempts++; throw new Error('secret-token') } }
  try {
    const first = await runWorker(options)
    assert.equal(first.nextPollAt, 3000)
    await runWorker(options)
    assert.equal(attempts, 1)
    assert.doesNotMatch(readFileSync(join(directory, 'state.json'), 'utf8'), /secret-token/)
  } finally { rmSync(directory, { recursive: true }) }
})

test('only one worker may own a directory', async () => {
  const directory = fixture()
  try {
    writeFileSync(join(directory, 'worker.lock'), JSON.stringify({ pid: process.pid, owner: 'other' }))
    await assert.rejects(runWorker({ directory, once: true, discover: async () => [] }), /already running/)
    assert.equal(workerStatus(directory).lock.owner, 'other')
  } finally { rmSync(directory, { recursive: true }) }
})

test('a stale SQLite-owner PID cannot block recovery after that PID is reused',async()=>{
  const directory=fixture()
  try {
    writeFileSync(join(directory,'worker.lock'),JSON.stringify({pid:process.pid,owner:'previous-instance',guard:'sqlite-v1'}))
    const state=await runWorker({directory,once:true,discover:async()=>[target('recovered')]})
    assert.equal(Object.keys(state.jobs).length,1)
    assert.equal(workerStatus(directory).lock,null)
  } finally {rmSync(directory,{recursive:true})}
})

test('corrupt state fails closed and releases worker ownership', async () => {
  const directory = fixture()
  try {
    writeFileSync(join(directory, 'state.json'), 'broken')
    await assert.rejects(runWorker({ directory, once: true, discover: async () => [] }))
    assert.equal(existsSync(join(directory, 'worker.lock')), false)
    assert.equal(readFileSync(join(directory, 'state.json'), 'utf8'), 'broken')
  } finally { rmSync(directory, { recursive: true }) }
})

test('shutdown interrupts the scheduled sleep', async () => {
  const directory = fixture()
  const controller = new AbortController()
  try {
    await runWorker({ directory, signal: controller.signal, discover: async () => [],
      onCycle: () => controller.abort() })
    assert.equal(workerStatus(directory).lock, null)
  } finally { rmSync(directory, { recursive: true }) }
})

test('new credentials bypass old authentication backoff without resetting jobs', async () => {
  const directory = fixture()
  try {
    await runWorker({ directory, once: true, now: () => 1000, authRevision: 'old',
      discover: async () => { throw Object.assign(new Error(), { code: 'AUTH_REQUIRED' }) } })
    const state = await runWorker({ directory, once: true, now: () => 1100, authRevision: 'new',
      discover: async () => [target('authenticated')] })
    assert.equal(state.lastError, null)
    assert.equal(state.pending.length, 1)
  } finally { rmSync(directory, { recursive: true }) }
})

test('observations run independently of API backoff and discovered links enter the durable queue', async () => {
  const directory = fixture()
  try {
    const options = {directory, once:true, now:()=>1000, discover:async()=>[target('maker')]}
    await runWorker(options)
    let polls=0
    const state=await runWorker({...options, discover:async()=>{polls++;return []},
      observe:async()=>({status:'observed',title:'Maker'}), deriveTargets:()=>[target('maker/status/1')]})
    assert.equal(polls,0)
    assert.equal(Object.keys(state.jobs).length,2)
    assert.equal(Object.values(state.jobs).filter(job=>job.observation?.status==='observed').length,1)
    assert.ok(Object.values(state.jobs).every(job=>job.status==='queued'))
  } finally {rmSync(directory,{recursive:true})}
})

test('server retry-after survives restart while partial results stay queued', async () => {
  const directory=fixture()
  try {
    const options={directory,once:true,now:()=>1000,intervalMs:1000,
      discover:async()=>({targets:[target('partial')],partial:true,retryAfterMs:120000,sources:[]})}
    const first=await runWorker(options)
    assert.equal(first.nextPollAt,121000)
    assert.equal(first.lastError,'partial_discovery')
    assert.equal(first.pending.length,1)
    let polls=0
    await runWorker({...options,now:()=>5000,discover:async()=>{polls++;return []}})
    assert.equal(polls,0)
  }finally{rmSync(directory,{recursive:true})}
})

test('discovery upgrades wake healthy schedules and preserve server cooldowns', async () => {
  const directory=fixture()
  try {
    let polls=0
    const options={directory,once:true,now:()=>1000,discover:async()=>{polls++;return []}}
    await runWorker(options)
    await runWorker({...options,discoveryRevision:'expanded'})
    assert.equal(polls,2)
    await runWorker({...options,now:()=>1000000,discoveryRevision:'expanded',
      discover:async()=>({targets:[],partial:true,retryAfterMs:3600000})})
    await runWorker({...options,now:()=>1000100,discoveryRevision:'newer'})
    assert.equal(polls,2)
  }finally{rmSync(directory,{recursive:true})}
})

test('broken optional priority or action configuration does not stop discovery and observation', async()=>{
  const directory=fixture()
  try{
    const state=await runWorker({directory,once:true,now:()=>1000,discover:async()=>[target('maker',true)],
      prioritize:async()=>{throw new Error('invalid configuration')},
      observe:async()=>({status:'observed',title:'Maker'}),
      act:async()=>{throw new Error('invalid policy')}})
    assert.equal(state.lastError,null)
    assert.equal(state.slackHealth,'source_unavailable')
    assert.equal(state.actionHealth,'action_configuration_failed')
    assert.equal(Object.values(state.jobs)[0].priority,2)
    assert.equal(Object.values(state.jobs)[0].observation.status,'observed')
  }finally{rmSync(directory,{recursive:true})}
})

test('discovery above 2000 targets survives restart and continues observing the durable backlog', async()=>{
  const directory=fixture()
  const targets=Array.from({length:2050},(_,index)=>target(`maker${index}`,index===2049))
  const observed=new Set()
  const observe=async item=>{
    const key=targetKey(item)
    assert.equal(observed.has(key),false,'a six-hour observation must not repeat after restart')
    observed.add(key)
    return {status:'observed',observedAt:1000,contentHash:key}
  }
  try {
    const first=await runWorker({directory,once:true,now:()=>1000,discover:async()=>targets,observe})
    assert.equal(first.lastError,null)
    assert.equal(Object.keys(first.jobs).length,2000)
    assert.equal(Object.keys(first.backlog).length,50)
    assert.ok(observed.has(targetKey(targets[2049])),'Slack member must be observed first')
    assert.equal(Object.keys(workerStatus(directory).state.backlog).length,50)
    // Reload from disk repeatedly, including rediscovery of cold jobs. Neither
    // membership changes nor rediscovery may erase observation cooldowns.
    for(let cycle=0;cycle<12;cycle++) {
      const state=await runWorker({directory,once:true,now:()=>3000+cycle*1000,intervalMs:1000,
        discover:async()=>targets,observe})
      assert.equal(Object.keys(state.jobs).length+Object.keys(state.backlog).length,2050)
      assert.ok(Object.keys(state.jobs).length<=2000)
    }
    assert.equal(observed.size,65)
  } finally {rmSync(directory,{recursive:true})}
})

test('missing cold payload fails closed and leaves the committed index and action receipts intact',async()=>{
  const directory=fixture()
  try {
    const first=await runWorker({directory,once:true,now:()=>1000,
      discover:async()=>Array.from({length:2001},(_,index)=>target(`cold${index}`))})
    const key=Object.keys(first.backlog)[0]
    first.actions={receipt:{kind:'github_star',status:'completed'}}
    // Force this cold job to be first due after restart.
    first.backlog[key].priority=-1
    writeFileSync(join(directory,'state.json'),JSON.stringify(first))
    rmSync(join(directory,'queue',key.slice(0,2),`${key}.json`))
    await assert.rejects(runWorker({directory,once:true,now:()=>1001,discover:async()=>[]}),{code:'ENOENT'})
    const after=workerStatus(directory)
    assert.equal(after.lock,null)
    assert.ok(after.state.backlog[key])
    assert.equal(after.state.actions.receipt.status,'completed')
  } finally {rmSync(directory,{recursive:true})}
})
