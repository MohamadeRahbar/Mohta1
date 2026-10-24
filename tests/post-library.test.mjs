import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {openStore,publicPost} from '../store.mjs';
import {changePostLibrary} from '../post-library.mjs';
import {createPublisher} from '../publisher.mjs';
import {libraryState,canManageLibrary,filterLibrary} from '../public/post-library.js';

function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'desk-library-')),store=openStore(dir),id=randomUUID(),now=new Date().toISOString();
 store.db.prepare('INSERT INTO users(id,username,name,password,role,channels,created_at) VALUES(?,?,?,?,?,?,?)').run(id,id,'fixture','unused','admin','["telegram","eitaa"]',now);
 const user={id,role:'admin',channels:['telegram','eitaa']};
 t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
 const get=id=>publicPost(store.db.prepare('SELECT * FROM posts WHERE id=?').get(id));
 function add(status='draft',author=id,channels=['telegram']){const postId=randomUUID();store.db.prepare('INSERT INTO posts(id,type,title,fields,body,channels,media,status,version,author_id,created_at,updated_at,body_entities) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(postId,'free','fixture','{}','متن آزمایش',JSON.stringify(channels),'[]',status,1,author,now,now,'[]');return get(postId);}
 return {store,user,add,get,ref:post=>({id:post.id,version:post.version,library_revision:post.library_revision})};
}
test('local archive/delete/restore preserve published content, receipts, media and content versions',t=>{
 const {store,user,add,get,ref}=fixture(t),post=add('published'),media=randomUUID();
 store.db.prepare('INSERT INTO media VALUES(?,?,?,?,?,?,?)').run(media,'media/fixture.png','fixture.png','image/png',4,user.id,new Date().toISOString());
 store.db.prepare('UPDATE posts SET media=?,publication_media_ids=?,body_entities=? WHERE id=?').run(JSON.stringify([media]),JSON.stringify([media]),'[{"type":"bold","offset":0,"length":3}]',post.id);
 store.db.prepare('INSERT INTO publications(id,post_id,channel_id,message_ids,status,version) VALUES(?,?,?,?,?,?)').run(randomUUID(),post.id,'telegram','["7"]','sent',1);
 const before=get(post.id),receipts=store.db.prepare('SELECT * FROM publications').all();
 const result=changePostLibrary(store,user,'archive',[ref(before)]);assert.equal(result.count,1);assert.equal(result.posts[0].id,post.id);assert.equal(result.posts[0].library_revision,1);assert(result.posts[0].archived_at);assert.equal(libraryState(get(post.id)),'archived');assert.equal(get(post.id).status,'published');
 changePostLibrary(store,user,'delete',[ref(get(post.id))]);assert.equal(libraryState(get(post.id)),'deleted');
 changePostLibrary(store,user,'restore',[ref(get(post.id))]);assert.equal(libraryState(get(post.id)),'archived');
 changePostLibrary(store,user,'restore',[ref(get(post.id))]);const after=get(post.id);assert.equal(libraryState(after),'active');
 for(const key of ['body','body_entities','fields','media','publication_media_ids','version','status','author_id'])assert.deepEqual(after[key],before[key]);
 assert.deepEqual(store.db.prepare('SELECT * FROM publications').all(),receipts);assert(store.db.prepare('SELECT id FROM media WHERE id=?').get(media));assert.equal(after.library_revision,4);
 assert.equal(store.db.prepare('SELECT count(*) n FROM audit').get().n,4);
});
test('bulk operations are atomic for stale versions, forbidden scope, duplicate IDs and sending posts',t=>{
 const {store,user,add,get,ref}=fixture(t),a=add(),b=add();
 for(const refs of [[ref(a),{...ref(b),version:2}],[ref(a),{...ref(b),library_revision:3}],[ref(a),{...ref(b),id:randomUUID()}],[ref(a),ref(a)]])assert.throws(()=>changePostLibrary(store,user,'delete',refs));
 assert.equal(get(a.id).deleted_at,null);assert.equal(store.db.prepare('SELECT count(*) n FROM audit').get().n,0);
 assert.throws(()=>changePostLibrary(store,{...user,role:'viewer'},'delete',[ref(a)]),{status:403});
 assert.throws(()=>changePostLibrary(store,{...user,role:'editor',id:'other'},'delete',[ref(a)]),{status:403});
 assert.throws(()=>changePostLibrary(store,{...user,role:'publisher',channels:['eitaa']},'delete',[ref(a)]),{status:403});
 store.db.prepare("UPDATE posts SET status='publishing' WHERE id=?").run(b.id);assert.throws(()=>changePostLibrary(store,user,'archive',[ref(a),ref(b)]),{status:409});
 store.db.prepare("UPDATE posts SET status='draft' WHERE id=?").run(b.id);store.db.prepare('INSERT INTO publications(id,post_id,channel_id,status,version) VALUES(?,?,?,?,?)').run(randomUUID(),b.id,'telegram','sending',1);assert.throws(()=>changePostLibrary(store,user,'delete',[ref(a),ref(b)]),{status:409});assert.equal(get(a.id).deleted_at,null);
});
test('hidden queue items return as drafts, old archived rows restore, and publishers cannot send hidden posts',async t=>{
 const {store,user,add,get,ref}=fixture(t),ready=add('ready'),legacy=add('archived');
 changePostLibrary(store,user,'archive',[ref(ready)]);assert.equal(get(ready.id).status,'draft');
 changePostLibrary(store,user,'restore',[ref(get(ready.id)),ref(legacy)]);assert.equal(get(ready.id).status,'draft');assert.equal(get(legacy.id).status,'draft');
 changePostLibrary(store,user,'delete',[ref(get(ready.id))]);changePostLibrary(store,user,'archive',[ref(get(legacy.id))]);
 const service=createPublisher(store,{recoverInterrupted:false,request:()=>assert.fail('No network calls allowed')});
 for(const post of [ready,legacy])await assert.rejects(()=>service.publish(post.id,1,user.id),/بایگانی یا حذف/);
 changePostLibrary(store,user,'restore',[ref(get(ready.id))]);assert.equal(get(ready.id).status,'draft');
 assert.throws(()=>changePostLibrary(store,user,'restore',[ref(get(ready.id))]),{status:409});
});
test('filters isolate archive and trash, search scopes selection, permissions match row controls',()=>{
 const base={title:'آزمایش',channels:['telegram'],author_id:'writer',status:'draft'},posts=[{...base,id:'active'},{...base,id:'ready',status:'ready',scheduled_at:'2030-01-01T00:00:00Z'},{...base,id:'archive',status:'published',archived_at:'2026-01-01'},{...base,id:'deleted',deleted_at:'2026-01-01'},{...base,id:'old',status:'archived'}];
 assert.deepEqual(filterLibrary(posts).map(p=>p.id),['active','ready']);assert.deepEqual(filterLibrary(posts,{filter:'archived'}).map(p=>p.id),['archive','old']);assert.deepEqual(filterLibrary(posts,{filter:'deleted'}).map(p=>p.id),['deleted']);assert.deepEqual(filterLibrary(posts,{queue:true}).map(p=>p.id),['ready']);assert.deepEqual(filterLibrary(posts,{search:'no-match'}),[]);
 assert(canManageLibrary(base,{id:'writer',role:'editor',channels:['telegram']}));assert(!canManageLibrary(base,{id:'another',role:'editor',channels:['telegram']}));assert(!canManageLibrary({...base,status:'publishing'},{role:'admin'}));assert(!canManageLibrary({...base,publications:[{status:'sending'}]},{role:'admin'}));
});
test('HTTP endpoints enforce library guards, CSRF, user scope and workspace isolation without external sends',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'desk-library-http-')),reservation=http.createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));
 const origin='http://127.0.0.1:'+port,child=spawn(process.execPath,['server.mjs'],{cwd:fileURLToPath(new URL('../',import.meta.url)),env:{...process.env,HOST:'127.0.0.1',PORT:String(port),DATA_DIR:dir},windowsHide:true,stdio:'ignore'});let db;
 t.after(async()=>{db?.close();if(child.exitCode===null){const done=new Promise(r=>child.once('exit',r));child.kill();await done;}fs.rmSync(dir,{recursive:true,force:true});});
 for(let i=0;i<100;i++){try{if((await fetch(origin+'/healthz')).ok)break;}catch{}await new Promise(r=>setTimeout(r,40));}
 function client(){const jar=new Map();let csrf='';return async(url,method='GET',data,override={})=>{const response=await fetch(origin+url,{method,headers:{Cookie:[...jar].map(([key,value])=>key+'='+value).join('; '),'X-CSRF-Token':csrf,...(data?{'Content-Type':'application/json'}:{}),...override},body:data?JSON.stringify(data):undefined});for(const cookie of response.headers.getSetCookie()){const [pair]=cookie.split(';'),index=pair.indexOf('=');jar.set(pair.slice(0,index),pair.slice(index+1));}const value=url==='/api/export'?await response.text():await response.json();if(value.csrf)csrf=value.csrf;return {status:response.status,value};};}
 const owner=client(),viewer=client(),editor=client(),password='library-test-password';await owner('/api/setup','POST',{username:'owner',name:'Owner',password});
 for(const [username,role] of [['reader','viewer'],['writer','editor']])assert.equal((await owner('/api/users','POST',{username,name:username,role,password,channels:['telegram']})).status,201);
 await viewer('/api/login','POST',{username:'reader',password});await editor('/api/login','POST',{username:'writer',password});
 const input={type:'free',title:'حذف آزمایش',fields:{description:'متن ثابت'},channels:['telegram'],media:[]},created=await owner('/api/posts','POST',input),post=created.value.post,reference={id:post.id,version:1,library_revision:0};
 assert.equal((await owner('/api/posts/library-actions','POST',{action:'delete',posts:[reference]},{'X-CSRF-Token':'invalid'})).status,403);
 for(const actor of [viewer,editor])assert.equal((await actor('/api/posts/library-actions','POST',{action:'delete',posts:[reference]})).status,403);
 assert.equal((await owner('/api/posts/library-actions','POST',{action:'delete',posts:[reference]})).status,200);
 for(const [route,method,body] of [['','PUT',{...input,version:1}],['/ready','POST',{}],['/publish','POST',{version:1}],['/library-title','PUT',{title:'تغییر',version:1,previous:null}],['/copy','POST',{version:1,channels:['telegram']}]] )assert.equal((await owner('/api/posts/'+post.id+route,method,body)).status,400);
 assert(!(await owner('/api/export')).value.includes(post.id));const state=(await owner('/api/state')).value,deleted=state.posts.find(p=>p.id===post.id);assert.equal(libraryState(deleted),'deleted');assert.equal(deleted.library_revision,1);
 assert.equal((await owner('/api/posts/library-actions','POST',{action:'restore',posts:[reference]})).status,409);
 assert.equal((await owner('/api/posts/library-actions','POST',{action:'restore',posts:[{...reference,library_revision:1}]})).status,200);
 const next=await owner('/api/workspaces','POST',{name:'Second brand'});assert.equal(next.status,201);await owner('/api/workspaces/select','POST',{id:next.value.workspace.id});await owner('/api/state');assert.equal((await owner('/api/posts/library-actions','POST',{action:'delete',posts:[{...reference,library_revision:2}]})).status,404);
 db=new DatabaseSync(path.join(dir,'desk.sqlite'));assert.equal(db.prepare('SELECT deleted_at FROM posts WHERE id=?').get(post.id).deleted_at,null);
});
