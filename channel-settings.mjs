import {requireDestination,invalidateDestinationQueue} from './destinations.mjs';
import {check,text} from './content.mjs';
import {validateProxy} from './network.mjs';
import {platformNames} from './store.mjs';

export function saveChannelSettings(store,id,data,actor){
 const previous=requireDestination(store,id);
 check(['direct','proxy'].includes(data.route),'مسیر اتصال معتبر نیست.');
 const name=text(data.name||platformNames[previous.platform],100),target=text(data.target||'',200);
 check(typeof data.enabled==='boolean','وضعیت کانال معتبر نیست.');
 const token=text(data.token||'',3000),proxy=text(data.proxy||'',2000),clearToken=data.clearToken===true,clearProxy=data.clearProxy===true;
 check(!(clearToken&&token),'برای جایگزینی توکن، گزینهٔ پاک‌کردن توکن را بردارید.');
 check(!(clearProxy&&proxy),'برای جایگزینی پروکسی، گزینهٔ پاک‌کردن پروکسی را بردارید.');
 const proxyValue=proxy?validateProxy(proxy):'';
 check(data.route!=='proxy'||(!clearProxy&&(proxyValue||store.hasSecret('proxy:'+id))),'برای مسیر پروکسی، آدرس آن را وارد کنید؛ اگر از VPN سیستم استفاده می‌کنید، «اینترنت سیستم / VPN» را انتخاب کنید.');
 const identityChanged=target!==previous.target||data.enabled!==!!previous.enabled||clearToken||!!token&&token!==store.secret('token:'+id);
 store.transaction(()=>{
   if(identityChanged){check(!store.db.prepare("SELECT id FROM publications WHERE channel_id=? AND status='sending'").get(id),'این مقصد در حال ارسال است',409);invalidateDestinationQueue(store,id);store.db.prepare('UPDATE channels SET identity_version=identity_version+1 WHERE id=?').run(id);}
   if(clearToken)store.saveSecret('token:'+id,'');else if(token)store.saveSecret('token:'+id,token);
   if(clearProxy)store.saveSecret('proxy:'+id,'');else if(proxyValue)store.saveSecret('proxy:'+id,proxyValue);
   store.db.prepare('UPDATE channels SET name=?,target=?,enabled=?,route=?,network_status=NULL,last_checked=NULL,network_detail=NULL,access_detail=NULL,config_version=config_version+1 WHERE id=?').run(name,target,Number(data.enabled),data.route,id);
   store.audit(actor,'channel.update',id,{route:data.route,enabled:data.enabled});
 });
}
