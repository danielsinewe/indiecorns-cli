// Standalone privileged component. Installed copies import built-ins only.
// It accepts a finite lease, never a command, executable, URL or shell fragment.
import * as fs from 'node:fs'
import {join} from 'node:path'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {setTimeout as sleep} from 'node:timers/promises'
import {performance} from 'node:perf_hooks'

export const rootDirectory='/Library/Indiecorns/PowerHelper'
export const rootLabel='com.indiecorns.power-helper'
const uuid=value=>typeof value==='string'&&/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value)
const checked=(run,args)=>{
  const result=run('/usr/bin/pmset',args)
  if(result.error||result.status!==0)throw new Error('pmset_failed')
  return result.stdout??''
}

export function parseSleepDisabled(output) {
  const matches=[...output.matchAll(/^\s*SleepDisabled\s+([01])\s*$/gm)]
  if(matches.length!==1)throw new Error('sleep_setting_unknown')
  return Number(matches[0][1])
}
export function validatePowerRequest(request,now) {
  if(!request||request.version!==1||!['enable','disable','uninstall'].includes(request.op)||!uuid(request.nonce)||
    !Number.isSafeInteger(request.at)||request.at>now+5000||request.at<now-30000)throw new Error('invalid_request')
  const keys=['version','op','nonce','at',...(request.op==='enable'?['minutes','pid','startedAt','acceptSystemWide']:[])]
  if(Object.keys(request).some(key=>!keys.includes(key)))throw new Error('unexpected_request_field')
  if(request.op==='enable'&&(!Number.isInteger(request.minutes)||request.minutes<1||request.minutes>120||
    !Number.isSafeInteger(request.pid)||request.pid<=1||typeof request.startedAt!=='string'||request.startedAt.length>80||
    !request.startedAt||request.acceptSystemWide!==true))throw new Error('explicit_bounded_opt_in_required')
  return request
}

// All effects are injected. The same controller is exercised on every CI OS;
// tests cannot accidentally invoke pmset or install a launchd job.
export function createPowerController({io,clock={now:Date.now,monotonic:()=>performance.now()}}) {
  let record=io.readJournal()??{version:1,phase:'idle',lastNonce:null}
  if(record.version!==1||!['idle','prepared','active','restore_failed'].includes(record.phase)||
    record.lastNonce!==null&&!uuid(record.lastNonce))throw new Error('invalid_restore_journal')
  let monotonicDeadline=null
  let ready=false
  const persist=next=>{io.writeJournal(next);record=next}
  const publish=state=>io.writeStatus({version:1,...state,at:clock.now(),closedLidVerified:false,systemWide:true})
  const release=reason=>{
    if(['prepared','active','restore_failed'].includes(record.phase)) {
      if(record.original!==0||record.applied!==1)throw new Error('invalid_restore_journal')
      try {
        const current=io.readSetting()
        if(current===record.applied) {
          io.writeSetting(record.original)
          if(io.readSetting()!==record.original)throw new Error('restore_not_acknowledged')
        } else if(current!==record.original)throw new Error('external_setting_unknown')
        // A different current value belongs to another actor. Never overwrite it.
        persist({version:1,phase:'idle',lastNonce:record.lastNonce,releasedAt:clock.now(),reason})
      } catch(error) {
        persist({...record,phase:'restore_failed',reason:'restore_failed'})
        publish({state:'restore_failed',requiresAdmin:true})
        throw error
      }
    }
    monotonicDeadline=null
    publish({state:'disabled',reason,lastNonce:record.lastNonce})
    return {state:'disabled',reason}
  }
  return {
    recover() {
      // A restart or reboot never renews a lease. The durable pre-write journal
      // covers crashes before and after the system setting is changed.
      release('helper_restarted')
      ready=true
    },
    request(raw) {
      if(!ready)throw new Error('helper_not_recovered')
      const request=validatePowerRequest(raw,clock.now())
      if(request.nonce===record.lastNonce)return {state:'duplicate_request'}
      if(request.op!=='enable') {
        const result=release(request.op)
        persist({...record,lastNonce:request.nonce,uninstallReady:request.op==='uninstall'})
        publish({...result,lastNonce:request.nonce,uninstallReady:request.op==='uninstall'})
        return result
      }
      if(record.phase!=='idle')throw new Error('lease_already_active')
      if(!io.onAC())throw new Error('ac_power_required')
      if(!io.workerMatches(request.pid,request.startedAt))throw new Error('worker_identity_mismatch')
      const original=io.readSetting()
      if(original!==0)throw new Error('sleep_already_disabled_externally')
      const createdAt=clock.now(),duration=request.minutes*60000
      // Persist and fsync BEFORE the first privileged write.
      persist({version:1,phase:'prepared',original,applied:1,pid:request.pid,startedAt:request.startedAt,
        createdAt,expiresAt:createdAt+duration,lastNonce:request.nonce})
      try {
        io.writeSetting(1)
        if(io.readSetting()!==1)throw new Error('enable_not_acknowledged')
        persist({...record,phase:'active'})
        monotonicDeadline=clock.monotonic()+duration
        publish({state:'active',expiresAt:record.expiresAt,pid:record.pid,lastNonce:record.lastNonce,
          evidence:'Setting acknowledged. Hardware closed-lid operation remains unverified.'})
        return {state:'active',expiresAt:record.expiresAt}
      } catch(error){release('enable_failed');throw error}
    },
    tick() {
      if(record.phase==='restore_failed')return release('restore_retry')
      if(record.phase!=='active') {
        publish({state:'disabled',lastNonce:record.lastNonce,uninstallReady:record.uninstallReady===true})
        return {state:'disabled'}
      }
      let reason
      try {
        if(clock.now()<record.createdAt||clock.now()>=record.expiresAt||clock.monotonic()>=monotonicDeadline)reason='expired'
        else if(!io.onAC())reason='ac_disconnected'
        else if(!io.workerMatches(record.pid,record.startedAt))reason='worker_stopped_or_replaced'
        else if(io.readSetting()!==1)reason='setting_changed_externally'
      }catch{reason='watchdog_check_failed'}
      if(reason)return release(reason)
      publish({state:'active',expiresAt:record.expiresAt,pid:record.pid,lastNonce:record.lastNonce})
      return {state:'active'}
    },
    stop:()=>release('helper_stopped'),
    snapshot:()=>({...record}),
  }
}

