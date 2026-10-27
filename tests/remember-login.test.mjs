import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {openAccounts} from '../src/accounts/accounts.mjs';
import {hashToken,startSession} from '../src/accounts/auth.mjs';
import {createRememberedDevices} from '../src/accounts/remembered-device.mjs';
import {changePassword} from '../src/accounts/recovery.mjs';

test('remembered credentials are hashed, rotate, pause after logout, have no fixed expiry and revoke with password changes',t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'desk-remember-')),accounts=openAccounts(directory);
 t.after(()=>{accounts.close();fs.rmSync(directory,{recursive:true,force:true});});
 const password='remember-fixture-password',account=accounts.create({username:'rememberowner',name:'Remember owner',password});let time=Date.now();
 const remembered=createRememberedDevices(accounts,{clock:()=>time}),req={headers:{}},headers=new Map(),res={getHeader:key=>headers.get(key),setHeader:(key,value)=>headers.set(key,value)};
 let grant=remembered.create(req,account);req.headers.cookie='desk_remember='+grant.token;
 startSession(accounts.store,account.id,res,{workspaceId:null,rememberDeviceId:grant.id});remembered.write(res,grant);
 assert.match(headers.get('Set-Cookie')[1],/HttpOnly; SameSite=Strict; Max-Age=34560000/);
 const stored=accounts.db.prepare('SELECT * FROM remembered_devices').get();assert.equal(stored.token_hash,hashToken(grant.token));assert(!JSON.stringify(stored).includes(grant.token));assert(!JSON.stringify(stored).includes(password));
 assert.equal(remembered.find(req).auto_login,1);const oldNonce=stored.csrf;remembered.pause(req,account.id);assert.equal(remembered.find(req).auto_login,0);assert.notEqual(remembered.find(req).csrf,oldNonce);assert.equal(accounts.db.prepare('SELECT count(*) n FROM sessions').get().n,0);
 assert.throws(()=>remembered.resume(req),/کلیک/);assert.throws(()=>remembered.resume(req,{explicit:true}),error=>error.status===403);
 req.headers['x-csrf-token']=remembered.summary(remembered.find(req)).csrf;const previousToken=grant.token;grant=remembered.resume(req,{explicit:true});assert.notEqual(grant.token,previousToken);assert.equal(remembered.find(req),null);
 req.headers.cookie='desk_remember='+grant.token;assert.equal(remembered.find(req).auto_login,1);assert.equal(grant.expires,stored.expires);
 time+=20*365*24*60*60*1000;assert(remembered.find(req));assert.equal(remembered.summary(remembered.find(req)).expiresAt,null);
 time=Date.now();grant=remembered.create(req,account);req.headers.cookie='desk_remember='+grant.token;changePassword(accounts.store,account,password,'replacement-password','replacement-password');assert.equal(remembered.find(req),null);assert.equal(accounts.db.prepare('SELECT count(*) n FROM remembered_devices').get().n,0);
});

test('existing valid remembered devices lose their time limit without reviving expired or password-revoked credentials',t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'desk-remember-migrate-'));let accounts=openAccounts(directory);
 t.after(()=>{accounts.close();fs.rmSync(directory,{recursive:true,force:true});});
 const account=accounts.create({username:'migrationowner',name:'Migration owner',password:'remember-migration-password'}),remembered=createRememberedDevices(accounts),future=Date.now()+300000,past=Date.now()-10000;
 const valid=remembered.create({headers:{}},account),expired=remembered.create({headers:{}},account),revoked=remembered.create({headers:{}},account);
 assert.equal(accounts.db.prepare('SELECT count(*) n FROM remembered_devices').get().n,3,'Creating another device must preserve unlimited credentials');
 accounts.db.prepare('UPDATE remembered_devices SET expires=?,auto_login=0 WHERE id=?').run(future,valid.id);
 accounts.db.prepare('UPDATE remembered_devices SET expires=? WHERE id=?').run(past,expired.id);
 accounts.db.prepare('UPDATE remembered_devices SET expires=?,password_fingerprint=? WHERE id=?').run(future,hashToken('revoked password'),revoked.id);
 accounts.db.prepare("DELETE FROM migrations WHERE id='remembered-devices-no-expiry'").run();accounts.close();accounts=openAccounts(directory);
 const service=createRememberedDevices(accounts),req=token=>({headers:{cookie:'desk_remember='+token}});
 const saved=service.find(req(valid.token));assert.equal(saved.expires,0);assert.equal(saved.auto_login,0);assert.throws(()=>service.resume(req(valid.token)),/کلیک/);
 assert.equal(service.find(req(expired.token)),null);assert.equal(service.find(req(revoked.token)),null);
 assert.equal(accounts.db.prepare('SELECT expires FROM remembered_devices WHERE id=?').get(expired.id).expires,past);
 assert.equal(accounts.db.prepare('SELECT expires FROM remembered_devices WHERE id=?').get(revoked.id).expires,future);
});

