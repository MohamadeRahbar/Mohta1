import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {check} from '../content/content.mjs';
import {publicPost} from '../storage/store.mjs';
import {normalizeEntities} from '../../public/rich-text.js';
import {publicationMedia} from '../../public/media.js';
import {delivery} from './delivery.mjs';
import {messageCapabilities} from './message-options.mjs';
import {remoteClient} from './remote-adapters.mjs';
export function createMessageControls(store,{request,resolveRoute,tracking,clock=Date.now,recoverInterrupted=true}={}){
 const db=store.db,stamp=()=>new Date(clock()).toISOString();
 if(recoverInterrupted)db.prepare("UPDATE message_operations SET status='unknown',message=?,updated_at=? WHERE status='running'").run('عملیات با توقف سرویس قطع شد نتیجه را در کانال بررسی کنید',stamp());
 const rows=post=>db.prepare("SELECT * FROM publications WHERE post_id=? AND version=? AND status='sent' ORDER BY channel_id").all(post.id,post.version);
 function snapshot(post,actor){
  const allowed=actor.role==='admin'?null:new Set(Array.isArray(actor.channels)?actor.channels:JSON.parse(actor.channels)),receipts=rows(post),byId=new Map(receipts.map(row=>[row.id,row]));
  return {revision:post.control_revision||0,body:post.remote_body??post.body,entities:post.remote_entities??post.body_entities,receipts:receipts.filter(row=>!allowed||allowed.has(row.channel_id)).map(row=>({channel_id:row.channel_id,name:row.channel_name,platform:row.platform,message_ids:JSON.parse(row.message_ids),deleted:!!row.remote_deleted_at,pinned:!!row.pinned,body:row.remote_body??post.body,entities:JSON.parse(row.remote_entities||JSON.stringify(post.body_entities)),media_ids:JSON.parse(row.remote_media||JSON.stringify(publicationMedia(post))),capabilities:messageCapabilities(row.platform,{sentAt:row.published_at,mediaCount:publicationMedia(post).length,deleted:!!row.remote_deleted_at,clock})})),operations:db.prepare('SELECT * FROM message_operations WHERE post_id=? ORDER BY created_at DESC LIMIT 50').all(post.id).filter(op=>{const row=byId.get(op.publication_id);return row&&(!allowed||allowed.has(row.channel_id));}).map(op=>({channel_id:byId.get(op.publication_id).channel_id,name:byId.get(op.publication_id).channel_name,channel_id:byId.get(op.publication_id).channel_id,name:byId.get(op.publication_id).channel_name,id:op.id,request_id:op.request_id,action:op.action,status:op.status,message:op.message,results:JSON.parse(op.results),updated_at:op.updated_at}))};
 }
 async function run(postId,input,actor){
  check(['admin','publisher'].includes(actor.role),'کنترل پیام منتشر شده با مدیر یا مسوول انتشار است',403);
  const post=publicPost(db.prepare('SELECT * FROM posts WHERE id=?').get(postId));check(post&&!post.deleted_at,'محتوا پیدا نشد یا در سطل زباله است',404);
  check(post.status!=='publishing','انتشار این پیام هنوز در حال انجام است',409);
  check(['edit','delete','pin','unpin'].includes(input.action),'عملیات معتبر نیست');check(/^[a-f0-9-]{36}$/.test(input.request_id||''),'شناسه درخواست معتبر نیست');
  check(input.version===post.version,'نسخه محتوا تغییر کرده است',409);
  check(Array.isArray(input.channels)&&input.channels.length>0&&input.channels.length<=100,'مقصدهای عملیات را انتخاب کنید');
  const ids=[...new Set(input.channels)],allowed=actor.role==='admin'?null:new Set(Array.isArray(actor.channels)?actor.channels:JSON.parse(actor.channels));
  const receipts=rows(post),selected=ids.map(id=>{check(typeof id==='string'&&(!allowed||allowed.has(id)),'به مقصد انتخاب شده دسترسی ندارید',403);const row=receipts.find(r=>r.channel_id===id);check(row,'رسید ارسال مقصد پیدا نشد');return row;});
  const edit=input.action==='edit';let body=edit?input.body:null,entities=[];
  if(edit){check(typeof body==='string'&&body.length<=20000,'متن معتبر وارد کنید');entities=normalizeEntities(body,input.entities||[]);check(body.trim()||publicationMedia(post).length,'متن خالی است');}
  if(input.action==='delete')check(input.confirmation==='delete-from-channels','حذف واقعی از کانال را تایید کنید');
  let file=null,mediaIndex=0;
  if(edit&&input.media_id){check(Number.isSafeInteger(input.media_index)&&input.media_index>=0&&input.media_index<publicationMedia(post).length,'شماره رسانه معتبر نیست');mediaIndex=input.media_index;const row=db.prepare('SELECT * FROM media WHERE id=?').get(input.media_id);check(row&&(actor.role==='admin'||row.owner_id===actor.id||post.media.includes(row.id)),'فایل در دسترس نیست',403);check(['image/png','image/jpeg','image/webp','video/mp4'].includes(row.mime),'نوع رسانه قابل ویرایش نیست');file={...row,path:path.join(store.directory,'media',path.basename(row.path))};check(fs.existsSync(file.path),'فایل رسانه پیدا نشد');}
  const digest=createHash('sha256').update(JSON.stringify({postId,version:input.version,action:input.action,channels:ids.sort(),body,entities,mediaId:file?.id||null,mediaIndex})).digest('hex');
  const previous=db.prepare('SELECT * FROM message_operations WHERE request_id=?').all(input.request_id);
  if(previous.length){check(previous.every(op=>op.post_id===postId&&op.payload_hash===digest),'شناسه درخواست قبلا برای عملیات دیگری استفاده شده است',409);return snapshot(post,actor);}
  check(input.revision===post.control_revision,'کنترل این پیام در تب دیگری تغییر کرده است دوباره بررسی کنید',409);
  check(!db.prepare("SELECT 1 FROM message_operations WHERE post_id=? AND status='running'").get(postId),'عملیات دیگری روی این پیام در حال انجام است',409);
  store.transaction(()=>{const changed=db.prepare('UPDATE posts SET control_revision=control_revision+1 WHERE id=? AND control_revision=?').run(postId,input.revision);check(changed.changes===1,'عملیات همزمان تغییر کرده است',409);for(const receipt of selected)db.prepare('INSERT INTO message_operations(id,request_id,post_id,publication_id,action,payload_hash,status,created_at,updated_at) VALUES(?,?,?,?,?,?,\'running\',?,?)').run(randomUUID(),input.request_id,postId,receipt.id,input.action,digest,stamp(),stamp());});
  await Promise.all(selected.map(async receipt=>{
   const operation=db.prepare('SELECT * FROM message_operations WHERE request_id=? AND publication_id=?').get(input.request_id,receipt.id),results=[];
   let status='failed',message='';
   try{
    const capabilities=messageCapabilities(receipt.platform,{sentAt:receipt.published_at,mediaCount:publicationMedia(post).length,deleted:!!receipt.remote_deleted_at,clock});
    if(!capabilities[input.action]||file&&!capabilities.media){status='unsupported';throw Object.assign(new Error(capabilities.reason||(input.action==='delete'?capabilities.deleteReason:'این عملیات یا تغییر رسانه در API مقصد پشتیبانی نمیشود')),{safeMessage:true});}
    const channel=db.prepare('SELECT * FROM channels WHERE id=?').get(receipt.channel_id);check(channel&&!channel.deleted_at&&channel.enabled&&channel.platform===receipt.platform,'اتصال این مقصد فعال نیست');
    check(receipt.identity_version==null||channel.identity_version===receipt.identity_version,'هویت اتصال پس از انتشار تغییر کرده است عملیات متوقف شد');
    const token=store.secret('token:'+channel.id);check(token,'توکن مقصد موجود نیست');
    const client=remoteClient(channel,token,{request,resolveRoute,manualProxy:store.secret('proxy:'+channel.id)});await client.verify(receipt.target);
    const messageIds=JSON.parse(receipt.message_ids);check(messageIds.length&&messageIds.every(id=>typeof id==='string'&&id||Number.isSafeInteger(id)&&id>0),'شناسه معتبر پیام موجود نیست');
    let payload=edit?delivery({...post,body,body_entities:entities},channel):null;
    if(edit&&post.publish_options?.track_links)payload=tracking.transform(post.id,channel.id,payload);
    if(edit)check((payload.caption??payload.text).length<=(publicationMedia(post).length&&channel.platform==='telegram'?1024:4096),'متن جدید از محدودیت مقصد بیشتر است');
    const tasks=edit?(file&&mediaIndex===0?[{id:messageIds[0],kind:'media'}]:[{id:messageIds[0],kind:'text'},...(file?[{id:messageIds[mediaIndex],kind:'media'}]:[])]):input.action==='delete'?messageIds.map(id=>({id,kind:'delete'})):[{id:messageIds[0],kind:input.action}];
    const deletedIds=new Set(db.prepare("SELECT results FROM message_operations WHERE publication_id=? AND action='delete'").all(receipt.id).flatMap(row=>JSON.parse(row.results).filter(r=>r.status==='success').map(r=>String(r.id))));
    for(const task of tasks){
     if(input.action==='delete'&&deletedIds.has(String(task.id))){results.push({...task,status:'success',previous:true});continue;}
     try{await client.perform(input.action,receipt.target,task.id,{payload,file:task.kind==='media'?file:null,mediaIndex,hasMedia:publicationMedia(post).length>0});results.push({...task,status:'success'});}
     catch(error){results.push({...task,status:error.deliveryUnknown?'unknown':'failed'});message=error.safeMessage?error.message:'عملیات مقصد کامل نشد';break;}
     finally{db.prepare('UPDATE message_operations SET results=?,updated_at=? WHERE id=?').run(JSON.stringify(results),stamp(),operation.id);}
    }
    status=results.length===tasks.length&&results.every(r=>r.status==='success')?'success':results.some(r=>r.status==='unknown')?'unknown':results.some(r=>r.status==='success')?'partial':'failed';
    if(!message)message=status==='success'?'عملیات انجام شد':'عملیات کامل نشد';
    store.transaction(()=>{
     if(edit&&results.some(r=>r.status==='success'&&(r.kind==='text'||r.kind==='media'&&mediaIndex===0))){db.prepare('UPDATE publications SET remote_body=?,remote_entities=? WHERE id=?').run(body,JSON.stringify(receipt.platform==='rubika'?[]:entities),receipt.id);db.prepare('UPDATE posts SET remote_body=?,remote_entities=? WHERE id=?').run(body,JSON.stringify(entities),post.id);}
     if(file&&results.some(r=>r.status==='success'&&r.kind==='media')){const mediaIds=JSON.parse(receipt.remote_media||JSON.stringify(publicationMedia(post)));mediaIds[mediaIndex]=file.id;db.prepare('UPDATE publications SET remote_media=? WHERE id=?').run(JSON.stringify(mediaIds),receipt.id);db.prepare('UPDATE posts SET remote_media=? WHERE id=?').run(JSON.stringify(mediaIds),post.id);}
     if(status==='success'&&input.action==='delete')db.prepare('UPDATE publications SET remote_deleted_at=? WHERE id=?').run(stamp(),receipt.id);
     if(status==='success'&&['pin','unpin'].includes(input.action))db.prepare('UPDATE publications SET pinned=? WHERE id=?').run(Number(input.action==='pin'),receipt.id);
    });
   }catch(error){message=error.safeMessage||error.status?error.message:'عملیات مقصد انجام نشد';if(error.deliveryUnknown)status='unknown';}
   db.prepare('UPDATE message_operations SET status=?,results=?,message=?,updated_at=? WHERE id=?').run(status,JSON.stringify(results),message,stamp(),operation.id);store.audit(actor.id,'post.remote-'+input.action,postId,{channel:receipt.channel_id,status,operationId:operation.id});
  }));
  return snapshot(publicPost(db.prepare('SELECT * FROM posts WHERE id=?').get(postId)),actor);
 }
 return {snapshot,run};
}
