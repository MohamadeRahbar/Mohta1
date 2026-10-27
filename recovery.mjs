import {randomBytes} from 'node:crypto';
import {passwordHash,hashToken,verifyPassword,revokeRememberedDevices} from './auth.mjs';
import {check,text} from './content.mjs';

export function newPassword(password,confirmation){
 const value=text(password||'',200);check(value.length>=12,'رمز جدید حداقل ۱۲ کاراکتر باشد.');
 check(value===text(confirmation||'',200),'رمز جدید و تکرار آن یکسان نیستند.');return value;
}
function revokeResets(store,userId){store.db.prepare('UPDATE password_resets SET used_at=? WHERE user_id=? AND used_at IS NULL').run(new Date().toISOString(),userId);}

// Called from the host CLI, never from an anonymous HTTP route.
export function issueRecovery(store,userId){
 const user=store.db.prepare('SELECT id,username FROM users WHERE id=? AND active=1').get(userId);check(user,'حساب فعال پیدا نشد.');
 const token=randomBytes(32).toString('base64url'),expires=Date.now()+20*60*1000;
 store.transaction(()=>{revokeResets(store,user.id);store.db.prepare('INSERT INTO password_resets VALUES(?,?,?,NULL,?)').run(hashToken(token),user.id,expires,new Date().toISOString());store.audit(null,'password.recovery.issue',user.id,{method:'host_cli'});});
 return {token,username:user.username,expires};
}
export function resetPassword(store,token,password,confirmation){
 const value=newPassword(password,confirmation);
 check(typeof token==='string'&&/^[A-Za-z0-9_-]{43}$/.test(token),'لینک بازیابی نامعتبر، منقضی یا قبلاً استفاده شده است.');
 return store.transaction(()=>{
   const grant=store.db.prepare('SELECT r.*,u.username,u.active FROM password_resets r JOIN users u ON u.id=r.user_id WHERE r.token_hash=?').get(hashToken(token));
   check(grant&&!grant.used_at&&grant.expires>Date.now()&&grant.active,'لینک بازیابی نامعتبر، منقضی یا قبلاً استفاده شده است.');
   store.db.prepare('UPDATE users SET password=? WHERE id=?').run(passwordHash(value),grant.user_id);
   store.db.prepare('DELETE FROM sessions WHERE user_id=?').run(grant.user_id);revokeRememberedDevices(store,grant.user_id);revokeResets(store,grant.user_id);
   store.audit(grant.user_id,'password.reset',grant.user_id,{method:'recovery_link'});return {username:grant.username,userId:grant.user_id};
 });
}
export function changePassword(store,user,currentPassword,password,confirmation){
 const value=newPassword(password,confirmation);
 // Re-read the hash: a stale authenticated request cannot reuse a previous hash.
 const actual=store.db.prepare('SELECT password FROM users WHERE id=? AND active=1').get(user.id);
 check(actual&&verifyPassword(text(currentPassword||'',200),actual.password),'رمز فعلی صحیح نیست.');
 store.transaction(()=>{store.db.prepare('UPDATE users SET password=? WHERE id=?').run(passwordHash(value),user.id);store.db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);revokeRememberedDevices(store,user.id);revokeResets(store,user.id);store.audit(user.id,'account.password',user.id);});
}
