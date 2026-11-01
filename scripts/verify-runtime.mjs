import {mkdtempSync,mkdirSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {execFileSync,spawnSync} from 'node:child_process'
import {prepareServiceRuntime} from '../indiecorns/lib/runtime.mjs'

const directory=mkdtempSync(join(tmpdir(),'indiecorns-runtime-install-'))
const npm=process.env.npm_execpath
if(!npm?.endsWith('npm-cli.js')) throw new Error('Run this check through npm run runtime:verify')
const runNpm=(args,options={})=>execFileSync(process.execPath,[npm,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe'],...options})
try {
  const packed=JSON.parse(runNpm(['pack','--json','--ignore-scripts','--pack-destination',directory]))[0]
  const archive=join(directory,packed.filename)
  const cache=join(directory,'cache','_npx','execution','node_modules','indiecorns')
  mkdirSync(cache,{recursive:true})
  execFileSync('tar',['-xf',archive,'-C',cache,'--strip-components=1'],{stdio:'pipe'})
  const runtime=prepareServiceRuntime({home:directory,cli:join(cache,'indiecorns','bin','indiecorns.mjs'),
    install:({directory:destination})=>runNpm(['install','--prefix',destination,'--ignore-scripts','--omit=dev','--no-audit','--no-fund',archive])})
  rmSync(join(directory,'cache'),{recursive:true})
  const environment={...process.env,HOME:directory,USERPROFILE:directory,INDIECORNS_TELEMETRY_DISABLED:'1',INDIECORNS_TOKEN:'',INDIECORNS_GITHUB_TOKEN:'',INDIECORNS_SLACK_TOKEN:''}
  const status=JSON.parse(execFileSync(process.execPath,[runtime.cli,'worker','status','--no-telemetry'],{
    encoding:'utf8',env:environment,stdio:['ignore','pipe','pipe']}))
  if(status.lock!==null || status.state!==null) throw new Error('Unexpected clean runtime state')
  const started=spawnSync(process.execPath,[runtime.cli,'worker','run','--once','--no-telemetry'],{encoding:'utf8',env:environment})
  if(started.status!==1 || JSON.parse(started.stdout).lastError!=='auth_required') throw new Error('Permanent worker did not run its authenticated-discovery check')
  const persisted=JSON.parse(execFileSync(process.execPath,[runtime.cli,'worker','status','--no-telemetry'],{encoding:'utf8',env:environment,stdio:['ignore','pipe','pipe']}))
  if(persisted.lock!==null || persisted.state?.lastError!=='auth_required') throw new Error('Permanent worker state did not survive its process exit')
  console.log('Verified packaged worker startup and persisted state after removing its npx cache.')
}finally{rmSync(directory,{recursive:true,force:true})}
