import {dayKey,dayStart,timeZone} from './time-zone.js';
import {officialYears} from './calendar-data.js';
const dayMilliseconds=86400000;
export function addDays(key,days){return new Date(Date.parse(key+'T12:00:00Z')+days*dayMilliseconds).toISOString().slice(0,10);}
export function calendarParts(key,calendar='persian'){
 const parts=new Intl.DateTimeFormat('en-US',{calendar,numberingSystem:'latn',timeZone:'UTC',year:'numeric',month:'numeric',day:'numeric'}).formatToParts(new Date(key+'T12:00:00Z'));
 return Object.fromEntries(parts.filter(p=>['year','month','day'].includes(p.type)).map(p=>[p.type,Number(p.value)]));
}
export function calendarMonth(anchor,calendar='persian'){
 const current=calendarParts(anchor,calendar),official=calendar==='persian'?officialYears[current.year]:null,start=official?.monthStarts[current.month-1]||addDays(anchor,1-current.day);let next=official?addDays(start,official.monthLengths[current.month-1]):addDays(start,28);
 if(!official)while(calendarParts(next,calendar).month===current.month)next=addDays(next,1);
 const weekday=(new Date(start+'T12:00:00Z').getUTCDay()+1)%7,gridStart=addDays(start,-weekday);
 const size=Math.ceil((Date.parse(next)-Date.parse(gridStart))/dayMilliseconds/7)*7,gridEnd=addDays(gridStart,size);
 return {start,next,gridStart,gridEnd,days:Array.from({length:size},(_,i)=>{const key=addDays(gridStart,i);return {key,day:calendarParts(key,calendar).day,inMonth:key>=start&&key<next};})};
}
export function calendarRange(anchor,calendar,zone){const month=calendarMonth(anchor,calendar);return {...month,from:dayStart(month.gridStart,zone),to:dayStart(month.gridEnd,zone)};}
export function groupCalendarEvents(events,zone,filter='all'){
 const groups=new Map();for(const event of events){if(filter!=='all'&&event.kind!==filter)continue;const key=dayKey(event.at,timeZone(zone));if(!groups.has(key))groups.set(key,[]);groups.get(key).push(event);}
 for(const rows of groups.values())rows.sort((a,b)=>a.at.localeCompare(b.at)||a.id.localeCompare(b.id));return groups;
}
