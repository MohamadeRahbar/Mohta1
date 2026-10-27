import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {delivery,validateReady} from '../src/publishing/delivery.mjs';
import {requestJson,validateProxy} from '../src/infrastructure/network.mjs';
import {renderContent,alignHeadline,titleText} from '../src/content/content.mjs';
import {buildTextPrompt} from '../src/ai/text-assist.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64');

test('single-message payload excludes references and enforces caption bounds',()=>{
 const post={media:['reference','final'],primary_media_id:'final',body:'کپشن',channels:['telegram']};
 assert.deepEqual(delivery(post),{mode:'media_caption',mediaId:'final',caption:'کپشن',text:null,entities:[{type:'bold',offset:0,length:4}],messageCount:1});
 assert.throws(()=>validateReady({...post,body:'x'.repeat(1025)}),/۱۰۲۴/);
 assert.equal(validateReady({...post,body:'x'.repeat(1024)}).messageCount,1);
 assert.equal(delivery({...post,media:[],primary_media_id:null}).mode,'text');
});

test('manual sections override defaults without leaking topic or duplicating the title',()=>{
 const settings={brand:'برند ما',contact:'تماس پیش‌فرض',website:'https://example.com',currency:'تومان'};
 const fields={brand:'Cisco',model:'A',topic:'موضوع داخلی محرمانه',description:'توضیح دستی من',specs:'مشخصات مستند',cta:'دعوت اختصاصی',contact_override:'تماس مخصوص این پست'};
 const body=renderContent('stock','عنوان من',fields,settings);
 assert.equal(body.split('\n')[0],'عنوان من');for(const part of ['توضیح دستی من','مشخصات مستند','دعوت اختصاصی','تماس مخصوص این پست'])assert(body.includes(part));
 for(const part of ['موضوع داخلی محرمانه','تماس پیش‌فرض','https://example.com','ثبت سفارش همین مدل'])assert(!body.includes(part));
 const without=renderContent('stock','عنوان من',{...fields,cta:'',contact_override:''},settings);assert(!without.includes('دعوت اختصاصی'));assert(!without.includes('تماس پیش‌فرض'));
 assert.equal(alignHeadline('عنوان تازه','عنوان قبلی\n\nمتن من','عنوان قبلی'),'عنوان تازه\n\nمتن من');
 assert.throws(()=>titleText('عنوان\nخط دوم'),/یک خط/);
 assert.equal(delivery({media:['final'],primary_media_id:'final',body:'💡 عنوان\n\nتوضیحات'}).entities[0].length,'💡 عنوان'.length);
});

test('text assistance produces a field-specific prompt, never claims model execution',()=>{
 for(const target of ['topic','title','description','specs','cta','caption']){
   const result=buildTextPrompt({target,current:'متن فعلی',type:'stock',fields:{brand:'Cisco',model:'A'},instructions:'لحن کوتاه و حرفه‌ای'},{brand:'برند ما',contact:'تماس واقعی',website:'',currency:'تومان'});
   assert.equal(result.mode,'manual_chatgpt');assert.equal(result.target,target);assert(result.prompt.includes('اختراع نکن'));assert(result.prompt.includes('Cisco'));
 }
 for(const target of ['constructor','brand','model','condition','price','contact_override','rows'])assert.throws(()=>buildTextPrompt({target},{}),/دستی/);
});

test('proxy input and direct HTTP responses',async()=>{
 assert.throws(()=>validateProxy('socks5://127.0.0.1:1080'),/HTTP/);
 assert.throws(()=>validateProxy('http://localhost/path'),/مسیر/);
 assert.equal(validateProxy('http://localhost:8080'),'http://localhost:8080/');
 const fixture=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({method:req.method}));});
 await new Promise(resolve=>fixture.listen(0,'127.0.0.1',resolve));
 try{assert.deepEqual(await requestJson(`http://127.0.0.1:${fixture.address().port}`),{status:200,data:{method:'GET'}});}finally{await new Promise(resolve=>fixture.close(resolve));}
});

test('OAuth forms and completed text streams use the same network transport',async()=>{
 const fixture=http.createServer(async(req,res)=>{
   let raw='';for await(const chunk of req)raw+=chunk;
   assert.equal(req.method,'POST');assert.equal(req.headers['content-type'],'application/x-www-form-urlencoded');assert.equal(new URLSearchParams(raw).get('code'),'a+b &c');
   res.setHeader('Content-Type','text/event-stream');res.end('data: {"type":"response.completed"}\n\n');
 });await new Promise(resolve=>fixture.listen(0,'127.0.0.1',resolve));
 try{const result=await requestJson(`http://127.0.0.1:${fixture.address().port}`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},rawBody:new URLSearchParams({code:'a+b &c'}).toString(),responseType:'text'});assert.equal(result.status,200);assert(result.raw.includes('response.completed'));}finally{await new Promise(resolve=>fixture.close(resolve));}
});

