import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {copyLibraryTitle} from '../public/post-library.js';
const root=fileURLToPath(new URL('../',import.meta.url));
test('published posts support independent library names and exact reusable copies without disturbing receipts',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'desk-reuse-')),reservation=http.createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));
 const origin='http://127.0.0.1:'+port,child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,HOST:'127.0.0.1',PORT:String(port),DATA_DIR:dir},windowsHide:true,stdio:'ignore'});
 t.after(async()=>{if(child.exitCode===null){const done=new Promise(r=>child.once('exit',r));child.kill();await done;}fs.rmSync(dir,{recursive:true,force:true});});
 for(let i=0;i<100;i++){try{if((await fetch(origin+'/healthz')).ok)break;}catch{}await new Promise(r=>setTimeout(r,40));}
 function client(){let csrf='';const cookies=new Map();const cookie=()=>[...cookies].map(([key,value])=>key+'='+value).join('; ');return {async call(url,method='GET',body,override={}){const r=await fetch(origin+url,{method,headers:{Cookie:cookie(),'X-CSRF-Token':csrf,...(body?{'Content-Type':'application/json'}:{}),...override},body:body?JSON.stringify(body):undefined});for(const raw of r.headers.getSetCookie()){const pair=raw.split(';')[0],i=pair.indexOf('=');cookies.set(pair.slice(0,i),pair.slice(i+1));}const value=await r.json();if(value.csrf)csrf=value.csrf;return {status:r.status,value};},async upload(name){const f=new FormData();f.set('file',new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64')],{type:'image/png'}),name);const r=await fetch(origin+'/api/media',{method:'POST',headers:{Cookie:cookie(),'X-CSRF-Token':csrf},body:f});assert.equal(r.status,201);return (await r.json()).media.id;}};}
 const owner=client(),editor=client(),viewer=client(),password='reuse-fixture-password';
 await owner.call('/api/setup','POST',{username:'owner',name:'Owner',password});
 for(const [username,role] of [['writer','editor'],['reader','viewer']])assert.equal((await owner.call('/api/users','POST',{username,name:username,role,password,channels:['eitaa']})).status,201);
 await editor.call('/api/login','POST',{username:'writer',password});await viewer.call('/api/login','POST',{username:'reader',password});
 const first=await owner.upload('one.png'),second=await owner.upload('two.png');
 const input={type:'free',title:'نام اصلی',fields:{description:'سلام برند 👋🏻',description_entities:[{type:'bold',offset:5,length:4}]},channels:['telegram','bale','rubika','eitaa'],media:[first,second],publication_media_ids:[second,first],scheduled_at:'2026-01-01T10:00:00Z',expires_at:'2026-01-02T10:00:00Z'};
 const created=await owner.call('/api/posts','POST',input);assert.equal(created.status,201);const id=created.value.post.id;
 const db=new DatabaseSync(path.join(dir,'desk.sqlite'));t.after(()=>{try{db.close();}catch{}});
 db.prepare("UPDATE posts SET status='published' WHERE id=?").run(id);
 for(const [channel,receipt] of [['telegram','7'],['bale','3'],['rubika','42']])db.prepare('INSERT INTO publications(id,post_id,channel_id,message_ids,status,version) VALUES(?,?,?,?,?,?)').run(id+':1:'+channel,id,channel,JSON.stringify([receipt]),'sent',1);
 const before=db.prepare('SELECT * FROM posts WHERE id=?').get(id),receipts=db.prepare('SELECT * FROM publications').all();
 assert.equal((await owner.call('/api/posts/'+id,'PUT',{...input,version:1})).status,400);
 assert.equal((await owner.call('/api/posts/'+id+'/library-title','PUT',{title:'تست قدیمی',version:1,previous:null})).status,200);
 const renamed=db.prepare('SELECT * FROM posts WHERE id=?').get(id);for(const key of ['body','body_entities','title','fields','media','status','version'])assert.equal(renamed[key],before[key]);assert.equal(renamed.library_title,'تست قدیمی');assert.deepEqual(db.prepare('SELECT * FROM publications').all(),receipts);
 assert.equal((await owner.call('/api/posts/'+id+'/library-title','PUT',{title:'stale',version:1,previous:null})).status,409);
 assert.equal((await owner.call('/api/posts/'+id+'/library-title','PUT',{title:' ',version:1,previous:'تست قدیمی'})).status,400);
 assert.equal((await owner.call('/api/posts/'+id+'/library-title','PUT',{title:'a\nb',version:1,previous:'تست قدیمی'})).status,400);
 const endpoint='/api/posts/'+id+'/copy';
 assert.equal((await owner.call(endpoint,'POST',{version:0,channels:['eitaa']})).status,409);
 assert.equal((await owner.call(endpoint,'POST',{version:1,channels:[]})).status,400);
 assert.equal((await owner.call(endpoint,'POST',{version:1,channels:['eitaa']},{'X-CSRF-Token':''})).status,403);
 assert.equal((await viewer.call(endpoint,'POST',{version:1,channels:['eitaa']})).status,403);
 assert.equal((await editor.call('/api/posts/'+id+'/library-title','PUT',{title:'denied',version:1,previous:'تست قدیمی'})).status,403);
 assert.equal((await editor.call(endpoint,'POST',{version:1,channels:['telegram']})).status,403);
 const copied=await editor.call(endpoint,'POST',{version:1,channels:['eitaa']});assert.equal(copied.status,201);const copy=copied.value.post;assert.notEqual(copy.id,id);assert.equal(copy.version,1);assert.equal(copy.status,'draft');assert.equal(copy.scheduled_at,null);assert.equal(copy.expires_at,input.expires_at.replace('Z','.000Z'));assert.deepEqual(copy.channels,['eitaa']);assert.deepEqual(copy.publication_media_ids,[second,first]);assert.equal(copy.primary_media_id,second);assert.equal(copy.library_title,'تست قدیمی (کپی)');assert.equal(copy.body,before.body);assert.deepEqual(copy.body_entities,JSON.parse(before.body_entities));assert.deepEqual(copy.fields,JSON.parse(before.fields));assert.notEqual(copy.author_id,before.author_id);
 const state=(await editor.call('/api/state')).value,found=state.posts.find(p=>p.id===copy.id);assert.equal(found.publications.length,0);assert.deepEqual(found.media,[first,second]);assert(state.mediaMap[first]);
 const saved=await editor.call('/api/posts/'+copy.id,'PUT',{...input,channels:['eitaa'],title:'تست ایتا',body:copy.body,body_entities:copy.body_entities,version:1,scheduled_at:null,expires_at:copy.expires_at});assert.equal(saved.status,200);assert.equal(saved.value.post.library_title,'تست ایتا');assert.equal(saved.value.post.body,before.body);assert.deepEqual(saved.value.post.body_entities,JSON.parse(before.body_entities));
 assert.deepEqual(db.prepare('SELECT * FROM publications').all(),receipts);assert.deepEqual(db.prepare('SELECT * FROM posts WHERE id=?').get(id),renamed);assert.equal(db.prepare("SELECT count(*) n FROM audit WHERE action='post.copy'").get().n,1);
 // Copying a sales post must also preserve its public headline and manual document.
 const sale=await owner.call('/api/posts','POST',{type:'stock',title:'عنوان عمومی',fields:{brand:'HPE',model:'DL380',description:'توضیح',cta:''},body:'عنوان عمومی\nمتن تنظیم‌شده',body_entities:[{type:'italic',offset:13,length:3}],channels:['telegram'],media:[]});assert.equal(sale.status,201);db.prepare("UPDATE posts SET status='published' WHERE id=?").run(sale.value.post.id);
 await owner.call('/api/posts/'+sale.value.post.id+'/library-title','PUT',{title:'نام کتابخانه',version:1,previous:null});const saleCopy=await owner.call('/api/posts/'+sale.value.post.id+'/copy','POST',{version:1,channels:['eitaa']});assert.equal(saleCopy.status,201);assert.equal(saleCopy.value.post.title,'عنوان عمومی');assert.equal(saleCopy.value.post.library_title,'نام کتابخانه (کپی)');assert.equal(saleCopy.value.post.body,sale.value.post.body);
 // Batch copies are atomic, preserve originals and receipts, and never enter the queue.
 const draft=(await owner.call('/api/posts','POST',{...input,title:'پیش نویس',scheduled_at:null})).value.post;
 db.prepare("UPDATE posts SET status='ready',scheduled_at='2036-01-01T10:00:00.000Z',publish_options=? WHERE id=?").run('{"pin":true}',draft.id);
 const sourceIds=[id,sale.value.post.id,draft.id],sourceRows=sourceIds.map(sourceId=>db.prepare('SELECT * FROM posts WHERE id=?').get(sourceId)),originalReceipts=db.prepare('SELECT * FROM publications').all();
 const refs=sourceRows.map(p=>({id:p.id,version:p.version,library_revision:p.library_revision,control_revision:p.control_revision,library_title:p.library_title}));
 const batch='/api/posts/copies',request={posts:refs,channels:['eitaa']},count=()=>db.prepare('SELECT count(*) n FROM posts').get().n,beforeBatch=count();
 for(const bad of [[],[refs[0],refs[0]],[refs[0],{...refs[1],version:99}],[refs[0],{...refs[1],library_revision:99}],[refs[0],{...refs[1],control_revision:99}],[refs[0],{...refs[1],library_title:'stale'}],[refs[0],{...refs[1],id:'00000000-0000-4000-8000-000000000000'}]]){
  const result=await owner.call(batch,'POST',{...request,posts:bad});assert(result.status>=400,JSON.stringify(result));assert.equal(count(),beforeBatch);
 }
 assert.equal((await owner.call(batch,'POST',request,{'X-CSRF-Token':''})).status,403);assert.equal((await viewer.call(batch,'POST',request)).status,403);assert.equal((await editor.call(batch,'POST',{...request,channels:['telegram']})).status,403);
 const invisible=(await owner.call('/api/posts','POST',{...input,title:'خصوصی',channels:['telegram']})).value.post;
 assert.equal((await editor.call(batch,'POST',{posts:[refs[0],{id:invisible.id,version:1,library_revision:0,control_revision:0,library_title:null}],channels:['eitaa']})).status,404);assert.equal(count(),beforeBatch+1);
 db.prepare("UPDATE posts SET status='publishing' WHERE id=?").run(draft.id);assert.equal((await owner.call(batch,'POST',request)).status,409);assert.equal(count(),beforeBatch+1);db.prepare("UPDATE posts SET status='ready' WHERE id=?").run(draft.id);
 const copies=await owner.call(batch,'POST',request);assert.equal(copies.status,201);assert.equal(copies.value.count,3);assert.equal(new Set(copies.value.posts.map(p=>p.id)).size,3);assert.equal(count(),beforeBatch+4);
 for(let i=0;i<3;i++){
  const copied=copies.value.posts[i],source=sourceRows[i];assert.equal(copied.library_title,(source.library_title||source.title)+' (کپی)');assert.equal(copied.title,source.title);assert.equal(copied.body,source.body);assert.equal(copied.status,'draft');assert.equal(copied.version,1);assert.equal(copied.scheduled_at,null);assert.deepEqual(copied.publish_options,{});assert.deepEqual(copied.channels,['eitaa']);assert.deepEqual(copied.media,JSON.parse(source.media));assert.deepEqual(copied.publication_media_ids,JSON.parse(source.publication_media_ids));assert.equal(db.prepare('SELECT count(*) n FROM scheduled_publications WHERE post_id=?').get(copied.id).n,0);assert.equal(db.prepare('SELECT count(*) n FROM revisions WHERE post_id=?').get(copied.id).n,1);assert.deepEqual(db.prepare('SELECT * FROM posts WHERE id=?').get(source.id),source);
 }
 assert.deepEqual(db.prepare('SELECT * FROM publications').all(),originalReceipts);
 // A copied legacy post has an editable library name independent from its public headline.
 const legacy=copies.value.posts[1],legacySave=await owner.call('/api/posts/'+legacy.id,'PUT',{...legacy,library_title:'نام قابل ویرایش'});assert.equal(legacySave.status,200);assert.equal(legacySave.value.post.library_title,'نام قابل ویرایش');assert.equal(legacySave.value.post.title,legacy.title);assert.equal(legacySave.value.post.body,legacy.body);
 // An archived original can be reused; trash must first be restored.
 db.prepare('UPDATE posts SET archived_at=?,library_revision=1 WHERE id=?').run(new Date().toISOString(),draft.id);
 assert.equal((await owner.call(batch,'POST',{...request,posts:[{...refs[2],library_revision:1}]})).status,201);
 db.prepare('UPDATE posts SET deleted_at=?,library_revision=2 WHERE id=?').run(new Date().toISOString(),draft.id);
 const beforeTrash=count();assert.equal((await owner.call(batch,'POST',{...request,posts:[refs[0],{...refs[2],library_revision:2}]})).status,400);assert.equal(count(),beforeTrash);
 const next=await owner.call('/api/workspaces','POST',{name:'Isolated brand'});assert.equal(next.status,201);await owner.call('/api/workspaces/select','POST',{id:next.value.workspace.id});assert.equal((await owner.call(batch,'POST',request)).status,404);
 // Close before teardown removes the fixture directory on Windows.
 db.close();
});

test('copy names stay editable-sized, preserve Unicode and use the library name',()=>{
 assert.equal(copyLibraryTitle({title:'اصل',library_title:'نام داخلی'}),'نام داخلی (کپی)');
 assert.equal(copyLibraryTitle({title:'اصل'}),'اصل (کپی)');
 for(const title of ['الف'.repeat(100),'😀'.repeat(120),'a'.repeat(233)+'😀']){const name=copyLibraryTitle({title});assert(name.length<=240);assert(name.endsWith(' (کپی)'));assert(name.isWellFormed());}
});
