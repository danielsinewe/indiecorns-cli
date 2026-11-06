import {spawn} from 'node:child_process'
import {readFileSync,existsSync} from 'node:fs'
import {join,isAbsolute} from 'node:path'
import {parse} from 'parse5'
import {createHash} from 'node:crypto'
import {boundedText,retryDelay} from './discovery.mjs'
import {credentialContext} from './auth-context.mjs'
import {scrapeTarget} from './scraper.mjs'
import {profileIdentity,canonicalPost,validatePostObservation} from './post-discovery-contract.mjs'

// Extract only exact authored permalinks. Relative age labels and activity hints
// are not posts; recommendations and reposted content cannot establish authorship.
export function extractMemberPosts(html,task,now=Date.now()) {
  const author=profileIdentity(task.platform,task.profileUrl)
  if(!author)throw new Error('Invalid profile')
  const posts=new Map(),stack=[parse(html)]
  while(stack.length) {
    const node=stack.pop(),attrs=Object.fromEntries((node.attrs??[]).map(a=>[a.name,a.value]))
    if(node.tagName==='a'&&attrs.href) {
      try {
        const value=new URL(attrs.href,task.checkUrl).href
        // Feed URNs contain no author. Only a containing card with an exact
        // author profile can associate them; this conservative parser leaves
        // those for a signed-in agent observation.
        const url=canonicalPost(task.platform,value,author)
        const hasAuthor=task.platform==='x'||new URL(value).pathname.startsWith(`/posts/${author}_`)
        if(url&&hasAuthor)posts.set(url,{url,authorProfileUrl:task.profileUrl})
      } catch {}
    }
    stack.push(...(node.childNodes??[]))
  }
  return {status:posts.size?'observed':'unavailable',observedAt:now,posts:[...posts.values()].slice(0,20)}
}
export async function discoveryApi({appUrl,headers,body,request=fetch,signal}) {
  if(!headers)throw Object.assign(new Error('Authentication required'),{code:'AUTH_REQUIRED'})
  const response=await request(new URL('/api/community/worker-feed',appUrl),{method:'POST',headers:{...headers,'Content-Type':'application/json'},
    redirect:'error',signal:AbortSignal.any([signal??new AbortController().signal,AbortSignal.timeout(30000)]),body:JSON.stringify(body)})
  if(!response.ok) {
    const retryAfterMs=retryDelay(response.headers.get('retry-after'))
    await response.body?.cancel()
    throw Object.assign(new Error('Post discovery unavailable'),{httpStatus:response.status,retryAfterMs})
  }
  return JSON.parse(await boundedText(response,32768))
}
export async function syncPostDiscovery({state,directory,appUrl,headers,request=fetch,signal,checkpoint=()=>{},now=Date.now,
  observe=async(task,hosts,checkpoint)=> {
    if(directory&&existsSync(join(directory,'post-reader.json')))return localPostReader({directory,task,signal})
    let html=''
    const {publicPage}=await import('./scraper.mjs')
    const observation=await scrapeTarget({target:{profileUrl:task.checkUrl},hosts,signal,checkpoint,
      request:async(url,options)=>{const response=await publicPage(url,options);if(url.href===task.checkUrl)html=response.text;return response}})
    if(observation.status==='observed'&&(/<title[^>]*>[^<]*(?:sign in|log in|login|security verification)/i.test(html)||/name=["']session_key["']/i.test(html)))return {status:'auth_required',observedAt:now(),posts:[]}
    return observation.status==='observed'?extractMemberPosts(html,task):{
      status:[401,403,999].includes(observation.httpStatus)||observation.status==='redirect_requires_review'?'auth_required':observation.status==='robots_denied'?'blocked':'unavailable',observedAt:now(),posts:[]}
  }}) {
  const binding=createHash('sha256').update(JSON.stringify([appUrl,credentialContext(headers)])).digest('hex')
  if(state.postDiscovery?.binding!==binding)state.postDiscovery={binding,nextPollAt:0}
  const discovery=state.postDiscovery
  if(discovery.nextPollAt>now())return
  discovery.nextPollAt=now()+300000
  checkpoint()
  const call=body=>discoveryApi({appUrl,headers,body,request,signal})
  try {
    if(discovery.pendingReport) {
      try {await call({operation:'report',...discovery.pendingReport})}
      catch(error) {if(error.httpStatus!==409)throw error}
      delete discovery.pendingReport
      delete discovery.task
      checkpoint()
    }
    if(!discovery.task||discovery.task.expiresAt<=now()) {
      delete discovery.task
      const response=await call({operation:'claim',platforms:['linkedin','x']})
      if(response.version!==1)throw new Error('Invalid discovery contract')
      if(!response.task){discovery.health='idle';checkpoint();return}
      const task=response.task
      if(typeof task.leaseToken!=='string'||!profileIdentity(task.platform,task.profileUrl)||
        !Number.isSafeInteger(task.expiresAt)||task.expiresAt<=now()||task.expiresAt>now()+180000||
        task.checkUrl!==(task.platform==='linkedin'?task.profileUrl.replace(/\/$/,'')+'/recent-activity/all/':task.profileUrl))throw new Error('Invalid discovery task')
      discovery.task=task
      checkpoint()
    }
    const task=discovery.task
    // A robots fetch can reserve the host cooldown. Keep this lease and resume
    // after that cooldown rather than marking a healthy source unavailable.
    const observation=validatePostObservation(task,await observe(task,state.hosts??={},checkpoint),now())
    discovery.pendingReport={leaseToken:task.leaseToken,...observation}
    discovery.sourceStatus=observation.status
    discovery.lastObservationAt=observation.observedAt
    discovery.lastPostCount=observation.posts.length
    checkpoint()
    await call({operation:'report',...discovery.pendingReport})
    discovery.health=observation.status
    delete discovery.pendingReport
    delete discovery.task
  } catch(error) {
    if(signal?.aborted)return
    if(error.code==='HOST_DELAY') {
      discovery.health='host_cooldown'
      discovery.nextPollAt=error.retryAt
    } else {
      discovery.health=[401,403].includes(error.httpStatus)?'auth_required':error.httpStatus===404?'server_upgrade_required':'unavailable'
      discovery.nextPollAt=now()+Math.max(300000,error.retryAfterMs??0)
      if(error.httpStatus===404)discovery.nextPollAt=now()+3600000
    }
  }
  checkpoint()
}

export function validateReaderConfig(config) {
  if(!config||!isAbsolute(config.command)||!Array.isArray(config.args)||config.args.length>32||
    config.args.some(a=>typeof a!=='string'||a.length>2048))throw new Error('Reader requires an absolute executable and an args array')
  return {command:config.command,args:config.args}
}
// Opt-in local adapter only: the server never sends executable commands. A host
// may use its permitted signed-in browser; no cookies or credentials are copied.
export function localPostReader({directory,task,signal}) {
  const config=validateReaderConfig(JSON.parse(readFileSync(join(directory,'post-reader.json'),'utf8')))
  return new Promise((resolve,reject)=>{
    const child=spawn(config.command,config.args,{shell:false,windowsHide:true,stdio:['pipe','pipe','ignore'],signal,
      timeout:90000,killSignal:'SIGKILL'})
    const chunks=[];let length=0
    child.on('error',reject)
    child.stdin.on('error',()=>{})
    child.stdout.on('data',chunk=>{length+=chunk.length;if(length>32768){child.kill('SIGKILL');reject(new Error('Reader output exceeds 32 KB'))}else chunks.push(chunk)})
    child.on('close',code=>{
      if(code!==0){reject(new Error('Local reader unavailable'));return}
      try{resolve(validatePostObservation(task,JSON.parse(Buffer.concat(chunks).toString('utf8'))))}catch(error){reject(error)}
    })
    child.stdin.end(JSON.stringify({version:1,platform:task.platform,profileUrl:task.profileUrl,checkUrl:task.checkUrl})+'\n')
  })
}
