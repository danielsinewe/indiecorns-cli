import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,rmSync,readdirSync,readFileSync,writeFileSync,appendFileSync,statSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {startHealthMonitor,readHealthReport,summarizeHealth,heartbeatMs,healthFileLimit} from '../indiecorns/lib/health.mjs'
import {runWorker,workerStatus} from '../indiecorns/lib/worker.mjs'

const base=Date.parse('2026-11-01T00:00:00Z')
const row=at=>({at,session:'test',pid:1,event:'heartbeat',phase:'cycle',progressAt:at,sleepUntil:null,
  discoveryHealthy:true,communityHealthy:true,targets:1,clockBackwards:false})
const fixture=()=>mkdtempSync(join(tmpdir(),'indiecorns-health-'))

test('a full day of samples differs from short history, a gap, a stalled operation and expected sleep',()=>{
  const records=Array.from({length:1441},(_,i)=>row(base+i*heartbeatMs)),now=base+86400000
  const full=summarizeHealth(records,{now})
  assert.equal(full.coverage,'continuous_samples')
  assert.equal(full.largestGapMs,heartbeatMs)
  assert.equal(full.progressStalls,0)
  assert.equal(full.unhealthySamples,0)
  assert.equal(summarizeHealth(records.slice(720),{now}).coverage,'insufficient_history')
  const gap=summarizeHealth(records.filter((_,i)=>i<720||i>735),{now})
  assert.equal(gap.coverage,'gaps_detected')
  assert.equal(gap.largestGapMs,17*heartbeatMs)
  const stalled=structuredClone(records);stalled.at(-1).progressAt=now-960000;stalled.at(-1).phase='observe'
  assert.equal(summarizeHealth(stalled,{now}).progressStalls,1)
  stalled.at(-1).phase='sleep';stalled.at(-1).sleepUntil=now+3600000
  assert.equal(summarizeHealth(stalled,{now}).progressStalls,0)
  stalled.at(-1).discoveryHealthy=false
  assert.equal(summarizeHealth(stalled,{now}).unhealthySamples,1)
  const githubFailure=structuredClone(records);githubFailure.at(-1).githubPostsHealthy=false
  assert.equal(summarizeHealth(githubFailure,{now}).unhealthySamples,1)
  assert.equal(summarizeHealth(githubFailure,{now}).githubPostsKnownSamples,1)
  assert.equal(summarizeHealth([...records,row(now+1000)],{now}).coverage,'invalid_history')
  assert.throws(()=>summarizeHealth(records,{hours:49}))
})

test('durable minute samples expose a restart gap without touching queued work or leaking target data',()=>{
  const directory=fixture();let clock=base,pulse
  const state={jobs:{private:{target:{profileUrl:'https://private.example/secret'}}},actions:{receipt:{status:'completed'}},
    lastSuccessAt:clock,lastError:null,communityFeed:{health:'ok',snapshot:{expiresAt:base+86400000}},secret:'credential-value'}
  const original=JSON.stringify(state)
  const options={directory,state,now:()=>clock,schedule:fn=>{pulse=fn;return {}},cancel:()=>{}}
  try {
    const first=startHealthMonitor({...options,session:'first'})
    for(let i=0;i<60;i++){clock+=heartbeatMs;state.lastSuccessAt=clock;first.progress('sleep',clock+3600000);pulse()}
    // Simulate abrupt loss: no stop callback, then a new process five minutes later.
    clock+=300000;state.lastSuccessAt=clock
    const next=startHealthMonitor({...options,session:'second'})
    const report=readHealthReport(directory,{now:clock,hours:1})
    assert.equal(report.coverage,'gaps_detected')
    assert.equal(report.largestGapMs,300000)
    assert.equal(report.sessions,2)
    assert.equal(report.latest.session,'second')
    assert.equal(report.cleanStops,0)
    next.stop();next.stop()
    assert.equal(readHealthReport(directory,{now:clock,hours:1}).cleanStops,1)
    assert.equal(readHealthReport(directory,{now:clock,hours:1}).latestState,'stopped')
    assert.equal(JSON.stringify({...state,lastSuccessAt:base}),original)
    const path=join(directory,'health',readdirSync(join(directory,'health'))[0])
    assert.doesNotMatch(readFileSync(path,'utf8'),/credential-value|private\.example|profileUrl|receipt/)
    if(process.platform!=='win32')assert.equal(statSync(path).mode&0o777,0o600)
  } finally {rmSync(directory,{recursive:true,force:true})}
})

