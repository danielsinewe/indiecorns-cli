import {createHash} from 'node:crypto'
import {setTimeout as sleep} from 'node:timers/promises'
import {githubJson} from './github-api.mjs'
import {githubIssue,parseGithubIssue} from './github-issues.mjs'
import {enqueue} from './worker.mjs'

const HOUR=3600000
const object=value=>value&&typeof value==='object'&&!Array.isArray(value)
const profile=address=>{
  try{const u=new URL(address),name=u.pathname.replace(/^\/|\/$/g,'');return u.origin==='https://github.com'&&!u.search&&!u.hash&&!u.username&&!u.password&&
    /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(name)&&!name.includes('--')?name.toLowerCase():null}catch{return null}
}
const fresh=(snapshot,now)=>snapshot&&snapshot.observedAt<=now&&snapshot.expiresAt>now
function members(snapshot) {
  const active=new Set(snapshot.memberIds),result=new Map()
  for(const identity of snapshot.identities){if(!active.has(identity.slackUserId))continue
    for(const address of identity.profileUrls){const username=profile(address);if(username){const key=`${identity.slackUserId}:${username}`;result.set(key,{key,slackUserId:identity.slackUserId,username})}}}
  return [...result.values()]
}

// Only this provider-verified cache, not fields supplied on arbitrary targets,
// can establish authorship outside a member's repository namespace.
export function githubAuthoredMembership(state,snapshot,target,now=Date.now()) {
  if(!fresh(snapshot,now))return null
  const id=githubIssue(target),cache=state.githubMemberPosts,proof=cache?.proofs?.[id]
  if(!id||cache?.context!==`${snapshot.workspaceId}:${snapshot.channelId}`||!proof||!Number.isFinite(proof.observedAt)||!Number.isFinite(proof.expiresAt)||proof.observedAt>now||proof.expiresAt<=now)return null
  const author=cache.authors?.[proof.authorKey],identity=author?.identity
  if(!identity||!Number.isFinite(identity.observedAt)||!Number.isFinite(identity.expiresAt)||identity.observedAt>now||identity.expiresAt<=now||identity.id!==proof.authorId||!Number.isSafeInteger(proof.authorId)||proof.authorId<1)return null
  if(!snapshot.memberIds.includes(proof.slackUserId)||!snapshot.identities.some(i=>i.slackUserId===proof.slackUserId&&i.profileUrls.some(p=>profile(p)===author.username)))return null
  return {workspaceId:snapshot.workspaceId,channelId:snapshot.channelId,slackUserId:proof.slackUserId,
    observedAt:proof.observedAt,expiresAt:Math.min(proof.expiresAt,snapshot.expiresAt),relationship:'member_authored_post',githubAuthorId:proof.authorId}
}

