import test from 'node:test'
import assert from 'node:assert/strict'
import {createPowerController,createSystemPowerIO,parseSleepDisabled,validatePowerRequest,runPowerWatchdog} from '../indiecorns/lib/closed-lid-helper.mjs'

const nonce='12345678-1234-1234-1234-123456789abc'
const another='abcdefab-1234-1234-1234-123456789abc'
const copy=x=>x===null?null:structuredClone(x)
function harness({setting=0,journal=null}={}) {
  const state={setting,journal,now:1000000,mono:10,ac:true,worker:true,events:[],status:null,failRestore:false}
  const io={
    readJournal:()=>copy(state.journal),
    writeJournal:value=>{state.events.push(['journal',value.phase]);state.journal=copy(value)},
    writeStatus:value=>{state.status=value},readSetting:()=>state.setting,
    writeSetting:value=>{state.events.push(['setting',value]);if(value===0&&state.failRestore)throw new Error('mock restore failure');state.setting=value},
    onAC:()=>state.ac,workerMatches:()=>state.worker,
  }
  const controller=()=>createPowerController({io,clock:{now:()=>state.now,monotonic:()=>state.mono}})
  const core=controller();core.recover()
  const request=(patch={})=>({version:1,op:'enable',nonce,at:state.now,minutes:1,pid:123,startedAt:'Mon Nov  9 12:30:00 2026',acceptSystemWide:true,...patch})
  return {state,core,request,controller}
}

test('a bounded opt-in journals the actual baseline before setting, expires at its deadline and restores it',()=>{
  const {core,state,request}=harness()
  assert.equal(core.request(request()).state,'active')
  assert.deepEqual(state.events.slice(-3),[['journal','prepared'],['setting',1],['journal','active']])
  assert.equal(state.journal.original,0)
  state.now+=60000;state.mono+=60000
  assert.deepEqual(core.tick(),{state:'disabled',reason:'expired'})
  assert.equal(state.setting,0)
  assert.equal(state.status.closedLidVerified,false)
})

test('strict protocol rejects arbitrary commands, missing opt-in, stale requests and unbounded times',()=>{
  const {request,state}=harness()
  for(const patch of [{command:'sh'},{minutes:0},{minutes:121},{minutes:Infinity},{minutes:'60'},{acceptSystemWide:false},{at:state.now-30001},{at:state.now+5001},{pid:1},{nonce:'bad'},{op:'shell'}])
    assert.throws(()=>validatePowerRequest(request(patch),state.now))
})

test('duplicate or concurrent enable never renews the active lease',()=>{
  const {core,state,request}=harness()
  core.request(request());const deadline=state.journal.expiresAt
  assert.equal(core.request(request()).state,'duplicate_request')
  assert.throws(()=>core.request(request({nonce:another})),/already_active/)
  assert.equal(state.journal.expiresAt,deadline)
  assert.equal(state.events.filter(e=>e[0]==='setting').length,1)
})

test('existing or unknown settings, battery and mismatched workers are refused without mutation',()=>{
  for(const patch of [{setting:1},{setting:null},{ac:false},{worker:false}]) {
    const {core,state,request}=harness();Object.assign(state,patch)
    assert.throws(()=>core.request(request()))
    assert.equal(state.events.filter(e=>e[0]==='setting').length,0)
  }
})

test('worker replacement, AC loss, clock rollback and monotonic expiry fail closed',()=>{
  for(const [patch,reason] of [[{worker:false},'worker_stopped_or_replaced'],[{ac:false},'ac_disconnected'],[{now:999999},'expired'],[{mono:60010},'expired']]) {
    const {core,state,request}=harness();core.request(request());Object.assign(state,patch)
    assert.equal(core.tick().reason,reason);assert.equal(state.setting,0)
  }
})

test('an external setting change is preserved instead of being overwritten',()=>{
  const {core,state,request}=harness();core.request(request());state.setting=0
  assert.equal(core.tick().reason,'setting_changed_externally')
  assert.deepEqual(state.events.filter(e=>e[0]==='setting'),[['setting',1]])
})

