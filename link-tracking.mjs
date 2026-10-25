import {randomBytes,createHmac} from 'node:crypto';
import {check} from './content.mjs';
function safeWebUrl(value){try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password;}catch{return false;}}
export function rewriteTrackedPayload(payload,track){
 const source=payload.caption??payload.text,entities=payload.entities.map(entity=>({...entity,...(entity.type==='text_link'&&safeWebUrl(entity.url)?{url:track(entity.url)}:{})}));
 const changes=[];
 for(const match of source.matchAll(/https?:\/\/[^\s<>"']+/gu)){
  const raw=match[0].replace(/[.,!?،؛)}\]]+$/u,'');
  if(entities.some(e=>e.type==='text_link'&&e.offset<=match.index&&e.offset+e.length>=match.index+raw.length))continue;
  try{const url=new URL(raw);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)continue;}catch{continue;}
  changes.push({start:match.index,end:match.index+raw.length,text:track(raw)});
 }
 let cursor=0,body='';for(const change of changes){body+=source.slice(cursor,change.start)+change.text;cursor=change.end;}body+=source.slice(cursor);
 function point(value,end=false){let delta=0;for(const change of changes){if(value<=change.start)return value+delta;if(value<change.end)return change.start+delta+(end?change.text.length:0);delta+=change.text.length-(change.end-change.start);}return value+delta;}
 return {...payload,[payload.caption!=null?'caption':'text']:body,entities:entities.map(entity=>({...entity,offset:point(entity.offset),length:point(entity.offset+entity.length,true)-point(entity.offset)})).filter(e=>e.length>0)};
}
export function createLinkTracking(store,workspaceId,{publicUrl,clock=Date.now}={}){
 const db=store.db;let lastPurge=0;const rates=new Map();
 function configuration(){let base;try{base=new URL(publicUrl);}catch{}const available=base?.protocol==='https:'&&!['localhost','127.0.0.1','[::1]'].includes(base.hostname);return {available:!!available,enabled:!!available&&!!store.settings().trackingEnabled,baseUrl:available?base.origin:'',retentionDays:90,reason:available?'':'برای فعال شدن آمار کلیک، دامنه عمومی HTTPS و PUBLIC_URL را روی میزبان تنظیم کنید'};}
 function transform(postId,channelId,payload){const config=configuration();check(config.enabled,'آمار کلیک هنوز روی دامنه عمومی فعال نشده است');return rewriteTrackedPayload(payload,url=>{
  let row=db.prepare('SELECT id FROM tracked_links WHERE post_id=? AND channel_id=? AND url=?').get(postId,channelId,url);
  if(!row){row={id:randomBytes(24).toString('base64url')};db.prepare('INSERT INTO tracked_links(id,post_id,channel_id,url,created_at) VALUES(?,?,?,?,?)').run(row.id,postId,channelId,url,new Date(clock()).toISOString());}
  return config.baseUrl+'/r/'+workspaceId+'/'+row.id;
 });}
 function stats(postId,actor){const allowed=actor.role==='admin'?null:new Set(Array.isArray(actor.channels)?actor.channels:JSON.parse(actor.channels));const cutoff=new Date(clock()-90*86400000).toISOString();return {configuration:configuration(),periodDays:90,destinations:db.prepare(`SELECT l.channel_id,count(e.id) AS requests,sum(CASE WHEN e.kind='click' THEN 1 ELSE 0 END) AS clicks,sum(CASE WHEN e.kind='preview' THEN 1 ELSE 0 END) AS previews,count(DISTINCT CASE WHEN e.kind='click' THEN e.visitor_hash END) AS approximate_sessions FROM tracked_links l LEFT JOIN link_events e ON e.link_id=l.id AND e.created_at>=? WHERE l.post_id=? GROUP BY l.channel_id`).all(cutoff,postId).filter(row=>!allowed||allowed.has(row.channel_id))};}
 function redirect(req,res,id){
  check(['GET','HEAD'].includes(req.method),'روش مجاز نیست',405);const row=db.prepare('SELECT url FROM tracked_links WHERE id=?').get(id);check(row,'لینک پیدا نشد',404);
  const config=configuration();check(config.available,'دامنه عمومی ردیابی فعال نیست',503);
  if(req.method==='GET'){
   let salt=store.secret('tracking:salt');if(!salt){salt=randomBytes(32).toString('hex');store.saveSecret('tracking:salt',salt);}
   const now=clock(),ua=String(req.headers['user-agent']||'').slice(0,500),day=new Date(now).toISOString().slice(0,10);
   const visitor=createHmac('sha256',salt).update(day+'|'+req.socket.remoteAddress+'|'+ua).digest('hex');
   const rate=rates.get(visitor)||{start:now,n:0};if(now-rate.start>=60000){rate.start=now;rate.n=0;}check(++rate.n<=120,'درخواست بیش از حد است',429);rates.set(visitor,rate);if(rates.size>10000)rates.delete(rates.keys().next().value);
   const preview=/bot|crawl|spider|preview|facebookexternalhit|telegram|bale|rubika|eitaa/i.test(ua)||/prefetch|preview/i.test(String(req.headers.purpose||req.headers['sec-purpose']||''));
   db.prepare('INSERT INTO link_events(link_id,created_at,kind,visitor_hash) VALUES(?,?,?,?)').run(id,new Date(now).toISOString(),preview?'preview':'click',visitor);
   if(now-lastPurge>3600000){db.prepare('DELETE FROM link_events WHERE created_at<?').run(new Date(now-90*86400000).toISOString());lastPurge=now;}
  }
  res.writeHead(302,{'Location':row.url,'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow'});res.end();
 }
 return {configuration,transform,stats,redirect};
}
