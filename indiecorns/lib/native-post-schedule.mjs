import {readFileSync,statSync} from 'node:fs'
import {join} from 'node:path'
import {saveState} from './worker.mjs'

const supportedStates=new Set(['idle','observed','auth_required','blocked','unavailable','report_queued'])
export function nativeScheduleHandoff({nodeExecutable,cliPath,appUrl,accountRevision,intervalMinutes=60}) {
  if(![30,60,120,240,360].includes(intervalMinutes))throw new Error('Use a 30, 60, 120, 240 or 360 minute schedule to bound host usage')
  if(!/^[a-f0-9]{64}$/.test(accountRevision??''))throw new Error('Connect your Indiecorns account before scheduling checks')
  return {version:1,mode:'native_host_automation_handoff',name:'Indiecorns member-post discovery',intervalMinutes,
    phaseMinute:Number.parseInt(accountRevision.slice(0,4),16)%60,maximumChecksPerRun:2,
    nodeExecutable,cliPath,appUrl,
    hostAction:'Use the native automation tool to create or reuse this member-post schedule. Never edit automation files or invent a private scheduler API.',
    prompt:'Perform one bounded Indiecorns member-post discovery run on this Mac. Locate the installed CLI from ~/.indiecorns/worker/service-runtime.json and run worker discovery agent --json --no-telemetry for its current bundled reader paths. Select the permitted ChatGPT cloud browser first when available, otherwise the ChatGPT in-app browser in the background. Import the bundled browser-agent module inside the trusted active browser session and call runScheduledDiscovery with the already-selected browser, returned nodeExecutable/cliPath/appUrl and this automation ID. It checks at most one LinkedIn and one X task and records the bounded result. Respect null tasks, auth requirements and server cooldowns. Never switch to local Chrome/extensions, launch a browser, export cookies, force sign-in or grant consent, send messages, engage with posts, edit code, deploy, create another schedule or continue a development goal. Preserve existing tabs, policies, receipts, queues and quotas. Close only temporary reader tabs. End after this run; do not self-trigger or claim continuous coverage.',
    requirements:['native_host_automation_tool','computer_awake_online','host_app_running','permitted_browser_session'],
    costs:{modelApiCallsByCli:0,externalDataProviders:0,usesHostSubscription:true,
      maximumScheduledRunsPerDay:Math.ceil(1440/intervalMinutes),maximumSourceChecksPerDay:2*Math.ceil(1440/intervalMinutes)},
    continuousSignedInCoverage:false}
}

export function readNativeRun(directory,accountRevision) {
  try {
    const path=join(directory,'post-agent-run.json')
    if(statSync(path).size>16384)return null
    const value=JSON.parse(readFileSync(path,'utf8'))
    if(value.version!==1||value.accountRevision!==accountRevision)return null
    return value
  } catch{return null}
}

export function recordNativeRun({directory,accountRevision,body,now=Date.now()}) {
  if(!/^[a-f0-9]{64}$/.test(accountRevision??'')||!body||
    typeof body.automationId!=='string'||!/^[-a-z0-9_]{1,100}$/i.test(body.automationId)||
    !Number.isSafeInteger(body.checkedAt)||body.checkedAt>now+30000||body.checkedAt<now-600000||
    !Array.isArray(body.results)||body.results.length<1||body.results.length>2)throw new Error('Invalid scheduled discovery report')
  const platforms=new Set(),sources={...(readNativeRun(directory,accountRevision)?.sources??{})}
  const results=body.results.map(result=>{
    if(!['linkedin','x'].includes(result.platform)||platforms.has(result.platform)||!supportedStates.has(result.state))throw new Error('Invalid scheduled platform result')
    platforms.add(result.platform)
    const posts=result.posts??0,inserted=result.inserted??0
    if(!Number.isInteger(posts)||posts<0||posts>20||!Number.isInteger(inserted)||inserted<0||inserted>posts)throw new Error('Invalid scheduled post counts')
    const observationStatus=result.state==='report_queued'?result.sourceStatus:result.state
    if(result.state==='report_queued'&&!['observed','auth_required','blocked','unavailable'].includes(observationStatus))throw new Error('Queued source status required')
    const observed=result.state!=='idle'&&Number.isSafeInteger(result.observedAt)&&result.observedAt<=body.checkedAt+30000&&result.observedAt>=body.checkedAt-600000
    if(result.state!=='idle'&&!observed)throw new Error('Scheduled source observation time required')
    if(observed&&['observed','auth_required','blocked','unavailable'].includes(observationStatus)) {
      sources[result.platform]={status:observationStatus,observedAt:result.observedAt,posts,delivery:result.state==='report_queued'?'queued':'acknowledged',reader:'scheduled_agent'}
    }
    return {platform:result.platform,state:result.state,posts,inserted,...(observed?{observedAt:result.observedAt}:{})}
  })
  const value={version:1,accountRevision,automationId:body.automationId,lastRunAt:body.checkedAt,results,sources,
    evidence:'client_reported_native_schedule_run',continuousSignedInCoverage:false}
  saveState(join(directory,'post-agent-run.json'),value)
  return {recorded:true,automationId:value.automationId,lastRunAt:value.lastRunAt,continuousSignedInCoverage:false}
}
