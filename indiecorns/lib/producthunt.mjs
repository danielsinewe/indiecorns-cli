import {createHash} from 'node:crypto'
import {boundedText,retryDelay} from './discovery.mjs'

export const validProducthuntUsername=value=>typeof value==='string'&&/^[A-Za-z0-9_][A-Za-z0-9_-]{0,59}$/.test(value)
export const validProducthuntId=value=>typeof value==='string'&&/^[A-Za-z0-9:./+=_-]{1,128}$/.test(value)
export function producthuntUser(target) {
  try {
    const url=new URL(target.profileUrl??target.targetUrl)
    if(target.platform!=='producthunt'||!['follow','inspect'].includes(target.eventType)||url.protocol!=='https:'||
      !['producthunt.com','www.producthunt.com'].includes(url.hostname)||url.port||url.username||url.password||url.search||url.hash)return null
    const match=/^\/@([A-Za-z0-9_][A-Za-z0-9_-]{0,59})\/?$/.exec(url.pathname)
    return match?match[1].toLowerCase():null
  } catch {return null}
}
const permission=()=>Object.assign(new Error('Product Hunt credential permissions required'),{code:'PRODUCTHUNT_PERMISSION_REQUIRED'})
const unavailable=()=>Object.assign(new Error('Product Hunt proof unavailable'),{code:'PRODUCTHUNT_PROOF_UNAVAILABLE'})
const query=`query IndiecornsFollowState($username: String!) {
  viewer { user { id username } }
  user(username: $username) { id username url isFollowing isViewer }
}`
const mutation=`mutation IndiecornsFollow($input: UserFollowInput!) {
  userFollow(input: $input) { clientMutationId errors { field } node { id username url isFollowing isViewer } }
}`
async function producthuntGraphql(query,variables,{token,signal,request=fetch,now=Date.now}) {
  if(!token)throw Object.assign(new Error('Product Hunt credential required'),{code:'CREDENTIAL_REQUIRED'})
    const response=await request('https://api.producthunt.com/v2/api/graphql',{method:'POST',redirect:'error',
      headers:{Authorization:`Bearer ${token}`,Accept:'application/json','Content-Type':'application/json'},
      body:JSON.stringify({query,variables}),signal:AbortSignal.any([signal??new AbortController().signal,AbortSignal.timeout(30000)])})
    if(response.status===429||response.status===503) {
      const retryAfterMs=retryDelay(response.headers.get('retry-after'),now())
      await response.body?.cancel()
      throw Object.assign(new Error('Product Hunt unavailable or rate limited'),{retryAfterMs})
    }
    if([401,403].includes(response.status)){await response.body?.cancel();throw permission()}
    if(!response.ok){await response.body?.cancel();throw unavailable()}
    let body
    try{body=JSON.parse(await boundedText(response))}catch{throw unavailable()}
    if(Object.hasOwn(body??{},'errors')&&(!Array.isArray(body.errors)||body.errors.length)) {
      if(body.errors?.some?.(error=>['UNAUTHORIZED','FORBIDDEN','INSUFFICIENT_SCOPE'].includes(error?.extensions?.code)))throw permission()
      throw unavailable()
    }
    if(!body?.data||typeof body.data!=='object')throw unavailable()
    return body.data
}
// Documented userFollow mutation; app approval and public/private/write scopes
// are provider requirements. No upvote, comment or undocumented endpoint.
// https://api-v2-docs.producthunt.com/mutation/userfollow/
export async function producthuntFollow(username,{token,signal,request=fetch,now=Date.now}={}) {
  if(!validProducthuntUsername(username))throw new Error('Invalid Product Hunt username')
  username=username.toLowerCase()
  if(!token)throw Object.assign(new Error('Product Hunt credential required'),{code:'CREDENTIAL_REQUIRED'})
  const operationSignal=AbortSignal.any([signal??new AbortController().signal,AbortSignal.timeout(90000)])
  const call=(query,variables)=>producthuntGraphql(query,variables,{token,signal:operationSignal,request,now})
  const target=user=>validProducthuntId(user?.id)&&user.username?.toLowerCase()===username&&
    producthuntUser({platform:'producthunt',eventType:'follow',profileUrl:user.url})===username&&
    typeof user.isFollowing==='boolean'&&user.isViewer===false
  const read=async()=>{
    const data=await call(query,{username}),actor=data.viewer?.user,user=data.user
    if(!validProducthuntId(actor?.id)||!validProducthuntUsername(actor.username)||!target(user)||actor.id===user.id||actor.username.toLowerCase()===username)throw unavailable()
    return {actor,user}
  }
  const before=await read(),actorId=before.actor.id,targetId=before.user.id
  const proof={kind:'producthunt_follow',username,actorId,targetId,verified:true}
  if(before.user.isFollowing)return {...proof,alreadyPresent:true}
  const clientMutationId=`indiecorns-${createHash('sha256').update(JSON.stringify([actorId,targetId])).digest('hex')}`
  const result=(await call(mutation,{input:{userId:targetId,clientMutationId}})).userFollow
  if(!result||result.clientMutationId!==clientMutationId||!Array.isArray(result.errors)||result.errors.length||
    !target(result.node)||result.node.id!==targetId||!result.node.isFollowing)throw unavailable()
  const after=await read()
  if(after.actor.id!==actorId||after.actor.username.toLowerCase()!==before.actor.username.toLowerCase()||
    after.user.id!==targetId||!after.user.isFollowing)throw unavailable()
  return {...proof,alreadyPresent:false}
}

// Read the documented public profile through the API when HTML is unavailable.
export async function observeProducthuntProfile({target,token,state,checkpoint=()=>{},signal,request=fetch,now=Date.now}) {
  const username=producthuntUser(target)
  if(!username)throw new Error('Invalid Product Hunt profile target')
  const blockedUntil=state?.providerNextAttemptAt?.producthunt??0
  if(blockedUntil>now())throw Object.assign(new Error('Product Hunt cooldown'),{code:'HOST_DELAY',retryAt:blockedUntil})
  let data
  try {
    data=await producthuntGraphql(`query IndiecornsProfile($username: String!) { user(username: $username) { id username url name headline } }`,{username},{token,signal,request,now})
  } catch(error) {
    if(error.retryAfterMs) {
      error.retryAt=now()+error.retryAfterMs
      if(state){state.providerNextAttemptAt??={};state.providerNextAttemptAt.producthunt=error.retryAt;checkpoint()}
    }
    throw error
  }
  const user=data.user
  if(!validProducthuntId(user?.id)||user.username?.toLowerCase()!==username||
    producthuntUser({platform:'producthunt',eventType:'inspect',profileUrl:user.url})!==username||typeof user.name!=='string'||
    (user.headline!==null&&typeof user.headline!=='string'))throw unavailable()
  const compact=(text,max)=>String(text??'').replace(/\s+/g,' ').trim().slice(0,max)
  const metadata={id:user.id,username,url:user.url,title:compact(user.name,300),description:compact(user.headline,1600)}
  return {status:'observed',url:user.url,observedAt:now(),title:metadata.title,description:metadata.description,
    type:'profile',source:'producthunt_api',providerUserId:user.id,links:[],codeLinks:[],issueLinks:[],
    contentHash:createHash('sha256').update(JSON.stringify(metadata)).digest('hex')}
}
