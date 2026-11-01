import { createHash } from 'node:crypto'
import { retryDelay } from './discovery.mjs'

export const defaultPolicy = { version:1, mode:'draft', maxExternalPerDay:5, githubRepositories:[] }
export function validatePolicy(input) {
  if (input.version !== 1 || !['collect','draft','execute'].includes(input.mode) ||
    !Number.isInteger(input.maxExternalPerDay) || input.maxExternalPerDay < 1 || input.maxExternalPerDay > 20 ||
    !Array.isArray(input.githubRepositories) || input.githubRepositories.length > 100 ||
    input.githubRepositories.some(repo => typeof repo !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) || repo.split('/').some(part => part === '.' || part === '..'))) throw new Error('Invalid worker action policy')
  if (input.accountRevision !== undefined && !/^[a-f0-9]{64}$/.test(input.accountRevision)) throw new Error('Invalid policy account binding')
  return {...input, githubRepositories:input.githubRepositories.map(repo=>repo.toLowerCase())}
}
const digest = value => createHash('sha256').update(value).digest('hex')
export function supportBrief(job) {
  if (job.observation?.status !== 'observed') return null
  return {kind:'support_brief', targetUrl:job.observation.url,
    title:job.observation.title, description:job.observation.description,
    observedAt:job.observation.observedAt, contentHash:job.observation.contentHash,
    attribution:job.target.attribution ?? 'community_target',
    suggestedAction:job.target.eventType === 'inspect' ? 'Read the project and decide whether to support it.' : `Review this target before ${job.target.eventType}.`,
    externallyPublished:false}
}
export function githubRepository(target) {
  try {
    const url=new URL(target.profileUrl ?? target.targetUrl)
    if (target.platform !== 'github' || !['star','inspect'].includes(target.eventType) || url.origin !== 'https://github.com' || url.search || url.hash || url.username || url.password) return null
    const parts=url.pathname.split('/').filter(Boolean)
    if (parts.length !== 2 || parts.some(part=>! /^[A-Za-z0-9_.-]+$/.test(part) || part === '.' || part === '..')) return null
    return parts.join('/').toLowerCase()
  } catch {return null}
}
// The only external write adapter currently available is an idempotent GitHub star.
// API reference: https://docs.github.com/en/rest/activity/starring
export async function githubStar(repository, { token, signal, request=fetch }) {
  if (!token) throw Object.assign(new Error('GitHub credential required'),{code:'CREDENTIAL_REQUIRED'})
  const url=`https://api.github.com/user/starred/${repository}`
  const headers={Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10'}
  const call=async method=>{
    const response=await request(url,{method,headers:{...headers,...(method==='PUT'?{'Content-Length':'0'}:{})},redirect:'error',
      signal:AbortSignal.any([signal ?? new AbortController().signal,AbortSignal.timeout(30000)])})
    if (response.status===429 || (response.status===403 && response.headers.has('retry-after'))) {
      const retryAfterMs=retryDelay(response.headers.get('retry-after'))
      await response.body?.cancel()
      throw Object.assign(new Error('GitHub rate limited'),{retryAfterMs})
    }
    return response
  }
  const before=await call('GET')
  await before.body?.cancel()
  if (before.status===204) return {kind:'github_star',repository,verified:true,alreadyPresent:true}
  if (before.status!==404) throw new Error('Cannot verify GitHub star state')
  const write=await call('PUT')
  await write.body?.cancel()
  if (write.status!==204) throw new Error('GitHub star failed')
  const after=await call('GET')
  await after.body?.cancel()
  if (after.status!==204) throw new Error('GitHub star proof unavailable')
  return {kind:'github_star',repository,verified:true,alreadyPresent:false}
}
export async function runActions({state,policy:input=defaultPolicy,now=Date.now,checkpoint=()=>{},signal,
  accountRevision,external=githubStar,token=process.env.INDIECORNS_GITHUB_TOKEN}) {
  const policy=validatePolicy(input)
  state.actions ??= {}
  if (policy.mode==='collect') return
  if (policy.mode==='execute' && accountRevision && policy.accountRevision!==accountRevision) {state.actionHealth='account_policy_mismatch';return}
  let briefsChanged=false
  const jobs=Object.values(state.jobs).sort((a,b)=>a.priority-b.priority || a.discoveredAt-b.discoveredAt)
  for (const job of jobs) {
    if (signal?.aborted) break
    const brief=supportBrief(job)
    if (!brief) continue
    const key=digest(`brief:${job.key}`)
    if (!state.actions[key] || state.actions[key].proof?.contentHash !== brief.contentHash) {
      state.actions[key]={kind:'support_brief',jobKey:job.key,status:'completed',completedAt:now(),proof:brief}
      briefsChanged=true
    }
    const repository=githubRepository(job.target)
    if ((state.externalNextAttemptAt ?? 0)>now() || policy.mode!=='execute' || !repository || !policy.githubRepositories.includes(repository)) continue
    const actionKey=digest(`github_star:${repository}`)
    const previous=state.actions[actionKey]
    if (previous?.status==='completed' || (previous?.retryAt ?? 0)>now()) continue
    const day=new Date(now()).toISOString().slice(0,10)
    if (state.actionBudget?.day!==day) state.actionBudget={day,attempts:0}
    if (state.actionBudget.attempts>=policy.maxExternalPerDay) continue
    if (!token) {state.actionHealth='github_credential_required';continue}
    // Reserve quota and persist intent before writing. A restart rechecks remote
    // state before repeating this idempotent operation; it cannot replay a message.
    state.actionBudget.attempts++
    state.actions[actionKey]={kind:'github_star',jobKey:job.key,status:'executing',startedAt:now()}
    checkpoint()
    try {
      const proof=await external(repository,{token,signal})
      if (proof?.verified!==true || proof.repository!==repository || proof.kind!=='github_star') throw new Error('Unverified action result')
      state.actions[actionKey]={kind:'github_star',jobKey:job.key,status:'completed',completedAt:now(),proof}
      state.actionHealth=null
    } catch (error) {
      const retryAt=now()+Math.max(3600000,error.retryAfterMs ?? 0)
      if (error.retryAfterMs) state.externalNextAttemptAt=retryAt
      state.actions[actionKey]={kind:'github_star',jobKey:job.key,status:'unverified',retryAt}
      state.actionHealth='external_action_unverified'
    }
    checkpoint()
  }
  if (briefsChanged) checkpoint()
}
