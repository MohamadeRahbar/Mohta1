import {publicUser,defaultSettings} from './store.mjs';
import {defaultCta,check,text} from './content.mjs';
import {startSession,endSession,safeEqual,cookies,appendCookie} from './auth.mjs';
import {createRememberedDevices} from './remembered-device.mjs';
import {resetPassword,changePassword} from './recovery.mjs';
import {createVerification,deliveryAdapter,identifier} from './accounts.mjs';
export function json(res,value,status=200){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));}
export async function buffer(req,limit=1024*1024){let length=0;const parts=[];for await(const chunk of req){length+=chunk.length;check(length<=limit,'حجم درخواست بیش از حد مجاز است',413);parts.push(chunk);}return Buffer.concat(parts);}
export async function body(req){check((req.headers['content-type']||'').startsWith('application/json'),'درخواست باید JSON باشد',415);let value;try{value=JSON.parse((await buffer(req)).toString('utf8'));}catch(error){if(error.status)throw error;check(false,'درخواست خوانا نیست');}check(value&&typeof value==='object'&&!Array.isArray(value),'بدنه درخواست معتبر نیست');return value;}
export function createAccountRouter(workspaces,{host,publicUrl,limited}){
 const accounts=workspaces.accounts,store=accounts.store,delivery=deliveryAdapter(),remembered=createRememberedDevices(accounts);
 const localMode=['127.0.0.1','localhost','::1'].includes(host)&&!publicUrl&&!delivery&&[undefined,'local'].includes(process.env.REGISTRATION_MODE);
 const verification=createVerification(accounts,{localMode,deliverCode:delivery,registrationAllowed:process.env.REGISTRATION_MODE!=='disabled',methods:(process.env.VERIFICATION_METHODS||'email,phone').split(',').filter(x=>['email','phone'].includes(x))});
 function rate(req,operation,max=12){const key=operation+':'+(req.socket.remoteAddress||'unknown');let entry=limited.get(key);if(!entry||entry.until<Date.now())entry={count:0,until:Date.now()+15*60*1000};entry.count++;limited.set(key,entry);check(entry.count<=max,'تلاش های زیادی انجام شده است؛ ۱۵ دقیقه بعد دوباره امتحان کنید',429);}
 function context(identity){
  if(!identity)return null;
  const workspaceId=identity.workspace_id;
  const member=workspaceId?workspaces.member(workspaceId,identity.id):null;
  if(workspaceId&&!member){store.db.prepare('UPDATE sessions SET workspace_id=NULL WHERE token_hash=?').run(identity.token_hash);identity.workspace_id=null;}
  return {identity,workspaceId:member?workspaceId:null,user:member?{...member,csrf:identity.csrf,token_hash:identity.token_hash}:null};
 }
 function begin(account,res,preferred,rememberDeviceId){const list=workspaces.accessible(account.id),workspaceId=list.find(w=>w.id===preferred)?.id||list[0]?.id||null;const csrf=startSession(store,account.id,res,{workspaceId,rememberDeviceId});return {account:accounts.publicAccount(account),csrf,workspace:list.find(w=>w.id===workspaceId)||null};}
 function beginFresh(account,req,res,preferred){const login=begin(account,res,preferred);remembered.forget(req,res,{consent:false});return login;}
 function bootstrap(auth){const id=auth?.workspaceId,tenant=id?workspaces.get(id):null,identity=auth?.identity,member=auth?.user;return {workspace:tenant?{id,name:tenant.row.name}:{id:null,name:'حساب اصلی'},projectName:tenant?.store.settings().projectName||'محتوان',setupNeeded:!store.db.prepare('SELECT id FROM users LIMIT 1').get(),requiresSetupToken:false,user:identity?publicUser(member||{...identity,role:identity.can_create_brands?'admin':'viewer',channels:'[]'}):null,account:accounts.publicAccount(identity),csrf:identity?.csrf,registration:verification.status()};}
 function accountState(auth){const base=bootstrap(auth);return {...base,workspaces:workspaces.accessible(auth.identity.id),settings:{...defaultSettings,projectName:'محتوان'},channels:[],posts:[],mediaMap:{},audit:[],copyDefaults:{cta:defaultCta},phase:'account',ai:{connected:false,canGenerate:false},capabilities:{workspaces:true,needsBrand:true,canCreateBrands:!!auth.identity.can_create_brands},publicationCount:0};}
 function accountInfo(identity){return {account:accounts.publicAccount(identity),verification:verification.status()};}
 function choose(auth,res,id){const list=workspaces.accessible(auth.identity.id),workspace=list.find(w=>w.id===id);check(workspace,'به این برند دسترسی ندارید',403);store.db.prepare('UPDATE sessions SET workspace_id=? WHERE token_hash=?').run(id,auth.identity.token_hash);res.setHeader('Set-Cookie',`desk_workspace=${id}; Path=/; HttpOnly; SameSite=Strict${process.env.COOKIE_SECURE==='true'?'; Secure':''}`);return {ok:true,workspace,csrf:auth.identity.csrf};}
 async function route(req,res,url,auth){
  const endpoint=url.pathname,anonymous=['/api/setup','/api/login','/api/accounts/register','/api/accounts/verify','/api/auth/forgot','/api/auth/recover','/api/auth/reset','/api/login/remembered','/api/auth/remember/forget'];
  if(endpoint.startsWith('/api/')&&!['GET','HEAD'].includes(req.method)&&auth&&!anonymous.includes(endpoint))check(safeEqual(req.headers['x-csrf-token']||'',auth.identity.csrf),'درخواست معتبر نیست؛ صفحه را تازه کنید',403);
  if(req.method==='GET'&&endpoint==='/api/bootstrap'){
   let saved=remembered.find(req);
   if(!auth&&saved?.auto_login===1){rate(req,'remember-login',30);const grant=remembered.resume(req),login=begin(grant.account,res,cookies(req).desk_workspace,grant.id);remembered.write(res,grant);auth=context({...grant.account,csrf:login.csrf,workspace_id:login.workspace?.id||null});saved=null;}
   if(saved&&(!auth||saved.user_id===auth.identity.id))remembered.renew(req,res,saved);
   json(res,{...bootstrap(auth),remembered:!auth?remembered.summary(saved):null});return true;
  }
  if(req.method==='POST'&&endpoint==='/api/login'){
   rate(req,'login');const data=await body(req),account=accounts.authenticate(data.username||data.identifier,data.password),grant=data.remember===true?remembered.create(req,account):null,login=begin(account,res,cookies(req).desk_workspace,grant?.id);
   if(grant)remembered.write(res,grant);else remembered.forget(req,res,{consent:false});json(res,login);return true;
  }
  if(req.method==='POST'&&endpoint==='/api/login/remembered'){rate(req,'remember-login',30);await body(req);check(!auth,'ابتدا از حساب فعلی خارج شوید.',409);const grant=remembered.resume(req,{explicit:true}),login=begin(grant.account,res,cookies(req).desk_workspace,grant.id);remembered.write(res,grant);json(res,login);return true;}
  if(req.method==='POST'&&endpoint==='/api/auth/remember/forget'){await body(req);remembered.forget(req,res);json(res,{ok:true});return true;}
  if(req.method==='POST'&&endpoint==='/api/setup'){
   rate(req,'login');check(!store.db.prepare('SELECT id FROM users LIMIT 1').get(),'مدیر قبلا ساخته شده است',409);
   const localHost=/^(localhost|127\.0\.0\.1|\[::1\]):/.test(req.headers.host||''),localPeer=['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress),data=await body(req);
   if(!(localHost&&localPeer))check(process.env.SETUP_TOKEN&&safeEqual(data.setupToken||'',process.env.SETUP_TOKEN),'راه اندازی عمومی به کد راه اندازی سرور نیاز دارد',403);
   const login=identifier(data.username),name=text(data.name||'',100),password=text(data.password||'',200);check(name&&password.length>=12,'نام و رمز حداقل ۱۲ کاراکتری وارد کنید');
   const account=store.transaction(()=>accounts.create({username:login.value,name,password,canCreateBrands:true}));workspaces.claimDefault(account);json(res,{...beginFresh(account,req,res,'default'),user:publicUser(workspaces.member('default',account.id))});return true;
  }
  if(req.method==='POST'&&endpoint==='/api/accounts/register'){rate(req,'register',10);check(!auth,'برای ساخت حساب دیگر ابتدا خارج شوید',409);const result=await verification.register(await body(req));json(res,result.account?{...beginFresh(result.account,req,res),local:true}:result,result.account?201:202);return true;}
  if(req.method==='POST'&&endpoint==='/api/accounts/verify'){rate(req,'verify',30);const data=await body(req),account=verification.verifyRegistration(data.challengeId,data.code);json(res,beginFresh(account,req,res),201);return true;}
  if(req.method==='POST'&&endpoint==='/api/accounts/resend'){rate(req,'resend',10);const data=await body(req);json(res,await verification.resend(data.challengeId,auth?.identity.id));return true;}
  if(req.method==='POST'&&endpoint==='/api/auth/forgot'){rate(req,'forgot',6);const data=await body(req);json(res,await verification.forgot(data.contact));return true;}
  if(req.method==='POST'&&endpoint==='/api/auth/recover'){rate(req,'reset',10);const data=await body(req);const result=verification.reset(data.challengeId,data.code,data.password,data.confirmation);remembered.forget(req,res,{consent:false});json(res,{ok:true,...result});return true;}
  if(req.method==='POST'&&endpoint==='/api/auth/reset'){rate(req,'reset',10);const data=await body(req),result=resetPassword(store,data.token,data.password,data.confirmation);store.db.prepare('UPDATE verification_challenges SET used_at=? WHERE account_id=? AND used_at IS NULL').run(new Date().toISOString(),result.userId);endSession(store,req,res);remembered.forget(req,res,{consent:false});json(res,{ok:true,username:result.username});return true;}
  const protectedRoutes=['/api/account','/api/logout','/api/account/password','/api/account/contact','/api/account/contact/verify','/api/workspaces','/api/workspaces/select','/api/workspaces/default'];
  if(protectedRoutes.includes(endpoint))check(auth,'ابتدا وارد حساب خود شوید',401);
  if(req.method==='GET'&&endpoint==='/api/account'){json(res,accountInfo(auth.identity));return true;}
  if(req.method==='POST'&&endpoint==='/api/logout'){remembered.pause(req,auth.identity.id);endSession(store,req,res);appendCookie(res,'desk_workspace=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');json(res,{ok:true});return true;}
  if(req.method==='POST'&&endpoint==='/api/account/password'){const data=await body(req),oldWorkspace=auth.workspaceId;changePassword(store,auth.identity,data.currentPassword,data.password,data.confirmation);store.db.prepare('UPDATE verification_challenges SET used_at=? WHERE account_id=? AND used_at IS NULL').run(new Date().toISOString(),auth.identity.id);json(res,{ok:true,...beginFresh(accounts.user(auth.identity.id),req,res,oldWorkspace)});return true;}
  if(req.method==='POST'&&endpoint==='/api/account/contact'){rate(req,'contact',10);const data=await body(req);json(res,await verification.requestContact(auth.identity.id,data.contact,data.kind));return true;}
  if(req.method==='POST'&&endpoint==='/api/account/contact/verify'){rate(req,'verify-contact',30);const data=await body(req);json(res,{account:verification.verifyContact(auth.identity.id,data.challengeId,data.code)});return true;}
  if(req.method==='POST'&&endpoint==='/api/workspaces'){const data=await body(req);json(res,{workspace:workspaces.create(auth.workspaceId,auth.identity,data.name)},201);return true;}
  if(req.method==='POST'&&endpoint==='/api/workspaces/select'){const data=await body(req);check(typeof data.id==='string','شناسه برند معتبر نیست');json(res,choose(auth,res,data.id));return true;}
  if(req.method==='POST'&&endpoint==='/api/workspaces/default'){await body(req);json(res,choose(auth,res,'default'));return true;}
  if(req.method==='GET'&&endpoint==='/api/state'&&auth&&!auth.workspaceId){json(res,accountState(auth));return true;}
  return false;
 }
 return {route,context,accountInfo,verification};
}
