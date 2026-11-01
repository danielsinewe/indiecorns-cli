import {retryDelay,boundedText} from './discovery.mjs'

export async function githubRequest(path,{token,signal,request=fetch,now=Date.now,method='GET',body}={}) {
  if(!token)throw Object.assign(new Error('GitHub credential required'),{code:'CREDENTIAL_REQUIRED'})
  const url=new URL(path,'https://api.github.com')
  if(url.origin!=='https://api.github.com'||url.username||url.password)throw new Error('Invalid GitHub API origin')
  const response=await request(url.href,{method,headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json',
    'X-GitHub-Api-Version':'2026-03-10',...(method==='PUT'?{'Content-Length':'0'}:{}),
    ...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',
    signal:AbortSignal.any([signal??new AbortController().signal,AbortSignal.timeout(30000)])})
  if(response.status===429||(response.status===403&&(response.headers.has('retry-after')||response.headers.get('x-ratelimit-remaining')==='0'))) {
    const reset=Number(response.headers.get('x-ratelimit-reset'))*1000
    const retryAfterMs=response.headers.has('retry-after')?retryDelay(response.headers.get('retry-after'),now())
      :reset>now()?Math.max(1000,Math.min(reset-now(),86400000)):60000
    await response.body?.cancel()
    throw Object.assign(new Error('GitHub rate limited'),{retryAfterMs})
  }
  if([401,403].includes(response.status)){await response.body?.cancel();throw Object.assign(new Error('GitHub credential permissions required'),{code:'GITHUB_PERMISSION_REQUIRED'})}
  return response
}
export async function githubJson(path,options,statuses=[200]) {
  const response=await githubRequest(path,options)
  if(!statuses.includes(response.status)){await response.body?.cancel();throw new Error('GitHub API proof unavailable')}
  let data
  try{data=JSON.parse(await boundedText(response))}catch{throw new Error('GitHub API JSON unavailable')}
  return {data,headers:response.headers,status:response.status}
}
