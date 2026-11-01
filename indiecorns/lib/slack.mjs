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
  const profile=(address)=>{
    const url=new URL(address), host=url.hostname.replace(/^www\./,'')
    const platform=({'peerlist.io':'peerlist','github.com':'github','x.com':'x','twitter.com':'x','linkedin.com':'linkedin','producthunt.com':'producthunt'})[host] ?? 'website'
    const parts=url.pathname.split('/').filter(Boolean)
    return {platform,eventType:'inspect',targetType:'profile',profileUrl:address,username:platform==='linkedin'?parts[1]:parts[0],source:'slack_member_profile'}
  }
  return snapshot.identities.filter(identity=>members.has(identity.slackUserId)).flatMap(identity=>[...identity.targets,...identity.profileUrls.map(profile)])
    .filter(target=>slackMembership(snapshot,target,now)).map(target=>({...target,slackMember:true,source:target.source ?? 'slack_member_shared'}))
}
export function prioritizeSlack(state, snapshot, now=Date.now()) {
  for (const job of Object.values(state.jobs)) {
    const evidence=slackMembership(snapshot,job.target,now)
    const shared=Boolean(snapshot && snapshot.observedAt<=now && snapshot.expiresAt>now &&
      job.target.slackChannelId===snapshot.channelId && snapshot.memberIds.includes(job.target.sharedBySlackUserId))
    job.slackEvidence=evidence
    job.target.slackMember=Boolean(evidence)
    job.priority=evidence?0:shared?1:2
    job.priorityReason=evidence?'verified_slack_owner':shared?'slack_member_shared':'community_target'

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
  let workspaceUrl=snapshot.workspaceUrl
  if (typeof auth.url==='string') {
    const candidate=new URL(auth.url)
    if (candidate.protocol==='https:' && candidate.hostname.endsWith('.slack.com') && !candidate.username && !candidate.password) workspaceUrl=candidate.origin
  }
  const observedAt=now()
  const updated={...snapshot,workspaceUrl,source:'slack_web_api',memberIds:activeMembers,observedAt,expiresAt:observedAt+86400000}
  return validateSlackEvidence(updated)
}

export function sharedTargets(messages, snapshot, now=Date.now()) {
  validateSlackEvidence(snapshot)
  if (snapshot.expiresAt<=now || snapshot.observedAt>now) return []
  const targets=new Map()
  for (const message of messages) {
    if (!/^\d+\.\d{6}$/.test(message.ts ?? '')) continue
    const fragments=[]
    const walk=(value,key='',depth=0)=>{
      if(depth>12 || fragments.length>=1000) return
      if(typeof value==='string' && ['text','url','title_link','author_link','from_url','original_url','fallback'].includes(key)) fragments.push(value)
      else if(Array.isArray(value)) for(const item of value) walk(item,key,depth+1)
      else if(value && typeof value==='object') for(const [child,item] of Object.entries(value)) walk(item,child,depth+1)
    }
    walk({text:message.text,attachments:message.attachments,blocks:message.blocks})
    const links=new Set([...fragments.join(' ').matchAll(/https:\/\/[^\s<>|]+/g)].map(match=>match[0].replace(/&amp;/g,'&')))

    for (const value of links) {
      try {
        const url=new URL(value)
        if (url.username || url.password || url.port || url.href.length>2048) continue
        const host=url.hostname.replace(/^www\./,'')
        const segments=url.pathname.split('/').filter(Boolean)
        let platform='website',targetType='link'
        if (host==='peerlist.io') {platform='peerlist';targetType=segments.includes('project')?'project':segments.includes('post')?'post':'profile'}
        if (host==='x.com' || host==='twitter.com') {platform='x';targetType=segments.includes('status')?'post':'profile'}
        if (host==='linkedin.com') {platform='linkedin';targetType=segments.includes('posts') || segments.includes('feed')?'post':'profile'}
        if (host==='producthunt.com') {platform='producthunt';targetType=segments[0]==='posts'?'project':segments[0]==='p'?'post':'link'}
        if (host==='github.com') {platform='github';targetType=segments.length===2?'project':'link'}
        url.hash=''
        targets.set(url.href,{platform,eventType:'inspect',targetType,profileUrl:url.href,
          ...(['peerlist','x'].includes(platform) && segments[0] && !['scroll','search','explore','home'].includes(segments[0]) ? {username:segments[0]} : {}),source:'slack_channel_shared',
          attribution:'shared_link_owner_unverified',sharedBySlackUserId:message.user,slackChannelId:snapshot.channelId,
          slackMessageUrl:snapshot.workspaceUrl?`${snapshot.workspaceUrl}/archives/${snapshot.channelId}/p${message.ts.replace('.','')}`:`https://app.slack.com/client/${snapshot.workspaceId}/${snapshot.channelId}`})
      } catch {}
    }
  }
  return [...targets.values()]
}

export async function discoverSlackShared({snapshot:input,token,cursor='',oldest='0',request=fetch,signal,now=Date.now()}) {
  const snapshot=validateSlackEvidence(input)
  if (snapshot.expiresAt<=now || snapshot.observedAt>now) throw new Error('Fresh Slack membership required')
  if (!token) throw new Error('Slack credential required')
  const response=await request('https://slack.com/api/conversations.history',{method:'POST',
    headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({channel:snapshot.channelId,limit:'100',oldest,inclusive:'false',...(cursor?{cursor}:{})}).toString(),redirect:'error',
    signal:AbortSignal.any([signal ?? new AbortController().signal,AbortSignal.timeout(30000)])})
  if(response.status===429) {
    const retryAfterMs=retryDelay(response.headers.get('retry-after'))
    await response.body?.cancel()
    throw Object.assign(new Error('Slack history rate limited'),{retryAfterMs})
  }
  if(!response.ok){await response.body?.cancel();throw new Error('Slack history unavailable')}
  const data=JSON.parse(await boundedText(response))
  if(!data.ok || !Array.isArray(data.messages)) {
    const code=['not_in_channel','missing_scope','channel_not_found','invalid_auth','token_revoked'].includes(data.error)?data.error:'history_unavailable'
    throw Object.assign(new Error('Slack history unavailable'),{code})
  }
  if (data.has_more && !data.response_metadata?.next_cursor?.trim()) throw new Error('Slack history pagination incomplete')
  const timestamps=data.messages.map(message=>message.ts).filter(ts=>/^\d+\.\d{6}$/.test(ts ?? ''))
  const latest=timestamps.reduce((a,b)=>BigInt(b.replace('.',''))>BigInt(a.replace('.',''))?b:a,'0.000000')
  return {targets:sharedTargets(data.messages,snapshot,now),cursor:data.response_metadata?.next_cursor?.trim() ?? '',latest}
}
