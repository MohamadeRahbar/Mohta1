import {delivery} from './delivery.mjs';
import {telegramTarget} from './telegram-access.mjs';
import {multipart} from './multipart.mjs';
import {eitaaSetupIssue} from './eitaa-access.mjs';
export const sendPlatforms=['telegram','bale','rubika','eitaa'];
const bases={telegram:'https://api.telegram.org/',bale:'https://tapi.bale.ai/',rubika:'https://botapi.rubika.ir/'};
export function channelAvailability(channel,configured){
 if(!channel||channel.deleted_at)return {ready:false,code:'destination_removed',message:'این مقصد از تنظیمات حذف شده است'};
 if(!sendPlatforms.includes(channel.platform))return {ready:false,code:'adapter_unavailable',message:channel.platform==='whatsapp'?'مسیر ارسال کانال واتس‌اپ هنوز متصل نشده است.':'اتصال ارسال ایتایار هنوز تکمیل نشده است.'};
 if(!channel.enabled)return {ready:false,code:'channel_disabled',message:'این کانال در بخش اتصال غیرفعال است.'};
 if(!configured)return {ready:false,code:'token_missing',message:'توکن ربات این پیام‌رسان ذخیره نشده است.'};
 if(!channel.target?.trim())return {ready:false,code:'target_missing',message:'شناسهٔ کانال مقصد ثبت نشده است.'};
 return {ready:true,code:'configured',message:'تنظیمات ارسال ثبت شده است؛ دسترسی هنگام انتشار بررسی می‌شود.'};
}
function refusal(code,message,unknown=false){const error=new Error(message);error.code=code;error.safeMessage=true;error.deliveryUnknown=unknown;return error;}
function apiFailure(response){
 const code=Number(response?.data?.error_code||response?.status);
 const reasons={401:['token_invalid','توکن ربات پذیرفته نشد.'],403:['posting_denied','ربات مجوز ارسال به کانال را ندارد.'],400:['request_invalid','مقصد، قالب متن یا رسانه توسط پیام‌رسان پذیرفته نشد.'],404:['target_invalid','ربات یا مقصد پیدا نشد.'],429:['rate_limited','محدودیت درخواست اعمال شده است؛ کمی بعد دوباره تلاش کنید.']};
 const [category,message]=reasons[code]||['service_error','پاسخ موفق از پیام‌رسان دریافت نشد.'];return refusal(category,message,code>=500||!response);
}
function unpack(platform,response){
 const raw=response?.data;
 if(response?.status!==200)throw apiFailure(response);
 if(platform==='rubika'){if(!raw||typeof raw!=='object')throw refusal('invalid_response','پاسخ قابل‌تأیید از روبیکا دریافت نشد.',true);if(raw.error||(raw.status&&raw.status!=='OK'))throw refusal('api_rejected','درخواست توسط روبیکا پذیرفته نشد.');return raw.data||raw;}
 if(raw?.ok===false)throw apiFailure(response);if(raw?.ok!==true)throw refusal('invalid_response','پاسخ قابل‌تأیید از پیام‌رسان دریافت نشد.',true);return raw.result;
}
export function baleText(body,entities=[]){
 // Bale uses one asterisk per side for bold, with spaces outside the markers.
 const marks=entities.filter(e=>['bold','italic'].includes(e.type)),points=[...new Set([0,body.length,...marks.flatMap(e=>[e.offset,e.offset+e.length])])].sort((a,b)=>a-b);
 const runs=[];for(let i=0;i<points.length-1;i++){const a=points[i],b=points[i+1],bold=marks.some(e=>e.type==='bold'&&e.offset<=a&&e.offset+e.length>=b),italic=marks.some(e=>e.type==='italic'&&e.offset<=a&&e.offset+e.length>=b),last=runs.at(-1),part=body.slice(a,b);if(last&&last.bold===bold&&last.italic===italic)last.text+=part;else runs.push({text:part,bold,italic});}
 return runs.map((run,index)=>{
  if((!run.bold&&!run.italic)||!run.text.trim())return run.text;
  // A selection can include adjacent spaces; keep those outside the delimiters.
  const leading=run.text.match(/^\s*/)[0],trailing=run.text.match(/\s*$/)[0];let part=run.text.trim();
  if(run.italic)part='_'+part+'_';if(run.bold)part='*'+part+'*';
  const before=leading||runs[index-1]?.text.slice(-1)||'',after=trailing||runs[index+1]?.text[0]||'';
  return leading+(/\s/.test(before)?'':' ')+part+(/\s/.test(after)?'':' ')+trailing;
 }).join('');
}
export function adapterPreflight(post,channel,token,files,prepared){
 const platform=channel.platform,payload=prepared||delivery(post,platform),body=payload.caption??payload.text;
 if(['telegram','bale'].includes(platform)){
  if(!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token))throw refusal('token_invalid','ساختار توکن ربات معتبر نیست.');
  if(!telegramTarget(channel.target))throw refusal('target_invalid','شناسهٔ کانال باید @username یا شناسهٔ عددی کانال باشد.');
 }else if(platform==='rubika'){
  if(!/^[A-Za-z0-9_:-]{10,512}$/.test(token))throw refusal('token_invalid','ساختار توکن روبیکا معتبر نیست.');
  if(!/^(?:@[A-Za-z][A-Za-z0-9_]{0,63}|[A-Za-z0-9_-]{6,200})$/.test(channel.target))throw refusal('target_invalid','شناسه یا @نام کاربری کانال روبیکا را وارد کنید.');
  if(files.length>1)throw refusal('album_unavailable','ارسال آلبوم یکپارچه در اتصال فعلی روبیکا فعال نیست؛ برای این مقصد فقط یک تصویر یا کلیپ انتخاب کنید.');
 }else if(platform==='eitaa'){
  const issue=eitaaSetupIssue(channel,token);if(issue)throw refusal(issue.category,issue.message);
  if(files.length>1)throw refusal('album_unavailable','API ایتایار ارسال آلبوم یکپارچه را مستند نکرده است؛ برای ایتا فقط یک تصویر یا کلیپ انتخاب کنید.');
 }
 if(platform==='telegram'&&body.length>(files.length?1024:4096))throw refusal('text_limit','متن از محدودیت کپشن یا پیام تلگرام بلندتر است.');
 if(platform==='bale'&&baleText(body,payload.entities).length>4096)throw refusal('text_limit','متن قالب‌بندی‌شدهٔ بله باید کوتاه‌تر شود.');
 if(files.some(f=>f.mime.startsWith('image/')&&f.size>10*1024*1024)&&['telegram','rubika'].includes(platform))throw refusal('photo_limit','برای این پیام‌رسان، اندازهٔ هر تصویر باید حداکثر ۱۰ مگابایت باشد.');
 return payload;
}
export async function sendPost(post,channel,{token,files,request,resolveRoute,manualProxy,replyTo,pin=false,transformPayload}){
 const platform=channel.platform,prepared=transformPayload?transformPayload(delivery(post,platform)):null,payload=adapterPreflight(post,channel,token,files,prepared),base=bases[platform];let target=platform==='rubika'?channel.target:telegramTarget(channel.target);
 let sending=false;
 async function call(url,options,final=false){
  let route;try{route=await resolveRoute(channel,url,{manualProxy});}catch{throw refusal('route_invalid','مسیر شبکهٔ این پیام‌رسان قابل استفاده نیست.');}
  if(final)sending=true;
  let response;try{response=await request(url,{...options,proxy:route.proxy||'',timeout:files.length?90000:15000});}
  catch{throw refusal('connection_failed',sending?'نتیجهٔ ارسال نامشخص است؛ پیش از هر اقدام، کانال را بررسی کنید.':'بررسی اتصال انجام نشد؛ تنظیمات شبکه یا دسترسی کانال را بررسی کنید.',sending);}
  return response;
 }
 const endpoint=method=>base+(platform==='rubika'?'v3/':'bot')+token+'/'+method;
 try{
 if(platform==='eitaa'){
  // Official API guide: /api/TOKEN/{getMe,sendMessage,sendFile}; usernames omit @.
  const eitaaEndpoint=method=>'https://eitaayar.ir/api/'+token+'/'+method;
  const account=unpack(platform,await call(eitaaEndpoint('getMe'),{method:'GET'}));
  if(!account||!(Number.isSafeInteger(account.id)&&account.id>0||typeof account.id==='string'&&/^[1-9]\d{0,24}$/.test(account.id)))throw refusal('invalid_response','اطلاعات معتبر حساب ایتایار دریافت نشد؛ ارسال انجام نشد.');
  target=channel.target.trim().replace(/^@/,'');
  const fields={chat_id:target,title:post.library_title||post.title,...(pin?{pin:1}:{}),...(replyTo?{reply_to_message_id:replyTo.messageId}:{})};
  const response=files.length?await call(eitaaEndpoint('sendFile'),{method:'POST',...multipart({...fields,caption:payload.caption},[{...files[0],field:'file'}])},true):await call(eitaaEndpoint('sendMessage'),{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},rawBody:new URLSearchParams({...fields,text:payload.text}).toString()},true);
  if(response?.data?.ok===false){
    const description=String(response.data.description||response.data.message||'').toLowerCase();
    if(/channel.*(?:not found|not exist|not registered)|chat.*not found|کانال.*(?:ثبت|وجود)/.test(description))throw refusal('channel_inaccessible','ایتایار کانال را نپذیرفت؛ کانال را در حساب ایتایار ثبت کنید و شناسهٔ آن را بررسی کنید.');
    if(/permission|not.*admin|forbidden|دسترسی|مدیر/.test(description))throw refusal('posting_denied','ایتایار اجازهٔ ارسال به کانال ندارد؛ عضویت و مدیر بودن @sender را بررسی کنید.');
  }
  const result=unpack(platform,response),id=result?.message_id??result?.[' message_id'];
  if(!((Number.isSafeInteger(id)&&id>0)||(typeof id==='string'&&/^\d{1,24}$/.test(id))))throw refusal('receipt_missing','تأیید معتبر ارسال از ایتایار دریافت نشد؛ کانال را بررسی کنید. ارسال خودکار تکرار نمی‌شود.',true);
  return {messageIds:[id],target:String(result.chat?.id||target)};
 }
 const info=unpack(platform,await call(endpoint('getChat'),{method:'POST',body:{chat_id:target}}));
 const chat=platform==='rubika'?(info?.chat||info):info;
 if((platform==='rubika'?chat?.chat_type!=='Channel':chat?.type!=='channel'))throw refusal('not_channel','شناسهٔ واردشده کانال قابل‌تأیید نیست؛ مقصد را بررسی کنید.');
 if(platform==='rubika'){
  if(typeof chat.chat_id!=='string'||!/^[A-Za-z0-9_-]{6,200}$/.test(chat.chat_id))throw refusal('target_invalid','شناسهٔ معتبر کانال از روبیکا دریافت نشد.');
  target=chat.chat_id;
 }
 if(replyTo&&String(chat?.id||chat?.chat_id||target)!==String(replyTo.target))throw refusal('reply_target_changed','هویت کانال پیام مرجع تغییر کرده است');
 const replyFields=replyTo?(platform==='telegram'?{reply_parameters:{message_id:replyTo.messageId,allow_sending_without_reply:false}}:{reply_to_message_id:replyTo.messageId}):{};
 const sendCall=(method,options)=>call(endpoint(method),{...options,body:options.body?{...options.body,...replyFields}:options.body},true);
 let response;
 if(platform==='rubika'){
  const body=payload.caption??payload.text;
  if(!files.length){const types={bold:'Bold',italic:'Italic',underline:'Underline',text_link:'Link'};const parts=payload.entities.filter(e=>types[e.type]).map(e=>({type:types[e.type],from_index:e.offset,length:e.length,...(e.url?{link_url:e.url}:{})}));if(parts.length>30)throw refusal('format_limit','قالب‌بندی روبیکا بیش از ۳۰ بخش است؛ تعداد قالب‌بندی‌ها را کم کنید.');response=await sendCall('sendMessage',{method:'POST',body:{chat_id:target,text:body,...(parts.length?{metadata:{meta_data_parts:parts}}:{})}});}
  else{
   const upload=unpack(platform,await call(endpoint('requestSendFile'),{method:'POST',body:{type:files[0].mime.startsWith('video/')?'Video':'Image'}}));let url;try{url=new URL(upload.upload_url);}catch{throw refusal('upload_invalid','آدرس معتبر بارگذاری از روبیکا دریافت نشد.');}
   if(url.protocol!=='https:'||url.username||url.password||(url.port&&url.port!=='443')||!['rubika.ir','iranlms.ir'].some(domain=>url.hostname===domain||url.hostname.endsWith('.'+domain)))throw refusal('upload_invalid','سرور بارگذاری روبیکا تأیید نشد.');
   const result=unpack(platform,await call(url.href,{method:'POST',...multipart({},[{...files[0],field:'file'}])}));if(typeof result.file_id!=='string'||!result.file_id)throw refusal('upload_invalid','شناسهٔ فایل از روبیکا دریافت نشد.');
   response=await sendCall('sendFile',{method:'POST',body:{chat_id:target,file_id:result.file_id,text:body}});
  }
 }else{
  const body=platform==='bale'?baleText(payload.caption??payload.text,payload.entities):(payload.caption??payload.text),styles=platform==='telegram'?payload.entities:undefined;
  if(!files.length)response=await sendCall('sendMessage',{method:'POST',body:{chat_id:target,text:body,...(styles?{entities:styles}:{}),...(platform==='telegram'?{link_preview_options:{is_disabled:true}}:{})}});
  else if(files.length===1){const field=files[0].mime.startsWith('video/')?'video':'photo';response=await call(endpoint(field==='video'?'sendVideo':'sendPhoto'),{method:'POST',...multipart({chat_id:target,caption:body,caption_entities:styles,...replyFields},[{...files[0],field}])},true);}
  else{const media=files.map((file,index)=>({type:file.mime.startsWith('video/')?'video':'photo',media:'attach://asset'+index,...(index===0?{caption:body,...(styles?{caption_entities:styles}:{})}:{})}));response=await call(endpoint('sendMediaGroup'),{method:'POST',...multipart({chat_id:target,media,...replyFields},files.map((file,index)=>({...file,field:'asset'+index})))},true);}
 }
 const result=unpack(platform,response),messages=Array.isArray(result)?result:[result];
 const ids=messages.map(message=>message?.message_id).filter(id=>(typeof id==='string'&&id.length>0&&id.length<200)||(Number.isSafeInteger(id)&&id>0));
 if(ids.length!==(files.length||1))throw refusal('receipt_missing','تأیید کامل ارسال دریافت نشد؛ کانال را بررسی کنید. ارسال خودکار تکرار نمی‌شود.',true);
 return {messageIds:ids,target:String(chat?.id||chat?.chat_id||target)};
 }catch(error){if(!sending)error.deliveryUnknown=false;throw error;}
}
