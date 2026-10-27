import {requestJson} from '../infrastructure/network.mjs';
import {resolveNetworkRoute,publicRoute} from '../infrastructure/system-network.mjs';
import {diagnoseConnectionFailure} from '../infrastructure/connection-diagnostics.mjs';

export function eitaaSetupIssue(channel,token=''){
 if(!token.trim())return {category:'token_missing',message:'تنظیمات ناقص است؛ ابتدا توکن API ایتایار را ذخیره کنید.'};
 if(!channel.target?.trim())return {category:'target_missing',message:'تنظیمات ناقص است؛ ابتدا شناسهٔ کانال را وارد کنید.'};
 if(!/^[A-Za-z0-9_:-]{10,512}$/.test(token))return {category:'configuration_invalid',message:'توکن کامل API ایتایار را وارد کنید؛ آدرس سایت یا لینک API توکن نیست.'};
 if(!/^(?:-?[1-9]\d*|@?[A-Za-z][A-Za-z0-9_]{0,63})$/.test(channel.target.trim()))return {category:'target_invalid',message:'شناسهٔ کانال ایتایار را به‌صورت عدد یا نام کاربری کانال وارد کنید.'};
 return null;
}

// getMe checks the saved token without publishing. It cannot prove channel permissions.
export async function checkEitaaAccess(channel,{token='',manualProxy='',request=requestJson,resolveRoute=resolveNetworkRoute}={}){
 const result={ok:false,checks:{token:'not_checked',channel:'not_checked',posting:'not_checked'},networkReachable:false};
 const fail=(category,message,extra={})=>({...result,category,message,...extra});
 token=token.trim();const issue=eitaaSetupIssue(channel,token);if(issue)return {...result,...issue};
 const url='https://eitaayar.ir/api/'+token+'/getMe';let route;
 try{route=await resolveRoute(channel,url,{manualProxy});}
 catch{return fail('route_invalid','مسیر شبکهٔ ایتایار قابل استفاده نیست؛ تنظیمات پروکسی را بررسی کنید.');}
 result.route=publicRoute(route);
 let response;
 try{response=await request(url,{method:'GET',proxy:route.proxy||'',timeout:12000});}
 catch(error){const diagnostic=await diagnoseConnectionFailure(channel,{code:error.code||''},route);return {...result,...diagnostic};}
 result.networkReachable=true;result.httpStatus=response.status;
 const raw=response.data,code=Number(raw?.error_code||response.status);
 if(code===401||(raw?.ok===false&&Number(raw?.error_code)===403)){result.checks.token='failed';return fail('token_invalid','سرور ایتایار پاسخ داد، اما توکن API را نپذیرفت؛ توکن را از پنل ایتایار بررسی کنید.');}
 if([403,451].includes(response.status))return fail('access_restricted','سرور ایتایار پاسخ داد، اما دسترسی از این مسیر رد شد؛ محدودیت شبکه یا موقعیت اتصال محتمل است و علت قطعی مشخص نیست.');
 if(code===429)return fail('rate_limited','ایتایار محدودیت درخواست اعمال کرده است؛ کمی بعد دوباره آزمایش کنید.');
 if(response.status>=500)return fail('service_error','سرور ایتایار پاسخ داد، اما موقتاً خطای سرویس دارد؛ اعتبار توکن تأیید نشد.');
 if(response.status!==200||raw?.ok===false)return fail('api_rejected','ایتایار درخواست بررسی توکن را نپذیرفت؛ توکن API و وضعیت حساب ایتایار را بررسی کنید.');
 // Eitaayar returns the account identity; is_bot:false is valid for this service.
 const account=raw?.result,validId=Number.isSafeInteger(account?.id)&&account.id>0||typeof account?.id==='string'&&/^[1-9]\d{0,24}$/.test(account.id);
 if(raw?.ok!==true||!validId||typeof account?.is_bot!=='boolean')return fail('invalid_response','سرور ایتایار پاسخ داد، اما پاسخ معتبرِ بررسی توکن دریافت نشد.');
 result.checks={token:'passed',channel:'unknown',posting:'unknown'};
 return fail('posting_unverified','اتصال به ایتایار برقرار است و توکن API معتبر است. این آزمایش فقط‌خواندنی، دسترسی و مجوز ارسال به کانال را تأیید نمی‌کند؛ پیامی ارسال نشد.');
}
