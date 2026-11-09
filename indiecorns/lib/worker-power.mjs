import {readFileSync,writeFileSync,mkdirSync,renameSync,rmSync,copyFileSync} from 'node:fs'
import {join,isAbsolute} from 'node:path'
import {homedir,platform} from 'node:os'
import {spawn,spawnSync} from 'node:child_process'
import {randomUUID} from 'node:crypto'
import {fileURLToPath} from 'node:url'
import {setTimeout as sleep} from 'node:timers/promises'

const label='com.indiecorns.worker.awake'
const maximumMs=120*60000
const xml=s=>String(s).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]))
const read=path=>{try{return JSON.parse(readFileSync(path,'utf8'))}catch(e){if(e.code==='ENOENT')return null;throw e}}
const write=(path,value)=>{
  const temporary=path+'.'+randomUUID()+'.tmp'
  try {writeFileSync(temporary,JSON.stringify(value)+'\n',{mode:0o600,flag:'wx'});renameSync(temporary,path)}
  finally{rmSync(temporary,{force:true})}
}
const execute=(command,args)=>spawnSync(command,args,{encoding:'utf8',timeout:5000,maxBuffer:32768,env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}})
const checked=(run,command,args)=>{
  const result=run(command,args)
  if(result.error||result.status!==0)throw new Error('Power helper command failed: '+command+' ('+(result.status??'unavailable')+')')
  return result
}
const paths=(home,directory)=>({config:join(directory,'power-config.json'),state:join(directory,'power-status.json'),helper:join(directory,'power-helper.mjs'),agent:join(home,'Library','LaunchAgents',label+'.plist')})
function validConfig(config,now) {
  return config?.version===1 && config.mode==='idle' && config.enabled===true &&
    typeof config.session==='string' && /^[\da-f-]{36}$/i.test(config.session) &&
    Number.isSafeInteger(config.createdAt) && Number.isSafeInteger(config.expiresAt) &&
    config.createdAt<=now && config.expiresAt>config.createdAt && config.expiresAt-config.createdAt<=maximumMs &&
    Number.isSafeInteger(config.pid) && config.pid>1 &&
    typeof config.owner==='string' && config.owner.length<=100 &&
    [config.node,config.cli].every(s=>typeof s==='string'&&isAbsolute(s)&&!/[\r\n\0]/.test(s))
}

export function workerPowerIdentity({directory,run=execute,uid=process.getuid?.()}) {
  const runtime=read(join(directory,'service-runtime.json')),lock=read(join(directory,'worker.lock'))
  if(!runtime||!lock||!Number.isSafeInteger(lock.pid)||lock.pid<=1||typeof lock.owner!=='string'||lock.guard!=='sqlite-v1')return null
  if(![runtime.node,runtime.cli].every(s=>typeof s==='string'&&isAbsolute(s)&&!/[\r\n\0]/.test(s)))return null
  const owner=run('/bin/ps',['-p',String(lock.pid),'-o','uid='])
  const command=run('/bin/ps',['-ww','-p',String(lock.pid),'-o','command='])
  const prefix=runtime.node+' '+runtime.cli+' worker run'
  const actual=command.stdout?.trim()??''
  if(owner.status!==0||command.status!==0||Number(owner.stdout?.trim())!==uid||!actual.startsWith(prefix)||actual.length>prefix.length&&!/\s/.test(actual[prefix.length]))return null
  return {pid:lock.pid,owner:lock.owner,node:runtime.node,cli:runtime.cli}
}

