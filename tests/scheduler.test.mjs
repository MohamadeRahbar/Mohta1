import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {openStore,publicPost} from '../store.mjs';
import {createPublisher} from '../publisher.mjs';
import {queuePublication,createScheduler,cancelScheduled} from '../scheduler.mjs';
import {changePostLibrary} from '../post-library.mjs';

function fixture(t,channels=['telegram','bale']){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'desk-schedule-'));let store=openStore(directory),time=Date.now()+60000,sends=0;
 const actor={id:randomUUID(),role:'publisher',active:1,channels:JSON.stringify(channels)},id=randomUUID(),created=new Date().toISOString();
 store.db.prepare('INSERT INTO users(id,username,name,password,role,channels,created_at) VALUES(?,?,?,?,?,?,?)').run(actor.id,actor.id,'Scheduler','unused',actor.role,actor.channels,created);
 store.db.prepare('INSERT INTO posts(id,type,title,fields,body,channels,media,status,version,author_id,created_at,updated_at,scheduled_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,'free','Scheduled','{}','Exact content',JSON.stringify(channels),'[]','draft',1,actor.id,created,created,new Date(time+60000).toISOString());
 for(const channel of channels){store.saveSecret('token:'+channel,'123:fixture_secret_1234567890123456');store.db.prepare('UPDATE channels SET enabled=1,target=? WHERE id=?').run('@fixture_channel',channel);}
 const request=async(url,options)=>{if(url.endsWith('/sendMessage')){sends++;assert.equal(options.body.text,'Exact content');}return {status:200,data:{ok:true,result:url.endsWith('/getChat')?{id:-100123,type:'channel'}:{message_id:sends}}};};
 const read=()=>publicPost(store.db.prepare('SELECT * FROM posts WHERE id=?').get(id));
 const job=()=>store.db.prepare('SELECT * FROM scheduled_publications WHERE post_id=?').get(id);
 function services(options={}){const publisher=createPublisher(store,{request,resolveRoute:async()=>({proxy:''}),...options});return {publisher,scheduler:createScheduler(store,publisher,{resolveActor:()=>actor,clock:()=>time})};}
 t.after(()=>{store.close();fs.rmSync(directory,{recursive:true,force:true});});
 return {get store(){return store;},actor,id,read,job,services,get sends(){return sends;},advance(ms=60000){time+=ms;},queue(){return queuePublication(store,read(),actor,read().version,{clock:()=>time});},restart(){store.close();store=openStore(directory);}};
}

test('future queue persists over restart, runs at due time once across concurrent ticks and preserves exact content',async t=>{
 const f=fixture(t);assert.equal(f.queue().automatic,true);f.restart();const {scheduler}=f.services();
 await scheduler.runDue();assert.equal(f.sends,0);f.advance();await Promise.all([scheduler.runDue(),scheduler.runDue(),scheduler.runDue()]);
 assert.equal(f.sends,2);assert.equal(f.read().status,'published');assert.equal(f.job().state,'completed');await scheduler.runDue();assert.equal(f.sends,2);
});

test('queue validates approver, version, future dates and expiry while unscheduled queue remains manual',async t=>{
 const f=fixture(t);assert.throws(()=>queuePublication(f.store,f.read(),f.actor,0),/نسخه/);
 assert.throws(()=>queuePublication(f.store,f.read(),{...f.actor,role:'editor'},1),/دسترسی/);
 assert.throws(()=>queuePublication(f.store,f.read(),{...f.actor,channels:'[]'},1),/دسترسی/);
 f.store.db.prepare('UPDATE posts SET expires_at=scheduled_at WHERE id=?').run(f.id);assert.throws(()=>f.queue(),/بعد از/);
 f.store.db.prepare('UPDATE posts SET expires_at=NULL WHERE id=?').run(f.id);f.advance(120000);assert.throws(()=>f.queue(),/آینده/);
 f.store.db.prepare('UPDATE posts SET scheduled_at=NULL WHERE id=?').run(f.id);assert.equal(f.queue().automatic,false);assert.equal(f.job(),undefined);assert.equal(f.read().status,'ready');
});

test('legacy ready posts are never armed implicitly and revoked access prevents due delivery',async t=>{
 const f=fixture(t);f.store.db.prepare("UPDATE posts SET status='ready'").run();f.advance(120000);const {scheduler}=f.services();await scheduler.runDue();assert.equal(f.sends,0);assert.equal(f.job(),undefined);
 f.store.db.prepare("UPDATE posts SET status='draft',scheduled_at=?").run(new Date(Date.now()+600000).toISOString());f.queue();f.actor.active=0;f.advance(900000);await scheduler.runDue();assert.equal(f.sends,0);assert.equal(f.read().status,'draft');assert.equal(f.job().state,'failed');assert.match(f.job().message,/دسترسی/);
});

test('overdue jobs resume when host returns but expired posts are stopped',async t=>{
 const f=fixture(t,['telegram']);f.store.db.prepare('UPDATE posts SET expires_at=?').run(new Date(Date.parse(f.read().scheduled_at)+60000).toISOString());f.queue();f.advance(180000);f.restart();await f.services().scheduler.runDue();
 assert.equal(f.sends,0);assert.equal(f.read().status,'draft');assert.equal(f.job().state,'failed');assert.match(f.job().message,/منقضی/);
});

test('archive, deletion and explicit draft cancel queue approval without changing channel receipts',async t=>{
 for(const action of ['archive','delete','draft']){
  const f=fixture(t);f.queue();
  if(action==='draft'){f.store.db.prepare("UPDATE posts SET status='draft'").run();cancelScheduled(f.store,f.id);}else changePostLibrary(f.store,f.actor,action,[{id:f.id,version:1,library_revision:0}]);
  f.advance();await f.services().scheduler.runDue();assert.equal(f.sends,0);assert.equal(f.job().state,'cancelled');assert.equal(f.store.db.prepare('SELECT count(*) n FROM publications').get().n,0);
 }
});

