import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import {openStore} from '../store.mjs';
import {createChatGPTService,verifyOpenAIIdentity,parseResponseStream,modelPreferences} from '../chatgpt.mjs';

const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid:'test-key',alg:'RS256',use:'sig'},clientId='oaiapp_local_test';
const scope='openid email profile offline_access resource.invoke chatgpt.tokens.use.direct';
function jwt(nonce,extra={}){
 const header=Buffer.from(JSON.stringify({alg:'RS256',kid:'test-key'})).toString('base64url');
 const payload=Buffer.from(JSON.stringify({iss:'https://auth.openai.com',aud:clientId,sub:'test-subject',email:'local-test@example.invalid',nonce,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600,...extra})).toString('base64url');
 return header+'.'+payload+'.'+sign('sha256',Buffer.from(header+'.'+payload),privateKey).toString('base64url');
}
function stream(text='پیشنهاد آزمایشی'){
 return 'data: '+JSON.stringify({type:'response.output_text.delta',delta:text})+'\n\n'+'data: '+JSON.stringify({type:'response.completed',response:{status:'completed',output:[{content:[{type:'output_text',text}]}]}})+'\n\n';
}
async function fixture(run){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'desk-ai-')),store=openStore(directory),calls=[];let authorization,tokenScope=scope,issuedExpiry=3600,refreshes=0,generations=0,catalog=[{slug:'hidden',visibility:'hide'},{slug:'test-model',display_name:'Test model',visibility:'list'}];
 const service=createChatGPTService(store,{port:18878,resolveRoute:async()=>({proxy:'',source:'system_routing'}),request:async(url,options)=>{
   assert(['auth.openai.com','api.openai.com'].includes(new URL(url).hostname));calls.push({url,options});
   if(url.endsWith('/oauth/token')){
     const form=new URLSearchParams(options.rawBody);assert.equal(options.headers['Content-Type'],'application/x-www-form-urlencoded');assert.equal(form.get('client_id'),clientId);assert.equal(form.get('resource'),'https://api.openai.com/v1');
     if(form.get('grant_type')==='authorization_code'){
       assert.equal(form.get('redirect_uri'),authorization.searchParams.get('redirect_uri'));assert.equal(createHash('sha256').update(form.get('code_verifier')).digest('base64url'),authorization.searchParams.get('code_challenge'));
     }else{refreshes++;assert.equal(form.get('grant_type'),'refresh_token');}
     return {status:200,data:{token_type:'Bearer',access_token:'test-access-secret',refresh_token:'test-refresh-secret-'+refreshes,id_token:jwt(authorization.searchParams.get('nonce')),scope:tokenScope,expires_in:issuedExpiry}};
   }
   if(url.endsWith('/jwks.json'))return {status:200,data:{keys:[jwk]}};
   if(url.endsWith('/models'))return {status:200,data:{models:catalog}};
   if(url.endsWith('/responses')){generations++;assert.equal(options.body.store,false);assert.equal(options.body.stream,true);assert(Array.isArray(options.body.input));assert.equal(options.headers.Authorization,'Bearer test-access-secret');assert.equal(options.responseType,'text');return {status:200,raw:stream()};}
   if(url.endsWith('/openid-configuration'))return {status:200,data:{revocation_endpoint:'https://auth.openai.com/api/accounts/oauth/revoke'}};
   if(url.endsWith('/oauth/revoke'))return {status:200,data:null};
   assert.fail('Unexpected endpoint');
 }});
 async function connect(){const start=service.start({id:'user-1'},{sessionHash:'local-session-hash'});authorization=new URL(start.url);return service.complete(new URLSearchParams({state:authorization.searchParams.get('state'),code:'test-code',client_id:clientId}),attempt=>attempt.sessionHash==='local-session-hash');}
 try{await run({service,store,calls,connect,setScope:value=>tokenScope=value,setCatalog:value=>catalog=value,setExpiry:value=>issuedExpiry=value,counts:()=>({refreshes,generations}),authorization:()=>authorization});}finally{store.close();fs.rmSync(directory,{recursive:true,force:true});}
}