test('restarts recover prepared and active journals, including a crash immediately after the write',()=>{
  for(const phase of ['prepared','active','restore_failed'])for(const setting of [0,1]) {
    const journal={version:1,phase,lastNonce:nonce,original:0,applied:1,pid:123,createdAt:1,expiresAt:2}
    const {state}=harness({journal,setting})
    assert.equal(state.setting,0);assert.equal(state.journal.phase,'idle')
    assert.equal(state.journal.lastNonce,nonce)
  }
})

test('failed restore retains the journal and watchdog retries; uninstall cannot erase recovery evidence',()=>{
  const {core,state,request,controller}=harness();core.request(request());state.failRestore=true
  assert.throws(()=>core.request(request({op:'uninstall',nonce:another,minutes:undefined,pid:undefined,startedAt:undefined,acceptSystemWide:undefined})))
  // Use the strict stop shape (undefined extra keys are intentionally rejected).
  assert.throws(()=>core.request({version:1,op:'uninstall',nonce:another,at:state.now}),/restore failure/)
  assert.equal(state.journal.phase,'restore_failed');assert.equal(state.status.state,'restore_failed')
  assert.throws(()=>controller().recover(),/restore failure/)
  state.failRestore=false
  core.tick();assert.equal(state.setting,0);assert.equal(state.journal.phase,'idle')
})

test('stop and uninstall restore before an acknowledged ready receipt; idle status stays fresh',()=>{
  const {core,state,request}=harness();core.request(request())
  core.request({version:1,op:'uninstall',nonce:another,at:state.now})
  assert.equal(state.setting,0);assert.equal(state.status.uninstallReady,true)
  state.now+=20000;core.tick()
  assert.equal(state.status.at,state.now);assert.equal(state.status.uninstallReady,true)
})

test('corrupt restore ownership is not silently reset or guessed',()=>{
  assert.throws(()=>harness({journal:{version:1,phase:'active',original:1,applied:1,lastNonce:nonce}}),/invalid_restore_journal/)
  assert.throws(()=>harness({journal:{version:99,phase:'idle',lastNonce:null}}),/invalid_restore_journal/)
  assert.throws(()=>parseSleepDisabled('SleepDisabled unknown'),/unknown/)
  assert.throws(()=>parseSleepDisabled('SleepDisabled 0\nSleepDisabled 1'),/unknown/)
})

test('OS adapter only issues two fixed privileged writes and verifies uid, start time and exact worker binding',()=>{
  const calls=[];let ps='501 Mon Nov  9 12:30:00 2026 /node /member/cli.mjs worker run --no-telemetry\n'
  const run=(command,args)=>{calls.push([command,args]);return {status:0,stdout:command==='/bin/ps'?ps:args[1]==='batt'?"Now drawing from 'AC Power'":'System-wide power settings:\n SleepDisabled 0\n'}}
  const io=createSystemPowerIO({run,config:{uid:501,node:'/node',cli:'/member/cli.mjs'}})
  assert.equal(io.readSetting(),0);assert.equal(io.onAC(),true)
  assert.equal(io.workerMatches(123,'Mon Nov  9 12:30:00 2026'),true)
  for(const wrong of [ps.replace('501','502'),ps.replace('12:30:00','12:30:01'),ps.replace('worker run','worker runner')]) {
    const original=ps;ps=wrong;assert.equal(io.workerMatches(123,'Mon Nov  9 12:30:00 2026'),false);ps=original
  }
  io.writeSetting(1);io.writeSetting(0);assert.throws(()=>io.writeSetting('1'))
  assert.deepEqual(calls.filter(c=>c[1][0]==='-a'),[['/usr/bin/pmset',['-a','disablesleep','1']],['/usr/bin/pmset',['-a','disablesleep','0']]])
})

test('watchdog performs bounded checks, retries a failure and stops without a polling loop escaping its lifetime',async()=>{
  let ticks=0,waits=0,requests=0,errors=0
  await runPowerWatchdog({controller:{tick(){ticks++;if(ticks===1)throw new Error('mock')},request(){requests++;throw new Error('mock')}},
    readRequest:()=>({}),onRequestError:()=>errors++,wait:async ms=>{assert.equal(ms,1000);waits++},shouldStop:()=>waits===3})
  assert.equal(ticks,3);assert.equal(requests,3);assert.equal(errors,3)
})
