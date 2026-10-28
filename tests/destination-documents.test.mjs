import test from 'node:test';
import assert from 'node:assert/strict';
import {destinationDocuments} from '../src/content/destination-documents.mjs';
import {documentForDestination} from '../public/destination-documents.js';
import {delivery,validateReady} from '../src/publishing/delivery.mjs';
import {sendPost} from '../src/publishing/publish-adapters.mjs';

const post={type:'free',body:'مشترک',body_entities:[],fields:{},channels:['a','b'],media:[],destination_documents:{a:{body:'سلام 👋 دنیا',entities:[{type:'bold',offset:0,length:4}]}}};
test('destination documents use channel identity and preserve explicit empty captions',()=>{
 assert.equal(documentForDestination(post,{id:'a',platform:'telegram'}).body,'سلام 👋 دنیا');
 assert.equal(documentForDestination(post,'b').body,'مشترک');
 assert.equal(delivery(post,{id:'a',platform:'telegram'}).text,'سلام 👋 دنیا');
 assert.equal(delivery(post,{id:'b',platform:'telegram'}).text,'مشترک');
 const empty={...post,destination_documents:{a:{body:'',entities:[]}}};
 assert.throws(()=>validateReady(empty,[{id:'a',platform:'telegram'},{id:'b',platform:'telegram'}]),/متن/);
 assert.equal(delivery({...empty,media:['image'],publication_media_ids:['image']},{id:'a',platform:'telegram'}).caption,'');
 assert.throws(()=>validateReady({...post,destination_documents:{b:{body:'x'.repeat(4097),entities:[]}}},[{id:'a',platform:'telegram'},{id:'b',platform:'telegram'}]),/۴۰۹۶/);
});
test('server normalization validates selected destinations, entities and preserves omitted versions',()=>{
 const normalized=destinationDocuments(post.destination_documents,['a','b']);
 assert.deepEqual(destinationDocuments(undefined,['a'],normalized),normalized);
 assert.deepEqual(destinationDocuments(undefined,['b'],normalized),{});
 assert.deepEqual(destinationDocuments({},['a'],normalized),{});
 assert.throws(()=>destinationDocuments(normalized,['b']),/مقصد/);
 assert.throws(()=>destinationDocuments(null,['a']),/معتبر/);
 assert.throws(()=>destinationDocuments({a:{body:'x',entities:[{type:'bold',offset:0,length:9}]}},['a']),/محدوده|بازه|متن|قالب/);
 assert.throws(()=>destinationDocuments({a:{body:'x'.repeat(15001)}},['a']));
});
test('real adapter payloads retain distinct messages for two channels on the same platform',async()=>{
 const requests=[];
 for(const id of ['a','b'])await sendPost(post,{id,platform:'telegram',target:'@fixture_channel'},{token:'123:'+('fixture_secret_'.repeat(3)),files:[],request:async(url,options)=>{
  if(url.endsWith('/getChat'))return {status:200,data:{ok:true,result:{id:-100123,type:'channel'}}};
  requests.push(options);return {status:200,data:{ok:true,result:{message_id:123}}};
 },resolveRoute:async()=>({proxy:''})});
 const payloads=requests.map(r=>JSON.stringify(r));
 assert(payloads[0].includes('سلام'));assert(payloads[1].includes('مشترک'));assert(!payloads[1].includes('سلام'));
});
