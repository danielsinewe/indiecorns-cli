import { createHash } from 'node:crypto'
import { boundedText, retryDelay } from './discovery.mjs'
import { supportInboxReport } from './support-inbox.mjs'

const platforms = new Map([
  ['peerlist',['peerlist.io',/^\/[a-z0-9_-]+\/project\/[a-z0-9_-]+$/i]],
  ['producthunt',['producthunt.com',/^\/(?:posts|products)\/[a-z0-9_-]+$/i]],
  ['x',['x.com',/^\/[a-z0-9_]+\/status\/\d+$/i]],
  ['linkedin',['linkedin.com',/^\/(?:posts\/[a-z0-9_-]+|feed\/update\/urn:li:(?:activity|share|ugcPost):\d+)$/i]],
])
const receiptsLimit = 1000
const minute = 60000
const id = value => typeof value === 'string' && /^[a-zA-Z0-9_:.+=/-]{1,128}$/.test(value)
const revision = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const postFields = 'id channelId text status dueAt sentAt'
const channelFields = 'id organizationId serviceId service isDisconnected isLocked isQueuePaused allowedActions'
const statusCodes = new Set(['sending','scheduled','needs_approval','draft','error','sent'])
const deniedCreateTypes = new Set(['NotFoundError','UnauthorizedError','LimitReachedError','InvalidInputError'])
const readyChannelServices = new Set(['linkedin','twitter','bluesky','mastodon','threads'])
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')

export function validateSupportSharing(value) {
  if (value === undefined || (value && value.enabled === false && Object.keys(value).length === 1)) return {enabled:false}
  const keys = ['enabled','enabledAt','provider','accountRevision','accountId','organizationId','channelId','serviceId','platforms','textTemplate']
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key)) ||
      value.enabled !== true || !Number.isSafeInteger(value.enabledAt) || value.enabledAt <= 0 ||
      value.provider !== 'buffer' || !revision(value.accountRevision) || !id(value.accountId) || !id(value.organizationId) ||
      !id(value.channelId) || !id(value.serviceId) || !Array.isArray(value.platforms) ||
      value.platforms.length === 0 || new Set(value.platforms).size !== value.platforms.length ||
      value.platforms.some(platform => !platforms.has(platform)) || typeof value.textTemplate !== 'string' ||
      value.textTemplate.length > 240 || value.textTemplate.trim() !== value.textTemplate || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(value.textTemplate) ||
      !/(?:^|\s)\{url\}(?:$|\s)/.test(value.textTemplate) || value.textTemplate.split('{url}').length !== 2 ||
      value.textTemplate.replace('{url}','').trim().length < 8) throw new Error('Invalid automatic support sharing policy')
  return {enabled:true,enabledAt:value.enabledAt,provider:'buffer',accountRevision:value.accountRevision,accountId:value.accountId,organizationId:value.organizationId,
    channelId:value.channelId,serviceId:value.serviceId,
    platforms:[...value.platforms].sort(),textTemplate:value.textTemplate}
}

const bufferError = (code, retryAfterMs) => Object.assign(new Error(code), {code,retryAfterMs})
async function callBuffer(query, variables, {token,signal,request,now}) {
  if (typeof token !== 'string' || !token || /[\r\n]/.test(token)) throw bufferError('buffer_credential_required')
  const response = await request('https://api.buffer.com', {
    method:'POST', redirect:'error', headers:{Authorization:`Bearer ${token}`,Accept:'application/json','Content-Type':'application/json'},
    body:JSON.stringify({query,variables}), signal:AbortSignal.any([signal ?? new AbortController().signal,AbortSignal.timeout(15000)]),
  })
  if (!response.ok) {
    if (response.status===429 || response.status===503) {
      const delay = retryDelay(response.headers.get('retry-after'),now())
      await response.body?.cancel()
      throw bufferError('buffer_rate_limited', delay)
    }
    await response.body?.cancel()
    throw bufferError([401,403].includes(response.status)?'buffer_permission_required':'buffer_unavailable')
  }
  const body = JSON.parse(await boundedText(response, 32768))
  if (!body?.data || typeof body.data !== 'object' || (body.errors && (!Array.isArray(body.errors) || body.errors.length))) {
    throw bufferError('buffer_unavailable')
  }
  return body.data
}

