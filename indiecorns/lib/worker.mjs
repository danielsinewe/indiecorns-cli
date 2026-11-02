import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, renameSync, openSync, fsyncSync, closeSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { attachBacklog, restoreJob, restoreDueJobs, compactJobs, backlogSchedule, dueOrder, collectBacklogGarbage } from './backlog.mjs'
import { retainWorkerState } from './retention.mjs'
import { acquireWorkerGuard } from './worker-lock.mjs'
import { startHealthMonitor } from './health.mjs'
import { githubIssue } from './github-issues.mjs'
import {configureStorageBudget,reserveStorageWrite} from './storage.mjs'

const read = (path, fallback) => {
  try { return JSON.parse(readFileSync(path, 'utf8')) }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error }
}
// A corrupted state must never silently reset deduplication or action history.
export function saveState(path, state) {
  const contents=JSON.stringify(state)
  const committed=reserveStorageWrite(path,Buffer.byteLength(contents))
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    const fd = openSync(temporary, 'wx', 0o600)
    try { writeFileSync(fd, contents); fsyncSync(fd) }
    finally { closeSync(fd) }
    renameSync(temporary, path)
    committed()
  }finally{rmSync(temporary,{force:true})}
}
export function targetKey(target) {
  const url = new URL(target.profileUrl ?? target.targetUrl)
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Unsupported target URL')
  url.hash = ''
  // Preserve case-sensitive paths and query strings.
  return createHash('sha256').update(JSON.stringify([
    target.platform, target.eventType, url.href.replace(/\/$/, '')
  ])).digest('hex')
}
export function enqueue(state, targets, now) {
  const candidates = targets.map(raw => {
    const target = Object.fromEntries(['platform', 'eventType', 'targetType', 'targetSource', 'userId', 'username',
      'displayName', 'profileUrl', 'targetUrl', 'source', 'discoveredFrom', 'attribution', 'sharedBySlackUserId', 'slackChannelId', 'slackMessageUrl'].flatMap(key =>
      typeof raw[key] === 'string' ? [[key, raw[key].slice(0, key.toLowerCase().includes('url') || key === 'discoveredFrom' ? 2048 : 256)]] : []))
    target.slackMember = raw.slackMember === true
    if(githubIssue(target))target.targetType='post'
    return {key: targetKey(target), target}
  })
  for (const { key, target } of candidates) {
    restoreJob(state,key)
    const existing = state.jobs[key]
    if (existing) {
      // Membership evidence can change while a target remains in the queue.
      existing.target = {...existing.target,...target}
      existing.target.slackMember = target.slackMember
      existing.priority = target.slackMember ? 0 : 1
      existing.lastDiscoveredAt = now
      continue
    }
    state.jobs[key] = { key, target, status: 'queued', discoveredAt: now,lastDiscoveredAt:now,
      priority: target.slackMember ? 0 : 1 }
  }
}
export async function runWorker({ directory, discover, once = false, intervalMs = 300000,
  signal, now = Date.now, onCycle = () => {}, authRevision, discoveryRevision, observe, deriveTargets, derivationRevision = 1, act, prioritize, observationLimit = 5 }) {
  if (!Number.isFinite(intervalMs) || intervalMs < 1000) throw new Error('Interval must be at least 1000ms')
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const releaseGuard=await acquireWorkerGuard(directory)
  let releaseBudget=()=>{}
  const lock = join(directory, 'worker.lock')
  const owner = randomUUID()
  let diagnosticOwned=false
  let health
  let state
  const path = join(directory, 'state.json')
  try {
    releaseBudget=configureStorageBudget(directory)
    // Do not overlap a pre-release worker that predates the SQLite guard. New
    // metadata is diagnostic only; stale/reused PIDs cannot prevent recovery.
    const previous=read(lock,null)
    if(previous && previous.guard!=='sqlite-v1') {
      try {process.kill(previous.pid,0);throw new Error('Worker already running')}
      catch(error){if(error.code!=='ESRCH')throw error}
    }
    saveState(lock,{pid:process.pid,owner,guard:'sqlite-v1'})
    diagnosticOwned=true
    state = read(path, { version: 1, failures: 0, nextPollAt: 0, jobs: {} })
    if (state.version !== 1 || !state.jobs) throw new Error('Unsupported worker state')
    attachBacklog(state,directory,saveState)
    health=startHealthMonitor({directory,session:owner,state,now,onStatus:status=>{state.healthHistoryStatus=status}})
    if (authRevision && state.authRevision !== authRevision) {
      state.nextPollAt = 0
      state.discovery = {}
      state.authRevision = authRevision
    }
    if (discoveryRevision && state.discoveryRevision !== discoveryRevision && !state.lastError && !(state.retryAfterMs > 0)) state.nextPollAt = 0
    do {
      if (signal?.aborted) break
      if (state.nextPollAt <= now()) {
        health.progress('discover')
        state.retryAfterMs = 0
        try {
          const result = await discover(signal,state.discovery ?? {},(targets,progress)=>{
            enqueue(state,targets,now())
            state.discovery=progress
            health.progress('discover')
            saveState(path,state)
          })
          const targets = Array.isArray(result) ? result : result.targets
          if (!Array.isArray(targets)) throw new Error('Discovery must return targets')
          enqueue(state, targets, now())
          if (result.progress) state.discovery=result.progress
          state.discoveryRevision = discoveryRevision
          state.sources = result.sources ?? []
          state.partial = result.partial === true
          state.retryAfterMs = result.retryAfterMs ?? 0
          state.failures = state.partial && !result.continuation ? state.failures + 1 : 0
          state.continuation = result.continuation === true
          if (!state.partial) state.lastSuccessAt = now()
          state.lastError = state.partial && !state.continuation ? 'partial_discovery' : null
        } catch (error) {
          if (signal?.aborted) break
          state.failures++
          // Persist only classified errors, never tokens, response bodies or URLs.
          state.lastError = error.code === 'AUTH_REQUIRED' ? 'auth_required' : error.code === 'QUEUE_CAPACITY' ? 'queue_capacity' : 'discovery_failed'
        }
        state.lastPollAt = now()
        state.nextPollAt = now() + Math.max(state.retryAfterMs ?? 0, state.continuation && !state.lastError ? Math.min(intervalMs,5000) : Math.min(3600000, intervalMs * 2 ** Math.min(state.failures, 10)))
      }
      if (prioritize) {
        health.progress('prioritize')
        try { await prioritize(state, signal, () => {health.progress('prioritize');saveState(path, state)}) }
        catch {
          if (signal?.aborted) break
          state.slackHealth = 'source_unavailable'
          state.priorityNextPollAt = now() + 300000
          for (const job of [...Object.values(state.jobs),...Object.values(state.backlog)]) {
            job.target.slackMember = false
            job.slackEvidence = null
            job.priority = 2
            job.priorityReason = 'community_target'
          }
        }
      }
      // Select cold work using the current roster, including newly mapped owners.
      restoreDueJobs(state,now(),observationLimit)
      state.pending = Object.values(state.jobs).filter(job => job.status === 'queued')
        .sort((a, b) => a.priority - b.priority || a.discoveredAt - b.discoveredAt).map(job => job.key)
      // Save discovery and scheduling before any outbound page request.
      saveState(path, state)
      if (observe && state.lastError !== 'auth_required') {
        state.hosts ??= {}
        const due = state.pending.map(key => state.jobs[key]).filter(job => !job.nextObserveAt || job.nextObserveAt <= now()).sort(dueOrder)
        for (const job of due.slice(0, observationLimit)) {
          if (signal?.aborted) break
          try {
            health.progress('observe')
            job.observation = await observe(job.target, state.hosts, signal, () => {health.progress('observe');saveState(path, state)})
            job.observationFailures = 0
            job.nextObserveAt = now() + (job.target.targetType==='listing'?900000:21600000)
            job.observationError = null
          } catch (error) {
            if (signal?.aborted) break
            job.observationFailures = (job.observationFailures ?? 0) + 1
            job.nextObserveAt = error.retryAt ?? now() + Math.min(86400000, 60000 * 2 ** Math.min(job.observationFailures, 10))
            job.observationError = error.code === 'HOST_DELAY' ? 'host_cooldown' : 'observation_failed'
          }
          saveState(path, state)
        }
      }
      if (deriveTargets) {
        health.progress('derive')
        for (const job of Object.values(state.jobs)) {
          if (job.observation?.status !== 'observed' ||
            (job.observation.observedAt && now()-job.observation.observedAt>21600000) ||
            (job.derivedFromHash === job.observation.contentHash && job.derivationRevision === derivationRevision)) continue
          try {
            enqueue(state, deriveTargets(job.target, job.observation), now())
            job.derivedFromHash = job.observation.contentHash
            job.derivationRevision = derivationRevision
            job.derivationError = null
          } catch { job.derivationError = 'candidate_processing_failed' }
        }
      }
      state.pending = Object.values(state.jobs).filter(job => job.status === 'queued')
        .sort((a, b) => a.priority - b.priority || a.discoveredAt - b.discoveredAt).map(job => job.key)
      saveState(path, state)
      if (act && state.lastError !== 'auth_required' && !signal?.aborted) {
        health.progress('act')
        try { await act(state, signal, () => {health.progress('act');saveState(path, state)}) }
        catch { state.actionHealth = 'action_configuration_failed' }
        saveState(path, state)
      }
      const sweep=retainWorkerState(state,now())
      compactJobs(state)
      state.pending=state.pending.filter(key=>state.jobs[key])
      saveState(path,state)
      if (sweep) {
        try {state.retention.filesRemoved=collectBacklogGarbage(state);state.retention.health=null}
        catch {state.retention.health='cleanup_deferred';state.retention.nextSweepAt=now()+3600000}
        saveState(path,state)
      }
      health.progress('cycle')
      onCycle({ pending: state.pending.length + Object.keys(state.backlog).length, loaded:state.pending.length,
        backlog:Object.keys(state.backlog).length, lastError: state.lastError, nextPollAt: state.nextPollAt })
      if (once) return state
      const dueObservations = observe && state.lastError !== 'auth_required'
        ? [...Object.values(state.jobs).filter(job => job.status === 'queued').map(job => job.nextObserveAt ?? now()),...backlogSchedule(state)] : []
      const wakeAt = dueObservations.reduce((earliest,due)=>Math.min(earliest,due),Math.min(state.nextPollAt,state.priorityNextPollAt ?? Infinity))
      health.progress('sleep',wakeAt)
      await sleep(Math.max(100, wakeAt - now()), undefined, {signal})
        .catch(error => { if (error.name !== 'AbortError') throw error })
    } while (!signal?.aborted)
    return state
  } catch(error) {
    if(error.code==='STORAGE_CAPACITY'&&state)state.lastError='storage_capacity'
    throw error
  } finally {
    releaseBudget()
    try {health?.stop()}
    finally {
      try {if(diagnosticOwned && read(lock,null)?.owner===owner)rmSync(lock)}
      finally {releaseGuard()}
    }
  }
}
export const workerStatus = directory => ({
  lock: read(join(directory, 'worker.lock'), null),
  state: read(join(directory, 'state.json'), null),
  storage: read(join(directory,'storage-health.json'),null),
})
