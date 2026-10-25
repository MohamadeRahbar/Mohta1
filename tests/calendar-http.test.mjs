import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {openStore} from '../store.mjs';

test('calendar and post detail APIs enforce authentication, destination grants, timezone validation and brand isolation',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'mohta-cal-http-')),reservation=http.createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));
 const origin='http://127.0.0.1:'+port,child=spawn(process.execPath,['server.mjs'],{cwd:fileURLToPath(new URL('../',import.meta.url)),env:{...process.env,HOST:'127.0.0.1',PORT:String(port),DATA_DIR:directory},windowsHide:true,stdio:'ignore'});
 t.after(async()=>{if(child.exitCode===null){const done=new Promise(r=>child.once('exit',r));child.kill();await done;}fs.rmSync(directory,{recursive:true,force:true});});
 for(let i=0;i<100;i++){try{if((await fetch(origin+'/healthz')).ok)break;}catch{}await new Promise(r=>setTimeout(r,40));}
 function client(){const cookies=new Map();let csrf='';return async(route,method='GET',data,headers={})=>{const res=await fetch(origin+route,{method,headers:{Cookie:[...cookies].map(([k,v])=>k+'='+v).join('; '),'X-CSRF-Token':csrf,...(data?{'Content-Type':'application/json'}:{}),...headers},body:data?JSON.stringify(data):undefined});for(const raw of res.headers.getSetCookie()){const pair=raw.split(';')[0],i=pair.indexOf('=');cookies.set(pair.slice(0,i),pair.slice(i+1));}const value=await res.json();if(value.csrf)csrf=value.csrf;return {status:res.status,value};};}
 const owner=client(),member=client(),anonymous=client(),query='/api/calendar?'+new URLSearchParams({from:'2026-10-01T00:00:00.000Z',to:'2026-11-01T00:00:00.000Z'}),password='fixture-calendar-123';
 assert.equal((await anonymous(query)).status,401);await owner('/api/setup','POST',{username:'calowner',name:'Owner',password});
 const original=(await owner('/api/state')).value;
 const post=async(title,channels)=>{const result=await owner('/api/posts','POST',{type:'free',title,fields:{description:title},channels,media:[],scheduled_at:'2026-10-25T01:00:00.000Z'});assert.equal(result.status,201);return result.value.post;};
 const shown=await post('Visible',['telegram','bale']),hidden=await post('Hidden',['bale']);
 const db=openStore(directory);db.db.prepare("UPDATE posts SET status='published' WHERE id=?").run(shown.id);db.db.prepare("UPDATE posts SET status='ready' WHERE id=?").run(hidden.id);
 for(const channel of ['telegram','bale'])db.db.prepare("INSERT INTO publications(id,post_id,channel_id,status,version,published_at,channel_name,platform) VALUES(?,?,?,'sent',1,?,?,?)").run(shown.id+channel,shown.id,channel,'2026-10-25T01:00:00.000Z',channel,channel);db.close();
 assert.equal((await owner(query)).value.events.length,2);
 await owner('/api/users','POST',{username:'calmember',name:'Member',password,role:'viewer',channels:['telegram']});await member('/api/login','POST',{username:'calmember',password});
 const visible=(await member(query)).value;assert.equal(visible.events.length,1);assert.deepEqual(visible.events[0].destinations,['telegram']);
 const detail=(await member('/api/posts/'+shown.id)).value;assert.equal(detail.post.body,'Visible');assert.equal(detail.post.publications.length,1);assert.equal(detail.post.publications[0].channel_id,'telegram');
 assert.equal((await member('/api/posts/'+hidden.id)).status,404);assert.equal((await member('/api/settings','PUT',{timezone:'Europe/London'})).status,403);
 assert.equal((await owner('/api/settings','PUT',{...original.settings,timezone:'Not/AZone'})).status,400);
 assert.equal((await owner('/api/settings','PUT',{...original.settings,timezone:'America/New_York'})).status,200);
 assert.equal((await owner(query)).value.timeZone,'America/New_York');assert.equal((await owner('/api/posts/'+shown.id)).value.post.scheduled_at,'2026-10-25T01:00:00.000Z');
 assert.equal((await owner('/api/calendar?from=bad&to=bad')).status,400);
 for(const file of ['calendar-view.js','content-calendar.js','time-zone.js','calendar-data.js','calendar-observances.js'])assert.equal((await fetch(origin+'/'+file)).status,200);
 const other=(await owner('/api/workspaces','POST',{name:'Other brand'})).value.workspace;await owner('/api/workspaces/select','POST',{id:other.id});assert.equal((await owner(query)).value.events.length,0);assert.equal((await owner('/api/posts/'+shown.id)).status,404);assert.equal((await owner(query,'GET',undefined,{'X-Workspace-Id':original.workspace.id})).status,409);
});
