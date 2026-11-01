import {mkdirSync,readdirSync,readFileSync,openSync,readSync,writeSync,fsyncSync,closeSync,statSync,chmodSync,rmSync} from 'node:fs'
import {join} from 'node:path'

export const heartbeatMs=60000
export const healthFileLimit=1048576
const maximumGap=90000,maximumProgressAge=900000
const phases=new Set(['starting','discover','prioritize','observe','derive','act','cycle','sleep'])
const events=new Set(['start','heartbeat','stop'])
const fields=['at','session','pid','event','phase','progressAt','sleepUntil','discoveryHealthy','communityHealthy','targets','clockBackwards']
const files=directory=>{
  try{return readdirSync(directory,{withFileTypes:true}).filter(f=>f.isFile()&&/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f.name)).map(f=>join(directory,f.name))}
  catch(error){if(error.code==='ENOENT')return [];throw error}
}
const valid = r => r && Object.keys(r).every(k=>fields.includes(k)) &&
  Number.isFinite(r.at)&&r.at>=0 && Number.isFinite(r.progressAt)&&r.progressAt>=0 &&
  typeof r.session==='string'&&/^[A-Za-z0-9-]{1,64}$/.test(r.session) && Number.isInteger(r.pid)&&r.pid>0 &&
  events.has(r.event)&&phases.has(r.phase) && (r.sleepUntil===null||Number.isFinite(r.sleepUntil)) &&
  typeof r.discoveryHealthy==='boolean' && [true,false,null].includes(r.communityHealthy) &&
  Number.isInteger(r.targets)&&r.targets>=0 && typeof r.clockBackwards==='boolean'

function readHistory(directory) {
  const records=[]
  let malformedRecords=0,unreadableFiles=0,oversizedFiles=0
  let paths
  try{paths=files(directory)}catch{return {records,malformedRecords,unreadableFiles:1,oversizedFiles}}
  for(const path of paths) {
    try {
      if(statSync(path).size>healthFileLimit){oversizedFiles++;continue}
      for(const line of readFileSync(path,'utf8').split('\n')) {
        if(!line.trim())continue
        try{const r=JSON.parse(line);if(!valid(r))throw new Error();records.push(r)}catch{malformedRecords++}
      }
    }catch{unreadableFiles++}
  }
  return {records,malformedRecords,unreadableFiles,oversizedFiles}
}

// This reports sampled process progress, never an inferred uptime percentage.
export function summarizeHealth(records,{now=Date.now(),hours=24,anomalies={}}={}) {
  if(!Number.isFinite(hours)||hours<1||hours>48)throw new Error('Health window must be between 1 and 48 hours')
  const start=now-hours*3600000
  const future=records.filter(r=>r.at>now)
  const ordered=records.filter(r=>r.at<=now).sort((a,b)=>a.at-b.at)
  const latest=ordered.at(-1)??null
  const before=ordered.filter(r=>r.at<=start).at(-1)
  const window=[...(before?[before]:[]),...ordered.filter(r=>r.at>start)]
  let largestGapMs=0,previous=start
  for(const r of window){largestGapMs=Math.max(largestGapMs,r.at-previous);previous=Math.max(start,r.at)}
  largestGapMs=Math.max(largestGapMs,now-previous)
  const progressStalls=window.filter(r=>r.event!=='stop' &&
    !(r.phase==='sleep' && r.sleepUntil!==null && r.at<=r.sleepUntil+maximumGap) && r.at-r.progressAt>maximumProgressAge).length
  const invalidHistory=future.length>0||window.some(r=>r.clockBackwards)||Object.values(anomalies).some(n=>n>0)
  const coversStart=Boolean(before || (window[0] && window[0].at-start<=maximumGap))
  const sampledMs=latest && ordered.length?Math.max(0,latest.at-ordered[0].at):0
  const coverage=invalidHistory?'invalid_history':!latest||!coversStart||sampledMs<hours*3600000-maximumGap?'insufficient_history'
    :largestGapMs>maximumGap?'gaps_detected':'continuous_samples'
  return {hours,windowStart:start,observedSince:ordered[0]?.at??null,latestHeartbeatAt:latest?.at??null,
    latestAgeMs:latest?now-latest.at:null,coverage,largestGapMs,progressStalls,
    latestState:!latest?'missing':latest.event==='stop'?'stopped':now-latest.at>maximumGap?'stale':'recent_sample',
    sampledMs,samplesInWindow:window.length,sessions:new Set(window.map(r=>r.session)).size,
    cleanStops:window.filter(r=>r.event==='stop').length,
    unhealthySamples:window.filter(r=>!r.discoveryHealthy||r.communityHealthy===false).length,
    clockAnomalies:future.length+window.filter(r=>r.clockBackwards).length,
    anomalies,latest}
}
export function readHealthReport(directory,options={}) {
  const {records,...anomalies}=readHistory(join(directory,'health'))
  return summarizeHealth(records,{...options,anomalies})
}

