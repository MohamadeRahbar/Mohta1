import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID,randomBytes,randomInt,createHmac} from 'node:crypto';
import {passwordHash,verifyPassword,hashToken,safeEqual,revokeRememberedDevices} from './auth.mjs';
import {check,text} from '../content/content.mjs';
import {newPassword} from './recovery.mjs';

const stamp=()=>new Date().toISOString();
const digits=value=>String(value).replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-1776)).replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-1632));
export function identifier(value){
 const input=digits(text(value||'',254)).toLowerCase();
 if(input.includes('@')){check(/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/.test(input),'ایمیل معتبر وارد کنید');return {kind:'email',value:input};}
 let phone=input.replace(/[\s()-]/g,'');
 if(/^09\d{9}$/.test(phone))phone='+98'+phone.slice(1);
 else if(/^0098\d{10}$/.test(phone))phone='+'+phone.slice(2);
 else if(/^98\d{10}$/.test(phone))phone='+'+phone;
 if(/^\+/.test(phone)||/^\d{8,15}$/.test(phone)){check(/^\+[1-9]\d{7,14}$/.test(phone),'موبایل را با کد کشور یا به شکل 09123456789 وارد کنید');return {kind:'phone',value:phone};}
 check(/^[a-z0-9_.-]{3,80}$/.test(input),'نام کاربری باید ۳ تا ۸۰ حرف انگلیسی، عدد، نقطه، خط تیره یا زیرخط باشد');return {kind:'username',value:input};
}
export function contactIdentifier(value){const item=identifier(value);check(item.kind!=='username','ایمیل یا شماره موبایل معتبر وارد کنید');return item;}
function maskContact(item){if(item.kind==='email'){const [name,domain]=item.value.split('@');return name.slice(0,1)+'***@'+domain;}return item.value.slice(0,4)+'***'+item.value.slice(-3);}
export function openAccounts(directory){
 fs.mkdirSync(directory,{recursive:true});
 const db=new DatabaseSync(path.join(directory,'accounts.sqlite'));
 db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,username TEXT NOT NULL,name TEXT NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'admin',channels TEXT NOT NULL DEFAULT '[]',active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,email TEXT,phone TEXT,email_verified_at TEXT,phone_verified_at TEXT,can_create_brands INTEGER NOT NULL DEFAULT 0);
 CREATE INDEX IF NOT EXISTS account_username ON users(username);
 CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),csrf TEXT NOT NULL,expires INTEGER NOT NULL,workspace_id TEXT);
 CREATE TABLE IF NOT EXISTS remembered_devices(id TEXT PRIMARY KEY,token_hash TEXT NOT NULL UNIQUE,user_id TEXT NOT NULL REFERENCES users(id),csrf TEXT NOT NULL,expires INTEGER NOT NULL,auto_login INTEGER NOT NULL DEFAULT 1,password_fingerprint TEXT NOT NULL,session_hash TEXT,created_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS remembered_devices_user ON remembered_devices(user_id);
 CREATE TABLE IF NOT EXISTS password_resets(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL,used_at TEXT,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS memberships(account_id TEXT NOT NULL REFERENCES users(id),workspace_id TEXT NOT NULL,user_id TEXT NOT NULL,PRIMARY KEY(account_id,workspace_id),UNIQUE(workspace_id,user_id));
 CREATE TABLE IF NOT EXISTS migrations(id TEXT PRIMARY KEY,applied_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,actor_id TEXT,action TEXT NOT NULL,entity_id TEXT,detail TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS verification_challenges(id TEXT PRIMARY KEY,purpose TEXT NOT NULL,account_id TEXT,channel TEXT NOT NULL,destination TEXT NOT NULL,code_hash TEXT NOT NULL,payload TEXT NOT NULL,expires INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,used_at TEXT,last_sent INTEGER NOT NULL,created_at TEXT NOT NULL);
 `);
 const rememberMigration='remembered-devices-no-expiry';
 if(!db.prepare('SELECT id FROM migrations WHERE id=?').get(rememberMigration)){
  db.exec('BEGIN IMMEDIATE');
  try{
   // Extend only still-valid credentials; expired or password-revoked ones stay invalid.
   for(const row of db.prepare('SELECT d.id,d.password_fingerprint,u.password FROM remembered_devices d JOIN users u ON u.id=d.user_id WHERE d.expires>? AND u.active=1').all(Date.now()))if(safeEqual(row.password_fingerprint,hashToken(row.password)))db.prepare('UPDATE remembered_devices SET expires=0 WHERE id=?').run(row.id);
   db.prepare('INSERT INTO migrations VALUES(?,?)').run(rememberMigration,stamp());db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
 }
 const keyFile=path.join(directory,'accounts.key');
 if(!fs.existsSync(keyFile)){check(!db.prepare('SELECT id FROM verification_challenges LIMIT 1').get(),'کلید تایید حساب پیدا نشد؛ پشتیبان را بازیابی کنید',500);fs.writeFileSync(keyFile,randomBytes(32),{mode:0o600,flag:'wx'});}
 const key=fs.readFileSync(keyFile);check(key.length===32,'کلید حساب معتبر نیست',500);
 const store={db,directory,transaction(fn){db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}},audit(actor,action,entity,detail={}){db.prepare('INSERT INTO audit(actor_id,action,entity_id,detail,created_at) VALUES(?,?,?,?,?)').run(actor||null,action,entity||null,JSON.stringify(detail),stamp());},close(){db.close();}};
 function user(id){return db.prepare('SELECT * FROM users WHERE id=?').get(id)||null;}
 function publicAccount(row){return row&&{id:row.id,username:row.username,name:row.name,email:row.email||'',phone:row.phone||'',emailVerified:!!row.email_verified_at,phoneVerified:!!row.phone_verified_at,canCreateBrands:!!row.can_create_brands};}
 function migrate(workspace,tenant,ownerId){
  const migration='brand:'+workspace;if(db.prepare('SELECT id FROM migrations WHERE id=?').get(migration))return;
  store.transaction(()=>{
   for(const row of tenant.db.prepare('SELECT * FROM users ORDER BY created_at').all()){
    const existing=user(row.id);
    // Stable legacy IDs identify the same person; equal usernames alone never merge accounts.
    if(!existing)db.prepare('INSERT INTO users(id,username,name,password,role,channels,active,created_at,can_create_brands) VALUES(?,?,?,?,?,?,1,?,?)').run(row.id,row.username,row.name,row.password,'admin','[]',row.created_at,Number(row.role==='admin'||row.id===ownerId));
    else if(row.role==='admin'||row.id===ownerId)db.prepare('UPDATE users SET can_create_brands=1 WHERE id=?').run(row.id);
    db.prepare('INSERT OR IGNORE INTO memberships VALUES(?,?,?)').run(row.id,workspace,row.id);
   }
   for(const row of tenant.db.prepare('SELECT * FROM sessions').all())if(user(row.user_id))db.prepare('INSERT OR IGNORE INTO sessions(token_hash,user_id,csrf,expires,workspace_id) VALUES(?,?,?,?,?)').run(row.token_hash,row.user_id,row.csrf,row.expires,workspace);
   for(const row of tenant.db.prepare('SELECT * FROM password_resets').all())if(user(row.user_id))db.prepare('INSERT OR IGNORE INTO password_resets VALUES(?,?,?,?,?)').run(row.token_hash,row.user_id,row.expires,row.used_at,row.created_at);
   db.prepare('INSERT INTO migrations VALUES(?,?)').run(migration,stamp());
  });
 }
 function candidates(login){let canonical;try{canonical=identifier(login).value;}catch{canonical=text(login||'',254).toLowerCase();}return db.prepare('SELECT * FROM users WHERE active=1 AND (username=? OR (email=? AND email_verified_at IS NOT NULL) OR (phone=? AND phone_verified_at IS NOT NULL))').all(canonical,canonical,canonical);}
 function authenticate(login,password){const rows=candidates(login);const matches=rows.filter(row=>verifyPassword(String(password||''),row.password));if(!rows.length)verifyPassword(String(password||''),'invalid:00');check(matches.length===1,'شناسه ورود یا رمز عبور صحیح نیست',401);store.audit(matches[0].id,'login',matches[0].id);return matches[0];}
 function available(item,exceptId=''){return !db.prepare('SELECT id FROM users WHERE id<>? AND (username=? OR email=? OR phone=?) LIMIT 1').get(exceptId,item.value,item.value,item.value);}
 function create({username,name,password,contact,verified=false,canCreateBrands=true,id=randomUUID(),hashed=false}){
  const login=identifier(username);check(available(login),'این شناسه قبلا ثبت شده است',409);if(contact)check(available(contact),'این راه ارتباطی قبلا ثبت شده است',409);
  db.prepare('INSERT INTO users(id,username,name,password,created_at,email,phone,email_verified_at,phone_verified_at,can_create_brands) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,login.value,text(name||'',100),hashed?password:passwordHash(password),stamp(),contact?.kind==='email'?contact.value:null,contact?.kind==='phone'?contact.value:null,verified&&contact?.kind==='email'?stamp():null,verified&&contact?.kind==='phone'?stamp():null,Number(canCreateBrands));
  store.audit(id,'account.register',id,{verified,method:contact?.kind||'legacy'});return user(id);
 }
 function provision(identity){const found=candidates(identity.username);check(found.length<=1,'این شناسه به چند حساب قدیمی مربوط است؛ از ایمیل تایید شده استفاده کنید',409);if(found[0])return found[0];check(String(identity.password||'').length>=12,'برای عضو جدید رمز اولیه حداقل ۱۲ کاراکتر وارد کنید');return store.transaction(()=>create({...identity,canCreateBrands:false}));}
 return {store,db,key,user,publicAccount,migrate,candidates,authenticate,available,create,provision,close:store.close};
}
export function createVerification(accounts,{localMode=false,deliverCode=null,methods=['email','phone'],registrationAllowed=true,now=Date.now}={}){
 const {db,store}=accounts,ttl=10*60*1000,cooldown=60*1000;
 const enabled=!!deliverCode;
 const codeHash=(id,purpose,code)=>createHmac('sha256',accounts.key).update(id+':'+purpose+':'+code).digest('hex');
 function status(){return {registrationEnabled:registrationAllowed&&(localMode||enabled),localMode,deliveryAvailable:enabled,methods:enabled?methods:[]};}
 function registration(data){const login=identifier(data.username),name=text(data.name||'',100);check(name,'نام خود را وارد کنید');const password=newPassword(data.password,data.confirmation??data.password),contact=contactIdentifier(data.contact||((login.kind!=='username')?login.value:''));if(login.kind!=='username')check(login.kind===contact.kind&&login.value===contact.value,'ایمیل یا موبایل ورود باید همان راه ارتباطی تایید باشد');check(accounts.available(login)&&accounts.available(contact),'شناسه یا راه ارتباطی قبلا ثبت شده است',409);return {username:login.value,name,password:passwordHash(password),contact,hashed:true};}
 async function issue(purpose,contact,payload,accountId=null){
  check(enabled&&methods.includes(contact.kind),'سرویس ارسال کد برای این روش هنوز تنظیم نشده است',503);
  const recent=db.prepare('SELECT last_sent FROM verification_challenges WHERE purpose=? AND destination=? ORDER BY last_sent DESC LIMIT 1').get(purpose,contact.value);check(!recent||now()-recent.last_sent>=cooldown,'برای ارسال دوباره کد حداقل ۶۰ ثانیه صبر کنید',429);
  const id=randomUUID(),code=String(randomInt(100000,1000000)),time=now();
  store.transaction(()=>{db.prepare('UPDATE verification_challenges SET used_at=? WHERE purpose=? AND destination=? AND used_at IS NULL').run(stamp(),purpose,contact.value);db.prepare('INSERT INTO verification_challenges(id,purpose,account_id,channel,destination,code_hash,payload,expires,last_sent,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,purpose,accountId,contact.kind,contact.value,codeHash(id,purpose,code),JSON.stringify(payload),time+ttl,time,stamp());});
  if(payload.accountId!==null){try{await deliverCode({challengeId:id,purpose,channel:contact.kind,destination:contact.value,code,expiresInSeconds:ttl/1000});}catch{db.prepare('UPDATE verification_challenges SET used_at=? WHERE id=?').run(stamp(),id);check(false,'ارسال کد انجام نشد؛ بعدا دوباره تلاش کنید',503);}}
  return {verificationRequired:true,challengeId:id,purpose,channel:contact.kind,destination:maskContact(contact),expiresAt:new Date(time+ttl).toISOString(),resendAt:new Date(time+cooldown).toISOString()};
 }
 async function register(data){check(registrationAllowed&&(localMode||enabled),'ثبت نام تا تنظیم سرویس تایید ایمیل یا موبایل فعال نیست',503);const input=registration(data);if(localMode)return {account:store.transaction(()=>accounts.create({...input,verified:false})),local:true};return issue('register',input.contact,input);}
 function consume(id,code,purpose,accountId){
  check(typeof id==='string'&&/^[a-f0-9-]{36}$/.test(id),'درخواست تایید معتبر نیست');
  const row=db.prepare('SELECT * FROM verification_challenges WHERE id=?').get(id);
  check(row&&row.purpose===purpose&&!row.used_at&&row.expires>now()&&row.attempts<5,'کد نامعتبر، منقضی یا قبلا استفاده شده است');
  if(accountId!==undefined)check(row.account_id===accountId,'درخواست تایید متعلق به این حساب نیست',403);
  const clean=digits(String(code||'')).trim();
  const valid=/^\d{6}$/.test(clean)&&safeEqual(row.code_hash,codeHash(id,purpose,clean));
  db.prepare('UPDATE verification_challenges SET attempts=attempts+1 WHERE id=?').run(id);
  check(valid,'کد تایید صحیح نیست');return row;
 }
 function verifyRegistration(id,code){const row=consume(id,code,'register');return store.transaction(()=>{const fresh=db.prepare('SELECT used_at FROM verification_challenges WHERE id=?').get(id);check(!fresh.used_at,'کد قبلا استفاده شده است');const payload=JSON.parse(row.payload),account=accounts.create({...payload,verified:true});db.prepare('UPDATE verification_challenges SET used_at=? WHERE id=?').run(stamp(),id);return account;});}
 async function forgot(value){check(enabled,'ارسال کد بازیابی هنوز تنظیم نشده است؛ در نصب محلی از لینک بازیابی میزبان استفاده کنید',503);const contact=contactIdentifier(value),field=contact.kind==='email'?'email':'phone';const found=db.prepare('SELECT id FROM users WHERE '+field+'=? AND '+field+'_verified_at IS NOT NULL AND active=1').get(contact.value);return issue('recovery',contact,{accountId:found?.id||null},found?.id||null);}
 function reset(id,code,password,confirmation){const value=newPassword(password,confirmation),row=consume(id,code,'recovery'),payload=JSON.parse(row.payload);check(payload.accountId,'کد تایید صحیح نیست');return store.transaction(()=>{check(!db.prepare('SELECT used_at FROM verification_challenges WHERE id=?').get(id).used_at,'کد قبلا استفاده شده است');const account=accounts.user(payload.accountId);check(account?.active,'کد تایید صحیح نیست');db.prepare('UPDATE users SET password=? WHERE id=?').run(passwordHash(value),account.id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(account.id);revokeRememberedDevices(store,account.id);db.prepare('UPDATE password_resets SET used_at=? WHERE user_id=? AND used_at IS NULL').run(stamp(),account.id);db.prepare('UPDATE verification_challenges SET used_at=? WHERE (account_id=? OR id=?) AND used_at IS NULL').run(stamp(),account.id,id);store.audit(account.id,'password.reset',account.id,{method:'verified_code'});return {username:account.username};});}
 async function requestContact(accountId,value,kind){const contact=contactIdentifier(value);if(kind!==undefined)check(['email','phone'].includes(kind)&&contact.kind===kind,'در کادر ایمیل فقط ایمیل و در کادر موبایل فقط شماره وارد کنید');check(accounts.available(contact,accountId),'این راه ارتباطی متعلق به حساب دیگری است',409);if(localMode){const field=contact.kind==='email'?'email':'phone';db.prepare('UPDATE users SET '+field+'_verified_at=CASE WHEN '+field+'=? THEN '+field+'_verified_at ELSE NULL END,'+field+'=? WHERE id=?').run(contact.value,contact.value,accountId);db.prepare("UPDATE verification_challenges SET used_at=? WHERE account_id=? AND purpose='recovery' AND used_at IS NULL").run(stamp(),accountId);store.audit(accountId,'account.contact',accountId,{verified:false,method:contact.kind});return {local:true,account:accounts.publicAccount(accounts.user(accountId))};}return issue('contact',contact,{contact},accountId);}
 function verifyContact(accountId,id,code){const row=consume(id,code,'contact',accountId),contact=JSON.parse(row.payload).contact;return store.transaction(()=>{check(accounts.available(contact,accountId),'این راه ارتباطی متعلق به حساب دیگری است',409);check(!db.prepare('SELECT used_at FROM verification_challenges WHERE id=?').get(id).used_at,'کد قبلا استفاده شده است');const field=contact.kind==='email'?'email':'phone';db.prepare('UPDATE users SET '+field+'=?,'+field+'_verified_at=? WHERE id=?').run(contact.value,stamp(),accountId);db.prepare("UPDATE verification_challenges SET used_at=? WHERE (id=? OR (account_id=? AND purpose='recovery')) AND used_at IS NULL").run(stamp(),id,accountId);store.audit(accountId,'account.contact',accountId,{verified:true,method:contact.kind});return accounts.publicAccount(accounts.user(accountId));});}
 async function resend(id,actorId){const row=db.prepare('SELECT * FROM verification_challenges WHERE id=?').get(id);check(row&&!row.used_at&&row.expires>now(),'درخواست تایید منقضی شده است');if(row.purpose==='contact')check(row.account_id===actorId,'درخواست متعلق به این حساب نیست',403);return issue(row.purpose,{kind:row.channel,value:row.destination},JSON.parse(row.payload),row.account_id);}
 return {status,register,verifyRegistration,forgot,reset,requestContact,verifyContact,resend};
}
export function deliveryAdapter(env=process.env){
 if(!env.VERIFICATION_DELIVERY_URL)return null;
 const url=new URL(env.VERIFICATION_DELIVERY_URL);check(url.protocol==='https:'&&!url.username&&!url.password&&env.VERIFICATION_DELIVERY_TOKEN,'تنظیمات سرویس ارسال کد معتبر نیست',500);
 return async payload=>{const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+env.VERIFICATION_DELIVERY_TOKEN},body:JSON.stringify(payload),redirect:'error',signal:AbortSignal.timeout(10000)});check(response.ok,'سرویس ارسال کد پاسخ نداد',503);const result=await response.json();check(result.accepted===true,'ارسال کد تایید نشد',503);};
}
