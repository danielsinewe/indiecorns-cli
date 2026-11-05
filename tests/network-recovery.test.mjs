import test from 'node:test'
import assert from 'node:assert/strict'
import {sourceRetryDelay} from '../indiecorns/lib/network-recovery.mjs'
test('DNS reconnect polling is bounded while explicit cooldowns and security failures keep their delays',()=>{
 for(const code of ['ENOTFOUND','EAI_AGAIN'])assert.equal(sourceRetryDelay(new TypeError('PRIVATE_HOST',{cause:{code}})),60000)
 for(const code of ['ECONNRESET','CERT_HAS_EXPIRED','ERR_TLS_CERT_ALTNAME_INVALID'])assert.equal(sourceRetryDelay(new TypeError('private',{cause:{code}})),300000)
 assert.equal(sourceRetryDelay({cause:{code:'ENOTFOUND'},retryAfterMs:7200000}),7200000)
 assert.equal(sourceRetryDelay({discoveryError:{kind:'authentication',stage:'request',code:'ENOTFOUND'}}),300000)
})