export async function runPowerWatchdog({controller,readRequest,onRequestError=()=>{},wait=sleep,shouldStop=()=>false}) {
  while(!shouldStop()) {
    try{controller.tick()}catch{ /* Durable restore_failed is retried next tick. */ }
    let request
    try{request=readRequest();if(request)controller.request(request)}
    catch(error){onRequestError(request,error)}
    await wait(1000)
  }
}

const safeRootFile=(path,{uid=0,maxSize=16384,write=false}={})=>{
  const fd=fs.openSync(path,(write?fs.constants.O_WRONLY:fs.constants.O_RDONLY)|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK)
  try {
    const info=fs.fstatSync(fd)
    if(!info.isFile()||info.uid!==uid||info.nlink!==1||(info.mode&0o077)!==0||info.size>maxSize)throw new Error('unsafe_helper_file')
    return fd
  }catch(e){fs.closeSync(fd);throw e}
}
export function readHelperJSON(path,options) {
  let fd
  try {
    fd=safeRootFile(path,options)
    // The member can grow its request file after fstat. A fixed-size read keeps
    // that race from becoming an unbounded allocation in the root process.
    const limit=options?.maxSize??16384,buffer=Buffer.alloc(limit+1)
    const bytes=fs.readSync(fd,buffer,0,buffer.length,0)
    if(bytes>limit)throw new Error('helper_file_too_large')
    return JSON.parse(buffer.subarray(0,bytes).toString('utf8'))
  }
  catch(e){if(e.code==='ENOENT')return null;throw e}
  finally{if(fd!==undefined)fs.closeSync(fd)}
}
function atomicRootJSON(path,value,mode=0o600) {
  const temporary=path+'.tmp'
  let fd
  try {
    fd=fs.openSync(temporary,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,mode)
    fs.writeFileSync(fd,JSON.stringify(value)+'\n');fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined
    fs.renameSync(temporary,path)
    const dir=fs.openSync(rootDirectory,fs.constants.O_RDONLY);try{fs.fsyncSync(dir)}finally{fs.closeSync(dir)}
  }finally{if(fd!==undefined)fs.closeSync(fd)}
}
const execute=(command,args)=>spawnSync(command,args,{encoding:'utf8',timeout:5000,maxBuffer:16384,env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}})
export function createSystemPowerIO({run=execute,config,readJournal,writeJournal,writeStatus}) {
  if(!Number.isInteger(config?.uid)||config.uid<=0||config.uid>2147483647||
    ![config.node,config.cli].every(s=>typeof s==='string'&&s.startsWith('/')&&!/[\n\r\0]/.test(s)))throw new Error('invalid_helper_binding')
  return {
    readJournal,writeJournal,writeStatus,
    readSetting:()=>parseSleepDisabled(checked(run,['-g'])),
    writeSetting:value=>{
      if(value!==0&&value!==1)throw new Error('invalid_sleep_setting')
      checked(run,['-a','disablesleep',String(value)])
    },
    onAC:()=>/Now drawing from 'AC Power'/.test(checked(run,['-g','batt'])),
    workerMatches(pid,startedAt) {
      if(!Number.isSafeInteger(pid)||pid<=1)return false
      const process=run('/bin/ps',['-ww','-p',String(pid),'-o','uid=','-o','lstart=','-o','command='])
      if(process.error||process.status!==0)return false
      const match=(process.stdout??'').trim().match(/^(\d+)\s+(.{24})\s+(.+)$/)
      const prefix=config.node+' '+config.cli+' worker run'
      return Boolean(match&&Number(match[1])===config.uid&&match[2]===startedAt&&
        (match[3]===prefix||match[3].startsWith(prefix+' ')))
    },
  }
}

