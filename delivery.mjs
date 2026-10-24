import {normalizeEntities} from './public/rich-text.js';
import {check} from './content.mjs';
import {appendContacts,contactEntities} from './public/contacts.js';
import {publicationMedia} from './public/media.js';

// A post has either one media item or an ordered album with one caption.
export function delivery(post,destination=post.channels?.[0]||'telegram') {
 const platform=typeof destination==='object'?destination.platform:destination;
 const mediaIds=publicationMedia(post),mediaId=mediaIds[0]||null;
 const rendered=appendContacts(post.body,post.type==='free'?undefined:post.fields?.contact_config,platform),headline=post.body.split('\n')[0];
 const entities=[...normalizeEntities(post.body,[...(headline&&post.type!=='free'?[{type:'bold',offset:0,length:headline.length}]:[]),...(post.body_entities||[])]),...contactEntities(rendered.links,platform)];
 return {mode:mediaIds.length>1?'media_album':mediaId?'media_caption':'text',mediaId,caption:mediaId?rendered.body:null,text:mediaId?null:rendered.body,entities,messageCount:mediaIds.length||1,...(mediaIds.length>1?{mediaIds,captionCount:1,grouped:true}:{})};
}

export function validateReady(post,channels=[]) {
 check(post.channels?.length,'حداقل یک کانال مقصد انتخاب کنید');
 check(!post.media?.length||publicationMedia(post).length,'دست‌کم یک تصویر یا کلیپ را برای پست انتخاب کنید.');
 check(post.body.trim()||publicationMedia(post).length,'متن پیام یا یک رسانه را وارد کنید.');
 const destinations=post.channels.map(id=>channels.find(c=>c.id===id)||{id,platform:id});
 const payload=delivery(post,destinations[0]||'telegram');
 const telegram=destinations.some(c=>c.platform==='telegram')?delivery(post,'telegram'):null;
 if(telegram?.mediaId)check(telegram.caption.length<=1024,'کپشن تلگرام با راه‌های ارتباطی حداکثر ۱۰۲۴ کاراکتر است. متن را کوتاه کنید؛ کپشن به پیام جدا تبدیل نمی‌شود.');
 if(telegram?.mode==='text')check(telegram.text.length<=4096,'متن تلگرام با راه‌های ارتباطی حداکثر ۴۰۹۶ کاراکتر است. متن را کوتاه کنید.');
 return payload;
}
