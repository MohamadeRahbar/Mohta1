import fs from 'node:fs';
import {destinationIdentity} from './destinations.mjs';
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
import {publishOptions} from './message-options.mjs';
import {remoteClient} from './remote-adapters.mjs';
import {randomUUID} from 'node:crypto';
export function publicPublication(row){return {channel_id:row.channel_id,pinned:!!row.pinned,remote_deleted_at:row.remote_deleted_at||null,version:row.version,status:row.status,message_ids:JSON.parse(row.message_ids),published_at:row.published_at,updated_at:row.updated_at,message:row.message||'',code:row.error_code||'',confirmation:row.status==='sent'?(row.error_code==='manual_confirmed'?'manual':'provider'):null,target:row.target||'',channel_name:row.channel_name||'',platform:row.platform||''};}
export function createPublisher(store,{request=requestJson,resolveRoute=resolveNetworkRoute,recoverInterrupted=true,tracking}={}){
 const timestamp=()=>new Date().toISOString(),db=store.db;
 // A process interruption may have happened after delivery; never resume these sends.
 if(recoverInterrupted){
  for(const row of db.prepare("SELECT * FROM publications WHERE status='sending'").all())store.audit(null,'post.publish-result',row.post_id,{version:row.version,channel:row.channel_id,status:'unknown',code:'interrupted',message:'برنامه پیش از ثبت نتیجه متوقف شد؛ کانال را بررسی کنید.'});
  db.prepare("UPDATE publications SET status='unknown',error_code='interrupted',message=?,updated_at=? WHERE status='sending'").run('ارسال با توقف برنامه قطع شد؛ نتیجه را در کانال بررسی کنید. ارسال تکرار نمی‌شود.',timestamp());
  db.prepare("UPDATE posts SET status='uncertain' WHERE status='publishing'").run();
 }
 const receipts=post=>db.prepare('SELECT * FROM publications WHERE post_id=? AND version=? ORDER BY channel_id').all(post.id,post.version).map(publicPublication);
 const getPost=id=>publicPost(db.prepare('SELECT * FROM posts WHERE id=?').get(id));
 function updateStatus(post){
  const results=receipts(post),sent=results.filter(r=>r.status==='sent').length,unknown=results.some(r=>r.status==='unknown'),status=sent===post.channels.length?'published':sent?'partial':unknown?'uncertain':'draft';
  db.prepare('UPDATE posts SET status=?,updated_at=? WHERE id=? AND version=?').run(status,timestamp(),post.id,post.version);
  return {post:getPost(post.id),results,sent,total:post.channels.length};
 }
 function report(post){
  const events=db.prepare("SELECT a.*,u.name actor_name FROM audit a LEFT JOIN users u ON u.id=a.actor_id WHERE a.entity_id=? AND a.action IN ('post.publish-attempt','post.publish-result','post.publish-resolve') ORDER BY a.id").all(post.id).map(row=>({...row,detail:JSON.parse(row.detail||'{}')})).filter(row=>row.detail.version===post.version);
  const results=receipts(post).map(row=>{
   const history=events.filter(event=>event.detail.channel===row.channel_id).map(event=>({id:event.id,at:event.created_at,actor:event.actor_name||'سیستم',action:event.action,status:event.detail.status,code:event.detail.code||'',message:event.detail.message||'',message_ids:event.detail.messageIds||[],attempt:event.detail.attempt||null,stage:event.detail.stage||null,transport:event.detail.transport||null,duration_ms:event.detail.duration_ms??null}));
   return {...row,history,revision:history.at(-1)?.id||0};
  });
  return {post_id:post.id,version:post.version,active:libraryState(post)==='active',busy:post.status==='publishing',results,total:post.channels.length,sent:results.filter(row=>row.status==='sent').length};
 }
 function resolve(id,data,actor){
  return store.transaction(()=>{
   const post=getPost(id);check(post,'محتوا پیدا نشد.',404);check(post.version===data.version,'نسخه محتوا تغییر کرده است؛ گزارش را تازه کنید.',409);
   check(libraryState(post)==='active'&&post.status!=='publishing','محتوا در حال ارسال، بایگانی یا حذف شده است.',409);
   check(['observed_sent','observed_absent'].includes(data.decision)&&data.confirmed===true,'بررسی کانال و تصمیم خود را تایید کنید.');
   const row=report(post).results.find(row=>row.channel_id===data.channel_id);
   check(row&&row.status==='unknown'&&row.updated_at===data.updated_at&&row.revision===data.revision,'وضعیت مقصد تغییر کرده است؛ گزارش را تازه کنید.',409);
   const sent=data.decision==='observed_sent',status=sent?'sent':'failed',code=sent?'manual_confirmed':'manual_reopened',message=sent?'مشاهده پیام در کانال توسط کاربر تایید شد؛ رسید سرویس دریافت نشده است.':'کاربر نبودن پیام در کانال را تایید کرد؛ تلاش مجدد مجاز است.';
   db.prepare('UPDATE publications SET status=?,error_code=?,message=?,updated_at=? WHERE post_id=? AND version=? AND channel_id=?').run(status,code,message,timestamp(),id,post.version,row.channel_id);
   store.audit(actor,'post.publish-resolve',id,{version:post.version,channel:row.channel_id,status,code,message,previous_status:'unknown',decision:data.decision});
   updateStatus(post);return report(getPost(id));
  });
 }
 async function publish(id,version,actor,{destinations,channelIds}={}){
  let post=getPost(id);check(post,'محتوا پیدا نشد.',404);check(post.version===version,'نسخهٔ محتوا تغییر کرده است؛ صفحه را تازه کنید.',409);check(libraryState(post)==='active','محتوای بایگانی یا حذف شده قابل انتشار نیست');
  check(post.status!=='publishing','انتشار این محتوا در حال انجام است؛ وضعیت را در کتابخانه بررسی کنید.',409);
  if(destinations!==undefined)check(JSON.stringify(destinationIdentity(store,post.channels))===JSON.stringify(destinations),'مقصد تایید شده تغییر کرده است؛ محتوا را دوباره بررسی کنید.',409);
  const selected=channelIds===undefined?post.channels:channelIds;
  check(Array.isArray(selected)&&selected.length>0&&selected.every(id=>typeof id==='string'&&post.channels.includes(id)),'مقصد تلاش مجدد معتبر نیست.');
  const selectedIds=[...new Set(selected)];
  validateReady({...post,channels:selectedIds},db.prepare('SELECT * FROM channels').all());check(!post.expires_at||new Date(post.expires_at)>new Date(),'اعتبار این محتوا منقضی شده است.');
  const files=publicationMedia(post).map(id=>{const row=db.prepare('SELECT * FROM media WHERE id=?').get(id);check(row,'فایل رسانه پیدا نشد.');const file=path.join(store.directory,'media',path.basename(row.path));check(fs.existsSync(file),'فایل رسانه در محل ذخیره‌سازی پیدا نشد.');return {...row,path:file};});
  const options=publishOptions(post.publish_options||{});if(options.track_links)check(tracking?.configuration().enabled,'برای آمار کلیک ابتدا دامنه عمومی را فعال کنید');
  const tasks=[];
  store.transaction(()=>{
   const changed=db.prepare("UPDATE posts SET status='publishing',updated_at=? WHERE id=? AND version=? AND status NOT IN ('publishing','archived') AND archived_at IS NULL AND deleted_at IS NULL").run(timestamp(),id,version);check(changed.changes===1,'انتشار یا نسخهٔ این محتوا تغییر کرده است.',409);
   cancelScheduled(store,id);
   for(const channelId of selectedIds){
    const key=id+':'+version+':'+channelId,previous=db.prepare('SELECT * FROM publications WHERE id=?').get(key);
    if(previous&&['sent','unknown','sending'].includes(previous.status))continue;
    const channel=db.prepare('SELECT * FROM channels WHERE id=?').get(channelId),availability=channelAvailability(channel,store.hasSecret('token:'+channelId));
    let code=availability.code,message=availability.message,status=availability.ready?'sending':'blocked';
    const token=availability.ready?store.secret('token:'+channelId):'';
    let replyTo;
    if(availability.ready)try{adapterPreflight(post,channel,token,files);if(options.reply_to){const reference=db.prepare("SELECT * FROM publications WHERE post_id=? AND version=? AND channel_id=? AND status='sent' AND remote_deleted_at IS NULL").get(options.reply_to.post_id,options.reply_to.version,channelId),replyIds=reference&&JSON.parse(reference.message_ids);check(replyIds?.length&&reference.platform===channel.platform&&(reference.identity_version??0)===channel.identity_version,'پیام مرجع در این کانال منتشر نشده یا هویت مقصد تغییر کرده است');replyTo={messageId:replyIds[0],target:reference.target};}}catch(error){status='blocked';code=error.code||'invalid_post';message=error.message;}
    db.prepare('INSERT INTO publications(id,post_id,channel_id,message_ids,status,version,published_at,updated_at,error_code,message,target,channel_name,platform) VALUES(?,?,?,?,?,?,NULL,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at,error_code=excluded.error_code,message=excluded.message,target=excluded.target,channel_name=excluded.channel_name,platform=excluded.platform').run(key,id,channelId,'[]',status,version,timestamp(),status==='sending'?'':code,status==='sending'?'در حال ارسال…':message,channel.target||'',channel.name,channel.platform);
    db.prepare('UPDATE publications SET identity_version=? WHERE id=?').run(channel?.identity_version??null,key);
    const attempt=randomUUID();store.audit(actor,'post.publish-attempt',id,{version,channel:channelId,attempt,status,code:status==='sending'?'':code,message:status==='sending'?'تلاش ارسال آغاز شد.':message,stage:'preflight'});
    if(status==='sending')tasks.push({key,channel,token,replyTo,attempt,manualProxy:store.secret('proxy:'+channelId)});
   }
   store.audit(actor,'post.publish-start',id,{version,channels:tasks.map(task=>task.channel.id),requested:selectedIds});
  });
  await Promise.all(tasks.map(async({key,channel,token,manualProxy,replyTo,attempt})=>{
   const started=Date.now();let status='failed',message='',code='',ids=[],target=channel.target,published=null,stage='send',transport=null;
   try{const result=await sendPost(post,channel,{token,files,request,resolveRoute,manualProxy,replyTo,pin:options.pin,transformPayload:options.track_links?payload=>tracking.transform(post.id,channel.id,payload):undefined});status='sent';message='ارسال تأیید شد.';ids=result.messageIds;target=result.target;published=timestamp();}
   catch(error){status=error.deliveryUnknown?'unknown':'failed';code=typeof error.code==='string'&&/^[a-z_]{1,50}$/.test(error.code)?error.code:'send_failed';stage=error.stage||'send';transport=error.transport||null;message=error.deliveryUnknown?'رسید قابل تایید دریافت نشد؛ ممکن است پیام ارسال شده باشد. پس از بررسی کانال، نتیجه را ثبت یا تلاش مجدد را باز کنید.':error.safeMessage?error.message:'ارسال انجام نشد؛ تنظیمات کانال یا شبکه را بررسی کنید.';}
   store.transaction(()=>{db.prepare('UPDATE publications SET status=?,message_ids=?,published_at=?,updated_at=?,error_code=?,message=?,target=? WHERE id=?').run(status,JSON.stringify(ids),published,timestamp(),code,message,target,key);store.audit(actor,'post.publish-result',id,{version,channel:channel.id,status,code,messageIds:ids,message,attempt,stage,transport,duration_ms:Date.now()-started});});
   if(status==='sent'&&options.pin){
    let pinStatus='unsupported',pinMessage='پین در API این مقصد پشتیبانی نمیشود';
    try{if(channel.platform==='eitaa'){pinStatus='success';pinMessage='پین همراه ارسال درخواست شد';}else if(['telegram','bale'].includes(channel.platform)){const client=remoteClient(channel,token,{request,resolveRoute,manualProxy});await client.verify(target);await client.perform('pin',target,ids[0]);pinStatus='success';pinMessage='پیام پین شد';}}catch(error){pinStatus=error.deliveryUnknown?'unknown':'failed';pinMessage=error.safeMessage?error.message:'پین انجام نشد';}
    if(pinStatus==='success')db.prepare('UPDATE publications SET pinned=1 WHERE id=?').run(key);
    db.prepare('INSERT INTO message_operations(id,request_id,post_id,publication_id,action,payload_hash,status,results,message,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),'publish-pin:'+key,id,key,'pin','automatic',pinStatus,JSON.stringify([{id:ids[0],kind:'pin',status:pinStatus}]),pinMessage,timestamp(),timestamp());
    store.audit(actor,'post.remote-pin',id,{channel:channel.id,status:pinStatus});
   }
  }));
  return updateStatus(post);
 }
 return {publish,receipts,report,resolve};
}
