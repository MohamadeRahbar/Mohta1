import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openStore} from '../src/storage/store.mjs';
import {createChannelVerifier} from '../src/channels/channel-verifier.mjs';
import {checkChannelAccess} from '../src/channels/channel-access.mjs';
const token='123456:FAKE_LOCAL_TEST_TOKEN_123456789',bot={id:123456,is_bot:true},chat={id:-1001234567,type:'channel',title:'Fixture'};
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'desk-verify-')),store=openStore(dir);t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});return store;}
const input={name:'Channel',target:'@fixture',route:'direct',enabled:true,token};
function checker(responses){return (channel,options)=>checkChannelAccess(channel,{...options,resolveRoute:async()=>({proxy:'',source:'system_routing'}),request:async(url)=>{const method=url.split('/').pop();assert(['getMe','getChat','getChatMember'].includes(method));const response=responses[method];if(response instanceof Error)throw response;return typeof response?.status==='number'?response:{status:200,data:{ok:true,result:response}};}});}
test('save and verify checks a newly configured brand with four real API stages and persists its own result',async t=>{
 const first=fixture(t),second=fixture(t),responses={getMe:bot,getChat:chat,getChatMember:{user:bot,status:'administrator',can_post_messages:true}};
 const verifier=createChannelVerifier(first,{checkAccess:checker(responses)}),result=await verifier.connect('telegram',input,'tester');
 assert.equal(result.saved,true);assert.equal(result.ok,true);assert.equal(result.deliveryState,'not_attempted');assert.deepEqual(result.checks,{network:'passed',token:'passed',channel:'passed',posting:'passed'});assert.equal(result.publishing.ready,true);
 const saved=JSON.parse(first.db.prepare("SELECT access_detail FROM channels WHERE id='telegram'").get().access_detail);assert.equal(saved.configVersion,result.configVersion);assert.equal(saved.ok,true);
 assert.equal(second.hasSecret('token:telegram'),false);assert.equal(second.db.prepare("SELECT access_detail FROM channels WHERE id='telegram'").get().access_detail,null);assert.equal(first.db.prepare('SELECT count(*) n FROM publications').get().n,0);assert(!JSON.stringify(result).includes(token));
});
test('diagnostics distinguish bad token, unreachable network, ambiguous channel and missing admin or posting rights',async t=>{
 const store=fixture(t),cases=[
  [{getMe:{status:401,data:{ok:false,error_code:401,description:token}}},'token_invalid','token','failed'],
  [{getMe:Object.assign(Error(token),{code:'ENOTFOUND'})},'dns_error','network','failed'],
  [{getMe:Object.assign(Error(token),{code:'PROXY_AUTH_REQUIRED'})},'proxy_authentication','network','failed'],
  [{getMe:{status:451,data:null}},'access_restricted','network','passed'],
  [{getMe:bot,getChat:{status:400,data:{ok:false,error_code:400,description:'Bad Request: chat not found'}}},'channel_inaccessible','channel','failed'],
  [{getMe:bot,getChat:{status:403,data:{ok:false,error_code:403,description:'Forbidden: bot was kicked from channel'}}},'bot_not_member','posting','failed'],
  [{getMe:bot,getChat:chat,getChatMember:{user:bot,status:'member'}},'posting_denied','posting','failed'],
  [{getMe:bot,getChat:chat,getChatMember:{user:bot,status:'administrator',can_post_messages:false}},'posting_denied','posting','failed'],
  [{getMe:bot,getChat:chat,getChatMember:{user:bot,status:'administrator'}},'posting_unverified','posting','unknown'],
 ];
 for(const [responses,category,step,status] of cases){const result=await createChannelVerifier(store,{checkAccess:checker(responses)}).connect('telegram',input,'tester');assert.equal(result.category,category);assert.equal(result.checks[step],status);assert.equal(result.ok,false);assert(result.nextStep);assert(!JSON.stringify(result).includes(token));assert.equal(result.vpnStatus,'unknown');}
});
test('concurrent checks are coalesced; changed credentials cannot persist stale success',async t=>{
 const store=fixture(t);store.saveSecret('token:telegram',token);let release,calls=0;const gate=new Promise(r=>release=r);
 const verifier=createChannelVerifier(store,{checkAccess:async()=>{calls++;await gate;return {ok:true,category:'posting_allowed',networkReachable:true,checks:{token:'passed',channel:'passed',posting:'passed'}};}});
 const pending=verifier.verify('telegram','tester'),also=verifier.verify('telegram','tester');assert.equal(pending,also);assert.equal(calls,1);
 store.db.prepare("UPDATE channels SET config_version=config_version+1,access_detail=NULL WHERE id='telegram'").run();release();await assert.rejects(pending,error=>error.status===409);assert.equal(store.db.prepare("SELECT access_detail FROM channels WHERE id='telegram'").get().access_detail,null);
});
test('unsupported checks and unexpected failures never become green or disclose tokens',async t=>{
 const store=fixture(t),verifier=createChannelVerifier(store,{checkAccess:async()=>({ok:false,category:'posting_unverified',networkReachable:true,message:token,checks:{token:'passed',channel:'unknown',posting:'unknown'}})});
 const result=await verifier.connect('eitaa',input,'tester');assert.equal(result.ok,false);assert.equal(result.publishing.ready,false);assert.equal(result.checks.network,'passed');assert(!JSON.stringify(result).includes(token));
 const failed=await createChannelVerifier(store,{checkAccess:async()=>{throw Error(token);}}).verify('eitaa','tester');assert.equal(failed.ok,false);assert.equal(failed.checks.network,'not_checked');assert(!JSON.stringify(failed).includes(token));
});

