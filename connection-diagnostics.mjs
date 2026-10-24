import {requestJson} from './network.mjs';
import {platformNames} from './store.mjs';
import {publicRoute} from './system-network.mjs';

export function classifyApiFailure(platform,response){
 if(platform!=='telegram'||response.data?.ok!==false)return null;
 const code=response.data.error_code||response.status;
 const categories={401:['token_invalid','توکن ربات پذیرفته نشد؛ توکن ذخیره‌شده را بررسی کنید.'],403:['channel_permission','ربات به مقصد دسترسی لازم ندارد؛ عضویت و مجوز ارسال در کانال را بررسی کنید.'],400:['request_invalid','مقصد یا اطلاعات درخواست پذیرفته نشد؛ شناسهٔ کانال و محدودیت‌های پست را بررسی کنید.'],429:['rate_limited','محدودیت تعداد درخواست‌ها اعمال شده است؛ پس از زمان اعلام‌شدهٔ سرویس دوباره بررسی کنید.']};
 const [category,message]=categories[code]||['service_error','سرویس پیام‌رسان درخواست را نپذیرفت؛ وضعیت سرویس و تنظیمات را بررسی کنید.'];
 return {category,message,networkReachable:true,vpnStatus:'unknown',httpStatus:response.status};
}
export async function diagnoseConnectionFailure(channel,error,route,{operation='probe'}={}){
 const base={route:publicRoute(route),vpnStatus:'unknown',operation,deliveryState:operation==='send'?'unknown':'not_attempted',automaticRetryAllowed:false};
 const code=error.code||'';
 let category='platform_unreachable',message='اتصال به '+platformNames[channel.platform]+' برقرار نشد.';
 if(code==='SYSTEM_PAC_UNSUPPORTED'){category='system_proxy_configuration';message=error.message;}
 else if(error.status===400){category='proxy_configuration';message=error.message;}
 else if(['CERT_HAS_EXPIRED','DEPTH_ZERO_SELF_SIGNED_CERT','UNABLE_TO_VERIFY_LEAF_SIGNATURE','ERR_TLS_CERT_ALTNAME_INVALID'].includes(code)){category='tls_error';message='اتصال امن به '+platformNames[channel.platform]+' تأیید نشد.';}
 else if(code==='PROXY_AUTH_REQUIRED'){category='proxy_authentication';message='پروکسی تنظیم‌شده احراز هویت را نپذیرفت؛ اتصال به پیام‌رسان برقرار نشد.';}
 else if(['PROXY_CONNECT_FAILED','PROXY_TIMEOUT'].includes(code)||(route.proxy&&['ECONNREFUSED','ENOTFOUND','EAI_AGAIN','EHOSTUNREACH','ENETUNREACH'].includes(code))){category='proxy_unreachable';message='از مسیر پروکسی انتخاب‌شده، اتصال به '+platformNames[channel.platform]+' برقرار نشد.';}
 else if(['ENOTFOUND','EAI_AGAIN'].includes(code)){category='dns_error';message='آدرس سرور '+platformNames[channel.platform]+' پیدا نشد.';}
 else if(code==='ETIMEDOUT'){message=platformNames[channel.platform]+' در مهلت آزمایش پاسخ نداد.';}
 else if(['ECONNREFUSED','ECONNRESET','EHOSTUNREACH','ENETUNREACH'].includes(code)){message='مسیر ارتباط با '+platformNames[channel.platform]+' قطع یا مسدود است؛ اینترنت، VPN یا مسیر پروکسی را بررسی کنید.';}
 if(['platform_unreachable','dns_error','proxy_unreachable'].includes(category))message+=' از این خطا به‌تنهایی نمی‌توان قطع اینترنت، فیلترینگ، تحریم یا اختلال VPN را قطعی تشخیص داد.';
 if(operation==='send')message+=' نتیجهٔ ارسال نامشخص است؛ پیش از تلاش دوباره، کانال را بررسی کنید تا پیام تکراری ایجاد نشود.';
 return {...base,category,message};
}
// Shared entry point for network probes and future publishing adapters.
export async function requestChannel(channel,url,options,route,{request=requestJson,operation='probe'}={}){
 try{
   const response=await request(url,{...options,proxy:route.proxy||''});
   const diagnostic=operation==='probe'?null:classifyApiFailure(channel.platform,response);
   return {response,diagnostic};
 }catch(error){const diagnostic=await diagnoseConnectionFailure(channel,error,route,{request,operation});return {response:null,diagnostic};}
}
