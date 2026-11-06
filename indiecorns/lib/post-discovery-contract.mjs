// Shared by the platform and local workers. URLs carry no tracking parameters.
export function profileIdentity(platform, value) {
  try {
    const url=new URL(value), host=url.hostname.toLowerCase().replace(/^www\./,'')
    if(url.protocol!=='https:'||url.port||url.username||url.password) return null
    const parts=url.pathname.split('/').filter(Boolean)
    if(platform==='linkedin'&&host==='linkedin.com'&&parts.length===2&&parts[0]==='in'&&/^[a-z0-9%_-]{1,150}$/i.test(parts[1])) return parts[1].toLowerCase()
    if(platform==='x'&&['x.com','twitter.com'].includes(host)&&parts.length===1&&/^[a-z0-9_]{1,15}$/i.test(parts[0]))return parts[0].toLowerCase()
  } catch {}
  return null
}
export function canonicalPost(platform,value,expectedAuthor) {
  try {
    if(typeof value!=='string'||value.length>2048)return null
    const url=new URL(value),host=url.hostname.toLowerCase().replace(/^www\./,'')
    if(url.protocol!=='https:'||url.port||url.username||url.password)return null
    if(platform==='x'&&['x.com','twitter.com'].includes(host)) {
      const match=url.pathname.match(/^\/([a-z0-9_]{1,15})\/status\/(\d{6,30})(?:\/)?$/i)
      return match&&match[1].toLowerCase()===expectedAuthor?`https://x.com/${expectedAuthor}/status/${match[2]}`:null
    }
    if(platform==='linkedin'&&host==='linkedin.com') {
      const feed=url.pathname.match(/^\/feed\/update\/urn:li:activity:(\d{6,30})\/?$/)
      const post=url.pathname.match(/^\/posts\/([^_\/]+)_[^/]*?activity-(\d{6,30})(?:-[^/]*)?\/?$/i)
      if(post&&post[1].toLowerCase()!==expectedAuthor)return null
      const id=feed?.[1]??post?.[2]
      return id?`https://www.linkedin.com/feed/update/urn:li:activity:${id}/`:null
    }
  } catch {}
  return null
}
export function validatePostObservation(task,body,now=Date.now()) {
  if(!body||!['observed','auth_required','blocked','unavailable'].includes(body.status)||
    !Number.isSafeInteger(body.observedAt)||body.observedAt>now+30000||body.observedAt<now-600000||
    !Array.isArray(body.posts)||body.posts.length>20||(body.status!=='observed'&&body.posts.length))throw new Error('Invalid post observation')
  const author=profileIdentity(task.platform,task.profileUrl)
  if(!author)throw new Error('Invalid member profile')
  const posts=new Map()
  for(const post of body.posts) {
    const url=canonicalPost(task.platform,post.url,author)
    if(!url||profileIdentity(task.platform,post.authorProfileUrl)!==author)throw new Error('Post author does not match assigned member')
    posts.set(url,{url,author,authorProfileUrl:task.profileUrl,title:typeof post.title==='string'?post.title.replace(/\s+/g,' ').trim().slice(0,240):null})
  }
  return {status:body.status,observedAt:body.observedAt,posts:[...posts.values()]}
}
export function nextDiscoveryDelay({status,newPosts=0,emptyChecks=0,failures=0}) {
  if(status!=='observed')return Math.min(21600000,900000*2**Math.min(failures,5))
  return newPosts?300000:Math.min(3600000,300000*2**Math.min(emptyChecks,4))
}