test('rotation keeps three bounded daily files and preserves evidence of an interrupted final line',()=>{
  const directory=fixture();let clock=base,pulse,status
  const state={jobs:{},lastError:null,lastSuccessAt:clock}
  try {
    for(let day=0;day<4;day++){
      clock=base+day*86400000;state.lastSuccessAt=clock
      const monitor=startHealthMonitor({directory,state,session:'day-'+day,now:()=>clock,schedule:fn=>{pulse=fn;return {}},cancel:()=>{},onStatus:s=>{status=s}})
      pulse();monitor.stop()
    }
    const paths=readdirSync(join(directory,'health'))
    assert.deepEqual(paths.sort(),['2026-11-02.jsonl','2026-11-03.jsonl','2026-11-04.jsonl'])
    const current=join(directory,'health','2026-11-04.jsonl')
    appendFileSync(current,'{"interrupted":"hidden-secret"')
    const next=startHealthMonitor({directory,state,session:'recovery',now:()=>clock,schedule:()=>({}),cancel:()=>{}})
    const report=readHealthReport(directory,{now:clock})
    assert.equal(report.anomalies.malformedRecords,1)
    assert.equal(report.coverage,'invalid_history')
    assert.equal(report.latest.session,'recovery')
    assert.doesNotMatch(JSON.stringify(report),/hidden-secret/)
    next.stop()
    writeFileSync(current,Buffer.alloc(healthFileLimit,120))
    const full=startHealthMonitor({directory,state,session:'full',now:()=>clock,schedule:()=>({}),cancel:()=>{},onStatus:s=>{status=s}})
    assert.equal(status,'storage_unavailable')
    assert.equal(statSync(current).size,healthFileLimit)
    full.stop()
  } finally {rmSync(directory,{recursive:true,force:true})}
})

test('unavailable diagnostic storage cannot stop discovery or reset the durable queue',async()=>{
  const directory=fixture()
  try {
    writeFileSync(join(directory,'health'),'not-a-directory')
    const state=await runWorker({directory,once:true,discover:async()=>[{platform:'github',eventType:'inspect',profileUrl:'https://github.com/maker'}]})
    assert.equal(Object.keys(state.jobs).length,1)
    assert.equal(state.healthHistoryStatus,'storage_unavailable')
    assert.equal(workerStatus(directory).lock,null)
    assert.equal(readHealthReport(directory).coverage,'invalid_history')
  } finally {rmSync(directory,{recursive:true,force:true})}
})

test('an optional post source becomes unhealthy when its scheduled refresh is missed',()=>{
  const directory=fixture();let clock=base,pulse
  const state={jobs:{},lastError:null,lastSuccessAt:base,githubMemberPosts:{health:'ok',nextPollAt:base+60000}}
  try {
    const monitor=startHealthMonitor({directory,state,session:'posts',now:()=>clock,schedule:fn=>{pulse=fn;return {}},cancel:()=>{}})
    assert.equal(readHealthReport(directory,{now:clock}).latest.githubPostsHealthy,true)
    clock+=180001;pulse()
    const report=readHealthReport(directory,{now:clock})
    assert.equal(report.latest.githubPostsHealthy,false)
    assert.equal(report.githubPostsKnownSamples,2)
    assert.equal(report.unhealthySamples,1)
    monitor.stop()
  }finally{rmSync(directory,{recursive:true,force:true})}
})
