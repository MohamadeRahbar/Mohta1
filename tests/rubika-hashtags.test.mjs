import test from 'node:test';
import assert from 'node:assert/strict';
import {hashtagRanges,rubikaEntities} from '../public/rubika-format.js';
import {delivery} from '../delivery.mjs';
import {sendPost} from '../publish-adapters.mjs';
test('Rubika styles keep native hashtag ranges plain without changing text, UTF-16 offsets or explicit links',()=>{
 const body='👋🏻 فروش #سرور_نیو و #HPE و #آفر',all={type:'bold',offset:0,length:body.length},tags=hashtagRanges(body);
 assert.deepEqual(tags.map(tag=>body.slice(tag.offset,tag.offset+tag.length)),['#سرور_نیو','#HPE','#آفر']);
 const entities=rubikaEntities(body,[all,{type:'underline',offset:tags[0].offset,length:tags[0].length},{type:'text_link',...tags[0],url:'https://example.com/'}]);
 for(const mark of entities.filter(e=>e.type!=='text_link'))for(const tag of tags)assert(mark.offset+mark.length<=tag.offset||mark.offset>=tag.offset+tag.length);
 assert.equal(entities.find(e=>e.type==='text_link').url,'https://example.com/');
 const post={type:'free',body,body_entities:[all],media:[],channels:['rubika']};
 assert.equal(delivery(post,'rubika').text,body);assert.deepEqual(delivery(post,'telegram').entities,[all]);
});
test('URL fragments and adjacent word fragments are not rewritten as hashtags',()=>{
 const body='https://example.com/#anchor name#suffix ##double (#درست)\n#تست\u200cدو';
 assert.deepEqual(hashtagRanges(body).map(tag=>body.slice(tag.offset,tag.offset+tag.length)),['#درست','#تست\u200cدو']);
});
test('actual Rubika adapter sends unchanged hashtag text with only documented non-overlapping metadata',async()=>{
 const body='پیشنهاد #آفر و #موجودی',calls=[];
 await sendPost({type:'free',body,body_entities:[{type:'bold',offset:0,length:body.length}],media:[],channels:['rubika']},{platform:'rubika',target:'c0fixturechannel'},{token:'fixture-token-12345',files:[],resolveRoute:async()=>({proxy:''}),request:async(url,options)=>{calls.push(options.body);return url.endsWith('/getChat')?{status:200,data:{status:'OK',data:{chat:{chat_type:'Channel',chat_id:'c0fixturechannel'}}}}:{status:200,data:{status:'OK',data:{message_id:'fixture-id'}}};}});
 const wire=calls.at(-1);assert.equal(wire.text,body);assert(wire.metadata.meta_data_parts.every(e=>e.type==='Bold'));
 for(const part of wire.metadata.meta_data_parts)for(const tag of hashtagRanges(body))assert(part.from_index+part.length<=tag.offset||part.from_index>=tag.offset+tag.length);
});
