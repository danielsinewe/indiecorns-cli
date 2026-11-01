import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,statSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {credential,storeCredential} from '../indiecorns/lib/credentials.mjs'

test('provider credentials persist privately for supervised processes without echoing their value',()=>{
  const directory=mkdtempSync(join(tmpdir(),'indiecorns-credentials-'))
  try {
    const result=storeCredential(directory,'slack','test-secret')
    assert.deepEqual(result,{provider:'slack',configured:true})
    assert.equal(credential(directory,'slack',{}),'test-secret')
    assert.equal(credential(directory,'slack',{INDIECORNS_SLACK_TOKEN:'environment'}),'environment')
    if(process.platform!=='win32') assert.equal(statSync(join(directory,'credentials.json')).mode&0o777,0o600)
    storeCredential(directory,'slack',null)
    assert.equal(credential(directory,'slack',{}),null)
    assert.doesNotMatch(readFileSync(join(directory,'credentials.json'),'utf8'),/test-secret/)
    assert.throws(()=>storeCredential(directory,'other','test'))
    assert.throws(()=>storeCredential(directory,'slack','bad\nsecret'))
  }finally{rmSync(directory,{recursive:true})}
})
