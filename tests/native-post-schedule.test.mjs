import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {nativeScheduleHandoff,recordNativeRun,readNativeRun} from '../indiecorns/lib/native-post-schedule.mjs'
import {discoveryStatus} from '../indiecorns/lib/post-discovery-status.mjs'
import {runScheduledDiscovery} from '../indiecorns/lib/browser-agent.mjs'
const accountRevision='a'.repeat(64),now=1800000000000

test('native schedule handoff bounds subscription use without creating a scheduler or changing browser policy',()=>{
 const plan=nativeScheduleHandoff({accountRevision,nodeExecutable:'/node',cliPath:'/cli.mjs',appUrl:'https://app.indiecorns.com'})
 assert.equal(plan.intervalMinutes,60);assert.equal(plan.maximumChecksPerRun,2)
 assert.equal(plan.costs.maximumScheduledRunsPerDay,24);assert.equal(plan.costs.usesHostSubscription,true)
 assert.match(plan.hostAction,/native automation tool/)
 assert.match(plan.prompt,/Never switch to local Chrome/)
 assert.equal(plan.continuousSignedInCoverage,false)
 assert.throws(()=>nativeScheduleHandoff({accountRevision,intervalMinutes:1}))
 assert.throws(()=>nativeScheduleHandoff({accountRevision:null}))
 assert.equal('rrule' in plan,false)
})
test('scheduled observations are account-bound, merge into source status, and idle runs never refresh observations',()=>{
 const directory=mkdtempSync(join(tmpdir(),'indiecorns-native-posts-'))
 try {
  const body={automationId:'indiecorns-member-post-discovery',checkedAt:now,results:[
   {platform:'linkedin',state:'observed',observedAt:now-1000,posts:2,inserted:2},
   {platform:'x',state:'auth_required',observedAt:now,posts:0,inserted:0}]}
  recordNativeRun({directory,accountRevision,body,now})
  const status=discoveryStatus({directory,state:{postDiscovery:{health:'blocked',sources:{linkedin:{status:'blocked',observedAt:now-2000}}}},accountRevision,now})
  assert.equal(status.sources.linkedin.status,'observed');assert.equal(status.sources.x.status,'auth_required')
  assert.equal(status.nativeSchedule.fresh,true)
  assert.equal(readNativeRun(directory,'b'.repeat(64)),null)
  recordNativeRun({directory,accountRevision,body:{...body,checkedAt:now+10000,results:[{platform:'linkedin',state:'idle'}]},now:now+10000})
  assert.equal(readNativeRun(directory,accountRevision).sources.linkedin.observedAt,now-1000)
  for(const patch of [{automationId:'../escape'},{checkedAt:now-700000},{results:[{platform:'linkedin',state:'observed',posts:1}]},
   {results:[{platform:'linkedin',state:'idle'},{platform:'linkedin',state:'idle'}]}])assert.throws(()=>recordNativeRun({directory,accountRevision,body:{...body,...patch},now}))
 }finally{rmSync(directory,{recursive:true,force:true})}
})
test('native scheduled batch claims at most one task per platform and records the actual bounded result',async()=>{
 const calls=[]
 const result=await runScheduledDiscovery({automationId:'schedule-1',now:()=>now,
  execute:async(_connection,args,input)=>{calls.push({args,input});return args[0]==='claim'?{version:1,task:null,retryAfterMs:300000}:{recorded:true}}})
 assert.deepEqual(calls.map(c=>c.args[0]),['claim','claim','record-run'])
 assert.deepEqual(calls.slice(0,2).map(c=>c.args.at(-1)),['linkedin','x'])
 assert.equal(calls[2].input.checkedAt,now)
 assert.equal(calls[2].input.results.every(r=>r.state==='idle'),true)
 assert.equal(result.continuousSignedInCoverage,false)
})
