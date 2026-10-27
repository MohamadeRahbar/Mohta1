import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {requestJson} from '../src/infrastructure/network.mjs';
import {openStore} from '../src/storage/store.mjs';
import {saveChannelSettings} from '../src/channels/channel-settings.mjs';
import {windowsProxyFor,resolveNetworkRoute,publicRoute} from '../src/infrastructure/system-network.mjs';
import {classifyApiFailure,diagnoseConnectionFailure,requestChannel} from '../src/infrastructure/connection-diagnostics.mjs';

test('system network is default; migration preserves token and explicit proxies',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'desk-network-'));let store=openStore(directory);
 try{
   assert.equal(store.db.prepare("SELECT count(*) n FROM channels WHERE route='direct'").get().n,5);
   store.saveSecret('token:telegram','example-secret');store.saveSecret('proxy:whatsapp','http://localhost:1234');
   store.db.prepare("UPDATE channels SET route='proxy' WHERE id IN ('telegram','whatsapp')").run();store.db.prepare("DELETE FROM schema_migrations WHERE id='prefer-system-network'").run();store.close();store=openStore(directory);
   assert.equal(store.db.prepare("SELECT route FROM channels WHERE id='telegram'").get().route,'direct');
   assert.equal(store.secret('token:telegram'),'example-secret');assert.equal(store.db.prepare("SELECT route FROM channels WHERE id='whatsapp'").get().route,'proxy');
   const data={name:'تلگرام',target:'target',enabled:true,route:'direct',token:'  '};saveChannelSettings(store,'telegram',data,'test');assert.equal(store.secret('token:telegram'),'example-secret');
   assert.throws(()=>saveChannelSettings(store,'telegram',{...data,route:'proxy',token:'should-not-be-written'},'test'),/VPN/);assert.equal(store.secret('token:telegram'),'example-secret');assert.equal(store.db.prepare("SELECT target FROM channels WHERE id='telegram'").get().target,'target');
   saveChannelSettings(store,'telegram',{...data,clearToken:true},'test');assert.equal(store.hasSecret('token:telegram'),false);
 }finally{store.close();fs.rmSync(directory,{recursive:true,force:true});}
});

test('Windows proxy parsing respects scheme selection, bypass and disabled setting',()=>{
 const url='https://api.telegram.org/';assert.equal(windowsProxyFor(url,{enabled:false,server:'localhost:10809'}),'');
 assert.equal(windowsProxyFor(url,{enabled:true,server:'127.0.0.1:10809'}),'http://127.0.0.1:10809/');
 assert.equal(windowsProxyFor(url,{enabled:true,server:'http=localhost:8000;https=localhost:9000'}),'http://localhost:9000/');
 assert.equal(windowsProxyFor(url,{enabled:true,server:'localhost:10809',bypass:'*.telegram.org'}),'');
});

test('manual route overrides OS; system route follows live OS settings without exposing secrets',async()=>{
 let reads=0;const readSettings=async()=>{reads++;return {enabled:true,server:'127.0.0.1:10809',available:true};};
 const manual=await resolveNetworkRoute({route:'proxy'},'https://api.telegram.org/',{manualProxy:'http://user:pass@localhost:8090',readSettings,env:{},platform:'win32'});assert.equal(reads,0);assert.equal(manual.source,'manual_proxy');assert(!JSON.stringify(publicRoute(manual)).includes('pass'));
 const auto=await resolveNetworkRoute({route:'direct'},'https://api.telegram.org/',{readSettings,env:{},platform:'win32'});assert.equal(auto.source,'windows_proxy');assert.equal(auto.proxy,'http://127.0.0.1:10809/');assert.equal(reads,1);
 const tun=await resolveNetworkRoute({route:'direct'},'https://api.telegram.org/',{readSettings:async()=>({enabled:false,available:true}),env:{},platform:'win32'});assert.equal(tun.source,'system_routing');assert.equal(tun.proxy,'');
 const changed=await resolveNetworkRoute({route:'direct'},'https://api.telegram.org/',{readSettings:async()=>({enabled:true,server:'localhost:9000'}),env:{},platform:'win32'});assert.equal(changed.proxy,'http://localhost:9000/');
});

