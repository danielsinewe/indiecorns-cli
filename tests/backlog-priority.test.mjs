import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {attachBacklog,compactJobs,restoreJob} from '../indiecorns/lib/backlog.mjs'
import {enqueue,runWorker,saveState,targetKey} from '../indiecorns/lib/worker.mjs'
import {prioritizeSlack} from '../indiecorns/lib/slack.mjs'

const target=name=>({platform:'peerlist',eventType:'inspect',profileUrl:`https://peerlist.io/${name}/project/app`})
const snapshot=()=>({version:1,workspaceId:'TTEST',channelId:'CTEST',memberIds:['UMEMBER'],observedAt:1000,expiresAt:100000,
  identities:[{slackUserId:'UMEMBER',profileUrls:['https://peerlist.io/cold'],targets:[]}]})

for(const legacy of [false,true]) test(`new Slack owner takes priority over warm jobs after restart (${legacy?'legacy':'current'} backlog)`,async()=>{
  const directory=mkdtempSync(join(tmpdir(),'indiecorns-priority-'))
  try {
    const state={version:1,jobs:{},failures:0,nextPollAt:100000}
    enqueue(state,[target('warm'),target('cold')],1000)
    const key=targetKey(target('cold'))
    state.jobs[key].priority=2
    attachBacklog(state,directory,saveState)
    compactJobs(state,1)
    assert.ok(state.backlog[key])
    if(legacy)delete state.backlog[key].target
    saveState(join(directory,'state.json'),state)
    const observed=[]
    const result=await runWorker({directory,once:true,now:()=>5000,observationLimit:1,discover:async()=>[],
      prioritize:current=>prioritizeSlack(current,snapshot(),5000),
      observe:async item=>{observed.push(item.profileUrl);return {status:'observed',observedAt:5000}}})
    assert.deepEqual(observed,[target('cold').profileUrl])
    assert.equal(result.jobs[key].priority,0)
    assert.equal(result.jobs[key].target.slackMember,true)
  } finally {rmSync(directory,{recursive:true,force:true})}
})

test('archived priorities follow membership expiry and shared-link attribution without loading payloads',()=>{
  const directory=mkdtempSync(join(tmpdir(),'indiecorns-priority-'))
  try {
    const state={jobs:{}}
    const shared={...target('other'),slackChannelId:'CTEST',sharedBySlackUserId:'UMEMBER'}
    enqueue(state,[target('cold'),shared],1000)
    attachBacklog(state,directory,saveState)
    compactJobs(state,0)
    prioritizeSlack(state,snapshot(),5000)
    const ownerKey=targetKey(target('cold')),sharedKey=targetKey(shared)
    assert.equal(state.backlog[ownerKey].priority,0)
    assert.equal(state.backlog[sharedKey].priority,1)
    assert.equal(Object.keys(state.jobs).length,0)
    prioritizeSlack(state,snapshot(),100001)
    assert.equal(state.backlog[ownerKey].priority,2)
    assert.equal(state.backlog[sharedKey].priority,2)
    restoreJob(state,ownerKey)
    assert.equal(state.jobs[ownerKey].priority,2)
    assert.equal(state.jobs[ownerKey].slackEvidence,null)
    assert.equal(state.jobs[ownerKey].target.slackMember,false)
  } finally {rmSync(directory,{recursive:true,force:true})}
})
