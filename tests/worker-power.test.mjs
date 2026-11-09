import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {EventEmitter} from 'node:events'
import {managePower,powerPlan,powerDefinition,powerStatus,supervisePower} from '../indiecorns/lib/worker-power.mjs'

function fixture(t) {
  const home=mkdtempSync(join(tmpdir(),'indiecorns-idle-power-')),directory=join(home,'.indiecorns','worker')
  mkdirSync(directory,{recursive:true});t.after(()=>rmSync(home,{recursive:true,force:true}))
  const runtime={node:'/trusted/node',cli:'/member/cli.mjs'}
  writeFileSync(join(directory,'service-runtime.json'),JSON.stringify(runtime))
  writeFileSync(join(directory,'worker.lock'),JSON.stringify({pid:123,guard:'sqlite-v1',owner:'worker-session'}))
  const calls=[]
  const run=(command,args)=>{calls.push([command,args]);return {status:0,stdout:command==='/bin/ps'?(args.includes('uid=')?'501':'/trusted/node /member/cli.mjs worker run --no-telemetry'):command==='/usr/bin/pmset'?"Now drawing from 'AC Power'":''}}
  return {home,directory,system:'darwin',uid:501,run,calls,now:1000000}
}
test('default setup, unsupported platforms and closed-lid plans do not activate anything',t=>{
  const options=fixture(t)
  assert.equal(managePower('setup',options).state,'opt_in_required')
  assert.equal(options.calls.length,0)
  assert.equal(existsSync(join(options.directory,'power-config.json')),false)
  assert.equal(powerPlan({mode:'closed-lid'}).requiresAdmin,true)
  assert.equal(powerPlan({system:'linux'}).supported,false)
  assert.throws(()=>powerPlan({minutes:121}),/minutes/)
})
test('explicit idle setup registers a separate helper without restarting the worker; disable and uninstall are scoped',t=>{
  const options=fixture(t)
  assert.throws(()=>managePower('setup',{...options,enable:true}),/opt-in/)
  const result=managePower('setup',{...options,minutes:1,enable:true,acceptPowerImpact:true})
  assert.equal(result.state,'configured')
  assert.equal(powerStatus(options).state,'not_running')
  assert.throws(()=>managePower('setup',{...options,enable:true,acceptPowerImpact:true}),/previous power session/)
  const agent=join(options.home,'Library','LaunchAgents','com.indiecorns.worker.awake.plist')
  assert.doesNotMatch(readFileSync(agent,'utf8'),/KeepAlive/)
  assert.equal(managePower('disable',options).state,'disabled')
  assert.equal(powerStatus(options).state,'disabled')
  assert.equal(managePower('uninstall',options).uninstalled,true)
  assert.equal(existsSync(agent),false)
  assert.ok(options.calls.every(([cmd,args])=>cmd!=='/bin/launchctl'||!args.some(s=>s==='gui/501/com.indiecorns.worker')))
})
test('supervisor applies only the remaining finite timeout and releases on worker replacement',async t=>{
  const options=fixture(t)
  managePower('setup',{...options,minutes:1,enable:true,acceptPowerImpact:true})
  const child=new EventEmitter();child.pid=456
  let killed=false,clock=options.now+30000
  child.kill=signal=>{assert.equal(signal,'SIGTERM');killed=true;child.emit('exit',0)}
  const result=await supervisePower({...options,now:()=>clock,
    start:(command,args,spawnOptions)=>{
      assert.equal(command,'/usr/bin/caffeinate');assert.deepEqual(args,['-s','-t','30','-w','123']);assert.equal(spawnOptions.shell,false)
      queueMicrotask(()=>child.emit('spawn'));return child
    },
    wait:async()=>writeFileSync(join(options.directory,'worker.lock'),JSON.stringify({pid:123,guard:'sqlite-v1',owner:'reused-pid'})),
  })
  assert.equal(result.state,'released');assert.equal(killed,true)
  const state=JSON.parse(readFileSync(join(options.directory,'power-status.json')))
  assert.equal(state.state,'released')
  let started=false
  await supervisePower({...options,now:()=>options.now+61000,start:()=>{started=true}})
  assert.equal(started,false)
})
test('property lists escape paths and a failed stop cannot report successful disable',t=>{
  assert.match(powerDefinition({home:'/user',node:'/node',helper:'/a & b/helper',directory:'/worker'}),/a &amp; b/)
  const options=fixture(t)
  assert.throws(()=>managePower('disable',{...options,run:(command,args)=>({status:args[0]==='bootout'?1:0})}),/could not be verified/)
})