test('manual instant publish consumes a queued approval and failure is never retried automatically',async t=>{
 const f=fixture(t);f.queue();let {publisher,scheduler}=f.services();await publisher.publish(f.id,1,f.actor.id);assert.equal(f.job().state,'cancelled');f.advance();await scheduler.runDue();assert.equal(f.sends,2);
 const failed=fixture(t,['telegram']);failed.queue();failed.advance();({scheduler}=failed.services({request:async()=>({status:403,data:{ok:false}})}));await scheduler.runDue();assert.equal(failed.job().state,'failed');await scheduler.runDue();assert.equal(failed.store.db.prepare('SELECT count(*) n FROM publications').get().n,1);
});

test('interrupted running jobs and sending receipts recover without a resend or secret leakage',async t=>{
 const f=fixture(t,['telegram']);f.queue();f.store.db.prepare("UPDATE scheduled_publications SET state='running'").run();f.store.db.prepare("UPDATE posts SET status='publishing'").run();
 f.store.db.prepare("INSERT INTO publications(id,post_id,channel_id,status,version) VALUES(?,?,?,'sending',1)").run(f.id+':1:telegram',f.id,'telegram');f.restart();f.advance();await f.services().scheduler.runDue();
 assert.equal(f.sends,0);assert.equal(f.job().state,'failed');assert.equal(f.read().status,'uncertain');assert.equal(f.store.db.prepare('SELECT status FROM publications').get().status,'unknown');
});

test('due delivery rechecks content version and channel grants, and does not retry partial/unknown sends',async t=>{
 const stale=fixture(t);stale.queue();stale.store.db.prepare('UPDATE posts SET version=2').run();stale.advance();await stale.services().scheduler.runDue();assert.equal(stale.job().state,'cancelled');assert.equal(stale.sends,0);
 const revoked=fixture(t);revoked.queue();revoked.actor.channels='[]';revoked.advance();await revoked.services().scheduler.runDue();assert.equal(revoked.job().state,'failed');assert.equal(revoked.sends,0);
 for(const unknown of [false,true]){
  const f=fixture(t);f.queue();f.advance();let calls=0;
  const {scheduler}=f.services({request:async(url)=>{if(url.includes('bale')){calls++;if(unknown)throw Error('secret_token');return {status:403,data:{ok:false}};}return {status:200,data:{ok:true,result:url.endsWith('/getChat')?{id:-100123,type:'channel'}:{message_id:1}}};}});
  await scheduler.runDue();const after=calls;await scheduler.runDue();assert.equal(calls,after);assert.equal(f.job().state,'failed');assert(!f.job().message.includes('secret_token'));
 }
});

test('manual and automatic sends cannot overlap; graceful stop finishes the current send',async t=>{
 const f=fixture(t,['telegram']);f.queue();f.advance();let release,started;
 const gate=new Promise(resolve=>release=resolve),sending=new Promise(resolve=>started=resolve);let sends=0;
 const {publisher,scheduler}=f.services({request:async url=>{if(url.endsWith('/getChat'))return {status:200,data:{ok:true,result:{id:-100123,type:'channel'}}};sends++;started();await gate;return {status:200,data:{ok:true,result:{message_id:1}}};}});
 const pending=scheduler.runDue();await sending;await assert.rejects(()=>publisher.publish(f.id,1,f.actor.id),/حال انجام/);let stopped=false;const stopping=scheduler.stop().then(()=>{stopped=true;});await Promise.resolve();assert.equal(stopped,false);release();await Promise.all([pending,stopping]);assert.equal(f.job().state,'completed');assert.equal(sends,1);await scheduler.runDue();assert.equal(sends,1);
});

test('a stale due-list snapshot cannot cancel a newly approved future job for the same post',async t=>{
 const f=fixture(t,['telegram']);f.queue();const second=randomUUID();
 f.store.db.prepare('INSERT INTO posts(id,type,title,fields,body,channels,media,status,version,author_id,created_at,updated_at,scheduled_at) SELECT ?,type,title,fields,body,channels,media,\'draft\',version,author_id,created_at,updated_at,scheduled_at FROM posts WHERE id=?').run(second,f.id);
 queuePublication(f.store,publicPost(f.store.db.prepare('SELECT * FROM posts WHERE id=?').get(second)),f.actor,1);f.advance();
 let release,started;const gate=new Promise(resolve=>release=resolve),sending=new Promise(resolve=>started=resolve);let first=true;
 // Explicit ordering ensures the blocked post is processed before the reapproved post.
 f.store.db.prepare('UPDATE scheduled_publications SET run_at=? WHERE post_id=?').run(new Date(Date.parse(f.read().scheduled_at)-1).toISOString(),f.id);
 f.store.db.prepare('UPDATE posts SET scheduled_at=? WHERE id=?').run(f.job().run_at,f.id);
 const {scheduler}=f.services({request:async url=>{if(first){first=false;started();await gate;}return {status:200,data:{ok:true,result:url.endsWith('/getChat')?{id:-100123,type:'channel'}:{message_id:1}}};}});
 const pending=scheduler.runDue();await sending;
 f.store.db.prepare("UPDATE posts SET status='draft',scheduled_at=? WHERE id=?").run(new Date(Date.now()+600000).toISOString(),second);
 const updated=publicPost(f.store.db.prepare('SELECT * FROM posts WHERE id=?').get(second));queuePublication(f.store,updated,f.actor,1);
 release();await pending;assert.equal(f.store.db.prepare('SELECT state FROM scheduled_publications WHERE post_id=?').get(second).state,'queued');
});
