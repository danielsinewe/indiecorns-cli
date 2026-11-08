import {existsSync} from 'node:fs'
import {join} from 'node:path'
import {postOutboxSummary} from './post-outbox.mjs'
const states=new Set(['observed','auth_required','blocked','unavailable','idle','host_cooldown','server_upgrade_required','not_started','profile_required'])
const label=status=>({profile_required:'member profile required',observed:'posts checked',auth_required:'sign-in required',blocked:'source blocked',unavailable:'source unavailable',idle:'no check due',host_cooldown:'waiting for source cooldown',server_upgrade_required:'server upgrade required',not_started:'not checked yet'}[status]??'not checked yet')
export function discoveryStatus({directory,state,now=Date.now()}) {
  const discovery=state?.postDiscovery
  const sources=Object.fromEntries(['linkedin','x'].map(platform=>{
    const source=discovery?.sources?.[platform]
    const status=states.has(source?.status)?source.status:'not_started'
    const fresh=Number.isFinite(source?.observedAt)&&source.observedAt<=now&&now-source.observedAt<=3600000
    return [platform,{status,lastObservedAt:source?.observedAt??null,fresh,posts:source?.posts??0}]
  }))
  return {version:1,state:states.has(discovery?.health)?discovery.health:'not_started',
    reader:{mode:existsSync(join(directory,'post-reader.json'))?'local_reader':'public_pages',
      signedInReaderRequired:!existsSync(join(directory,'post-reader.json')),activeAgentCommand:'indiecorns worker discovery agent',
      continuousSignedInCoverage:false},sources,delivery:postOutboxSummary(directory),
    nextCheckAt:discovery?.nextPollAt??null,
    cost:{externalDataProviders:0,modelCallsByCli:0,coordinationIntervalMs:300000,maximumIdleClaimsPerDay:288,
      readerCosts:'A configured reader or active agent can have its own runtime or model costs.'}}
}
export function discoveryStatusText(report) {
  const lines=['INDIECORNS · Member posts','',`Discovery: ${label(report.state)}`,
    ...Object.entries(report.sources).map(([platform,source])=>`${platform==='linkedin'?'LinkedIn':'X'}: ${label(source.status)}${source.lastObservedAt&&!source.fresh?' · last observation is stale':''}`),
    `Reports waiting to sync: ${report.delivery.pending}`]
  if(report.state==='profile_required')lines.push('Connect your own member profile at https://app.indiecorns.com/join. Your account sign-in is preserved.')
  if(report.reader.signedInReaderRequired)lines.push('Signed-in checks need your agent’s permitted browser or a configured local reader.',
    `Agent connection: ${report.reader.activeAgentCommand}`)
  else lines.push('A local reader is configured. Its current session and availability still need verification.')
  lines.push('Continuous signed-in coverage is not yet proven.','No external data provider or model API is called by the CLI.')
  return lines.join('\n')
}