export async function syncGithubMemberPosts({state,snapshot,token,signal,checkpoint=()=>{},request=fetch,now=Date.now,pause=sleep}) {
  const context=snapshot?`${snapshot.workspaceId}:${snapshot.channelId}`:null
  let cache=state.githubMemberPosts
  if(cache?.version!==1||cache.context!==context||!object(cache.authors)||!object(cache.proofs))cache=state.githubMemberPosts={version:1,context,authors:{},proofs:{},nextSearchAt:0}
  for(const [id,proof]of Object.entries(cache.proofs))if(proof.expiresAt<=now())delete cache.proofs[id]
  if(!fresh(snapshot,now())){cache.health='membership_required';cache.nextPollAt=now()+300000;return}
  const mapped=members(snapshot),keys=new Set(mapped.map(a=>a.key))
  for(const key of Object.keys(cache.authors))if(!keys.has(key))delete cache.authors[key]
  for(const [id,proof]of Object.entries(cache.proofs))if(!keys.has(proof.authorKey)||proof.expiresAt<=now())delete cache.proofs[id]
  for(const a of mapped){const old=cache.authors[a.key];if(!object(old)||old.username!==a.username||old.slackUserId!==a.slackUserId||!Number.isFinite(old.nextPollAt)||!Number.isInteger(old.page)||old.page<1||old.page>10)cache.authors[a.key]={...a,nextPollAt:0,page:1}}
  const revision=createHash('sha256').update(token??'').digest('hex')
  if(cache.credentialRevision!==revision){cache.credentialRevision=revision;for(const author of Object.values(cache.authors))author.nextPollAt=0}
  if(!token){cache.health='credential_required';cache.nextPollAt=now()+HOUR;return}
  if((state.externalNextAttemptAt??0)>now()){cache.health='rate_limited';cache.nextPollAt=state.externalNextAttemptAt;return}
  const due=Object.values(cache.authors).filter(a=>a.nextPollAt<=now()).sort((a,b)=>a.nextPollAt-b.nextPollAt||a.key.localeCompare(b.key)).slice(0,2)
  const options={token,request,now,signal:AbortSignal.any([signal??new AbortController().signal,AbortSignal.timeout(45000)])}
  for(const author of due){
    if(signal?.aborted)break
    // A reserved poll survives crashes; targets and page advancement commit together.
    author.nextPollAt=now()+60000;checkpoint()
    try {
      if(!author.identity||author.identity.expiresAt<=now()){
        const {data:user}=await githubJson(`/users/${author.username}`,options)
        if(user.type!=='User'||user.login?.toLowerCase()!==author.username||!Number.isSafeInteger(user.id)||user.id<1)throw new Error('GitHub identity unavailable')
        author.identity={id:user.id,observedAt:now(),expiresAt:now()+6*HOUR};checkpoint()
      }
      const delay=(cache.nextSearchAt??0)-now()
      if(delay>0)await pause(delay,undefined,{signal:options.signal})
      author.since??=new Date(now()-30*86400000).toISOString().slice(0,10)
      cache.nextSearchAt=now()+2100;checkpoint()
      const query=new URLSearchParams({q:`author:${author.username} is:issue is:public updated:>=${author.since}`,sort:'updated',order:'desc',per_page:'100',page:String(author.page)})
      const {data}=await githubJson(`/search/issues?${query}`,options)
      if(!Array.isArray(data.items)||data.items.length>100||!Number.isSafeInteger(data.total_count)||data.total_count<0||typeof data.incomplete_results!=='boolean')throw new Error('Invalid GitHub search')
      const staged=data.items.map(post=>{
        const target={platform:'github',eventType:'inspect',targetType:'post',profileUrl:post.html_url,username:author.username,
          source:'github_member_authored_post',attribution:'github_api_author_match'}
        const id=githubIssue(target),issue=parseGithubIssue(id),updated=Date.parse(post.updated_at)
        if(!issue||post.pull_request||post.private===true||post.repository?.private===true||
          (post.repository?.visibility&&post.repository.visibility!=='public')||post.number!==issue.number||post.user?.id!==author.identity.id||
          post.repository_url?.toLowerCase()!==`https://api.github.com/repos/${issue.repository}`||!Number.isFinite(updated)||
          updated<Date.parse(author.since+'T00:00:00Z')||updated>now()+300000)throw new Error('GitHub author proof mismatch')
        return {id,target,proof:{authorKey:author.key,slackUserId:author.slackUserId,authorId:author.identity.id,
          observedAt:now(),expiresAt:Math.min(snapshot.expiresAt,author.identity.expiresAt,now()+6*HOUR)}}
      })
      const digest=createHash('sha256').update(JSON.stringify(staged.map(p=>p.id))).digest('hex')
      const restart=!data.incomplete_results&&author.page>1&&data.total_count<=(author.page-1)*100
      if(!restart&&author.page>1&&author.pages?.includes(digest))throw new Error('Repeated GitHub search page')
      enqueue(state,staged.map(p=>p.target),now())
      for(const post of staged)cache.proofs[post.id]=post.proof
      if(restart){author.health='paging';author.page=1;author.since=null;author.pages=[];author.nextPollAt=now()+5000}
      else if(data.incomplete_results){author.health='incomplete_results';author.nextPollAt=now()+300000}
      else if(data.total_count>author.page*100){
        if(data.items.length!==100)throw new Error('GitHub search pagination incomplete')
        if(author.page>=10){author.health='capacity_limited';author.page=1;author.since=null;author.pages=[];author.nextPollAt=now()+900000}
        else{author.health='paging';author.page++;author.pages=[...(author.pages??[]),digest];author.nextPollAt=now()+5000}
      }else{
        if(data.items.length===0&&data.total_count>0)throw new Error('GitHub search page unavailable')
        author.health='ok';author.page=1;author.since=null;author.pages=[];author.nextPollAt=now()+900000
      }
      author.lastSuccessAt=now();checkpoint()
    }catch(error){
      if(signal?.aborted)break
      author.health=error.code==='GITHUB_PERMISSION_REQUIRED'?'permission_required':error.retryAfterMs?'rate_limited':'source_unavailable'
      author.nextPollAt=now()+Math.max(60000,error.retryAfterMs??300000)
      if(error.retryAfterMs){state.externalNextAttemptAt=author.nextPollAt;checkpoint();break}
      checkpoint()
    }
  }
  const authors=Object.values(cache.authors)
  cache.nextPollAt=authors.length?Math.max(cache.nextSearchAt??0,authors.reduce((next,a)=>Math.min(next,a.nextPollAt),Infinity)):now()+HOUR
  cache.health=authors.some(a=>a.health&&!['ok','paging'].includes(a.health))?'partial':authors.some(a=>!a.health||a.health==='paging')?'paging':'ok'
}
