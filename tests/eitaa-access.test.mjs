import test from 'node:test';
import assert from 'node:assert/strict';
import {checkEitaaAccess,eitaaSetupIssue} from '../eitaa-access.mjs';
const token='123456:FAKE_LOCAL_TEST_TOKEN_123456789',channel={platform:'eitaa',target:'@fixture_channel',route:'direct'};
const success={status:200,data:{ok:true,result:{id:123,is_bot:true,username:'fixture'}}};
test('Eitaayar uses only getMe, the saved network route and no publication request',async()=>{
 const calls=[];
 const result=await checkEitaaAccess(channel,{token,manualProxy:'http://localhost:10000',resolveRoute:async(c,url,options)=>{assert.equal(c,channel);assert.equal(options.manualProxy,'http://localhost:10000');assert.equal(new URL(url).hostname,'eitaayar.ir');return {proxy:'http://localhost:10000',source:'manual_proxy'};},request:async(url,options)=>{calls.push(url.split('/').pop());assert.equal(options.method,'GET');assert.equal(options.proxy,'http://localhost:10000');assert.equal(options.body,undefined);return success;}});
 assert.deepEqual(calls,['getMe']);assert.equal(result.networkReachable,true);assert.equal(result.ok,false);assert.equal(result.category,'posting_unverified');assert.deepEqual(result.checks,{token:'passed',channel:'unknown',posting:'unknown'});assert(!JSON.stringify(result).includes(token));assert(!JSON.stringify(result).includes('10000'));
});
test('missing and malformed Eitaayar configuration stops before network access',async()=>{
 for(const [secret,target] of [['','@fixture'],[token,''],['https://eitaayar.ir/api/token','@fixture'],['token/../path','@fixture'],[token,'https://eitaa.com/fixture'],[token,'a/b']]){
  assert(eitaaSetupIssue({...channel,target},secret));const result=await checkEitaaAccess({...channel,target},{token:secret,resolveRoute:()=>assert.fail('no route'),request:()=>assert.fail('no request')});assert.equal(result.networkReachable,false);assert.equal(result.checks.token,'not_checked');
 }
 for(const target of ['@fixture','fixture','12345','-12345'])assert.equal(eitaaSetupIssue({...channel,target},token),null);
});
test('Eitaayar account identities with is_bot false are valid token checks',async()=>{
 const result=await checkEitaaAccess(channel,{token,resolveRoute:async()=>({source:'system_routing',proxy:''}),request:async()=>({status:200,data:{ok:true,result:{id:123,is_bot:false}}})});
 assert.equal(result.checks.token,'passed');assert.equal(result.networkReachable,true);assert.equal(result.checks.channel,'unknown');assert.equal(result.checks.posting,'unknown');assert.equal(result.ok,false);
});
test('an HTML access restriction is not reported as an invalid Eitaayar token',async()=>{
 const result=await checkEitaaAccess(channel,{token,resolveRoute:async()=>({proxy:''}),request:async()=>({status:403,data:null})});assert.equal(result.category,'access_restricted');assert.notEqual(result.checks.token,'failed');assert.equal(result.networkReachable,true);
});
test('Eitaayar distinguishes rejected tokens, rate limits, service errors and invalid responses without leaking raw errors',async()=>{
 for(const [response,expected] of [[{status:401,data:{ok:false,description:token}},'token_invalid'],[{status:200,data:{ok:false,error_code:403,description:token}},'token_invalid'],[{status:429,data:{}},'rate_limited'],[{status:503,data:{}},'service_error'],[{status:200,data:{ok:false,error_code:400,description:token}},'api_rejected'],[{status:200,data:null},'invalid_response'],[{status:200,data:{ok:true,result:{id:123,is_bot:'true'}}},'invalid_response'],[{status:200,data:{ok:true,result:{is_bot:true}}},'invalid_response']]){
  const result=await checkEitaaAccess(channel,{token,resolveRoute:async()=>({source:'system_routing',proxy:''}),request:async()=>response});assert.equal(result.category,expected);assert.equal(result.networkReachable,true);assert.notEqual(result.checks.token,'passed');assert(!JSON.stringify(result).includes(token));
 }
});
test('Eitaayar DNS, TLS, proxy and timeout failures remain network errors and never expose secrets',async()=>{
 for(const [code,category] of [['ENOTFOUND','dns_error'],['CERT_HAS_EXPIRED','tls_error'],['PROXY_AUTH_REQUIRED','proxy_authentication'],['ETIMEDOUT','platform_unreachable']]){
  const result=await checkEitaaAccess(channel,{token,resolveRoute:async()=>({source:'system_routing',proxy:''}),request:async()=>{throw Object.assign(Error(token),{code});}});assert.equal(result.category,category);assert.equal(result.networkReachable,false);assert.equal(result.checks.token,'not_checked');assert(!JSON.stringify(result).includes(token));
 }
 const result=await checkEitaaAccess(channel,{token,resolveRoute:async()=>{throw Error(token);}});assert.equal(result.category,'route_invalid');assert(!JSON.stringify(result).includes(token));
});
