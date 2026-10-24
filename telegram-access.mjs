import {requestJson} from './network.mjs';
import {resolveNetworkRoute,publicRoute} from './system-network.mjs';
import {diagnoseConnectionFailure} from './connection-diagnostics.mjs';

export function telegramTarget(value){
 const input=String(value||'').trim();
 if(/^-[1-9]\d*$/.test(input))return input;
 const username=input.replace(/^@/,'');
 return /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(username)?'@'+username:null;
}

// Read-only API methods. Never return URLs, credentials, or raw error messages.
export async function checkTelegramAccess(channel,{token='',manualProxy='',request=requestJson,resolveRoute=resolveNetworkRoute}={}){
 const bale=channel.platform==='bale',base=bale?'https://tapi.bale.ai/':'https://api.telegram.org/',name=bale?'بله':'تلگرام';
 const result={ok:false,category:'not_checked',message:'',networkReachable:null,checks:{token:'not_checked',channel:'not_checked',posting:'not_checked'}};
 const fail=(category,message)=>({...result,category,message:message.replaceAll('تلگرام',name)});
 token=token.trim();
 if(!token)return fail('token_missing','ابتدا توکن ربات را ذخیره کنید.');
 if(!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)){result.checks.token='failed';return fail('token_invalid','ساختار توکن ربات معتبر نیست؛ توکن کامل را از سرویس ساخت ربات همین پیام‌رسان وارد کنید.');}
 const target=telegramTarget(channel.target);
 if(!target){result.checks.channel='failed';return fail('target_invalid','شناسهٔ کانال را به صورت @username یا شناسهٔ عددی کانال وارد کنید.');}
 let route;
 try{route=await resolveRoute(channel,base,{manualProxy});}
 catch{return fail('connection_configuration','مسیر اتصال قابل استفاده نیست؛ تنظیم مسیر اتصال را بررسی کنید.');}
 result.route=publicRoute(route);
 async function call(method,body){
   let response;
   try{response=await request(base+'bot'+token+'/'+method,{method:'POST',body,proxy:route.proxy||'',timeout:8000});}
   catch(error){result.networkReachable=false;const diagnostic=await diagnoseConnectionFailure(channel,{code:error.code||''},route);return {failure:{...fail('connection_failed',diagnostic.message),...diagnostic,category:diagnostic.category==='platform_unreachable'?'connection_failed':diagnostic.category,checks:{...result.checks},networkReachable:false}};}
   result.networkReachable=true;result.httpStatus=response.status;
   const data=response.data;
   if(response.status===429||data?.error_code===429)return {failure:fail('rate_limited','تلگرام تعداد درخواست‌ها را محدود کرده است؛ کمی بعد دوباره بررسی کنید.')};
   if(data?.ok===true&&response.status===200&&data.result&&typeof data.result==='object')return {data:data.result};
   if(response.status===401||data?.error_code===401||(method==='getMe'&&(response.status===404||data?.error_code===404))){result.checks.token='failed';return {failure:fail('token_invalid','توکن ربات توسط تلگرام پذیرفته نشد؛ توکن ذخیره‌شده را بررسی کنید.')};}
   if(response.status===451||(method==='getMe'&&response.status===403))return {failure:fail('access_restricted','سرور پاسخ داد، اما دسترسی از این مسیر رد شد. محدودیت شبکه یا موقعیت اتصال محتمل است؛ تحریم یا VPN از این پاسخ به‌تنهایی قابل تشخیص قطعی نیست.')};
   if(response.status>=500)return {failure:fail('service_error','سرور تلگرام موقتاً خطا دارد؛ توکن را تغییر ندهید و بعداً دوباره آزمایش کنید.')};
   if(method!=='getMe'&&[400,403].includes(data?.error_code||response.status)){
     const description=String(data?.description||'').toLowerCase();
     if(/bot was kicked|bot is not a member/.test(description)){result.checks.posting='failed';return {failure:fail('bot_not_member','توکن معتبر است، اما ربات عضو این کانال نیست یا از آن حذف شده است؛ ربات را به مدیران کانال اضافه کنید.')};}
     if(method==='getChatMember'){result.checks.posting='failed';return {failure:fail('membership_unverified','کانال پیدا شد، اما وضعیت دسترسی ربات دریافت نشد؛ عضویت و مدیر بودن ربات را بررسی کنید.')};}
     result.checks.channel='failed';return {failure:fail('channel_inaccessible','کانال قابل دسترس نیست: شناسه ممکن است اشتباه باشد یا ربات به کانال خصوصی دسترسی نداشته باشد. این پاسخ تفاوت این دو حالت را مشخص نمی‌کند.')};
   }
   return {failure:fail('api_error','پاسخ معتبر برای بررسی دسترسی دریافت نشد؛ کمی بعد دوباره بررسی کنید.')};
 }
 const me=await call('getMe',{});if(me.failure)return me.failure;
 if(me.data.is_bot!==true||!Number.isSafeInteger(me.data.id)||me.data.id<=0)return fail('api_error','اطلاعات معتبر ربات از تلگرام دریافت نشد.');
 result.checks.token='passed';result.bot={id:me.data.id,username:String(me.data.username||''),name:String(me.data.first_name||'')};
 const chat=await call('getChat',{chat_id:target});if(chat.failure)return chat.failure;
 if(chat.data.type!=='channel'){result.checks.channel='failed';return fail('target_not_channel','مقصد واردشده کانال تلگرام نیست؛ شناسهٔ کانال را بررسی کنید.');}
 if(!Number.isSafeInteger(chat.data.id)||chat.data.id===0||(!bale&&chat.data.id>=0))return fail('api_error','اطلاعات معتبر کانال از تلگرام دریافت نشد.');
 result.checks.channel='passed';result.chat={id:chat.data.id,title:String(chat.data.title||''),username:String(chat.data.username||'')};
 const member=await call('getChatMember',{chat_id:chat.data.id,user_id:me.data.id});if(member.failure)return member.failure;
 if(member.data.user?.id!==me.data.id)return fail('api_error','اطلاعات مجوزهای ربات قابل تأیید نیست.');
 if(member.data.status==='administrator'&&typeof member.data.can_post_messages!=='boolean'){result.checks.posting='unknown';return fail('posting_unverified','ربات مدیر کانال است، اما سرویس مجوز ارسال را صریح برنگرداند؛ مجوز ارسال هنوز تأیید نشده است.');}
 const posting=member.data.status==='creator'||(member.data.status==='administrator'&&member.data.can_post_messages===true);
 result.checks.posting=posting?'passed':'failed';
 if(!posting)return fail('posting_denied',member.data.status==='administrator'?'ربات مدیر کانال است، اما مجوز ارسال پیام خاموش است؛ اجازهٔ انتشار پست را در مجوزهای ربات فعال کنید.':'ربات مدیر این کانال نیست؛ آن را به مدیران کانال اضافه کنید و مجوز ارسال پیام بدهید.');
 return {...result,ok:true,category:'posting_allowed',message:'توکن ربات، کانال و مجوز ارسال پیام تأیید شدند. این بررسی پیامی در کانال ارسال نکرد.'};
}
