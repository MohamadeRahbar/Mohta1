import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
const root=fileURLToPath(new URL('../',import.meta.url));
test('published posts support independent library names and exact reusable copies without disturbing receipts',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'desk-reuse-')),reservation=http.createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));
 const origin='http://127.0.0.1:'+port,child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,HOST:'127.0.0.1',PORT:String(port),DATA_DIR:dir},windowsHide:true,stdio:'ignore'});
 t.after(async()=>{if(child.exitCode===null){const done=new Promise(r=>child.once('exit',r));child.kill();await done;}fs.rmSync(dir,{recursive:true,force:true});});
 for(let i=0;i<100;i++){try{if((await fetch(origin+'/healthz')).ok)break;}catch{}await new Promise(r=>setTimeout(r,40));}
 function client(){let cookie='',csrf='';return {async call(url,method='GET',body,override={}){const r=await fetch(origin+url,{method,headers:{Cookie:cookie,'X-CSRF-Token':csrf,...(body?{'Content-Type':'application/json'}:{}),...override},body:body?JSON.stringify(body):undefined});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];const value=await r.json();if(value.csrf)csrf=value.csrf;return {status:r.status,value};},async upload(name){const f=new FormData();f.set('file',new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64')],{type:'image/png'}),name);const r=await fetch(origin+'/api/media',{method:'POST',headers:{Cookie:cookie,'X-CSRF-Token':csrf},body:f});assert.equal(r.status,201);return (await r.json()).media.id;}};}
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
 const copied=await editor.call(endpoint,'POST',{version:1,channels:['eitaa']});assert.equal(copied.status,201);const copy=copied.value.post;assert.notEqual(copy.id,id);assert.equal(copy.version,1);assert.equal(copy.status,'draft');assert.equal(copy.scheduled_at,null);assert.equal(copy.expires_at,input.expires_at.replace('Z','.000Z'));assert.deepEqual(copy.channels,['eitaa']);assert.deepEqual(copy.publication_media_ids,[second,first]);assert.equal(copy.primary_media_id,second);assert.equal(copy.library_title,'تست قدیمی');assert.equal(copy.body,before.body);assert.deepEqual(copy.body_entities,JSON.parse(before.body_entities));assert.deepEqual(copy.fields,JSON.parse(before.fields));assert.notEqual(copy.author_id,before.author_id);
 const state=(await editor.call('/api/state')).value,found=state.posts.find(p=>p.id===copy.id);assert.equal(found.publications.length,0);assert.deepEqual(found.media,[first,second]);assert(state.mediaMap[first]);
 const saved=await editor.call('/api/posts/'+copy.id,'PUT',{...input,channels:['eitaa'],title:'تست ایتا',body:copy.body,body_entities:copy.body_entities,version:1,scheduled_at:null,expires_at:copy.expires_at});assert.equal(saved.status,200);assert.equal(saved.value.post.library_title,'تست ایتا');assert.equal(saved.value.post.body,before.body);assert.deepEqual(saved.value.post.body_entities,JSON.parse(before.body_entities));
 assert.deepEqual(db.prepare('SELECT * FROM publications').all(),receipts);assert.deepEqual(db.prepare('SELECT * FROM posts WHERE id=?').get(id),renamed);assert.equal(db.prepare("SELECT count(*) n FROM audit WHERE action='post.copy'").get().n,1);
 // Copying a sales post must also preserve its public headline and manual document.
 const sale=await owner.call('/api/posts','POST',{type:'stock',title:'عنوان عمومی',fields:{brand:'HPE',model:'DL380',description:'توضیح',cta:''},body:'عنوان عمومی\nمتن تنظیم‌شده',body_entities:[{type:'italic',offset:13,length:3}],channels:['telegram'],media:[]});assert.equal(sale.status,201);db.prepare("UPDATE posts SET status='published' WHERE id=?").run(sale.value.post.id);
 await owner.call('/api/posts/'+sale.value.post.id+'/library-title','PUT',{title:'نام کتابخانه',version:1,previous:null});const saleCopy=await owner.call('/api/posts/'+sale.value.post.id+'/copy','POST',{version:1,channels:['eitaa']});assert.equal(saleCopy.status,201);assert.equal(saleCopy.value.post.title,'عنوان عمومی');assert.equal(saleCopy.value.post.library_title,'نام کتابخانه');assert.equal(saleCopy.value.post.body,sale.value.post.body);
 // Close before teardown removes the fixture directory on Windows.
 db.close();
});
