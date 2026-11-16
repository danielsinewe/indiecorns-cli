import {createHash} from 'node:crypto'
import {boundedText,retryDelay} from './discovery.mjs'
import {validateSlackEvidence} from './slack.mjs'
import {enqueue} from './worker.mjs'
import {credentialContext} from './auth-context.mjs'
import {safeDiscoveryError} from './discovery-errors.mjs'
import {sourceRetryDelay} from './network-recovery.mjs'
import {ingestSupportFeed,supportFeedState} from './support-inbox.mjs'

const supportHistoryMs = 7 * 86400000
const slackTime = ms => `${Math.floor(ms / 1000)}.${String(ms % 1000 * 1000).padStart(6,'0')}`
const micros = value => BigInt(String(value).replace('.',''))

function advanceSupportCatchup(feed, inbox, nextCursor, now) {
  const catchup=feed.supportCatchup
  if(inbox?.status!=='ready') {
    if(catchup?.status==='scanning')catchup.status='pending'
    return
  }
  if(catchup?.scope===inbox.scopedBinding) {
    if(!nextCursor && ['scanning','running'].includes(catchup.status))catchup.status='complete'
    return
  }
  const oldest=slackTime(Math.max(0,now-supportHistoryMs))
  // A legacy mid-page cursor may already have passed requests on earlier pages.
  const covered=!feed.cursor && micros(feed.oldest)<=micros(oldest)
  feed.supportCatchup={scope:inbox.scopedBinding,oldest,
    status:covered?(nextCursor?'scanning':'complete'):'pending'}
}

// Community authentication authorizes this feed. Provider credentials remain on
// the community server; clients retain only membership proof and link jobs.
export async function syncCommunityFeed({state,appUrl,endpoint='/api/community/worker-feed',headers,
  signal,request=fetch,now=Date.now,checkpoint=()=>{},headerAliases=[],expectedActorId,enableSupport=true}) {
  const url=new URL(endpoint,appUrl)
  if(url.origin!==new URL(appUrl).origin)throw new Error('Invalid community feed origin')
  const binding=createHash('sha256').update(JSON.stringify([url.href,credentialContext(headers)])).digest('hex')
  const legacy=[headers,...headerAliases].map(h=>createHash('sha256').update(JSON.stringify([url.href,h])).digest('hex'))
  if(legacy.includes(state.communityFeed?.binding))state.communityFeed.binding=binding
  if(state.communityFeed?.binding!==binding)state.communityFeed={binding,cursor:'',oldest:'0',latest:'0.000000',nextPollAt:0}
  const feed=state.communityFeed
  if(feed.nextPollAt>now())return feed.snapshot??null
  feed.nextPollAt=now()+60000
  if(enableSupport && feed.supportCatchup?.status==='pending' && !feed.cursor) {
    feed.supportCatchup.status='running'
  }
  checkpoint()
  if(!headers){
    feed.health='auth_required'
    state.lastError='auth_required'
    state.supportInbox=supportFeedState(state.supportInbox,{appUrl,headers,status:'auth_required',now:now()})
    checkpoint()
    return null
  }
  if(enableSupport)url.searchParams.set('support','1')
  const catchingUp=enableSupport && feed.supportCatchup?.status==='running'
  url.searchParams.set('oldest',catchingUp?feed.supportCatchup.oldest:feed.oldest)
  if(feed.cursor)url.searchParams.set('cursor',feed.cursor)
  try {
    delete feed.httpStatus
    const response=await request(url,{headers,redirect:'error',
      signal:AbortSignal.any([signal??new AbortController().signal,AbortSignal.timeout(30000)])})
    if(!response.ok){
      feed.httpStatus=response.status
      if([401,403].includes(response.status))state.lastError='auth_required'
      if(response.status===409 && feed.cursor){
        await response.body?.cancel()
        feed.cursor=''
        feed.recent=[]
        throw Object.assign(new Error('Community feed cursor expired'),{code:'cursor_reset',retryAfterMs:60000})
      }
      const retryAfterMs=response.headers.has('retry-after')?retryDelay(response.headers.get('retry-after')):response.status===404?3600000:300000
      await response.body?.cancel()
      throw Object.assign(new Error('Community feed unavailable'),{retryAfterMs,code:[401,403].includes(response.status)?'auth_required':response.status===429?'rate_limited':'feed_unavailable'})
    }
    const body=JSON.parse(await boundedText(response))
    let snapshot
    try { snapshot=validateSlackEvidence(body.snapshot) }
    catch { throw Object.assign(new Error('Invalid community membership'),{code:'invalid_feed'}) }
    if(body.version!==1 || snapshot.observedAt>now() || snapshot.expiresAt<=now() ||
      !Array.isArray(body.targets) || body.targets.length>3000 || typeof body.cursor!=='string' || body.cursor.length>512 ||
      !/^\d{1,12}\.\d{6}$/.test(body.latest??''))throw Object.assign(new Error('Invalid community feed'),{code:'invalid_feed'})
    const recent=feed.recent??[]
    if(body.cursor && (body.cursor===feed.cursor || recent.includes(body.cursor)))throw Object.assign(new Error('Repeated community feed cursor'),{code:'invalid_feed'})
    let supportInbox
    try {
      if(enableSupport)supportInbox=ingestSupportFeed(state.supportInbox,{appUrl,headers,support:body.support,snapshot,expectedActorId,now:now()})
    } catch {
      throw Object.assign(new Error('Invalid launch request feed'),{code:'invalid_feed'})
    }
    if(catchingUp && supportInbox.status!=='ready') {
      state.supportInbox=supportInbox
      feed.nextPollAt=now()+(feed.cursor?60000:300000)
      feed.snapshot=snapshot
      feed.health='ok'
      delete feed.error
      checkpoint()
      return snapshot
    }
    if(catchingUp && feed.supportCatchup.scope!==supportInbox.scopedBinding) {
      // A changed server actor must replay this window from the start.
      feed.supportCatchup={scope:supportInbox.scopedBinding,oldest:feed.supportCatchup.oldest,status:'running'}
      feed.cursor=''
      feed.recent=[]
      state.supportInbox=supportInbox
      checkpoint()
      return snapshot
    }
    // Ingestion and cursor movement share one state checkpoint. A crash before
    // that commit can repeat a read but cannot skip a page of targets.
    enqueue(state,body.targets,now())
    if(enableSupport) {
      state.supportInbox=supportInbox
      advanceSupportCatchup(feed,supportInbox,body.cursor,now())
    }
    const latest=micros(body.latest)>micros(feed.latest)?body.latest:feed.latest
    feed.recent=body.cursor?[...recent,...(feed.cursor?[feed.cursor]:[])].slice(-64):[]
    feed.snapshot=snapshot
    feed.latest=latest
    feed.cursor=body.cursor
    if(!feed.cursor)feed.oldest=latest
    feed.nextPollAt=now()+(feed.cursor?60000:300000)
    feed.health='ok'
    delete feed.httpStatus
    delete feed.error
    checkpoint()
  } catch(error) {
    if(enableSupport)state.supportInbox=supportFeedState(state.supportInbox,{appUrl,headers,
      status:error.code==='auth_required'?'auth_required':'unavailable',now:now()})
    feed.health=['auth_required','rate_limited','feed_unavailable','invalid_feed','cursor_reset'].includes(error.code)?error.code:'feed_unavailable'
    feed.error={...safeDiscoveryError(error),...(feed.httpStatus?{httpStatus:feed.httpStatus}:{}),at:now()}
    feed.nextPollAt=now()+Math.max(60000,sourceRetryDelay(error))
    checkpoint()
  }
  return feed.snapshot??null
}
