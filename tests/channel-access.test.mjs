import test from 'node:test';
import assert from 'node:assert/strict';
import {checkChannelAccess,channelSetupIssue} from '../src/channels/channel-access.mjs';
const token='123456:FAKE_LOCAL_TEST_TOKEN_123456789';
test('missing configuration never makes a network call',async()=>{
 for(const platform of ['telegram','bale','rubika','eitaa']){
  for(const [target,secret] of [['',''],['@fixture',''],['',token]]){
   assert(channelSetupIssue({platform,target},secret));const result=await checkChannelAccess({platform,target},{token:secret,request:()=>assert.fail('must not contact network')});assert.equal(result.ok,false);
  }
 }
 const result=await checkChannelAccess({platform:'eitaa',target:'https://example.com'},{token,request:()=>assert.fail('invalid target')});assert.equal(result.category,'target_invalid');assert.equal(result.checks.posting,'not_checked');
});
test('Bale checks the same bot membership and explicit posting permission using read-only methods',async()=>{
 for(const permission of [true,false,undefined]){
  const calls=[],bot={id:123,is_bot:true,username:'fixture_bot'};
  const result=await checkChannelAccess({platform:'bale',target:'@fixture'},{token,resolveRoute:async()=>({proxy:''}),request:async(url,options)=>{
   assert(new URL(url).origin==='https://tapi.bale.ai');const method=url.split('/').pop();calls.push(method);
   const response={getMe:bot,getChat:{id:456,type:'channel',title:'fixture'},getChatMember:{user:bot,status:'administrator',...(permission===undefined?{}:{can_post_messages:permission})}}[method];assert(response);return {status:200,data:{ok:true,result:response}};
  }});
  assert.deepEqual(calls,['getMe','getChat','getChatMember']);assert.equal(result.ok,permission===true);assert.equal(result.checks.posting,permission===true?'passed':permission===false?'failed':'unknown');assert(!JSON.stringify(result).includes(token));
 }
});
test('Rubika validates identity and channel but never invents a posting permission or sends a message',async()=>{
 const calls=[];const result=await checkChannelAccess({platform:'rubika',target:'@fixture'},{token,resolveRoute:async()=>({proxy:''}),request:async url=>{
  const method=url.split('/').pop();calls.push(method);assert(['getMe','getChat'].includes(method));return {status:200,data:{status:'OK',data:method==='getMe'?{bot:{bot_id:'b0fixture',username:'fixture_bot'}}:{chat:{chat_id:'c0fixture',chat_type:'Channel',title:'fixture'}}}};
 }});
 assert.deepEqual(calls,['getMe','getChat']);assert.equal(result.ok,false);assert.equal(result.category,'posting_unverified');assert.deepEqual(result.checks,{token:'passed',channel:'passed',posting:'unknown'});assert(!JSON.stringify(result).includes(token));
});
test('Rubika network, rejected and malformed responses never expose credentials or claim success',async()=>{
 for(const request of [async()=>{throw Error(token);},async()=>({status:401,data:{error:token}}),async()=>({status:200,data:{}})]){
  const result=await checkChannelAccess({platform:'rubika',target:'@fixture'},{token,resolveRoute:async()=>({proxy:''}),request});assert.equal(result.ok,false);assert.notEqual(result.checks.token,'passed');assert(!JSON.stringify(result).includes(token));
 }
});
test('Rubika channel denial keeps the already verified token and distinguishes network errors',async()=>{
 const result=await checkChannelAccess({platform:'rubika',target:'@fixture'},{token,resolveRoute:async()=>({proxy:''}),request:async url=>url.endsWith('/getMe')?{status:200,data:{status:'OK',data:{bot:{bot_id:'b0fixture'}}}}:{status:403,data:{error:'forbidden'}}});
 assert.equal(result.checks.token,'passed');assert.equal(result.checks.channel,'failed');assert.equal(result.category,'channel_inaccessible');assert.equal(result.networkReachable,true);
 const failure=await checkChannelAccess({platform:'rubika',target:'@fixture'},{token,resolveRoute:async()=>({proxy:''}),request:async()=>{throw Object.assign(Error(token),{code:'ENOTFOUND'});}});
 assert.equal(failure.category,'dns_error');assert.equal(failure.networkReachable,false);assert(!JSON.stringify(failure).includes(token));
});
