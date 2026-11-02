import {readdirSync,lstatSync,writeFileSync,renameSync,rmSync,readFileSync,statfsSync} from 'node:fs'
import {join,resolve,sep} from 'node:path'
import {randomUUID} from 'node:crypto'

export const workerStorageLimit=128*1024*1024
const controlReserve=4*1024*1024
const budgets=new Map()
const footprint=(stat,blockBytes)=>Math.max(Math.ceil(stat.size/blockBytes)*blockBytes,Number.isFinite(stat.blocks)?stat.blocks*512:0)

export function storageSettings(directory) {
  let settings
  try{settings=JSON.parse(readFileSync(join(directory,'storage-settings.json'),'utf8'))}
  catch(error){if(error.code==='ENOENT')return {version:1,maximumBytes:workerStorageLimit};throw error}
  if(settings.version!==1||!Number.isSafeInteger(settings.maximumBytes)||settings.maximumBytes<16*1024*1024||settings.maximumBytes>512*1024*1024)throw new Error('Invalid storage settings')
  return {version:1,maximumBytes:settings.maximumBytes}
}

export function directoryBytes(directory,blockBytes=Number(statfsSync(directory).bsize)||4096) {
  let bytes=footprint(lstatSync(directory),blockBytes)
  for(const entry of readdirSync(directory,{withFileTypes:true})) {
    const path=join(directory,entry.name)
    try {
      if(entry.isDirectory())bytes+=directoryBytes(path,blockBytes)
      else bytes+=footprint(lstatSync(path),blockBytes)
    }catch(error){if(error.code!=='ENOENT')throw error}
  }
  return bytes
}

// A fixed allowance also covers health files (separately capped at 3 MiB),
// SQLite/control metadata and concurrent credential setup. Atomic replacement
// counts BOTH the old file and its new temporary copy at their peak size.
export function configureStorageBudget(directory,{maximumBytes,reserveBytes=controlReserve}={}) {
  const dynamic=maximumBytes===undefined
  maximumBytes??=storageSettings(directory).maximumBytes
  if(!Number.isSafeInteger(maximumBytes)||!Number.isSafeInteger(reserveBytes)||reserveBytes<1024||maximumBytes<=reserveBytes)throw new Error('Invalid storage budget')
  const root=resolve(directory)
  const blockBytes=Number(statfsSync(root).bsize)||4096
  budgets.set(root,{maximumBytes,reserveBytes,dynamic,blockBytes})
  return ()=>budgets.delete(root)
}

export function reserveStorageWrite(path,bytes) {
  const absolute=resolve(path)
  const root=[...budgets.keys()].find(root=>absolute.startsWith(root+sep))
  if(!root)return ()=>{}
  const configured=budgets.get(root)
  const {reserveBytes}=configured
  const maximumBytes=configured.dynamic?storageSettings(root).maximumBytes:configured.maximumBytes
  const allocatedBytes=Math.ceil(bytes/configured.blockBytes)*configured.blockBytes
  // Reuse the accounting only inside this synchronous batch (e.g. spilling
  // 1,000 cold jobs). Rescan after yielding, when health/setup can have written.
  // This avoids a quadratic filesystem walk during queue compaction.
  if(configured.usedBytes===undefined) {
    configured.usedBytes=directoryBytes(root)
    queueMicrotask(()=>{configured.usedBytes=undefined})
  }
  const usedBytes=configured.usedBytes
  if(usedBytes+allocatedBytes>maximumBytes-reserveBytes) {
    const report={version:1,health:'capacity_reached',at:Date.now(),maximumBytes,usedBytes,
      nextAction:'Inspect worker storage. Increase its explicit disk budget only if space permits; do not delete pending work or receipts.'}
    // This tiny diagnostic uses the reserved control allowance, never the queue.
    const file=join(root,'storage-health.json'),temporary=file+'.'+randomUUID()+'.tmp'
    try{writeFileSync(temporary,JSON.stringify(report),{mode:0o600});renameSync(temporary,file)}
    finally{rmSync(temporary,{force:true})}
    throw Object.assign(new Error('Worker storage capacity reached; existing queue and receipts preserved'),{code:'STORAGE_CAPACITY'})
  }
  let previous=0
  try{previous=footprint(lstatSync(path),configured.blockBytes)}catch(error){if(error.code!=='ENOENT')throw error}
  return ()=>{
    if(configured.usedBytes!==undefined)configured.usedBytes+=allocatedBytes-previous
    rmSync(join(root,'storage-health.json'),{force:true})
  }
}
