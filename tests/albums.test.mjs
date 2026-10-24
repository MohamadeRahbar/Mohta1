import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';
import {publicationMedia} from '../public/media.js';import {delivery,validateReady} from '../delivery.mjs';import {streamMedia} from '../media-stream.mjs';

test('albums preserve selection and order, with one caption and no additional text message',()=>{
 const post={media:['first','clip','unused','last'],publication_media_ids:['clip','last','first'],body:'عنوان\n\nمتن',channels:['telegram'],fields:{contact_config:{phones:[{type:'phone',number:'02112345678'}]}}};
 const payload=delivery(post);assert.equal(payload.mode,'media_album');assert.deepEqual(payload.mediaIds,['clip','last','first']);assert.equal(payload.captionCount,1);assert.equal(payload.messageCount,3);assert.equal(payload.grouped,true);assert.equal(payload.text,null);assert.equal(payload.caption.split('عنوان').length,2);assert(payload.caption.includes('02112345678'));
 assert.throws(()=>validateReady({...post,body:'x'.repeat(1024)}),/۱۰۲۴/);assert.equal(validateReady({...post,body:'عنوان'}).mode,'media_album');
});

test('legacy single selections never silently include extra files, and invalid albums are rejected',()=>{
 const post={media:['reference','chosen'],primary_media_id:'chosen'};assert.deepEqual(publicationMedia(post),['chosen']);
 for(const ids of [null,'chosen',['chosen','chosen'],['missing'],[true],Array.from({length:9},(_,i)=>String(i))])assert.throws(()=>publicationMedia({...post,publication_media_ids:ids}));
 assert.throws(()=>validateReady({...post,publication_media_ids:[],body:'عنوان',channels:['telegram']}));
});

test('media streams support seeking, suffix ranges, HEAD, invalid ranges and client disconnect',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'desk-stream-')),file=path.join(directory,'clip.mp4'),bytes=Buffer.from('0123456789');fs.writeFileSync(file,bytes);
 const server=http.createServer((req,res)=>streamMedia(req,res,file,{mime:'video/mp4'}));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port;
 try{
   for(const [range,expected] of [['bytes=2-5','2345'],['bytes=7-','789'],['bytes=-3','789'],['bytes=8-99','89']]){const response=await fetch(url,{headers:{Range:range}});assert.equal(response.status,206);assert.equal(response.headers.get('accept-ranges'),'bytes');assert.equal(await response.text(),expected);}
   for(const range of ['bytes=99-','bytes=4-2','bytes=-0','bytes=0-1,3-4','invalid']){const response=await fetch(url,{headers:{Range:range}});assert.equal(response.status,416);assert.equal(response.headers.get('content-range'),'bytes */10');}
   const head=await fetch(url,{method:'HEAD'});assert.equal(head.status,200);assert.equal(head.headers.get('content-length'),'10');assert.equal(await head.text(),'');assert.equal(await (await fetch(url)).text(),'0123456789');
 }finally{await new Promise(resolve=>server.close(resolve));fs.rmSync(directory,{recursive:true,force:true});}
});
