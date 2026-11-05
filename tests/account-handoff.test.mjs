import test from 'node:test'
import assert from 'node:assert/strict'
import {checkAccountHandoff,completedAccountMatches} from '../indiecorns/lib/account-handoff.mjs'
const options={appUrl:'https://app.indiecorns.com',headers:{'x-indiecorns-cli-session':'session','x-indiecorns-cli-secret':'private'},expectedAccountId:'user_webAccount'}
test('compares authenticated server identity, never a cached name or provider login',async()=>{
 for(const [userId,state] of [['user_webAccount','matched'],['user_terminalAccount','account_mismatch']]) {
  const result=await checkAccountHandoff({...options,request:async(url,init)=>{assert.equal(url,options.appUrl+'/api/community/worker-account');assert.equal(init.method,'GET');assert.equal(init.redirect,'error');return Response.json({userId,email:'must not propagate'})}})
  assert.deepEqual(result,{state});assert.doesNotMatch(JSON.stringify(result),/private|email|user_/)
 }
})
test('dependency outages and invalid responses never trigger account recovery',async()=>{
 for(const response of [new Response('',{status:503}),Response.json({userId:'bad'}),new Response('x'.repeat(4097)),new Response('{')])assert.equal((await checkAccountHandoff({...options,request:async()=>response})).state,'service_unavailable')
 assert.equal((await checkAccountHandoff({...options,request:async()=>{throw new Error('timeout')}})).state,'service_unavailable')
 assert.equal((await checkAccountHandoff({...options,request:async()=>new Response('',{status:401})})).state,'authorization_required')
})
test('wrong or missing browser actor is rejected before saving a completed authorization',()=>{
 assert.equal(completedAccountMatches({userId:'user_other'},options.expectedAccountId),false)
 assert.equal(completedAccountMatches({},options.expectedAccountId),false)
 assert.equal(completedAccountMatches({userId:options.expectedAccountId},options.expectedAccountId),true)
 assert.equal(completedAccountMatches({userId:'legacy'},undefined),true)
})
test('unbound commands remain compatible; invalid account argument never reaches provider',async()=>{
 assert.deepEqual(await checkAccountHandoff({}),{state:'unbound'})
 await assert.rejects(checkAccountHandoff({...options,expectedAccountId:'x; echo bad',request:()=>assert.fail()}),/--account/)
})
