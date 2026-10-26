import test from 'node:test';
import assert from 'node:assert/strict';
import {clockValue,clockPart,pickerMonth,persianDateField,dateTimeLabel,futureTimeError} from '../public/persian-date-picker.js';
import {zonedToUtc,localDateTime} from '../public/time-zone.js';
test('Persian picker follows official month boundaries, leap Esfand and Saturday-first grid',()=>{
 const nowruz=pickerMonth('2026-03-21');assert.equal(nowruz.start,'2026-03-21');assert.equal(nowruz.next,'2026-04-21');assert.equal(nowruz.days.filter(day=>day.inMonth).length,31);assert.equal(nowruz.days[0].key,'2026-03-21');
 const leap=pickerMonth('2025-03-20');assert.equal(leap.start,'2025-02-19');assert.equal(leap.next,'2025-03-21');assert.equal(leap.days.filter(day=>day.inMonth).length,30);
 const ordinary=pickerMonth('2026-03-20');assert.equal(ordinary.days.filter(day=>day.inMonth).length,29);assert.equal(ordinary.next,'2026-03-21');
});
test('Persian and Arabic digits accept only valid 24-hour clock values',()=>{
 assert.equal(clockValue('۱۴:۳۰'),'14:30');assert.equal(clockValue('٠٩:٠٥'),'09:05');assert.equal(clockValue('0:00'),'00:00');assert.equal(clockValue('23:59'),'23:59');for(const value of ['24:00','12:60','10:3','1 PM','',':30'])assert.equal(clockValue(value),null);
 assert.equal(clockPart('۳',60),'03');assert.equal(clockPart('١٤',24),'14');assert.equal(clockPart('0',24),'00');assert.equal(clockPart('59',60),'59');for(const value of ['24','-1','2x','','۱۲۳'])assert.equal(clockPart(value,24),null);
});
test('Picker retains Gregorian wall value for UTC conversion without shifting saved instants',()=>{
 const wall='2026-10-25T14:30',markup=persianDateField('scheduled_at','تاریخ و ساعت انتشار',wall);assert.match(markup,/type="hidden" name="scheduled_at" value="2026-10-25T14:30"/);assert.match(markup,/data-picker-today>امروز/);assert(!markup.includes('datetime-local'));assert(!markup.includes('persian-clock-row'));assert(!markup.includes('data-date-today'));assert.equal(dateTimeLabel(wall),'۱۴۰۵/۰۸/۰۳، ۱۴:۳۰');assert.equal(localDateTime(zonedToUtc(wall,'Asia/Tehran'),'Asia/Tehran'),wall);assert.equal(zonedToUtc(wall,'Asia/Tehran'),'2026-10-25T11:00:00.000Z');
});

test('A single calendar contains Persian hour and minute selectors and today action',()=>{
 const markup=persianDateField('scheduled_at','تاریخ و ساعت انتشار','2026-10-26T23:59');
 const popup=markup.slice(markup.indexOf('class="persian-picker"'));
 const hour=popup.match(/data-clock-options="hour">(.*?)<\/div>/s)[1],minute=popup.match(/data-clock-options="minute">(.*?)<\/div>/s)[1];
 assert.equal((hour.match(/role="option"/g)||[]).length,24);assert.equal((minute.match(/role="option"/g)||[]).length,60);
 assert.match(hour,/aria-selected="true" data-clock-part="hour" data-clock-value="23">۲۳<\/button>/);assert.match(minute,/aria-selected="true" data-clock-part="minute" data-clock-value="59">۵۹<\/button>/);
 assert.match(popup,/data-date-hour value="۲۳"/);assert.match(popup,/data-date-minute value="۵۹"/);
 assert.match(popup,/data-picker-today>امروز/);assert.match(popup,/data-picker-apply>تایید/);assert.match(popup,/data-picker-close>بستن/);
 assert(!hour.includes('data-clock-value="24"'));assert(!minute.includes('data-clock-value="60"'));
});

test('Scheduling rejects past instants in the selected timezone and invalid DST wall times',()=>{
 const now=Date.parse('2026-10-26T04:00:30Z');
 for(const value of ['2026-10-25T23:59','2026-10-26T07:29','2026-10-26T07:30'])assert.match(futureTimeError(value,'Asia/Tehran',now),/آینده/);
 assert.equal(futureTimeError('2026-10-26T07:31','Asia/Tehran',now),'');assert.equal(futureTimeError('2026-10-26T08:01','Asia/Dubai',now),'');
 assert.match(futureTimeError('2026-10-26T08:00','Asia/Dubai',now),/آینده/);
 assert.match(futureTimeError('2026-11-01T01:30','America/New_York',now),/دو بار/);assert.equal(futureTimeError('','Asia/Tehran',now),'');
});