async function privilegedMain() {
  if(process.platform!=='darwin'||process.getuid?.()!==0)throw new Error('macOS_administrator_required')
  if(!['--serve','--uninstall'].includes(process.argv[2])||process.argv.length!==3)throw new Error('invalid_helper_action')
  // Do not execute a privileged Node from a writable npm cache or home directory.
  for(const path of ['/Library/Indiecorns',rootDirectory,process.execPath,fileURLToPath(import.meta.url)]) {
    const stat=fs.lstatSync(path)
    if(stat.isSymbolicLink()||stat.uid!==0||(stat.mode&0o022)!==0)throw new Error('unsafe_helper_installation')
  }
  const {DatabaseSync}=await import('node:sqlite')
  const guard=new DatabaseSync(join(rootDirectory,'guard.sqlite'),{timeout:5000})
  fs.chmodSync(join(rootDirectory,'guard.sqlite'),0o600)
  guard.exec('CREATE TABLE IF NOT EXISTS helper_guard (id INTEGER PRIMARY KEY); BEGIN EXCLUSIVE')
  // Stale temporary writes are not journals. The last renamed/fsynced journal
  // remains authoritative after SIGKILL. Directory is root-owned, not writable.
  for(const name of ['journal.json.tmp','status.json.tmp'])fs.rmSync(join(rootDirectory,name),{force:true})
  const config=readHelperJSON(join(rootDirectory,'config.json'))
  const io=createSystemPowerIO({config,
    readJournal:()=>readHelperJSON(join(rootDirectory,'journal.json')),
    writeJournal:value=>atomicRootJSON(join(rootDirectory,'journal.json'),value),
    writeStatus:value=>atomicRootJSON(join(rootDirectory,'status.json'),value,0o644),
  })
  const controller=createPowerController({io})
  let stopping=false
  for(const signal of ['SIGINT','SIGTERM','SIGHUP'])process.on(signal,()=>{stopping=true})
  try {
    // Do not accept requests until crash recovery really succeeds.
    while(true) {
      try{controller.recover();break}catch{if(process.argv[2]==='--uninstall')throw new Error('restore_required_before_uninstall');await sleep(1000)}
    }
    if(process.argv[2]==='--uninstall'){controller.stop();return}
    await runPowerWatchdog({controller,shouldStop:()=>stopping,
      readRequest:()=>{
        const request=readHelperJSON(join(rootDirectory,'request.json'),{uid:config.uid,maxSize:2048})
        return request?.nonce===controller.snapshot().lastNonce?null:request
      },
      onRequestError:(request,error)=>{
        if(!uuid(request?.nonce))return
        const codes=['lease_already_active','ac_power_required','worker_identity_mismatch','sleep_already_disabled_externally','invalid_request','explicit_bounded_opt_in_required','unexpected_request_field']
        const code=codes.includes(error.message)?error.message:'helper_operation_failed'
        io.writeStatus({version:1,state:controller.snapshot().phase==='active'?'active':controller.snapshot().phase==='restore_failed'?'restore_failed':'disabled',at:Date.now(),
          expiresAt:controller.snapshot().expiresAt,requestError:{nonce:request.nonce,code},closedLidVerified:false,systemWide:true})
      }})
  } finally {
    try{controller.stop()}finally{guard.close()}
  }
}
if(process.argv[1]===fileURLToPath(import.meta.url))privilegedMain().catch(()=>{process.exitCode=1})
