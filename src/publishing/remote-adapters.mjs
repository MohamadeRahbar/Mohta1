import {requestJson} from '../infrastructure/network.mjs';
import {resolveNetworkRoute} from '../infrastructure/system-network.mjs';
import {multipart} from '../http/multipart.mjs';
import {baleText} from './publish-adapters.mjs';
const bases={telegram:'https://api.telegram.org/bot',bale:'https://tapi.bale.ai/bot',rubika:'https://botapi.rubika.ir/v3/'};
function failure(message,unknown=false){return Object.assign(new Error(message),{safeMessage:true,deliveryUnknown:unknown});}
export function remoteClient(channel,token,{request=requestJson,resolveRoute=resolveNetworkRoute,manualProxy=''}={}){
 if(!bases[channel.platform])throw failure('این عملیات در API این پیامرسان پشتیبانی نمیشود');
 async function call(method,body,mutation=false,upload){
  const url=bases[channel.platform]+token+'/'+method;let route,response;
  try{route=await resolveRoute(channel,url,{manualProxy});}catch{throw failure('مسیر اتصال مقصد قابل استفاده نیست');}
  try{response=await request(url,{method:'POST',...(upload?multipart(body,[{...upload,field:'mediaFile'}]):{body}),proxy:route.proxy||'',timeout:upload?90000:15000});}catch{throw failure(mutation?'نتیجه عملیات مشخص نیست کانال را بررسی کنید':'بررسی اتصال مقصد انجام نشد',mutation);}
  if(response.status>=500)throw failure('سرویس پیامرسان پاسخ معتبر نداد',mutation);
  const raw=response.data;
  if(response.status>=400||raw?.ok===false||raw?.status&&raw.status!=='OK'||raw?.error)throw failure('پیامرسان عملیات را نپذیرفت دسترسی، شناسه پیام و محدودیت زمانی را بررسی کنید');
  if(!raw||typeof raw!=='object')throw failure('پاسخ معتبر از پیامرسان دریافت نشد',mutation);
  const result=channel.platform==='rubika'?raw.data:raw.result;
  if(result===undefined||result===null||result===false)throw failure('تایید معتبر عملیات دریافت نشد',mutation);
  return result;
 }
 return {
  async verify(target){const raw=await call('getChat',{chat_id:channel.target}),chat=raw.chat||raw;if(String(chat.type||chat.chat_type).toLowerCase()!=='channel'||String(chat.id||chat.chat_id)!==String(target))throw failure('هویت مقصد با کانال ثبت شده هنگام انتشار یکسان نیست');},
  async perform(action,target,messageId,{payload,file,mediaIndex=0,hasMedia=false}={}){
   const common={chat_id:target,message_id:messageId},platform=channel.platform;
   if(action==='delete')return call('deleteMessage',common,true);
   if(action==='pin'||action==='unpin')return call(platform==='bale'&&action==='unpin'?'unPinChatMessage':action==='pin'?'pinChatMessage':'unpinChatMessage',common,true);
   const body=payload.caption??payload.text;
   if(file){const media={type:file.mime.startsWith('video/')?'video':'photo',media:'attach://mediaFile',...(mediaIndex===0?{caption:body,caption_entities:payload.entities}:{})};return call('editMessageMedia',{...common,media},true,file);}
   if(platform==='rubika')return call('editMessageText',{...common,text:body},true);
   const text=platform==='bale'?baleText(body,payload.entities):body;
   return call(hasMedia?'editMessageCaption':'editMessageText',{...common,[hasMedia?'caption':'text']:text,...(platform==='telegram'?{[hasMedia?'caption_entities':'entities']:payload.entities}:{})},true);
  }
 };
}
