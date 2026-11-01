import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// The state index is committed alongside scheduling and action receipts. Cold
// payloads are written first and retained on promotion, so either side of a
// crash still has the payload referenced by the last committed state.
const stores = new WeakMap()
export function attachBacklog(state, directory, write) {
  state.backlog ??= {}
  stores.set(state, { directory:join(directory, 'queue'), write })
}
const payloadPath = (store, key) => {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid backlog key')
  return join(store.directory, key.slice(0, 2), `${key}.json`)
}
export function restoreJob(state, key) {
  if (!state.backlog?.[key]) return
  const store=stores.get(state)
  if (!store) throw new Error('Backlog storage unavailable')
  const job=JSON.parse(readFileSync(payloadPath(store,key),'utf8'))
  if (job.key!==key || !job.target) throw new Error('Invalid backlog payload')
  state.jobs[key]=job
  delete state.backlog[key]
}
const schedule = job => ({key:job.key, priority:job.priority, discoveredAt:job.discoveredAt,
  status:job.status, nextObserveAt:job.nextObserveAt ?? 0})
export const dueOrder = (a,b) => a.priority-b.priority ||
  (a.nextObserveAt ?? 0)-(b.nextObserveAt ?? 0) || a.discoveredAt-b.discoveredAt || a.key.localeCompare(b.key)
export function restoreDueJobs(state, now, limit) {
  const due=[...Object.values(state.jobs),...Object.values(state.backlog ?? {})]
    .filter(job=>job.status==='queued' && (job.nextObserveAt ?? 0)<=now).sort(dueOrder)
  for (const job of due.slice(0,limit)) restoreJob(state,job.key)
}
export function compactJobs(state, limit=2000) {
  const store=stores.get(state)
  const jobs=Object.values(state.jobs)
  if (jobs.length<=limit) return
  if (!store) throw new Error('Backlog storage unavailable')
  // Keep the most urgent jobs loaded. All other work remains scheduled in the
  // index; this is storage compaction, not completion or target eviction.
  jobs.sort(dueOrder)
  for (const job of jobs.slice(limit)) {
    const path=payloadPath(store,job.key)
    mkdirSync(join(store.directory,job.key.slice(0,2)),{recursive:true,mode:0o700})
    store.write(path,job)
    state.backlog[job.key]=schedule(job)
    delete state.jobs[job.key]
  }
}
export const backlogSchedule = state => Object.values(state.backlog ?? {})
  .filter(job=>job.status==='queued').map(job=>job.nextObserveAt ?? 0)
