import {mkdtempSync,mkdirSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {execFileSync} from 'node:child_process'
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
  const status=JSON.parse(execFileSync(process.execPath,[runtime.cli,'worker','status','--no-telemetry'],{
    encoding:'utf8',env:{...process.env,HOME:directory,USERPROFILE:directory,INDIECORNS_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']}))
  if(status.lock!==null || status.state!==null) throw new Error('Unexpected clean runtime state')
  console.log('Verified packaged runtime with real npm dependencies after removing its npx cache.')
}finally{rmSync(directory,{recursive:true,force:true})}
