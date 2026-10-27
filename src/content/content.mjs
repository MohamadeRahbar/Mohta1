import {defaultCta,renderContentDocument} from '../../public/caption-template.js';
import {normalizeEntities,cleanDocument,rebaseEntities} from '../../public/rich-text.js';
import {typeNames} from '../storage/store.mjs';
import {normalizeContacts} from '../../public/contacts.js';
export function check(ok,message,status=400){if(!ok){const error=new Error(message);error.status=status;throw error;}}
export function text(value,max=10000){check(typeof value==='string','مقدار متنی معتبر وارد کنید.');check(value.length<=max,'متن از اندازهٔ مجاز بلندتر است.');return value.trim();}
export function postTitle(type,value,fields){return type==='free'?titleText(value||fields.description?.split('\n')[0].slice(0,240)||'پیام آزاد'):titleText(value);}
export function titleText(value){const title=text(value||'',250);check(title,'عنوان را وارد کنید.');check(!/[\r\n]/.test(title),'عنوان باید فقط یک خط باشد.');return title;}
export {defaultCta,renderContentDocument} from '../../public/caption-template.js';
export function alignHeadline(title,body,previousTitle=''){
 const caption=text(body,15000),first=caption.split('\n')[0];
 const result=first===title?caption:first===previousTitle&&previousTitle?title+caption.slice(first.length):title+(caption?'\n\n'+caption:'');
 check(result.length<=15000,'متن نهایی از اندازهٔ مجاز بلندتر است.');return result;
}
export function httpUrl(value,{empty=true}={}){if(!value&&empty)return '';let url;try{url=new URL(value);}catch{check(false,'آدرس معتبر نیست.');}check(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password,'فقط آدرس http یا https بدون نام کاربری و رمز پذیرفته می‌شود.');return url.href.replace(/\/$/,'');}
function required(fields,key,label){const value=text(fields[key]||'',6000);check(value,`${label} را وارد کنید.`);return value;}
export function validateFields(type,fields){
 check(Object.hasOwn(typeNames,type),'نوع محتوا معتبر نیست.');check(fields&&typeof fields==='object'&&!Array.isArray(fields),'اطلاعات محتوا معتبر نیست.');
 const result={};for(const [key,value] of Object.entries(fields)){check(/^[a-zA-Z][a-zA-Z0-9_]{0,40}$/.test(key),'نام فیلد معتبر نیست.');if(key==='description_entities')continue;result[key]=key==='contact_config'?normalizeContacts(value):text(value,12000);}
 if(fields.description_entities!==undefined){const document=cleanDocument(fields.description||'',fields.description_entities);result.description=document.body;result.description_entities=document.entities;}
 if(type==='stock'){required(result,'brand','برند محصول');required(result,'model','مدل محصول');if(result.price)check(/^[\d۰-۹٠-٩,،.\s]+$/.test(result.price),'قیمت باید عددی باشد.');}
 if(type==='proof'){required(result,'event','شرح اتفاق واقعی');check(['preparing','shipped','delivered','other'].includes(result.stage),'مرحلهٔ سفارش را انتخاب کنید.');}
 if(type==='prices'){
   const rows=required(result,'rows','ردیف‌های قیمت').split('\n').filter(x=>x.trim());check(rows.length<=100,'حداکثر ۱۰۰ ردیف وارد کنید.');
   for(const [index,row] of rows.entries()){const parts=row.split('|').map(x=>x.trim());check(parts.length===4&&parts.every(Boolean),`ردیف ${index+1}: برند | مدل | قیمت | انبار ما یا تأمین را کامل کنید.`);check(/^[\d۰-۹٠-٩,،.\s]+$/.test(parts[2]),`قیمت ردیف ${index+1} عددی نیست.`);check(['انبار ما','تأمین'].includes(parts[3]),`وضعیت ردیف ${index+1} باید «انبار ما» یا «تأمین» باشد.`);}
 }
 if(type==='blog'){required(result,'summary','متن یا نکات منبع');required(result,'source','آدرس منبع');httpUrl(result.source,{empty:false});}
 if(result.url)httpUrl(result.url,{empty:false});
 return result;
}
export function renderContent(type,title,fields,settings){return renderContentDocument(type,title,fields,settings).body;}

export function prepareDocument(data,title,fields,settings,previousTitle=''){
 if(data.body_mode==='manual'){text(data.body??'',15000);return cleanDocument(data.body??'',data.body_entities||[]);}
 const generated=renderContentDocument(data.type,title,fields,settings);
 if(!data.body)return generated;
 const raw=text(data.body,15000),provided=data.body_entities===undefined?(raw===generated.body?generated.entities:[]):data.body_entities;
 const document=cleanDocument(data.body,provided);
 if(data.type==='free')return document;
 const body=alignHeadline(title,document.body,previousTitle);
 return {body,entities:rebaseEntities(document.body,body,document.entities)};
}

export function composerMetadata(data,previous={}){
 check(data.body_mode===undefined||['manual','generated'].includes(data.body_mode),'حالت متن معتبر نیست');
 return {body_mode:data.body_mode||(data.body!==undefined?'manual':previous.body_mode||'generated'),body_source:data.body_source?text(data.body_source,100000):previous.body_source||null};
}
