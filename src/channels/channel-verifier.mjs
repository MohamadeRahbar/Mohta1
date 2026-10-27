import {check} from '../content/content.mjs';
import {checkChannelAccess} from './channel-access.mjs';
import {saveChannelSettings} from './channel-settings.mjs';
import {channelAvailability} from '../publishing/publish-adapters.mjs';

const configurationErrors=new Set(['token_missing','target_missing','target_invalid','configuration_invalid','connection_configuration','route_invalid','token_invalid']);
const remedies={
 token_missing:'توکن کامل را از سرویس همین پیام‌رسان بگیرید و ذخیره کنید.',token_invalid:'توکن کامل را دوباره از پنل همین پیام‌رسان کپی کنید؛ توکن پیام‌رسان دیگری قابل استفاده نیست.',
 target_missing:'شناسهٔ کانال را وارد کنید.',target_invalid:'نام کاربری کانال یا شناسهٔ عددی معتبر را وارد کنید؛ لینک دعوت جای شناسه نیست.',target_not_channel:'شناسهٔ یک کانال را وارد کنید؛ گروه یا حساب شخصی مقصد کانال نیست.',
 channel_inaccessible:'شناسه را با کانال تطبیق دهید و ربات را به مدیران همان کانال اضافه کنید. برای کانال خصوصی از شناسهٔ عددی استفاده کنید.',
 bot_not_member:'همین ربات را به کانال اضافه و مدیر کنید.',membership_unverified:'عضویت و نقش مدیر همین ربات را در تنظیمات کانال بررسی کنید.',posting_denied:'ربات را مدیر کنید و اجازهٔ ارسال پیام یا انتشار پست را فعال کنید.',
 connection_configuration:'مسیر اینترنت سیستم یا آدرس پروکسی واردشده را اصلاح کنید.',route_invalid:'مسیر اینترنت سیستم یا آدرس پروکسی واردشده را اصلاح کنید.',
 dns_error:'اینترنت و DNS دستگاه را بررسی کنید؛ سپس دوباره آزمایش کنید.',tls_error:'تاریخ دستگاه و گواهی اتصال امن را بررسی کنید؛ تأیید گواهی را غیرفعال نکنید.',
 proxy_authentication:'نام کاربری و رمز پروکسی را بررسی کنید.',proxy_unreachable:'کلاینت پروکسی را روشن کنید و آدرس و پورت آن را بررسی کنید.',
 connection_failed:'دسترسی این دستگاه به پیام‌رسان را بررسی کنید. در صورت نیاز VPN یا پروکسی را وصل کنید و آزمایش را تکرار کنید.',platform_unreachable:'دسترسی این دستگاه به پیام‌رسان را بررسی کنید. در صورت نیاز VPN یا پروکسی را وصل کنید و آزمایش را تکرار کنید.',
 access_restricted:'با یک مسیر اتصال مجاز دیگر دوباره بررسی کنید؛ این پاسخ به‌تنهایی اثبات تحریم یا قطع VPN نیست.',
 rate_limited:'کمی صبر کنید و سپس دوباره آزمایش کنید.',service_error:'بعداً دوباره آزمایش کنید؛ این خطا به‌تنهایی دلیل اشتباه‌بودن توکن نیست.',
 posting_unverified:'این پیام‌رسان مجوز ارسال را در آزمایش فقط‌خواندنی تأیید نکرده است؛ نتیجه به‌عنوان نامشخص نمایش داده می‌شود.',
 api_error:'پاسخ سرویس قابل تأیید نبود؛ بعداً دوباره آزمایش کنید.',invalid_response:'پاسخ سرویس قابل تأیید نبود؛ بعداً دوباره آزمایش کنید.',
};
export function connectionReport(detail,channel,configured){
 const checks={network:detail.networkReachable===true?'passed':detail.networkReachable===false?'failed':'not_checked',...detail.checks};
 if(detail.category==='token_invalid')checks.token='failed';
 if(['target_invalid','target_not_channel'].includes(detail.category))checks.channel='failed';
 if(configurationErrors.has(detail.category)&&detail.networkReachable!==true)checks.network='not_checked';
 const availability=channelAvailability(channel,configured);
 return {...detail,checks,checkedAt:new Date().toISOString(),configVersion:channel.config_version,deliveryState:'not_attempted',vpnStatus:'unknown',automaticRetryAllowed:false,
  nextStep:detail.ok?'ارتباط و مجوزها در زمان آزمایش تأیید شدند.':remedies[detail.category]||'تنظیمات و وضعیت سرویس را بررسی و آزمایش را تکرار کنید.',
  publishing:{...availability,ready:availability.ready&&detail.ok,configured:availability.ready},
 };
}
export function createChannelVerifier(store,{checkAccess=checkChannelAccess}={}){
 const running=new Map();
 function verify(id,actor){
  const channel=store.db.prepare('SELECT * FROM channels WHERE id=?').get(id);check(channel&&!channel.deleted_at,'کانال مقصد پیدا نشد',404);
  const key=id+':'+channel.config_version;if(running.has(key))return running.get(key);
  const task=(async()=>{
   const token=store.secret('token:'+id),proxy=channel.route==='proxy'?store.secret('proxy:'+id):'';
   let raw;
   try{raw=await checkAccess(channel,{token,manualProxy:proxy});}
   catch{raw={ok:false,category:'check_failed',message:'بررسی کامل نشد؛ آزمایش را دوباره اجرا کنید.',networkReachable:null,checks:{token:'not_checked',channel:'not_checked',posting:'not_checked'}};}
   // Never return a credential, even if a remote identity field unexpectedly echoes it.
   const scrub=value=>typeof value==='string'?(token?value.replaceAll(token,'[پنهان]'):value):Array.isArray(value)?value.map(scrub):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,scrub(v)])):value;
   const detail=scrub(connectionReport(raw,channel,!!token));
   const network=detail.checks.network==='passed'?'reachable':detail.checks.network==='failed'?'unreachable':'not_configured';
   store.transaction(()=>{const saved=store.db.prepare('UPDATE channels SET network_status=?,last_checked=?,network_detail=?,access_detail=? WHERE id=? AND config_version=?').run(network,detail.checkedAt,JSON.stringify(detail),JSON.stringify(detail),id,channel.config_version);check(saved.changes===1,'تنظیمات در حین آزمایش تغییر کرد؛ نتیجهٔ قبلی ذخیره نشد. دوباره آزمایش کنید.',409);store.audit(actor,'channel.access-check',id,{ok:detail.ok,category:detail.category,configVersion:channel.config_version});});
   return detail;
  })();running.set(key,task);task.then(()=>running.delete(key),()=>running.delete(key));return task;
 }
 return {verify,async connect(id,data,actor){saveChannelSettings(store,id,data,actor);return {saved:true,...await verify(id,actor)};}};
}
