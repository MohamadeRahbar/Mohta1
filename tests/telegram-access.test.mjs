import test from 'node:test';
import assert from 'node:assert/strict';
import {telegramTarget,checkTelegramAccess} from '../src/channels/telegram-access.mjs';

const token='123456:FAKE_LOCAL_TEST_TOKEN_123456789';
const channel={id:'telegram',platform:'telegram',target:'example_channel',route:'direct'};
const bot={id:123456,is_bot:true,username:'test_bot',first_name:'Test'};
const chat={id:-1001234567890,type:'channel',title:'Test channel',username:'example_channel'};
function fixture(overrides={}){
 const calls=[];
 const responses={getMe:bot,getChat:chat,getChatMember:{user:bot,status:'administrator',can_post_messages:true},...overrides};
 return {calls,options:{token,resolveRoute:async()=>({proxy:'http://127.0.0.1:10808',source:'windows_proxy'}),request:async(url,options)=>{
   const parsed=new URL(url);assert.equal(parsed.origin,'https://api.telegram.org');assert.equal(options.method,'POST');assert.equal(options.proxy,'http://127.0.0.1:10808');
   const method=parsed.pathname.split('/').pop();assert(['getMe','getChat','getChatMember'].includes(method));calls.push({method,body:options.body});
   const value=responses[method];if(value instanceof Error)throw value;
   return typeof value?.status==='number'?value:{status:200,data:{ok:true,result:value}};
 }}};
}

test('channel username normalization accepts a bare username, @ and numeric IDs',()=>{
 assert.equal(telegramTarget(' example_channel '),'@example_channel');assert.equal(telegramTarget('@example_channel'),'@example_channel');assert.equal(telegramTarget('-1001234'),'-1001234');
 for(const input of ['', 'https://t.me/example_channel','abc?token=secret','user/name'])assert.equal(telegramTarget(input),null);
});

test('access check uses only three read-only Telegram methods and returns safe identity and permissions',async()=>{
 const f=fixture();const result=await checkTelegramAccess(channel,f.options);
 assert.equal(result.ok,true);assert.deepEqual(f.calls.map(c=>c.method),['getMe','getChat','getChatMember']);
 assert.deepEqual(f.calls[1].body,{chat_id:'@example_channel'});assert.deepEqual(f.calls[2].body,{chat_id:chat.id,user_id:bot.id});
 assert.deepEqual(result.checks,{token:'passed',channel:'passed',posting:'passed'});assert.equal(result.chat.title,chat.title);
 assert(!JSON.stringify(result).includes(token));assert(!JSON.stringify(result).includes('http://'));
});

test('missing or malformed configuration makes no external requests',async()=>{
 for(const [input,options,category] of [[channel,{token:''},'token_missing'],[channel,{token:'bad/token'},'token_invalid'],[{...channel,target:''},{token},'target_invalid']]){
   let called=false;const result=await checkTelegramAccess(input,{...options,request:async()=>{called=true;}});assert.equal(called,false);assert.equal(result.category,category);
 }
});

test('invalid token stops before channel lookup and never returns raw API errors',async()=>{
 const f=fixture({getMe:{status:401,data:{ok:false,error_code:401,description:token}}});const result=await checkTelegramAccess(channel,f.options);
 assert.equal(result.category,'token_invalid');assert.equal(f.calls.length,1);assert(!JSON.stringify(result).includes(token));
});

test('valid token is distinguished from inaccessible channels and wrong destination types',async()=>{
 const f=fixture({getChat:{status:400,data:{ok:false,error_code:400}}});const result=await checkTelegramAccess(channel,f.options);
 assert.equal(result.checks.token,'passed');assert.equal(result.category,'channel_inaccessible');assert.equal(f.calls.length,2);
 const group=fixture({getChat:{...chat,type:'supergroup'}});assert.equal((await checkTelegramAccess(channel,group.options)).category,'target_not_channel');assert.equal(group.calls.length,2);
});

test('posting permission must be explicitly granted and belong to this bot',async()=>{
 for(const member of [{user:bot,status:'member'},{user:bot,status:'administrator',can_post_messages:false}]){
   const f=fixture({getChatMember:member});const result=await checkTelegramAccess(channel,f.options);assert.equal(result.ok,false);assert.equal(result.category,'posting_denied');
 }
 const incomplete=fixture({getChatMember:{user:bot,status:'administrator'}});assert.equal((await checkTelegramAccess(channel,incomplete.options)).checks.posting,'unknown');
 const wrong=fixture({getChatMember:{user:{id:9999},status:'administrator',can_post_messages:true}});assert.equal((await checkTelegramAccess(channel,wrong.options)).category,'api_error');
});

test('network and rate-limit errors cannot expose secrets or imply a sent post',async()=>{
 const network=fixture({getMe:new Error('https://api.telegram.org/bot'+token+'/getMe')});const failure=await checkTelegramAccess(channel,network.options);
 assert.equal(failure.category,'connection_failed');assert.equal(network.calls.length,1);assert(!JSON.stringify(failure).includes(token));
 const limited=fixture({getMe:{status:429,data:{ok:false,error_code:429}}});assert.equal((await checkTelegramAccess(channel,limited.options)).category,'rate_limited');assert.equal(limited.calls.length,1);
});
