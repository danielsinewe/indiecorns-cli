import { setTimeout as sleep } from 'node:timers/promises'

export const discoverySources = [
  ...['peerlist', 'x', 'linkedin', 'producthunt'].map(platform => ({ platform, eventType: 'follow', targetSource: 'profiles' })),
  ...['x', 'linkedin'].flatMap(platform => ['like', 'reshare', 'comment'].map(eventType => ({ platform, eventType, targetSource: 'posts' }))),
  ...['upvote', 'rate'].map(eventType => ({ platform: 'peerlist', eventType, targetSource: 'projects' })),
  { platform: 'producthunt', eventType: 'upvote', targetSource: 'projects' },
]
export function retryDelay(value, now = Date.now()) {
  if (!value) return 60000
  const seconds = Number(value)
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now
  return Number.isFinite(delay) ? Math.max(1000, Math.min(delay, 86400000)) : 60000
}
export async function boundedText(response, limit = 2097152) {
  if (Number(response.headers.get('content-length')) > limit) throw new Error('Response too large')
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Missing response body')
  const chunks = []
  let total = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > limit) throw new Error('Response too large')
      chunks.push(value)
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
  return Buffer.concat(chunks).toString('utf8')
}
export const discoverySourceKey = source => `${source.platform}/${source.eventType}/${source.targetSource}`
export async function discoverCommunity({ appUrl, endpoint, headers, signal, request = fetch,
  progress = {}, onPage, maxPagesPerSource = 2,
  pause = (ms, signal) => sleep(ms, undefined, { signal }) }) {
  if (!headers) throw Object.assign(new Error('Authentication required'), { code: 'AUTH_REQUIRED' })
  if (!Number.isInteger(maxPagesPerSource) || maxPagesPerSource<1 || maxPagesPerSource>5) throw new Error('Invalid discovery page budget')
  const targets = [],sources = []
  let currentProgress=progress,requests=0
  const continuing=discoverySources.some(source=>progress[discoverySourceKey(source)]?.cursor!=null)
  const result=extra=>({targets,sources,progress:currentProgress,
    partial:sources.some(source=>source.status!=='ok'),
    continuation:sources.some(source=>source.status==='paging') && sources.every(source=>['ok','paging'].includes(source.status)),...extra})
  for (const source of discoverySources) {
    const key=discoverySourceKey(source)
    if(continuing && currentProgress[key]?.complete===true) {sources.push({...source,status:'ok',count:0});continue}
    let cursor=currentProgress[key]?.cursor ?? null
    let recent=currentProgress[key]?.recent ?? []
    if ((cursor!==null && (typeof cursor!=='string' || cursor.length>512)) ||
      !Array.isArray(recent) || recent.length>64 || recent.some(value=>typeof value!=='string' || value.length>512)) {
      sources.push({...source,status:'invalid_progress'});continue
    }
    let count=0
    for(let page=0;page<maxPagesPerSource;page++) {
      if(requests++) await pause(250,signal)
      const url = new URL(endpoint, appUrl)
      if (url.origin !== new URL(appUrl).origin) throw new Error('Invalid API origin')
      for (const [name,value] of Object.entries({...source,limit:'200'})) url.searchParams.set(name,value)
      if(cursor!==null) url.searchParams.set('cursor',cursor)
      const response = await request(url, { headers, redirect: 'error',
        signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(30000)]) })
      if ([401,403].includes(response.status)) throw Object.assign(new Error('Authentication required'),{code:'AUTH_REQUIRED'})
      if ([429,503].includes(response.status)) {
        const retryAfterMs=retryDelay(response.headers.get('retry-after'))
        await response.body?.cancel()
        sources.push({...source,status:'rate_limited',count})
        return result({retryAfterMs,partial:true})
      }
      if(!response.ok) {
        await response.body?.cancel()
        sources.push({...source,status:'failed',count});break
      }
      const body=JSON.parse(await boundedText(response))
      if(!Array.isArray(body.targets) || body.targets.length>200) throw new Error('Invalid discovery response')
      const pagination=body.pagination
      const paginated=pagination!==undefined
      if(paginated && (typeof pagination?.hasMore!=='boolean' ||
        (pagination.hasMore ? typeof pagination.nextCursor!=='string' || !pagination.nextCursor || pagination.nextCursor.length>512 || body.targets.length===0 : pagination.nextCursor!==null))) {
        sources.push({...source,status:'invalid_pagination',count});break
      }
      const nextCursor=paginated?pagination.nextCursor:null
      if(nextCursor!==null && (nextCursor===cursor || recent.includes(nextCursor))) {
        sources.push({...source,status:'repeated_cursor',count});break
      }
      const pageTargets=body.targets.map(target=>({...target,targetSource:source.targetSource}))
      if(!paginated && cursor!==null) {
        // A backend rollback must not silently reset a scan in progress.
        targets.push(...pageTargets)
        sources.push({...source,status:'pagination_unavailable',count:count+pageTargets.length});break
      }
      const nextRecent=nextCursor===null?[]:[...recent,...(cursor===null?[]:[cursor])].slice(-64)
      const nextProgress={...currentProgress,[key]:{cursor:nextCursor,recent:nextRecent,complete:nextCursor===null}}
      // The worker checkpoints targets and cursor together before requesting
      // another page. A crash can repeat a GET, never skip uncommitted targets.
      if(onPage) await onPage(pageTargets,nextProgress)
      currentProgress=nextProgress
      targets.push(...pageTargets)
      count+=pageTargets.length
      recent=nextRecent
      cursor=nextCursor
      if(!paginated || cursor===null) {
        sources.push({...source,status:!paginated && body.targets.length===200?'capacity_limited':'ok',count,
          atCapacity:!paginated && body.targets.length===200});break
      }
      if(page===maxPagesPerSource-1) sources.push({...source,status:'paging',count})
    }
  }
  if(discoverySources.every(source=>currentProgress[discoverySourceKey(source)]?.complete===true)) currentProgress={}
  return result()
}
