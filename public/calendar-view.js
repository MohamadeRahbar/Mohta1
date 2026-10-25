import {calendarRange,calendarMonth,addDays,groupCalendarEvents} from './content-calendar.js';
import {dayKey,timeZone,zoneLabel} from './time-zone.js';
import {officialDay,missingOfficialYears,worldSource} from './calendar-observances.js';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=value=>new Intl.NumberFormat('fa-IR').format(value);
const yearNumber=value=>new Intl.NumberFormat('fa-IR',{useGrouping:false}).format(value);
export function mountCalendar(host,{load,openPost,openQueue,timeZone:zone,canChangeZone=false,initial=null,onState=()=>{}}){
 zone=timeZone(zone);const today=()=>dayKey(new Date(),zone),events=new AbortController();
 let anchor=initial?.anchor||today(),selected=initial?.selected||today(),calendar=initial?.calendar||'persian',filter=initial?.filter||'all',data=null,error='',busy=false,stopped=false,sequence=0,occasionsOpen=false;
 const formatDay=key=>new Intl.DateTimeFormat('fa-IR',{calendar,timeZone:'UTC',dateStyle:'full'}).format(new Date(key+'T12:00:00Z')).replace(/\u200c/g,' ');
 const monthLabel=()=>new Intl.DateTimeFormat('fa-IR',{calendar,timeZone:'UTC',year:'numeric',month:'long'}).format(new Date(anchor+'T12:00:00Z'));
 const time=instant=>new Intl.DateTimeFormat('fa-IR',{timeZone:zone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(instant));
 const save=()=>onState({anchor,selected,calendar,filter});
 function status(event){return event.kind==='queued'?(event.automatic?'در صف ارسال خودکار':'در صف ارسال دستی'):(event.attention?'ارسال شده با نتیجه نیازمند بررسی':'منتشر شده');}
 function occasionsMarkup(facts){return `<details class="calendar-observances" ${occasionsOpen?'open':''}><summary>مناسبت های روز <span>${number(facts.occasions.length)}</span></summary><div class="calendar-occasion-body">${facts.occasions.length?`<ul>${facts.occasions.map(row=>`<li><span class="calendar-occasion-type">${row.category==='religious'?'مذهبی':'جهانی'}</span><span>${escape(row.title)}</span></li>`).join('')}</ul>`:'<p>در فهرست فعلی مناسبتی برای این روز ثبت نشده است</p>'}<div class="calendar-occasion-sources">${facts.source?`<a href="${escape(facts.source)}" target="_blank" rel="noreferrer">تقویم رسمی ${yearNumber(facts.year)}</a>`:'<span>مناسبت مذهبی این سال هنوز ثبت نشده است</span>'}<a href="${worldSource}" target="_blank" rel="noreferrer">مناسبت های جهانی منتخب سازمان ملل</a></div></div></details>`;}
 function render(){
  if(stopped)return;save();const month=calendarMonth(anchor,calendar),groups=groupCalendarEvents(data?.events||[],zone,filter),dayEvents=groups.get(selected)||[],focus=host.contains(host.ownerDocument.activeElement)?host.ownerDocument.activeElement.dataset.calendarFocus:null;
  const facts=officialDay(selected),missing=missingOfficialYears(month.days);
  host.innerHTML=`<section class="panel content-calendar" aria-label="تقویم محتوایی" aria-busy="${busy}">
   <div class="calendar-toolbar"><div class="calendar-month-controls"><button type="button" class="button secondary small" data-calendar="previous" data-calendar-focus="previous" aria-label="ماه قبل"><bdi dir="ltr">›</bdi></button><h2 aria-live="polite">${escape(monthLabel())}</h2><button type="button" class="button secondary small" data-calendar="next" data-calendar-focus="next" aria-label="ماه بعد"><bdi dir="ltr">‹</bdi></button><button type="button" class="button secondary small" data-calendar="today" data-calendar-focus="today">امروز</button></div>
    <label class="calendar-system">نوع تقویم<select data-calendar-system data-calendar-focus="system" aria-label="نوع تقویم"><option value="persian" ${calendar==='persian'?'selected':''}>شمسی</option><option value="gregory" ${calendar==='gregory'?'selected':''}>میلادی</option></select></label>
   </div>
   <div class="calendar-context"><span>منطقه زمانی: <strong>${escape(zoneLabel(zone))}</strong> <bdi>${escape(zone)}</bdi></span>${canChangeZone?'<a href="#settings/timezone">تغییر منطقه زمانی</a>':''}</div>
   <div class="calendar-filters" role="group" aria-label="نوع رویداد تقویم">${[['all','همه'],['queued','صف انتشار'],['published','منتشر شده']].map(([key,label])=>`<button type="button" class="filter ${filter===key?'active':''}" data-calendar="filter" data-value="${key}" data-calendar-focus="filter-${key}" aria-pressed="${filter===key}">${label}</button>`).join('')}<span class="calendar-legend"><span class="calendar-dot queued"></span>صف انتشار <span class="calendar-dot published"></span>منتشر شده <span class="calendar-dot holiday"></span>تعطیل در ایران</span></div>
   ${missing.length?`<p class="calendar-coverage" role="status">تعطیلات رسمی و مناسبت های مذهبی سال ${missing.map(yearNumber).join(' و ')} هنوز ثبت نشده اند</p>`:''}
   ${error?`<div class="calendar-error" role="alert">${escape(error)} <button type="button" class="button secondary small" data-calendar="refresh">تلاش دوباره</button></div>`:''}
   ${busy&&!data?'<p class="calendar-loading" role="status">در حال دریافت رویدادها…</p>':''}
   ${data?.unscheduled?`<div class="calendar-unscheduled"><span>${number(data.unscheduled)} محتوا در صف بدون زمان انتشار است</span><button type="button" class="button secondary small" data-calendar="queue">مشاهده صف در کتابخانه</button></div>`:''}
   <div class="calendar-layout"><div class="calendar-month"><div class="calendar-weekdays" aria-hidden="true">${['شنبه','یکشنبه','دوشنبه','سه شنبه','چهارشنبه','پنجشنبه','جمعه'].map(day=>'<span>'+day+'</span>').join('')}</div><div class="calendar-grid" role="group" aria-label="روزهای ماه">${month.days.map(day=>{const rows=groups.get(day.key)||[],info=officialDay(day.key);return `<div data-calendar="day" data-day="${day.key}" class="calendar-cell ${info.holiday?'holiday':''} ${info.friday?'friday':''} ${day.inMonth?'':'outside'} ${day.key===selected?'selected':''} ${day.key===today()?'today':''}"><button type="button" class="calendar-day" data-calendar="day" data-day="${day.key}" data-calendar-focus="day-${day.key}" aria-pressed="${day.key===selected}" aria-label="${escape(formatDay(day.key))}، ${number(rows.length)} رویداد${info.holiday?'، تعطیل: '+escape(info.holiday):info.friday?'، جمعه':''}"><span>${number(day.day)}</span><span class="calendar-day-count">${rows.length?number(rows.length):''}</span></button>${info.holiday?`<span class="calendar-holiday-label" title="${escape(info.holiday)}">${escape(info.holiday)}</span>`:''}<div class="calendar-event-chips">${rows.slice(0,2).map(event=>`<button type="button" class="calendar-chip ${event.kind}" data-calendar="post" data-id="${escape(event.postId)}" title="${escape(status(event)+' · '+event.title)}"><bdi>${time(event.at)}</bdi> ${escape(event.title)}</button>`).join('')}${rows.length>2?`<button type="button" class="calendar-more" data-calendar="day" data-day="${day.key}">${number(rows.length-2)} مورد دیگر</button>`:''}</div><span class="calendar-mobile-dots" aria-hidden="true">${['queued','published'].filter(kind=>rows.some(event=>event.kind===kind)).map(kind=>'<span class="calendar-dot '+kind+'"></span>').join('')}</span></div>`;}).join('')}</div></div>
    <aside class="calendar-agenda" aria-label="رویدادهای روز انتخاب شده"><div class="calendar-agenda-heading"><h3>${escape(formatDay(selected))}</h3><button type="button" class="button secondary small calendar-back" data-calendar="month">بازگشت به تقویم</button></div>${facts.holiday||facts.friday?`<div class="calendar-day-holiday">${escape(facts.holiday||'جمعه')} <span>تعطیل در ایران</span></div>`:''}<div class="calendar-agenda-list">${dayEvents.length?dayEvents.map(event=>`<button type="button" class="calendar-agenda-event ${event.kind}" data-calendar="post" data-id="${escape(event.postId)}"><span class="calendar-event-time">${time(event.at)}</span><strong>${escape(event.title)}</strong><span class="calendar-event-status">${escape(status(event))}</span><small>نسخه ${number(event.version)} · ${number(event.destinations.length)} مقصد${event.archived?' · بایگانی شده':''}</small></button>`).join(''):`<p class="calendar-day-empty">${error?'دریافت رویدادها کامل نشد':busy?'در حال دریافت رویدادها…':'برای این روز رویدادی نداریم'}</p>`}</div>${occasionsMarkup(facts)}</aside></div>
   <p class="calendar-footnote">صف بر اساس زمان تعیین شده و انتشار بر اساس رسید موفق هر مقصد نمایش داده میشود <a href="https://calendar.ut.ac.ir/" target="_blank" rel="noreferrer">منبع تعطیلات ایران</a></p></section>`;
  if(focus)host.querySelector(`[data-calendar-focus="${focus}"]`)?.focus({preventScroll:true});
 }
 async function refresh({silent=false}={}){
  if(stopped||busy&&silent)return;const request=++sequence,hadError=!!error;busy=true;error='';if(!silent)render();
  try{const range=calendarRange(anchor,calendar,zone),result=await load(range.from,range.to);if(stopped||request!==sequence)return;if(result.timeZone&&timeZone(result.timeZone)!==zone){zone=timeZone(result.timeZone);data=null;busy=false;return refresh();}const changed=JSON.stringify(result)!==JSON.stringify(data);data=result;busy=false;if(changed||!silent||hadError)render();}
  catch(e){if(stopped||request!==sequence)return;busy=false;error=e.message||'دریافت تقویم ممکن نشد';render();}
 }
 host.addEventListener('click',async event=>{
  const button=event.target.closest('[data-calendar]');if(!button||!host.contains(button))return;
  const action=button.dataset.calendar;
  if(action==='post'){button.disabled=true;try{await openPost(button.dataset.id);}catch(e){error=e.message;render();}finally{if(button.isConnected)button.disabled=false;}return;}
  if(action==='queue'){openQueue();return;}
  const window=host.ownerDocument.defaultView,behavior=window.matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth';
  if(action==='month'){host.querySelector('.calendar-month').scrollIntoView({block:'start',behavior});return;}
  if(action==='day'){selected=button.dataset.day;occasionsOpen=false;render();if(window.matchMedia('(max-width:760px)').matches)host.querySelector('.calendar-agenda').scrollIntoView({block:'start',behavior});return;}
  if(action==='filter'){filter=button.dataset.value;render();return;}
  if(action==='previous'||action==='next'){occasionsOpen=false;const month=calendarMonth(anchor,calendar);anchor=action==='previous'?addDays(month.start,-1):month.next;selected=calendarMonth(anchor,calendar).start;data=null;}
  if(action==='today'){occasionsOpen=false;anchor=today();selected=anchor;data=null;}
  await refresh();
 },{signal:events.signal});
 host.addEventListener('toggle',event=>{if(host.contains(event.target)&&event.target.matches('.calendar-observances'))occasionsOpen=event.target.open;},{capture:true,signal:events.signal});
 host.addEventListener('change',event=>{if(event.target.matches('[data-calendar-system]')){calendar=event.target.value;data=null;refresh();}},{signal:events.signal});
 render();refresh();return {refresh,destroy(){stopped=true;sequence++;events.abort();}};
}
