import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {sendPost,adapterPreflight,channelAvailability} from '../publish-adapters.mjs';
const token='123456:FAKE_LOCAL_TEST_TOKEN_123456789',channel={platform:'eitaa',enabled:true,target:'@fixture_channel',route:'direct'},post={type:'free',title:'Internal',body:'سلام کالاپینگ 👋🏻\n#KalaPing',body_entities:[{type:'bold',offset:5,length:8}],fields:{},channels:['eitaa'],media:[],publication_media_ids:[]};
const account={status:200,data:{ok:true,result:{id:123,is_bot:false}}},route=async()=>({source:'system_routing',proxy:''});
test('Eitaayar sends the exact text once, strips @, uses only documented methods and accepts a receipt',async()=>{
 const calls=[];const result=await sendPost(post,channel,{token,files:[],resolveRoute:route,request:async(url,options)=>{assert.equal(new URL(url).hostname,'eitaayar.ir');const method=url.split('/').pop();calls.push(method);if(method==='getMe')return account;assert.equal(method,'sendMessage');const body=new URLSearchParams(options.rawBody);assert.equal(body.get('chat_id'),'fixture_channel');assert.equal(body.get('text'),post.body);assert.equal(body.get('title'),'Internal');assert.equal(body.get('parse_mode'),null);return {status:200,data:{ok:true,result:{message_id:91,chat:{id:42}}}};}});
 assert.deepEqual(calls,['getMe','sendMessage']);assert.deepEqual(result,{messageIds:[91],target:'42'});assert.equal(channelAvailability(channel,true).ready,true);
});
test('Eitaayar attaches photo or video and caption in a single sendFile and rejects unsupported albums',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'desk-eitaa-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 for(const mime of ['image/png','video/mp4']){const file=path.join(dir,'asset');fs.writeFileSync(file,Buffer.from('fixture'));let sends=0;const result=await sendPost({...post,media:['asset'],publication_media_ids:['asset']},channel,{token,files:[{path:file,name:'asset',mime,size:7}],resolveRoute:route,request:async(url,options)=>{if(url.endsWith('/getMe'))return account;assert(url.endsWith('/sendFile'));sends++;const chunks=[];for await(const chunk of options.bodyStream)chunks.push(chunk);const body=Buffer.concat(chunks).toString();assert(body.includes('name="caption"'));assert(body.includes(post.body));assert(body.includes('name="file"'));assert(!body.includes('name="text"'));return {status:200,data:{ok:true,result:{message_id:99}}};}});assert.equal(sends,1);assert.deepEqual(result.messageIds,[99]);}
 assert.throws(()=>adapterPreflight(post,channel,token,[{},{}]),e=>e.code==='album_unavailable');
});
test('Eitaayar rejected destinations remain retryable while missing or lost receipts remain uncertain',async()=>{
 for(const [mode,unknown,category] of [['rejected',false,'channel_inaccessible'],['denied',false,'posting_denied'],['missing',true,'receipt_missing'],['timeout',true,'connection_failed']]){
  await assert.rejects(()=>sendPost(post,channel,{token,files:[],resolveRoute:route,request:async url=>{if(url.endsWith('/getMe'))return account;if(mode==='timeout')throw Error(token);return {status:200,data:mode==='missing'?{ok:true,result:{}}:{ok:false,description:mode==='rejected'?'channel not found':'bot is not admin'}};}}),e=>{assert.equal(e.code,category);assert.equal(e.deliveryUnknown,unknown);assert(!e.message.includes(token));return true;});
 }
});
