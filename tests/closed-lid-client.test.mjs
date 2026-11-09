import test from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {spawnSync} from 'node:child_process'
import {buildClosedLidPackage,closedLidStatus,requestClosedLid,helperLaunchDaemon,verifyRootRuntime} from '../indiecorns/lib/closed-lid-client.mjs'

const uid=process.getuid?.()??1000
const inspectRuntime=()=>({status:0,stdout:'/node:\n\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0)\n'})
test('installer package is inert, immutable-root-bound and never grants wildcard sudo access',t=>{
  const directory=fs.mkdtempSync(join(tmpdir(),'indiecorns-power-package-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}))
  const result=buildClosedLidPackage({output:join(directory,'review'),node:process.execPath,cli:'/member/cli with spaces.mjs',uid:uid||501,system:'darwin',inspectRuntime})
  assert.equal(result.installed,false);assert.equal(result.activated,false)
  const installer=fs.readFileSync(join(result.output,'install.sh'),'utf8'),uninstall=fs.readFileSync(join(result.output,'uninstall.sh'),'utf8')
  assert.doesNotMatch(installer,/sudoers|NOPASSWD|pmset -a|node_modules/)
  assert.match(installer,/Existing helper preserved/);assert.match(installer,/shasum -a 256/)
  assert.match(installer,/chown '.*' '\/Library\/Indiecorns\/PowerHelper\/request.json'/)
  assert.match(uninstall,/--uninstall\n# A failed or unknown restore above stops removal/)
  assert.doesNotMatch(uninstall,/rm -rf/)
  assert.doesNotMatch(helperLaunchDaemon(),/Users\/|HOME|sudo|worker run/)
  assert.match(helperLaunchDaemon(),/<key>KeepAlive<\/key><true\/>/)
  if(process.platform!=='win32')for(const script of ['install.sh','uninstall.sh'])assert.equal(spawnSync('/bin/sh',['-n',join(result.output,script)]).status,0)
  assert.throws(()=>buildClosedLidPackage({output:result.output,node:process.execPath,cli:'/cli',uid:uid||501,system:'darwin',inspectRuntime}),/EEXIST/)
})

test('a user-writable dynamic dependency is refused before a runtime can be copied for root',()=>{
  assert.deepEqual(verifyRootRuntime('/node',{inspect:inspectRuntime}),['/usr/lib/libSystem.B.dylib'])
  for(const dependency of ['@rpath/libnode.dylib','/opt/homebrew/lib/libicu.dylib','/Users/member/lib/x.dylib'])
    assert.throws(()=>verifyRootRuntime('/node',{inspect:()=>({status:0,stdout:'/node:\n\t'+dependency+' (compatibility version 1.0.0)\n'})}),/standalone Node/)
})

test('client distinguishes queued requests from helper acknowledgement and never replays an uncertain enable',async t=>{
  if(process.platform==='win32')return t.skip('POSIX ownership and no-follow handles')
  const directory=fs.mkdtempSync(join(tmpdir(),'indiecorns-power-client-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}))
  const request=join(directory,'request.json'),status=join(directory,'status.json'),now=1000000
  fs.writeFileSync(request,'null',{mode:0o600});fs.writeFileSync(status,JSON.stringify({version:1,state:'disabled',at:now}),{mode:0o600})
  let nonce,writes=0
  const options={directory,uid,rootUid:uid,now:()=>now,minutes:1,pid:123,startedAt:'Mon Nov  9 12:30:00 2026',acceptSystemWide:true,
    wait:async()=>{const value=JSON.parse(fs.readFileSync(request));if(!nonce){nonce=value.nonce;writes++}assert.equal(value.nonce,nonce)}}
  const pending=await requestClosedLid('enable',options)
  assert.equal(pending.state,'acknowledgement_pending');assert.equal(writes,1)
  const accepted=await requestClosedLid('disable',{...options,wait:async()=>{const value=JSON.parse(fs.readFileSync(request));fs.writeFileSync(status,JSON.stringify({version:1,state:'disabled',at:now,lastNonce:value.nonce}))}})
  assert.equal(accepted.acknowledged,true);assert.equal(accepted.accepted,true)
  assert.equal(closedLidStatus({directory,rootUid:uid,now:now+11000}).state,'helper_unavailable')
  fs.unlinkSync(request);fs.symlinkSync(status,request)
  await assert.rejects(requestClosedLid('disable',options))
})

test('source package includes only built-in imports, fixed privileged entry points and secure file opens',()=>{
  const source=fs.readFileSync(new URL('../indiecorns/lib/closed-lid-helper.mjs',import.meta.url),'utf8')
  assert.doesNotMatch(source,/^import .*from ['"](?!node:)/m)
  assert.match(source,/O_NOFOLLOW/);assert.match(source,/BEGIN EXCLUSIVE/)
  assert.match(source,/\['--serve','--uninstall'\]/)
})
