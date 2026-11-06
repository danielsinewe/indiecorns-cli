import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {workerEvidenceHeader,reportWorkerInstallation} from '../indiecorns/lib/installation-evidence.mjs'
import {credentialRevision} from '../indiecorns/lib/auth-context.mjs'
const headers={'x-indiecorns-cli-session':'PRIVATE_SESSION','x-indiecorns-cli-secret':'PRIVATE_SECRET'}
test('reports inspect actual service identity and recent heartbeat without collecting private paths or credentials',()=>{
 const directory=mkdtempSync(join(tmpdir(),'indiecorns-proof-')),now=1000000
 try {
  const root=join(directory,'runtime'),cli=join(root,'indiecorns/bin/indiecorns.mjs');mkdirSync(join(root,'indiecorns/bin'),{recursive:true});writeFileSync(join(root,'package.json'),JSON.stringify({version:'0.4.12'}));writeFileSync(join(directory,'service-runtime.json'),JSON.stringify({cli,node:'/PRIVATE/node',registeredAt:100}))
  const inspection={registered:true,running:true,processMatches:true,heartbeatMatches:true,pid:123}
  const health={latestAgeMs:1000,clockAnomalies:0,anomalies:{},latest:{at:now-1000,pid:123,session:'session-1',discoveryHealthy:true,communityHealthy:true,githubPostsHealthy:true}}
  const options={headers,now,version:'0.4.15',inspect:()=>inspection,health:()=>health}
  const encoded=workerEvidenceHeader(directory,options),p=JSON.parse(Buffer.from(encoded,'base64url').toString())
  assert.equal(p.cliVersion,'0.4.12','identify the real service version, not the setup invoker');assert.equal(p.pid,123);assert.doesNotMatch(JSON.stringify(p),/PRIVATE|runtime|indiecorns-proof/)
  assert.equal(credentialRevision(headers),credentialRevision({...headers,'x-indiecorns-worker-evidence':encoded}),'reports do not reset credential bindings')
  for(const patch of [{registered:false},{running:false},{processMatches:false},{heartbeatMatches:false}])assert.equal(workerEvidenceHeader(directory,{...options,inspect:()=>({...inspection,...patch})}),null)
  for(const patch of [{latestAgeMs:90001},{clockAnomalies:1},{anomalies:{malformedRecords:1}},{latest:{...health.latest,pid:999}}])assert.equal(workerEvidenceHeader(directory,{...options,health:()=>({...health,...patch})}),null)
 }finally{rmSync(directory,{recursive:true,force:true})}
})
test('verification uses one bounded read-only request, requires server acknowledgement and never retries or invokes an engagement adapter',async()=>{
 let calls=0
 const options={directory:'unused',headers,appUrl:'https://app.indiecorns.com',version:'0.4.15',evidence:()=> 'PROOF',request:async(url,o)=>{calls++;assert.equal(url.origin,'https://app.indiecorns.com');assert.equal(url.searchParams.get('installation_check'),'1');assert.equal(o.method,'GET');assert.equal(o.redirect,'error');assert.equal(o.headers['x-indiecorns-worker-evidence'],'PROOF');return new Response('{}',{headers:{'x-indiecorns-worker-evidence':'accepted'}})}}
 assert.equal(await reportWorkerInstallation(options),'reported');assert.equal(calls,1)
 assert.equal(await reportWorkerInstallation({...options,evidence:()=>null}),'not_verified');assert.equal(calls,1)
 assert.equal(await reportWorkerInstallation({...options,request:async()=>new Response('{}')}),'unavailable')
 assert.equal(await reportWorkerInstallation({...options,request:async()=>new Response('{}',{status:429,headers:{'retry-after':'600'}})}),'unavailable')
 assert.equal(await reportWorkerInstallation({...options,request:async()=>new Response('{}',{status:503,headers:{'x-indiecorns-worker-evidence':'accepted'}})}),'reported')
 assert.equal(await reportWorkerInstallation({...options,request:async()=>new Response('{}',{status:401,headers:{'x-indiecorns-worker-evidence':'accepted'}})}),'unavailable')
})