const eligibleChannel = (channel,organizationId) => id(channel?.id) && channel.organizationId===organizationId &&
  id(channel.serviceId) && readyChannelServices.has(channel.service) && channel.isDisconnected===false &&
  channel.isLocked===false && channel.isQueuePaused===false && Array.isArray(channel.allowedActions) &&
  channel.allowedActions.includes('scheduleUpdates')

export async function listBufferDestinations({token,signal,request=fetch,now=Date.now}={}) {
  const call = (query,variables) => callBuffer(query,variables,{token,signal,request,now})
  const {account} = await call('query IndiecornsBufferAccount { account { id organizations { id } } }',{})
  if (!id(account?.id) || !Array.isArray(account.organizations) || account.organizations.length>10 ||
      account.organizations.some(org=>!id(org?.id))) throw bufferError('buffer_unavailable')
  const destinations = []
  for (const organizationId of new Set(account.organizations.map(org=>org.id))) {
    const {channels} = await call(`query IndiecornsBufferChannels($input: ChannelsInput!) { channels(input:$input) { ${channelFields} name } }`,{input:{organizationId}})
    if (!Array.isArray(channels) || channels.length>100) throw bufferError('buffer_unavailable')
    for (const channel of channels) if (eligibleChannel(channel,organizationId)) {
      destinations.push({organizationId,channelId:channel.id,serviceId:channel.serviceId,service:channel.service,
        name:typeof channel.name==='string' ? channel.name.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,'').slice(0,128) : ''})
    }
  }
  return {accountId:account.id,destinations}
}

