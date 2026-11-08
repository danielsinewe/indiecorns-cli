import {createHash,randomUUID} from 'node:crypto'
import {mkdirSync,readdirSync,readFileSync,writeFileSync,unlinkSync,statSync,openSync,fsyncSync,closeSync,linkSync} from 'node:fs'
import {join} from 'node:path'
import {validLeaseToken,profileIdentity,canonicalPost} from './post-discovery-contract.mjs'
import {credentialRevision} from './auth-context.mjs'

const bindingFor=(appUrl,headers)=>createHash('sha256').update(new URL(appUrl).origin+'\n'+credentialRevision(headers)).digest('hex')
const names=directory=>{try{return readdirSync(directory).filter(name=>/^[a-f0-9]{64}\.json$/.test(name)).sort()}catch(error){if(error.code==='ENOENT')return [];throw error}}
export function stagePostReport({directory,appUrl,headers,body,now=Date.now()}) {
  if(!body||typeof body!=='object'||!validLeaseToken(body.leaseToken)||
    !['observed','auth_required','blocked','unavailable'].includes(body.status)||!Number.isSafeInteger(body.observedAt)||
    !Array.isArray(body.posts)||body.posts.length>20||(body.status!=='observed'&&body.posts.length)||body.observedAt>now+30000||body.observedAt<now-600000)throw new Error('Invalid post report')
  for(const post of body.posts) {
    const platform=typeof post?.url==='string'&&/^https:\/\/(?:www\.)?linkedin\.com\//.test(post.url)?'linkedin':'x'
    const author=profileIdentity(platform,post?.authorProfileUrl)
    if(!author||!canonicalPost(platform,post?.url,author))throw new Error('Invalid post author or URL')
  }
  const report={leaseToken:body.leaseToken,status:body.status,observedAt:body.observedAt,posts:body.posts.map(post=>({
    url:post.url,authorProfileUrl:post.authorProfileUrl,...(typeof post.title==='string'?{title:post.title.slice(0,240)}:{})}))}
  const contents=JSON.stringify({version:1,binding:bindingFor(appUrl,headers),createdAt:now,report})
  if(Buffer.byteLength(contents)>32768)throw new Error('Post report exceeds 32 KB')
  const root=join(directory,'post-outbox'),key=createHash('sha256').update(body.leaseToken).digest('hex'),path=join(root,key+'.json')
  mkdirSync(root,{recursive:true,mode:0o700})
  if(names(root).length>=32&&!names(root).includes(key+'.json'))throw new Error('Post delivery queue is full; inspect discovery status')
  // A token always has the same report: a retry cannot overwrite evidence with
  // a later observation. Each CLI process writes a separate lease file.
  const temporary=join(root,key+'.'+randomUUID()+'.tmp')
  try {
    const fd=openSync(temporary,'wx',0o600)
    try {writeFileSync(fd,contents);fsyncSync(fd)}finally{closeSync(fd)}
    try {linkSync(temporary,path)}catch(error){if(error.code!=='EEXIST')throw error}
  } finally {unlinkSync(temporary)}
  return path
}
export async function flushPostReports({directory,appUrl,headers,send,now=Date.now(),limit=4}) {
  const root=join(directory,'post-outbox'),binding=bindingFor(appUrl,headers)
  const result={sent:0,expired:0,rejected:0,pending:0,accountMismatch:0,lastReceipt:null}
  for(const name of names(root).slice(0,limit)) {
    const path=join(root,name)
    let entry
    try {
      if(statSync(path).size>32768)throw new Error('Oversized report')
      entry=JSON.parse(readFileSync(path,'utf8'))
      if(entry.version!==1||!Number.isSafeInteger(entry.createdAt)||!entry.report)throw new Error('Invalid report')
    } catch {result.rejected++;continue}
    if(entry.binding!==binding){result.accountMismatch++;continue}
    if(entry.report.observedAt<now-600000){unlinkSync(path);result.expired++;continue}
    try {
      const receipt=await send({operation:'report',...entry.report})
      if(receipt.accepted!==true)throw new Error('Report not accepted')
      unlinkSync(path);result.sent++;result.lastReceipt=receipt
    } catch(error) {
      if([400,409].includes(error.httpStatus)){unlinkSync(path);result.rejected++}
      else {result.pending++;break}
    }
  }
  result.pending=names(root).length
  return result
}
export function postOutboxSummary(directory) {
  const root=join(directory,'post-outbox')
  return {pending:names(root).length,maximumReports:32,maximumBytes:32*32768}
}
