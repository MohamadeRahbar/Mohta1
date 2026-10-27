import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {openStore} from '../store.mjs';
import {createPublisher} from '../publisher.mjs';
import {sendPost,baleText,channelAvailability} from '../publish-adapters.mjs';
import {requestJson} from '../network.mjs';
import {multipart} from '../multipart.mjs';
const token='123:'+('fixture_secret_'.repeat(3));
const route=async()=>({proxy:''});
function fixture(t,channels=['telegram']){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'desk-publish-')),store=openStore(directory),actor=randomUUID(),id=randomUUID(),now=new Date().toISOString();
 store.db.prepare('INSERT INTO users(id,username,name,password,role,channels,created_at) VALUES(?,?,?,?,?,?,?)').run(actor,actor,'test','unused','admin',JSON.stringify(channels),now);
 const post={id,type:'free',title:'داخلی',fields:{description:'سلام 👋🏻'},body:'سلام 👋🏻',body_entities:[],channels,media:[],publication_media_ids:[],version:1,status:'draft'};
 store.db.prepare('INSERT INTO posts(id,type,title,fields,body,channels,media,status,version,author_id,created_at,updated_at,publication_media_ids,body_entities) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,post.type,post.title,JSON.stringify(post.fields),post.body,JSON.stringify(channels),'[]','draft',1,actor,now,now,'[]','[]');
 for(const channel of channels){store.saveSecret('token:'+channel,token);store.db.prepare('UPDATE channels SET enabled=1,target=? WHERE id=?').run(channel==='rubika'?'c0fixturechannel':'@fixture_channel',channel);}
 t.after(()=>{store.close();fs.rmSync(directory,{recursive:true,force:true});});return {store,post,actor};
}
const telegramSuccess=async(url,options)=>url.endsWith('/getChat')?{status:200,data:{ok:true,result:{id:-100123,type:'channel'}}}:{status:200,data:{ok:true,result:{message_id:123}}};
test('four destinations: explicit unknown resolution enables repeatable selective retries without duplicate successes',async t=>{
 const {store,post,actor}=fixture(t,['telegram','bale','rubika','eitaa']);let eitaaFail=true;const sends=[];
 const service=createPublisher(store,{resolveRoute:route,request:async url=>{
  const platform=url.includes('rubika')?'rubika':url.includes('bale')?'bale':url.includes('eitaayar')?'eitaa':'telegram';
  if(url.endsWith('/getMe'))return {status:200,data:{ok:true,result:{id:123}}};
  if(url.endsWith('/getChat'))return platform==='rubika'?{status:200,data:{status:'OK',data:{chat:{chat_type:'Channel',chat_id:'c0fixturechannel'}}}}:telegramSuccess(url);
  sends.push(platform);if(platform==='telegram'||platform==='eitaa'&&eitaaFail)throw Object.assign(new Error(token),{code:'ETIMEDOUT'});
  return {status:200,data:platform==='rubika'?{status:'OK',data:{message_id:'123'}}:{ok:true,result:{message_id:123}}};
 }});
 let result=await service.publish(post.id,1,actor);assert.equal(result.sent,2);
 const inspect=()=>service.report({...post,status:store.db.prepare('SELECT status FROM posts WHERE id=?').get(post.id).status});
 const decision=(channel_id,decision)=>{const row=inspect().results.find(row=>row.channel_id===channel_id);return {version:1,channel_id,decision,confirmed:true,updated_at:row.updated_at,revision:row.revision};};
 const telegramDecision=decision('telegram','observed_sent');let report=service.resolve(post.id,telegramDecision,actor);
 const telegram=report.results.find(r=>r.channel_id==='telegram');assert.equal(telegram.confirmation,'manual');assert.deepEqual(telegram.message_ids,[]);assert.equal(telegram.published_at,null);assert.throws(()=>service.resolve(post.id,telegramDecision,actor),/تغییر/);
 const absent=decision('eitaa','observed_absent');assert.throws(()=>service.resolve(post.id,{...absent,confirmed:false},actor),/تایید/);assert.throws(()=>service.resolve(post.id,{...absent,version:2},actor),/نسخه/);
 service.resolve(post.id,absent,actor);
 result=await service.publish(post.id,1,actor,{channelIds:['eitaa']});assert.equal(result.results.find(r=>r.channel_id==='eitaa').status,'unknown');
 // A second timeout can be investigated and retried again, not permanently locked.
 service.resolve(post.id,decision('eitaa','observed_absent'),actor);eitaaFail=false;
 result=await service.publish(post.id,1,actor,{channelIds:['eitaa']});assert.equal(result.sent,4);assert.equal(result.post.status,'published');
 assert.deepEqual([...sends.slice(0,4)].sort(),['bale','eitaa','rubika','telegram']);assert.deepEqual(sends.slice(4),['eitaa','eitaa']);
 report=inspect();const history=report.results.find(r=>r.channel_id==='eitaa').history;
 assert.equal(history.filter(h=>h.action==='post.publish-attempt').length,3);assert.equal(history.filter(h=>h.action==='post.publish-resolve').length,2);assert.equal(history.filter(h=>h.transport==='ETIMEDOUT').length,2);assert(history.every(h=>h.id&&h.at));assert(!JSON.stringify(report).includes(token));
 const start=JSON.parse(store.db.prepare("SELECT detail FROM audit WHERE action='post.publish-start' ORDER BY id DESC LIMIT 1").get().detail);assert.deepEqual(start.channels,['eitaa']);
 await service.publish(post.id,1,actor,{channelIds:['eitaa']});assert.equal(sends.length,6);
 await assert.rejects(()=>service.publish(post.id,1,actor,{channelIds:['unrelated']}),/مقصد/);
 await assert.rejects(()=>service.publish(post.id,1,actor,{channelIds:[]}),/مقصد/);
});
test('unknown resolution cannot race active publication or mutate archived content',async t=>{
 const {store,post,actor}=fixture(t);const service=createPublisher(store,{resolveRoute:route,request:async url=>{if(url.endsWith('getChat'))return telegramSuccess(url);throw Error('lost');}});
 await service.publish(post.id,1,actor);const row=service.report(post).results[0],data={version:1,channel_id:'telegram',decision:'observed_absent',confirmed:true,updated_at:row.updated_at,revision:row.revision};
 store.db.prepare("UPDATE posts SET status='publishing' WHERE id=?").run(post.id);assert.throws(()=>service.resolve(post.id,data,actor),/حال ارسال/);
 store.db.prepare("UPDATE posts SET status='partial',archived_at=? WHERE id=?").run(new Date().toISOString(),post.id);assert.throws(()=>service.resolve(post.id,data,actor),/بایگانی/);
 assert.equal(service.receipts(post)[0].status,'unknown');
});
test('one click publishes each configured destination once; concurrent and repeated calls cannot duplicate',async t=>{
 const {store,post,actor}=fixture(t,['telegram','bale']);let sends=0,release;
 const wait=new Promise(resolve=>release=resolve);
 const service=createPublisher(store,{resolveRoute:route,request:async(url,options)=>{if(url.endsWith('/sendMessage')){sends++;await wait;}return telegramSuccess(url,options);}});
 const pending=service.publish(post.id,1,actor);await assert.rejects(()=>service.publish(post.id,1,actor),/حال انجام/);release();const result=await pending;
 assert.equal(result.sent,2);assert.equal(result.post.status,'published');assert.equal(sends,2);assert.equal((await service.publish(post.id,1,actor)).sent,2);assert.equal(sends,2);
 assert.equal(store.db.prepare("SELECT count(*) n FROM publications WHERE status='sent'").get().n,2);assert(!JSON.stringify(result).includes(token));
});
test('partial success retries only definitive failures and preserves successful message IDs',async t=>{
 const {store,post,actor}=fixture(t,['telegram','bale','eitaa','whatsapp']);let baleFails=true;store.saveSecret('token:eitaa','');const counts={telegram:0,bale:0};
 const service=createPublisher(store,{resolveRoute:route,request:async(url,options)=>{const platform=url.includes('bale')?'bale':'telegram';if(url.endsWith('/sendMessage')){counts[platform]++;if(platform==='bale'&&baleFails)return {status:403,data:{ok:false,error_code:403,description:token}};}return telegramSuccess(url,options);}});
 let result=await service.publish(post.id,1,actor);assert.equal(result.sent,1);assert.equal(result.post.status,'partial');assert.equal(result.results.find(r=>r.channel_id==='whatsapp').status,'blocked');assert(!JSON.stringify(result).includes(token));
 baleFails=false;result=await service.publish(post.id,1,actor);assert.equal(result.sent,2);assert.deepEqual(counts,{telegram:1,bale:2});
});
test('lost response, malformed success and service errors are uncertain and never resent',async t=>{
 for(const mode of ['timeout','invalid','server-error']){
  const {store,post,actor}=fixture(t);let sends=0;
  const service=createPublisher(store,{resolveRoute:route,request:async(url,options)=>{if(url.endsWith('/getChat'))return telegramSuccess(url,options);sends++;if(mode==='timeout')throw new Error(token);if(mode==='invalid')return {status:200,data:null};return {status:502,data:{}};}});
  let result=await service.publish(post.id,1,actor);assert.equal(result.post.status,'uncertain');assert.equal(result.results[0].status,'unknown');assert(!JSON.stringify(result).includes(token));result=await service.publish(post.id,1,actor);assert.equal(sends,1);assert.equal(result.sent,0);
 }
});
test('startup recovers interrupted sends as uncertain and rejects stale or expired versions',async t=>{
 const {store,post,actor}=fixture(t);store.db.prepare("UPDATE posts SET status='publishing' WHERE id=?").run(post.id);store.db.prepare('INSERT INTO publications(id,post_id,channel_id,status,version) VALUES(?,?,?,?,?)').run(post.id+':1:telegram',post.id,'telegram','sending',1);
 const service=createPublisher(store,{request:()=>{throw new Error('must not send');},resolveRoute:route});assert.equal((await service.publish(post.id,1,actor)).results[0].status,'unknown');
 await assert.rejects(()=>service.publish(post.id,2,actor),/نسخه/);store.db.prepare('UPDATE posts SET expires_at=? WHERE id=?').run('2000-01-01T00:00:00Z',post.id);await assert.rejects(()=>service.publish(post.id,1,actor),/منقضی/);
});
test('preflight blocks disabled, missing, unsupported channels and Rubika albums without network calls',async t=>{
 const {store,post,actor}=fixture(t,['telegram','rubika']);store.db.prepare("UPDATE channels SET enabled=0 WHERE id='telegram'").run();store.saveSecret('token:rubika','');
 const result=await createPublisher(store,{request:()=>{throw new Error('must not send');}}).publish(post.id,1,actor);assert(result.results.every(r=>r.status==='blocked'));assert.equal(result.post.status,'draft');
 assert.equal(channelAvailability({platform:'whatsapp'},true).ready,false);
 await assert.rejects(()=>sendPost({...post,media:['1','2'],publication_media_ids:['1','2']},{platform:'rubika',target:'c0fixturechannel'},{token,files:[{mime:'image/png'},{mime:'image/png'}]}),/آلبوم/);
});
test('an additional publisher does not recover another active process when recovery is disabled',async t=>{
 const {store,post}=fixture(t);store.db.prepare("UPDATE posts SET status='publishing' WHERE id=?").run(post.id);store.db.prepare('INSERT INTO publications(id,post_id,channel_id,status,version) VALUES(?,?,?,?,?)').run(post.id+':1:telegram',post.id,'telegram','sending',1);
 createPublisher(store,{recoverInterrupted:false});assert.equal(store.db.prepare('SELECT status FROM posts WHERE id=?').get(post.id).status,'publishing');assert.equal(store.db.prepare('SELECT status FROM publications WHERE post_id=?').get(post.id).status,'sending');
});
test('Rubika resolves a channel username before sending to the verified channel ID',async()=>{
 const calls=[];await sendPost({type:'free',body:'سلام',body_entities:[],media:[],channels:['rubika']},{platform:'rubika',target:'@example_channel'},{token,files:[],resolveRoute:route,request:async(url,options)=>{calls.push({url,body:options.body});return url.endsWith('/getChat')?{status:200,data:{status:'OK',data:{chat:{chat_type:'Channel',chat_id:'c0resolvedchannel'}}}}:{status:200,data:{status:'OK',data:{message_id:'resolved-id'}}};}});
 assert.equal(calls.length,2);assert.equal(calls[0].body.chat_id,'@example_channel');assert.equal(calls[1].body.chat_id,'c0resolvedchannel');assert.equal(calls[1].body.text,'سلام');
});
test('Telegram photo, video and mixed album attach one caption and preserve selected order and UTF-16 styles',async t=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'desk-wire-'));t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));const photo=path.join(folder,'photo.png'),video=path.join(folder,'clip.mp4');fs.writeFileSync(photo,'PHOTO_BYTES');fs.writeFileSync(video,'VIDEO_BYTES');
 const files=[{id:'photo',path:photo,mime:'image/png',name:'photo.png',size:11},{id:'video',path:video,mime:'video/mp4',name:'clip.mp4',size:11}],body='👋🏻 سلام',entities=[{type:'bold',offset:5,length:4}];
 for(const selected of [[files[0]],[files[1]],files]){
  let writes=0;const post={type:'free',body,body_entities:entities,media:selected.map(f=>f.id),publication_media_ids:selected.map(f=>f.id),channels:['telegram']};
  await sendPost(post,{platform:'telegram',target:'fixture_channel'},{token,files:selected,resolveRoute:route,request:async(url,options)=>{if(url.endsWith('/getChat'))return telegramSuccess(url,options);writes++;const chunks=[];for await(const chunk of options.bodyStream)chunks.push(chunk);const raw=Buffer.concat(chunks).toString();assert.equal(Buffer.byteLength(raw),Number(options.headers['Content-Length']));assert.equal(raw.split(body).length-1,1);assert(raw.includes('caption_entities'));if(selected.length===2){assert(url.endsWith('/sendMediaGroup'));assert(raw.indexOf('PHOTO_BYTES')<raw.indexOf('VIDEO_BYTES'));assert(raw.includes('attach://asset0'));}return {status:200,data:{ok:true,result:selected.length===2?[{message_id:1},{message_id:2}]:{message_id:1}}};}});assert.equal(writes,1);
 }
});
test('Rubika text metadata and single file upload use the documented API without a separate caption message',async t=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'desk-rubika-'));t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));const file=path.join(folder,'photo.png');fs.writeFileSync(file,'PHOTO');let writes=0,uploads=0;
 const request=async(url,options)=>{if(url.endsWith('/getChat'))return {status:200,data:{status:'OK',data:{chat:{chat_type:'Channel',chat_id:'c0fixturechannel'}}}};if(url.endsWith('/requestSendFile'))return {status:200,data:{data:{upload_url:'https://upload.rubika.ir/fixture'}}};if(url.includes('upload.rubika.ir')){for await(const _ of options.bodyStream){}uploads++;return {status:200,data:{data:{file_id:'uploaded-file'}}};}writes++;if(url.endsWith('/sendFile')){assert.equal(options.body.text,'متن');assert.equal(options.body.file_id,'uploaded-file');}else assert.equal(options.body.metadata.meta_data_parts[0].type,'Bold');return {status:200,data:{status:'OK',data:{message_id:'rubika-id'}}};};
 const post={type:'free',body:'متن',body_entities:[{type:'bold',offset:0,length:3}],media:[],channels:['rubika']},channel={platform:'rubika',target:'c0fixturechannel'};
 await sendPost(post,channel,{token,files:[],request,resolveRoute:route});await sendPost({...post,media:['photo'],publication_media_ids:['photo']},channel,{token,files:[{path:file,mime:'image/png',name:'photo.png',size:5}],request,resolveRoute:route});assert.equal(writes,2);assert.equal(uploads,1);
});
test('Bale uses native Markdown, retains plain free text unchanged and omits unsupported underline markers',()=>{
 assert.equal(baleText('متن آزاد 👋🏻',[]),'متن آزاد 👋🏻');assert.equal(baleText('سلام',[{type:'underline',offset:0,length:4}]),'سلام');assert.equal(baleText('سلام',[{type:'bold',offset:0,length:4}]),' *سلام* ');
});
test('Bale bold uses one marker on each side and coalesces adjacent UTF-16 ranges',()=>{
 const text='فعالیت برندتستی به زودی شروع میشود 🚀\nاز شنبه ..\n#ExampleX';
 assert.equal(baleText(text,[{type:'bold',offset:7,length:9}]),'فعالیت *برندتستی* به زودی شروع میشود 🚀\nاز شنبه ..\n#ExampleX');
 assert.equal(baleText('👋🏻 سلام',[{type:'bold',offset:5,length:2},{type:'bold',offset:7,length:2}]),'👋🏻 *سلام* ');
 assert.equal(baleText('متن *عادی*',[]),'متن *عادی*');
});
test('Bale text, photo, video and album use the same destination-specific bold conversion',async t=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'desk-bale-format-'));t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));const file=path.join(folder,'asset');fs.writeFileSync(file,'BYTES');
 const image={id:'image',path:file,name:'photo.png',mime:'image/png',size:5},video={id:'video',path:file,name:'clip.mp4',mime:'video/mp4',size:5};
 for(const files of [[],[image],[video],[image,video]]){
  const post={type:'free',body:'برندتستی',body_entities:[{type:'bold',offset:0,length:'برندتستی'.length}],media:files.map(f=>f.id),publication_media_ids:files.map(f=>f.id),channels:['bale']};let sends=0;
  await sendPost(post,{platform:'bale',target:'@example_channel'},{token,files,resolveRoute:route,request:async(url,options)=>{if(url.endsWith('/getChat'))return telegramSuccess(url,options);sends++;if(!files.length)assert.equal(options.body.text,' *برندتستی* ');else{const chunks=[];for await(const chunk of options.bodyStream)chunks.push(chunk);const raw=Buffer.concat(chunks).toString();assert.equal(raw.split(' *برندتستی* ').length-1,1);assert(!raw.includes('**برندتستی**'));}return {status:200,data:{ok:true,result:files.length>1?[{message_id:1},{message_id:2}]:{message_id:1}}};}});assert.equal(sends,1);
 }
});
test('Rubika malformed send responses remain uncertain; a failed read-only check remains safe to retry',async()=>{
 const post={type:'free',body:'سلام',body_entities:[],media:[],channels:['rubika']},channel={platform:'rubika',target:'c0fixturechannel'};
 await assert.rejects(()=>sendPost(post,channel,{token,files:[],resolveRoute:route,request:async url=>url.endsWith('/getChat')?{status:200,data:{chat_type:'Channel',chat_id:'c0fixturechannel'}}:{status:200,data:null}}),error=>error.deliveryUnknown===true);
 await assert.rejects(()=>sendPost(post,channel,{token,files:[],resolveRoute:route,request:async()=>({status:200,data:null})}),error=>error.deliveryUnknown===false);
});
test('streamed multipart uses the same real HTTP transport and an exact byte count',async t=>{
 const file=path.join(os.tmpdir(),'multipart-'+randomUUID());fs.writeFileSync(file,'LOCAL_FILE');t.after(()=>fs.rmSync(file,{force:true}));
 const server=http.createServer(async(req,res)=>{const parts=[];for await(const chunk of req)parts.push(chunk);const bytes=Buffer.concat(parts);assert.equal(bytes.length,Number(req.headers['content-length']));assert(bytes.toString().includes('LOCAL_FILE'));res.setHeader('Content-Type','application/json');res.end('{"ok":true}');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const response=await requestJson('http://127.0.0.1:'+server.address().port,{method:'POST',...multipart({caption:'سلام'},[{field:'photo',path:file,name:'photo.png',mime:'image/png'}])});assert.equal(response.data.ok,true);
});
