import { boundedText, retryDelay } from './discovery.mjs'

const id = (value, prefix) => typeof value === 'string' && new RegExp(`^${prefix}[A-Z0-9]+$`).test(value)
export function validateSlackEvidence(value) {
  if (value?.version !== 1 || !id(value.workspaceId,'T') || !id(value.channelId,'[CG]') ||
    !Array.isArray(value.memberIds) || value.memberIds.length > 10000 || value.memberIds.some(member=>!id(member,'[UW]')) ||
    !Number.isFinite(value.observedAt) || !Number.isFinite(value.expiresAt) || value.expiresAt <= value.observedAt ||
    value.expiresAt-value.observedAt > 86400000 || !Array.isArray(value.identities) || value.identities.length>10000) throw new Error('Invalid Slack membership evidence')
  for (const identity of value.identities) {
    if (!id(identity.slackUserId,'[UW]') || !Array.isArray(identity.profileUrls) || identity.profileUrls.length>10 || !Array.isArray(identity.targets) || identity.targets.length>20) throw new Error('Invalid Slack identity mapping')
    for (const address of identity.profileUrls) {
      const url=new URL(address)
      if (url.protocol!=='https:' || url.username || url.password || url.search || url.hash || address.length>2048) throw new Error('Invalid mapped profile URL')
    }
  }
  return value
}
export function slackMembership(snapshot, target, now=Date.now()) {
  if (!snapshot || snapshot.observedAt>now || snapshot.expiresAt<=now) return null
  const url=new URL(target.profileUrl ?? target.targetUrl)
  const members=new Set(snapshot.memberIds)
  for (const identity of snapshot.identities) {
    if (!members.has(identity.slackUserId)) continue
    for (const profile of identity.profileUrls) {
      const owner=new URL(profile)
      const path=owner.pathname.replace(/\/$/,'')
      if (owner.origin===url.origin && (url.pathname===path || url.pathname.startsWith(`${path}/`))) return {
        workspaceId:snapshot.workspaceId,channelId:snapshot.channelId,slackUserId:identity.slackUserId,
        observedAt:snapshot.observedAt,expiresAt:snapshot.expiresAt,
      }
    }
  }
  return null
}
export function slackSeedTargets(snapshot, now=Date.now()) {
  if (!snapshot || snapshot.observedAt>now || snapshot.expiresAt<=now) return []
  const members=new Set(snapshot.memberIds)
  return snapshot.identities.filter(identity=>members.has(identity.slackUserId)).flatMap(identity=>identity.targets)
    .filter(target=>slackMembership(snapshot,target,now)).map(target=>({...target,slackMember:true,source:'slack_member_shared'}))
}
export function prioritizeSlack(state, snapshot, now=Date.now()) {
  for (const job of Object.values(state.jobs)) {
    const evidence=slackMembership(snapshot,job.target,now)
    job.slackEvidence=evidence
    job.target.slackMember=Boolean(evidence)
    job.priority=evidence?0:1
  }
  state.slackHealth=!snapshot?'not_configured':snapshot.expiresAt<=now || snapshot.observedAt>now?'evidence_expired':'verified'
  state.slackMemberCount=state.slackHealth==='verified'?snapshot.memberIds.length:0
}
// Read-only Slack Web API. Credentials never appear in URLs or stored snapshots.
// https://docs.slack.dev/reference/methods/conversations.members/
export async function refreshSlackEvidence({ snapshot:input,token,request=fetch,signal,now=Date.now }) {
  const snapshot=validateSlackEvidence(input)
  if (!token) throw new Error('Slack credential required')
  const call=async(method,parameters={})=>{
    const response=await request(`https://slack.com/api/${method}`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams(parameters).toString(),redirect:'error',signal:AbortSignal.any([signal ?? new AbortController().signal,AbortSignal.timeout(30000)])})
    if (response.status===429) {
      const retryAfterMs=retryDelay(response.headers.get('retry-after'))
      await response.body?.cancel()
      throw Object.assign(new Error('Slack rate limited'),{code:'SLACK_RATE_LIMIT',retryAfterMs})
    }
    if (!response.ok) {await response.body?.cancel();throw new Error('Slack membership unavailable')}
    const data=JSON.parse(await boundedText(response))
    if (!data.ok) throw new Error('Slack membership unavailable')
    return data
  }
  const auth=await call('auth.test')
  if (auth.team_id!==snapshot.workspaceId) throw new Error('Slack workspace mismatch')
  const memberIds=new Set()
  const cursors=new Set()
  let cursor=''
  do {
    const data=await call('conversations.members',{channel:snapshot.channelId,limit:'200',...(cursor?{cursor}:{})})
    if (!Array.isArray(data.members)) throw new Error('Invalid Slack member response')
    for (const member of data.members) memberIds.add(member)
    if (memberIds.size>10000) throw new Error('Slack roster capacity reached')
    cursor=data.response_metadata?.next_cursor?.trim() ?? ''
    if (cursor && cursors.has(cursor)) throw new Error('Repeated Slack cursor')
    cursors.add(cursor)
  } while(cursor)
  const activeMembers=[]
  for (const member of memberIds) {
    const data=await call('users.info',{user:member})
    if (data.user?.id!==member || typeof data.user.is_bot!=='boolean' || typeof data.user.deleted!=='boolean') throw new Error('Invalid Slack user response')
    if (!data.user.is_bot && !data.user.deleted) activeMembers.push(member)
  }
  const updated={...snapshot,source:'slack_web_api',memberIds:activeMembers,observedAt:now(),expiresAt:now()+86400000}
  return validateSlackEvidence(updated)
}
