import {calendarMonth,calendarParts,addDays} from './content-calendar.js';
import {dayKey,localDateTime} from './time-zone.js';
const number=value=>new Intl.NumberFormat('fa-IR',{useGrouping:false}).format(value);
const fullDate=key=>new Intl.DateTimeFormat('fa-IR',{calendar:'persian',timeZone:'UTC',dateStyle:'long'}).format(new Date(key+'T12:00:00Z'));
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const digits=value=>String(value).replace(/\d/g,n=>number(+n));
export function clockValue(value){
 const ascii=String(value).trim().replace(/[۰-۹]/g,c=>c.charCodeAt(0)-1776).replace(/[٠-٩]/g,c=>c.charCodeAt(0)-1632);
 const match=ascii.match(/^(\d{1,2}):(\d{2})$/);return match&&+match[1]<24&&+match[2]<60?match[1].padStart(2,'0')+':'+match[2]:null;
}
export function pickerMonth(anchor){return calendarMonth(anchor,'persian');}
export function dateTimeLabel(value){
 if(!value)return 'انتخاب تاریخ و ساعت';
 const p=calendarParts(value.slice(0,10));
 return digits(p.year+'/'+String(p.month).padStart(2,'0')+'/'+String(p.day).padStart(2,'0')+'، '+value.slice(11));
}
export function persianDateField(name,label,value='',hint=''){
 return `<div class="field full persian-datetime" data-date-picker="${escape(name)}"><span id="${name}-label">${escape(label)}</span><input type="hidden" name="${name}" value="${escape(value)}"><button class="button secondary date-trigger" type="button" aria-labelledby="${name}-label ${name}-date" aria-expanded="false" aria-controls="${name}-calendar" data-date-open><span id="${name}-date" dir="auto">${dateTimeLabel(value)}</span><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 5h16v16H4zM4 10h16M8 3v4M16 3v4"/></svg></button><div class="persian-picker" id="${name}-calendar" role="dialog" aria-label="تقویم شمسی ${escape(label)}" hidden><div data-picker-month></div><div class="picker-clock"><label for="${name}-clock">ساعت</label><input id="${name}-clock" type="text" inputmode="numeric" dir="ltr" autocomplete="off" placeholder="۱۴:۳۰" aria-label="ساعت ${escape(label)}" data-date-clock value="${value?digits(value.slice(11)):''}"><span>۲۴ ساعته</span></div><div class="picker-footer"><button type="button" data-picker-today>امروز</button><button type="button" data-picker-clear>پاک کردن</button><button type="button" class="button secondary small" data-picker-apply>تایید</button></div></div>${hint?'<p class="help">'+escape(hint)+'</p>':''}</div>`;
}
export function mountPersianDates(form,{zone,clock=Date.now}={}){
 const events=new AbortController(),signal=events.signal,document=form.ownerDocument;
 const widgets=[...form.querySelectorAll('[data-date-picker]')].map(root=>{
  const hidden=root.querySelector('input[type=hidden]'),trigger=root.querySelector('[data-date-open]'),popup=root.querySelector('.persian-picker'),monthBody=root.querySelector('[data-picker-month]'),time=root.querySelector('[data-date-clock]'),caption=trigger.querySelector('span');
  let selected=hidden.value.slice(0,10),anchor=selected||dayKey(clock(),zone),focusDay=selected||dayKey(clock(),zone);
  function update(){
   const wall=clockValue(time.value);
   time.setCustomValidity(time.value&&!wall?'ساعت را از ۰۰:۰۰ تا ۲۳:۵۹ وارد کنید':selected&&!wall?'ساعت انتشار را وارد کنید':!selected&&time.value?'تاریخ را هم انتخاب کنید':'');
   // A partially typed clock must not erase a previously saved date and time.
   if(time.validationMessage)return;
   hidden.value=selected&&wall?selected+'T'+wall:'';caption.textContent=dateTimeLabel(hidden.value);hidden.dispatchEvent(new Event('change',{bubbles:true}));
  }
  function close(focus=false){
   if(time.validationMessage){selected=hidden.value.slice(0,10);time.value=digits(hidden.value.slice(11));time.setCustomValidity('');}
   popup.hidden=true;trigger.setAttribute('aria-expanded','false');if(focus)trigger.focus();
  }
  function choose(key){selected=anchor=focusDay=key;if(!clockValue(time.value))time.value=digits(localDateTime(clock(),zone).slice(11));update();draw();time.focus();}
  function draw(focus=false){
   const month=pickerMonth(anchor),current=calendarParts(anchor),title=new Intl.DateTimeFormat('fa-IR',{calendar:'persian',timeZone:'UTC',month:'long'}).format(new Date(anchor+'T12:00:00Z'))+' '+number(current.year),today=dayKey(clock(),zone);
   monthBody.innerHTML='<div class="picker-month-controls"><button type="button" data-month="-1" aria-label="ماه قبل">‹</button><strong aria-live="polite">'+title+'</strong><button type="button" data-month="1" aria-label="ماه بعد">›</button></div><div class="picker-weekdays">'+['ش','ی','د','س','چ','پ','ج'].map(day=>'<span>'+day+'</span>').join('')+'</div><div class="picker-days">'+month.days.map((day,i)=>'<button type="button" data-day="'+day.key+'" aria-label="'+fullDate(day.key)+'" aria-pressed="'+(day.key===selected)+'" '+(day.key===today?'aria-current="date" ':'')+'tabindex="'+(day.key===focusDay?'0':'-1')+'" class="'+(!day.inMonth?'outside ':'')+(i%7===6?'friday ':'')+(day.key===selected?'selected':'')+'">'+number(day.day)+'</button>').join('')+'</div>';
   if(focus)monthBody.querySelector('[data-day="'+focusDay+'"]')?.focus();
  }
  function open(focus=true){for(const other of widgets)if(other.root!==root)other.close();anchor=selected||dayKey(clock(),zone);focusDay=anchor;draw();popup.hidden=false;trigger.setAttribute('aria-expanded','true');if(focus)monthBody.querySelector('[data-day="'+focusDay+'"]')?.focus();}
  trigger.addEventListener('click',()=>popup.hidden?open():close(),{signal});
  popup.addEventListener('click',event=>{
   const button=event.target.closest('button');if(!button)return;
   if(button.dataset.day)choose(button.dataset.day);
   else if(button.dataset.month){const month=pickerMonth(anchor);anchor=button.dataset.month==='1'?month.next:addDays(month.start,-1);focusDay=pickerMonth(anchor).start;draw(true);}
   else if(button.hasAttribute('data-picker-today'))choose(dayKey(clock(),zone));
   else if(button.hasAttribute('data-picker-clear')){selected='';time.value='';update();close(true);}
   else if(button.hasAttribute('data-picker-apply')){update();if(time.reportValidity())close(true);}
  },{signal});
  popup.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();close(true);return;}if(event.key==='Enter'&&event.target===time){event.preventDefault();update();if(time.reportValidity())close(true);return;}const step={ArrowRight:-1,ArrowLeft:1,ArrowUp:-7,ArrowDown:7}[event.key];if(step&&event.target.dataset.day){event.preventDefault();focusDay=addDays(event.target.dataset.day,step);anchor=focusDay;draw(true);}},{signal});
  time.addEventListener('input',update,{signal});time.addEventListener('blur',()=>{const wall=clockValue(time.value);if(wall)time.value=digits(wall);},{signal});time.addEventListener('invalid',()=>{open(false);time.focus();},{signal});
  return {root,close};
 });
 document.addEventListener('click',event=>{const path=event.composedPath();for(const widget of widgets)if(!path.includes(widget.root))widget.close();},{signal});
 return {destroy(){events.abort();}};
}
