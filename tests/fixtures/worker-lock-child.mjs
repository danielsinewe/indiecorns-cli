import {runWorker} from '../../indiecorns/lib/worker.mjs'

const directory=process.argv[2]
const start=new Promise(resolve=>process.once('message',resolve))
process.send({type:'waiting'})
await start
try {
  await runWorker({directory,intervalMs:300000,discover:async()=>[],
    act:async(state,signal,checkpoint)=>{
      state.actions??={receipt:{kind:'test_receipt',status:'completed',completedAt:1}}
      state.actionBudget??={day:'2026-11-01',attempts:1}
      checkpoint()
    },onCycle:()=>process.send({type:'running',pid:process.pid})})
} catch(error) {
  process.send({type:'rejected',message:error.message})
  process.exitCode=1
} finally {if(process.connected)process.disconnect()}
