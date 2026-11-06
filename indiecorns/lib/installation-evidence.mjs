import {readFileSync} from 'node:fs'
import {join,dirname,resolve} from 'node:path'
import {createHash} from 'node:crypto'
import {inspectWorkerProcess} from './onboarding.mjs'
import {readHealthReport} from './health.mjs'
import {credentialRevision} from './auth-context.mjs'

// Only local OS + lock + recent heartbeat agreement can create a report. No
// hostnames, paths, provider credentials, contacts or queue records leave here.
export function workerEvidenceHeader(directory,{headers,source='scheduled',version,now=Date.now(),inspect=inspectWorkerProcess,health=readHealthReport}={}) {
  try {
    if(!headers||!['scheduled','local_check'].includes(source))return null
    const process=inspect(directory)
    if(!process.registered||!process.running||!process.processMatches||!process.heartbeatMatches)return null
    const report=health(directory,{hours:1,now}),row=report.latest
    if(!row||row.pid!==process.pid||report.latestAgeMs<0||report.latestAgeMs>90000||report.clockAnomalies||Object.values(report.anomalies??{}).some(Boolean))return null
    const registration=JSON.parse(readFileSync(join(directory,'service-runtime.json'),'utf8'))
    const serviceVersion=JSON.parse(readFileSync(resolve(dirname(registration.cli),'../../package.json'),'utf8')).version
    if(!/^\d+\.\d+\.\d+$/.test(serviceVersion))return null
    const installationId=createHash('sha256').update(JSON.stringify([registration.registeredAt,registration.cli,registration.node,credentialRevision(headers)])).digest('hex')
    return Buffer.from(JSON.stringify({version:1,installationId,source,observedAt:now,heartbeatAt:row.at,pid:row.pid,session:row.session,registered:true,processMatches:true,heartbeatMatches:true,
      discoveryHealthy:row.discoveryHealthy===true,communityHealthy:row.communityHealthy===true,githubPostsHealthy:row.githubPostsHealthy===true,cliVersion:serviceVersion})).toString('base64url')
  }catch{return null}
}
export async function reportWorkerInstallation({directory,headers,appUrl,endpoint='/api/community/worker-feed',version,request=fetch,source='local_check',evidence=workerEvidenceHeader}) {
  const proof=evidence(directory,{headers,source,version})
  if(!proof)return 'not_verified'
  try {
    const url=new URL(endpoint,appUrl)
    if(url.origin!==new URL(appUrl).origin)return 'unavailable'
    url.searchParams.set('installation_check','1')
    const response=await request(url,{method:'GET',headers:{...headers,'x-indiecorns-worker-evidence':proof},redirect:'error',signal:AbortSignal.timeout(10000)})
    await response.body?.cancel()
    return (response.ok||response.status===503)&&response.headers.get('x-indiecorns-worker-evidence')==='accepted'?'reported':'unavailable'
  }catch{return 'unavailable'}
}