test('HTTP remembered login survives restart, restores expired sessions, stays logged out, supports one-click login and forgetting',async t=>{
 const root=fileURLToPath(new URL('../',import.meta.url)),directory=fs.mkdtempSync(path.join(os.tmpdir(),'desk-remember-http-')),reserve=http.createServer();
 await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));const origin='http://127.0.0.1:'+port;
 let child,logs='';
 async function start(){child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,HOST:'127.0.0.1',PORT:String(port),DATA_DIR:directory,PUBLIC_URL:''},windowsHide:true,stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);for(let i=0;i<100;i++){try{if((await fetch(origin+'/healthz')).ok)return;}catch{}await new Promise(r=>setTimeout(r,40));}throw Error(logs);}
 async function stop(){if(child.exitCode!==null)return;const done=new Promise(r=>child.once('exit',r));child.kill();await done;}
 t.after(async()=>{await stop();fs.rmSync(directory,{recursive:true,force:true});});await start();
 function client(initial){const jar=new Map(initial);let csrf='';return {jar,async call(route,method='GET',body,headers={}){const res=await fetch(origin+route,{method,headers:{Cookie:[...jar].map(([k,v])=>k+'='+v).join('; '),'X-CSRF-Token':csrf,...(method==='POST'?{'Content-Type':'application/json'}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)}),cookies=res.headers.getSetCookie();for(const value of cookies){const [pair]=value.split(';'),index=pair.indexOf('='),key=pair.slice(0,index);if(value.includes('Max-Age=0'))jar.delete(key);else jar.set(key,pair.slice(index+1));}const value=await res.json();if(value.csrf)csrf=value.csrf;return {status:res.status,value,cookies};}};}
 const owner=client(),password='remember-http-password';
 const setup=await owner.call('/api/setup','POST',{username:'owner',name:'Remember fixture',password});assert.equal(setup.status,200);assert(!owner.jar.has('desk_remember'));
 await owner.call('/api/logout','POST',{});
 let login=await owner.call('/api/login','POST',{username:'owner',password,remember:true});assert.equal(login.status,200);assert(owner.jar.has('desk_remember'));assert.match(login.cookies.find(c=>c.startsWith('desk_remember=')),/Max-Age=34560000/);
 const query=fn=>{const db=new DatabaseSync(path.join(directory,'accounts.sqlite'));try{return fn(db);}finally{db.close();}};
 const token=owner.jar.get('desk_remember');assert(!JSON.stringify(query(db=>db.prepare('SELECT * FROM remembered_devices').all())).includes(token));
 await stop();await start();const existingSession=await owner.call('/api/bootstrap');assert(existingSession.value.user);assert.match(existingSession.cookies.find(c=>c.startsWith('desk_remember=')),/Max-Age=34560000/);
 query(db=>db.prepare('DELETE FROM sessions').run());const restored=await owner.call('/api/bootstrap');assert(restored.value.user);assert.notEqual(owner.jar.get('desk_remember'),token);assert.equal((await owner.call('/api/state')).status,200);
 const oldDevice=client(owner.jar),oldSession=owner.jar.get('desk_session');await owner.call('/api/logout','POST',{});
 let bootstrap=(await owner.call('/api/bootstrap')).value;assert.equal(bootstrap.user,null);assert.equal(bootstrap.remembered.username,'owner');assert.equal((await owner.call('/api/bootstrap')).value.user,null);assert.equal((await oldDevice.call('/api/state')).status,401);assert(oldSession);
 assert.equal((await owner.call('/api/login/remembered','POST',{})).status,403);
 assert.equal((await owner.call('/api/login/remembered','POST',{}, {'X-CSRF-Token':bootstrap.remembered.csrf,Origin:'http://untrusted.example'})).status,403);
 const nonce=bootstrap.remembered.csrf;
 assert.equal((await owner.call('/api/login/remembered','POST',{}, {'X-CSRF-Token':nonce})).status,200);
 assert.equal((await owner.call('/api/state')).status,200);assert.equal((await oldDevice.call('/api/bootstrap')).value.user,null);
 await owner.call('/api/logout','POST',{});bootstrap=(await owner.call('/api/bootstrap')).value;
 assert.equal((await owner.call('/api/auth/remember/forget','POST',{})).status,403);
 assert.equal((await owner.call('/api/auth/remember/forget','POST',{}, {'X-CSRF-Token':bootstrap.remembered.csrf})).status,200);assert(!owner.jar.has('desk_remember'));assert.equal(query(db=>db.prepare('SELECT count(*) n FROM remembered_devices').get().n),0);
 assert.equal((await owner.call('/api/bootstrap')).value.remembered,null);
 // Choosing a normal password login removes this browser's previous remembered credential.
 await owner.call('/api/login','POST',{username:'owner',password,remember:true});await owner.call('/api/logout','POST',{});await owner.call('/api/login','POST',{username:'owner',password,remember:false});assert(!owner.jar.has('desk_remember'));query(db=>db.prepare('DELETE FROM sessions').run());assert.equal((await owner.call('/api/bootstrap')).value.user,null);
 await owner.call('/api/login','POST',{username:'owner',password,remember:true});assert.equal((await owner.call('/api/account/password','POST',{currentPassword:password,password:'new-remember-password',confirmation:'new-remember-password'})).status,200);assert.equal(query(db=>db.prepare('SELECT count(*) n FROM remembered_devices').get().n),0);query(db=>db.prepare('DELETE FROM sessions').run());assert.equal((await owner.call('/api/bootstrap')).value.user,null);
 await owner.call('/api/login','POST',{username:'owner',password:'new-remember-password',remember:true});query(db=>{db.prepare('DELETE FROM sessions').run();db.prepare('UPDATE remembered_devices SET expires=?').run(Date.now()-1);});bootstrap=(await owner.call('/api/bootstrap')).value;assert.equal(bootstrap.user,null);assert.equal(bootstrap.remembered,null);assert.equal((await owner.call('/api/login/remembered','POST',{}, {'X-CSRF-Token':nonce})).status,401);
 assert(!logs.includes('Request failed:'));
});
