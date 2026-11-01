import { createHash } from 'node:crypto'
import { githubRequest,githubJson } from './github-api.mjs'
import { parseGithubIssue,githubIssue,githubIssueReaction } from './github-issues.mjs'

export const defaultPolicy = { version:1, mode:'draft', maxExternalPerDay:5, githubRepositories:[], githubUsers:[],githubIssues:[],githubMemberActions:[] }
const validGithubUser = value => typeof value==='string' && /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(value) && !value.includes('--')
export function validatePolicy(input) {
  if (input.version !== 1 || !['collect','draft','execute'].includes(input.mode) ||
    !Number.isInteger(input.maxExternalPerDay) || input.maxExternalPerDay < 1 || input.maxExternalPerDay > 20 ||
    !Array.isArray(input.githubRepositories) || input.githubRepositories.length > 100 ||
    input.githubRepositories.some(repo => typeof repo !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) || repo.split('/').some(part => part === '.' || part === '..'))) throw new Error('Invalid worker action policy')
  if (input.accountRevision !== undefined && !/^[a-f0-9]{64}$/.test(input.accountRevision)) throw new Error('Invalid policy account binding')
  const users=input.githubUsers??[]
  if (!Array.isArray(users) || users.length>100 || users.some(user=>!validGithubUser(user))) throw new Error('Invalid GitHub user allowlist')
  const issues=input.githubIssues??[]
  if(!Array.isArray(issues)||issues.length>100||issues.some(issue=>!parseGithubIssue(issue)))throw new Error('Invalid GitHub issue allowlist')
  const memberActions=input.githubMemberActions??[]
  if(!Array.isArray(memberActions)||memberActions.length>2||new Set(memberActions).size!==memberActions.length||memberActions.some(kind=>!['star','follow'].includes(kind)))throw new Error('Invalid GitHub member action scope')
  return {...input, githubRepositories:input.githubRepositories.map(repo=>repo.toLowerCase()),githubUsers:users.map(user=>user.toLowerCase()),githubIssues:issues.map(issue=>parseGithubIssue(issue).issue),githubMemberActions:memberActions}
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
export function githubUser(target) {
  try {
    const url=new URL(target.profileUrl ?? target.targetUrl)
    if (target.platform!=='github' || !['follow','inspect'].includes(target.eventType) || url.origin!=='https://github.com' || url.search || url.hash || url.username || url.password) return null
    const parts=url.pathname.split('/').filter(Boolean)
    return parts.length===1 && validGithubUser(parts[0])?parts[0].toLowerCase():null
  } catch {return null}
}
// Only a fresh, complete roster and an explicit public profile mapping can
// authorize member-wide actions. Queue priority and target attribution cannot.
function memberEvidence(snapshot,owner,at) {
  if(snapshot?.version!==1||!/^T[A-Z0-9]+$/.test(snapshot.workspaceId??'')||! /^[CG][A-Z0-9]+$/.test(snapshot.channelId??'')||
    !Number.isFinite(snapshot.observedAt)||!Number.isFinite(snapshot.expiresAt)||snapshot.observedAt>at||snapshot.expiresAt<=at||
    snapshot.expiresAt<=snapshot.observedAt||snapshot.expiresAt-snapshot.observedAt>86400000||
    !Array.isArray(snapshot.memberIds)||!Array.isArray(snapshot.identities))return null
  const identity=snapshot.identities.find(identity=>identity&&snapshot.memberIds.includes(identity.slackUserId)&&/^[UW][A-Z0-9]+$/.test(identity.slackUserId??'')&&
    Array.isArray(identity.profileUrls)&&identity.profileUrls.some(profileUrl=>githubUser({platform:'github',eventType:'inspect',profileUrl})===owner))
  return identity?{scope:'verified_slack_member',workspaceId:snapshot.workspaceId,channelId:snapshot.channelId,
    slackUserId:identity.slackUserId,owner,observedAt:snapshot.observedAt,expiresAt:snapshot.expiresAt}:null
}
export async function githubActor(options) {
  const {data}=await githubJson('/user',options)
  if(!Number.isSafeInteger(data?.id)||data.id<1||!validGithubUser(data.login))throw new Error('GitHub actor proof unavailable')
  return {id:data.id,username:data.login.toLowerCase()}
}
// Idempotent GitHub relationships use GET proof before and after PUT.
// https://docs.github.com/en/rest/activity/starring
// https://docs.github.com/en/rest/users/followers#follow-a-user
async function githubRelationship(path, { token, signal, request=fetch, now=Date.now,authorize=()=>true }) {
  const call=method=>githubRequest(`/user/${path}`,{token,signal,request,now,method})
  const before=await call('GET')
  await before.body?.cancel()
  if (before.status===204) return {verified:true,alreadyPresent:true}
  if (before.status!==404) throw new Error('Cannot verify GitHub relationship state')
  if(!authorize())throw Object.assign(new Error('Slack member action scope expired'),{code:'MEMBER_SCOPE_EXPIRED'})
  const write=await call('PUT')
  await write.body?.cancel()
  if (write.status!==204) throw Object.assign(new Error('GitHub relationship failed'),{code:[401,403].includes(write.status)?'GITHUB_PERMISSION_REQUIRED':'GITHUB_ACTION_FAILED'})
  const after=await call('GET')
  await after.body?.cancel()
  if (after.status!==204) throw new Error('GitHub relationship proof unavailable')
  return {verified:true,alreadyPresent:false}
}
export async function githubStar(repository, options) {
  if (!githubRepository({platform:'github',eventType:'star',profileUrl:`https://github.com/${repository}`})) throw new Error('Invalid GitHub repository')
  return {kind:'github_star',repository,...await githubRelationship(`starred/${repository}`,options)}
}
export async function githubFollow(username, options) {
  if (!validGithubUser(username)) throw new Error('Invalid GitHub username')
  return {kind:'github_follow',username,...await githubRelationship(`following/${username}`,options)}
}
export async function runActions({state,policy:input=defaultPolicy,now=Date.now,checkpoint=()=>{},signal,
  accountRevision,memberSnapshot,actorExternal=githubActor,external=githubStar,followExternal=githubFollow,reactionExternal=githubIssueReaction,token=process.env.INDIECORNS_GITHUB_TOKEN}) {
  const policy=validatePolicy(input)
  state.actions ??= {}
  if (policy.mode==='collect') return
  if (policy.mode==='execute' && accountRevision && policy.accountRevision!==accountRevision) {state.actionHealth='account_policy_mismatch';return}
  let briefsChanged=false
  let actor
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
    const username=githubUser(job.target)
    const issue=githubIssue(job.target)
    let action=repository && policy.githubRepositories.includes(repository)
      ? {kind:'github_star',subject:repository,field:'repository',execute:external}
      : username && policy.githubUsers.includes(username)
        ? {kind:'github_follow',subject:username,field:'username',execute:followExternal}
        : issue && policy.githubIssues.includes(issue)
          ? {kind:'github_issue_reaction',subject:issue,field:'issue',execute:reactionExternal}:null
    if(!action&&policy.mode==='execute') {
      const owner=repository?.split('/')[0]??username
      const kind=repository?'star':username?'follow':null
      const observationTarget={...job.target,profileUrl:job.observation.url}
      if(kind&&policy.githubMemberActions.includes(kind)&&memberEvidence(memberSnapshot,owner,now())&&
        (repository?githubRepository(observationTarget)===repository:githubUser(observationTarget)===username))
        action=repository?{kind:'github_star',subject:repository,field:'repository',execute:external,memberOwner:owner}
          :{kind:'github_follow',subject:username,field:'username',execute:followExternal,memberOwner:owner}
    }
    if ((state.externalNextAttemptAt ?? 0)>now() || policy.mode!=='execute' || !action) continue
    const actionKey=digest(`${action.kind}:${action.subject}`)
    const previous=state.actions[actionKey]
    if (previous?.status==='completed' || (previous?.retryAt ?? 0)>now()) continue
    const day=new Date(now()).toISOString().slice(0,10)
    if (state.actionBudget?.day!==day) state.actionBudget={day,attempts:0}
    if (state.actionBudget.attempts>=policy.maxExternalPerDay) continue
    if (!token) {state.actionHealth='github_credential_required';continue}
    let authorization
    if(action.memberOwner) {
      if(!accountRevision||policy.accountRevision!==accountRevision){state.actionHealth='account_policy_mismatch';continue}
      try {
        actor??=await actorExternal({token,signal,now})
        if(!Number.isSafeInteger(actor?.id)||actor.id<1||!validGithubUser(actor.username))throw new Error('GitHub actor proof unavailable')
      } catch(error) {
        state.actionHealth=error.code==='GITHUB_PERMISSION_REQUIRED'?'github_permission_required':'github_actor_unverified'
        state.externalNextAttemptAt=now()+Math.max(60000,error.retryAfterMs??60000)
        checkpoint()
        break
      }
      // Recheck expiry after the actor read. Never auto-follow or auto-star self.
      const membership=memberEvidence(memberSnapshot,action.memberOwner,now())
      if(actor.username.toLowerCase()===action.memberOwner||!membership)continue
      authorization={...membership,githubActorId:actor.id,accountRevision,authorizedAt:now()}
    }
    // Reserve quota and persist intent before writing. A restart rechecks remote
    // state before repeating this idempotent operation; it cannot replay a message.
    // Actor verification may cross midnight; charge the day of the reservation.
    const reservationDay=new Date(now()).toISOString().slice(0,10)
    if(state.actionBudget.day!==reservationDay)state.actionBudget={day:reservationDay,attempts:0}
    if(state.actionBudget.attempts>=policy.maxExternalPerDay)continue
    state.actionBudget.attempts++
    state.actions[actionKey]={kind:action.kind,jobKey:job.key,status:'executing',startedAt:now(),...(authorization?{authorization}:{})}
    checkpoint()
    try {
      const proof=await action.execute(action.subject,{token,signal,now,
        ...(action.memberOwner?{authorize:()=>Boolean(memberEvidence(memberSnapshot,action.memberOwner,now()))&&actor.username.toLowerCase()!==action.memberOwner}:{})})
      if (proof?.verified!==true || proof[action.field]!==action.subject || proof.kind!==action.kind) throw new Error('Unverified action result')
      if(action.kind==='github_issue_reaction' && (proof.content!=='+1'||!Number.isSafeInteger(proof.actorId)||proof.actorId<1||!Number.isSafeInteger(proof.reactionId)||proof.reactionId<1))throw new Error('Unverified reaction receipt')
      state.actions[actionKey]={kind:action.kind,jobKey:job.key,status:'completed',completedAt:now(),proof,...(authorization?{authorization}:{})}
      state.actionHealth=null
    } catch (error) {
      const retryAt=now()+Math.max(3600000,error.retryAfterMs ?? 0)
      if (error.retryAfterMs) state.externalNextAttemptAt=retryAt
      state.actions[actionKey]={kind:action.kind,jobKey:job.key,status:'unverified',retryAt,...(authorization?{authorization}:{})}
      state.actionHealth=error.code==='GITHUB_PERMISSION_REQUIRED'?'github_permission_required':error.code==='MEMBER_SCOPE_EXPIRED'?'member_scope_expired':'external_action_unverified'
    }
    checkpoint()
  }
  if (briefsChanged) checkpoint()
}
