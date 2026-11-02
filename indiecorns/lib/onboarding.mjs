import {existsSync,readFileSync,mkdirSync} from 'node:fs'
import {join} from 'node:path'
import {spawnSync} from 'node:child_process'
import {setTimeout as sleep} from 'node:timers/promises'
import {credential,storeCredential} from './credentials.mjs'
import {defaultPolicy,validatePolicy} from './actions.mjs'
import {githubJson} from './github-api.mjs'
import {syncCommunityFeed} from './community-feed.mjs'
import {saveState} from './worker.mjs'
import {assertWorkerRuntime,acquireWorkerGuard} from './worker-lock.mjs'
import {readHealthReport} from './health.mjs'

const read=(path,fallback)=>existsSync(path)?JSON.parse(readFileSync(path,'utf8')):fallback
const command=(name,args)=>spawnSync(name,args,{encoding:'utf8',timeout:5000,maxBuffer:65536,windowsHide:true,stdio:['ignore','pipe','pipe']})

// Inspect the operating system, not just a PID file. No signals or restarts.
export function inspectWorkerProcess(directory,{run=command,system=process.platform}={}) {
  const registration=read(join(directory,'service-runtime.json'),null)
  const lock=read(join(directory,'worker.lock'),null)
  if(!Number.isSafeInteger(lock?.pid)||lock.pid<=0)return {registered:Boolean(registration),running:false}
  if(!registration) {
    // A foreground worker can own this account without a service registration.
    // Never create a competing supervisor while its diagnostic PID exists.
    const found=system==='win32'?run('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',`Get-Process -Id ${lock.pid} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id`]):
      run('ps',['-p',String(lock.pid),'-o','pid='])
    return {registered:false,running:false,unmanagedProcessPresent:found.status===0&&Boolean(found.stdout?.trim())}
  }
  let matches=false
  if(system==='win32') {
    const result=run('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',
      `Get-CimInstance Win32_Process -Filter 'ProcessId = ${lock.pid}' | Select-Object ExecutablePath,CommandLine | ConvertTo-Json -Compress`])
    if(result.status===0&&result.stdout?.trim()) {
      const process=JSON.parse(result.stdout)
      matches=process?.ExecutablePath?.toLowerCase()===registration.node.toLowerCase()&&
        process.CommandLine?.includes(registration.cli)&&/worker["\s]+run/.test(process.CommandLine)
    }
  } else {
    const result=run('ps',['-p',String(lock.pid),'-o','args='])
    matches=result.status===0&&result.stdout.includes(registration.node)&&result.stdout.includes(registration.cli)&&/worker\s+run(?:\s|$)/.test(result.stdout)
  }
  const health=readHealthReport(directory,{hours:1})
  const heartbeatMatches=health.latest?.pid===lock.pid&&health.latest?.session===lock.owner&&
    health.latestState==='recent_sample'&&health.latestAgeMs<=90000
  return {registered:true,running:Boolean(matches&&heartbeatMatches),processMatches:Boolean(matches),
    heartbeatMatches:Boolean(heartbeatMatches),pid:lock.pid,appUrl:registration.appUrl??'https://app.indiecorns.com',
    health:health.latestState}
}

// Only an explicit setup command may import an existing provider login. Workers
// never launch gh, initiate OAuth, or copy browser cookies in the background.
export async function setupWorker(options) {
  assertWorkerRuntime(options.runtimeVersion??process.versions.node)
  if(options.check||!options.headers)return setup(options)
  // Independent kernel-backed lock serializes installers without acquiring or
  // disturbing the running worker's lifetime guard. Process exit releases it.
  const guardDirectory=join(options.directory,'setup')
  mkdirSync(guardDirectory,{recursive:true,mode:0o700})
  const release=await acquireWorkerGuard(guardDirectory)
  try{return await setup(options)}finally{release()}
}

