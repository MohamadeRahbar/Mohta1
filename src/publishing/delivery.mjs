import {normalizeEntities} from '../../public/rich-text.js';
import {check} from '../content/content.mjs';
import {appendContacts,contactEntities} from '../../public/contacts.js';
import {publicationMedia} from '../../public/media.js';
import {rubikaEntities} from '../../public/rubika-format.js';
import {documentForDestination} from '../../public/destination-documents.js';

// A post has either one media item or an ordered album with one caption.
export function delivery(post,destination=post.channels?.[0]||'telegram') {
 const platform=typeof destination==='object'?destination.platform:destination;
 const mediaIds=publicationMedia(post),mediaId=mediaIds[0]||null;
 const document=documentForDestination(post,destination),rendered=appendContacts(document.body,post.type==='free'?undefined:post.fields?.contact_config,platform),headline=document.body.split('\n')[0];
 const sourceEntities=[...normalizeEntities(document.body,[...(headline&&post.type!=='free'&&!document.custom?[{type:'bold',offset:0,length:headline.length}]:[]),...document.entities]),...contactEntities(rendered.links,platform)];
 const entities=platform==='rubika'?rubikaEntities(rendered.body,sourceEntities):sourceEntities;
 return {mode:mediaIds.length>1?'media_album':mediaId?'media_caption':'text',mediaId,caption:mediaId?rendered.body:null,text:mediaId?null:rendered.body,entities,messageCount:mediaIds.length||1,...(mediaIds.length>1?{mediaIds,captionCount:1,grouped:true}:{})};
}

export function validateReady(post,channels=[]) {
 check(post.channels?.length,'حداقل یک کانال مقصد انتخاب کنید');
 check(!post.media?.length||publicationMedia(post).length,'دست‌کم یک تصویر یا کلیپ را برای پست انتخاب کنید.');
 const destinations=post.channels.map(id=>channels.find(c=>c.id===id)||{id,platform:id});
 for(const destination of destinations)check(documentForDestination(post,destination).body.trim()||publicationMedia(post).length,'متن پیام '+(destination.name||destination.id)+' یا یک رسانه را وارد کنید.');
 const payload=delivery(post,destinations[0]||'telegram');
 for(const destination of destinations.filter(c=>c.platform==='telegram')){const telegram=delivery(post,destination);
 if(telegram.mediaId)check(telegram.caption.length<=1024,'کپشن تلگرام'+(destination.name?' ('+destination.name+')':'')+' با راه‌های ارتباطی حداکثر ۱۰۲۴ کاراکتر است. متن را کوتاه کنید؛ کپشن به پیام جدا تبدیل نمی‌شود.');
 if(telegram.mode==='text')check(telegram.text.length<=4096,'متن تلگرام'+(destination.name?' ('+destination.name+')':'')+' با راه‌های ارتباطی حداکثر ۴۰۹۶ کاراکتر است. متن را کوتاه کنید.');}
 return payload;
}
