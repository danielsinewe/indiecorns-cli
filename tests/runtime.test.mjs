import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,cpSync,rmSync,readFileSync,existsSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {prepareServiceRuntime,temporaryPackagePath,pruneManagedRuntimes} from '../indiecorns/lib/runtime.mjs'

const fixture=()=>{
  const home=mkdtempSync(join(tmpdir(),'indiecorns-runtime-'))
  const source=join(home,'cache','_npx','temporary','node_modules','indiecorns')
  mkdirSync(join(source,'indiecorns','bin'),{recursive:true})
  mkdirSync(join(source,'indiecorns','lib'),{recursive:true})
  writeFileSync(join(source,'package.json'),JSON.stringify({name:'indiecorns',version:'0.3.41',dependencies:{}}))
  writeFileSync(join(source,'indiecorns','bin','indiecorns.mjs'),'console.log("worker")')
  writeFileSync(join(source,'indiecorns','lib','worker.mjs'),'export const worker=true')
  return {home,source,cli:join(source,'indiecorns','bin','indiecorns.mjs')}
}
test('npx startup uses a permanent verified runtime that survives cache removal',()=>{
  const f=fixture();let installs=0
  try {
    const install=({directory,specification})=>{installs++;assert.equal(specification,'indiecorns@0.3.41');cpSync(f.source,join(directory,'node_modules','indiecorns'),{recursive:true})}
    const runtime=prepareServiceRuntime({...f,install})
    assert.equal(runtime.managed,true)
    assert.equal(temporaryPackagePath(runtime.cli),false)
    assert.equal(prepareServiceRuntime({...f,install}).reused,true)
    assert.equal(installs,1)
    rmSync(join(f.home,'cache'),{recursive:true})
    assert.match(readFileSync(runtime.cli,'utf8'),/worker/)
  }finally{rmSync(f.home,{recursive:true})}
})
test('a mismatched or partial published runtime never becomes a service target',()=>{
  const f=fixture()
  try {
    assert.throws(()=>prepareServiceRuntime({...f,install:({directory})=>{
      const target=join(directory,'node_modules','indiecorns');cpSync(f.source,target,{recursive:true});writeFileSync(join(target,'indiecorns','lib','worker.mjs'),'different code')
    }}),/differs/)
  }finally{rmSync(f.home,{recursive:true})}
})
test('existing checkouts and global installs are reused without installing dependencies',()=>{
  assert.deepEqual(prepareServiceRuntime({cli:'/stable/indiecorns/bin/indiecorns.mjs',install:()=>assert.fail()}),{cli:'/stable/indiecorns/bin/indiecorns.mjs',managed:false})
  assert.equal(temporaryPackagePath('C:\\cache\\_npx\\abc\\cli.mjs'),true)
})


test('runtime cleanup preserves the active release and rollback release only',()=>{
  const f=fixture()
  try{
    const root=join(f.home,'.indiecorns','runtime')
    const directories=['0.3.41-aaaaaaaaaaaaaaaa','0.3.42-bbbbbbbbbbbbbbbb','0.3.43-cccccccccccccccc'].map(name=>join(root,name))
    for(const directory of directories){mkdirSync(directory,{recursive:true});writeFileSync(join(directory,'ready.json'),'{}')}
    const foreign=join(root,'other-user-artifact');mkdirSync(foreign)
    assert.equal(pruneManagedRuntimes({home:f.home,active:directories[2],previous:directories[1]}),1)
    assert.throws(()=>readFileSync(join(directories[0],'ready.json')))
    assert.equal(readFileSync(join(directories[1],'ready.json'),'utf8'),'{}')
    assert.equal(readFileSync(join(directories[2],'ready.json'),'utf8'),'{}')
    assert.equal(existsSync(foreign),true)
  }finally{rmSync(f.home,{recursive:true})}
})
