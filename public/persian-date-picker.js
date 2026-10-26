import {calendarMonth,calendarParts,addDays} from './content-calendar.js';
import {dayKey,localDateTime,zonedToUtc} from './time-zone.js';
const number=value=>new Intl.NumberFormat('fa-IR',{useGrouping:false}).format(value);
const fullDate=key=>new Intl.DateTimeFormat('fa-IR',{calendar:'persian',timeZone:'UTC',dateStyle:'long'}).format(new Date(key+'T12:00:00Z'));
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const digits=value=>String(value).replace(/\d/g,n=>number(+n));
const asciiDigits=value=>String(value).trim().replace(/[۰-۹]/g,c=>c.charCodeAt(0)-1776).replace(/[٠-٩]/g,c=>c.charCodeAt(0)-1632);
export function clockPart(value,length){const ascii=asciiDigits(value);return /^\d{1,2}$/.test(ascii)&&+ascii<length?ascii.padStart(2,'0'):null;}
export function clockValue(value){
 const ascii=asciiDigits(value);
 const match=ascii.match(/^(\d{1,2}):(\d{2})$/);return match&&+match[1]<24&&+match[2]<60?match[1].padStart(2,'0')+':'+match[2]:null;
}
export function pickerMonth(anchor){return calendarMonth(anchor,'persian');}
export function futureTimeError(value,zone,now=Date.now()){
 if(!value)return '';try{return Date.parse(zonedToUtc(value,zone))<=now?'تاریخ و ساعت انتشار باید در آینده باشد':'';}catch(error){return error.message;}
}
export function dateTimeLabel(value){
 if(!value)return 'انتخاب تاریخ و ساعت';
 const p=calendarParts(value.slice(0,10));
 return digits(p.year+'/'+String(p.month).padStart(2,'0')+'/'+String(p.day).padStart(2,'0')+'، '+value.slice(11));
}
function clockColumn(name,part,label,length,value){
 const title=part==='hour'?'ساعت':'دقیقه',id=name+'-'+part;
 return `<div class="picker-clock-column"><label for="${id}">${title}</label><input id="${id}" type="text" role="spinbutton" inputmode="numeric" autocomplete="off" dir="ltr" maxlength="2" aria-label="${title} ${escape(label)}" aria-valuemin="0" aria-valuemax="${length-1}" data-date-${part} value="${digits(value)}"><div class="picker-clock-options" role="listbox" aria-label="انتخاب ${title}" data-clock-options="${part}">${Array.from({length},(_,n)=>{const option=String(n).padStart(2,'0');return `<button type="button" role="option" tabindex="-1" aria-selected="${option===value}" data-clock-part="${part}" data-clock-value="${option}">${digits(option)}</button>`;}).join('')}</div></div>`;
}
export function persianDateField(name,label,value='',hint=''){
 return `<div class="field full persian-datetime" data-date-picker="${escape(name)}"><span id="${name}-label">${escape(label)}</span><input type="hidden" name="${name}" value="${escape(value)}"><button class="button secondary date-trigger" type="button" aria-labelledby="${name}-label ${name}-date" aria-expanded="false" aria-controls="${name}-calendar" data-date-open><span id="${name}-date" dir="auto">${dateTimeLabel(value)}</span><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 5h16v16H4zM4 10h16M8 3v4M16 3v4"/></svg></button><div class="persian-picker" popover="manual" id="${name}-calendar" role="dialog" aria-label="تقویم شمسی ${escape(label)}" hidden><div data-picker-month></div><div class="picker-clock"><span>زمان انتشار</span><div class="picker-clock-fields" dir="ltr">${clockColumn(name,'hour',label,24,value.slice(11,13))}<span aria-hidden="true">:</span>${clockColumn(name,'minute',label,60,value.slice(14,16))}</div></div><p class="picker-error" role="alert" data-picker-error hidden></p><div class="picker-footer"><button type="button" data-picker-today>امروز</button><button type="button" data-picker-clear>پاک کردن</button><button type="button" data-picker-close>بستن</button><button type="button" class="button secondary small" data-picker-apply>تایید</button></div></div>${hint?'<p class="help">'+escape(hint)+'</p>':''}</div>`;
}
export function mountPersianDates(form,{zone,clock=Date.now}={}){
 const events=new AbortController(),signal=events.signal,document=form.ownerDocument,view=document.defaultView;
 const widgets=[...form.querySelectorAll('[data-date-picker]')].map(root=>{
  const hidden=root.querySelector('input[type=hidden]'),trigger=root.querySelector('[data-date-open]'),popup=root.querySelector('.persian-picker'),monthBody=root.querySelector('[data-picker-month]'),hour=root.querySelector('[data-date-hour]'),minute=root.querySelector('[data-date-minute]'),caption=trigger.querySelector('span');
  let selected=hidden.value.slice(0,10),anchor=selected||dayKey(clock(),zone),focusDay=selected||dayKey(clock(),zone);
  const parts=[{control:hour,length:24,part:'hour'},{control:minute,length:60,part:'minute'}];
  const errorText=root.querySelector('[data-picker-error]'),nextMinute=()=>localDateTime(Math.ceil((clock()+1)/60000)*60000,zone);
  function syncChoices(scroll=false){for(const {control,length,part} of parts){const value=clockPart(control.value,length);if(value)control.setAttribute('aria-valuenow',+value);else control.removeAttribute('aria-valuenow');const list=root.querySelector('[data-clock-options="'+part+'"]');for(const option of list.children){const active=option.dataset.clockValue===value;option.setAttribute('aria-selected',active);if(active&&scroll)list.scrollTop=option.offsetTop-(list.clientHeight-option.offsetHeight)/2;}}}
  function setTime(value){const wall=clockValue(value)||nextMinute().slice(11);[hour.value,minute.value]=wall.split(':').map(digits);for(const {control} of parts)control.setCustomValidity('');errorText.hidden=true;errorText.textContent='';syncChoices();}
  setTime(hidden.value.slice(11));
  function update(){
   for(const {control,length} of parts)control.setCustomValidity(clockPart(control.value,length)?'':'عددی بین ۰ و '+number(length-1)+' وارد کنید');syncChoices();
   const h=clockPart(hour.value,24),m=clockPart(minute.value,60),wall=h&&m?h+':'+m:null;
   const message=selected&&wall?futureTimeError(selected+'T'+wall,zone,clock()):'';if(message)hour.setCustomValidity(message);errorText.textContent=message;errorText.hidden=!message;
   if(!wall||message)return false;
   hidden.value=selected&&wall?selected+'T'+wall:'';caption.textContent=dateTimeLabel(hidden.value);hidden.dispatchEvent(new Event('change',{bubbles:true}));
   return true;
  }
  function close(focus=false){
   if(parts.some(({control})=>control.validationMessage)){selected=hidden.value.slice(0,10);setTime(hidden.value.slice(11));}
   if(popup.hidePopover&&popup.matches(':popover-open'))popup.hidePopover();popup.hidden=true;trigger.setAttribute('aria-expanded','false');if(focus)trigger.focus();
  }
  function choose(key){if(key<dayKey(clock(),zone))return;selected=anchor=focusDay=key;update();draw();hour.focus();}
  function draw(focus=false){
   const month=pickerMonth(anchor),current=calendarParts(anchor),title=new Intl.DateTimeFormat('fa-IR',{calendar:'persian',timeZone:'UTC',month:'long'}).format(new Date(anchor+'T12:00:00Z'))+' '+number(current.year),today=dayKey(clock(),zone);
   monthBody.innerHTML='<div class="picker-month-controls"><button type="button" data-month="-1" aria-label="ماه قبل">‹</button><strong aria-live="polite">'+title+'</strong><button type="button" data-month="1" aria-label="ماه بعد">›</button></div><div class="picker-weekdays">'+['ش','ی','د','س','چ','پ','ج'].map(day=>'<span>'+day+'</span>').join('')+'</div><div class="picker-days">'+month.days.map((day,i)=>'<button type="button" data-day="'+day.key+'" '+(day.key<today?'disabled ':'')+'aria-label="'+fullDate(day.key)+'" aria-pressed="'+(day.key===selected)+'" '+(day.key===today?'aria-current="date" ':'')+'tabindex="'+(day.key===focusDay?'0':'-1')+'" class="'+(!day.inMonth?'outside ':'')+(i%7===6?'friday ':'')+(day.key===selected?'selected':'')+'">'+number(day.day)+'</button>').join('')+'</div>';
   if(focus)monthBody.querySelector('[data-day="'+focusDay+'"]')?.focus();
  }
  function place(){if(popup.hidden)return;const rect=trigger.getBoundingClientRect(),width=Math.min(360,rect.width,view.innerWidth-24);popup.style.width=width+'px';popup.style.left=Math.max(12,Math.min(rect.right-width,view.innerWidth-width-12))+'px';popup.style.bottom=Math.max(8,view.innerHeight-rect.top+8)+'px';popup.style.maxHeight=Math.max(80,rect.top-20)+'px';}
  function open(focus=true){for(const other of widgets)if(other.root!==root)other.close();if(!selected)setTime('');anchor=selected&&selected>=dayKey(clock(),zone)?selected:dayKey(clock(),zone);focusDay=anchor;draw();popup.hidden=false;popup.showPopover?.();place();if(trigger.getBoundingClientRect().top<Math.min(popup.scrollHeight+24,view.innerHeight-80)){trigger.scrollIntoView({block:'end',behavior:'instant'});place();}syncChoices(true);trigger.setAttribute('aria-expanded','true');if(focus)monthBody.querySelector('[data-day="'+focusDay+'"]')?.focus();}
  function changeTime(){if(!selected){selected=anchor=focusDay=nextMinute().slice(0,10);draw();}return update();}
  trigger.addEventListener('click',()=>popup.hidden?open():close(),{signal});
  popup.addEventListener('click',event=>{
   const button=event.target.closest('button');if(!button)return;
   if(button.dataset.clockPart){const control=button.dataset.clockPart==='hour'?hour:minute;control.value=digits(button.dataset.clockValue);changeTime();syncChoices(true);control.focus();}
   else if(button.dataset.day)choose(button.dataset.day);
   else if(button.dataset.month){const month=pickerMonth(anchor);anchor=button.dataset.month==='1'?month.next:addDays(month.start,-1);focusDay=pickerMonth(anchor).start;draw(true);}
   else if(button.hasAttribute('data-picker-today'))choose(dayKey(clock(),zone));
   else if(button.hasAttribute('data-picker-clear')){selected='';setTime('');update();close(true);}
   else if(button.hasAttribute('data-picker-close'))close(true);
   else if(button.hasAttribute('data-picker-apply')){changeTime();if(parts.every(({control})=>control.reportValidity()))close(true);}
  },{signal});
  popup.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();close(true);return;}const step={ArrowRight:-1,ArrowLeft:1,ArrowUp:-7,ArrowDown:7}[event.key];if(step&&event.target.dataset.day){event.preventDefault();focusDay=addDays(event.target.dataset.day,step);if(focusDay<dayKey(clock(),zone))focusDay=dayKey(clock(),zone);anchor=focusDay;draw(true);}},{signal});
  for(const {control,length} of parts){
   control.addEventListener('input',changeTime,{signal});
   control.addEventListener('blur',()=>{const value=clockPart(control.value,length);if(value)control.value=digits(value);syncChoices();},{signal});
   control.addEventListener('invalid',()=>{open(false);control.focus();},{signal});
   const step=amount=>{control.value=digits(String(Math.max(0,Math.min(length-1,+(clockPart(control.value,length)||'0')+amount))).padStart(2,'0'));changeTime();syncChoices(true);};
   control.addEventListener('keydown',event=>{if(event.key==='ArrowUp'||event.key==='ArrowDown'){event.preventDefault();step(event.key==='ArrowUp'?1:-1);}else if(event.key==='Enter'){event.preventDefault();changeTime();if(parts.every(({control})=>control.reportValidity()))close(true);}},{signal});
   control.addEventListener('wheel',event=>{if(!event.deltaY)return;event.preventDefault();step(event.deltaY<0?1:-1);},{signal,passive:false});
  }
  view.addEventListener('resize',place,{signal});document.addEventListener('scroll',place,{signal,capture:true});
  return {root,close,popup,validate(){if(!selected||update())return true;open(false);parts.find(({control})=>control.validationMessage)?.control.reportValidity();return false;}};
 });
 document.addEventListener('click',event=>{const path=event.composedPath();for(const widget of widgets)if(!path.includes(widget.root)&&!path.includes(widget.popup))widget.close();},{signal});
 form.addEventListener('submit',event=>{if(widgets.some(widget=>!widget.validate())){event.preventDefault();event.stopImmediatePropagation();}},{signal,capture:true});
 return {destroy(){for(const widget of widgets)widget.close();events.abort();}};
}
