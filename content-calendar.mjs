import {check} from './content.mjs';
import {dayKey} from './public/time-zone.js';

export function calendarWindow(from,to){
 const iso=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().replace('.000Z','Z')===value.replace('.000Z','Z');
 check(iso(from)&&iso(to),'بازه تقویم معتبر نیست');const length=Date.parse(to)-Date.parse(from);check(length>0&&length<=62*86400000,'بازه تقویم باید حداکثر ۶۲ روز باشد');return {from:new Date(from).toISOString(),to:new Date(to).toISOString()};
}
export function contentCalendar(store,user,from,to,zone){
 const range=calendarWindow(from,to),db=store.db,grants=Array.isArray(user.channels)?user.channels:JSON.parse(user.channels||'[]'),admin=user.role==='admin';
 const allowedPost=p=>admin||p.author_id===user.id||JSON.parse(p.channels).some(id=>grants.includes(id));
 const allowedReceipt=r=>admin||grants.includes(r.channel_id);
 const destinations=JSON.stringify(grants),access="(?='admin' OR p.author_id=? OR EXISTS(SELECT 1 FROM json_each(p.channels) pc JOIN json_each(?) uc ON pc.value=uc.value))";
 const params=[user.role,user.id,destinations];
 const queued=db.prepare(`SELECT p.id,p.title,p.library_title,p.channels,p.author_id,p.status,p.version,p.scheduled_at,s.state AS schedule_state,s.version AS schedule_version FROM posts p LEFT JOIN scheduled_publications s ON s.post_id=p.id WHERE p.status='ready' AND p.deleted_at IS NULL AND p.archived_at IS NULL AND p.scheduled_at>=? AND p.scheduled_at<? AND ${access}`).all(range.from,range.to,...params).filter(allowedPost);
 const events=queued.map(p=>({id:`queued:${p.id}`,postId:p.id,title:p.library_title||p.title,kind:'queued',at:p.scheduled_at,version:p.version,automatic:p.schedule_state==='queued'&&p.schedule_version===p.version,destinations:JSON.parse(p.channels).filter(id=>admin||grants.includes(id))}));
 const sent=db.prepare(`SELECT r.id,r.post_id,r.version,r.channel_id,r.channel_name,r.platform,r.published_at,p.title,p.library_title,p.channels,p.author_id,p.archived_at,p.status FROM publications r JOIN posts p ON p.id=r.post_id WHERE r.status='sent' AND r.published_at>=? AND r.published_at<? AND p.deleted_at IS NULL AND ${access} ORDER BY r.published_at,r.id`).all(range.from,range.to,...params).filter(r=>allowedPost(r)&&allowedReceipt(r));
 const groups=new Map();
 for(const row of sent){
  const key=`published:${row.post_id}:${row.version}:${dayKey(row.published_at,zone)}`;
  if(!groups.has(key))groups.set(key,{id:key,postId:row.post_id,title:row.library_title||row.title,kind:'published',at:row.published_at,version:row.version,archived:!!row.archived_at||row.status==='archived',destinations:[],receipts:[]});
  const event=groups.get(key);event.destinations.push(row.channel_id);event.receipts.push({destination:row.channel_id,name:row.channel_name,platform:row.platform,at:row.published_at});
 }
 const attention=new Set(db.prepare("SELECT post_id,version,channel_id FROM publications WHERE status IN ('failed','blocked','unknown','sending')").all().filter(allowedReceipt).map(row=>`${row.post_id}:${row.version}`));
 for(const event of groups.values()){event.attention=attention.has(`${event.postId}:${event.version}`);events.push(event);}
 const unscheduled=db.prepare(`SELECT p.id,p.author_id,p.channels FROM posts p WHERE p.status='ready' AND p.scheduled_at IS NULL AND p.deleted_at IS NULL AND p.archived_at IS NULL AND ${access}`).all(...params).filter(allowedPost).length;
 return {events:events.sort((a,b)=>a.at.localeCompare(b.at)||a.id.localeCompare(b.id)),unscheduled,timeZone:zone,...range};
}
