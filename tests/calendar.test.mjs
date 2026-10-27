import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openStore} from '../src/storage/store.mjs';
import {contentCalendar,calendarWindow} from '../src/calendar/content-calendar.mjs';
import {calendarMonth,calendarParts,calendarRange,groupCalendarEvents} from '../public/content-calendar.js';
import {localDateTime,zonedToUtc,dayKey,dayStart,validTimeZone,wallTimeInstants} from '../public/time-zone.js';
import {officialYears} from '../public/calendar-data.js';
import {officialDay,missingOfficialYears} from '../public/calendar-observances.js';

test('Persian month boundaries include leap Esfand, Nowruz and Saturday-first complete weeks',()=>{
 assert.deepEqual(calendarParts('2025-03-21'),{month:1,day:1,year:1404});
 const leap=calendarMonth('2025-03-15');assert.equal(leap.start,'2025-02-19');assert.equal(leap.next,'2025-03-21');assert.equal(leap.days.filter(d=>d.inMonth).length,30);
 const normal=calendarMonth('2024-03-15');assert.equal(normal.days.filter(d=>d.inMonth).length,29);
 const nowruz=calendarMonth('2025-03-21');assert.equal(nowruz.next,'2025-04-21');assert.equal(nowruz.days.length%7,0);assert.equal(new Date(nowruz.gridStart+'T12:00Z').getUTCDay(),6);
 const gregorian=calendarMonth('2024-02-20','gregory');assert.equal(gregorian.start,'2024-02-01');assert.equal(gregorian.next,'2024-03-01');assert.equal(gregorian.days.filter(d=>d.inMonth).length,29);
});

test('wall time conversion supports different cities, fractional offsets and DST safely',()=>{
 assert(validTimeZone('Asia/Tehran'));assert(!validTimeZone('not/a-zone'));
 assert.equal(zonedToUtc('2026-10-25T09:30','Asia/Tehran'),'2026-10-25T06:00:00.000Z');
 assert.equal(zonedToUtc('2026-10-25T09:30','Asia/Kathmandu'),'2026-10-25T03:45:00.000Z');
 assert.equal(zonedToUtc('2025-07-01T09:00','America/New_York'),'2025-07-01T13:00:00.000Z');
 assert.equal(localDateTime('2025-01-01T01:00:00Z','America/New_York'),'2024-12-31T20:00');
 assert.equal(dayKey('2025-01-01T01:00:00Z','Asia/Tehran'),'2025-01-01');
 assert.equal(dayStart('2025-07-01','America/New_York'),'2025-07-01T04:00:00.000Z');
 assert.throws(()=>zonedToUtc('2025-03-09T02:30','America/New_York'),/معتبر نیست/);
 assert.throws(()=>zonedToUtc('2025-11-02T01:30','America/New_York'),/دو بار/);
 assert.equal(wallTimeInstants('2025-02-30T09:00','UTC').length,0);
 const range=calendarRange('2025-03-21','persian','Europe/London');assert.equal(dayKey(range.from,'Europe/London'),range.gridStart);assert.equal(dayKey(range.to,'Europe/London'),range.gridEnd);
});

function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mohta-calendar-')),store=openStore(dir),timestamp='2026-10-01T00:00:00.000Z';
 const user={id:'owner',role:'admin',channels:'["telegram","bale"]'};
 store.db.prepare('INSERT INTO users(id,username,name,password,role,channels,created_at) VALUES(?,?,?,?,?,?,?)').run(user.id,'owner','Owner','unused','admin',user.channels,timestamp);
 const post=(id,status='published',channels=['telegram','bale'],scheduled=null,author='owner')=>store.db.prepare('INSERT INTO posts(id,type,title,fields,body,channels,media,status,version,author_id,created_at,updated_at,scheduled_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,'free',id,'{}','body',JSON.stringify(channels),'[]',status,1,author,timestamp,timestamp,scheduled);
 const receipt=(id,channel='telegram',at='2026-10-25T08:00:00.000Z',status='sent',version=1)=>store.db.prepare('INSERT INTO publications(id,post_id,channel_id,status,version,published_at,channel_name,platform) VALUES(?,?,?,?,?,?,?,?)').run(`${id}:${version}:${channel}`,id,channel,status,version,at,channel,channel);
 t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});return {store,user,post,receipt,read:(actor=user,zone='Asia/Tehran')=>contentCalendar(store,actor,'2026-10-01T00:00:00.000Z','2026-11-01T00:00:00.000Z',zone)};
}

test('calendar uses real receipts, groups same-day destinations and excludes drafts, deleted and failed-only sends',t=>{
 const f=fixture(t);f.post('sent');f.receipt('sent');f.receipt('sent','bale','2026-10-25T08:00:03.000Z');
 f.post('partial','partial');f.receipt('partial');f.receipt('partial','bale',null,'unknown');
 f.post('failed','uncertain');f.receipt('failed','telegram',null,'unknown');f.post('draft','draft');f.post('queued','ready',['telegram'],'2026-10-28T13:00:00.000Z');f.post('manual','ready');
 f.post('archived');f.receipt('archived');f.store.db.prepare('UPDATE posts SET archived_at=? WHERE id=?').run('2026-10-26','archived');
 f.post('deleted');f.receipt('deleted');f.store.db.prepare('UPDATE posts SET deleted_at=? WHERE id=?').run('2026-10-26','deleted');
 const data=f.read();assert.equal(data.events.length,4);assert.equal(data.unscheduled,1);
 const sent=data.events.find(e=>e.postId==='sent');assert.equal(sent.destinations.length,2);assert.equal(sent.receipts.length,2);assert.equal(sent.attention,false);
 assert(data.events.find(e=>e.postId==='partial').attention);assert(data.events.find(e=>e.postId==='archived').archived);
 assert.equal(data.events.find(e=>e.postId==='queued').automatic,false);assert(!data.events.some(e=>['draft','failed','deleted'].includes(e.postId)));
 assert.equal(groupCalendarEvents(data.events,'Asia/Tehran','queued').get('2026-10-28').length,1);
});

