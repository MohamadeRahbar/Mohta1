import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {openStore} from '../src/storage/store.mjs';

test('message controls HTTP: pin persistence, real route receipts, CSRF, access and brand isolation',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'mohta-msg-http-')),reservation=http.createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));
 const events=path.join(directory,'network.jsonl'),origin='http://localhost:'+port,child=spawn(process.execPath,['--import','./tests/fixtures/message-network.mjs','server.mjs'],{cwd:fileURLToPath(new URL('../',import.meta.url)),env:{...process.env,HOST:'127.0.0.1',PORT:String(port),DATA_DIR:directory,FIXTURE_EVENTS:events,PUBLIC_URL:''},windowsHide:true,stdio:'ignore'});
 t.after(async()=>{if(child.exitCode===null){const done=new Promise(r=>child.once('exit',r));child.kill();await done;}fs.rmSync(directory,{recursive:true,force:true});});
 for(let i=0;i<100;i++){try{if((await fetch(origin+'/healthz')).ok)break;}catch{}await new Promise(r=>setTimeout(r,40));}
 function client(){const cookies=new Map();let csrf='';return async(route,method='GET',data,headers={})=>{const res=await fetch(origin+route,{method,headers:{Cookie:[...cookies].map(([k,v])=>k+'='+v).join('; '),'X-CSRF-Token':csrf,...(data?{'Content-Type':'application/json'}:{}),...headers},body:data?JSON.stringify(data):undefined});for(const raw of res.headers.getSetCookie()){const pair=raw.split(';')[0],i=pair.indexOf('=');cookies.set(pair.slice(0,i),pair.slice(i+1));}const value=await res.json();if(value.csrf)csrf=value.csrf;return {status:res.status,value};};}
 const owner=client(),viewer=client(),anonymous=client(),password='message-fixture-123';await owner('/api/setup','POST',{username:'msgowner',name:'Owner',password});const initial=(await owner('/api/state')).value;
 for(const asset of ['channel-selection.js','persian-date-picker.js','message-controls-ui.js','rubika-format.js'])assert.equal((await fetch(origin+'/'+asset)).status,200,asset);
 const draft={type:'free',title:'Pin fixture',fields:{description:'Original #تست'},channels:['telegram','bale'],media:[],publish_options:{pin:true}};
 let result=await owner('/api/posts','POST',draft);assert.equal(result.status,201);const id=result.value.post.id;assert.equal(result.value.post.publish_options.pin,true);
 result=await owner('/api/posts/'+id,'PUT',{...draft,version:1});assert.equal(result.status,200);assert.equal(result.value.post.publish_options.pin,true);
 const db=openStore(directory);for(const platform of ['telegram','bale']){db.saveSecret('token:'+platform,'123:fixture_token_1234567890123');db.db.prepare('UPDATE channels SET enabled=1,target=? WHERE id=?').run('@fixture',platform);}db.close();
 const published=await owner('/api/posts/'+id+'/publish','POST',{version:2});assert.equal(published.status,200);assert.equal(published.value.sent,2);
 let state=(await owner('/api/posts/'+id+'/controls')).value;assert.equal(state.receipts.length,2);assert(state.receipts.every(row=>row.pinned));
 const input={action:'edit',channels:['telegram'],request_id:randomUUID(),version:2,revision:state.revision,body:'Updated #تست',entities:[]};
 assert.equal((await anonymous('/api/posts/'+id+'/controls')).status,401);assert.equal((await owner('/api/posts/'+id+'/controls','POST',input,{'X-CSRF-Token':''})).status,403);
 await owner('/api/users','POST',{username:'msgviewer',name:'Viewer',password,role:'viewer',channels:['telegram']});await viewer('/api/login','POST',{username:'msgviewer',password});
 const visible=(await viewer('/api/posts/'+id+'/controls')).value;assert.equal(visible.receipts.length,1);assert(visible.operations.every(row=>row.channel_id==='telegram'));assert.equal((await viewer('/api/posts/'+id+'/controls','POST',input)).status,403);
 result=await owner('/api/posts/'+id+'/controls','POST',input);assert.equal(result.status,200);assert.equal(result.value.receipts.find(row=>row.channel_id==='telegram').body,input.body);
 const before=fs.readFileSync(events,'utf8');assert.equal((await owner('/api/posts/'+id+'/controls','POST',input)).status,200);assert.equal(fs.readFileSync(events,'utf8'),before);
 assert.equal((await owner('/api/posts/'+id+'/controls','POST',{...input,request_id:randomUUID()})).status,409);
 const copy=await owner('/api/posts/'+id+'/copy','POST',{version:2,channels:['telegram']});assert.equal(copy.status,201);assert.equal(copy.value.post.body,input.body);assert.equal(copy.value.post.fields.description,input.body);assert.equal(copy.value.post.body_mode,'manual');assert.equal(copy.value.post.publish_options.pin,undefined);
 assert.equal((await owner('/api/settings','PUT',{...initial.settings,trackingEnabled:true})).status,400);
 const other=(await owner('/api/workspaces','POST',{name:'Other brand'})).value.workspace;await owner('/api/workspaces/select','POST',{id:other.id});assert.equal((await owner('/api/posts/'+id+'/controls')).status,404);
 assert.equal((await owner('/api/posts/'+id+'/controls','POST',input,{'X-Workspace-Id':initial.workspace.id})).status,409);
});
