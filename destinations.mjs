import {randomUUID} from 'node:crypto';
import {check,text} from './content.mjs';
import {activePlatforms,platformNames} from './store.mjs';

export function requireDestination(store,id,{includeDeleted=false}={}){
 const row=typeof id==='string'?store.db.prepare('SELECT * FROM channels WHERE id=?').get(id):null;
 check(row&&activePlatforms.includes(row.platform)&&(includeDeleted||!row.deleted_at),'کانال مقصد پیدا نشد',404);return row;
}
export function createDestination(store,data,actor){
 check(activePlatforms.includes(data.platform),'پیامرسان معتبر انتخاب کنید');
 check(store.db.prepare('SELECT count(*) AS n FROM channels WHERE deleted_at IS NULL').get().n<100,'حداکثر ۱۰۰ مقصد برای هر برند قابل ثبت است');
 const id=randomUUID(),name=text(data.name||platformNames[data.platform],100);check(name,'نام مقصد را وارد کنید');
 store.transaction(()=>{store.db.prepare('INSERT INTO channels(id,name,platform) VALUES(?,?,?)').run(id,name,data.platform);store.audit(actor,'channel.create',id,{platform:data.platform,name});});
 return {id,name,platform:data.platform};
}
export function invalidateDestinationQueue(store,id){
 const message='هویت یا وضعیت مقصد تغییر کرده است مقصدها را بررسی و دوباره ارسال به صف را تایید کنید',stamp=new Date().toISOString();
 const jobs=store.db.prepare("SELECT post_id FROM scheduled_publications WHERE state='queued' AND EXISTS(SELECT 1 FROM posts p,json_each(p.channels) c WHERE p.id=post_id AND c.value=?)").all(id);
 for(const job of jobs){store.db.prepare("UPDATE scheduled_publications SET state='failed',message=?,updated_at=? WHERE post_id=? AND state='queued'").run(message,stamp,job.post_id);store.db.prepare("UPDATE posts SET status='draft',updated_at=? WHERE id=? AND status='ready'").run(stamp,job.post_id);}
 return jobs.length;
}
export function removeDestination(store,id,actor){
 requireDestination(store,id);
 return store.transaction(()=>{
  check(!store.db.prepare("SELECT id FROM publications WHERE channel_id=? AND status='sending'").get(id),'این مقصد در حال ارسال است پس از پایان ارسال دوباره تلاش کنید',409);
  const cancelled=invalidateDestinationQueue(store,id);
  store.db.prepare('UPDATE channels SET deleted_at=?,enabled=0,identity_version=identity_version+1,config_version=config_version+1 WHERE id=?').run(new Date().toISOString(),id);
  store.audit(actor,'channel.remove',id,{cancelled});return {ok:true,cancelled};
 });
}
export function destinationIdentity(store,ids){
 return ids.map(id=>{const c=requireDestination(store,id);return {id:c.id,platform:c.platform,target:c.target,identity_version:c.identity_version};});
}
