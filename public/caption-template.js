import {normalizeEntities,cleanDocument} from './rich-text.js';
function check(ok,message){if(!ok){const error=new Error(message);error.status=400;throw error;}}
export const defaultCta={stock:'برای استعلام موجودی و ثبت سفارش همین مدل با ما در ارتباط باشید.',proof:'برای مشاوره و تأمین تجهیزات موردنیازتان با ما در ارتباط باشید.',prices:'برای استعلام موجودی و قیمت نهایی و ثبت سفارش، مدل موردنظر را اعلام کنید.',blog:'برای انتخاب و تأمین تجهیزات متناسب با نیازتان، با ما مشورت کنید.'};
export function renderContentDocument(type,title,fields,settings,{partial=false}={}){
 if(type==='free')return cleanDocument(fields.description||'',fields.description_entities||[]);
 const lines=[title,''];let descriptionOffset=-1;
 const description=value=>{descriptionOffset=lines.join('\n').length+1;lines.push(value);};
 if(fields.description&&type!=='proof'&&type!=='blog'){description(fields.description);lines.push('');}
 if(type==='stock'){
   lines.push(partial?[fields.brand,fields.model].filter(Boolean).join(' | '):`${fields.brand} | ${fields.model}`,'موجود در انبار');
   if(fields.condition)lines.push(`وضعیت کالا: ${fields.condition}`);
   if(fields.price)lines.push('',`قیمت: ${fields.price} ${settings.currency}`);else lines.push('قیمت: استعلام بگیرید');
   if(fields.warranty)lines.push(`شرایط گارانتی: ${fields.warranty}`);
 }else if(type==='proof'){
   const stages={preparing:'در حال آماده‌سازی سفارش',shipped:'سفارش ارسال شد',delivered:'سفارش تحویل شد',other:''};
   if(stages[fields.stage])lines.push(stages[fields.stage]);if(fields.description)description(fields.description);else lines.push(fields.event);
   if(fields.note)lines.push('',fields.note);
 }else if(type==='prices'){
   for(const row of (fields.rows||'').split('\n').filter(x=>x.trim())){const [brand,model,price,source]=row.split('|').map(x=>x.trim());const available=source==='انبار ما'?'موجود در انبار ما':source==='تأمین'?'قابل تأمین':source;lines.push(partial?[brand,model].filter(Boolean).join(' | '):`${brand} | ${model}`,partial?[price?`${price} ${settings.currency}`:'',available].filter(Boolean).join(' — '):`${price} ${settings.currency} — ${available}`,'');}
 }else if(type==='blog'){if(fields.description)description(fields.description);else lines.push(fields.summary);if(!partial||fields.source)lines.push('',`منبع: ${fields.source}`);if(fields.note)lines.push('',fields.note);}
 if(fields.specs)lines.push('',fields.specs);
 const cta=Object.hasOwn(fields,'cta')?fields.cta:defaultCta[type];if(cta)lines.push('',cta);
 if(fields.url)lines.push('',`اطلاعات بیشتر: ${fields.url}`);
 if(settings.brand)lines.push('',settings.brand);
 if(Object.hasOwn(fields,'contact_config')){if(settings.website)lines.push(settings.website);}
 else if(Object.hasOwn(fields,'contact_override')){if(fields.contact_override)lines.push(fields.contact_override);}else{if(settings.contact)lines.push(settings.contact);if(settings.website)lines.push(settings.website);}
 const body=lines.join('\n'),entities=descriptionOffset<0?[]:normalizeEntities(fields.description,fields.description_entities||[]).map(e=>({...e,offset:e.offset+descriptionOffset}));
 check(partial||body.length<=15000,'متن نهایی از اندازهٔ مجاز بلندتر است.');
 return cleanDocument(body,entities,true);
}

// Incomplete form values may be previewed; server validation still guards saving and publishing.
export function previewDocument(data,settings){
 const fields={};for(const [key,value] of Object.entries(data.fields||{}))if(typeof value==='string')fields[key]=value.trim();
 if(Object.hasOwn(data.fields||{},'contact_config'))fields.contact_config=data.fields.contact_config;
 const description=cleanDocument(data.fields?.description||'',data.fields?.description_entities||[]);fields.description=description.body;fields.description_entities=description.entities;
 return renderContentDocument(data.type,String(data.title||'').trim(),fields,settings,{partial:true});
}
