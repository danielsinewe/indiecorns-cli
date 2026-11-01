const DAY=86400000
export const retentionDays=30

// Retire inactive, successfully observed targets. External receipts outlive
// targets: rediscovery must never reset remote-action deduplication or quota.
export function retainWorkerState(state, now) {
  if ((state.retention?.nextSweepAt ?? 0)>now) return false
  const cutoff=now-retentionDays*DAY
  const unfinished=new Set(Object.values(state.actions ?? {})
    .filter(action=>action.kind!=='support_brief' && action.status!=='completed').map(action=>action.jobKey))
  let retired=0,briefs=0,hosts=0
  for (const jobs of [state.jobs,state.backlog ?? {}]) {
    for (const [key,job] of Object.entries(jobs)) {
      const observed=job.observation?.status==='observed' || job.observed===true
      const lastSeen=job.lastDiscoveredAt ?? job.discoveredAt
      if (!observed || unfinished.has(key) || !Number.isFinite(lastSeen) || lastSeen>=cutoff) continue
      delete jobs[key]
      retired++
    }
  }
  for (const [key,action] of Object.entries(state.actions ?? {})) {
    if (action.kind==='support_brief' && action.completedAt<cutoff &&
      !state.jobs[action.jobKey] && !state.backlog?.[action.jobKey]) {
      delete state.actions[key]
      briefs++
    }
  }
  // An expired robots cache and elapsed host delay can be safely fetched anew.
  for (const [key,host] of Object.entries(state.hosts ?? {})) {
    if ((host.robots?.expiresAt ?? 0)<=now && (host.nextRequestAt ?? 0)<=now) {
      delete state.hosts[key]
      hosts++
    }
  }
  state.retention={days:retentionDays,lastSweepAt:now,nextSweepAt:now+DAY,retired,briefs,hosts}
  return true
}
