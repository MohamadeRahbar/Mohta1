// All persisted instants are UTC; wall times are converted only at the UI boundary.
const validZones=new Map(),formatters=new Map();
export function validTimeZone(zone){
 if(typeof zone!=='string'||zone.length>100)return false;if(validZones.has(zone))return validZones.get(zone);
 let valid=false;try{valid=!!new Intl.DateTimeFormat('en',{timeZone:zone}).format(0);}catch{}if(valid)validZones.set(zone,true);return valid;
}
export function timeZone(zone){return validTimeZone(zone)?zone:'Asia/Tehran';}
const cityNames={'Asia/Tehran':'تهران','Asia/Dubai':'دبی','Asia/Kabul':'کابل','Europe/Istanbul':'استانبول','Europe/London':'لندن','Europe/Berlin':'برلین','America/New_York':'نیویورک','America/Los_Angeles':'لس آنجلس','America/Toronto':'تورنتو','Australia/Sydney':'سیدنی',UTC:'زمان جهانی'};
export function zoneLabel(zone){return cityNames[zone]||zone.replaceAll('_',' ');}
export function timeZones(selected='Asia/Tehran'){
 return [...new Set([...Object.keys(cityNames),selected,...(Intl.supportedValuesOf?.('timeZone')||[])])].filter(validTimeZone);
}
function parts(instant,zone){
 zone=timeZone(zone);if(!formatters.has(zone))formatters.set(zone,new Intl.DateTimeFormat('en-CA',{timeZone:zone,calendar:'gregory',numberingSystem:'latn',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}));
 return Object.fromEntries(formatters.get(zone).formatToParts(new Date(instant)).map(x=>[x.type,x.value]));
}
export function localDateTime(instant,zone){
 if(!instant)return '';const p=parts(instant,zone);return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
export function dayKey(instant,zone){return localDateTime(instant,zone).slice(0,10);}
function offsetAt(instant,zone){const p=parts(instant,zone);return Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second)-Math.floor(instant/1000)*1000;}
export function wallTimeInstants(value,zone){
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))return [];
 const raw=Date.parse(value+':00Z');if(!Number.isFinite(raw)||new Date(raw).toISOString().slice(0,16)!==value)return [];
 const offsets=new Set();for(let hour=-36;hour<=36;hour+=6)offsets.add(offsetAt(raw+hour*3600000,zone));
 return [...offsets].map(offset=>raw-offset).filter(instant=>localDateTime(instant,zone)===value).sort((a,b)=>a-b);
}
export function zonedToUtc(value,zone){
 if(!value)return null;const instants=wallTimeInstants(value,zone);
 if(!instants.length)throw Error('این ساعت در منطقه زمانی انتخاب شده معتبر نیست ساعت دیگری را انتخاب کنید');
 if(instants.length>1)throw Error('این ساعت هنگام تغییر ساعت فصلی دو بار رخ میدهد ساعت دیگری را انتخاب کنید');
 return new Date(instants[0]).toISOString();
}
export function dayStart(key,zone){
 // Some historical DST changes skip midnight; use the first real minute of that day.
 for(let minute=0;minute<180;minute++){
  const hh=String(Math.floor(minute/60)).padStart(2,'0'),mm=String(minute%60).padStart(2,'0'),values=wallTimeInstants(`${key}T${hh}:${mm}`,zone);
  if(values.length)return new Date(values[0]).toISOString();
 }
 throw Error('شروع روز در این منطقه زمانی معتبر نیست');
}