test('ID token validation requires signature, issuer, audience, nonce, expiry and subject',()=>{
 const options={jwks:{keys:[jwk]},clientId,nonce:'expected'};assert.equal(verifyOpenAIIdentity(jwt('expected'),options).subject,'test-subject');
 for(const token of [jwt('wrong'),jwt('expected',{iss:'https://attacker.invalid'}),jwt('expected',{aud:'another-app'}),jwt('expected',{exp:1}),jwt('expected',{iat:-1}),jwt('expected',{nbf:'invalid'}),jwt('expected')+'broken'])assert.throws(()=>verifyOpenAIIdentity(token,options));
 assert.throws(()=>verifyOpenAIIdentity(jwt('expected'),{...options,subject:'another-account'}));
});

test('OAuth uses fresh PKCE/state/nonce, stable host ID, and no borrowed credentials',async()=>fixture(async({service})=>{
 const a=new URL(service.start({id:'a'},{sessionHash:'session-a'}).url),b=new URL(service.start({id:'b'},{sessionHash:'session-b'}).url);
 assert.equal(a.origin,'https://auth.openai.com');assert.equal(a.searchParams.get('client_id'),'dynamic_agent_client');assert.equal(a.searchParams.get('agent_name_hint'),'Content Desk');
 assert.equal(a.searchParams.get('redirect_uri'),'http://127.0.0.1:18878/auth/callback');assert.equal(a.searchParams.get('ext_agent_host_id'),b.searchParams.get('ext_agent_host_id'));assert.match(a.searchParams.get('ext_agent_host_id'),/^urn:uuid:/);
 for(const key of ['state','nonce','code_challenge'])assert.notEqual(a.searchParams.get(key),b.searchParams.get(key));
}));

test('callback rejects unknown state, denial, wrong session and replay without replacing a connection',async()=>fixture(async({service,connect,authorization})=>{
 await assert.rejects(()=>service.complete(new URLSearchParams({state:'wrong'}),()=>true));
 await connect();const saved=service.status('user-1');assert.equal(saved.canGenerate,true);
 const original=authorization();await assert.rejects(()=>service.complete(new URLSearchParams({state:original.searchParams.get('state'),code:'replay',client_id:clientId}),()=>true));
 const started=new URL(service.start({id:'user-1'}).url);await assert.rejects(()=>service.complete(new URLSearchParams({state:started.searchParams.get('state'),error:'access_denied'}),()=>true));assert.deepEqual(service.status('user-1'),saved);
 const wrongSession=new URL(service.start({id:'another-user'},{sessionHash:'expected'}).url);await assert.rejects(()=>service.complete(new URLSearchParams({state:wrongSession.searchParams.get('state'),code:'code',client_id:clientId}),()=>false));
}));

test('identity sign-in without inference scopes cannot spend a plan or access another user account',async()=>fixture(async({service,connect,setScope,counts})=>{
 setScope('openid email profile');await connect();assert.equal(service.status('user-1').connected,true);assert.equal(service.status('user-1').canGenerate,false);
 await assert.rejects(()=>service.generate('user-1','text'));await assert.rejects(()=>service.generate('another-user','text'));assert.equal(counts().generations,0);
}));

test('tokens stay encrypted, models come from the account, and generated text is returned for review',async()=>fixture(async({service,store,connect})=>{
 await connect();assert(!JSON.stringify(service.status('user-1')).includes('test-access-secret'));
 const encrypted=store.db.prepare('SELECT value FROM secrets WHERE name=?').get('ai:chatgpt:user-1').value;assert(!encrypted.includes('test-access-secret'));
 assert.deepEqual(await service.models('user-1'),[{id:'test-model',name:'Test model',efforts:[],defaultEffort:'',unavailableEfforts:[]}]);await assert.rejects(()=>service.selectModel('user-1','unavailable-model'));
 await service.selectModel('user-1','test-model');const result=await service.generate('user-1','فقط عنوان بساز');assert.equal(result.text,'پیشنهاد آزمایشی');assert.equal(result.model,'test-model');
 const disconnected=await service.disconnect('user-1');assert.equal(disconnected.remoteRevoked,true);assert.equal(service.status('user-1').connected,false);assert.equal(store.hasSecret('ai:chatgpt:user-1'),false);
}));