test('environment proxy and PAC produce explicit routes and limitations',async()=>{
 const channel={route:'direct'},url='https://api.telegram.org/';
 assert.equal((await resolveNetworkRoute(channel,url,{env:{HTTPS_PROXY:'http://localhost:8000'},platform:'linux'})).source,'environment_proxy');
 assert.equal((await resolveNetworkRoute(channel,url,{env:{HTTPS_PROXY:'http://localhost:8000',NO_PROXY:'.telegram.org'},platform:'linux'})).proxy,'');
 await assert.rejects(()=>resolveNetworkRoute(channel,url,{platform:'win32',env:{},readSettings:async()=>({enabled:false,pac:true})}),/PAC/);
});

test('connectivity probe contacts only the selected messenger, on success and failure',async()=>{
 for(const fail of [false,true]){
   const calls=[];
   const result=await requestChannel({platform:'telegram'},'https://api.telegram.org/',{timeout:8000},{source:'system_routing',proxy:''},{request:async(url,options)=>{calls.push({url,options});if(fail)throw Object.assign(new Error('timeout'),{code:'ETIMEDOUT'});return {status:302};}});
   assert.equal(calls.length,1);assert.equal(calls[0].url,'https://api.telegram.org/');assert.equal(calls[0].options.body,undefined);
   if(fail){assert.equal(result.diagnostic.category,'platform_unreachable');assert.equal(result.diagnostic.vpnStatus,'unknown');assert.equal('internetReachable' in result.diagnostic,false);assert(!result.diagnostic.message.includes('VPN قطع است'));}
   else{assert.equal(result.diagnostic,null);assert.equal(result.response.status,302);}
 }
});

test('an uncertain send failure never diagnoses VPN state or retries automatically',async()=>{
 let called=false;
 const result=await diagnoseConnectionFailure({platform:'telegram'},{code:'ETIMEDOUT'},{source:'system_routing',proxy:''},{operation:'send',request:async()=>{called=true;}});
 assert.equal(called,false);assert.equal(result.vpnStatus,'unknown');assert.equal(result.deliveryState,'unknown');assert.equal(result.automaticRetryAllowed,false);assert(result.message.includes('تکراری'));
});

test('authentication, proxy authentication, permissions and DNS have distinct diagnoses',async()=>{
 const route={source:'system_routing',proxy:''},channel={platform:'telegram'};
 assert.equal(classifyApiFailure('telegram',{status:401,data:{ok:false,error_code:401}}).category,'token_invalid');
 assert.equal(classifyApiFailure('telegram',{status:403,data:{ok:false,error_code:403}}).category,'channel_permission');
 assert.equal(classifyApiFailure('telegram',{status:429,data:{ok:false,error_code:429}}).category,'rate_limited');
 const result=await diagnoseConnectionFailure(channel,{code:'PROXY_AUTH_REQUIRED'},route);assert.equal(result.category,'proxy_authentication');
 const dns=await diagnoseConnectionFailure(channel,{code:'ENOTFOUND'},route,{request:async()=>({status:200})});assert.equal(dns.category,'dns_error');
});

test('shared request forwards the selected proxy, and does not retry an ambiguous send',async()=>{
 let requests=0;const result=await requestChannel({platform:'telegram'},'https://api.telegram.org/',{method:'POST'},{source:'windows_proxy',proxy:'http://localhost:10809'},{operation:'send',request:async(url,options)=>{requests++;assert.equal(options.proxy,'http://localhost:10809');if(requests===1)throw Object.assign(new Error('timeout'),{code:'ETIMEDOUT'});return {status:200};}});
 assert.equal(requests,1);assert.equal(result.response,null);assert.equal(result.diagnostic.deliveryState,'unknown');assert.equal(result.diagnostic.automaticRetryAllowed,false);
});

test('HTTP CONNECT proxy authentication errors retain their own category',async()=>{
 const proxy=http.createServer();proxy.on('connect',(_request,socket)=>socket.end('HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\nConnection: close\r\n\r\n'));
 await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
 try{await assert.rejects(()=>requestJson('https://api.telegram.org/',{proxy:`http://127.0.0.1:${proxy.address().port}`,timeout:1500}),error=>error.code==='PROXY_AUTH_REQUIRED');}finally{await new Promise(resolve=>proxy.close(resolve));}
});
