import {destinationIdentity} from './destinations.mjs';
import {randomUUID} from 'node:crypto';
import {check} from './content.mjs';
import {validateReady} from './delivery.mjs';
import {publicPost} from './store.mjs';
import {libraryState} from './public/post-library.js';

export function cancelScheduled(store,id){
 store.db.prepare("UPDATE scheduled_publications SET state='cancelled',message='',updated_at=? WHERE post_id=? AND state='queued'").run(new Date().toISOString(),id);
}

// Only a new, explicit queue approval creates a job; legacy ready posts stay manual.
export function queuePublication(store,post,actor,version,{clock=Date.now}={}){
 check(['admin','publisher'].includes(actor.role),'دسترسی ارسال به صف را ندارید',403);
 check(libraryState(post)==='active'&&post.status==='draft','فقط پیش نویس فعال را میتوان به صف فرستاد');
 const channels=Array.isArray(actor.channels)?actor.channels:JSON.parse(actor.channels);
 check(actor.role==='admin'||post.channels.every(id=>channels.includes(id)),'به کانال انتخاب شده دسترسی ندارید',403);
 if(version!==undefined||post.scheduled_at)check(version===post.version,'نسخه محتوا تغییر کرده است، دوباره محتوا را بررسی کنید',409);
 validateReady(post,store.db.prepare('SELECT * FROM channels').all());
 const destinations=destinationIdentity(store,post.channels);
 const time=clock(),runAt=post.scheduled_at;
 check(!post.expires_at||Date.parse(post.expires_at)>time,'اعتبار محتوا منقضی شده است');
 if(runAt){
  check(Number.isFinite(Date.parse(runAt))&&Date.parse(runAt)>time,'برای ارسال خودکار، تاریخ و ساعت آینده را مشخص کنید');
  check(!post.expires_at||Date.parse(post.expires_at)>Date.parse(runAt),'اعتبار قیمت باید بعد از زمان انتشار باشد');
 }
 store.transaction(()=>{
  const changed=store.db.prepare("UPDATE posts SET status='ready',updated_at=? WHERE id=? AND version=? AND status='draft' AND archived_at IS NULL AND deleted_at IS NULL").run(new Date(time).toISOString(),post.id,post.version);
  check(changed.changes===1,'نسخه یا وضعیت محتوا تغییر کرده است',409);
  cancelScheduled(store,post.id);
  if(runAt)store.db.prepare("INSERT INTO scheduled_publications(post_id,run_id,version,run_at,actor_id,state,updated_at,destination_snapshot) VALUES(?,?,?,?,?,'queued',?,?) ON CONFLICT(post_id) DO UPDATE SET run_id=excluded.run_id,version=excluded.version,run_at=excluded.run_at,actor_id=excluded.actor_id,destination_snapshot=excluded.destination_snapshot,state='queued',message='',updated_at=excluded.updated_at").run(post.id,randomUUID(),post.version,runAt,actor.id,new Date(time).toISOString(),JSON.stringify(destinations));
  store.audit(actor.id,'post.ready',post.id,{version:post.version,scheduledAt:runAt,automatic:!!runAt});
 });
 return {ok:true,automatic:!!runAt};
}

export function createScheduler(store,publisher,{resolveActor,clock=Date.now,recoverInterrupted=true}={}){
 const db=store.db;let busy=null,stopped=false;
 if(recoverInterrupted)db.prepare("UPDATE scheduled_publications SET state='failed',message=?,updated_at=? WHERE state='running'").run('ارسال با توقف برنامه قطع شد، نتیجه کانال ها را بررسی کنید ارسال خودکار تکرار نمیشود',new Date(clock()).toISOString());
 function finish(job,state,message){
  db.prepare('UPDATE scheduled_publications SET state=?,message=?,updated_at=? WHERE post_id=? AND run_id=? AND state=\'running\'').run(state,message,new Date(clock()).toISOString(),job.post_id,job.run_id);
  store.audit(job.actor_id,'post.schedule-result',job.post_id,{state,message,version:job.version});
 }
 async function drain(){
  const jobs=db.prepare("SELECT * FROM scheduled_publications WHERE state='queued' AND run_at<=? ORDER BY run_at,post_id LIMIT 25").all(new Date(clock()).toISOString());
  for(const job of jobs){
   if(stopped)break;
   const post=publicPost(db.prepare('SELECT * FROM posts WHERE id=?').get(job.post_id));
   if(!post||post.version!==job.version||post.status!=='ready'||libraryState(post)!=='active'||post.scheduled_at!==job.run_at){
    db.prepare("UPDATE scheduled_publications SET state='cancelled',updated_at=? WHERE post_id=? AND run_id=? AND state='queued'").run(new Date(clock()).toISOString(),job.post_id,job.run_id);continue;
   }
   // Durable claim happens before any network operation; concurrent ticks cannot send twice.
   const claimed=db.prepare("UPDATE scheduled_publications SET state='running',updated_at=? WHERE post_id=? AND run_id=? AND state='queued'").run(new Date(clock()).toISOString(),job.post_id,job.run_id);
   if(!claimed.changes)continue;
   try{
    const actor=resolveActor(job.actor_id),channels=actor&&(Array.isArray(actor.channels)?actor.channels:JSON.parse(actor.channels));
    check(actor?.active&&['admin','publisher'].includes(actor.role)&&(actor.role==='admin'||post.channels.every(id=>channels.includes(id))),'ارسال خودکار انجام نشد چون دسترسی تایید کننده تغییر کرده است',403);
    check(!post.expires_at||Date.parse(post.expires_at)>clock(),'ارسال خودکار انجام نشد چون اعتبار محتوا منقضی شده است');
    check(job.destination_snapshot&&JSON.stringify(destinationIdentity(store,post.channels))===job.destination_snapshot,'مقصد تایید شده تغییر کرده است محتوا را دوباره بررسی کنید');
    const result=await publisher.publish(post.id,job.version,actor.id,{destinations:JSON.parse(job.destination_snapshot)});
    finish(job,result.sent===result.total?'completed':'failed',result.sent===result.total?'در زمان تعیین شده ارسال شد':'ارسال کامل نشد، نتیجه هر کانال را بررسی کنید ارسال خودکار تکرار نمیشود');
   }catch(error){
    // Never echo raw provider/network exceptions or retry ambiguous deliveries.
    const message=error.status&&error.status<500?error.message:'ارسال خودکار کامل نشد، نتیجه ارسال را بررسی کنید';
    db.prepare("UPDATE posts SET status='draft',updated_at=? WHERE id=? AND version=? AND status='ready'").run(new Date(clock()).toISOString(),post.id,post.version);
    finish(job,'failed',message);
   }
  }
 }
 return {
  runDue(){if(stopped)return Promise.resolve();if(!busy)busy=drain().finally(()=>{busy=null;});return busy;},
  async stop(){stopped=true;await busy;}
 };
}
