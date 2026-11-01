import {githubJson} from './github-api.mjs'

export function parseGithubIssue(value) {
  if(typeof value!=='string')return null
  const match=/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)#([1-9]\d{0,9})$/.exec(value)
  if(!match||match.slice(1,3).some(p=>p==='.'||p==='..'))return null
  const repository=`${match[1]}/${match[2]}`.toLowerCase()
  return {repository,number:Number(match[3]),issue:`${repository}#${match[3]}`}
}
export function githubIssue(target) {
  try {
    const url=new URL(target.profileUrl??target.targetUrl)
    if(target.platform!=='github'||!['inspect','like'].includes(target.eventType)||url.origin!=='https://github.com'||url.search||url.hash||url.username||url.password)return null
    const match=/^\/([^/]+)\/([^/]+)\/issues\/([1-9]\d{0,9})\/?$/.exec(url.pathname)
    return match?parseGithubIssue(`${match[1]}/${match[2]}#${match[3]}`)?.issue??null:null
  }catch{return null}
}

// Reactions are idempotent by actor/content. Never mistake another person's
// reaction for this credential's proof, or incomplete pagination for absence.
export async function githubIssueReaction(value,input={}) {
  const issue=parseGithubIssue(value)
  if(!issue)throw new Error('Invalid GitHub issue')
  const options={...input,method:'GET',body:undefined,signal:AbortSignal.any([input.signal??new AbortController().signal,AbortSignal.timeout(120000)])}
  const repoPath=`/repos/${issue.repository}`
  const {data:repository}=await githubJson(repoPath,options)
  if(repository.private!==false||repository.visibility!=='public'||repository.full_name?.toLowerCase()!==issue.repository)throw new Error('Public GitHub repository proof required')
  const {data:actor}=await githubJson('/user',options)
  if(!Number.isSafeInteger(actor.id)||actor.id<1)throw new Error('GitHub actor proof unavailable')
  const path=`${repoPath}/issues/${issue.number}`
  const {data:post}=await githubJson(path,options)
  if(post.number!==issue.number||post.pull_request||githubIssue({platform:'github',eventType:'inspect',profileUrl:post.html_url})!==issue.issue)throw new Error('GitHub issue proof mismatch')
  const findOwn=async()=>{
    for(let page=1;page<=10;page++){
      const {data,headers}=await githubJson(`${path}/reactions?content=%2B1&per_page=100&page=${page}`,options)
      if(!Array.isArray(data)||data.length>100)throw new Error('Invalid GitHub reactions')
      const own=data.find(r=>r.content==='+1'&&r.user?.id===actor.id&&Number.isSafeInteger(r.id)&&r.id>0)
      if(own)return own
      const next=/(?:^|,)\s*<([^>]+)>;\s*rel="next"/.exec(headers.get('link')??'')
      if(!next)return null
      const expected=new URL(`${path}/reactions?content=%2B1&per_page=100&page=${page+1}`,'https://api.github.com')
      const actual=new URL(next[1])
      if(actual.origin!==expected.origin||actual.pathname!==expected.pathname||actual.hash||actual.username||actual.password||
        actual.searchParams.get('page')!==String(page+1)||actual.searchParams.get('per_page')!=='100'||actual.searchParams.get('content')!=='+1')throw new Error('Invalid GitHub reaction pagination')
    }
    throw new Error('GitHub reaction pagination incomplete')
  }
  const proof=(reaction,alreadyPresent)=>({kind:'github_issue_reaction',issue:issue.issue,content:'+1',actorId:actor.id,reactionId:reaction.id,verified:true,alreadyPresent})
  const existing=await findOwn()
  if(existing)return proof(existing,true)
  const {data:created,status}=await githubJson(`${path}/reactions`,{...options,method:'POST',body:{content:'+1'}},[200,201])
  if(created.content!=='+1'||created.user?.id!==actor.id||!Number.isSafeInteger(created.id)||created.id<1)throw new Error('Unverified GitHub reaction response')
  const verified=await findOwn()
  if(!verified||verified.id!==created.id)throw new Error('GitHub reaction proof unavailable')
  return proof(verified,status===200)
}
