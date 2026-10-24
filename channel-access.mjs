import {checkTelegramAccess,telegramTarget} from './telegram-access.mjs';
import {requestJson} from './network.mjs';
import {resolveNetworkRoute,publicRoute} from './system-network.mjs';
import {diagnoseConnectionFailure} from './connection-diagnostics.mjs';
import {eitaaSetupIssue,checkEitaaAccess} from './eitaa-access.mjs';
export function channelSetupIssue(channel,token=''){
 if(!token.trim())return {category:'token_missing',message:'تنظیمات ناقص است؛ ابتدا توکن را ذخیره کنید.'};
 if(!channel.target?.trim())return {category:'target_missing',message:'تنظیمات ناقص است؛ ابتدا شناسهٔ کانال را وارد کنید.'};
 if(['telegram','bale'].includes(channel.platform)&&(!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)||!telegramTarget(channel.target)))return {category:'configuration_invalid',message:'ساختار توکن یا شناسهٔ کانال معتبر نیست.'};
 if(channel.platform==='rubika'&&!/^[A-Za-z0-9_:-]{10,512}$/.test(token))return {category:'token_invalid',message:'ساختار توکن روبیکا معتبر نیست؛ توکن کامل را وارد کنید.'};
 if(channel.platform==='rubika'&&!/^(?:@[A-Za-z][A-Za-z0-9_]{0,63}|[A-Za-z0-9_-]{6,200})$/.test(channel.target))return {category:'target_invalid',message:'ساختار شناسهٔ کانال روبیکا معتبر نیست.'};
 if(channel.platform==='eitaa')return eitaaSetupIssue(channel,token);
 return null;
}
// Only read-only methods: checking permissions never sends a test message.
export async function checkChannelAccess(channel,{token='',manualProxy='',request=requestJson,resolveRoute=resolveNetworkRoute}={}){
 if(channel.platform==='eitaa')return checkEitaaAccess(channel,{token,manualProxy,request,resolveRoute});
 if(channel.platform==='telegram')return checkTelegramAccess(channel,{token,manualProxy,request,resolveRoute});
 const empty={ok:false,networkReachable:null,checks:{token:'not_checked',channel:'not_checked',posting:'not_checked'}};
 const issue=channelSetupIssue(channel,token);if(issue)return {...empty,...issue};
 if(['telegram','bale'].includes(channel.platform))return checkTelegramAccess(channel,{token,manualProxy,request,resolveRoute});
 if(channel.platform!=='rubika')return {...empty,category:'adapter_unavailable',message:'بررسی دسترسی این مقصد آماده نیست.'};
 const result={...empty,checks:{...empty.checks}};
 const fail=(category,message)=>({...result,category,message});
 async function call(method,body){
  const url='https://botapi.rubika.ir/v3/'+token+'/'+method;
  let route,response;const reject=detail=>{throw Object.assign(new Error('Safe access failure'),{detail});};
  try{route=await resolveRoute(channel,url,{manualProxy});}catch{reject(fail('connection_configuration','مسیر اتصال روبیکا قابل استفاده نیست؛ تنظیمات پروکسی را بررسی کنید.'));}
  result.route=publicRoute(route);
  try{response=await request(url,{method:'POST',body,proxy:route.proxy||'',timeout:8000});}
  catch(error){result.networkReachable=false;reject({...result,...await diagnoseConnectionFailure(channel,{code:error.code||''},route)});}
  result.networkReachable=true;result.httpStatus=response.status;
  const raw=response.data;
  if(response.status===401||(method==='getMe'&&response.status===403&&raw&&typeof raw==='object')){result.checks.token='failed';reject(fail('token_invalid','روبیکا توکن ربات را نپذیرفت؛ توکن ذخیره‌شده را بررسی کنید.'));}
  if(response.status===429)reject(fail('rate_limited','روبیکا تعداد درخواست‌ها را محدود کرده است؛ کمی بعد دوباره بررسی کنید.'));
  if(response.status===403&&method==='getChat'&&raw&&typeof raw==='object'){result.checks.channel='failed';reject(fail('channel_inaccessible','توکن معتبر است، اما ربات به کانال روبیکا دسترسی ندارد؛ شناسه و عضویت ربات را بررسی کنید.'));}
  if([403,451].includes(response.status))reject(fail('access_restricted','دسترسی به سرویس روبیکا از این مسیر رد شد؛ علت محدودیت شبکه یا موقعیت اتصال از این پاسخ قطعی نیست.'));
  if(response.status>=500)reject(fail('service_error','سرور روبیکا موقتاً خطا دارد؛ بعداً دوباره بررسی کنید.'));
  if(response.status!==200||!raw||typeof raw!=='object'||raw.error||(raw.status&&raw.status!=='OK')){
    if(method==='getChat'){result.checks.channel='failed';reject(fail('channel_inaccessible','کانال در روبیکا قابل دسترس نیست؛ شناسهٔ کانال و عضویت ربات را بررسی کنید.'));}
    reject(fail('token_unverified','پاسخ معتبر برای بررسی توکن روبیکا دریافت نشد؛ توکن یا وضعیت سرویس را بررسی کنید.'));
  }
  return raw.data||raw;
 }
 try{
  const me=await call('getMe',{}),bot=me?.bot||me;
  if(typeof bot?.bot_id!=='string'||!bot.bot_id)return fail('token_unverified','اطلاعات معتبر ربات دریافت نشد؛ توکن یا پاسخ سرویس را بررسی کنید.');
  result.checks.token='passed';result.bot={id:bot.bot_id,username:String(bot.username||'').slice(0,100)};
  const info=await call('getChat',{chat_id:channel.target}),chat=info?.chat||info;
  if(chat?.chat_type!=='Channel'||typeof chat.chat_id!=='string'||!chat.chat_id)return fail('channel_inaccessible','کانال قابل دسترس تأیید نشد؛ شناسه و عضویت ربات را بررسی کنید.');
  result.checks.channel='passed';result.checks.posting='unknown';result.chat={id:chat.chat_id,title:String(chat.title||'').slice(0,200)};
  return fail('posting_unverified','ربات و دسترسی به کانال تأیید شدند. API روبیکا در این بررسی مجوز ارسال را جداگانه تأیید نمی‌کند؛ وضعیت آن نامشخص است. پیامی ارسال نشد.');
 }catch(error){return error.detail||fail('connection_failed','بررسی دسترسی روبیکا کامل نشد؛ شبکه یا پاسخ سرویس را بررسی کنید.');}
}
