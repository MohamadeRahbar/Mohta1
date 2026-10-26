import test from 'node:test';
import assert from 'node:assert/strict';
import {navigationGroups,libraryRoute,settingsRoute} from '../public/navigation.js';
import {filterLibrary} from '../public/post-library.js';

test('Sidebar library shortcuts resolve to the matching library placement and delivery filters',()=>{
 const posts=[{id:'draft',status:'draft'},{id:'ready',status:'ready'},{id:'published',status:'published'},{id:'archive',status:'published',archived_at:'2026-01-01'},{id:'trash',status:'draft',deleted_at:'2026-01-01'}].map(post=>({title:post.id,...post}));
 const groups=navigationGroups({view:'posts',canCreate:true}),library=groups.find(group=>group.key==='posts');
 assert.equal(groups.find(group=>group.key==='dashboard').children.length,0);assert.equal(groups.find(group=>group.key==='calendar').children.length,0);
 assert.deepEqual(library.children.map(item=>item.label),['محتوای جدید','همه محتواها','پیش نویس ها','صف انتشار','منتشر شده ها','بایگانی شده ها','زباله دان']);
 const expected={all:['draft','ready','published'],draft:['draft'],ready:['ready'],published:['published'],archived:['archive'],deleted:['trash']};
 for(const child of library.children.filter(item=>item.view)){const filter=libraryRoute(child.view);assert.deepEqual(filterLibrary(posts,{filter}).map(post=>post.id),expected[filter]);}
 assert.equal(libraryRoute('posts'),'all');assert.equal(libraryRoute('posts/unknown'),'all');
});

test('Sidebar permissions and current locations agree with the available sections',()=>{
 const viewer=navigationGroups({view:'posts',filter:'ready'});assert(!viewer.find(group=>group.key==='posts').children.some(item=>item.action==='create'));
 assert.equal(viewer.find(group=>group.key==='posts').children.find(item=>item.active).view,'posts/ready');
 const editor=navigationGroups({view:'editor',canCreate:true}).find(group=>group.key==='posts');assert(editor.active);assert.equal(editor.children.find(item=>item.active).action,'create');
 const brandless=navigationGroups({view:'settings',needsBrand:true});assert.equal(brandless.length,1);assert.deepEqual(brandless[0].children.map(item=>item.view),['settings/brands','settings/account']);
 const settings=navigationGroups({view:'settings',section:settingsRoute('settings/channels')}).find(group=>group.key==='settings');
 assert.deepEqual(settings.children.map(item=>item.label),['مدیریت برندها','تنظیمات اتصال','دسترسی','حساب اصلی من']);assert.equal(settings.children.find(item=>item.active).view,'settings/connections');
 assert.equal(settingsRoute('settings/access'),'access');assert.equal(settingsRoute('settings/team'),'team');assert.equal(settingsRoute('settings/unknown'),'');
});