export function powerPlan({mode='idle',minutes=60,system=platform()}={}) {
  if(!['idle','closed-lid'].includes(mode))throw new Error('Use --mode idle or --mode closed-lid')
  if(!Number.isInteger(minutes)||minutes<1||minutes>120)throw new Error('Use --minutes between 1 and 120')
  return {version:1,mode,supported:system==='darwin',state:system!=='darwin'?'unsupported_platform':mode==='closed-lid'?'privileged_helper_required':'opt_in_required',
    maximumMinutes:120,minutes,requiresAdmin:mode==='closed-lid',requiresOptIn:true,
    powerSource:'AC only',systemWideSettingsChanged:false,closedLidVerified:false,
    effects:mode==='idle'?'Temporary AC-only sleep assertion; display may sleep. Lid closure may still sleep the Mac.':'System-wide sleep setting; requires a separately reviewed privileged helper and hardware validation.',
    stopConditions:['deadline','worker exit or identity change','disable','helper exit'],
    caution:'Keep the Mac ventilated. Sleep prevention increases energy use. This does not keep a host browser session alive or prove post discovery.',
    nextCommand:system==='darwin'&&mode==='idle'?`indiecorns worker power setup --mode idle --minutes ${minutes} --enable --accept-power-impact`:null}
}

export function powerDefinition({home,node,helper,directory}) {
  if(![home,node,helper,directory].every(s=>typeof s==='string'&&isAbsolute(s)&&!/[\r\n\0]/.test(s)))throw new Error('Invalid power helper path')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array>${[node,helper,'--supervise',directory].map(s=>'<string>'+xml(s)+'</string>').join('')}</array>
<key>RunAtLoad</key><true/>
<key>ProcessType</key><string>Background</string>
<key>StandardOutPath</key><string>/dev/null</string><key>StandardErrorPath</key><string>/dev/null</string>
</dict></plist>\n`
}

export function powerStatus({home=homedir(),directory=join(home,'.indiecorns','worker'),system=platform(),now=Date.now(),run=execute,uid=process.getuid?.()}={}) {
  if(system!=='darwin')return {...powerPlan({system}),state:'unsupported_platform'}
  const files=paths(home,directory),config=read(files.config),state=read(files.state)
  const base={version:1,mode:'idle',requiresAdmin:false,systemWideSettingsChanged:false,closedLidVerified:false,source:'local_process_check'}
  if(!config)return {...base,state:'disabled',enabled:false}
  if(config.enabled===false)return {...base,state:'disabled',enabled:false}
  if(!validConfig(config,now))return {...base,state:'invalid_configuration',enabled:false}
  if(now>=config.expiresAt)return {...base,state:'expired',enabled:false,expiresAt:config.expiresAt}
  const worker=workerPowerIdentity({directory,run,uid})
  if(!worker||worker.pid!==config.pid||worker.owner!==config.owner||worker.node!==config.node||worker.cli!==config.cli)return {...base,state:'worker_unavailable',enabled:true,expiresAt:config.expiresAt}
  const child=state?.session===config.session&&Number.isSafeInteger(state.assertionPid)&&state.assertionPid>1?
    run('/bin/ps',['-ww','-p',String(state.assertionPid),'-o','command=']):null
  const expected='/usr/bin/caffeinate -s -t '+state?.timeoutSeconds+' -w '+config.pid
  const alive=child?.status===0&&child.stdout?.trim()===expected
  const power=run('/usr/bin/pmset',['-g','batt'])
  const ac=power.status===0?/Now drawing from 'AC Power'/.test(power.stdout??''):null
  return {...base,enabled:true,state:alive?(ac===true?'assertion_running':ac===false?'waiting_for_ac':'power_source_unknown'):'not_running',
    assertionProcessAlive:alive,powerSource:ac===true?'ac':ac===false?'battery':'unknown',expiresAt:config.expiresAt,workerPid:config.pid,
    evidence:'Process presence is not independent proof of a macOS assertion, closed-lid operation or successful discovery.'}
}

export function managePower(action,{mode='idle',minutes=60,enable=false,acceptPowerImpact=false,home=homedir(),directory=join(home,'.indiecorns','worker'),system=platform(),now=Date.now(),run=execute,uid=process.getuid?.()}={}) {
  if(action==='status')return powerStatus({home,directory,system,now,run,uid})
  const plan=powerPlan({mode,minutes,system})
  if(system!=='darwin'||mode==='closed-lid')return plan
  const files=paths(home,directory),domain='gui/'+uid
  if(action==='setup') {
    if(!enable)return plan
    if(!acceptPowerImpact)throw new Error('Explicit opt-in required: --enable --accept-power-impact; inspect worker power setup first')
    const worker=workerPowerIdentity({directory,run,uid})
    if(!worker)throw new Error('A running, same-user installed worker is required; power setup does not start or restart it')
    const previous=read(files.config)
    if(previous?.enabled)throw new Error('Disable the previous power session before enabling another one')
    const config={version:1,mode:'idle',enabled:true,session:randomUUID(),createdAt:now,expiresAt:now+minutes*60000,...worker}
    mkdirSync(directory,{recursive:true,mode:0o700})
    mkdirSync(join(home,'Library','LaunchAgents'),{recursive:true,mode:0o700})
    copyFileSync(fileURLToPath(import.meta.url),files.helper)
    write(files.config,config)
    writeFileSync(files.agent,powerDefinition({home,node:worker.node,helper:files.helper,directory}),{mode:0o600})
    try {checked(run,'/bin/launchctl',['bootstrap',domain,files.agent])}
    catch(error){write(files.config,{...config,enabled:false});throw error}
    return {...plan,state:'configured',enabled:true,expiresAt:config.expiresAt,
      evidence:'Helper registered; inspect worker power status for actual process evidence.'}
  }
  if(['disable','uninstall'].includes(action)) {
    const config=read(files.config)
    if(config)write(files.config,{...config,enabled:false,disabledAt:now})
    const target=domain+'/'+label
    const stop=run('/bin/launchctl',['bootout',target])
    // Do not claim stopped if launchd still reports the helper after a failed stop.
    if((stop.error||stop.status!==0)&&run('/bin/launchctl',['print',target]).status===0)throw new Error('Power helper stop could not be verified; disabled configuration requests assertion release on its next check')
    rmSync(files.agent,{force:true})
    if(action==='uninstall')rmSync(files.helper,{force:true})
    return {version:1,state:'disabled',enabled:false,uninstalled:action==='uninstall',systemWideSettingsChanged:false,closedLidVerified:false}
  }
  throw new Error('Use worker power setup, status, disable or uninstall')
}

export async function supervisePower({directory,now=Date.now,run=execute,start=spawn,wait=sleep,signal,uid=process.getuid?.()}={}) {
  const configPath=join(directory,'power-config.json'),statePath=join(directory,'power-status.json')
  const config=read(configPath)
  const matches=()=>{const worker=workerPowerIdentity({directory,run,uid});return worker&&['pid','owner','node','cli'].every(k=>worker[k]===config[k])}
  if(!validConfig(config,now())||now()>=config.expiresAt||!matches())return {state:'inactive'}
  const timeoutSeconds=Math.max(1,Math.ceil((config.expiresAt-now())/1000))
  const child=start('/usr/bin/caffeinate',['-s','-t',String(timeoutSeconds),'-w',String(config.pid)],{stdio:'ignore',shell:false,env:{PATH:'/usr/bin:/bin'}})
  let exited=false,error=false
  child.once('exit',()=>{exited=true})
  child.on('error',()=>{error=true})
  try {
    await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject)})
    write(statePath,{version:1,session:config.session,assertionPid:child.pid,timeoutSeconds,startedAt:now()})
    while(!signal?.aborted&&!exited&&!error&&now()<config.expiresAt) {
      const current=read(configPath)
      if(!current?.enabled||current.session!==config.session||!matches())break
      try {await wait(Math.min(5000,Math.max(1,config.expiresAt-now())),undefined,{signal})}
      catch(e){if(e.name!=='AbortError')throw e;break}
    }
    return {state:'released'}
  } finally {
    if(!exited)child.kill('SIGTERM')
    write(statePath,{version:1,session:config.session,stoppedAt:now(),state:'released'})
  }
}

if(process.argv[1]===fileURLToPath(import.meta.url)&&process.argv[2]==='--supervise') {
  const controller=new AbortController()
  for(const event of ['SIGTERM','SIGINT','SIGHUP'])process.once(event,()=>controller.abort())
  supervisePower({directory:process.argv[3],signal:controller.signal}).catch(()=>{process.exitCode=1})
}