test('concurrent token renewal is serialized for a rotating session',async()=>fixture(async({service,store,connect,counts})=>{
 await connect();const saved=JSON.parse(store.secret('ai:chatgpt:user-1'));saved.expiresAt=Date.now()-1;store.saveSecret('ai:chatgpt:user-1',JSON.stringify(saved));
 await Promise.all([service.models('user-1'),service.models('user-1')]);assert.equal(counts().refreshes,1);assert.equal(JSON.parse(store.secret('ai:chatgpt:user-1')).refreshToken,'test-refresh-secret-1');
}));

test('truncated, failed or incomplete output is never accepted as a completed suggestion',()=>{
 assert.equal(parseResponseStream(stream('عنوان')),'عنوان');
 for(const raw of ['data: {"type":"response.output_text.delta","delta":"نیمه"}\n\n','data: {"type":"response.failed"}\n\n','data: {"type":"response.incomplete"}\n\n','data: {"type":"response.completed","response":{"status":"incomplete"}}\n\n','data: broken\n\n'])assert.throws(()=>parseResponseStream(raw));
});

test('reasoning choices follow account capabilities, with no invented Ultra parameter',()=>{
 assert.deepEqual(modelPreferences({}),{efforts:[],defaultEffort:'',unavailableEfforts:[]});
 const prefs=modelPreferences({default_reasoning_level:'high',supported_reasoning_levels:[{effort:'low'},{effort:'high'},{effort:'ultra'},{effort:'unknown'}]});
 assert.deepEqual(prefs,{efforts:['low','high'],defaultEffort:'low',unavailableEfforts:['ultra']});
 assert.equal(modelPreferences({default_reasoning_level:'high',supported_reasoning_levels:['medium','high']}).defaultEffort,'high');
});

test('each saved reasoning level is sent to the model, and preferences persist per model and user',async()=>fixture(async({service,store,connect,setCatalog,calls,counts})=>{
 setCatalog([{slug:'test-model',visibility:'list',supported_reasoning_levels:['low','medium','high','xhigh','max','ultra']},{slug:'small-model',visibility:'list',supported_reasoning_levels:['low','medium']}]);await connect();
 await service.generate('user-1','عنوان');assert.equal(calls.filter(c=>c.url.endsWith('/responses')).at(-1).options.body.reasoning.effort,'low');
 for(const effort of ['low','medium','high','xhigh','max']){
   await service.selectModel('user-1','test-model',effort);assert.equal(service.status('user-1').effort,effort);await service.generate('user-1','عنوان');assert.equal(calls.filter(c=>c.url.endsWith('/responses')).at(-1).options.body.reasoning.effort,effort);
 }
 const count=counts().generations;for(const invalid of ['ultra','extra high','anything',null,{}])await assert.rejects(()=>service.selectModel('user-1','test-model',invalid));assert.equal(counts().generations,count);assert.equal(service.status('user-1').effort,'max');
 await service.selectModel('user-1','small-model','medium');await service.selectModel('user-1','test-model');assert.equal(service.status('user-1').effort,'max');assert.equal(service.status('another-user').effort,'');
 await service.selectModel('user-1','test-model','');await service.generate('user-1','عنوان');assert.equal(calls.filter(c=>c.url.endsWith('/responses')).at(-1).options.body.reasoning,undefined);
 const restarted=createChatGPTService(store,{port:18878});assert.equal(restarted.status('user-1').model,'test-model');assert.equal(restarted.status('user-1').effort,'');
}));

test('disconnect invalidates an in-progress authorization before it can restore access',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'desk-ai-race-')),store=openStore(directory);let release,requested;
 const started=new Promise(resolve=>requested=resolve),service=createChatGPTService(store,{port:18878,resolveRoute:async()=>({}),request:async(url)=>{
   if(url.endsWith('/oauth/token')){requested();await new Promise(resolve=>release=resolve);return {status:200,data:{token_type:'Bearer',access_token:'test-secret',expires_in:3600,scope,id_token:jwt(auth.searchParams.get('nonce'))}};}
   return {status:200,data:{keys:[jwk]}};
 }}),auth=new URL(service.start({id:'race-user'}).url);
 try{
   const completion=service.complete(new URLSearchParams({state:auth.searchParams.get('state'),code:'test',client_id:clientId}),()=>true);
   const rejected=assert.rejects(completion,/تغییر کرد/);await started;await service.disconnect('race-user');release();await rejected;assert.equal(service.status('race-user').connected,false);
 }finally{store.close();fs.rmSync(directory,{recursive:true,force:true});}
});
