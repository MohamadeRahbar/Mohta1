import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';

test('HTTP queue persists approvals, cancels edits, and the real background timer serves both brands after logout',async t=>{
 const root=fileURLToPath(new URL('../',import.meta.url)),directory=fs.mkdtempSync(path.join(os.tmpdir(),'desk-scheduler-http-'));
 const reserve=http.createServer();await new Promise(resolve=>reserve.listen(0,'127.0.0.1',resolve));const port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve));
 const origin='http://127.0.0.1:'+port,child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,DATA_DIR:directory,HOST:'127.0.0.1',PORT:String(port)},windowsHide:true,stdio:['ignore','pipe','pipe']});let logs='';child.stdout.on('data',v=>logs+=v);child.stderr.on('data',v=>logs+=v);
 t.after(async()=>{if(child.exitCode===null){const exit=new Promise(resolve=>child.once('exit',resolve));child.kill();await exit;}fs.rmSync(directory,{recursive:true,force:true});});
 for(let i=0;i<100;i++){try{if((await fetch(origin+'/healthz')).ok)break;}catch{}await new Promise(resolve=>setTimeout(resolve,40));if(i===99)throw Error(logs);}
 const jar=new Map();let csrf='';
 async function call(route,method='GET',body){const res=await fetch(origin+route,{method,headers:{Cookie:[...jar].map(([k,v])=>k+'='+v).join('; '),'X-CSRF-Token':csrf,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});for(const cookie of res.headers.getSetCookie()){const [pair]=cookie.split(';'),split=pair.indexOf('=');jar.set(pair.slice(0,split),pair.slice(split+1));}const value=await res.json();if(value.csrf)csrf=value.csrf;return {status:res.status,value};}
 assert.equal((await call('/api/setup','POST',{username:'scheduler',name:'Scheduler',password:'scheduler-fixture-password'})).status,200);
 const scheduled_at=new Date(Date.now()+4000).toISOString(),input={type:'free',title:'Scheduled',fields:{description:'Fixture only, channels disabled'},media:[],channels:['telegram'],scheduled_at};
 const first=(await call('/api/posts','POST',input)).value.post;
 assert.equal((await call('/api/posts/'+first.id+'/ready','POST',{})).status,409);
 assert.equal((await call('/api/posts/'+first.id+'/ready','POST',{version:99})).status,409);
 assert.equal((await call('/api/posts/'+first.id+'/ready','POST',{version:1})).value.automatic,true);
 const edited=(await call('/api/posts','POST',{...input,scheduled_at:new Date(Date.now()+600000).toISOString()})).value.post;
 await call('/api/posts/'+edited.id+'/ready','POST',{version:1});
 assert.equal((await call('/api/posts/'+edited.id,'PUT',{...input,scheduled_at:edited.scheduled_at,version:1})).status,200);
 assert.equal((await call('/api/state')).value.posts.find(p=>p.id===edited.id).schedule,null);
 const other=(await call('/api/workspaces','POST',{name:'Second isolated brand'})).value.workspace;
 await call('/api/workspaces/select','POST',{id:other.id});
 const second=(await call('/api/posts','POST',input)).value.post;assert.equal((await call('/api/posts/'+second.id+'/ready','POST',{version:1})).status,200);
 await call('/api/logout','POST',{});
 const files=[path.join(directory,'desk.sqlite'),path.join(directory,'brands',other.id,'desk.sqlite')];
 let states=[];
 for(let i=0;i<80;i++){
  states=files.map(file=>{const db=new DatabaseSync(file,{readOnly:true});const row=db.prepare('SELECT state FROM scheduled_publications WHERE post_id=?').get(file===files[0]?first.id:second.id);db.close();return row?.state;});
  if(states.every(state=>state==='failed'))break;await new Promise(resolve=>setTimeout(resolve,100));
 }
 assert.deepEqual(states,['failed','failed']);
 for(const [index,file] of files.entries()){
  const db=new DatabaseSync(file,{readOnly:true});try{const rows=db.prepare('SELECT post_id,status FROM publications').all();assert.equal(rows.length,1);assert.equal(rows[0].post_id,index===0?first.id:second.id);assert.equal(rows[0].status,'blocked');if(index===0)assert.equal(db.prepare('SELECT state FROM scheduled_publications WHERE post_id=?').get(edited.id).state,'cancelled');}finally{db.close();}
 }
 assert(!logs.includes('Scheduled publication check failed'));
});
