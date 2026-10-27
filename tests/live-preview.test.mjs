import test from 'node:test';
import assert from 'node:assert/strict';
import {previewDocument} from '../public/caption-template.js';
import {renderContentDocument,validateFields,postTitle} from '../src/content/content.mjs';
import {richMarkup} from '../public/rich-text.js';
const settings={brand:'برند نمونه',currency:'تومان',website:'https://example.com',contact:'تماس قدیمی'};
test('live preview uses the exact same content and UTF-16 styles as server rendering for all five types',()=>{
 const description='سلام 👋🏻 متن نمونه',fields={description,description_entities:[{type:'bold',offset:9,length:3}],cta:'تماس بگیرید',contact_config:{phones:[],admins:{}},specs:'نکته تکمیلی'};
 const cases={stock:{brand:'HPE',model:'DL380',price:'10000'},proof:{stage:'shipped',event:'ارسال شد'},prices:{rows:'HPE | DL380 | 10000 | تأمین'},blog:{source:'https://example.com/source',summary:'خلاصه منبع'},free:{}};
 for(const [type,specific] of Object.entries(cases)){const input={type,title:'عنوان پست',fields:{...fields,...specific}},validated=validateFields(type,input.fields),title=postTitle(type,input.title,validated),actual=previewDocument(input,settings);assert.deepEqual(actual,renderContentDocument(type,title,validated,settings),type);assert(!actual.body.includes('undefined'));assert(actual.entities.some(mark=>mark.type==='bold'));}
});
test('incomplete and cleared forms preview safely without manufacturing missing row fields or a source',()=>{
 for(const type of ['stock','proof','prices','blog','free']){const value=previewDocument({type,title:'',fields:{}},{});assert(!/undefined|null/.test(value.body),type);assert(Array.isArray(value.entities));}
 const partial=previewDocument({type:'prices',title:'لیست',fields:{rows:'HPE | DL380\nCisco | C9200 | 10000 | انبار ما'}},settings);assert(partial.body.includes('HPE | DL380'));assert(partial.body.includes('10000 تومان'));assert(!partial.body.includes('قابل تأمین'));
 const blog=previewDocument({type:'blog',title:'عنوان',fields:{summary:'خلاصه'}},settings);assert(!blog.body.includes('منبع:'));
 const free=previewDocument({type:'free',title:'نام داخلی',fields:{description:'فقط متن آزاد 👋🏻',cta:'نباید بیاید',brand:'نباید بیاید'}},settings);assert.equal(free.body,'فقط متن آزاد 👋🏻');
});
test('preview remains editable for overlong and invalid fields while saving keeps strict validation',()=>{
 const input={type:'stock',title:'پست',fields:{brand:'HPE',model:'DL380',price:'ناقص',description:'متن'.repeat(6000)}};
 const result=previewDocument(input,settings);assert(result.body.length>15000);assert(result.body.includes('ناقص'));assert.throws(()=>validateFields(input.type,input.fields));
 assert.throws(()=>validateFields('prices',{rows:'HPE | DL380'}));assert.throws(()=>validateFields('blog',{summary:'خلاصه'}));
 const hostile=previewDocument({type:'free',fields:{description:'<script>alert(1)</script>',description_entities:[]}},settings);assert(!richMarkup(hostile.body,hostile.entities).includes('<script>'));
});