export function startHealthMonitor({directory,session,state,now=Date.now,schedule=setInterval,cancel=clearInterval,onStatus=()=>{}}) {
  const root=join(directory,'health')
  let phase='starting',progressAt=now(),sleepUntil=null,stopped=false
  const existing=readHistory(root).records
  let previousAt=existing.reduce((last,r)=>Math.max(last,r.at),0)
  const status=value=>{try{onStatus(value)}catch{}}
  const append=event=>{
    try {
      const at=now(),lastSuccess=state.lastSuccessAt
      const row={at,session,pid:process.pid,event,phase,progressAt,sleepUntil,
        discoveryHealthy:state.lastError===null&&Number.isFinite(lastSuccess)&&at>=lastSuccess&&at-lastSuccess<=maximumProgressAge,
        communityHealthy:state.communityFeed?state.communityFeed.health==='ok'&&state.communityFeed.snapshot?.expiresAt>at
          :state.slackHealth?state.slackHealth==='verified':null,
        targets:Object.keys(state.jobs).length+Object.keys(state.backlog??{}).length,clockBackwards:at<previousAt}
      if(!valid(row))throw new Error('Invalid health record')
      mkdirSync(root,{recursive:true,mode:0o700})
      const path=join(root,new Date(at).toISOString().slice(0,10)+'.jsonl')
      let size=0
      try{size=statSync(path).size}catch(error){if(error.code!=='ENOENT')throw error}
      // Separate an interrupted final line without overwriting its evidence.
      let separator=''
      if(size>0){const tail=openSync(path,'r');try{const b=Buffer.alloc(1);readSync(tail,b,0,1,size-1);if(b[0]!==10)separator='\n'}finally{closeSync(tail)}}
      const line=Buffer.from(separator+JSON.stringify(row)+'\n')
      if(size+line.length>healthFileLimit)throw new Error('Health file full')
      // Prune before creating a new day, so a crash cannot accumulate old days.
      const old=files(root).filter(p=>p!==path).sort((a,b)=>statSync(b).mtimeMs-statSync(a).mtimeMs||b.localeCompare(a))
      for(const file of old.slice(2))rmSync(file)
      const fd=openSync(path,'a',0o600)
      try{
        chmodSync(path,0o600)
        for(let offset=0;offset<line.length;){const written=writeSync(fd,line,offset,line.length-offset);if(!written)throw new Error('Incomplete health write');offset+=written}
        fsyncSync(fd)
      }finally{closeSync(fd)}
      previousAt=at
      status('recording')
    }catch{status('storage_unavailable')}
  }
  append('start')
  const timer=schedule(()=>append('heartbeat'),heartbeatMs)
  timer?.unref?.()
  return {
    progress(next,until=null){if(!phases.has(next))throw new Error('Invalid worker phase');phase=next;progressAt=now();sleepUntil=until},
    stop(){if(stopped)return;stopped=true;cancel(timer);append('stop')},
  }
}
