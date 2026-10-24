import fs from 'node:fs';
import path from 'node:path';
import {check} from './content.mjs';
import {validateReady} from './delivery.mjs';
import {publicPost} from './store.mjs';
import {libraryState} from './public/post-library.js';
import {cancelScheduled} from './scheduler.mjs';
import {publicationMedia} from './public/media.js';
import {requestJson} from './network.mjs';
import {resolveNetworkRoute} from './system-network.mjs';
import {channelAvailability,sendPost,adapterPreflight} from './publish-adapters.mjs';
export function publicPublication(row){return {channel_id:row.channel_id,version:row.version,status:row.status,message_ids:JSON.parse(row.message_ids),published_at:row.published_at,updated_at:row.updated_at,message:row.message||'',code:row.error_code||'',target:row.target||''};}
export function createPublisher(store,{request=requestJson,resolveRoute=resolveNetworkRoute,recoverInterrupted=true}={}){
 const timestamp=()=>new Date().toISOString(),db=store.db;
 // A process interruption may have happened after delivery; never resume these sends.
 if(recoverInterrupted){
  db.prepare("UPDATE publications SET status='unknown',error_code='interrupted',message=?,updated_at=? WHERE status='sending'").run('ارسال با توقف برنامه قطع شد؛ نتیجه را در کانال بررسی کنید. ارسال تکرار نمی‌شود.',timestamp());
  db.prepare("UPDATE posts SET status='uncertain' WHERE status='publishing'").run();
 }
 const receipts=post=>db.prepare('SELECT * FROM publications WHERE post_id=? AND version=? ORDER BY channel_id').all(post.id,post.version).map(publicPublication);
 const getPost=id=>publicPost(db.prepare('SELECT * FROM posts WHERE id=?').get(id));
 async function publish(id,version,actor){
  let post=getPost(id);check(post,'محتوا پیدا نشد.',404);check(post.version===version,'نسخهٔ محتوا تغییر کرده است؛ صفحه را تازه کنید.',409);check(libraryState(post)==='active','محتوای بایگانی یا حذف شده قابل انتشار نیست');
  check(post.status!=='publishing','انتشار این محتوا در حال انجام است؛ وضعیت را در کتابخانه بررسی کنید.',409);
  validateReady(post);check(!post.expires_at||new Date(post.expires_at)>new Date(),'اعتبار این محتوا منقضی شده است.');
  const files=publicationMedia(post).map(id=>{const row=db.prepare('SELECT * FROM media WHERE id=?').get(id);check(row,'فایل رسانه پیدا نشد.');const file=path.join(store.directory,'media',path.basename(row.path));check(fs.existsSync(file),'فایل رسانه در محل ذخیره‌سازی پیدا نشد.');return {...row,path:file};});
  const tasks=[];
  store.transaction(()=>{
   const changed=db.prepare("UPDATE posts SET status='publishing',updated_at=? WHERE id=? AND version=? AND status NOT IN ('publishing','archived') AND archived_at IS NULL AND deleted_at IS NULL").run(timestamp(),id,version);check(changed.changes===1,'انتشار یا نسخهٔ این محتوا تغییر کرده است.',409);
   cancelScheduled(store,id);
   for(const channelId of post.channels){
    const key=id+':'+version+':'+channelId,previous=db.prepare('SELECT * FROM publications WHERE id=?').get(key);
    if(previous&&['sent','unknown','sending'].includes(previous.status))continue;
    const channel=db.prepare('SELECT * FROM channels WHERE id=?').get(channelId),availability=channelAvailability(channel,store.hasSecret('token:'+channelId));
    let code=availability.code,message=availability.message,status=availability.ready?'sending':'blocked';
    const token=availability.ready?store.secret('token:'+channelId):'';
    if(availability.ready)try{adapterPreflight(post,channel,token,files);}catch(error){status='blocked';code=error.code||'invalid_post';message=error.message;}
    db.prepare('INSERT INTO publications(id,post_id,channel_id,message_ids,status,version,published_at,updated_at,error_code,message,target) VALUES(?,?,?,?,?,?,NULL,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at,error_code=excluded.error_code,message=excluded.message,target=excluded.target').run(key,id,channelId,'[]',status,version,timestamp(),status==='sending'?'':code,status==='sending'?'در حال ارسال…':message,channel.target||'');
    if(status==='sending')tasks.push({key,channel,token,manualProxy:store.secret('proxy:'+channelId)});
   }
   store.audit(actor,'post.publish-start',id,{version,channels:post.channels});
  });
  await Promise.all(tasks.map(async({key,channel,token,manualProxy})=>{
   let status='failed',message='',code='',ids=[],target=channel.target,published=null;
   try{const result=await sendPost(post,channel,{token,files,request,resolveRoute,manualProxy});status='sent';message='ارسال تأیید شد.';ids=result.messageIds;target=result.target;published=timestamp();}
   catch(error){status=error.deliveryUnknown?'unknown':'failed';code=typeof error.code==='string'&&/^[a-z_]{1,50}$/.test(error.code)?error.code:'send_failed';message=error.deliveryUnknown?'نتیجهٔ ارسال مشخص نیست؛ کانال را بررسی کنید. برای جلوگیری از پیام تکراری، ارسال مجدد مسدود است.':error.safeMessage?error.message:'ارسال انجام نشد؛ تنظیمات کانال یا شبکه را بررسی کنید.';}
   store.transaction(()=>{db.prepare('UPDATE publications SET status=?,message_ids=?,published_at=?,updated_at=?,error_code=?,message=?,target=? WHERE id=?').run(status,JSON.stringify(ids),published,timestamp(),code,message,target,key);store.audit(actor,'post.publish-result',id,{version,channel:channel.id,status,code,messageIds:ids});});
  }));
  const results=receipts(post),sent=results.filter(r=>r.status==='sent').length,unknown=results.some(r=>r.status==='unknown'),status=sent===post.channels.length?'published':sent?'partial':unknown?'uncertain':'draft';
  db.prepare('UPDATE posts SET status=?,updated_at=? WHERE id=? AND version=?').run(status,timestamp(),id,version);
  return {post:getPost(id),results,sent,total:post.channels.length};
 }
 return {publish,receipts};
}
