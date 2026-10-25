import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {openStore,publicPost,publicUser} from '../store.mjs';
import {createDestination,removeDestination,destinationIdentity} from '../destinations.mjs';
import {saveChannelSettings} from '../channel-settings.mjs';
import {createPublisher} from '../publisher.mjs';
import {queuePublication,createScheduler} from '../scheduler.mjs';
import {validateReady} from '../delivery.mjs';
const token='123:fixture_secret_1234567890123456';

function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mohta-dest-'));let store=openStore(dir);
 const actor={id:randomUUID(),role:'admin',active:1,channels:'[]'},stamp=new Date().toISOString();
 store.db.prepare('INSERT INTO users(id,username,name,password,role,channels,created_at) VALUES(?,?,?,?,?,?,?)').run(actor.id,actor.id,'Owner','unused','admin','[]',stamp);
 const a=createDestination(store,{platform:'telegram',name:'First'},actor.id),b=createDestination(store,{platform:'telegram',name:'Second'},actor.id);
 for(const [channel,target] of [[a,'@first'],[b,'@second']])saveChannelSettings(store,channel.id,{name:channel.name,target,route:'direct',enabled:true,token},actor.id);
 function post(channels=[a.id,b.id],scheduled=null){const id=randomUUID();store.db.prepare('INSERT INTO posts(id,type,title,fields,body,channels,media,status,version,author_id,created_at,updated_at,scheduled_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,'free','Label','{}','Exact authored text',JSON.stringify(channels),'[]','draft',1,actor.id,stamp,stamp,scheduled);return read(id);}
 const read=id=>publicPost(store.db.prepare('SELECT * FROM posts WHERE id=?').get(id));
 t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
 return {get store(){return store;},actor,a,b,post,read,reopen(){store.close();store=openStore(dir);}};
}
test('two Telegram destinations have separate secrets, receipts and retries, preserving removed history',async t=>{
 const f=fixture(t),post=f.post(),calls=[];let fail=true;
 const service=createPublisher(f.store,{resolveRoute:async()=>({proxy:''}),request:async(url,{body})=>{
  if(url.endsWith('/getChat'))return {status:200,data:{ok:true,result:{id:body.chat_id==='@first'?-101:-102,type:'channel'}}};
  calls.push(body.chat_id);return fail&&body.chat_id==='@second'?{status:400,data:{ok:false,error_code:400}}:{status:200,data:{ok:true,result:{message_id:7}}};
 }});
 let result=await service.publish(post.id,1,f.actor.id);assert.equal(result.post.status,'partial');assert.equal(result.sent,1);assert.equal(result.total,2);
 assert.equal(result.results.find(r=>r.channel_id===f.a.id).channel_name,'First');assert(result.results.every(r=>r.platform==='telegram'));
 fail=false;result=await service.publish(post.id,1,f.actor.id);assert.equal(result.post.status,'published');assert.deepEqual(calls,['@first','@second','@second']);
 removeDestination(f.store,f.a.id,f.actor.id);f.reopen();assert.equal(f.store.db.prepare('SELECT deleted_at FROM channels WHERE id=?').get(f.a.id).deleted_at!==null,true);
 assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM publications WHERE post_id=?').get(post.id).n,2);assert.equal(f.store.secret('token:'+f.a.id),token);
 assert.deepEqual(publicUser({...f.actor,username:'x',name:'x',channels:JSON.stringify([f.b.id])}).channels,[f.b.id]);
});
test('new Telegram IDs enforce Telegram text limits and use the platform contact block',t=>{
 const f=fixture(t),post=f.post([f.a.id]);
 assert.throws(()=>validateReady({...post,body:'x'.repeat(4097)},f.store.db.prepare('SELECT * FROM channels').all()),/تلگرام/);
});
test('queue pins destination identity, permits display rename, invalidates changed target and never sends it',async t=>{
 const f=fixture(t),post=f.post([f.a.id],new Date(Date.now()+60000).toISOString());queuePublication(f.store,post,f.actor,1);
 const identity=destinationIdentity(f.store,post.channels);
 saveChannelSettings(f.store,f.a.id,{name:'Renamed',target:'@first',enabled:true,route:'direct'},f.actor.id);
 assert.deepEqual(destinationIdentity(f.store,post.channels),identity);assert.equal(f.store.db.prepare('SELECT state FROM scheduled_publications WHERE post_id=?').get(post.id).state,'queued');
 saveChannelSettings(f.store,f.a.id,{name:'Renamed',target:'@different',enabled:true,route:'direct'},f.actor.id);
 assert.equal(f.read(post.id).status,'draft');assert.equal(f.store.db.prepare('SELECT state FROM scheduled_publications WHERE post_id=?').get(post.id).state,'failed');
 let sends=0;const scheduler=createScheduler(f.store,{publish:async()=>{sends++;}},{resolveActor:()=>f.actor,clock:()=>Date.now()+120000});await scheduler.runDue();assert.equal(sends,0);
});
test('due queue also detects a changed target when an invalidation callback was bypassed',async t=>{
 const f=fixture(t),post=f.post([f.a.id],new Date(Date.now()+60000).toISOString());queuePublication(f.store,post,f.actor,1);
 f.store.db.prepare('UPDATE channels SET target=? WHERE id=?').run('@different',f.a.id);
 let sends=0;const scheduler=createScheduler(f.store,{publish:async()=>{sends++;}},{resolveActor:()=>f.actor,clock:()=>Date.now()+120000});await scheduler.runDue();assert.equal(sends,0);assert.equal(f.read(post.id).status,'draft');
});
test('migration is repeatable, keeps legacy IDs and requires approval for unpinned legacy jobs',t=>{
 const f=fixture(t),post=f.post(['telegram'],new Date(Date.now()+60000).toISOString());
 f.store.db.prepare("UPDATE posts SET status='ready' WHERE id=?").run(post.id);
 f.store.db.prepare("INSERT INTO scheduled_publications(post_id,run_id,version,run_at,actor_id,state,updated_at) VALUES(?,?,?,?,?,'queued',?)").run(post.id,randomUUID(),1,post.scheduled_at,f.actor.id,new Date().toISOString());
 f.store.db.prepare('DELETE FROM schema_migrations WHERE id=?').run('destinations-v1');f.reopen();f.reopen();
 assert.equal(f.read(post.id).status,'draft');assert.equal(f.store.db.prepare('SELECT state FROM scheduled_publications WHERE post_id=?').get(post.id).state,'failed');
 assert.equal(f.store.db.prepare("SELECT id FROM channels WHERE id='telegram'").get().id,'telegram');
 assert.equal(f.store.db.prepare("SELECT count(*) AS n FROM schema_migrations WHERE id='destinations-v1'").get().n,1);
});
