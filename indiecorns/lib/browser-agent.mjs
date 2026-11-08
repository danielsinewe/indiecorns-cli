import {spawn} from 'node:child_process'
import {isAbsolute} from 'node:path'
import {readMemberActivity} from './browser-reader.mjs'

function cliRequest({nodeExecutable,cliPath,appUrl},args,input,signal) {
  if(!isAbsolute(nodeExecutable)||!isAbsolute(cliPath))throw new Error('Use the absolute runtime paths from worker discovery agent')
  const url=new URL(appUrl)
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw new Error('Invalid Indiecorns app URL')
  return new Promise((resolve,reject)=>{
    const child=spawn(nodeExecutable,[cliPath,'worker','discovery',...args,'--app-url',url.origin,'--json','--no-telemetry','--no-open'],
      {shell:false,stdio:['pipe','pipe','ignore'],windowsHide:true,signal,timeout:40000,killSignal:'SIGKILL'})
    let output='',bytes=0
    child.on('error',reject);child.stdin.on('error',()=>{})
    child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>32768){child.kill('SIGKILL');reject(new Error('CLI response exceeds 32 KB'))}else output+=chunk.toString('utf8')})
    child.on('close',code=>{if(code!==0){reject(new Error('Discovery command failed; inspect worker discovery status or account authorization'));return}
      try {resolve(JSON.parse(output))}catch{reject(new Error('Invalid discovery command response'))}})
    child.stdin.end(input?JSON.stringify(input):undefined)
  })
}

// The host supplies the already-permitted browser. Browser calls stay inside its
// trusted active session. No copied cookies, browser subprocess or paid model API.
export async function runBrowserDiscoveryOnce({browser,nodeExecutable,cliPath,appUrl='https://app.indiecorns.com',platform,signal,onState,now=Date.now,
  execute=cliRequest}) {
  const connection={nodeExecutable,cliPath,appUrl}
  const claimed=await execute(connection,['claim','--reader','browser',...(platform?['--platform',platform]:[])],undefined,signal)
  if(claimed.version!==1)throw new Error('Unsupported discovery server')
  if(!claimed.task)return {state:'idle',retryAfterMs:claimed.retryAfterMs??300000}
  if(!Number.isSafeInteger(claimed.task.expiresAt)||claimed.task.expiresAt<=now())throw new Error('Discovery lease expired')
  const observation=await readMemberActivity({browser,task:claimed.task,onState,now})
  const report=await execute(connection,['report','--stdin'],{leaseToken:claimed.task.leaseToken,...observation},signal)
  if(report.queued===true)return {state:'report_queued',sourceStatus:observation.status,observedAt:observation.observedAt,posts:observation.posts.length,lifetime:'active_agent_session',continuousSignedInCoverage:false}
  if(report.accepted!==true)throw new Error('Discovery observation was not accepted')
  return {state:observation.status,observedAt:observation.observedAt,posts:observation.posts.length,inserted:report.inserted??0,nextCheckAfterMs:report.nextCheckAfterMs??null,
    lifetime:'active_agent_session',continuousSignedInCoverage:false}
}

// A native scheduled host turn supplies an active trusted browser context. This
// does not keep browser RPC alive between turns or install a second scheduler.
export async function runScheduledDiscovery(options) {
  if(typeof options.automationId!=='string'||!/^[-a-z0-9_]{1,100}$/i.test(options.automationId))throw new Error('Native automation ID required')
  const results=[]
  for(const platform of ['linkedin','x']) {
    if(options.signal?.aborted)break
    const result=await runBrowserDiscoveryOnce({...options,platform})
    results.push({platform,...result})
  }
  if(!results.length)return {state:'aborted',results}
  const checkedAt=(options.now??Date.now)()
  const report={automationId:options.automationId,checkedAt,results}
  const recorded=await (options.execute??cliRequest)(options,['record-run','--stdin'],report,options.signal)
  if(recorded.recorded!==true)throw new Error('Scheduled discovery result was not recorded')
  return {state:'completed',automationId:options.automationId,checkedAt,results,recorded:true,continuousSignedInCoverage:false}
}
