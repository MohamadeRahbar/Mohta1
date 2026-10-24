import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
test('independent brands keep their identities isolated while the app name stays fixed across restart',async t=>{
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'desk-brands-')),reserve=http.createServer();await new Promise(resolve=>reserve.listen(0,'127.0.0.1',resolve));const port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve));const origin='http://127.0.0.1:'+port;let child,logs='';
 async function start(){child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',DATA_DIR:dataDir},windowsHide:true,stdio:['ignore','pipe','pipe']});child.stdout.on('data',v=>logs+=v);child.stderr.on('data',v=>logs+=v);for(let i=0;i<100;i++){try{if((await fetch(origin+'/healthz')).ok)return;}catch{}await new Promise(resolve=>setTimeout(resolve,40));}throw Error(logs);}
 async function stop(){if(child.exitCode!==null)return;const done=new Promise(resolve=>child.once('exit',resolve));child.kill();await done;}
 t.after(async()=>{await stop();fs.rmSync(dataDir,{recursive:true,force:true});});await start();
 function client(){const jar=new Map();let csrf='';return {jar,async call(url,method='GET',body,headers={}){const response=await fetch(origin+url,{method,headers:{Cookie:[...jar].map(([k,v])=>k+'='+v).join('; '),'X-CSRF-Token':csrf,...(body?{'Content-Type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined});for(const cookie of response.headers.getSetCookie()){const [pair]=cookie.split(';'),index=pair.indexOf('=');jar.set(pair.slice(0,index),pair.slice(index+1));}const value=await response.json();if(value.csrf)csrf=value.csrf;return {status:response.status,value};},async upload(){const form=new FormData();form.set('file',new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64')],{type:'image/png'}),'fixture.png');const response=await fetch(origin+'/api/media',{method:'POST',headers:{Cookie:[...jar].map(([k,v])=>k+'='+v).join('; '),'X-CSRF-Token':csrf},body:form});return (await response.json()).media;}};}
 const owner=client(),otherTab=client(),viewer=client(),password='brand-fixture-password';
 assert.equal((await owner.call('/api/setup','POST',{username:'owner',name:'Owner',password})).status,200);
 assert.equal((await otherTab.call('/api/login','POST',{username:'owner',password})).status,200);
 const settings=(await owner.call('/api/state')).value.settings;
 assert.equal((await owner.call('/api/settings','PUT',{...settings,brand:'Original',projectName:'Original Panel'})).status,200);
 assert.equal((await owner.call('/api/state')).value.settings.projectName,'محتوان');assert.equal((await owner.call('/api/bootstrap')).value.projectName,'محتوان');
 assert.equal((await owner.call('/api/settings','PUT',{...settings,brand:'Original',projectName:'  '})).status,200);
 assert.equal((await owner.call('/api/state')).value.settings.projectName,'محتوان');
 await owner.call('/api/channels/telegram','PUT',{name:'Original',target:'@original',route:'direct',enabled:true,token:'123:fixture_secret_1234567890'});
 const media=await owner.upload(),input={type:'free',title:'Original post',fields:{description:'Original only'},channels:['telegram'],media:[media.id],publication_media_ids:[media.id]};const original=(await owner.call('/api/posts','POST',input)).value.post;
 await owner.call('/api/users','POST',{username:'viewer',name:'Viewer',password,role:'viewer',channels:['telegram']});await viewer.call('/api/login','POST',{username:'viewer',password});
 assert.equal((await viewer.call('/api/workspaces','POST',{name:'Forbidden'})).status,403);
 assert.equal((await owner.call('/api/workspaces','POST',{name:'Company'},{'X-CSRF-Token':''})).status,403);
 const created=await owner.call('/api/workspaces','POST',{name:'Company'});assert.equal(created.status,201);const id=created.value.workspace.id;
 assert.equal((await owner.call('/api/workspaces','POST',{name:'Company'})).status,409);
 assert.equal((await viewer.call('/api/workspaces/select','POST',{id})).status,403);
 assert.equal((await owner.call('/api/workspaces/select','POST',{id})).status,200);
 assert.equal((await owner.call('/api/state')).status,200);
 assert.equal((await owner.call('/api/bootstrap')).value.setupNeeded,false);
 let company=(await owner.call('/api/state')).value;assert.equal(company.workspace.id,id);assert.equal(company.posts.length,0);assert.equal(Object.keys(company.mediaMap).length,0);assert(company.channels.every(c=>!c.tokenConfigured&&!c.target));assert.equal(company.settings.brand,'Company');assert.equal(company.settings.projectName,'محتوان');assert.equal(company.ai.connected,false);
 assert.equal((await owner.call('/api/users')).value.users.length,1);
 assert.equal((await owner.call('/api/state','GET',undefined,{'X-Workspace-Id':'default'})).status,409);
 assert.equal((await owner.call('/api/posts','POST',input)).status,400);
 assert.equal((await owner.call('/api/posts/'+original.id,'PUT',{...input,version:1})).status,404);
 assert.equal((await owner.call('/api/posts/'+original.id+'/publish','POST',{version:1})).status,404);
 const mediaResponse=await fetch(origin+'/media/'+media.id,{headers:{Cookie:[...owner.jar].map(([k,v])=>k+'='+v).join('; ')}});assert.equal(mediaResponse.status,404);
 // The selected brand belongs to the central session, not an editable cookie.
 assert.equal((await otherTab.call('/api/state')).status,200);otherTab.jar.set('desk_workspace',id);assert.equal((await otherTab.call('/api/state')).value.workspace.id,'default');otherTab.jar.set('desk_workspace','default');assert.equal((await otherTab.call('/api/state')).status,200);
 assert.equal((await owner.call('/api/settings','PUT',{...company.settings,brand:'Company Renamed',projectName:'Company Panel'})).status,200);
 await stop();await start();company=(await owner.call('/api/state')).value;assert.equal(company.settings.projectName,'محتوان');assert.equal(company.settings.brand,'Company Renamed');assert.equal(company.workspace.name,'Company Renamed');assert.equal(company.posts.length,0);
 assert.equal((await owner.call('/api/workspaces/default','POST',{})).status,200);
 const restored=(await owner.call('/api/state')).value;assert.equal(restored.settings.projectName,'محتوان');assert.equal(restored.settings.brand,'Original');assert.equal(restored.posts[0].id,original.id);assert.equal(restored.channels.find(c=>c.id==='telegram').tokenConfigured,true);assert.equal(restored.workspaces.length,2);
 assert(fs.existsSync(path.join(dataDir,'brands',id,'master.key')));assert(!fs.readFileSync(path.join(dataDir,'master.key')).equals(fs.readFileSync(path.join(dataDir,'brands',id,'master.key'))));
 assert.equal((await owner.call('/api/workspaces/select','POST',{id:'../../outside'})).status,403);
});
