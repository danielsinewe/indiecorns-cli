import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,readFileSync,readdirSync,writeFileSync,rmSync,truncateSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {spawnSync} from 'node:child_process'
import {configureStorageBudget,directoryBytes,storageSettings,workerStorageLimit} from '../indiecorns/lib/storage.mjs'
import {saveState,workerStatus,runWorker} from '../indiecorns/lib/worker.mjs'
import {runActions} from '../indiecorns/lib/actions.mjs'

const fixture=()=>{
  const directory=mkdtempSync(join(tmpdir(),'indiecorns-storage-'))
  return {directory,close:()=>rmSync(directory,{recursive:true,force:true})}
}
test('storage counts atomic replacement peak and preserves the last committed queue and receipts',()=>{
  const f=fixture(),release=configureStorageBudget(f.directory,{maximumBytes:65536,reserveBytes:4096})
  try {
    const file=join(f.directory,'state.json'),state={version:1,jobs:{pending:{status:'queued'}},actions:{original:{status:'completed'}},payload:'x'.repeat(32000)}
    saveState(file,state);const original=readFileSync(file,'utf8')
    assert.throws(()=>saveState(file,{...state,payload:'x'.repeat(48000)}),{code:'STORAGE_CAPACITY'})
    assert.equal(readFileSync(file,'utf8'),original);assert.equal(readdirSync(f.directory).some(f=>f.endsWith('.tmp')),false)
    assert.equal(workerStatus(f.directory).storage.health,'capacity_reached');assert.ok(directoryBytes(f.directory)<65536)
  }finally{release();f.close()}
})

test('cold payload writes share the state budget, and no pending data is deleted when the limit is reached',()=>{
  const f=fixture(),release=configureStorageBudget(f.directory,{maximumBytes:65536,reserveBytes:4096})
  try {
    const queue=join(f.directory,'queue','aa');mkdirSync(queue,{recursive:true})
    saveState(join(f.directory,'state.json'),{jobs:{pending:{status:'queued'}}})
    const first=join(queue,'a'.repeat(64)+'.json');saveState(first,{payload:'x'.repeat(32000)})
    const before=readFileSync(first,'utf8')
    assert.throws(()=>saveState(join(queue,'b'.repeat(64)+'.json'),{payload:'x'.repeat(32000)}),{code:'STORAGE_CAPACITY'})
    assert.equal(readFileSync(first,'utf8'),before);assert.equal(readdirSync(queue).length,1)
  }finally{release();f.close()}
})

test('storage refusal before an action intent prevents provider writes and preserves persisted quota',async()=>{
  const f=fixture()
  try {
    const binding='a'.repeat(64),file=join(f.directory,'state.json')
    const state={jobs:{job:{key:'job',priority:0,discoveredAt:1,target:{platform:'github',eventType:'inspect',profileUrl:'https://github.com/maker/project'},observation:{status:'observed',url:'https://github.com/maker/project',contentHash:'test',title:'Project'}}},actions:{},actionBudget:{day:'2026-11-02',attempts:0}}
    saveState(file,state);const original=readFileSync(file,'utf8')
    writeFileSync(join(f.directory,'space'), 'x'.repeat(58000))
    const release=configureStorageBudget(f.directory,{maximumBytes:65536,reserveBytes:4096});let writes=0
    try {
      await assert.rejects(runActions({state,accountRevision:binding,token:'secret',now:()=>Date.parse('2026-11-02T12:00:00Z'),
        policy:{version:1,mode:'execute',accountRevision:binding,maxExternalPerDay:1,githubRepositories:['maker/project']},
        actorExternal:async()=>({id:123,username:'actor'}),external:async()=>{writes++;return {verified:true}},
        checkpoint:()=>saveState(file,{...state,padding:'x'.repeat(2000)})}),{code:'STORAGE_CAPACITY'})
      assert.equal(writes,0);assert.equal(readFileSync(file,'utf8'),original)
    }finally{release()}
  }finally{f.close()}
})

test('failed replacements clean up temporary files, and malformed settings release worker ownership',async()=>{
  const f=fixture()
  try {
    const directory=join(f.directory,'state.json');mkdirSync(directory)
    assert.throws(()=>saveState(directory,{value:'test'}))
    assert.equal(readdirSync(f.directory).some(name=>name.endsWith('.tmp')),false)
    const settings=join(f.directory,'storage-settings.json');writeFileSync(settings,'{bad')
    await assert.rejects(runWorker({directory:f.directory,once:true,discover:async()=>[]}),SyntaxError)
    rmSync(settings);rmSync(directory,{recursive:true})
    assert.equal((await runWorker({directory:f.directory,once:true,discover:async()=>[]})).lastError,null)
  }finally{f.close()}
})

test('explicit disk budget changes apply without changing action quotas or losing data',async()=>{
  const f=fixture(),release=configureStorageBudget(f.directory)
  try {
    assert.equal(storageSettings(f.directory).maximumBytes,workerStorageLimit)
    saveState(join(f.directory,'storage-settings.json'),{version:1,maximumBytes:16*1024*1024})
    await Promise.resolve()
    const file=join(f.directory,'state.json');saveState(file,{pending:'x'.repeat(7*1024*1024),actions:{receipt:{status:'completed'}},actionBudget:{attempts:1}})
    assert.throws(()=>saveState(file,{pending:'x'.repeat(7*1024*1024),actionBudget:{attempts:1}}),{code:'STORAGE_CAPACITY'})
    // A storage setting is independent of policy and requires an explicit change.
    saveState(join(f.directory,'storage-settings.json'),{version:1,maximumBytes:32*1024*1024})
    saveState(file,{pending:'preserved',actions:{receipt:{status:'completed'}},actionBudget:{attempts:1}})
    assert.equal(workerStatus(f.directory).storage,null);assert.equal(workerStatus(f.directory).state.actionBudget.attempts,1)
    writeFileSync(join(f.directory,'storage-settings.json'),'{bad');assert.throws(()=>storageSettings(f.directory),SyntaxError)
  }finally{release();f.close()}
})

test('actual CLI refuses a full data directory before discovery and keeps its queue intact',()=>{
  const f=fixture()
  try {
    const directory=join(f.directory,'.indiecorns','worker');mkdirSync(directory,{recursive:true})
    const file=join(directory,'state.json');saveState(file,{version:1,jobs:{},actions:{original:{kind:'github_star',status:'completed',completedAt:1}},actionBudget:{day:'2026-11-02',attempts:1}})
    const original=readFileSync(file,'utf8'),marker=join(directory,'reserved-test-space');writeFileSync(marker,'');truncateSync(marker,workerStorageLimit)
    const result=spawnSync(process.execPath,[resolve('indiecorns/bin/indiecorns.mjs'),'worker','run','--once','--no-telemetry'],{
      env:{...process.env,HOME:f.directory,USERPROFILE:f.directory,INDIECORNS_TOKEN:'',INDIECORNS_GITHUB_TOKEN:''},encoding:'utf8',timeout:10000})
    assert.equal(result.status,1);assert.match(result.stderr,/storage capacity reached/)
    assert.equal(readFileSync(file,'utf8'),original);assert.equal(workerStatus(directory).storage.health,'capacity_reached')
  }finally{f.close()}
})
