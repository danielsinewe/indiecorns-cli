import {profileIdentity,canonicalPost,validatePostObservation} from './post-discovery-contract.mjs'

// This function runs through the host's supported read-only page API. It only
// reads rendered cards/links; no cookies, storage, hidden application data or
// network endpoints are accessed. Keep it self-contained for serialization.
export function visibleActivitySnapshot() {
  const visible = node => Boolean(node.getClientRects().length)
  const headingNodes = Array.from(document.querySelectorAll('h2')).filter(node => node.textContent.trim()==='Feed post' && visible(node))
  const tweetNodes = Array.from(document.querySelectorAll('article[data-testid="tweet"]')).filter(visible)
  const cards=headingNodes.length?headingNodes.map(node=>node.parentElement):tweetNodes
  const title=document.title??''
  const authRequired=Boolean(Array.from(document.querySelectorAll('input[name="session_key"],input[autocomplete="current-password"]')).some(visible)) ||
    /\/(?:login|checkpoint|authwall|i\/flow\/login)(?:\/|$)/.test(location.pathname)
  const blocked=/security verification|captcha|access denied|temporarily restricted/i.test(title)
  const normalizeProfile=href=>{
    try {const url=new URL(href,location.href);url.search='';url.hash='';return url.href}catch{return null}
  }
  const buttons=Array.from(document.querySelectorAll('button'))
  return {url:location.href,title,authRequired,blocked,activityVisible:cards.length>0,
    emptyVisible:/\b(?:No posts yet|hasn.t posted yet|hasn.t posted anything)\b/i.test(document.body.innerText.slice(0,12000)),
    cards:cards.slice(0,40).map((card,index)=>{
      const menu=Array.from(card.querySelectorAll('button')).find(node=>/Open control menu for post by /.test(node.getAttribute('aria-label')??''))
      const links=Array.from(card.querySelectorAll('a[href]')).filter(visible)
      // On a repost card, the reposter precedes the original author. The last
      // header-profile link before the post menu identifies the original author.
      const ordered=Array.from(card.querySelectorAll('a[href],button'))
      const header=menu?ordered.slice(0,ordered.indexOf(menu)):ordered
      const headerLinks=header.filter(node=>node.tagName==='A'&&visible(node))
      const profiles=headerLinks.filter(link=>/^https:\/\/(?:www\.)?linkedin\.com\/in\/[^/]+\/?(?:[?#].*)?$/.test(link.href))
      const tweetAuthor=card.querySelector('[data-testid="User-Name"] a[href]')
      const authorProfileUrl=profiles.length?normalizeProfile(profiles.at(-1).href):tweetAuthor?normalizeProfile(tweetAuthor.href):null
      const menuName=menu?.getAttribute('aria-label')??null
      return {index,authorProfileUrl,menuName,menuOrdinal:menu?buttons.filter(b=>b.getAttribute('aria-label')===menuName).indexOf(menu):-1,
        reposted:/\breposted this\b/i.test(card.innerText.slice(0,400)),
        links:links.map(link=>normalizeProfile(link.href)).filter(Boolean).slice(0,50)}
    })}
}

export function observationFromSnapshot(task,snapshot,now=Date.now()) {
  const author=profileIdentity(task.platform,task.profileUrl)
  if(!author)throw new Error('Invalid member profile')
  const location=new URL(snapshot.url)
  const expected=new URL(task.checkUrl)
  if(location.origin!==expected.origin||location.pathname.replace(/\/$/,'')!==expected.pathname.replace(/\/$/,'')) {
    return {status:snapshot.authRequired?'auth_required':'unavailable',observedAt:now,posts:[]}
  }
  if(snapshot.authRequired||snapshot.blocked)return {status:snapshot.authRequired?'auth_required':'blocked',observedAt:now,posts:[]}
  const posts=new Map()
  for(const card of snapshot.cards??[]) {
    if(card.reposted||profileIdentity(task.platform,card.authorProfileUrl)!==author)continue
    const urls=[...new Set((card.links??[]).map(url=>canonicalPost(task.platform,url,author)).filter(Boolean))]
    // Several different permalinks in one card can be an embedded/quoted post.
    // Leave ambiguous cards out rather than attributing the quote to its sharer.
    if(urls.length!==1)continue
    posts.set(urls[0],{url:urls[0],authorProfileUrl:task.profileUrl})
  }
  return validatePostObservation(task,{status:posts.size||snapshot.emptyVisible?'observed':'unavailable',observedAt:now,posts:[...posts.values()].slice(0,20)},now)
}

export async function readMemberActivity({browser,task,tab,onState=()=>{},now=Date.now}) {
  const expected=profileIdentity(task.platform,task.profileUrl)
  if(!expected||!['linkedin','x'].includes(task.platform))throw new Error('Unsupported member activity task')
  const canonicalCheck=task.platform==='linkedin'?task.profileUrl.replace(/\/$/,'')+'/recent-activity/all/':task.profileUrl
  if(task.checkUrl!==canonicalCheck)throw new Error('Invalid activity URL')
  // Use only a browser already selected by the host's policy. Never discover or
  // launch Chrome here, switch accounts, sign in, or bring a window forward.
  const owned=!tab
  const page=tab??await browser.tabs.new()
  try {
    if(await page.url()!==task.checkUrl)await page.goto(task.checkUrl)
    // A current state check lets the host observe navigation/auth redirects.
    const state=await page.ax.get()
    await onState(state)
    const snapshot=await page.playwright.evaluate(visibleActivitySnapshot)
    return observationFromSnapshot(task,snapshot,now())
  } finally {if(owned)await page.close()}
}
