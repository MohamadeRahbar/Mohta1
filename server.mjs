import {createAccountRouter} from './account-http.mjs';
import {identifier} from './accounts.mjs';
import {createWorkspaces} from './workspaces.mjs';
import {createPublisher} from './publisher.mjs';
import {channelAvailability,sendPlatforms} from './publish-adapters.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {activePlatforms as platforms,platformNames,typeNames,publicUser,publicPost,appName} from './store.mjs';
import {session,safeEqual,roles} from './auth.mjs';
import {check,text,httpUrl,validateFields,renderContentDocument,prepareDocument,postTitle,defaultCta} from './content.mjs';
import {delivery,validateReady} from './delivery.mjs';
import {buildTextPrompt} from './text-assist.mjs';
import {saveChannelSettings} from './channel-settings.mjs';
import {channelSetupIssue} from './channel-access.mjs';
import {createChannelVerifier} from './channel-verifier.mjs';
import {normalizeContacts} from './public/contacts.js';
import {publicationMedia} from './public/media.js';
import {streamMedia} from './media-stream.mjs';
import {createChatGPTService} from './chatgpt.mjs';
import {changePostLibrary} from './post-library.mjs';
import {libraryState} from './public/post-library.js';
import {createScheduler,queuePublication,cancelScheduled} from './scheduler.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const appVersion=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
const host=process.env.HOST||'127.0.0.1';
const port=Number(process.env.PORT||8787);
const publicUrl=process.env.PUBLIC_URL?new URL(process.env.PUBLIC_URL):null;
const allowedHosts=new Set([`127.0.0.1:${port}`,`localhost:${port}`,`[::1]:${port}`,...(publicUrl?[publicUrl.host]:[])]);
const now=()=>new Date().toISOString();
const limited=new Map();
const mimeTypes={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.woff2':'font/woff2'};

function createWorkspaceRuntime(store,workspace){
const chatgpt=createChatGPTService(store,{port});
const publishingService=createPublisher(store);
const scheduler=createScheduler(store,publishingService,{resolveActor:id=>workspaces.scheduledActor(workspace.id,id)});
const channelVerifier=createChannelVerifier(store);
function json(res,value,status=200){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));}
async function buffer(req,limit=1024*1024){let length=0;const parts=[];for await(const chunk of req){length+=chunk.length;check(length<=limit,'حجم درخواست بیش از حد مجاز است.',413);parts.push(chunk);}return Buffer.concat(parts);}
async function body(req){check((req.headers['content-type']||'').startsWith('application/json'),'درخواست باید JSON باشد.',415);let value;try{value=JSON.parse((await buffer(req)).toString('utf8'));}catch(error){if(error.status)throw error;check(false,'درخواست خوانا نیست.');}check(value&&typeof value==='object'&&!Array.isArray(value),'بدنهٔ درخواست معتبر نیست.');return value;}
function admin(user){check(user.role==='admin','این بخش فقط برای مدیر سیستم است.',403);}
function writing(user){check(['admin','publisher','editor'].includes(user.role),'اجازهٔ ساخت یا ویرایش محتوا ندارید.',403);}
function publishing(user){check(['admin','publisher'].includes(user.role),'تأیید و مدیریت صف با مدیر یا مسئول انتشار است.',403);}
function selectedChannels(value,user){check(Array.isArray(value)&&value.length>0&&value.length<=platforms.length,'حداقل یک کانال انتخاب کنید.');const channels=[...new Set(value)];check(channels.every(x=>platforms.includes(x)),'کانال معتبر نیست.');if(user.role!=='admin')check(channels.every(x=>JSON.parse(user.channels).includes(x)),'به یکی از کانال‌های انتخابی دسترسی ندارید.',403);return channels;}
function visible(post,user){return user.role==='admin'||(post.author_id===user.id)||post.channels.some(id=>JSON.parse(user.channels).includes(id));}
function editAllowed(post,user){writing(user);check(user.role!=='editor'||post.author_id===user.id,'فقط محتوای خودتان را می‌توانید ویرایش کنید.',403);selectedChannels(post.channels,user);check(libraryState(post)==='active','ابتدا محتوا را به کتابخانه برگردانید');check(['draft','ready','archived'].includes(post.status),'این محتوا برای ویرایش نیاز به مسیر به‌روزرسانی انتشار دارد.');}
function findPost(id,user){const post=publicPost(store.db.prepare('SELECT * FROM posts WHERE id=?').get(id));check(post&&visible(post,user),'محتوا پیدا نشد.',404);return post;}
function validateIdentity(data){const username=identifier(data.username).value,name=text(data.name||'',100),password=text(data.password||'',200);check(name,'نام عضو را وارد کنید');check(!password||password.length>=12,'رمز اولیه حداقل ۱۲ کاراکتر باشد');return {username,name,password};}
function recordRevision(post,actor,mediaRequest){store.db.prepare('INSERT INTO revisions(post_id,version,value,actor_id,created_at) VALUES(?,?,?,?,?)').run(post.id,post.version,JSON.stringify({...post,media_request:mediaRequest,delivery:delivery(post)}),actor,now());}
function generationRequest(data){check(!data,'کمک هوش مصنوعی برای تصویر و ویدئو حذف شده است؛ فایل آماده را بارگذاری کنید.');return null;}
function saveGeneration(post,request){
 store.db.prepare("UPDATE generation_jobs SET status='cancelled' WHERE post_id=? AND status!='cancelled'").run(post.id);
}
function dateValue(value){if(!value)return null;const normalized=text(value,50);check(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(normalized),'تاریخ معتبر نیست.');const date=new Date(normalized);check(!Number.isNaN(date.getTime()),'تاریخ معتبر نیست.');return date.toISOString();}
function publicationSelection(data,media){
 const ids=publicationMedia({...data,media});check(!media.length||ids.length,'دست‌کم یک تصویر یا کلیپ را برای پست انتخاب کنید.');return ids;
}
function connectionState(channel){const issue=channelSetupIssue(channel,store.secret('token:'+channel.id));return issue?{network_status:'not_configured',network_detail:issue}:{};}
function snapshot(user){
 const settings=store.settings();
 const posts=store.db.prepare('SELECT p.*,u.name AS author_name FROM posts p JOIN users u ON u.id=p.author_id ORDER BY p.updated_at DESC LIMIT 1000').all().map(publicPost).filter(post=>visible(post,user)).map(post=>{return {...post,schedule:store.db.prepare('SELECT state,run_at,message FROM scheduled_publications WHERE post_id=? AND version=?').get(post.id,post.version)||null,publications:publishingService.receipts(post).filter(r=>user.role==='admin'||JSON.parse(user.channels).includes(r.channel_id)),delivery:delivery(post),deliveries:Object.fromEntries(post.channels.map(platform=>[platform,delivery(post,platform)])),media_request:null};});
 const channels=store.db.prepare('SELECT * FROM channels').all().filter(c=>platforms.includes(c.id)&&(user.role==='admin'||JSON.parse(user.channels).includes(c.id))).map(c=>({...c,enabled:!!c.enabled,network_detail:c.network_detail?JSON.parse(c.network_detail):null,access_detail:c.access_detail?JSON.parse(c.access_detail):null,tokenConfigured:store.hasSecret('token:'+c.id),proxyConfigured:store.hasSecret('proxy:'+c.id),publishing:channelAvailability(c,store.hasSecret('token:'+c.id)),...connectionState(c)}));
 const audit=store.db.prepare('SELECT a.*,u.name AS actor_name FROM audit a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 80').all().filter(a=>user.role==='admin'||a.actor_id===user.id).map(a=>({...a,detail:JSON.parse(a.detail)}));
 const visibleMedia=new Set([...posts.flatMap(post=>post.media),settings.brandLogoId].filter(Boolean));
 const mediaMap=Object.fromEntries(store.db.prepare('SELECT id,name,mime,size,owner_id FROM media').all().filter(m=>user.role==='admin'||m.owner_id===user.id||visibleMedia.has(m.id)).map(m=>[m.id,{id:m.id,name:m.name,mime:m.mime,size:m.size}]));
 const publicationCount=store.db.prepare("SELECT channel_id FROM publications WHERE status='sent'").all().filter(p=>user.role==='admin'||JSON.parse(user.channels).includes(p.channel_id)).length;
 return {...accountRouter.accountInfo(workspaces.accounts.user(user.account_id)),workspace:{id:workspace.id,name:workspaces.get(workspace.id).row.name},workspaces:workspaces.list(workspace.id,user),user:publicUser(user),csrf:user.csrf,settings,channels,posts,mediaMap,audit,copyDefaults:{cta:defaultCta},phase:'publishing',ai:chatgpt.status(user.id),capabilities:{workspaces:true,canCreateBrands:!!workspaces.accounts.user(user.account_id).can_create_brands,projectName:false,scheduledPublish:true,instantPublish:true,sendPlatforms,telegramAccessCheck:true,channelAccessCheck:true,structuredContacts:true,chatgptConnect:host==='127.0.0.1'&&!publicUrl},publicationCount};
}

