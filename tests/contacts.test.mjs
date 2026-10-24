import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeContacts,appendContacts,contactEntities} from '../public/contacts.js';
import {renderContent,validateFields} from '../content.mjs';
import {delivery,validateReady} from '../delivery.mjs';

const contacts={phones:[{type:'phone',number:'۰۲۱ ۱۲۳۴ ۵۶۷۸',label:'فروش'},{type:'mobile',number:'0098 912 123 4567',label:''}],admins:{telegram:'tg_admin',bale:'@bale_admin',rubika:'@rubika_admin',whatsapp:'+989121234567',eitaa:'@eitaa_admin'}};

test('any number of phone rows can be normalized; Persian digits and international prefix are preserved',()=>{
 const value=normalizeContacts(contacts);assert.equal(value.phones[0].number,'02112345678');assert.equal(value.phones[1].number,'+989121234567');
 assert.equal(normalizeContacts({...contacts,phones:Array.from({length:120},()=>contacts.phones[0])}).phones.length,120);
 assert.equal(value.admins.telegram,'@tg_admin');assert.equal(normalizeContacts({phones:[{type:'phone',number:'',label:''}]}).phones.length,0);
});

test('invalid phone values, unsafe admin links, and unknown phone types are rejected',()=>{
 for(const phone of [{type:'mobile',number:'abc'},{type:'fax',number:'02112345678'},{type:'phone',number:'',label:'فروش'}])assert.throws(()=>normalizeContacts({phones:[phone]}));
 for(const value of ['javascript:alert(1)','https://t.me.evil.example/admin','https://user:pass@t.me/admin','name\nsecond'])assert.throws(()=>normalizeContacts({admins:{telegram:value}}));
 assert.throws(()=>normalizeContacts({admins:{whatsapp:'09121234567'}}),/کد کشور/);
});

test('each platform receives only its own admin account and all shared phone numbers',()=>{
 for(const platform of ['telegram','bale','rubika','whatsapp','eitaa']){
   const rendered=appendContacts('عنوان',contacts,platform);assert(rendered.body.includes('02112345678'));assert(rendered.body.includes('+989121234567'));
   const expected=normalizeContacts(contacts).admins[platform];assert(rendered.body.includes('ارتباط با ادمین: '+expected));
   for(const other of ['tg_admin','bale_admin','rubika_admin','eitaa_admin'])if(!expected.includes(other))assert(!rendered.body.includes(other));
 }
});

test('Telegram entities address the appended phone and admin using UTF-16 offsets',()=>{
 const rendered=appendContacts('💡 عنوان\n\nمتن',contacts,'telegram'),entities=contactEntities(rendered.links,'telegram');
 assert.equal(entities.length,3);assert.equal(entities[0].type,'phone_number');assert.equal(rendered.body.slice(entities[0].offset,entities[0].offset+entities[0].length),'02112345678');
 assert.equal(entities[2].url,'https://t.me/tg_admin');assert.equal(rendered.body.slice(entities[2].offset,entities[2].offset+entities[2].length),'@tg_admin');
 assert.deepEqual(contactEntities(rendered.links,'bale'),[]);
});

test('WhatsApp phone/username links and supplied native links retain their destination',()=>{
 assert(appendContacts('',contacts,'whatsapp').links.some(link=>link.url==='https://wa.me/989121234567'));
 assert(appendContacts('',{admins:{whatsapp:'@named_admin'}},'whatsapp').links.some(link=>link.url==='https://wa.me/named_admin'));
 assert(appendContacts('',{admins:{bale:'https://ble.ir/admin'}},'bale').links.some(link=>link.url==='https://ble.ir/admin'));
});

test('structured contacts stay out of editable base text and remain in the same delivery message',()=>{
 const fields=validateFields('stock',{brand:'Cisco',model:'A',contact_config:contacts});
 const body=renderContent('stock','عنوان',fields,{contact:'legacy default',website:'https://example.com',currency:'تومان'});
 assert(!body.includes('tg_admin'));assert(!body.includes('legacy default'));assert.equal(body.match(/example.com/g).length,1);
 const post={body,fields,channels:['telegram','bale'],media:['photo'],primary_media_id:'photo'};
 const tg=delivery(post,'telegram'),bale=delivery(post,'bale');assert.equal(tg.messageCount,1);assert.equal(tg.mode,'media_caption');assert(tg.caption.includes('@tg_admin'));assert(!bale.caption.includes('@tg_admin'));assert(bale.caption.includes('@bale_admin'));
 assert.equal(tg.entities[0].type,'bold');
});

test('Telegram limits include contact footer even when Telegram is not the first destination',()=>{
 const post={body:'x'.repeat(1020),fields:{contact_config:contacts},channels:['bale','telegram'],media:['photo'],primary_media_id:'photo'};
 assert.throws(()=>validateReady(post),/۱۰۲۴/);assert.equal(validateReady({...post,body:'عنوان'}).messageCount,1);
});
