import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {openStore,publicPost} from '../store.mjs';
import {createMessageControls} from '../message-controls.mjs';
import {createPublisher} from '../publisher.mjs';
import {createLinkTracking,rewriteTrackedPayload} from '../link-tracking.mjs';
import {messageCapabilities} from '../message-options.mjs';
import {sendPost} from '../publish-adapters.mjs';
function fixture(t,platforms=['telegram','bale']){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'mohta-controls-')),store=openStore(directory),id=randomUUID(),actor={id:randomUUID(),role:'admin',channels:platforms,active:1},now=new Date().toISOString();
 store.db.prepare('INSERT INTO users(id,username,name,password,role,channels,created_at) VALUES(?,?,?,?,?,?,?)').run(actor.id,'owner','Owner','unused','admin',JSON.stringify(platforms),now);
 store.db.prepare('INSERT INTO posts(id,type,title,fields,body,body_entities,channels,media,status,version,author_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,'free','Original','{}','Original body','[]',JSON.stringify(platforms),'[]','published',1,actor.id,now,now);
 for(const platform of platforms){store.saveSecret('token:'+platform,'123:fixture_token_1234567890123');store.db.prepare('UPDATE channels SET enabled=1,target=? WHERE id=?').run(platform==='rubika'?'c0fixturechannel':'@fixture',platform);store.db.prepare('INSERT INTO publications(id,post_id,channel_id,status,version,published_at,channel_name,platform,target,message_ids,identity_version) VALUES(?,?,?,?,?,?,?,?,?,?,0)').run(id+platform,id,platform,'sent',1,now,platform,platform,platform==='rubika'?'c0fixturechannel':'-1001',JSON.stringify(platform==='bale'?[222]:[111]));}
 t.after(()=>{store.close();fs.rmSync(directory,{recursive:true,force:true});});return {store,id,actor,post:()=>publicPost(store.db.prepare('SELECT * FROM posts WHERE id=?').get(id))};
}
const route=async()=>({proxy:''});
function transport(calls,{failBale=false,timeout=false}={}){return async(url,options)=>{const method=new URL(url).pathname.split('/').at(-1);calls.push({method,url,body:options.body,upload:!!options.bodyStream});if(method==='getChat')return url.includes('rubika')?{status:200,data:{data:{chat:{chat_type:'Channel',chat_id:'c0fixturechannel'}}}}:{status:200,data:{ok:true,result:{id:-1001,type:'channel'}}};if(timeout)throw Error('123:private_token');if(failBale&&url.includes('bale'))return {status:403,data:{ok:false,description:'private token'}};return url.includes('rubika')?{status:200,data:{data:{message_id:'rubika-id'}}}:{status:200,data:{ok:true,result:method==='sendMessage'?{message_id:333}:true}};};}
function input(f,extra={}){return {action:'edit',channels:['telegram','bale'],version:1,revision:f.post().control_revision,request_id:randomUUID(),body:'Updated 👋🏻 #تست',entities:[{type:'bold',offset:0,length:7}],...extra};}
test('remote edits preserve original publication, record per-destination failures and deduplicate a lost client response',async t=>{
 const f=fixture(t),calls=[],service=createMessageControls(f.store,{request:transport(calls,{failBale:true}),resolveRoute:route}),data=input(f);
 let result=await service.run(f.id,data,f.actor);assert.equal(result.operations.filter(op=>op.status==='success').length,1);assert.equal(result.operations.filter(op=>op.status==='failed').length,1);assert.equal(f.post().body,'Original body');assert.equal(f.post().version,1);assert.equal(f.post().remote_body,data.body);
 assert.equal(f.store.db.prepare("SELECT remote_body FROM publications WHERE channel_id='bale'").get().remote_body,null);const n=calls.length;
 await service.run(f.id,data,f.actor);assert.equal(calls.length,n);assert(!JSON.stringify(result).includes('private_token'));
 await assert.rejects(()=>service.run(f.id,{...data,body:'Changed again'},f.actor),/شناسه درخواست/);
});
test('remote control rejects viewers, foreign channels, stale revisions and changed channel identities',async t=>{
 const f=fixture(t),calls=[],service=createMessageControls(f.store,{request:transport(calls),resolveRoute:route});
 await assert.rejects(()=>service.run(f.id,input(f),{...f.actor,role:'viewer'}),e=>e.status===403);
 await assert.rejects(()=>service.run(f.id,input(f),{...f.actor,role:'publisher',channels:['telegram']}),e=>e.status===403);
 await assert.rejects(()=>service.run(f.id,input(f,{revision:9}),f.actor),e=>e.status===409);
 f.store.db.prepare("UPDATE channels SET identity_version=1 WHERE id='telegram'").run();const result=await service.run(f.id,input(f,{channels:['telegram']}),f.actor);assert.equal(result.operations[0].status,'failed');assert.equal(calls.length,0);
});
test('remote delete respects the 48-hour boundary and requires explicit channel deletion confirmation',async t=>{
 const f=fixture(t),calls=[],service=createMessageControls(f.store,{request:transport(calls),resolveRoute:route,clock:()=>Date.now()+49*3600000});
 await assert.rejects(()=>service.run(f.id,input(f,{action:'delete'}),f.actor),/تایید/);
 const result=await service.run(f.id,input(f,{action:'delete',confirmation:'delete-from-channels'}),f.actor);assert(result.operations.every(op=>op.status==='unsupported'));assert.equal(calls.length,0);assert(!f.store.db.prepare('SELECT remote_deleted_at FROM publications LIMIT 1').get().remote_deleted_at);
});
test('partial album deletion persists each receipt and retries only remaining message IDs',async t=>{
 const f=fixture(t,['telegram']);f.store.db.prepare('UPDATE publications SET message_ids=?').run('[111,112]');let failing=true;const calls=[];
 const request=async(url,options)=>{calls.push({method:new URL(url).pathname.split('/').at(-1),id:options.body?.message_id});if(url.endsWith('/getChat'))return {status:200,data:{ok:true,result:{id:-1001,type:'channel'}}};return failing&&options.body.message_id===112?{status:403,data:{ok:false}}:{status:200,data:{ok:true,result:true}};};
 const service=createMessageControls(f.store,{request,resolveRoute:route});let result=await service.run(f.id,input(f,{channels:['telegram'],action:'delete',confirmation:'delete-from-channels'}),f.actor);assert.equal(result.operations[0].status,'partial');
 failing=false;result=await service.run(f.id,input(f,{channels:['telegram'],action:'delete',confirmation:'delete-from-channels'}),f.actor);assert.equal(calls.filter(c=>c.id===111).length,1);assert.equal(calls.filter(c=>c.id===112).length,2);assert(result.receipts[0].deleted);assert.equal(f.post().status,'published');
});
test('concurrent operations cannot race and interrupted operations are recovered without replay',async t=>{
 const f=fixture(t,['telegram']),calls=[];let release;const wait=new Promise(r=>release=r),base=transport(calls);const service=createMessageControls(f.store,{request:async(...args)=>{if(args[0].endsWith('/editMessageText'))await wait;return base(...args);},resolveRoute:route});
 const pending=service.run(f.id,input(f,{channels:['telegram']}),f.actor);await assert.rejects(()=>service.run(f.id,input(f,{channels:['telegram']}),f.actor),e=>e.status===409);release();await pending;
 f.store.db.prepare("UPDATE message_operations SET status='running'").run();createMessageControls(f.store,{request:()=>assert.fail('must not replay')});assert.equal(f.store.db.prepare('SELECT status FROM message_operations').get().status,'unknown');
});
test('pin failure never changes a successful send or causes it to be repeated',async t=>{
 const f=fixture(t,['telegram']),calls=[];f.store.db.prepare("DELETE FROM publications").run();f.store.db.prepare("UPDATE posts SET status='draft',publish_options=?").run('{"pin":true}');const base=transport(calls);
 const publisher=createPublisher(f.store,{resolveRoute:route,request:(url,options)=>url.endsWith('/pinChatMessage')?Promise.resolve({status:403,data:{ok:false}}):base(url,options)});
 let result=await publisher.publish(f.id,1,f.actor.id);assert.equal(result.sent,1);assert.equal(result.post.status,'published');assert.equal(f.store.db.prepare('SELECT status FROM message_operations').get().status,'failed');
 await publisher.publish(f.id,1,f.actor.id);assert.equal(calls.filter(c=>c.method==='sendMessage').length,1);
});
test('reply resolves a different message ID per destination and missing references block only that destination',async t=>{
 const f=fixture(t),calls=[],reference=randomUUID(),now=new Date().toISOString();f.store.db.prepare('INSERT INTO posts(id,type,title,fields,body,channels,media,status,version,author_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(reference,'free','Reference','{}','old','["telegram"]','[]','published',1,f.actor.id,now,now);
 f.store.db.prepare('INSERT INTO publications(id,post_id,channel_id,status,version,target,platform,message_ids,identity_version) VALUES(?,?,?,?,?,?,?,?,0)').run('reference',reference,'telegram','sent',1,'-1001','telegram','[998]');f.store.db.prepare('DELETE FROM publications WHERE post_id=?').run(f.id);f.store.db.prepare("UPDATE posts SET status='draft',publish_options=? WHERE id=?").run(JSON.stringify({reply_to:{post_id:reference,version:1}}),f.id);
 const result=await createPublisher(f.store,{request:transport(calls),resolveRoute:route}).publish(f.id,1,f.actor.id);assert.equal(result.sent,1);assert.equal(result.results.find(r=>r.channel_id==='bale').status,'blocked');assert.equal(calls.find(c=>c.method==='sendMessage').body.reply_parameters.message_id,998);
});
test('tracking preserves UTF-16 formatting, explicit links, per-channel identity and preview separation',t=>{
 const f=fixture(t),tracking=createLinkTracking(f.store,'brand-fixture',{publicUrl:'https://panel.example.com/'});assert(!tracking.configuration().enabled);f.store.saveSettings({...f.store.settings(),trackingEnabled:true});
 const text='👋🏻 https://example.com/path#part پایان',payload={text,caption:null,entities:[{type:'bold',offset:0,length:text.length}]},first=tracking.transform(f.id,'telegram',payload),same=tracking.transform(f.id,'telegram',payload),other=tracking.transform(f.id,'bale',payload);
 assert.equal(first.text,same.text);assert.notEqual(first.text,other.text);assert.equal(first.entities[0].length,first.text.length);assert(first.text.includes('👋🏻 '));assert(first.text.endsWith(' پایان'));
 const link=f.store.db.prepare("SELECT id FROM tracked_links WHERE channel_id='telegram'").get().id;
 const response=()=>({writeHead(status,headers){assert.equal(status,302);assert.equal(headers.Location,'https://example.com/path#part');},end(){}});
 tracking.redirect({method:'HEAD',headers:{},socket:{}},response(),link);tracking.redirect({method:'GET',headers:{'user-agent':'TelegramBot'},socket:{remoteAddress:'127.0.0.1'}},response(),link);tracking.redirect({method:'GET',headers:{'user-agent':'Browser'},socket:{remoteAddress:'127.0.0.1'}},response(),link);tracking.redirect({method:'GET',headers:{'user-agent':'Browser'},socket:{remoteAddress:'127.0.0.1'}},response(),link);
 const stats=tracking.stats(f.id,f.actor).destinations.find(s=>s.channel_id==='telegram');assert.equal(stats.clicks,2);assert.equal(stats.previews,1);assert.equal(stats.approximate_sessions,1);assert(!JSON.stringify(f.store.db.prepare('SELECT * FROM link_events').all()).includes('127.0.0.1'));
 const linked=rewriteTrackedPayload({text:'Label',caption:null,entities:[{type:'text_link',offset:0,length:5,url:'https://example.org'}]},()=> 'https://panel.example.com/r/opaque');assert.equal(linked.text,'Label');assert.equal(linked.entities[0].url,'https://panel.example.com/r/opaque');
});
test('unavailable features are explicit rather than fake success or zero views',()=>{
 assert.equal(messageCapabilities('eitaa').edit,false);assert.equal(messageCapabilities('rubika').pin,false);assert.equal(messageCapabilities('bale',{mediaCount:1}).media,false);assert.equal(messageCapabilities('telegram').views.supported,false);
});

test('tracked remote edits retain destination-specific URLs and raw editable text',async t=>{
 const f=fixture(t,['telegram']),calls=[];f.store.saveSettings({...f.store.settings(),trackingEnabled:true});f.store.db.prepare('UPDATE posts SET publish_options=?').run('{"track_links":true}');
 const tracking=createLinkTracking(f.store,'default',{publicUrl:'https://panel.example.com'}),service=createMessageControls(f.store,{tracking,request:transport(calls),resolveRoute:route});
 await service.run(f.id,input(f,{channels:['telegram'],body:'Visit https://example.org/new'}),f.actor);
 assert.match(calls.find(c=>c.method==='editMessageText').body.text,/https:\/\/panel.example.com\/r\/default\//);assert.equal(f.post().remote_body,'Visit https://example.org/new');
});

test('Telegram replacement persists changed media only after provider acknowledgement',async t=>{
 const f=fixture(t,['telegram']),ids=[randomUUID(),randomUUID()],calls=[];fs.mkdirSync(path.join(f.store.directory,'media'),{recursive:true});
 for(const id of ids){fs.writeFileSync(path.join(f.store.directory,'media',id+'.png'),'fixture');f.store.db.prepare('INSERT INTO media(id,name,mime,size,path,created_at,owner_id) VALUES(?,?,?,?,?,?,?)').run(id,'fixture.png','image/png',7,id+'.png',new Date().toISOString(),f.actor.id);}
 f.store.db.prepare('UPDATE posts SET media=?,publication_media_ids=?,primary_media_id=?').run(JSON.stringify([ids[0]]),JSON.stringify([ids[0]]),ids[0]);
 const service=createMessageControls(f.store,{request:async(url,options)=>{if(options.bodyStream){let body='';for await(const chunk of options.bodyStream)body+=Buffer.from(chunk).toString();calls.push({method:'upload',body});return {status:200,data:{ok:true,result:{message_id:111}}};}return transport(calls)(url,options);},resolveRoute:route});
 let result=await service.run(f.id,input(f,{channels:['telegram'],media_id:ids[1],media_index:0}),f.actor);assert.equal(result.operations[0].status,'success');assert.deepEqual(result.receipts[0].media_ids,[ids[1]]);assert.deepEqual(f.post().media,[ids[0]]);assert.match(calls.find(c=>c.method==='upload').body,/attach:\/\/mediaFile/);
});

test('Eitaa sends pin and reply inline while Bale and Rubika preserve their destination reply IDs',async t=>{
 const f=fixture(t,['telegram']);
 for(const platform of ['eitaa','bale','rubika']){const calls=[],channel={id:platform,platform,target:platform==='rubika'?'c0fixturechannel':'@fixture',route:'direct'},token=platform==='rubika'?'fixtureToken12345678901234567890123':'123:fixture_token_1234567890123';
 const request=async(url,options)=>{calls.push({method:new URL(url).pathname.split('/').at(-1),body:options.body||Object.fromEntries(new URLSearchParams(options.rawBody||''))});if(url.endsWith('/getMe'))return {status:200,data:{ok:true,result:{id:1234}}};if(url.endsWith('/getChat'))return platform==='rubika'?{status:200,data:{status:'OK',data:{chat:{chat_type:'Channel',chat_id:'c0fixturechannel'}}}}:{status:200,data:{ok:true,result:{type:'channel',id:-1001}}};return platform==='rubika'?{status:200,data:{status:'OK',data:{message_id:'new-id'}}}:{status:200,data:{ok:true,result:{message_id:555,chat:{id:-1001}}}};};
 await sendPost({...f.post(),channels:[platform]},channel,{token,files:[],request,resolveRoute:route,pin:true,replyTo:{messageId:987,target:platform==='rubika'?'c0fixturechannel':'-1001'}});
 const body=calls.find(c=>c.method==='sendMessage').body;assert.equal(String(body.reply_to_message_id),'987');if(platform==='eitaa')assert.equal(body.pin,'1');
 }
});
