import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openStore} from '../src/storage/store.mjs';

test('legacy custom project names are ignored without rewriting saved brand data on read',t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'desk-app-name-'));let store=openStore(directory);
 t.after(()=>{store.close();fs.rmSync(directory,{recursive:true,force:true});});
 const legacy={...store.settings(),projectName:'Legacy Custom Panel',brand:'Independent Brand',brandLogoId:'legacy-logo',website:'https://example.com'};
 store.db.prepare('UPDATE settings SET value=? WHERE id=1').run(JSON.stringify(legacy));
 const raw=store.db.prepare('SELECT value FROM settings WHERE id=1').get().value;
 assert.equal(store.settings().projectName,'محتوان');assert.equal(store.settings().brand,'Independent Brand');assert.equal(store.settings().brandLogoId,'legacy-logo');assert.equal(store.db.prepare('SELECT value FROM settings WHERE id=1').get().value,raw);
 store.close();store=openStore(directory);assert.equal(store.settings().projectName,'محتوان');assert.equal(store.db.prepare('SELECT value FROM settings WHERE id=1').get().value,raw);
 store.saveSettings({...store.settings(),brand:'Renamed Brand',projectName:'Attempted Override'});
 const saved=JSON.parse(store.db.prepare('SELECT value FROM settings WHERE id=1').get().value);assert.equal(saved.projectName,'محتوان');assert.equal(saved.brand,'Renamed Brand');assert.equal(saved.brandLogoId,'legacy-logo');assert.equal(saved.website,legacy.website);
});
