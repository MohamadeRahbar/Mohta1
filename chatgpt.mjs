import {randomBytes,randomUUID,createHash,createPublicKey,verify} from 'node:crypto';
import {requestJson} from './network.mjs';
import {resolveNetworkRoute} from './system-network.mjs';
import {check} from './content.mjs';

const issuer='https://auth.openai.com',resource='https://api.openai.com/v1';
const scope='openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const random=()=>randomBytes(32).toString('base64url');
const directEfforts=['none','minimal','low','medium','high','xhigh','max'];
export function modelPreferences(model){
 const advertised=Array.isArray(model.supported_reasoning_levels)?model.supported_reasoning_levels.map(level=>typeof level==='string'?level:level?.effort):[];
 const efforts=directEfforts.filter(effort=>advertised.includes(effort));
 return {efforts,defaultEffort:efforts.includes('low')?'low':efforts.includes(model.default_reasoning_level)?model.default_reasoning_level:'',unavailableEfforts:advertised.includes('ultra')?['ultra']:[]};
}
const fail=(message,status=400)=>{const error=new Error(message);error.status=status;throw error;};
function planAllowed(scopes){return scopes.includes('resource.invoke')&&scopes.includes('chatgpt.tokens.use.direct');}

export function verifyOpenAIIdentity(token,{jwks,clientId,nonce,subject,now=Date.now()}){
 try{
   const parts=token.split('.');check(parts.length===3,'Invalid JWT');
   const header=JSON.parse(Buffer.from(parts[0],'base64url')),claims=JSON.parse(Buffer.from(parts[1],'base64url'));
   check(['RS256','ES256'].includes(header.alg)&&typeof header.kid==='string','Invalid JWT algorithm');
   const jwk=jwks.keys.find(key=>key.kid===header.kid&&(!key.alg||key.alg===header.alg)&&(!key.use||key.use==='sig'));check(jwk,'Unknown JWT key');
   check((header.alg==='RS256'&&jwk.kty==='RSA')||(header.alg==='ES256'&&jwk.kty==='EC'&&jwk.crv==='P-256'),'Invalid JWT key');
   const key=createPublicKey({key:jwk,format:'jwk'});
   check(verify('sha256',Buffer.from(parts[0]+'.'+parts[1]),{key,...(header.alg==='ES256'?{dsaEncoding:'ieee-p1363'}:{})},Buffer.from(parts[2],'base64url')),'Invalid JWT signature');
   const time=now/1000;
   check(claims.iss===issuer&&(Array.isArray(claims.aud)?claims.aud.includes(clientId):claims.aud===clientId),'Invalid JWT issuer or audience');
   check(Number.isFinite(claims.exp)&&claims.exp>time-5&&Number.isFinite(claims.iat)&&claims.iat>=0&&claims.iat<=time+5&&claims.iat<claims.exp&&(claims.nbf===undefined||(Number.isFinite(claims.nbf)&&claims.nbf<=time+5)),'Invalid JWT time');
   check(claims.nonce===nonce&&typeof claims.sub==='string'&&claims.sub.length>0&&(!subject||claims.sub===subject),'Invalid JWT identity');
   return {subject:claims.sub,email:typeof claims.email==='string'?claims.email:'',name:typeof claims.name==='string'?claims.name:''};
 }catch{fail('هویت حساب ChatGPT قابل تأیید نیست؛ اتصال را دوباره آغاز کنید.');}
}

export function parseResponseStream(raw){
 let output='',completed=false,finalOutput='';
 for(const block of raw.split(/\r?\n\r?\n/)){
   const data=block.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');if(!data||data==='[DONE]')continue;
   let event;try{event=JSON.parse(data);}catch{fail('پاسخ تولید متن کامل دریافت نشد؛ پیشنهاد روی پست اعمال نشد.',502);}
   if(event.type==='response.output_text.delta')output+=event.delta||'';
   if(['response.failed','response.incomplete','error'].includes(event.type))fail('تولید متن کامل نشد؛ محدودیت حساب یا درخواست را بررسی کنید.',502);
   if(event.type==='response.completed'){
     check(event.response?.status==='completed','تولید متن کامل نشد؛ پیشنهاد روی پست اعمال نشد.',502);
     completed=true;finalOutput=(event.response?.output||[]).flatMap(item=>item.content||[]).filter(item=>item.type==='output_text').map(item=>item.text||'').join('\n');
   }
 }
 check(completed,'پاسخ تولید متن قطع شد؛ پیشنهاد روی پست اعمال نشد.',502);
 const text=(finalOutput||output).trim();check(text&&text.length<=15000,'پاسخ متنی خالی یا بیش از اندازه است.',502);return text;
}