test('authenticated content desk lifecycle',async t=>{
 let dataDir=fs.mkdtempSync(path.join(process.env.TEST_DATA_ROOT||os.tmpdir(),'desk-test-'));
 const reserve=http.createServer();await new Promise(resolve=>reserve.listen(0,'127.0.0.1',resolve));const port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve));
 const origin=`http://127.0.0.1:${port}`;let child;let output='';
 async function start(){child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,HOST:'127.0.0.1',PORT:String(port),DATA_DIR:dataDir},windowsHide:true,stdio:['ignore','pipe','pipe']});child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);for(let i=0;i<100;i++){try{if((await fetch(origin+'/healthz')).ok)return;}catch{}await new Promise(resolve=>setTimeout(resolve,50));}throw new Error(output);}
 async function stop(){if(child.exitCode!==null)return;const done=new Promise(resolve=>child.once('exit',resolve));child.kill();await done;}
 t.after(async()=>{await stop();fs.rmSync(dataDir,{recursive:true,force:true});});await start();
 function client(){let cookie='',csrf='';return {async call(route,method='GET',data,extra={}){const res=await fetch(origin+route,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(method!=='GET'?{'Content-Type':'application/json','X-CSRF-Token':csrf}:{}),...extra},body:data===undefined?undefined:JSON.stringify(data)});if(res.headers.get('set-cookie'))cookie=res.headers.get('set-cookie').split(';')[0];const value=await res.json();if(value.csrf)csrf=value.csrf;return {status:res.status,value};},async file(id,options={}){return fetch(origin+'/media/'+id,{...options,headers:{Cookie:cookie,...options.headers}});},async upload(bytes=png,mime='image/png',name='reference.png'){const form=new FormData();form.set('file',new Blob([bytes],{type:mime}),name);const res=await fetch(origin+'/api/media',{method:'POST',headers:{Cookie:cookie,'X-CSRF-Token':csrf},body:form});return {status:res.status,value:await res.json()};}};}
 const owner=client(),viewer=client(),editor=client();let post,ref,final,album;
 const data={type:'stock',title:'روتر موجود',fields:{brand:'Cisco',model:'TEST-100',price:'1000'},channels:['telegram'],media:[]};
 await t.test('setup creates one admin and protects mutation origins',async()=>{
   assert.equal((await owner.call('/api/bootstrap')).value.setupNeeded,true);
   assert.equal((await owner.call('/api/setup','POST',{username:'owner',name:'مدیر آزمایش',password:'local-test-password'})).status,200);
   assert.equal((await owner.call('/api/setup','POST',{username:'second',name:'ثانویه',password:'local-test-password'})).status,409);
   assert.equal((await owner.call('/api/posts','POST',data,{'X-CSRF-Token':''})).status,403);
   assert.equal((await owner.call('/api/posts','POST',data,{Origin:'http://untrusted.example'})).status,403);
 });
 await t.test('uploads and stores exactly one final publication asset',async()=>{
   ref=(await owner.upload()).value.media.id;final=(await owner.upload()).value.media.id;
   const created=await owner.call('/api/posts','POST',{...data,media:[ref,final],primary_media_id:final});assert.equal(created.status,201);post=created.value.post;
   const state=(await owner.call('/api/state')).value;assert.equal(state.posts[0].delivery.mediaId,final);assert.equal(state.posts[0].delivery.messageCount,1);
   assert.equal((await owner.call('/api/posts','POST',{...data,media:[ref]})).status,400);
 });
 await t.test('ordered photo/video albums persist and retain one shared caption',async()=>{
   const bytes=Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftypisom0000000000000000')]),clip=(await owner.upload(bytes,'video/mp4','clip.mp4')).value.media.id;
   const created=await owner.call('/api/posts','POST',{...data,media:[ref,clip,final],publication_media_ids:[final,clip,ref]});assert.equal(created.status,201);album=created.value.post;
   assert.deepEqual(album.publication_media_ids,[final,clip,ref]);assert.equal(album.primary_media_id,final);
   const state=(await owner.call('/api/state')).value.posts.find(p=>p.id===album.id);assert.equal(state.delivery.mode,'media_album');assert.deepEqual(state.delivery.mediaIds,[final,clip,ref]);assert.equal(state.delivery.captionCount,1);assert.equal(state.delivery.text,null);
   const partial=await owner.file(clip,{headers:{Range:'bytes=0-7'}});assert.equal(partial.status,206);assert.deepEqual(Buffer.from(await partial.arrayBuffer()),bytes.subarray(0,8));
   for(const ids of [[clip,clip],['not-in-post'],[]])assert.equal((await owner.call('/api/posts','POST',{...data,media:[ref,clip,final],publication_media_ids:ids})).status,400);
   album=(await owner.call('/api/posts/'+album.id,'PUT',{...album,publication_media_ids:[clip,ref,final]})).value.post;assert.deepEqual(album.publication_media_ids,[clip,ref,final]);
 });
 await t.test('ready is blocked for an overlong caption and editing revokes approval',async()=>{
   const changed=await owner.call('/api/posts/'+post.id,'PUT',{...post,body:'x'.repeat(1025)});assert.equal(changed.status,200);post=changed.value.post;
   assert.equal((await owner.call('/api/posts/'+post.id+'/ready','POST',{})).status,400);
   post=(await owner.call('/api/posts/'+post.id,'PUT',{...post,body:'کپشن نهایی'})).value.post;
   assert.equal((await owner.call('/api/posts/'+post.id+'/ready','POST',{})).status,200);
   const stale={...post};post=(await owner.call('/api/posts/'+post.id,'PUT',{...post,body:'نسخهٔ بعد'})).value.post;
   assert.equal(post.status,'draft');assert.equal((await owner.call('/api/posts/'+post.id,'PUT',stale)).status,409);
 });
 await t.test('media AI is removed while ordinary uploads and legacy final assets remain usable',async()=>{
   const request={kind:'image',usage:'product',prompt:'یک تصویر واقعی با حفظ مدل و لوگوی محصول',references:[ref],mode:'manual'};
   for(const kind of ['image','video'])assert.equal((await owner.call('/api/posts','POST',{...data,media:[ref],media_request:{...request,kind}})).status,400);
   const uploaded=(await owner.call('/api/posts','POST',{...data,media:[ref,final],primary_media_id:final})).value.post;
   const db=new DatabaseSync(path.join(dataDir,'desk.sqlite'));db.prepare('INSERT INTO generation_jobs(id,post_id,post_version,kind,usage,prompt,references_json,status,provider,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run('legacy-test',uploaded.id,1,'image','product','legacy prompt',JSON.stringify([ref]),'awaiting_upload','manual:chatgpt',new Date().toISOString());db.close();
   const state=(await owner.call('/api/state')).value.posts.find(p=>p.id===uploaded.id);assert.equal(state.media_request,null);assert.equal(state.delivery.mediaId,final);assert.equal(state.delivery.messageCount,1);
   assert.equal((await owner.call('/api/posts/'+uploaded.id+'/ready','POST',{})).status,200);
   assert.equal((await owner.call('/api/posts/'+uploaded.id,'PUT',{...uploaded,media_request:request})).status,400);
 });
 await t.test('roles and channel boundaries are enforced server-side',async()=>{
   for(const [username,role] of [['viewer','viewer'],['editor','editor']])assert.equal((await owner.call('/api/users','POST',{username,role,name:username,password:'local-test-password',channels:['bale']})).status,201);
   await viewer.call('/api/login','POST',{username:'viewer',password:'local-test-password'});await editor.call('/api/login','POST',{username:'editor',password:'local-test-password'});
   assert.equal((await viewer.call('/api/state')).value.posts.length,0);
   assert.equal((await viewer.call('/api/posts','POST',{...data,channels:['bale']})).status,403);
   assert.equal((await editor.call('/api/posts','POST',data)).status,403);
   const own=(await editor.call('/api/posts','POST',{...data,channels:['bale']})).value.post;
   assert.equal((await editor.call('/api/posts/'+own.id+'/ready','POST',{})).status,403);
   assert.equal((await viewer.call('/api/users')).status,403);
   assert.equal((await editor.call('/api/settings','PUT',{})).status,403);
   assert.equal((await viewer.call('/api/text-assist/prompt','POST',{target:'title'})).status,403);
   const help=await editor.call('/api/text-assist/prompt','POST',{target:'title',type:'stock',fields:{brand:'Cisco',model:'A'},instructions:'عنوان کوتاه'});assert.equal(help.status,200);assert.equal(help.value.mode,'manual_chatgpt');assert(help.value.prompt.includes('عنوان کوتاه'));
 });
 await t.test('delivery investigation enforces destination grants, CSRF, explicit consent and stale-report protection',async()=>{
   const created=(await owner.call('/api/posts','POST',{...data,channels:['telegram','bale']})).value.post;
   const db=new DatabaseSync(path.join(dataDir,'desk.sqlite')),at=new Date().toISOString();
   for(const channel of ['telegram','bale'])db.prepare("INSERT INTO publications(id,post_id,channel_id,version,status,message_ids,updated_at,error_code) VALUES(?,?,?,1,'unknown','[]',?,'connection_failed')").run(created.id+':1:'+channel,created.id,channel,at);
   db.prepare("UPDATE posts SET status='uncertain' WHERE id=?").run(created.id);db.close();
   const route='/api/posts/'+created.id+'/delivery-report',report=(await owner.call(route)).value,row=report.results.find(r=>r.channel_id==='bale');assert.equal(report.results.length,2);
   const limited=(await viewer.call(route)).value;assert.deepEqual(limited.results.map(r=>r.channel_id),['bale']);assert.equal(limited.total,1);
   const resolution={version:1,channel_id:'bale',decision:'observed_absent',confirmed:true,updated_at:row.updated_at,revision:row.revision};
   assert.equal((await viewer.call(route,'POST',resolution)).status,403);assert.equal((await editor.call(route,'POST',resolution)).status,403);
   assert.equal((await owner.call(route,'POST',resolution,{'X-CSRF-Token':''})).status,403);
   await owner.call('/api/users','POST',{username:'reportpublisher',role:'publisher',name:'report publisher',password:'local-test-password',channels:['bale']});
   const member=client();await member.call('/api/login','POST',{username:'reportpublisher',password:'local-test-password'});
   assert.equal((await member.call(route,'POST',{...resolution,channel_id:'telegram'})).status,403);
   assert.equal((await member.call('/api/posts/'+created.id+'/publish','POST',{version:1,destinations:['telegram']})).status,403);
   const resolved=await member.call(route,'POST',resolution);assert.equal(resolved.status,200);assert.deepEqual(resolved.value.results.map(r=>r.channel_id),['bale']);assert.equal(resolved.value.results[0].status,'failed');
   assert.equal((await member.call(route,'POST',resolution)).status,409);
   // Token is absent: preflight blocks safely without contacting a provider.
   const retry=await member.call('/api/posts/'+created.id+'/publish','POST',{version:1,destinations:['bale']});assert.equal(retry.status,200);assert.deepEqual(retry.value.results.map(r=>r.channel_id),['bale']);assert.equal(retry.value.results[0].status,'blocked');
   assert.equal((await owner.call(route)).value.results.find(r=>r.channel_id==='telegram').status,'unknown');
 });
 await t.test('secrets are encrypted and absent from snapshots',async()=>{
   const secret='test-token-not-real';assert.equal((await owner.call('/api/channels/telegram','PUT',{name:'تلگرام',target:'test',route:'proxy',enabled:true,token:secret,proxy:'http://localhost:8090'})).status,200);
   const state=(await owner.call('/api/state')).value;assert.equal(state.channels.find(c=>c.id==='telegram').tokenConfigured,true);assert(!JSON.stringify(state).includes(secret));
   const db=new DatabaseSync(path.join(dataDir,'desk.sqlite'),{readOnly:true});assert(!db.prepare('SELECT value FROM secrets WHERE name=?').get('token:telegram').value.includes(secret));db.close();
 });
 await t.test('ChatGPT connection is per-user, role protected, and requires local CSRF',async()=>{
   assert.equal((await client().call('/api/ai/status')).status,401);
   assert.equal((await viewer.call('/api/ai/connect','POST',{})).status,403);
   assert.equal((await viewer.call('/api/ai/models')).status,403);
   assert.equal((await viewer.call('/api/text-assist/generate','POST',{target:'title'})).status,403);
   assert.equal((await owner.call('/api/ai/connect','POST',{}, {'X-CSRF-Token':''})).status,403);
   const connected=await owner.call('/api/ai/connect','POST',{});assert.equal(connected.status,200);const auth=new URL(connected.value.url);assert.equal(auth.origin,'https://auth.openai.com');
   assert.equal(auth.searchParams.get('redirect_uri'),origin+'/auth/callback');
   const status=await editor.call('/api/ai/status');assert.equal(status.value.connected,false);assert(!JSON.stringify(status.value).includes('accessToken'));
   const unconnected=await editor.call('/api/text-assist/generate','POST',{target:'title',type:'stock',fields:{brand:'Cisco',model:'A'}});assert.equal(unconnected.status,400);assert.match(unconnected.value.error,/متصل/);
   const callback=await fetch(origin+'/auth/callback?state=invalid');assert.equal(callback.status,400);assert((await callback.text()).includes('dir="rtl"'));
   assert.equal((await owner.call('/api/ai/disconnect','POST',{})).status,200);
   assert.equal((await fetch(origin+'/contacts.js')).status,200);
 });
 await t.test('Telegram access check is admin-only, persists safe failures, and resets when settings change',async()=>{
   assert.equal((await viewer.call('/api/channels/telegram/check-access','POST',{})).status,403);
   assert.equal((await editor.call('/api/channels/telegram/check-access','POST',{})).status,403);
   const checked=await owner.call('/api/channels/telegram/check-access','POST',{});assert.equal(checked.status,200);assert.equal(checked.value.category,'token_invalid');
   const state=(await owner.call('/api/state')).value;assert.equal(state.capabilities.telegramAccessCheck,true);
   const channel=state.channels.find(c=>c.id==='telegram');assert.equal(channel.access_detail.ok,false);assert.equal(channel.access_detail.category,'token_invalid');
   assert(!JSON.stringify(state).includes('test-token-not-real'));
   assert.equal((await owner.call('/api/channels/telegram','PUT',{name:channel.name,target:'@changedchannel',route:'direct',enabled:true,token:''})).status,200);
   const updated=(await owner.call('/api/state')).value.channels.find(c=>c.id==='telegram');assert.equal(updated.access_detail,null);assert(updated.config_version>channel.config_version);
 });
 await t.test('every channel access route is protected; empty Eitaa cannot report network success',async()=>{
   assert.equal((await viewer.call('/api/channels/eitaa/connect','POST',{})).status,403);
   assert.equal((await owner.call('/api/channels/eitaa/connect','POST',{}, {'X-CSRF-Token':''})).status,403);
   const connected=await owner.call('/api/channels/eitaa/connect','POST',{name:'Eitaa',target:'',route:'direct',enabled:true});assert.equal(connected.status,200);assert.equal(connected.value.saved,true);assert.equal(connected.value.ok,false);assert.equal(connected.value.checks.network,'not_checked');assert.equal(connected.value.category,'token_missing');
   for(const id of ['bale','rubika','eitaa']){
     assert.equal((await viewer.call('/api/channels/'+id+'/check-access','POST',{})).status,403);
     const checked=await owner.call('/api/channels/'+id+'/check-access','POST',{});assert.equal(checked.status,200);assert.equal(checked.value.ok,false);
   }
   const tested=await owner.call('/api/channels/eitaa/test','POST',{});assert.equal(tested.status,200);assert.equal(tested.value.ok,false);assert.equal(tested.value.diagnostic.category,'token_missing');
   const snapshot=(await owner.call('/api/state')).value;assert.equal(snapshot.channels.find(c=>c.id==='eitaa').network_status,'not_configured');
   for(const id of ['telegram','bale','rubika','eitaa']){const response=await fetch(origin+'/logos/'+id+'.svg');assert.equal(response.status,200);assert((await response.text()).includes('<svg'));}
 });
 await t.test('structured contacts persist and produce independent destination footers',async()=>{
   const settings=(await owner.call('/api/state')).value.settings;
   const contacts={phones:[{type:'mobile',number:'+989121234567',label:'فروش'}],admins:{telegram:'@tg_sales',bale:'@bale_sales'}};
   assert.equal((await owner.call('/api/settings','PUT',{...settings,contacts})).status,200);
   const saved=(await owner.call('/api/state')).value.settings.contacts;assert.equal(saved.admins.telegram,'@tg_sales');
   const fields={...data.fields,contact_config:saved};
   const generated=await owner.call('/api/preview','POST',{...data,fields});assert.equal(generated.status,200);assert(!generated.value.body.includes('@tg_sales'));
   const created=await owner.call('/api/posts','POST',{...data,fields,channels:['telegram','bale']});assert.equal(created.status,201);
   const stored=(await owner.call('/api/state')).value.posts.find(p=>p.id===created.value.post.id);
   assert(stored.deliveries.telegram.text.includes('@tg_sales'));assert(!stored.deliveries.telegram.text.includes('@bale_sales'));assert(stored.deliveries.bale.text.includes('@bale_sales'));
   assert.equal(stored.deliveries.telegram.entities.find(e=>e.type==='phone_number').length,13);
   const invalid=await owner.call('/api/settings','PUT',{...settings,contacts:{phones:[{type:'phone',number:'not-a-phone'}]}});assert.equal(invalid.status,400);
   assert.equal((await owner.call('/api/state')).value.settings.contacts.admins.telegram,'@tg_sales');
 });
 await t.test('price source and blog source are required',async()=>{
   assert.equal((await owner.call('/api/posts','POST',{...data,type:'prices',fields:{rows:'Cisco | A | 1000 | نامشخص'}})).status,400);
   assert.equal((await owner.call('/api/posts','POST',{...data,type:'blog',fields:{summary:'متن بدون منبع'}})).status,400);
 });
 await t.test('data and sessions survive restarting the process',async()=>{
   await stop();const moved=dataDir+'-moved';fs.renameSync(dataDir,moved);dataDir=moved;await start();assert.equal((await owner.call('/api/state')).value.posts.find(p=>p.id===post.id).body,'روتر موجود\n\nنسخهٔ بعد');
   assert.deepEqual((await owner.call('/api/state')).value.posts.find(p=>p.id===album.id).publication_media_ids,album.publication_media_ids);
   const db=new DatabaseSync(path.join(dataDir,'desk.sqlite'),{readOnly:true});const media=db.prepare('SELECT path FROM media WHERE id=?').get(final);assert.equal(path.isAbsolute(media.path),false);assert(fs.existsSync(path.join(dataDir,media.path)));const revision=JSON.parse(db.prepare('SELECT value FROM revisions WHERE post_id=? ORDER BY version DESC LIMIT 1').get(post.id).value);assert.equal(revision.delivery.messageCount,1);db.close();
   const adminUser=(await owner.call('/api/users')).value.users.find(u=>u.role==='admin');
   assert.equal((await owner.call('/api/users/'+adminUser.id,'PUT',{...adminUser,role:'viewer',active:true})).status,400);
 });
 await t.test('free posts persist UTF-16 formatting across preview, update, restart and every destination',async()=>{
   const message='سلام 👋🏻\nتخفیف ویژه';const marks=[{type:'bold',offset:10,length:10},{type:'underline',offset:10,length:10}];
   const input={type:'free',title:'فقط برچسب داخلی',fields:{description:message,description_entities:marks,cta:'نباید اضافه شود',contact_config:{phones:[],admins:{telegram:'@test_admin'}}},channels:['telegram','bale','rubika','eitaa'],media:[]};
   const preview=await owner.call('/api/preview','POST',input);assert.equal(preview.status,200);assert.equal(preview.value.body,message);
   const created=await owner.call('/api/posts','POST',{...input,body:preview.value.body,body_entities:preview.value.entities});assert.equal(created.status,201);let free=created.value.post;assert.deepEqual(free.body_entities,marks);
   await stop();await start();let snapshot=(await owner.call('/api/state')).value.posts.find(p=>p.id===free.id);assert.equal(snapshot.body,message);assert.deepEqual(snapshot.fields.description_entities,marks);assert.deepEqual(snapshot.body_entities,marks);
   for(const payload of Object.values(snapshot.deliveries)){assert.equal(payload.text,message);assert.deepEqual(payload.entities,marks);}
   assert.equal((await owner.call('/api/posts/'+free.id+'/ready','POST',{})).status,200);
   const updated=await owner.call('/api/posts/'+free.id,'PUT',{...input,body:message+'!',body_entities:marks,version:free.version});assert.equal(updated.status,200);assert.equal(updated.value.post.status,'draft');assert.deepEqual(updated.value.post.body_entities,marks);
   const invalid=await owner.call('/api/posts','POST',{...input,fields:{description:message,description_entities:[{type:'bold',offset:6,length:1}]}});assert.equal(invalid.status,400);
   assert.equal((await owner.call('/api/posts','POST',{...input,fields:{description:''}})).status,400);
   for(const asset of ['/rich-text.js','/rich-editor.js','/settings-accordion.js']){const response=await fetch(origin+asset);assert.equal(response.status,200);assert((await response.text()).includes('export function'));}
 });
 await t.test('instant publishing enforces role, CSRF, version and independent blocked receipts without external sends',async()=>{
   for(const channel of ['telegram','bale','rubika','eitaa']){const result=await owner.call('/api/channels/'+channel,'PUT',{name:channel,target:'@fixture_channel',enabled:false,route:'direct'});assert.equal(result.status,200);}
   const created=await owner.call('/api/posts','POST',{type:'free',title:'آزمایش انتشار مسدود',fields:{description:'فقط محلی'},channels:['telegram','bale','rubika','eitaa'],media:[]});assert.equal(created.status,201);const draft=created.value.post,url='/api/posts/'+draft.id+'/publish';
   assert.equal((await viewer.call(url,'POST',{version:1})).status,403);assert.equal((await editor.call(url,'POST',{version:1})).status,403);
   assert.equal((await owner.call(url,'POST',{version:1},{'X-CSRF-Token':''})).status,403);assert.equal((await owner.call(url,'POST',{version:2})).status,409);
   const result=await owner.call(url,'POST',{version:1});assert.equal(result.status,200);assert.equal(result.value.sent,0);assert.equal(result.value.total,4);assert(result.value.results.every(r=>r.status==='blocked'));
   const snapshot=(await owner.call('/api/state')).value;assert.equal(snapshot.capabilities.instantPublish,true);assert.equal(snapshot.posts.find(p=>p.id===draft.id).publications.length,4);assert.equal(snapshot.publicationCount,0);
 });
 await t.test('retired WhatsApp cannot be selected, configured or assigned, while Eitaa remains available',async()=>{
   const snapshot=(await owner.call('/api/state')).value;
   assert.deepEqual(snapshot.channels.map(c=>c.id).sort(),['bale','eitaa','rubika','telegram']);assert(!snapshot.user.channels.includes('whatsapp'));
   assert((await owner.call('/api/users')).value.users.every(user=>!user.channels.includes('whatsapp')));
   assert.equal((await owner.call('/api/channels/whatsapp','PUT',{name:'retired',enabled:true,route:'direct'})).status,404);
   assert.equal((await owner.call('/api/channels/whatsapp/test','POST',{})).status,404);
   assert.equal((await owner.call('/api/posts','POST',{type:'free',title:'retired',fields:{description:'local only'},channels:['whatsapp'],media:[]})).status,400);
   assert.equal((await owner.call('/api/users','POST',{username:'retired_channel_user',name:'test',password:'fixture-password-123',role:'viewer',channels:['whatsapp']})).status,400);
   const db=new DatabaseSync(path.join(dataDir,'desk.sqlite'),{readOnly:true});assert(db.prepare("SELECT id FROM channels WHERE id='whatsapp'").get());db.close();
 });
 await t.test('settings work independently and retired integration routes are unavailable',async()=>{
   const settings=(await owner.call('/api/state')).value.settings;assert(!Object.keys(settings).some(key=>/n8n|pulse|bridge/i.test(key)));
   assert.equal((await owner.call('/api/settings','PUT',{...settings,brand:'برند مستقل',n8nUrl:'http://unused.invalid',n8nKey:'unused'})).status,200);
   const saved=(await owner.call('/api/state')).value.settings;assert.equal(saved.brand,'برند مستقل');assert.equal(saved.n8nUrl,undefined);assert.equal(saved.n8nKeyConfigured,undefined);
   for(const route of ['/api/n8n/test','/api/n8n/install','/api/automation/pulse'])assert.equal((await owner.call(route,'POST',{})).status,404);
 }) ;
 await t.test('brand settings no longer require daily schedules while each post retains its independent date and time',async()=>{
   const db=new DatabaseSync(path.join(dataDir,'desk.sqlite'));
   const legacy=JSON.parse(db.prepare('SELECT value FROM settings WHERE id=1').get().value);
   db.prepare('UPDATE settings SET value=? WHERE id=1').run(JSON.stringify({...legacy,dailyLimit:4,slots:['09:30'],paused:true}));db.close();
   const settings=(await owner.call('/api/state')).value.settings;
   for(const key of ['dailyLimit','slots','paused'])assert(!Object.hasOwn(settings,key));
   assert.equal((await owner.call('/api/settings','PUT',{...settings,dailyLimit:'retired',slots:'retired'})).status,200);
   const first=await owner.call('/api/posts','POST',{type:'free',title:'Morning',fields:{description:'Morning post'},channels:['telegram'],media:[],scheduled_at:'2050-01-02T09:30:00+03:30'});
   const second=await owner.call('/api/posts','POST',{type:'free',title:'Evening',fields:{description:'Evening post'},channels:['telegram'],media:[],scheduled_at:'2050-01-03T22:45:00+03:30'});
   assert.equal(first.status,201);assert.equal(second.status,201);
   assert.equal(first.value.post.scheduled_at,'2050-01-02T06:00:00.000Z');assert.equal(second.value.post.scheduled_at,'2050-01-03T19:15:00.000Z');
   assert.equal((await owner.call('/api/posts/'+first.value.post.id+'/ready','POST',{version:first.value.post.version})).status,200);
   assert.equal((await owner.call('/api/posts/'+second.value.post.id+'/ready','POST',{version:second.value.post.version})).status,200);
   assert.equal((await owner.call('/api/settings','PUT',settings)).status,200);
   const snapshot=(await owner.call('/api/state')).value;
   for(const created of [first,second]){const saved=snapshot.posts.find(post=>post.id===created.value.post.id);assert.equal(saved.scheduled_at,created.value.post.scheduled_at);assert.equal(saved.status,'ready');assert.equal(saved.publications.length,0);}
   const stored=new DatabaseSync(path.join(dataDir,'desk.sqlite'),{readOnly:true});
   const raw=JSON.parse(stored.prepare('SELECT value FROM settings WHERE id=1').get().value);stored.close();
   for(const key of ['dailyLimit','slots','paused'])assert(!Object.hasOwn(raw,key));
 });
 await t.test('password changes and local one-time recovery revoke sessions and preserve content',async()=>{
   function grant(){const result=spawnSync(process.execPath,['scripts/recover-password.mjs','--data-dir',dataDir,'--username','owner','--base-url',origin],{cwd:root,encoding:'utf8',windowsHide:true});assert.equal(result.status,0,result.stderr);const value=JSON.parse(result.stdout);return new URLSearchParams(new URL(value.url).hash.slice(1)).get('reset');}
   const extra=client(),anonymous=client();await extra.call('/api/login','POST',{username:'owner',password:'local-test-password'});
   const count=(await owner.call('/api/state')).value.posts.length,oldGrant=grant();
   assert.equal((await anonymous.call('/api/account/password','POST',{currentPassword:'local-test-password',password:'changed-password-123',confirmation:'changed-password-123'})).status,401);
   assert.equal((await owner.call('/api/account/password','POST',{currentPassword:'wrong',password:'changed-password-123',confirmation:'changed-password-123'})).status,400);
   assert.equal((await owner.call('/api/state')).status,200);
   assert.equal((await owner.call('/api/account/password','POST',{currentPassword:'local-test-password',password:'changed-password-123',confirmation:'changed-password-123'})).status,200);
   assert.equal((await extra.call('/api/state')).status,401);
   assert.equal((await anonymous.call('/api/auth/reset','POST',{token:oldGrant,password:'recovered-password-123',confirmation:'recovered-password-123'})).status,400);
   let token=grant();const db=new DatabaseSync(path.join(dataDir,'accounts.sqlite'));const all=db.prepare('SELECT token_hash FROM password_resets').all();assert(!JSON.stringify(all).includes(token));db.prepare('UPDATE password_resets SET expires=0 WHERE used_at IS NULL').run();db.close();
   assert.equal((await anonymous.call('/api/auth/reset','POST',{token,password:'recovered-password-123',confirmation:'recovered-password-123'})).status,400);
   token=grant();assert.equal((await anonymous.call('/api/auth/reset','POST',{token,password:'recovered-password-123',confirmation:'different-password'})).status,400);
   assert.equal((await anonymous.call('/api/auth/reset','POST',{token,password:'recovered-password-123',confirmation:'recovered-password-123'},{Origin:'http://untrusted.example'})).status,403);
   assert.equal((await anonymous.call('/api/auth/reset','POST',{token,password:'recovered-password-123',confirmation:'recovered-password-123'})).status,200);
   assert.equal((await owner.call('/api/state')).status,401);assert.equal((await anonymous.call('/api/auth/reset','POST',{token,password:'another-password-123',confirmation:'another-password-123'})).status,400);
   assert.equal((await anonymous.call('/api/login','POST',{username:'owner',password:'recovered-password-123'})).status,200);assert.equal((await anonymous.call('/api/state')).value.posts.length,count);
   let status;for(let i=0;i<11;i++)status=(await extra.call('/api/auth/reset','POST',{token:'invalid',password:'another-password-123',confirmation:'another-password-123'})).status;assert.equal(status,429);
 });
});
