import test from 'node:test';
import assert from 'node:assert/strict';
import {guidanceScope,guidanceId,createGuidanceStore,normalizeHelpItems} from '../public/guidance.js';
function storage({broken=false}={}){const values=new Map();return {get length(){return values.size;},key:i=>[...values.keys()][i]||null,getItem:key=>{if(broken)throw Error('Storage blocked');return values.get(key)||null;},setItem:(key,value)=>{if(broken)throw Error('Storage blocked');values.set(key,value);},removeItem:key=>{if(broken)throw Error('Storage blocked');values.delete(key);}};}

test('section help keeps every distinct rule in source order without duplicate or empty entries',()=>{
 assert.deepEqual(normalizeHelpItems([{title:' Hours ',text:' 00:00\n to 23:59 '},{title:'Hours',text:'00:00 to 23:59'},{title:'',text:'Automatic publishing is not enabled'},{title:'Logo',text:' '},{title:'Logo',text:'Uploads save immediately'}]),[{title:'Hours',text:'00:00 to 23:59'},{title:'',text:'Automatic publishing is not enabled'},{title:'Logo',text:'Uploads save immediately'}]);
 assert.deepEqual(normalizeHelpItems([{title:'Other field',text:'00:00 to 23:59'},{title:'Hours',text:'00:00 to 23:59'}]).map(item=>item.title),['Other field','Hours']);
});
test('dismissal survives refresh and brand navigation only for the same account login',async()=>{
 const disk=storage(),id=guidanceId('editor|instant-publishing'),scope=await guidanceScope('owner','brand-a','fixture-session-one');assert(!scope.key.includes('fixture-session-one'));const current=createGuidanceStore(disk);current.use(scope);current.dismiss(id);assert(current.has(id));
 const refreshed=createGuidanceStore(disk);refreshed.use(await guidanceScope('owner','brand-a','fixture-session-one'));assert(refreshed.has(id));
 refreshed.use(await guidanceScope('owner','brand-b','fixture-session-one'));assert(!refreshed.has(id));refreshed.use(scope);assert(refreshed.has(id));
 const secondTab=createGuidanceStore(disk);secondTab.use(scope);assert(secondTab.has(id));secondTab.dismiss('another-hint');assert(current.has('another-hint'));
 current.use(await guidanceScope('another-owner','brand-a','fixture-session-one'));assert(!current.has(id));
 current.use(await guidanceScope('owner','brand-a','fixture-session-two'));assert(!current.has(id));assert.equal(disk.getItem(scope.key),null);
});
test('logout clears dismissals for every brand of that login and never touches unrelated preferences',async()=>{
 const disk=storage();disk.setItem('desk:other-preference','keep');const current=createGuidanceStore(disk),first=await guidanceScope('owner','a','login');current.use(first);current.dismiss('first');current.use(await guidanceScope('owner','b','login'));current.dismiss('second');current.clearSession();assert.equal(disk.getItem(first.key),null);assert.equal(disk.length,1);assert.equal(disk.getItem('desk:other-preference'),'keep');current.use(first);assert(!current.has('first'));assert.equal(await guidanceScope('owner','a',''),null);
});
test('blocked or malformed browser storage retains safe in-memory dismissal without breaking the page',async()=>{
 const current=createGuidanceStore(storage({broken:true}));current.use(await guidanceScope('owner','a','login'));current.dismiss('hint');assert(current.has('hint'));current.use(await guidanceScope('owner','b','login'));assert(!current.has('hint'));current.use(await guidanceScope('owner','a','login'));assert(current.has('hint'));
 const disk=storage(),scope=await guidanceScope('owner','a','another');disk.setItem(scope.key,'malformed json');const safe=createGuidanceStore(disk);safe.use(scope);assert(!safe.has('hint'));safe.dismiss('hint');assert(safe.has('hint'));
});