function exactTarget(request) {
  try {
    const url = new URL(request.targetUrl)
    const [host,path] = platforms.get(request.platform)
    return url.href === request.targetUrl && url.protocol === 'https:' && !url.username && !url.password &&
      !url.port && !url.search && !url.hash && !/[?#]/.test(request.targetUrl) && request.targetUrl.length <= 512 &&
      url.hostname === host && path.test(url.pathname)
  } catch { return false }
}

function scopedReady(state, context, now) {
  if (!context || state.slackSource !== 'community_feed' || state.communityFeed?.health !== 'ok') return null
  const snapshot = state.communityFeed.snapshot
  const inbox = state.supportInbox
  if (!inbox?.actorId || !snapshot || snapshot.observedAt > now || snapshot.expiresAt <= now || !Array.isArray(snapshot.memberIds)) return null
  const report = supportInboxReport(inbox,{...context,now,includeRequests:true})
  return report.status === 'ready' ? {inbox,snapshot,report} : null
}

function verifyPost(post, receipt) {
  if (post?.id !== receipt.postId || post.channelId !== receipt.channelId || digest(post.text) !== receipt.textHash || !statusCodes.has(post.status)) {
    throw bufferError('buffer_unverified')
  }
  if (post.status === 'sent' && !Number.isFinite(Date.parse(post.sentAt))) throw bufferError('buffer_unverified')
  return {status:post.status === 'error' ? 'failed' : post.status,
    ...(post.status === 'sent' ? {sentAt:post.sentAt} : {}),
    ...(post.status === 'scheduled' && Number.isFinite(Date.parse(post.dueAt)) ? {dueAt:post.dueAt} : {})}
}

export async function runSupportShares({state,policy,accountRevision,inboxContext,authorize,
  token,signal,checkpoint=()=>{},now=Date.now,request=fetch}) {
  const rule = validateSupportSharing(policy?.supportSharing)
  if (!rule.enabled || policy.mode === 'collect' || signal?.aborted) return
  if (!revision(accountRevision) || accountRevision !== rule.accountRevision) return
  const setHealth = value => {
    if (state.supportSharingHealth?.accountRevision === accountRevision && state.supportSharingHealth.status === value) return
    state.supportSharingHealth = {accountRevision,status:value}
    checkpoint()
  }
  if (typeof token !== 'string' || !token || /[\r\n]/.test(token)) return setHealth('buffer_credential_required')
  const scope = scopedReady(state,inboxContext,now())
  if (!scope) return setHealth('community_sync_required')
  if (typeof authorize !== 'function') return setHealth('authorization_required')
  const isCurrent = request => {
    const fresh = scopedReady(state,inboxContext,now())
    if (!fresh || fresh.inbox.scopedBinding !== scope.inbox.scopedBinding || signal?.aborted) return false
    if (!fresh.report.requests.some(value => value.id === request.id && value.targetUrl === request.targetUrl &&
       value.status === 'review_available' && value.requestedActions.includes('share') &&
       value.createdAt>=rule.enabledAt && value.createdAt<=now() &&
       value.requesterSlackUserId===request.requesterSlackUserId && fresh.snapshot.memberIds.includes(value.requesterSlackUserId))) return false
    try { return authorize({rule,accountRevision,requestId:request.id,targetUrl:request.targetUrl,scopedBinding:scope.inbox.scopedBinding}) === true }
    catch {return false}
  }
  const memberIdentity = [new URL(inboxContext.appUrl).origin,scope.inbox.actorId]
  const memberKey = digest(memberIdentity)
  const identity = [...memberIdentity,rule.accountId,rule.organizationId,rule.channelId,rule.serviceId]
  const accountKey = digest(identity)
  state.supportShares ??= {}
  state.providerNextAttemptAt ??= {}
  if ((state.providerNextAttemptAt.buffer ?? 0) > now()) return setHealth('buffer_cooldown')
  const call = (query,variables) => callBuffer(query,variables,{token,signal,request,now})
  const checkAccount = async () => {
    const {account} = await call('query IndiecornsBufferAccount { account { id organizations { id } } }',{})
    if (account?.id !== rule.accountId || !Array.isArray(account.organizations) || !account.organizations.some(org=>org?.id===rule.organizationId)) {
      throw bufferError('buffer_account_mismatch')
    }
  }
  const coolDown = error => {
    state.providerNextAttemptAt.buffer = now() + Math.max(5 * minute,error?.retryAfterMs ?? 0)
    setHealth(['buffer_account_mismatch','buffer_channel_unavailable','buffer_permission_required','buffer_rate_limited'].includes(error?.code) ? error.code : 'buffer_unavailable')
    checkpoint()
  }
  const readPost = async receipt => {
    const {post} = await call(`query IndiecornsBufferPost($input: PostInput!) { post(input: $input) { ${postFields} } }`,{input:{id:receipt.postId}})
    const proof = verifyPost(post,receipt)
    Object.assign(receipt,proof,{checkedAt:now(),nextCheckAt:now()+15*minute})
    checkpoint()
  }
  // A saved post ID permits bounded readback after a crash, even after the
  // original Slack request has expired. Never repeat the create mutation.
  const pending = Object.values(state.supportShares).find(receipt=>receipt.accountKey===accountKey && id(receipt.postId) &&
    ['submitting','uncertain','scheduled','sending','draft','needs_approval'].includes(receipt.status) && (receipt.nextCheckAt ?? 0)<=now())
  if (pending) {
    try { await checkAccount(); await readPost(pending); setHealth('ready') }
    catch (error) { pending.nextCheckAt=now()+Math.max(15*minute,error?.retryAfterMs??0);coolDown(error) }
    return
  }
  const candidates = scope.report.requests.filter(value=>value.status==='review_available' && value.createdAt>=rule.enabledAt && value.createdAt<=now() &&
    rule.platforms.includes(value.platform) &&
    value.source==='slack_launch_request' && value.requestedActions.includes('share') &&
    scope.snapshot.memberIds.includes(value.requesterSlackUserId) && exactTarget(value) &&
    !state.supportShares[digest([...identity,value.targetUrl])])
  if (!candidates.length) return setHealth(scope.report.needsLinkCount ? 'needs_link' : 'ready')
  if (Object.keys(state.supportShares).length >= receiptsLimit) return setHealth('receipt_capacity_reached')
  const isSpaced = ()=>!Object.values(state.supportShares).some(receipt=>receipt.memberKey===memberKey &&
    receipt.startedAt>now()-60*minute)
  if (!isSpaced()) return setHealth('share_cooldown')
  const budgetDay = () => new Date(now()).toISOString().slice(0,10)
  const budgetAvailable = day=>state.actionBudget?.day!==day || state.actionBudget.attempts < policy.maxExternalPerDay
  if (!budgetAvailable(budgetDay())) return setHealth('daily_quota_reached')
  if (!candidates.some(isCurrent)) return setHealth('authorization_required')
  let channel
  try {
    await checkAccount()
    ;({channel}=await call(`query IndiecornsBufferChannel($input: ChannelInput!) { channel(input:$input) { ${channelFields} } }`,{input:{id:rule.channelId}}))
    if (!eligibleChannel(channel,rule.organizationId) || channel.id!==rule.channelId || channel.serviceId!==rule.serviceId) {
      throw bufferError('buffer_channel_unavailable')
    }
  } catch (error) { coolDown(error);return }
  // Skip oversized copy for this destination without blocking later requests.
  const fitting=candidates.map(item=>({item,text:rule.textTemplate.replace('{url}',()=>item.targetUrl)}))
    .filter(({text})=>[...text].length<=({twitter:280,bluesky:300,mastodon:500,threads:500,linkedin:3000})[channel.service])
  if (!fitting.length) return setHealth('buffer_text_too_long')
  const picked=fitting.find(({item})=>isCurrent(item))
  if (!picked) return setHealth('authorization_required')
  const {item,text}=picked
  const day = budgetDay()
  if (!budgetAvailable(day)) return setHealth('daily_quota_reached')
  if (!isSpaced()) return setHealth('share_cooldown')
  const key=digest([...identity,item.targetUrl])
  if (state.supportShares[key]) return
  if (state.actionBudget?.day!==day) state.actionBudget={day,attempts:0}
  state.actionBudget.attempts++
  const receipt = state.supportShares[key] = {action:'share',accountKey,memberKey,accountRevision,requestId:item.id,platform:item.platform,channelId:rule.channelId,
    textHash:digest(text),status:'submitting',startedAt:now()}
  checkpoint()
  if (!isCurrent(item)) {
    receipt.status='revoked';checkpoint();return setHealth('authorization_required')
  }
  try {
    const {createPost} = await call('mutation IndiecornsBufferShare($input: CreatePostInput!) { createPost(input: $input) { __typename ... on PostActionSuccess { post { id channelId } } } }',
      {input:{text,channelId:rule.channelId,schedulingType:'automatic',mode:'shareNow'}})
    if (deniedCreateTypes.has(createPost?.__typename)) {
      receipt.status='failed'
      if(createPost.__typename==='LimitReachedError') return coolDown(bufferError('buffer_rate_limited',60*minute))
      if(createPost.__typename==='UnauthorizedError') return coolDown(bufferError('buffer_permission_required'))
      setHealth('buffer_post_rejected')
      checkpoint()
      return
    }
    if (createPost?.__typename!=='PostActionSuccess' || !id(createPost?.post?.id) || createPost.post.channelId!==rule.channelId) {
      throw bufferError('buffer_unverified')
    }
    receipt.postId=createPost.post.id
    checkpoint()
    await readPost(receipt)
    setHealth('ready')
  } catch (error) {
    receipt.status='uncertain'
    receipt.nextCheckAt=now()+15*minute
    coolDown(error)
  }
}

export function supportSharingStatus(state,{accountRevision,policy,includeReceipts=false}={}) {
  const receipts = revision(accountRevision) ? Object.values(state?.supportShares ?? {}).filter(value=>value.accountRevision===accountRevision) : []
  const counts = {}
  for (const receipt of receipts) {
    const status=receipt.status==='submitting' && !receipt.postId ? 'uncertain' : receipt.status
    if (['submitting','uncertain','scheduled','sending','draft','needs_approval','sent','failed','revoked'].includes(status)) counts[status]=(counts[status]??0)+1
  }
  const enabled = Boolean(revision(accountRevision) && policy?.supportSharing?.enabled &&
    policy.supportSharing.accountRevision===accountRevision)
  const health = enabled && state?.supportSharingHealth?.accountRevision===accountRevision ? state.supportSharingHealth.status : null
  const status = !enabled ? 'disabled' : policy.mode === 'collect' ? 'paused_by_collect_mode' : health ?? 'awaiting_sync'
  return {action:'share',enabled,status,counts,
    ...(includeReceipts ? {receipts:receipts.slice(-50).reverse().map(({requestId,platform,status,postId,checkedAt,dueAt,sentAt})=>({
      action:'share',requestId,platform,status:status==='submitting' && !postId ? 'uncertain' : status,postId,checkedAt,dueAt,sentAt,
    }))} : {})}
}