export function createChatGPTService(store,{port,request=requestJson,resolveRoute=resolveNetworkRoute,now=Date.now}={}){
 const pending=new Map(),refreshing=new Map(),generating=new Set(),catalogs=new Map(),epochs=new Map();
 const key=id=>'ai:chatgpt:'+id,registrationKey=id=>'ai:registration:'+id;
 function read(name){const value=store.secret(name);return value?JSON.parse(value):null;}
 async function remote(url,options={}){
   check(['auth.openai.com','api.openai.com'].includes(new URL(url).hostname)&&new URL(url).protocol==='https:','مقصد اتصال هوش مصنوعی معتبر نیست.');
   try{const route=await resolveRoute({route:'direct'},url);return await request(url,{...options,proxy:route.proxy||'',timeout:options.timeout||15000});}
   catch{fail('اتصال به OpenAI برقرار نشد؛ پیشنهاد یا تنظیمات قبلی حفظ شدند.',502);}
 }
 function responseOK(response){
   if(response.status===401)fail('دسترسی حساب منقضی یا لغو شده است؛ دوباره به ChatGPT متصل شوید.',400);
   if(response.status===403)fail('حساب یا این برنامه مجوز استفاده از این قابلیت را ندارد. دسترسی را در ChatGPT بررسی کنید.',400);
   if(response.status===429)fail('سهمیه یا محدودیت درخواست حساب اعمال شده است؛ بعداً دوباره تلاش کنید.',429);
   check(response.status>=200&&response.status<300,'OpenAI درخواست را نپذیرفت؛ اتصال یا دسترسی حساب را بررسی کنید.',502);
 }
 async function form(url,values){const response=await remote(url,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},rawBody:new URLSearchParams(values).toString()});responseOK(response);return response.data;}
 function status(userId){
   const saved=read(key(userId)),model=store.secret('ai:model:'+userId)||'',efforts=read('ai:efforts:'+userId)||{};return {connected:!!saved,canGenerate:!!saved&&planAllowed(saved.scopes||[]),profile:saved?{email:saved.email,name:saved.name}:null,model,effort:efforts[model]||'',effortsByModel:efforts};
 }
 function start(user,{sessionHash}={}){
   for(const [state,attempt] of pending)if(attempt.expires<=now()||attempt.userId===user.id)pending.delete(state);
   let hostId=store.secret('ai:host-id');if(!hostId){hostId='urn:uuid:'+randomUUID();store.saveSecret('ai:host-id',hostId);}
   const registration=read(registrationKey(user.id)),state=random(),nonce=random(),verifier=random(),redirectUri='http://127.0.0.1:'+port+'/auth/callback';
   const epoch=(epochs.get(user.id)||0)+1;epochs.set(user.id,epoch);
   const attempt={userId:user.id,sessionHash,state,nonce,verifier,redirectUri,hostId,registration,epoch,expires:now()+10*60*1000};pending.set(state,attempt);
   const url=new URL(issuer+'/api/accounts/authorize');
   const params={client_id:registration?.clientId||'dynamic_agent_client',ext_agent_host_id:hostId,response_type:'code',redirect_uri:redirectUri,scope,resource,state,nonce,code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url')};
   if(!registration)params.agent_name_hint='Content Desk';
   for(const [name,value] of Object.entries(params))url.searchParams.set(name,value);
   return {url:url.href,expiresAt:new Date(attempt.expires).toISOString()};
 }
 async function complete(params,validateOwner){
   const state=params.get('state'),attempt=pending.get(state);check(attempt&&attempt.expires>now(),'این درخواست اتصال منقضی یا نامعتبر است؛ از پنل دوباره شروع کنید.');pending.delete(state);
   check(validateOwner(attempt),'نشست پنل معتبر نیست؛ وارد پنل شوید و اتصال را دوباره آغاز کنید.');
   check(!params.get('error'),'اجازهٔ اتصال داده نشد؛ حساب قبلی حفظ شد.');
   const clientId=params.get('client_id')||attempt.registration?.clientId;
   check(clientId&&/^oaiapp_[A-Za-z0-9_-]+$/.test(clientId),'شناسهٔ ثبت برنامه از OpenAI دریافت نشد.');
   check(!attempt.registration||clientId===attempt.registration.clientId,'ثبت حساب با درخواست آغازشده هماهنگ نیست.');
   const code=params.get('code');check(code&&code.length<8000,'کد ورود معتبر دریافت نشد.');
   const tokens=await form(issuer+'/api/accounts/oauth/token',{grant_type:'authorization_code',client_id:clientId,code,code_verifier:attempt.verifier,redirect_uri:attempt.redirectUri,resource});
   const response=await remote(issuer+'/.well-known/jwks.json');responseOK(response);
   const identity=verifyOpenAIIdentity(tokens?.id_token,{jwks:response.data,clientId,nonce:attempt.nonce,subject:attempt.registration?.subject,now:now()});
   check(tokens.token_type?.toLowerCase()==='bearer'&&typeof tokens.access_token==='string'&&tokens.access_token&&Number.isFinite(tokens.expires_in)&&tokens.expires_in>0,'اطلاعات دسترسی معتبر دریافت نشد.');
   const saved={...identity,clientId,hostId:attempt.hostId,accessToken:tokens.access_token,refreshToken:tokens.refresh_token||'',idToken:tokens.id_token,scopes:typeof tokens.scope==='string'?tokens.scope.split(/\s+/):[],expiresAt:now()+tokens.expires_in*1000};
   check(validateOwner(attempt)&&epochs.get(attempt.userId)===attempt.epoch,'نشست یا درخواست اتصال در حین ورود تغییر کرد؛ دوباره شروع کنید.');
   store.transaction(()=>{store.saveSecret(key(attempt.userId),JSON.stringify(saved));store.saveSecret(registrationKey(attempt.userId),JSON.stringify({...identity,clientId}));store.saveSecret('ai:model:'+attempt.userId,'');store.audit(attempt.userId,'ai.connect',null,{canGenerate:planAllowed(saved.scopes)});});catalogs.delete(attempt.userId);
   return {userId:attempt.userId,...status(attempt.userId)};
 }
 async function credentials(userId){
   const saved=read(key(userId));check(saved,'ابتدا حساب ChatGPT را متصل کنید.');check(planAllowed(saved.scopes||[]),'مجوز استفاده از سهمیهٔ ChatGPT داده نشده است؛ دوباره متصل شوید و مجوز را بررسی کنید.');
   if(saved.expiresAt>now()+60000)return saved;
   if(refreshing.has(userId))return refreshing.get(userId);
   const task=(async()=>{
     check(saved.refreshToken,'دسترسی منقضی شده است؛ دوباره به ChatGPT متصل شوید.');const old=store.secret(key(userId));
     const tokens=await form(issuer+'/api/accounts/oauth/token',{grant_type:'refresh_token',client_id:saved.clientId,refresh_token:saved.refreshToken,resource});
     check(tokens?.access_token&&tokens.token_type?.toLowerCase()==='bearer'&&Number.isFinite(tokens.expires_in)&&tokens.expires_in>0,'تمدید دسترسی کامل نشد؛ دوباره متصل شوید.');
     const updated={...saved,accessToken:tokens.access_token,refreshToken:tokens.refresh_token||saved.refreshToken,scopes:typeof tokens.scope==='string'?tokens.scope.split(/\s+/):saved.scopes,expiresAt:now()+tokens.expires_in*1000};
     store.transaction(()=>{check(store.secret(key(userId))===old,'اتصال در حین تمدید تغییر کرد؛ دوباره تلاش کنید.');store.saveSecret(key(userId),JSON.stringify(updated));});check(planAllowed(updated.scopes),'مجوز تولید متن در حساب فعال نیست.');return updated;
   })();refreshing.set(userId,task);try{return await task;}finally{refreshing.delete(userId);}
 }
 async function models(userId){
   const epoch=epochs.get(userId),saved=await credentials(userId),cached=catalogs.get(userId);if(cached&&cached.expires>now()&&cached.subject===saved.subject&&cached.clientId===saved.clientId)return cached.models;
   const response=await remote(resource+'/models',{headers:{Authorization:'Bearer '+saved.accessToken}});responseOK(response);
   check(Array.isArray(response.data?.models),'فهرست مدل‌های حساب قابل دریافت نیست.',502);
   const list=response.data.models.filter(model=>model.visibility==='list'&&typeof model.slug==='string'&&model.slug.length<150).map(model=>({id:model.slug,name:String(model.display_name||model.slug).slice(0,150),...modelPreferences(model)}));check(list.length,'مدلی برای این حساب در دسترس نیست.');
   check(epochs.get(userId)===epoch&&read(key(userId))?.subject===saved.subject,'اتصال حساب در حین دریافت مدل‌ها تغییر کرد؛ دوباره تلاش کنید.');
   catalogs.set(userId,{models:list,subject:saved.subject,clientId:saved.clientId,expires:now()+300000});return list;
 }
 async function selectModel(userId,model,effort){
   const list=await models(userId),selected=list.find(item=>item.id===model);check(selected,'مدل انتخابی برای این حساب در دسترس نیست.');
   const preferences=read('ai:efforts:'+userId)||{},choice=effort===undefined?(preferences[model]??selected.defaultEffort):effort;
   check(typeof choice==='string'&&(!choice||selected.efforts.includes(choice)),'این میزان تلاش در اتصال فعلی این مدل پشتیبانی نمی‌شود.');
   store.transaction(()=>{store.saveSecret('ai:model:'+userId,model);store.saveSecret('ai:efforts:'+userId,JSON.stringify({...preferences,[model]:choice}));store.audit(userId,'ai.preference',null,{model,effort:choice||'default'});});return status(userId);
 }
 async function generate(userId,prompt){
   check(!generating.has(userId),'یک درخواست تولید در حال اجراست؛ تا پایان آن صبر کنید.',409);generating.add(userId);
   try{
     const list=await models(userId),model=store.secret('ai:model:'+userId)||list[0].id,selected=list.find(item=>item.id===model);check(selected,'مدل قبلی در دسترس نیست؛ مدل دیگری انتخاب کنید.');
     const effort=(read('ai:efforts:'+userId)||{})[model]??selected.defaultEffort;
     check(!effort||selected.efforts.includes(effort),'میزان تلاش قبلی در دسترس نیست؛ آن را دوباره انتخاب کنید.');
     const saved=await credentials(userId),response=await remote(resource+'/responses',{method:'POST',headers:{Authorization:'Bearer '+saved.accessToken,Accept:'text/event-stream'},body:{model,...(effort?{reasoning:{effort}}:{}),input:[{role:'user',content:prompt}],store:false,stream:true},responseType:'text',timeout:60000});responseOK(response);
     const text=parseResponseStream(response.raw||'');store.audit(userId,'ai.generate',null,{model,effort:effort||'default'});return {text,model,effort};
   }finally{generating.delete(userId);}
 }
 async function disconnect(userId){
   epochs.set(userId,(epochs.get(userId)||0)+1);
   for(const [state,attempt] of pending)if(attempt.userId===userId)pending.delete(state);
   const saved=read(key(userId));store.saveSecret(key(userId),'');store.saveSecret('ai:model:'+userId,'');catalogs.delete(userId);let remoteRevoked=false;
   if(saved?.refreshToken)try{
     const discovery=await remote(issuer+'/.well-known/openid-configuration');responseOK(discovery);const endpoint=discovery.data?.revocation_endpoint;
     check(endpoint&&new URL(endpoint).origin===issuer,'Invalid revocation endpoint');await form(endpoint,{token:saved.refreshToken,token_type_hint:'refresh_token',client_id:saved.clientId});remoteRevoked=true;
   }catch{}
   store.audit(userId,'ai.disconnect',null,{remoteRevoked});return {ok:true,remoteRevoked,message:remoteRevoked?'اتصال حساب قطع شد.':'اتصال در پنل قطع شد؛ لغو دسترسی در OpenAI تأیید نشد. اتصال برنامه را در تنظیمات ChatGPT هم می‌توانید قطع کنید.'};
 }
 return {status,start,complete,models,selectModel,generate,disconnect};
}
