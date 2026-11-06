import test from 'node:test'
import assert from 'node:assert/strict'
import {setupStepText,setupSummary,healthText} from '../indiecorns/lib/worker-ui.mjs'

test('ready setup explains background lifetime, preserved limits and runnable npx controls',()=>{
  assert.match(setupStepText({id:'service',status:'running',preserved:true}),/already running · kept in place/)
  assert.match(setupStepText({id:'policy',status:'preserved',mode:'execute',maxExternalPerDay:1}),/at most 1 external attempt.*unchanged/)
  const text=setupSummary({state:'ready',steps:[],capabilities:{githubActions:true},nextCommand:'indiecorns worker health --hours 24'})
  assert.match(text,/close this terminal/);assert.doesNotMatch(text,/24 healthy hours passed/)
  assert.match(text,/npx --yes indiecorns@latest worker setup --check/)
  assert.match(text,/worker uninstall/);assert.doesNotMatch(text,/\"version\"|\"steps\"/)
})

test('completion leads to the Herd and a delayed website acknowledgement never asks for another setup',()=>{
  assert.match(setupSummary({state:'ready',webVerification:'reported',steps:[]}),/Next: explore the Herd/)
  const pending=setupSummary({state:'ready',webVerification:'unavailable',steps:[]})
  assert.match(pending,/You do not need to repeat setup/)
  assert.doesNotMatch(pending,/Check health whenever|worker setup --mode/)
})

test('incomplete authorization shows the actual prerequisite instead of a misleading success',()=>{
  const text=setupSummary({state:'running_with_action_requirements',steps:[{id:'github',status:'permissions_required',nextCommand:'gh auth refresh --hostname github.com --scopes user:follow,public_repo'}],nextCommand:'indiecorns worker setup --check'})
  assert.match(text,/GitHub actions still need/);assert.match(text,/gh auth refresh/);assert.doesNotMatch(text,/all set|close this terminal/)
  assert.match(setupSummary({state:'service_unavailable',steps:[]}),/do not need to sign in again/)
  assert.match(setupSummary({state:'service_unavailable',steps:[]},{mode:'execute'}),/worker setup --mode execute --wait/)
  assert.match(setupSummary({state:'account_policy_mismatch',steps:[]}),/different account/)
})

test('human provider labels strip terminal control sequences',()=>{
  assert.doesNotMatch(setupStepText({id:'github',status:'verified',actor:{username:'maker\x1b\r\n'}}),/[\x00-\x1f]/)
})

test('health distinguishes a healthy latest sample from a healthy recorded window',()=>{
  const report={hours:24,latest:{discoveryHealthy:true,communityHealthy:true,githubPostsHealthy:true},latestAgeMs:1000,latestState:'recent_sample',coverage:'continuous_samples',sampledMs:90000000,largestGapMs:60000,unhealthySamples:0,progressStalls:0,clockAnomalies:0,anomalies:{}}
  assert.match(healthText(report),/Last 24 hours: healthy recorded coverage/)
  for(const patch of [{unhealthySamples:1},{sampledMs:86399999},{latestAgeMs:90001},{clockAnomalies:1},{anomalies:{malformedRecords:1}},{coverage:'insufficient_history'},{latest:{...report.latest,communityHealthy:false}},{largestGapMs:90001}]) {
    assert.match(healthText({...report,...patch}),/healthy coverage not yet proven/)
  }
  assert.match(healthText({...report,latest:null}),/No health samples/)
})
