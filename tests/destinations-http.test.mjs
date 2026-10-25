import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('destination APIs preserve manual text, scope permissions to destination IDs and isolate brands',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mohta-dest-http-')),reservation=http.createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));
 const origin='http://127.0.0.1:'+port,child=spawn(process.execPath,['server.mjs'],{cwd:fileURLToPath(new URL('../',import.meta.url)),env:{...process.env,HOST:'127.0.0.1',PORT:String(port),DATA_DIR:dir},windowsHide:true,stdio:'ignore'});
 t.after(async()=>{if(child.exitCode===null){const done=new Promise(r=>child.once('exit',r));child.kill();await done;}fs.rmSync(dir,{recursive:true,force:true});});
 for(let i=0;i<100;i++){try{if((await fetch(origin+'/healthz')).ok)break;}catch{}await new Promise(r=>setTimeout(r,40));}
 function client(){const cookies=new Map();let csrf='';return async(route,method='GET',data,headers={})=>{const res=await fetch(origin+route,{method,headers:{Cookie:[...cookies].map(([k,v])=>k+'='+v).join('; '),'X-CSRF-Token':csrf,...(data?{'Content-Type':'application/json'}:{}),...headers},body:data?JSON.stringify(data):undefined});for(const raw of res.headers.getSetCookie()){const pair=raw.split(';')[0],i=pair.indexOf('=');cookies.set(pair.slice(0,i),pair.slice(i+1));}const value=await res.json();if(value.csrf)csrf=value.csrf;return {status:res.status,value};};}
 const owner=client(),member=client(),password='fixture-password-123';assert.equal((await owner('/api/setup','POST',{username:'owner',name:'Owner',password})).status,200);
 const first=(await owner('/api/channels','POST',{platform:'telegram',name:'One'})).value.channel,second=(await owner('/api/channels','POST',{platform:'telegram',name:'Two'})).value.channel;
 assert.notEqual(first.id,second.id);assert.notEqual(first.id,first.platform);
 const input={type:'stock',title:'Form title',fields:{brand:'HPE',model:'DL380'},body:'Manual caption 👋',body_entities:[{type:'bold',offset:0,length:6}],body_mode:'manual',body_source:'source-signature',channels:[first.id,second.id],media:[]};
 const created=await owner('/api/posts','POST',input);assert.equal(created.status,201);assert.equal(created.value.post.body,input.body);
 const saved=await owner('/api/posts/'+created.value.post.id,'PUT',{...input,title:'Changed form title',fields:{brand:'HPE',model:'DL360'},version:1});assert.equal(saved.status,200);assert.equal(saved.value.post.body,input.body);assert.equal(saved.value.post.body_mode,'manual');
 let snapshot=(await owner('/api/state')).value;const reopened=snapshot.posts.find(p=>p.id===created.value.post.id);assert.deepEqual(reopened.body_entities,input.body_entities);assert.equal(reopened.body_source,input.body_source);assert(snapshot.channels.some(c=>c.id===second.id&&c.platform==='telegram'));
 assert.equal((await owner('/api/users','POST',{username:'writer',name:'Writer',password,role:'editor',channels:[first.id]})).status,201);await member('/api/login','POST',{username:'writer',password});
 snapshot=(await member('/api/state')).value;assert.deepEqual(snapshot.user.channels,[first.id]);assert(!snapshot.channels.some(c=>c.id===second.id));assert.equal((await member('/api/posts','POST',input)).status,403);assert.equal((await member('/api/channels','POST',{platform:'telegram',name:'Forbidden'})).status,403);
 const draft=await owner('/api/posts','POST',{type:'free',fields:{description:'Unassigned draft'},channels:[],media:[]});assert.equal(draft.status,201);assert.equal((await owner('/api/posts/'+draft.value.post.id,'PUT',{type:'free',title:'Saved again',fields:{description:'Unassigned draft'},channels:[],media:[],version:1})).status,200);assert.equal((await owner('/api/posts/'+draft.value.post.id+'/ready','POST',{version:2})).status,400);
 assert.equal((await owner('/api/channels/'+second.id,'DELETE')).status,200);snapshot=(await owner('/api/state')).value;assert(!snapshot.channels.some(c=>c.id===second.id));assert(snapshot.destinationMap[second.id].deleted);assert(snapshot.posts.find(p=>p.id===created.value.post.id).channels.includes(second.id));
 const brand=(await owner('/api/workspaces','POST',{name:'Other brand'})).value.workspace;await owner('/api/workspaces/select','POST',{id:brand.id});assert.equal((await owner('/api/posts','POST',{...input,channels:[first.id]})).status,400);
 assert.equal((await owner('/api/channels/'+first.id,'PUT',{route:'direct',enabled:false})).status,404);
});
