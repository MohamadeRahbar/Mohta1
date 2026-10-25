import test from 'node:test';
import assert from 'node:assert/strict';
import {clockValue,pickerMonth,persianDateField,dateTimeLabel} from '../public/persian-date-picker.js';
import {zonedToUtc,localDateTime} from '../public/time-zone.js';
test('Persian picker follows official month boundaries, leap Esfand and Saturday-first grid',()=>{
 const nowruz=pickerMonth('2026-03-21');assert.equal(nowruz.start,'2026-03-21');assert.equal(nowruz.next,'2026-04-21');assert.equal(nowruz.days.filter(day=>day.inMonth).length,31);assert.equal(nowruz.days[0].key,'2026-03-21');
 const leap=pickerMonth('2025-03-20');assert.equal(leap.start,'2025-02-19');assert.equal(leap.next,'2025-03-21');assert.equal(leap.days.filter(day=>day.inMonth).length,30);
 const ordinary=pickerMonth('2026-03-20');assert.equal(ordinary.days.filter(day=>day.inMonth).length,29);assert.equal(ordinary.next,'2026-03-21');
});
test('Persian and Arabic digits accept only valid 24-hour clock values',()=>{
 assert.equal(clockValue('۱۴:۳۰'),'14:30');assert.equal(clockValue('٠٩:٠٥'),'09:05');assert.equal(clockValue('0:00'),'00:00');assert.equal(clockValue('23:59'),'23:59');for(const value of ['24:00','12:60','10:3','1 PM','',':30'])assert.equal(clockValue(value),null);
});
test('Picker retains Gregorian wall value for UTC conversion without shifting saved instants',()=>{
 const wall='2026-10-25T14:30',markup=persianDateField('scheduled_at','تاریخ و ساعت انتشار',wall);assert.match(markup,/type="hidden" name="scheduled_at" value="2026-10-25T14:30"/);assert.match(markup,/data-picker-today>امروز/);assert(!markup.includes('datetime-local'));assert(!markup.includes('persian-clock-row'));assert(!markup.includes('data-date-today'));assert.equal(dateTimeLabel(wall),'۱۴۰۵/۰۸/۰۳، ۱۴:۳۰');assert.equal(localDateTime(zonedToUtc(wall,'Asia/Tehran'),'Asia/Tehran'),wall);assert.equal(zonedToUtc(wall,'Asia/Tehran'),'2026-10-25T11:00:00.000Z');
});
