import {randomBytes,randomUUID} from 'node:crypto';
import {appendCookie,cookies,hashToken,safeEqual} from './auth.mjs';
import {check} from '../content/content.mjs';

// Browsers cap persistent cookies; renew this window on each bootstrap visit.
// https://developer.chrome.com/blog/cookie-max-age-expires
const cookieLifetime=400*24*60*60;
const secret=()=>randomBytes(32).toString('hex');
const cookie=(token,seconds)=>`desk_remember=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${process.env.COOKIE_SECURE==='true'?'; Secure':''}`;

// The browser holds a revocable random credential, never the account password.
export function createRememberedDevices(accounts,{clock=Date.now}={}){
 const {store,db}=accounts;
 function find(req){
  const token=cookies(req).desk_remember;if(!/^[a-f0-9]{64}$/.test(token||''))return null;
  const row=db.prepare('SELECT * FROM remembered_devices WHERE token_hash=? AND (expires=0 OR expires>?)').get(hashToken(token),clock());if(!row)return null;
  const account=accounts.user(row.user_id);if(!account?.active||!safeEqual(row.password_fingerprint,hashToken(account.password)))return null;
  return {...row,account};
 }
 function summary(row){return row&&{username:row.account.username,name:row.account.name,csrf:row.csrf,expiresAt:row.expires===0?null:new Date(row.expires).toISOString()};}
 function erase(row){if(!row)return;db.prepare('DELETE FROM sessions WHERE token_hash=?').run(row.session_hash);db.prepare('DELETE FROM remembered_devices WHERE id=?').run(row.id);}
 function create(req,account){
  return store.transaction(()=>{
   erase(find(req));
   // Expired credentials and their sessions cannot be reused.
   db.prepare('DELETE FROM sessions WHERE token_hash IN (SELECT session_hash FROM remembered_devices WHERE expires>0 AND expires<=?)').run(clock());db.prepare('DELETE FROM remembered_devices WHERE expires>0 AND expires<=?').run(clock());
   const row={id:randomUUID(),token:secret(),csrf:secret(),expires:0};
   db.prepare('INSERT INTO remembered_devices(id,token_hash,user_id,csrf,expires,password_fingerprint,created_at) VALUES(?,?,?,?,?,?,?)').run(row.id,hashToken(row.token),account.id,row.csrf,row.expires,hashToken(account.password),new Date(clock()).toISOString());
   store.audit(account.id,'account.remember',row.id,{expiresAt:null});return row;
  });
 }
 function write(res,row){appendCookie(res,cookie(row.token,row.expires===0?cookieLifetime:Math.max(0,Math.min(cookieLifetime,Math.ceil((row.expires-clock())/1000)))));}
 function renew(req,res,row){write(res,{...row,token:cookies(req).desk_remember});}
 function requireConsent(req,row){check(row&&safeEqual(req.headers['x-csrf-token']||'',row.csrf),'ورود ذخیره شده معتبر نیست؛ صفحه را تازه کنید یا با رمز وارد شوید.',403);}
 function resume(req,{explicit=false}={}){
  return store.transaction(()=>{
   const row=find(req);check(row,'ورود ذخیره شده منقضی یا لغو شده است؛ با رمز وارد شوید.',401);
   if(explicit)requireConsent(req,row);else check(row.auto_login===1,'برای ورود دوباره روی دکمه ورود کلیک کنید.',401);
   const token=secret(),csrf=secret();db.prepare('DELETE FROM sessions WHERE token_hash=?').run(row.session_hash);
   db.prepare('UPDATE remembered_devices SET token_hash=?,csrf=?,auto_login=1,session_hash=NULL WHERE id=? AND token_hash=?').run(hashToken(token),csrf,row.id,row.token_hash);
   store.audit(row.user_id,'account.remember-login',row.id,{explicit});return {...row,token,csrf};
  });
 }
 function pause(req,accountId){const row=find(req);if(!row)return;store.transaction(()=>{db.prepare('DELETE FROM sessions WHERE token_hash=?').run(row.session_hash);db.prepare('UPDATE remembered_devices SET auto_login=0,session_hash=NULL,csrf=? WHERE id=?').run(secret(),row.id);store.audit(accountId,'account.remember-pause',row.id);});}
 function forget(req,res,{consent=true}={}){const row=find(req);if(consent)requireConsent(req,row);store.transaction(()=>{erase(row);if(row)store.audit(row.user_id,'account.remember-forget',row.id);});appendCookie(res,cookie('',0));}
 return {find,summary,create,write,renew,resume,pause,forget};
}
