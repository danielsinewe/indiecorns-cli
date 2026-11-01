import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, renameSync, statSync, rmSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'

export const temporaryPackagePath = path => /[\\/]_npx[\\/]/.test(path)
export function runtimeFingerprint(root) {
  const metadata=JSON.parse(readFileSync(join(root,'package.json'),'utf8'))
  const hash=createHash('sha256').update(JSON.stringify({version:metadata.version,dependencies:metadata.dependencies}))
  const files=['indiecorns/bin/indiecorns.mjs']
  const visit=(relative)=>{
    for(const item of readdirSync(join(root,relative),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
      const path=`${relative}/${item.name}`
      if(item.isDirectory()) visit(path)
      else if(item.isFile() && item.name.endsWith('.mjs')) files.push(path)
    }
  }
  visit('indiecorns/lib')
  for(const file of files) hash.update(file).update(readFileSync(join(root,file)))
  return hash.digest('hex')
}
const npmEntry = () => {
  const candidates=[
    process.env.npm_execpath && join(dirname(process.env.npm_execpath),'npm-cli.js'),
    resolve(dirname(process.execPath),'../lib/node_modules/npm/bin/npm-cli.js'),
    join(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js'),
  ].filter(Boolean)
  const path=candidates.find(candidate=>existsSync(candidate))
  if(!path) throw new Error('Cannot locate npm for permanent worker installation')
  return path
}
// A service must not point into npm's disposable execution cache. Install an
// exact, byte-verified published release in a private versioned runtime instead.
export function prepareServiceRuntime({cli,home=homedir(),install}) {
  if(!temporaryPackagePath(cli)) return {cli,managed:false}
  const source=resolve(dirname(cli),'..','..')
  const metadata=JSON.parse(readFileSync(join(source,'package.json'),'utf8'))
  if(!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(metadata.version)) throw new Error('Invalid runtime package version')
  const fingerprint=runtimeFingerprint(source)
  const directory=join(home,'.indiecorns','runtime',`${metadata.version}-${fingerprint.slice(0,16)}`)
  const root=join(directory,'node_modules','indiecorns')
  const permanentCli=join(root,'indiecorns','bin','indiecorns.mjs')
  const marker=join(directory,'ready.json')
  const valid=()=>{
    try{return JSON.parse(readFileSync(marker,'utf8')).fingerprint===fingerprint && runtimeFingerprint(root)===fingerprint}
    catch{return false}
  }
  if(valid()) return {cli:permanentCli,managed:true,reused:true,directory}
  mkdirSync(directory,{recursive:true,mode:0o700})
  const specification=`indiecorns@${metadata.version}`
  if(install) install({directory,specification})
  else {
    const result=spawnSync(process.execPath,[npmEntry(),'install','--prefix',directory,'--omit=dev','--ignore-scripts','--no-audit','--no-fund','--save-exact',specification],{encoding:'utf8',maxBuffer:1048576})
    if(result.error || result.status!==0) throw new Error('Permanent worker runtime installation failed; the existing service was not changed')
  }
  let compatible=false
  try { compatible=existsSync(permanentCli) && runtimeFingerprint(root)===fingerprint } catch {}
  if(!compatible) throw new Error('Published runtime differs from this CLI; install the intended release globally before registering its worker')
  const temporary=`${marker}.${randomUUID()}.tmp`
  writeFileSync(temporary,JSON.stringify({version:metadata.version,fingerprint}),{mode:0o600})
  renameSync(temporary,marker)
  return {cli:permanentCli,managed:true,reused:false,directory}
}


export function pruneManagedRuntimes({home=homedir(),active,previous}) {
  const root=join(home,'.indiecorns','runtime')
  if(!existsSync(root)) return 0
  const candidates=readdirSync(root,{withFileTypes:true}).filter(item=>item.isDirectory() && /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?-[a-f0-9]{16}$/.test(item.name))
    .map(item=>join(root,item.name)).filter(path=>existsSync(join(path,'ready.json')))
    .sort((a,b)=>statSync(b).mtimeMs-statSync(a).mtimeMs)
  const keep=new Set([active,previous].filter(Boolean).map(path=>resolve(path)))
  for(const path of candidates) if(keep.size<2) keep.add(resolve(path))
  let removed=0
  for(const path of candidates) if(!keep.has(resolve(path))) {rmSync(path,{recursive:true});removed++}
  return removed
}
