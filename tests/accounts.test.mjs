import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {identifier,openAccounts,createVerification,deliveryAdapter} from '../accounts.mjs';
import {openStore} from '../store.mjs';
import {passwordHash,hashToken} from '../auth.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),password='account-fixture-password';
function temp(t){return fs.mkdtempSync(path.join(os.tmpdir(),'desk-accounts-'));}
test('login identifiers normalize mobile digits and reject malformed contact values',()=>{
 assert.deepEqual(identifier('۰۹۱۲۳۴۵۶۷۸۹'),{kind:'phone',value:'+989123456789'});
 assert.equal(identifier('  Owner.Name  ').value,'owner.name');assert.equal(identifier('User@Example.com').value,'user@example.com');
 for(const value of ['a@b','+000000000','short name','12','+98<script>'])assert.throws(()=>identifier(value));
 assert.throws(()=>deliveryAdapter({VERIFICATION_DELIVERY_URL:'http://unsafe.example',VERIFICATION_DELIVERY_TOKEN:'fixture'}));
});
test('verified registration, OTP attempts, expiry, resend, alias login and global recovery are enforced',async t=>{
 const directory=temp(t),a=openAccounts(directory);t.after(()=>{a.close();fs.rmSync(directory,{recursive:true,force:true});});let time=Date.now();const sent=[];
 const v=createVerification(a,{now:()=>time,deliverCode:async data=>sent.push(data)});
 const registration={username:'owner',name:'Owner',password,confirmation:password,contact:'owner@example.com'};
 let challenge=await v.register(registration);assert.equal(a.db.prepare('SELECT count(*) n FROM users').get().n,0);assert(!JSON.stringify(challenge).includes(sent[0].code));
 assert.throws(()=>v.verifyRegistration(challenge.challengeId,'000000'));
 assert.equal(a.db.prepare('SELECT attempts FROM verification_challenges WHERE id=?').get(challenge.challengeId).attempts,1);
 assert(!a.db.prepare('SELECT code_hash FROM verification_challenges').get().code_hash.includes(sent[0].code));
 const account=v.verifyRegistration(challenge.challengeId,sent[0].code);assert.equal(a.authenticate('OWNER@EXAMPLE.COM',password).id,account.id);assert(a.publicAccount(account).emailVerified);
 assert.throws(()=>v.verifyRegistration(challenge.challengeId,sent[0].code));
 assert.throws(()=>a.authenticate('owner@example.com','wrong-password'));
 assert.throws(()=>v.verifyContact(account.id,challenge.challengeId,sent[0].code));
 await assert.rejects(()=>v.requestContact(account.id,'09123456789','email'));
 const phone=await v.requestContact(account.id,'09123456789','phone');const phoneCode=sent.at(-1).code;
 assert.throws(()=>v.verifyContact('other-account',phone.challengeId,phoneCode));
 v.verifyContact(account.id,phone.challengeId,phoneCode);assert.equal(a.authenticate('+989123456789',password).id,account.id);
 // Saving the same verified value locally cannot erase its verified state.
 const local=createVerification(a,{localMode:true});await local.requestContact(account.id,'owner@example.com');assert(a.publicAccount(a.user(account.id)).emailVerified);
 const forgotten=await v.forgot('owner@example.com');const oldCode=sent.at(-1).code;
 await assert.rejects(()=>v.resend(forgotten.challengeId),/۶۰/);time+=61000;const resent=await v.resend(forgotten.challengeId);const latestCode=sent.at(-1).code;
 assert.throws(()=>v.reset(forgotten.challengeId,oldCode,password,password));
 a.db.prepare('INSERT INTO sessions VALUES(?,?,?,?,?)').run(hashToken('fixture-session'),account.id,'csrf',time+100000,null);
 v.reset(resent.challengeId,latestCode,'new-account-password','new-account-password');assert.equal(a.db.prepare('SELECT count(*) n FROM sessions').get().n,0);assert.throws(()=>a.authenticate('owner',password));assert.equal(a.authenticate('owner','new-account-password').id,account.id);
 assert.throws(()=>v.reset(resent.challengeId,latestCode,password,password));
 const bad=await v.requestContact(account.id,'second@example.com');const correct=sent.at(-1).code;
 for(let i=0;i<5;i++)assert.throws(()=>v.verifyContact(account.id,bad.challengeId,'000000'));
 assert.throws(()=>v.verifyContact(account.id,bad.challengeId,correct));
 const expires=await v.requestContact(account.id,'expire@example.com');time+=600001;assert.throws(()=>v.verifyContact(account.id,expires.challengeId,sent.at(-1).code));
 const before=sent.length,unknown=await v.forgot('unknown@example.com');assert.equal(sent.length,before);assert.equal(unknown.verificationRequired,true);assert.throws(()=>v.reset(unknown.challengeId,'123456',password,password));
});
test('delivery failure and disabled/local registration never fabricate verification',async t=>{
 const directory=temp(t),a=openAccounts(directory);t.after(()=>{a.close();fs.rmSync(directory,{recursive:true,force:true});});const data={username:'local',name:'Local',password,contact:'local@example.com'};
 const local=createVerification(a,{localMode:true}),created=await local.register(data);assert.equal(a.publicAccount(created.account).emailVerified,false);assert.throws(()=>a.authenticate('local@example.com',password));assert.equal(a.authenticate('local',password).id,created.account.id);
 await assert.rejects(()=>createVerification(a,{localMode:true,registrationAllowed:false}).register({...data,username:'disabled'}));
 const failing=createVerification(a,{deliverCode:async()=>{throw Error('private-provider-error');}});
 await assert.rejects(()=>failing.register({...data,username:'provider',contact:'provider@example.com'}),error=>!error.message.includes('private-provider-error'));
 assert.equal(a.db.prepare('SELECT count(*) n FROM users').get().n,1);assert(a.db.prepare('SELECT used_at FROM verification_challenges').get().used_at);
 await assert.rejects(()=>local.register({...data,username:'other@example.com',contact:'mismatch@example.com'}));
});
test('legacy migration merges only stable IDs and never resurrects revoked sessions or old passwords',t=>{
 const dir=temp(t),a=openAccounts(dir),first=openStore(path.join(dir,'first')),second=openStore(path.join(dir,'second')),third=openStore(path.join(dir,'third'));t.after(()=>{first.close();second.close();third.close();a.close();fs.rmSync(dir,{recursive:true,force:true});});
 const id=randomUUID(),unrelated=randomUUID(),hash=passwordHash(password),created=new Date().toISOString();
 const add=(store,key,name)=>store.db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)').run(key,name,name,hash,'admin','[]',1,created);
 add(first,id,'same_owner');add(second,id,'same_owner');add(second,unrelated,'other');
 first.db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hashToken('legacy-session'),id,'legacy-csrf',Date.now()+100000);
 a.migrate('first',first,id);a.migrate('second',second,id);assert.equal(a.db.prepare('SELECT count(*) n FROM users').get().n,2);assert.equal(a.db.prepare('SELECT count(*) n FROM memberships WHERE account_id=?').get(id).n,2);
 assert.equal(a.db.prepare('SELECT workspace_id FROM sessions').get().workspace_id,'first');
 a.db.prepare('DELETE FROM sessions').run();a.db.prepare('UPDATE users SET password=? WHERE id=?').run(passwordHash('central-new-password'),id);a.migrate('first',first,id);assert.equal(a.db.prepare('SELECT count(*) n FROM sessions').get().n,0);assert.equal(a.authenticate('same_owner','central-new-password').id,id);assert.throws(()=>a.authenticate('same_owner',password));
 // A different historical user with the same username is retained, never silently joined.
 const collision=randomUUID();add(third,collision,'same_owner');a.migrate('third',third,collision);assert.equal(a.user(unrelated).username,'other');assert.equal(a.db.prepare('SELECT account_id FROM memberships WHERE workspace_id=? AND user_id=?').get('third',collision).account_id,collision);assert.equal(a.candidates('same_owner').length,2);
});
test('one local account onboards multiple brands, shares its password, isolates logos and protects existing members',async t=>{
 const dataDir=temp(t),reserve=http.createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));const origin='http://127.0.0.1:'+port;let logs='';
 const child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,DATA_DIR:dataDir,HOST:'127.0.0.1',PORT:String(port),REGISTRATION_MODE:'local',VERIFICATION_DELIVERY_URL:'',PUBLIC_URL:''},windowsHide:true,stdio:['ignore','pipe','pipe']});child.stdout.on('data',v=>logs+=v);child.stderr.on('data',v=>logs+=v);t.after(async()=>{if(child.exitCode===null){const stopped=new Promise(r=>child.once('exit',r));child.kill();await stopped;}fs.rmSync(dataDir,{recursive:true,force:true});});
 for(let i=0;i<100;i++){try{if((await fetch(origin+'/healthz')).ok)break;}catch{}if(i===99)throw Error(logs);await new Promise(r=>setTimeout(r,40));}
 function client(){const jar=new Map();let csrf='';return {jar,async call(url,method='GET',body,extra={}){const response=await fetch(origin+url,{method,headers:{Cookie:[...jar].map(([k,v])=>k+'='+v).join('; '),'X-CSRF-Token':csrf,...(body instanceof FormData?{}:body?{'Content-Type':'application/json'}:{}),...extra},body:body instanceof FormData?body:body?JSON.stringify(body):undefined});for(const cookie of response.headers.getSetCookie()){const pair=cookie.split(';')[0],index=pair.indexOf('=');jar.set(pair.slice(0,index),pair.slice(index+1));}const value=(response.headers.get('Content-Type')||'').includes('json')?await response.json():await response.arrayBuffer();if(value.csrf)csrf=value.csrf;return {status:response.status,value,csrf};}};}
 assert.equal((await (await fetch(origin+'/healthz')).json()).version,JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version);
 const owner=client(),outsider=client(),second=client();
 assert.equal((await owner.call('/api/accounts/register','POST',{username:'owner',name:'Owner',password,contact:'owner@example.com'})).status,201);
 let state=(await owner.call('/api/state')).value;assert(state.capabilities.needsBrand);assert.equal(state.workspaces.length,0);assert.equal(state.account.emailVerified,false);assert.equal((await owner.call('/api/posts','POST',{})).status,403);
 const id=(await owner.call('/api/workspaces','POST',{name:'First'})).value.workspace.id,session=owner.jar.get('desk_session'),csrf=state.csrf;
 await owner.call('/api/workspaces/select','POST',{id});state=(await owner.call('/api/state')).value;assert.equal(state.workspace.id,id);assert.equal(state.csrf,csrf);assert.equal(owner.jar.get('desk_session'),session);
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64');const form=new FormData();form.set('file',new Blob([png],{type:'image/png'}),'logo.png');const logo=(await owner.call('/api/brand/logo','POST',form)).value.media;assert(logo.id);assert.equal((await owner.call('/api/state')).value.settings.brandLogoId,logo.id);
 const invalid=new FormData();invalid.set('file',new Blob(['<svg/>'],{type:'image/svg+xml'}),'bad.svg');assert.equal((await owner.call('/api/brand/logo','POST',invalid)).status,400);
 await outsider.call('/api/accounts/register','POST',{username:'outsider',name:'Outsider',password,contact:'outsider@example.com'});assert.equal((await outsider.call('/api/workspaces/select','POST',{id})).status,403);assert.equal((await outsider.call('/media/'+logo.id)).status,403);
 await owner.call('/api/users','POST',{username:'outsider',name:'Outsider',role:'viewer',channels:['telegram'],password:'ignored-existing-password'});await outsider.call('/api/workspaces/select','POST',{id});assert.equal((await outsider.call('/media/'+logo.id)).status,200);assert.equal((await outsider.call('/api/brand/logo','DELETE',{})).status,403);
 const user=(await owner.call('/api/users')).value.users.find(u=>u.username==='outsider');assert.equal((await owner.call('/api/users/'+user.id,'PUT',{name:'Outsider',role:'viewer',channels:['telegram'],active:true,password:'cannot-reset-this-password'})).status,400);assert.equal((await second.call('/api/login','POST',{username:'outsider',password})).status,200);
 const next=(await owner.call('/api/workspaces','POST',{name:'Second'})).value.workspace.id;await owner.call('/api/workspaces/select','POST',{id:next});assert.equal((await owner.call('/api/state')).value.settings.brandLogoId,'');assert.equal((await owner.call('/media/'+logo.id)).status,404);assert.equal(owner.jar.get('desk_session'),session);assert.equal((await owner.call('/api/state','GET',undefined,{'X-Workspace-Id':id})).status,409);
 assert.equal((await owner.call('/api/account/password','POST',{currentPassword:password,password:'global-new-password',confirmation:'global-new-password'})).status,200);await owner.call('/api/workspaces/select','POST',{id});assert.equal((await owner.call('/api/state')).value.settings.brandLogoId,logo.id);assert.equal((await owner.call('/api/brand/logo','DELETE',{})).status,200);assert.equal((await second.call('/api/login','POST',{username:'owner',password})).status,401);assert.equal((await second.call('/api/login','POST',{username:'owner',password:'global-new-password'})).status,200);
});
