import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {spawnSync} from 'node:child_process'

test('power plans stay machine-readable and false-valued flags never become opt-in',t=>{
  const home=mkdtempSync(join(tmpdir(),'indiecorns-power-cli-'));t.after(()=>rmSync(home,{recursive:true,force:true}))
  const invoke=args=>spawnSync(process.execPath,['indiecorns/bin/indiecorns.mjs','worker','power','setup',...args,'--no-telemetry'],{
    encoding:'utf8',env:{...process.env,HOME:home,USERPROFILE:home,INDIECORNS_TOKEN:'',INDIECORNS_TELEMETRY_DISABLED:'1'}})
  for(const format of ['--json','--ndjson','--agent']) {
    const result=invoke([format]);assert.equal(result.status,0,result.stderr)
    const plan=JSON.parse(result.stdout);assert.equal(plan.requiresOptIn,true);assert.equal(plan.systemWideSettingsChanged,false)
    assert.doesNotMatch(result.stdout,/\x1b/)
  }
  for(const flags of [['--enable=false','--accept-power-impact'],['--enable','--accept-power-impact=false']]) {
    const result=invoke(flags);assert.equal(result.status,1);assert.match(result.stderr,/explicit opt-in flag/)
  }
  assert.equal(existsSync(join(home,'.indiecorns','worker','power-config.json')),false)
  assert.equal(existsSync(join(home,'Library','LaunchAgents','com.indiecorns.worker.awake.plist')),false)
})
