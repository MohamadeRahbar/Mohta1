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

test('dashboard counts distinct retained messages, omits local and remote deletions, and respects channel scope',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'desk-dashboard-')),reservation=http.createServer();
 await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
 const origin='http://127.0.0.1:'+port,child=spawn(process.execPath,['server.mjs'],{cwd:fileURLToPath(new URL('../',import.meta.url)),env:{...process.env,HOST:'127.0.0.1',PORT:String(port),DATA_DIR:directory},windowsHide:true,stdio:'ignore'});let db;
 t.after(async()=>{db?.close();if(child.exitCode===null){const done=new Promise(resolve=>child.once('exit',resolve));child.kill();await done;}fs.rmSync(directory,{recursive:true,force:true});});
 for(let i=0;i<100;i++){try{if((await fetch(origin+'/healthz')).ok)break;}catch{}await new Promise(resolve=>setTimeout(resolve,40));}
 function client(){const cookies=new Map();let csrf='';return async(route,method='GET',body)=>{
  const response=await fetch(origin+route,{method,headers:{Cookie:[...cookies].map(([key,value])=>key+'='+value).join('; '),'X-CSRF-Token':csrf,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  for(const raw of response.headers.getSetCookie()){const pair=raw.split(';')[0],index=pair.indexOf('=');cookies.set(pair.slice(0,index),pair.slice(index+1));}
  const value=await response.json();assert(response.ok,JSON.stringify(value));if(value.csrf)csrf=value.csrf;return value;
 };}
 const owner=client(),reader=client(),password='dashboard-fixture-123';await owner('/api/setup','POST',{username:'owner',name:'Owner',password});
 await owner('/api/users','POST',{username:'reader',name:'Reader',password,role:'viewer',channels:['telegram']});await reader('/api/login','POST',{username:'reader',password});
 db=new DatabaseSync(path.join(directory,'desk.sqlite'));
 async function add(title){const {post}=await owner('/api/posts','POST',{type:'free',title,fields:{description:'متن آزمایشی'},channels:['telegram','bale'],media:[]});db.prepare("UPDATE posts SET status='published' WHERE id=?").run(post.id);return post;}
 function receipt(post,channel,status='sent',version=1,deleted=null){db.prepare('INSERT INTO publications(id,post_id,channel_id,status,version,remote_deleted_at) VALUES(?,?,?,?,?,?)').run(randomUUID(),post.id,channel,status,version,deleted);}
 const active=await add('active');receipt(active,'telegram');receipt(active,'bale');receipt(active,'telegram','sent',2);
 const archived=await add('archive');receipt(archived,'telegram');db.prepare('UPDATE posts SET archived_at=? WHERE id=?').run('2026-01-01',archived.id);
 const localDeleted=await add('trash');receipt(localDeleted,'telegram');db.prepare('UPDATE posts SET deleted_at=? WHERE id=?').run('2026-01-01',localDeleted.id);
 const remoteDeleted=await add('deleted in all channels');receipt(remoteDeleted,'telegram','sent',1,'2026-01-01');receipt(remoteDeleted,'bale','sent',1,'2026-01-01');
 const partial=await add('deleted in one channel');receipt(partial,'telegram','sent',1,'2026-01-01');receipt(partial,'bale');
 const failed=await add('not sent');receipt(failed,'telegram','failed');receipt(failed,'bale','unknown');
 const otherChannel=await add('bale only');receipt(otherChannel,'bale');
 await owner('/api/users','POST',{username:'publisher',name:'Different publisher',password,role:'publisher',channels:['bale']});
 const writer=db.prepare("SELECT id FROM users WHERE username='publisher'").get().id,author=db.prepare("SELECT author_id FROM posts WHERE id=?").get(active.id).author_id;
 const log=(actor,post,channel,version=1,status='sent',action='post.publish-result')=>db.prepare('INSERT INTO audit(actor_id,action,entity_id,detail,created_at) VALUES(?,?,?,?,?)').run(actor,action,post.id,JSON.stringify({version,channel,status}),new Date().toISOString());
 log(author,active,'telegram');log(writer,active,'bale');log(writer,active,'bale'); // Same sender is shown once.
 log(writer,active,'telegram',2); // Old revisions cannot relabel the current publication.
 log(writer,failed,'telegram'); // A success log without a successful receipt is insufficient.
 log(writer,remoteDeleted,'telegram',1,'sent','post.publish-resolve'); // A reviewer is not necessarily the sender.
 const names=(snapshot,id)=>snapshot.posts.find(post=>post.id===id).publisher_names;
 const ownerState=await owner('/api/state'),readerState=await reader('/api/state');assert.deepEqual(names(ownerState,active.id),['Owner','Different publisher']);assert.deepEqual(names(readerState,active.id),['Owner']);assert.deepEqual(names(ownerState,failed.id),[]);assert.deepEqual(names(ownerState,remoteDeleted.id),[]);
 assert.deepEqual((await owner('/api/posts/'+active.id)).post.publisher_names,['Owner','Different publisher']);
 const beforeReceipts=db.prepare('SELECT * FROM publications ORDER BY id').all();
 assert.equal((await owner('/api/state')).publicationCount,4);assert.equal((await reader('/api/state')).publicationCount,2);
 // The normal delete/restore flow updates the count without removing any receipts.
 const reference={id:active.id,version:1,library_revision:0};
 await owner('/api/posts/library-actions','POST',{action:'delete',posts:[reference]});assert.equal((await owner('/api/state')).publicationCount,3);
 await owner('/api/posts/library-actions','POST',{action:'restore',posts:[{...reference,library_revision:1}]});assert.equal((await owner('/api/state')).publicationCount,4);
 // Archiving keeps the existing channel message, so the count stays unchanged.
 await owner('/api/posts/library-actions','POST',{action:'archive',posts:[{...reference,library_revision:2}]});assert.equal((await owner('/api/state')).publicationCount,4);
 assert.deepEqual(db.prepare('SELECT * FROM publications ORDER BY id').all(),beforeReceipts);
 // A confirmed deletion from the remaining destination removes that message once.
 db.prepare('UPDATE publications SET remote_deleted_at=? WHERE post_id=?').run('2026-01-02',partial.id);assert.equal((await owner('/api/state')).publicationCount,3);
 const second=await owner('/api/workspaces','POST',{name:'Separate brand'});await owner('/api/workspaces/select','POST',{id:second.workspace.id});assert.equal((await owner('/api/state')).publicationCount,0);
});