async function route(req,res,url,auth){
 const user=auth?.user;
 if(req.method==='GET'&&url.pathname==='/healthz'){json(res,{ok:true,version:appVersion});return;}
 if(req.method==='GET'&&url.pathname==='/auth/callback'){
   let message,ok=false;
   try{const result=await chatgpt.complete(url.searchParams,attempt=>workspaces.validSession(workspace.id,attempt.sessionHash,attempt.userId));ok=result.canGenerate;message=ok?'حساب ChatGPT متصل شد و مجوز تولید متن داده شد.':'ورود انجام شد، اما مجوز استفاده از سهمیهٔ ChatGPT داده نشده است.';}
   catch(error){message=error.status?error.message:'اتصال کامل نشد؛ از داخل پنل دوباره شروع کنید.';}
   const escaped=message.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
   res.writeHead(ok?200:400,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer'});res.end('<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><title>اتصال ChatGPT</title><main class="auth-box" style="margin:10vh auto;padding:24px"><h1>اتصال ChatGPT</h1><p>'+escaped+'</p><a href="/#ai" class="button">بازگشت به پنل</a></main></html>');return;
 }
 if(url.pathname.startsWith('/api/')){
   check(user,'ابتدا وارد حساب خود شوید.',401);
   if(!['GET','HEAD'].includes(req.method))check(safeEqual(req.headers['x-csrf-token']||'',user.csrf),'درخواست معتبر نیست؛ صفحه را تازه‌سازی کنید.',403);
   if(req.method==='GET'&&url.pathname==='/api/state'){json(res,snapshot(user));return;}
   if(req.method==='GET'&&url.pathname==='/api/ai/status'){json(res,chatgpt.status(user.id));return;}
   if(req.method==='POST'&&url.pathname==='/api/ai/connect'){
     writing(user);check(host==='127.0.0.1'&&!publicUrl,'اتصال مستقیم ChatGPT در این نسخه برای اجرای محلی روی همین دستگاه آماده است.');
     json(res,chatgpt.start(user,{sessionHash:user.token_hash}));return;
   }
   if(req.method==='POST'&&url.pathname==='/api/ai/disconnect'){writing(user);json(res,await chatgpt.disconnect(user.id));return;}
   if(req.method==='GET'&&url.pathname==='/api/ai/models'){writing(user);json(res,{models:await chatgpt.models(user.id)});return;}
   if(req.method==='POST'&&url.pathname==='/api/ai/model'){writing(user);const data=await body(req);check(data.effort===undefined||typeof data.effort==='string','میزان تلاش معتبر نیست.');json(res,await chatgpt.selectModel(user.id,text(data.model||'',150),data.effort));return;}
   if(req.method==='POST'&&url.pathname==='/api/text-assist/generate'){
     writing(user);const data=await body(req);const prompt=buildTextPrompt(data,store.settings());json(res,{target:prompt.target,...await chatgpt.generate(user.id,prompt.prompt)});return;
   }
   if(req.method==='POST'&&url.pathname==='/api/text-assist/prompt'){writing(user);const data=await body(req);json(res,buildTextPrompt(data,store.settings()));return;}
   if(req.method==='POST'&&url.pathname==='/api/preview'){
     writing(user);const data=await body(req);const fields=validateFields(data.type,data.fields);const title=postTitle(data.type,data.title,fields);json(res,renderContentDocument(data.type,title,fields,store.settings()));return;
   }
   if(req.method==='POST'&&url.pathname==='/api/posts'){
     writing(user);const data=await body(req);const fields=validateFields(data.type,data.fields);const title=postTitle(data.type,data.title,fields);const channels=selectedChannels(data.channels,user);const media=Array.isArray(data.media)?[...new Set(data.media)]:[];check(media.length<=8,'حداکثر ۸ فایل برای هر محتوا انتخاب کنید.');
     for(const id of media)check(store.db.prepare('SELECT id FROM media WHERE id=? AND owner_id=?').get(id,user.id),'فایل رسانه پیدا نشد.',400);
     const mediaRequest=generationRequest(data.media_request,media),publicationIds=publicationSelection(data,media);const document=prepareDocument(data,title,fields,store.settings());check(document.body||publicationIds.length,'متن پیام یا یک رسانه را وارد کنید.');const timestamp=now();const post={id:randomUUID(),type:data.type,title,fields,body:document.body,body_entities:document.entities,channels,media,primary_media_id:publicationIds[0]||null,publication_media_ids:publicationIds,scheduled_at:dateValue(data.scheduled_at),expires_at:dateValue(data.expires_at),status:'draft',version:1,author_id:user.id,created_at:timestamp,updated_at:timestamp};
     store.transaction(()=>{store.db.prepare('INSERT INTO posts(id,type,title,fields,body,channels,media,scheduled_at,expires_at,status,version,author_id,created_at,updated_at,primary_media_id,publication_media_ids,body_entities) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(post.id,post.type,post.title,JSON.stringify(fields),post.body,JSON.stringify(channels),JSON.stringify(media),post.scheduled_at,post.expires_at,post.status,post.version,user.id,timestamp,timestamp,post.primary_media_id,JSON.stringify(post.publication_media_ids),JSON.stringify(post.body_entities));saveGeneration(post,mediaRequest);recordRevision(post,user.id,mediaRequest);store.audit(user.id,'post.create',post.id,{title,type:post.type});});json(res,{post},201);return;
   }
   if(req.method==='POST'&&url.pathname==='/api/posts/library-actions'){
     writing(user);const data=await body(req);json(res,changePostLibrary(store,user,data.action,data.posts));return;
   }
   let match=url.pathname.match(/^\/api\/posts\/([a-f0-9-]+)\/library-title$/);
   if(req.method==='PUT'&&match){
     writing(user);const data=await body(req),previous=findPost(match[1],user);check(libraryState(previous)==='active','ابتدا محتوا را به کتابخانه برگردانید');check(user.role!=='editor'||previous.author_id===user.id,'فقط نام محتوای خودتان را می‌توانید تغییر دهید.',403);selectedChannels(previous.channels,user);
     const title=text(data.title||'',240);check(title&&!/[\r\n]/.test(title),'نام داخلی را در یک خط وارد کنید.');
     check(data.version===previous.version&&(data.previous??null)===(previous.library_title??null),'نام یا نسخهٔ محتوا تغییر کرده است؛ صفحه را تازه کنید.',409);
     store.transaction(()=>{const result=store.db.prepare('UPDATE posts SET library_title=?,updated_at=? WHERE id=? AND version=? AND library_title IS ?').run(title,now(),previous.id,previous.version,previous.library_title??null);check(result.changes===1,'نام محتوا تغییر کرده است؛ صفحه را تازه کنید.',409);store.audit(user.id,'post.rename',previous.id,{before:previous.library_title||previous.title,after:title});});
     json(res,{post:findPost(previous.id,user)});return;
   }
   match=url.pathname.match(/^\/api\/posts\/([a-f0-9-]+)\/copy$/);
   if(req.method==='POST'&&match){
     writing(user);const data=await body(req),previous=findPost(match[1],user);check(libraryState(previous)==='active','ابتدا محتوا را به کتابخانه برگردانید');check(data.version===previous.version,'نسخهٔ محتوا تغییر کرده است؛ صفحه را تازه کنید.',409);
     const channels=selectedChannels(data.channels,user),timestamp=now();
     for(const id of previous.media)check(store.db.prepare('SELECT id FROM media WHERE id=?').get(id),'یکی از فایل‌های اصلی در دسترس نیست.');
     const post={...previous,id:randomUUID(),channels,scheduled_at:null,status:'draft',version:1,archived_at:null,deleted_at:null,library_revision:0,author_id:user.id,created_at:timestamp,updated_at:timestamp};
     store.transaction(()=>{store.db.prepare('INSERT INTO posts(id,type,title,library_title,fields,body,body_entities,channels,media,primary_media_id,publication_media_ids,scheduled_at,expires_at,status,version,author_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(post.id,post.type,post.title,post.library_title??null,JSON.stringify(post.fields),post.body,JSON.stringify(post.body_entities),JSON.stringify(channels),JSON.stringify(post.media),post.primary_media_id,JSON.stringify(post.publication_media_ids),null,post.expires_at,post.status,post.version,user.id,timestamp,timestamp);recordRevision(post,user.id,null);store.audit(user.id,'post.copy',post.id,{sourceId:previous.id,sourceVersion:previous.version,channels});});
     json(res,{post},201);return;
   }
   match=url.pathname.match(/^\/api\/posts\/([a-f0-9-]+)$/);
   if(req.method==='PUT'&&match){
     const data=await body(req),previous=findPost(match[1],user);editAllowed(previous,user);check(data.version===previous.version,'این محتوا توسط شخص دیگری تغییر کرده است؛ صفحه را تازه‌سازی کنید.',409);
     const fields=validateFields(data.type,data.fields);const title=postTitle(data.type,data.title,fields);const channels=selectedChannels(data.channels,user);const media=Array.isArray(data.media)?[...new Set(data.media)]:[];check(media.length<=8,'حداکثر ۸ فایل انتخاب کنید.');
     for(const id of media)check(previous.media.includes(id)||store.db.prepare('SELECT id FROM media WHERE id=? AND owner_id=?').get(id,user.id),'فایل در دسترس نیست.',403);
     const mediaRequest=generationRequest(data.media_request,media),publicationIds=publicationSelection(data,media);const document=prepareDocument(data,title,fields,store.settings(),previous.title);check(document.body||publicationIds.length,'متن پیام یا یک رسانه را وارد کنید.');const post={...previous,type:data.type,title,library_title:data.type==='free'?title:previous.library_title,fields,channels,media,primary_media_id:publicationIds[0]||null,publication_media_ids:publicationIds,body:document.body,body_entities:document.entities,scheduled_at:dateValue(data.scheduled_at),expires_at:dateValue(data.expires_at),status:'draft',version:previous.version+1,updated_at:now()};
     store.transaction(()=>{const result=store.db.prepare(`UPDATE posts SET type=?,title=?,library_title=?,fields=?,body=?,body_entities=?,channels=?,media=?,primary_media_id=?,publication_media_ids=?,scheduled_at=?,expires_at=?,status=?,version=?,updated_at=? WHERE id=? AND version=? AND status IN ('draft','ready') AND archived_at IS NULL AND deleted_at IS NULL`).run(post.type,title,post.library_title??null,JSON.stringify(fields),post.body,JSON.stringify(post.body_entities),JSON.stringify(channels),JSON.stringify(media),post.primary_media_id,JSON.stringify(post.publication_media_ids),post.scheduled_at,post.expires_at,'draft',post.version,post.updated_at,post.id,previous.version);check(result.changes===1,'نسخهٔ محتوا تغییر کرده است.',409);cancelScheduled(store,post.id);saveGeneration(post,mediaRequest);recordRevision(post,user.id,mediaRequest);store.audit(user.id,'post.update',post.id,{version:post.version});});json(res,{post});return;
   }
   match=url.pathname.match(/^\/api\/posts\/([a-f0-9-]+)\/publish$/);
   if(req.method==='POST'&&match){
     publishing(user);const data=await body(req),post=findPost(match[1],user);selectedChannels(post.channels,user);
     check(Number.isSafeInteger(data.version),'نسخهٔ محتوا معتبر نیست.');
     json(res,await publishingService.publish(post.id,data.version,user.id));return;
   }
   match=url.pathname.match(/^\/api\/posts\/([a-f0-9-]+)\/(ready|draft|archive)$/);
   if(req.method==='POST'&&match){
     const data=await body(req),post=findPost(match[1],user);if(match[2]==='archive'){json(res,changePostLibrary(store,user,'archive',[{id:post.id,version:data.version,library_revision:data.library_revision}]));return;}if(match[2]==='ready')publishing(user);else editAllowed(post,user);
     check(libraryState(post)==='active','ابتدا محتوا را به کتابخانه برگردانید');
     selectedChannels(post.channels,user);if(match[2]==='ready'){json(res,queuePublication(store,post,user,data.version));return;}
     store.transaction(()=>{store.db.prepare("UPDATE posts SET status='draft',updated_at=? WHERE id=?").run(now(),post.id);cancelScheduled(store,post.id);store.audit(user.id,'post.draft',post.id);});json(res,{ok:true});return;
   }
   if(req.method==='DELETE'&&url.pathname==='/api/brand/logo'){admin(user);store.saveSettings({...store.settings(),brandLogoId:''});store.audit(user.id,'brand.logo',workspace.id,{removed:true});json(res,{ok:true});return;}
   if(req.method==='POST'&&['/api/media','/api/brand/logo'].includes(url.pathname)){
     const logoUpload=url.pathname==='/api/brand/logo';if(logoUpload)admin(user);else writing(user);check((req.headers['content-type']||'').startsWith('multipart/form-data'),'فایل معتبر انتخاب کنید.');const raw=await buffer(req,(logoUpload?3:30)*1024*1024);const request=new Request('http://localhost/upload',{method:'POST',headers:{'Content-Type':req.headers['content-type']},body:raw});const form=await request.formData();const file=form.get('file');check(file&&typeof file.arrayBuffer==='function','فایل انتخاب نشده است.');check(file.size>0&&file.size<=25*1024*1024,'حجم هر فایل باید کمتر از ۲۵ مگابایت باشد.');
     if(logoUpload)check(file.size<=2*1024*1024&&['image/png','image/jpeg','image/webp'].includes(file.type),'لوگو باید تصویر PNG، JPG یا WebP با حجم حداکثر ۲ مگابایت باشد');const data=Buffer.from(await file.arrayBuffer());const formats={ 'image/jpeg':{ext:'.jpg',valid:data[0]===255&&data[1]===216},'image/png':{ext:'.png',valid:data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))},'image/webp':{ext:'.webp',valid:data.toString('ascii',0,4)==='RIFF'&&data.toString('ascii',8,12)==='WEBP'},'video/mp4':{ext:'.mp4',valid:data.toString('ascii',4,8)==='ftyp'}};
     const format=formats[file.type];check(format?.valid,'فقط تصویر JPG، PNG، WebP یا ویدئوی MP4 معتبر پذیرفته می‌شود.');const id=randomUUID();const folder=path.join(store.directory,'media');fs.mkdirSync(folder,{recursive:true});const filePath=path.join(folder,id+format.ext);fs.writeFileSync(filePath,data,{flag:'wx',mode:0o600});store.db.prepare('INSERT INTO media VALUES(?,?,?,?,?,?,?)').run(id,path.join('media',id+format.ext),path.basename(file.name).slice(0,200),file.type,file.size,user.id,now());if(logoUpload){store.saveSettings({...store.settings(),brandLogoId:id});store.audit(user.id,'brand.logo',workspace.id,{mediaId:id});}json(res,{media:{id,name:path.basename(file.name),mime:file.type,size:file.size}},201);return;
   }
   if(req.method==='GET'&&url.pathname==='/api/users'){admin(user);json(res,{users:store.db.prepare('SELECT * FROM users ORDER BY created_at').all().map(publicUser)});return;}
   if(req.method==='POST'&&url.pathname==='/api/users'){
     admin(user);const data=await body(req),identity=validateIdentity(data);check(roles.includes(data.role),'نقش معتبر انتخاب کنید');const channels=selectedChannels(data.channels,user),id=workspaces.addMember(workspace.id,identity,data.role,channels);store.audit(user.id,'user.create',id,{role:data.role});json(res,{ok:true},201);return;
   }
   match=url.pathname.match(/^\/api\/users\/([a-f0-9-]+)$/);
   if(req.method==='PUT'&&match){
     admin(user);const data=await body(req);const target=store.db.prepare('SELECT * FROM users WHERE id=?').get(match[1]);check(target,'کاربر پیدا نشد.',404);check(roles.includes(data.role),'نقش معتبر نیست.');check(typeof data.active==='boolean','وضعیت کاربر معتبر نیست.');const channels=selectedChannels(data.channels,user);check(!data.password,'رمز حساب اصلی را فقط خود صاحب حساب تغییر می دهد');store.transaction(()=>{
       if(target.role==='admin'&&(!data.active||data.role!=='admin'))check(store.db.prepare("SELECT count(*) AS n FROM users WHERE role='admin' AND active=1").get().n>1,'آخرین مدیر فعال را نمی‌توان غیرفعال یا تنزل نقش داد.');
       store.db.prepare('UPDATE users SET name=?,role=?,channels=?,active=? WHERE id=?').run(text(data.name||target.name,100),data.role,JSON.stringify(channels),Number(data.active),target.id);

       if(!data.active)workspaces.revokeBrandSelection(workspace.id,target.id);store.audit(user.id,'user.update',target.id,{role:data.role,active:data.active});
     });json(res,{ok:true});return;
   }
   if(req.method==='PUT'&&url.pathname==='/api/settings'){
     admin(user);const data=await body(req);const current=store.settings();const settings={...current,projectName:appName,brand:text(data.brand||'',120),contact:text(data.contact??current.contact??'',2000),contacts:normalizeContacts(data.contacts??current.contacts),website:httpUrl(data.website||''),currency:text(data.currency||'تومان',30)};
     store.saveSettings(settings);if(settings.brand)workspaces.rename(workspace.id,user,settings.brand);store.audit(user.id,'settings.update',null,{brand:settings.brand,currency:settings.currency});json(res,{ok:true});return;
   }
   match=url.pathname.match(/^\/api\/channels\/(telegram|bale|rubika|eitaa)$/);
   if(req.method==='PUT'&&match){
     admin(user);const data=await body(req);saveChannelSettings(store,match[1],data,user.id);json(res,{ok:true});return;
   }
   match=url.pathname.match(/^\/api\/channels\/(telegram|bale|rubika|eitaa)\/(connect|check-access|test)$/);
   if(req.method==='POST'&&match){
     admin(user);const data=await body(req);const detail=match[2]==='connect'?await channelVerifier.connect(match[1],data,user.id):await channelVerifier.verify(match[1],user.id);
     json(res,match[2]==='test'?{...detail,diagnostic:detail}:detail);return;
   }
   if(req.method==='GET'&&url.pathname==='/api/export'){
     const state=snapshot(user);const rows=[['شناسه','عنوان','نوع','وضعیت','سازنده','زمان پیشنهادی انتشار','نسخه'],...state.posts.filter(p=>!p.deleted_at).map(p=>[p.id,p.library_title||p.title,typeNames[p.type],libraryState(p)==='archived'?'archived':p.status,p.author_name,p.scheduled_at||'',p.version])];const csv='\uFEFF'+rows.map(row=>row.map(v=>'"'+String(v).replace(/^[=+\-@\t\r]/,"'$&").replaceAll('"','""')+'"').join(',')).join('\r\n');res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="content-desk.csv"','Cache-Control':'no-store'});res.end(csv);return;
   }
   check(false,'این مسیر پیدا نشد.',404);
 }
 if(url.pathname.startsWith('/media/')){
   check(user,'ابتدا وارد شوید.',401);const id=url.pathname.slice(7);check(/^[a-f0-9-]{36}$/.test(id),'فایل پیدا نشد.',404);const media=store.db.prepare('SELECT * FROM media WHERE id=?').get(id);check(media,'فایل پیدا نشد.',404);
   const permitted=store.settings().brandLogoId===id||user.role==='admin'||media.owner_id===user.id||store.db.prepare('SELECT * FROM posts WHERE EXISTS(SELECT 1 FROM json_each(posts.media) WHERE value=?)').all(id).map(publicPost).some(post=>visible(post,user));check(permitted,'اجازهٔ مشاهدهٔ این فایل را ندارید.',403);const filePath=path.join(store.directory,'media',path.basename(media.path));check(fs.existsSync(filePath),'فایل رسانه در محل ذخیره‌سازی پیدا نشد.',404);streamMedia(req,res,filePath,media);return;
 }
 check(req.method==='GET'||req.method==='HEAD','روش درخواست مجاز نیست.',405);
 const assets={'/':'index.html','/index.html':'index.html','/app.js':'app.js','/guidance.js':'guidance.js','/caption-template.js':'caption-template.js','/account-ui.js':'account-ui.js','/navigation.js':'navigation.js','/settings-accordion.js':'settings-accordion.js','/workspace-picker.js':'workspace-picker.js','/contacts.js':'contacts.js','/media.js':'media.js','/rich-text.js':'rich-text.js','/rich-editor.js':'rich-editor.js','/style.css':'style.css','/fonts/Vazirmatn-Variable.woff2':'fonts/Vazirmatn-Variable.woff2'};
 for(const platform of platforms)assets['/logos/'+platform+'.svg']='logos/'+platform+'.svg';
 assets['/logos/bale.png']='logos/bale.png';assets['/logos/rubika.ico']='logos/rubika.ico';
 assets['/post-library.js']='post-library.js';
 const name=assets[url.pathname];check(name,'صفحه پیدا نشد.',404);const file=path.join(root,'public',name);res.writeHead(200,{'Content-Type':mimeTypes[path.extname(file)],'Cache-Control':'no-cache'});if(req.method==='HEAD')res.end();else fs.createReadStream(file).pipe(res);
}

return {route,scheduler};
}
const workspaces=createWorkspaces(path.resolve(process.env.DATA_DIR||path.join(root,'data')),createWorkspaceRuntime);
const accountRouter=createAccountRouter(workspaces,{host,publicUrl,limited});
const server=http.createServer(async(req,res)=>{
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
 try{
   check(allowedHosts.has(req.headers.host||''),'نام میزبان مجاز نیست.',403);
   if(!['GET','HEAD','OPTIONS'].includes(req.method)&&req.headers.origin){const ownOrigin=`http${process.env.COOKIE_SECURE==='true'?'s':''}://${req.headers.host}`;check(req.headers.origin===ownOrigin||req.headers.origin===publicUrl?.origin,'مبدأ درخواست مجاز نیست.',403);}
   const url=new URL(req.url,'http://localhost');
   if(req.method==='GET'&&url.pathname==='/healthz'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({ok:true,version:appVersion}));return;}
   const auth=accountRouter.context(session(workspaces.accounts.store,req));
   if(req.headers['x-workspace-id'])check(req.headers['x-workspace-id']===auth?.workspaceId,'برند فعال در تب دیگری تغییر کرده است؛ صفحه را تازه کنید',409);
   if(await accountRouter.route(req,res,url,auth))return;
   if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/media/')){check(auth,'ابتدا وارد حساب خود شوید',401);check(auth.workspaceId,'ابتدا یک برند بسازید یا انتخاب کنید',403);}
   await workspaces.runtime(auth?.workspaceId||'default').route(req,res,url,auth);
 }catch(error){if(!res.headersSent){const status=error.status||500;res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify({error:status===500?'در پردازش درخواست خطایی رخ داد.':error.message}));if(status===500)console.error('Request failed:',error.code||error.name);}else res.destroy();}
});
server.requestTimeout=35000;server.headersTimeout=15000;
let scheduleTimer,tickPromise=null,closing=false;
function tick(){
 if(closing||tickPromise)return;
 tickPromise=Promise.allSettled(workspaces.all().map(async id=>workspaces.runtime(id).scheduler.runDue())).then(results=>{if(results.some(result=>result.status==='rejected'))console.error('Scheduled publication check failed');}).finally(()=>{tickPromise=null;});
}
server.listen(port,host,()=>{console.log(`Content Desk: http://${host}:${port}`);tick();scheduleTimer=setInterval(tick,5000);scheduleTimer.unref();});
async function close(){
 if(closing)return;closing=true;clearInterval(scheduleTimer);
 const disconnected=new Promise(resolve=>server.close(resolve));
 await Promise.all([disconnected,...workspaces.all().map(id=>workspaces.runtime(id).scheduler.stop())]);workspaces.close();process.exit(0);
}
process.on('SIGTERM',close);process.on('SIGINT',close);

