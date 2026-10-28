import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
test('custom documents survive HTTP save, reload, copy and omitted updates without altering shared text',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'desk-destination-')),reservation=http.createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));
 const origin='http://127.0.0.1:'+port,child=spawn(process.execPath,['server.mjs'],{cwd:fileURLToPath(new URL('../',import.meta.url)),env:{...process.env,HOST:'127.0.0.1',PORT:String(port),DATA_DIR:dir},windowsHide:true,stdio:'ignore'});
 let db;t.after(async()=>{db?.close();if(child.exitCode===null){const done=new Promise(r=>child.once('exit',r));child.kill();await done;}fs.rmSync(dir,{recursive:true,force:true});});
 for(let i=0;i<100;i++){try{if((await fetch(origin+'/healthz')).ok)break;}catch{}await new Promise(r=>setTimeout(r,40));}
 let csrf='';const cookies=new Map();async function call(url,method='GET',body){const r=await fetch(origin+url,{method,headers:{Cookie:[...cookies].map(([k,v])=>k+'='+v).join('; '),'X-CSRF-Token':csrf,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});for(const raw of r.headers.getSetCookie()){const pair=raw.split(';')[0],i=pair.indexOf('=');cookies.set(pair.slice(0,i),pair.slice(i+1));}const value=await r.json();if(value.csrf)csrf=value.csrf;return {status:r.status,value};}
 assert.equal((await call('/api/setup','POST',{username:'owner',name:'Owner',password:'destination-fixture-password'})).status,200);
 const input={type:'free',title:'نسخه تست',fields:{description:'متن مشترک'},channels:['telegram','bale'],media:[],destination_documents:{telegram:{body:'متن تلگرام 👋',entities:[{type:'bold',offset:0,length:3}]}}};
 let result=await call('/api/posts','POST',input);assert.equal(result.status,201,JSON.stringify(result.value));let post=result.value.post;const id=post.id;
 assert.equal(post.body,'متن مشترک');assert.deepEqual(post.destination_documents,input.destination_documents);
 const snapshot=(await call('/api/posts/'+id)).value.post;assert.equal(snapshot.deliveries.telegram.text,'متن تلگرام 👋');assert.equal(snapshot.deliveries.bale.text,'متن مشترک');
 db=new DatabaseSync(path.join(dir,'desk.sqlite'));
 assert.deepEqual(JSON.parse(db.prepare('SELECT value FROM revisions WHERE post_id=?').get(id).value).destination_documents,input.destination_documents);
 const update={...input,fields:{description:'مشترک جدید'},version:1};delete update.destination_documents;
 result=await call('/api/posts/'+id,'PUT',update);assert.equal(result.status,200);post=result.value.post;assert.equal(post.body,'مشترک جدید');assert.deepEqual(post.destination_documents,input.destination_documents);
 result=await call('/api/posts/'+id+'/copy','POST',{version:2,channels:['telegram','bale']});assert.equal(result.status,201);assert.deepEqual(result.value.post.destination_documents,input.destination_documents);
 result=await call('/api/posts/'+id+'/copy','POST',{version:2,channels:['bale']});assert.equal(result.status,201);assert.deepEqual(result.value.post.destination_documents,{});
 db.prepare("INSERT INTO publications(id,post_id,channel_id,status,version,remote_body,remote_entities) VALUES(?,?,?,'sent',2,?,'[]')").run(id+':telegram',id,'telegram','ویرایش بعد از انتشار');
 const editedSnapshot=(await call('/api/posts/'+id)).value.post;assert.equal(editedSnapshot.deliveries.telegram.text,'ویرایش بعد از انتشار');assert.equal(editedSnapshot.deliveries.bale.text,'مشترک جدید');
 result=await call('/api/posts/'+id+'/copy','POST',{version:2,channels:['telegram']});assert.equal(result.status,201);assert.equal(result.value.post.destination_documents.telegram.body,'ویرایش بعد از انتشار');
 assert.equal((await call('/api/posts','POST',{...input,destination_documents:{rubika:{body:'unselected'}}})).status,400);
 result=await call('/api/posts/'+id,'PUT',{...input,version:2,channels:['bale'],destination_documents:{}});assert.equal(result.status,200);assert.deepEqual(result.value.post.destination_documents,{});
 const legacy=await call('/api/posts','POST',{...input,destination_documents:{}});assert.equal(legacy.status,201);assert.deepEqual(legacy.value.post.destination_documents,{});
 const customOnly=await call('/api/posts','POST',{...input,fields:{description:''},channels:['telegram']});assert.equal(customOnly.status,201);assert.equal(customOnly.value.post.body,'');
 for(const asset of ['/destination-documents.js','/destination-editor.js'])assert.equal((await fetch(origin+asset)).status,200);
});