async function setup({directory,appUrl,headers,accountRevision,mode='draft',check=false,
  request=fetch,environment=process.env,run=command,inspect=()=>inspectWorkerProcess(directory),
  install,persistAuth=()=>{},runtimeVersion=process.versions.node,wait=sleep}) {
  assertWorkerRuntime(runtimeVersion)
  if(!['draft','collect','execute'].includes(mode))throw new Error('Setup mode must be collect, draft or execute')
  const result={version:1,command:'worker setup',check,state:'action_required',steps:[],limitations:['computer_must_be_awake_online_and_logged_in']}
  const step=(id,status,extra={})=>result.steps.push({id,status,...extra})
  if(!headers) {step('community_auth','required',{nextCommand:'indiecorns login --json --no-open'});return result}
  // Preflight in memory: never modify a running worker's queue or feed cursor.
  const probe={jobs:{}}
  const snapshot=await syncCommunityFeed({state:probe,appUrl,headers,request,
    endpoint:headers.Authorization?'/api/public/cli/worker-feed':'/api/community/worker-feed'})
  if(probe.communityFeed?.health!=='ok'||!snapshot) {
    step('community_auth',probe.communityFeed?.health??'unavailable',{nextCommand:'indiecorns login --json --no-open'});return result
  }
  step('community_auth','verified')
  step('slack_feed','verified',{members:snapshot.memberIds.length,mappedMembers:new Set(snapshot.identities.map(i=>i.slackUserId)).size,requiresLocalSlackCredential:false})
  const policyPath=join(directory,'policy.json')
  const existing=read(policyPath,null)
  const policy=existing?validatePolicy(existing):validatePolicy({...defaultPolicy,mode,maxExternalPerDay:1,
    githubMemberActions:mode==='execute'?['follow','star']:[],...(mode==='execute'?{accountRevision}:{})})
  const bindingMatches=policy.mode!=='execute'||policy.accountRevision===accountRevision
  step('policy',existing?'preserved':check?'planned':'created',{mode:policy.mode,maxExternalPerDay:policy.maxExternalPerDay,accountMatches:bindingMatches})
  if(!bindingMatches){result.state='account_policy_mismatch';return result}
  let token=credential(directory,'github',environment),source=token?'configured':null,githubVerified=false
  if(!token) {
    const gh=run('gh',['auth','token','--hostname','github.com'])
    if(gh.status===0&&typeof gh.stdout==='string'&&gh.stdout.trim()&&!/\s/.test(gh.stdout.trim())&&gh.stdout.trim().length<=16384){token=gh.stdout.trim();source='github_cli'}
  }
  if(token) {
    try {
      const {data,headers:providerHeaders}=await githubJson('/user',{token,request})
      if(!Number.isSafeInteger(data?.id)||data.id<1||! /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/i.test(data.login??''))throw new Error('Invalid GitHub actor')
      githubVerified=true
      const scopes=providerHeaders.get('x-oauth-scopes')?.split(',').map(s=>s.trim())
      const required=scopes&&((policy.githubMemberActions.includes('follow')&&!scopes.includes('user:follow')&&!scopes.includes('user'))||
        (policy.githubMemberActions.includes('star')&&!scopes.includes('public_repo')&&!scopes.includes('repo')))
      step('github',required?'permissions_required':'verified',{source,actor:{id:data.id,username:data.login},permissions:scopes?'scope_headers_checked':'provider_enforced',
        ...(required?{nextCommand:'gh auth refresh --hostname github.com --scopes user:follow,public_repo'}:{})})
      if(required)githubVerified=false
    } catch {step('github','authentication_required',{nextCommand:'gh auth login --hostname github.com --scopes user:follow,public_repo'})}
  } else step('github','authentication_required',{nextCommand:'gh auth login --hostname github.com --scopes user:follow,public_repo'})
  const process=inspect()
  if(process.registered&&process.appUrl!==appUrl) {step('service','app_mismatch');return result}
  if(!check) {
    mkdirSync(directory,{recursive:true,mode:0o700})
    persistAuth()
    if(!existing)saveState(policyPath,policy)
    // Existing source choices are intentional and never silently overwritten.
    if(!existsSync(join(directory,'slack-settings.json')))saveState(join(directory,'slack-settings.json'),{source:'community'})
    if(githubVerified&&token!==credential(directory,'github',{}))storeCredential(directory,'github',token)
  }
  if(process.running)step('service','running',{pid:process.pid,preserved:true})
  else if(process.registered||process.unmanagedProcessPresent)step('service','attention_required',{nextCommand:'indiecorns worker service-status'})
  else if(check)step('service','not_installed',{nextCommand:`indiecorns worker setup --mode ${policy.mode}`})
  else {
    await install()
    let started=inspect()
    for(let n=0;!started.running&&n<10;n++){await wait(1000);started=inspect()}
    step('service',started.running?'running':'starting',{...(started.running?{pid:started.pid}:{}),nextCommand:'indiecorns worker setup --check'})
  }
  const running=result.steps.some(s=>s.id==='service'&&s.status==='running')
  result.state=running?(policy.mode==='execute'&&!githubVerified?'running_with_action_requirements':'ready'):check?'setup_required':'action_required'
  result.capabilities={discovery:true,slackPriority:true,githubActions:policy.mode==='execute'&&githubVerified,
    producthuntActions:false,otherPlatformActions:false}
  result.nextCommand=result.state==='ready'?'indiecorns worker health --hours 24':'indiecorns worker setup --check'
  return result
}
