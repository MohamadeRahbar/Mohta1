export const contactPlatforms={telegram:'تلگرام',bale:'بله',rubika:'روبیکا',whatsapp:'واتساپ',eitaa:'ایتا'};
const domains={telegram:['t.me'],bale:['ble.ir'],rubika:['rubika.ir'],whatsapp:['wa.me'],eitaa:['eitaa.com']};
function invalid(message){const error=new Error(message);error.status=400;throw error;}
function string(value,max=200){if(typeof value!=='string'||value.length>max)invalid('اطلاعات راه ارتباطی معتبر نیست');return value.trim();}
export function phoneNumber(value){
 const ascii=string(value,100).replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-1776)).replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-1632));
 const number=ascii.replace(/[\s().-]/g,'').replace(/^00/,'+');
 if(!/^\+?\d{5,18}$/.test(number)||(/^\+/.test(number)&&!/^\+[1-9]\d{4,14}$/.test(number)))invalid('شماره تماس را با کد شهر یا کشور وارد کنید؛ مثلا 02112345678 یا +989121234567.');
 return number;
}
export function normalizeContacts(value={}){
 if(!value||typeof value!=='object'||Array.isArray(value))invalid('اطلاعات تماس معتبر نیست');
 if(value.phones!==undefined&&!Array.isArray(value.phones))invalid('فهرست شماره ها معتبر نیست');
 const phones=[];
 for(const row of value.phones||[]){
   if(!row||typeof row!=='object'||Array.isArray(row))invalid('ردیف شماره تماس معتبر نیست');
   const number=string(row.number||'',100),label=string(row.label||'',80);
   if(!number&&!label)continue;
   if(!['phone','mobile'].includes(row.type))invalid('نوع شماره را تلفن یا موبایل انتخاب کنید');
   phones.push({type:row.type,number:phoneNumber(number),label});
 }
 const input=value.admins||{};if(typeof input!=='object'||Array.isArray(input))invalid('شناسه های ادمین معتبر نیستند');
 const admins={};
 for(const platform of Object.keys(contactPlatforms)){
   const entry=string(input[platform]||'',300);if(!entry){admins[platform]='';continue;}
   if(/^https:\/\//i.test(entry)){
     let url;try{url=new URL(entry);}catch{invalid('لینک ادمین معتبر نیست');}
     if(!domains[platform].includes(url.hostname)||url.username||url.password||url.port||!url.pathname.slice(1)||url.hash)invalid('لینک ادمین '+contactPlatforms[platform]+' باید متعلق به همان پیامرسان باشد');
     admins[platform]=url.href;continue;
   }
   if(platform==='whatsapp'&&/^[+\d۰-۹٠-٩\s().-]+$/.test(entry)){
     const number=phoneNumber(entry);if(!/^\+[1-9]\d{4,14}$/.test(number))invalid('شماره ادمین واتساپ را با کد کشور و + وارد کنید');admins[platform]=number;continue;
   }
   const handle=entry.replace(/^@/,'');if(!/^[A-Za-z][A-Za-z0-9_.]{0,63}$/.test(handle))invalid('آیدی ادمین '+contactPlatforms[platform]+' معتبر نیست');
   admins[platform]='@'+handle;
 }
 return {phones,admins,extra:string(value.extra||'',2000)};
}
export function contactBlock(value,platform='telegram'){
 const contacts=normalizeContacts(value),lines=[],links=[];
 function line(text,link){const offset=lines.join('\n').length+(lines.length?1:0);lines.push(text);if(link)links.push({...link,offset:offset+link.offset});}
 for(const phone of contacts.phones){
   const prefix=(phone.label|| (phone.type==='mobile'?'موبایل':'تلفن'))+': ';
   line(prefix+phone.number,{kind:'phone',offset:prefix.length,length:phone.number.length,url:'tel:'+phone.number});
 }
 const admin=contacts.admins[platform];
 if(admin){
   let url=admin.startsWith('https://')?admin:'';
   if(!url&&platform==='telegram')url='https://t.me/'+admin.slice(1);
   if(!url&&platform==='whatsapp')url='https://wa.me/'+admin.replace(/^[@+]/,'');
   const prefix='ارتباط با ادمین: ';
   line(prefix+admin,url?{kind:'url',offset:prefix.length,length:admin.length,url}:null);
 }
 if(contacts.extra)line(contacts.extra);
 return {text:lines.join('\n'),links};
}
export function appendContacts(body,value,platform='telegram'){
 if(!value)return {body,links:[]};
 const block=contactBlock(value,platform),prefix=body+(body&&block.text?'\n\n':'');
 return {body:prefix+block.text,links:block.links.map(link=>({...link,offset:prefix.length+link.offset}))};
}
export function contactEntities(links,platform='telegram'){
 if(platform!=='telegram')return [];
 return links.map(link=>link.kind==='phone'?{type:'phone_number',offset:link.offset,length:link.length}:{type:'text_link',offset:link.offset,length:link.length,url:link.url});
}
