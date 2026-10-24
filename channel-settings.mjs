import {check,text} from './content.mjs';
import {validateProxy} from './network.mjs';
import {platformNames} from './store.mjs';

export function saveChannelSettings(store,id,data,actor){
 check(['direct','proxy'].includes(data.route),'مسیر اتصال معتبر نیست.');
 const name=text(data.name||platformNames[id],100),target=text(data.target||'',200);
 check(typeof data.enabled==='boolean','وضعیت کانال معتبر نیست.');
 const token=text(data.token||'',3000),proxy=text(data.proxy||'',2000),clearToken=data.clearToken===true,clearProxy=data.clearProxy===true;
 check(!(clearToken&&token),'برای جایگزینی توکن، گزینهٔ پاک‌کردن توکن را بردارید.');
 check(!(clearProxy&&proxy),'برای جایگزینی پروکسی، گزینهٔ پاک‌کردن پروکسی را بردارید.');
 const proxyValue=proxy?validateProxy(proxy):'';
 check(data.route!=='proxy'||(!clearProxy&&(proxyValue||store.hasSecret('proxy:'+id))),'برای مسیر پروکسی، آدرس آن را وارد کنید؛ اگر از VPN سیستم استفاده می‌کنید، «اینترنت سیستم / VPN» را انتخاب کنید.');
 store.transaction(()=>{
   if(clearToken)store.saveSecret('token:'+id,'');else if(token)store.saveSecret('token:'+id,token);
   if(clearProxy)store.saveSecret('proxy:'+id,'');else if(proxyValue)store.saveSecret('proxy:'+id,proxyValue);
   store.db.prepare('UPDATE channels SET name=?,target=?,enabled=?,route=?,network_status=NULL,last_checked=NULL,network_detail=NULL,access_detail=NULL,config_version=config_version+1 WHERE id=?').run(name,target,Number(data.enabled),data.route,id);
   store.audit(actor,'channel.update',id,{route:data.route,enabled:data.enabled});
 });
}