test('calendar covers all month rows beyond the library cap and restricts receipts to member destinations',t=>{
 const f=fixture(t);f.store.db.prepare('INSERT INTO users(id,username,name,password,role,channels,created_at) VALUES(?,?,?,?,?,?,?)').run('member','member','Member','unused','viewer','["telegram"]','2026-10-01');
 f.store.transaction(()=>{for(let i=0;i<1005;i++){f.post('p'+i,'published',['telegram']);f.receipt('p'+i);}});
 f.post('private','ready',['bale'],'2026-10-28T09:00:00.000Z');f.post('mixed');f.receipt('mixed');f.receipt('mixed','bale',null,'unknown');
 const member=f.read({id:'member',role:'viewer',channels:'["telegram"]'});assert.equal(member.events.length,1006);assert(!member.events.some(e=>e.postId==='private'));assert(!member.events.find(e=>e.postId==='mixed').attention);assert(member.events.every(e=>e.destinations.every(id=>id==='telegram')));
});

test('receipt versions and local calendar days stay distinct and range validation is bounded',t=>{
 const f=fixture(t);f.post('history');f.receipt('history','telegram','2026-10-25T20:00:00.000Z');f.receipt('history','bale','2026-10-25T21:00:00.000Z');f.receipt('history','telegram','2026-10-26T08:00:00.000Z','sent',2);
 assert.equal(f.read().events.length,3);assert.equal(f.read(f.user,'America/New_York').events.length,2);
 assert.throws(()=>calendarWindow('invalid','2026-11-01T00:00:00Z'));assert.throws(()=>calendarWindow('2026-01-01T00:00:00Z','2026-12-01T00:00:00Z'));
 assert.throws(()=>calendarWindow('2026-11-01T00:00:00Z','2026-10-01T00:00:00Z'));
});

test('all dates and month boundaries in both official year documents agree with the Persian calendar',()=>{
 const weekdays={1404:[5,1,4,0,3,6,2,4,6,1,3,5],1405:[6,2,5,1,4,0,3,5,0,2,4,6]};
 for(const [year,source] of Object.entries(officialYears)){
  assert.equal(source.monthLengths.reduce((a,b)=>a+b),365);assert.equal(Object.keys(source.holidays).length,26);
  for(let month=0;month<12;month++){
   const start=source.monthStarts[month],range=calendarMonth(start);assert.equal(range.start,start);assert.equal(range.days.filter(d=>d.inMonth).length,source.monthLengths[month]);assert.equal(new Date(start+'T12:00Z').getUTCDay(),weekdays[year][month]);
   for(let day=1;day<=source.monthLengths[month];day++){const key=new Date(Date.parse(start+'T12:00Z')+(day-1)*86400000).toISOString().slice(0,10);assert.deepEqual(calendarParts(key),{year:+year,month:month+1,day});}
  }
 }
});

test('official holidays and religious observances use the documented year-specific dates without lunar guessing',()=>{
 assert.equal(officialDay('2026-04-14').holiday,'شهادت امام صادق');assert.equal(officialDay('2026-04-13').holiday,'');
 const holiday=officialDay('2026-11-13');assert.equal(holiday.holiday,'شهادت حضرت فاطمه');assert.equal(holiday.friday,true);assert(holiday.occasions.some(e=>e.category==='religious'&&e.title==='شهادت حضرت فاطمه'));
 const narrative=officialDay('2026-10-24');assert.equal(narrative.holiday,'');assert(narrative.occasions.some(e=>e.title.includes('به روایتی')));assert(narrative.occasions.some(e=>e.category==='global'&&e.title==='روز سازمان ملل'));
 assert(officialDay('2026-03-21').holiday.includes('عید فطر'));assert(officialDay('2026-03-21').occasions.some(e=>e.title==='عید فطر'));
 assert.equal(officialDay('2027-04-14').covered,false);assert.equal(officialDay('2027-04-14').holiday,'');assert.equal(officialDay('2027-04-14').occasions.filter(e=>e.category==='religious').length,0);
 assert.deepEqual(missingOfficialYears(calendarMonth('2027-04-01').days),[1406]);
});

test('global observances stay on their Gregorian date in either calendar and do not imply a public holiday',()=>{
 const water=officialDay('2026-03-22');assert(water.occasions.some(e=>e.category==='global'&&e.title==='روز آب'));
 const children=officialDay('2026-11-20');assert(children.occasions.some(e=>e.title==='روز کودکان'));assert(!officialDay('2026-10-08').occasions.some(e=>e.title==='روز کودکان'));
 assert.equal(officialDay('2026-11-10').holiday,'');assert(officialDay('2026-11-10').occasions.some(e=>e.category==='global'));
 assert.equal(officialDay('1900-10-24').occasions.filter(e=>e.category==='global').length,0);
});
