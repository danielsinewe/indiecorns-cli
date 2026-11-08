import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readdirSync,readFileSync,statSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {stagePostReport,flushPostReports,postOutboxSummary} from '../indiecorns/lib/post-outbox.mjs'
import {discoveryStatus,discoveryStatusText} from '../indiecorns/lib/post-discovery-status.mjs'
const now=Date.now(),body={leaseToken:'00000000-0000-4000-8000-000000000001',status:'observed',observedAt:now,posts:[]}
const setup=()=>({directory:mkdtempSync(join(tmpdir(),'indiecorns-post-outbox-')),appUrl:'https://app.indiecorns.com',headers:{authorization:'private-test-only'},body,now})
test('report outbox survives outages, binds the account and does not overwrite original evidence',async()=>{
 const options=setup()
 try {
  const path=stagePostReport(options)
  stagePostReport({...options,body:{...body,observedAt:now+1}})
  const raw=readFileSync(path,'utf8');assert.doesNotMatch(raw,/private-test-only/)
  assert.equal(JSON.parse(raw).report.observedAt,now)
  if(process.platform!=='win32')assert.equal(statSync(path).mode&0o777,0o600)
  assert.equal(readdirSync(join(options.directory,'post-outbox')).length,1)
  const failed=await flushPostReports({...options,send:async()=>{throw new Error('offline')}})
  assert.equal(failed.pending,1)
  let sent=false
  const other=await flushPostReports({...options,headers:{authorization:'other-account'},send:async()=>{sent=true}})
  assert.equal(other.accountMismatch,1);assert.equal(sent,false)
  const result=await flushPostReports({...options,send:async report=>{assert.equal(report.leaseToken,body.leaseToken);return {accepted:true,inserted:1}}})
  assert.equal(result.sent,1);assert.equal(result.pending,0)
 }finally{rmSync(options.directory,{recursive:true,force:true})}
})
test('expired and terminally rejected reports retire without a retry loop; status states the reader requirement',async()=>{
 const options=setup()
 try {
  stagePostReport(options)
  const expired=await flushPostReports({...options,now:now+600001,send:async()=>assert.fail('expired report must not send')})
  assert.equal(expired.expired,1)
  stagePostReport(options)
  const rejected=await flushPostReports({...options,send:async()=>{throw Object.assign(new Error('reassigned'),{httpStatus:409})}})
  assert.equal(rejected.rejected,1);assert.equal(postOutboxSummary(options.directory).pending,0)
  const report=discoveryStatus({directory:options.directory,state:{postDiscovery:{health:'profile_required'}},now})
  assert.match(discoveryStatusText(report),/member profile required/)
  assert.equal(report.reader.continuousSignedInCoverage,false)
  assert.match(discoveryStatusText(report),/active|agent/)
 }finally{rmSync(options.directory,{recursive:true,force:true})}
})
