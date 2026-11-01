import test from 'node:test'
import assert from 'node:assert/strict'
import {fork} from 'node:child_process'
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

function child(directory) {
  const process=fork(new URL('./fixtures/worker-lock-child.mjs',import.meta.url),[directory],{execArgv:[],stdio:['ignore','ignore','pipe','ipc']})
  const messages=[],waiters=[]
  let error=''
  process.stderr.on('data',chunk=>{error+=chunk.toString()})
  process.on('message',message=>{messages.push(message);for(const wake of waiters.splice(0))wake()})
  const closed=new Promise(resolve=>process.once('exit',resolve))
  const message=async(predicate)=>{
    const deadline=Date.now()+15000
    while(Date.now()<deadline){
      const found=messages.find(predicate)
      if(found)return found
      if(process.exitCode!==null || process.signalCode!==null)throw new Error(`Worker exited before result: ${error}`)
      await new Promise(resolve=>{const timer=setTimeout(resolve,50);waiters.push(()=>{clearTimeout(timer);resolve()})})
    }
    throw new Error(`Timed out waiting for worker: ${error}`)
  }
  return {process,closed,message}
}
const ready=worker=>worker.message(message=>message.type==='waiting')
const result=worker=>worker.message(message=>['running','rejected'].includes(message.type))
const cleanup=async workers=>{for(const worker of workers)if(worker.process.exitCode===null && worker.process.signalCode===null)worker.process.kill('SIGKILL');await Promise.all(workers.map(worker=>worker.closed))}

test('kernel ownership survives missing PID metadata and releases automatically after a forced crash',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'indiecorns-worker-ownership-'))
  const workers=[]
  try {
    const owner=child(directory);workers.push(owner);await ready(owner);owner.process.send('start')
    assert.equal((await result(owner)).type,'running')
    const before=JSON.parse(readFileSync(join(directory,'state.json'),'utf8'))
    rmSync(join(directory,'worker.lock'))
    const contender=child(directory);workers.push(contender);await ready(contender);contender.process.send('start')
    const rejected=await result(contender)
    assert.equal(rejected.type,'rejected','a missing diagnostics file cannot admit a second worker')
    assert.match(rejected.message,/already running/)
    owner.process.kill('SIGKILL');await owner.closed
    const recovered=child(directory);workers.push(recovered);await ready(recovered);recovered.process.send('start')
    assert.equal((await result(recovered)).type,'running')
    const after=JSON.parse(readFileSync(join(directory,'state.json'),'utf8'))
    assert.deepEqual(after.actions,before.actions)
    assert.deepEqual(after.actionBudget,before.actionBudget)
  } finally {await cleanup(workers);rmSync(directory,{recursive:true})}
})

test('simultaneous stale-worker recovery admits exactly one process',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'indiecorns-worker-concurrent-'))
  const workers=[]
  try {
    writeFileSync(join(directory,'worker.lock'),JSON.stringify({pid:99999999,owner:'dead-worker'}))
    for(let index=0;index<8;index++)workers.push(child(directory))
    await Promise.all(workers.map(ready))
    for(const worker of workers)worker.process.send('start')
    const results=await Promise.all(workers.map(result))
    assert.equal(results.filter(message=>message.type==='running').length,1)
    assert.equal(results.filter(message=>message.type==='rejected').length,7)
    assert.ok(results.filter(message=>message.type==='rejected').every(message=>/already running/.test(message.message)))
  } finally {await cleanup(workers);rmSync(directory,{recursive:true})}
})
