import {check} from './content.mjs';
export function publishOptions(value={}){
 check(value&&typeof value==='object'&&!Array.isArray(value),'گزینه های انتشار معتبر نیست');
 check(value.pin===undefined||typeof value.pin==='boolean','گزینه پین معتبر نیست');check(value.track_links===undefined||typeof value.track_links==='boolean','گزینه آمار کلیک معتبر نیست');
 const reply=value.reply_to||null;
 if(reply)check(typeof reply==='object'&&/^[a-f0-9-]{36}$/.test(reply.post_id)&&Number.isSafeInteger(reply.version)&&reply.version>0,'پیام مرجع معتبر نیست');
 return {pin:!!value.pin,track_links:!!value.track_links,reply_to:reply?{post_id:reply.post_id,version:reply.version}:null};
}
export function messageCapabilities(platform,{mediaCount=0,sentAt,deleted=false,clock=Date.now}={}){
 const supported=['telegram','bale','rubika'].includes(platform),young=!!sentAt&&Number.isFinite(Date.parse(sentAt))&&clock()-Date.parse(sentAt)<48*3600000;
 const reason=deleted?'این پیام قبلا از کانال حذف شده است':platform==='eitaa'?'API عمومی ایتایار این عملیات را مستند نکرده است':!supported?'این اتصال پشتیبانی نمیشود':'';
 return {edit:!reason&&supported,media:!reason&&platform==='telegram'&&mediaCount>0,pin:!reason&&['telegram','bale'].includes(platform),unpin:!reason&&['telegram','bale'].includes(platform),delete:!reason&&supported&&(platform==='rubika'||young),reason,deleteReason:reason||(!young&&platform!=='rubika'?'مهلت ۴۸ ساعت حذف این پیام گذشته است':''),views:{supported:false,reason:platform==='telegram'?'بازدید به اتصال جداگانه حساب کاربری تلگرام نیاز دارد':'آمار بازدید در API عمومی این اتصال در دسترس نیست'}};
}
