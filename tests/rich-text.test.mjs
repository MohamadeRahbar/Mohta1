import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeEntities,cleanDocument,rebaseEntities,richMarkup} from '../public/rich-text.js';
import {validateFields,renderContentDocument,prepareDocument,postTitle} from '../content.mjs';
import {delivery,validateReady} from '../delivery.mjs';
import {buildTextPrompt} from '../text-assist.mjs';
const settings={brand:'BRAND',contact:'CONTACT',website:'https://brand.example',currency:'تومان'};
const message='سلام و درود خدمت همراهان گرامی 👋🏻\nامروز سورپرایز ویژه ای داریم تا خرید شما با تخفیف وِیژه انجام شود\nهمراه ما باشید';
test('free messages contain exactly the authored text for every destination, even with defaults and injected footers',()=>{
 const fields=validateFields('free',{description:message,brand:'PRODUCT',cta:'BUY',specs:'SPEC',contact_override:'PHONE',contact_config:{phones:[],admins:{telegram:'@test_admin'}}});
 const result=renderContentDocument('free','INTERNAL LABEL',fields,settings);assert.equal(result.body,message);assert.deepEqual(result.entities,[]);
 assert.equal(postTitle('free','',fields),message.split('\n')[0]);
 for(const platform of ['telegram','bale','rubika','whatsapp','eitaa']){const payload=delivery({type:'free',body:result.body,fields,media:[],channels:[platform]});assert.equal(payload.text,message);assert.deepEqual(payload.entities,[]);}
 assert.throws(()=>validateReady({type:'free',body:' ',media:[],channels:['telegram']}),/متن پیام/);
 assert.equal(validateReady({type:'free',body:'',media:['photo'],publication_media_ids:['photo'],channels:['telegram']}).caption,'');
});
test('formatting is validated on UTF-16 boundaries, including emoji and hostile metadata',()=>{
 const body='👋🏻 سلام';assert.deepEqual(normalizeEntities(body,[{type:'bold',offset:5,length:4}]),[{type:'bold',offset:5,length:4}]);
 for(const entities of [null,{},[{type:'script',offset:0,length:1}],[{type:'bold',offset:1,length:1}],[{type:'italic',offset:-1,length:2}],[{type:'underline',offset:0,length:100}],[{type:'bold',offset:0,length:1.1}]])assert.throws(()=>normalizeEntities(body,entities),/قالب/);
 const html=richMarkup('<img src=x onerror=alert(1)>',[{type:'bold',offset:0,length:4}],[{url:'javascript:alert(1)',offset:0,length:4}]);assert(!html.includes('<img'));assert(!html.includes('href='));assert(html.includes('&lt;img'));
});
test('crossing marks become valid nested runs and trim/blank-line cleanup preserves their positions',()=>{
 const entities=normalizeEntities('abcdef',[{type:'bold',offset:0,length:4},{type:'italic',offset:2,length:4}]);
 for(const a of entities)for(const b of entities)assert(!(a.offset<b.offset&&b.offset<a.offset+a.length&&a.offset+a.length<b.offset+b.length));
 const cleaned=cleanDocument('  👋🏻\n\n\nمتن  ',[{type:'underline',offset:9,length:3}],true);assert.equal(cleaned.body,'👋🏻\n\nمتن');assert.equal(cleaned.body.slice(cleaned.entities[0].offset,cleaned.entities[0].offset+cleaned.entities[0].length),'متن');
});
test('all template categories retain the description styles through caption generation',()=>{
 assert.throws(()=>renderContentDocument('stock','عنوان',{brand:'A',model:'B',description:'x'.repeat(10000),specs:'y'.repeat(6000)},settings),/اندازه/);
 for(const [type,extra] of [['stock',{brand:'A',model:'B'}],['proof',{event:'واقعی',stage:'shipped'}],['prices',{rows:'A | B | 1 | تأمین'}],['blog',{summary:'منبع',source:'https://example.com'}],['free',{}]]){
 const fields=validateFields(type,{...extra,description:'  👋🏻 متن\n\n\nادامه  ',description_entities:[{type:'italic',offset:7,length:3}]});
 const result=renderContentDocument(type,'عنوان',fields,settings);assert.equal(result.body.slice(result.entities[0].offset,result.entities[0].offset+result.entities[0].length),'متن');
 const prepared=prepareDocument({type,body:result.body,body_entities:result.entities},'عنوان تازه',fields,settings,'عنوان');assert.equal(prepared.body.slice(prepared.entities[0].offset,prepared.entities[0].offset+prepared.entities[0].length),'متن');
 }
});
test('direct edits rebase unaffected marks and remove marks from replaced content',()=>{
 const before='عنوان\n\n👋🏻 متن',marks=[{type:'bold',offset:12,length:3}];const after='عنوان جدید\n\n👋🏻 متن';
 const ranges=rebaseEntities(before,after,marks);assert.equal(after.slice(ranges[0].offset,ranges[0].offset+ranges[0].length),'متن');assert.deepEqual(rebaseEntities('قدیم','تازه',[{type:'italic',offset:0,length:4}]),[]);
});
test('headline and authored marks cannot produce duplicate or crossing delivery entities',()=>{
 const post={type:'stock',body:'عنوان\nمتن',body_entities:[{type:'bold',offset:0,length:9},{type:'italic',offset:2,length:7}],media:[],channels:['telegram']};
 const entities=delivery(post).entities;assert.equal(new Set(entities.map(e=>JSON.stringify(e))).size,entities.length);
 for(const a of entities)for(const b of entities)assert(!(a.offset<b.offset&&b.offset<a.offset+a.length&&a.offset+a.length<b.offset+b.length));
});
test('free text assistance asks for only the requested message and excludes brand defaults',()=>{
 const prompt=buildTextPrompt({type:'free',target:'caption',current:message,fields:{}},settings).prompt;assert(prompt.includes('پیام آزاد'));assert(!prompt.includes('BRAND'));assert(!prompt.includes('CONTACT'));assert(!prompt.includes('brand.example'));assert(!prompt.includes('خط اول یک عنوان'));
});
