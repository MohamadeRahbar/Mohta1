import {migrateDestinations} from './destination-migration.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

export const platforms = ['telegram', 'bale', 'rubika', 'whatsapp', 'eitaa'];
// Keep legacy rows for existing history, but do not offer retired destinations.
export const activePlatforms = platforms.filter(platform=>platform!=='whatsapp');
export const typeNames = {stock:'محصول موجود در انبار',proof:'اعتمادسازی و پشت‌صحنه',prices:'لیست قیمت و تأمین',blog:'بلاگی و آموزشی',free:'پیام آزاد'};
export const platformNames = {telegram:'تلگرام',bale:'بله',rubika:'روبیکا',whatsapp:'واتس‌اپ',eitaa:'ایتا'};
export const appName = 'محتوان';
export const defaultSettings = {projectName:appName,brandLogoId:'',brand:'',contact:'',contacts:{phones:[],admins:{}},website:'',currency:'تومان',timezone:'Asia/Tehran'};

export function openStore(directory) {
 fs.mkdirSync(directory,{recursive:true});
 const db=new DatabaseSync(path.join(directory,'desk.sqlite'));
 db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,name TEXT NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL,channels TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),csrf TEXT NOT NULL,expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS password_resets(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL,used_at TEXT,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS schema_migrations(id TEXT PRIMARY KEY,applied_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS secrets(name TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS channels(id TEXT PRIMARY KEY,name TEXT NOT NULL,platform TEXT NOT NULL,target TEXT NOT NULL DEFAULT '',enabled INTEGER NOT NULL DEFAULT 0,route TEXT NOT NULL DEFAULT 'direct',network_status TEXT,last_checked TEXT);
 CREATE TABLE IF NOT EXISTS posts(id TEXT PRIMARY KEY,type TEXT NOT NULL,title TEXT NOT NULL,fields TEXT NOT NULL,body TEXT NOT NULL,channels TEXT NOT NULL,media TEXT NOT NULL,scheduled_at TEXT,expires_at TEXT,status TEXT NOT NULL,version INTEGER NOT NULL,author_id TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS revisions(id INTEGER PRIMARY KEY,post_id TEXT NOT NULL REFERENCES posts(id),version INTEGER NOT NULL,value TEXT NOT NULL,actor_id TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(post_id,version));
 CREATE TABLE IF NOT EXISTS media(id TEXT PRIMARY KEY,path TEXT NOT NULL,name TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,owner_id TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,actor_id TEXT,action TEXT NOT NULL,entity_id TEXT,detail TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS publications(id TEXT PRIMARY KEY,post_id TEXT NOT NULL REFERENCES posts(id),channel_id TEXT NOT NULL REFERENCES channels(id),message_ids TEXT NOT NULL DEFAULT '[]',status TEXT NOT NULL,version INTEGER NOT NULL,published_at TEXT);
 CREATE TABLE IF NOT EXISTS scheduled_publications(post_id TEXT PRIMARY KEY REFERENCES posts(id),run_id TEXT NOT NULL,version INTEGER NOT NULL,run_at TEXT NOT NULL,actor_id TEXT NOT NULL,state TEXT NOT NULL,message TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS scheduled_due ON scheduled_publications(state,run_at);
 CREATE TABLE IF NOT EXISTS generation_jobs(id TEXT PRIMARY KEY,post_id TEXT NOT NULL REFERENCES posts(id),post_version INTEGER NOT NULL,kind TEXT NOT NULL,usage TEXT NOT NULL,prompt TEXT NOT NULL,references_json TEXT NOT NULL,status TEXT NOT NULL,provider TEXT,result_media_id TEXT,created_at TEXT NOT NULL);
 `);
 for(const [name,definition] of Object.entries({updated_at:'TEXT',error_code:'TEXT',message:'TEXT',target:'TEXT'}))if(!db.prepare('PRAGMA table_info(publications)').all().some(column=>column.name===name))db.exec('ALTER TABLE publications ADD COLUMN '+name+' '+definition);
 for(const [name,definition] of Object.entries({body_mode:"TEXT NOT NULL DEFAULT 'manual'",body_source:'TEXT'}))if(!db.prepare('PRAGMA table_info(posts)').all().some(column=>column.name===name))db.exec('ALTER TABLE posts ADD COLUMN '+name+' '+definition);
 if(!db.prepare('PRAGMA table_info(posts)').all().some(column=>column.name==='body_entities'))db.exec('ALTER TABLE posts ADD COLUMN body_entities TEXT');
 if(!db.prepare('PRAGMA table_info(posts)').all().some(column=>column.name==='library_title'))db.exec('ALTER TABLE posts ADD COLUMN library_title TEXT');
 for(const [name,definition] of Object.entries({archived_at:'TEXT',deleted_at:'TEXT',library_revision:'INTEGER NOT NULL DEFAULT 0'}))if(!db.prepare('PRAGMA table_info(posts)').all().some(column=>column.name===name))db.exec('ALTER TABLE posts ADD COLUMN '+name+' '+definition);
 if(!db.prepare('PRAGMA table_info(posts)').all().some(column=>column.name==='primary_media_id'))db.exec('ALTER TABLE posts ADD COLUMN primary_media_id TEXT');
 if(!db.prepare('PRAGMA table_info(posts)').all().some(column=>column.name==='publication_media_ids'))db.exec('ALTER TABLE posts ADD COLUMN publication_media_ids TEXT');
 if(!db.prepare('PRAGMA table_info(channels)').all().some(column=>column.name==='network_detail'))db.exec('ALTER TABLE channels ADD COLUMN network_detail TEXT');
 if(!db.prepare('PRAGMA table_info(channels)').all().some(column=>column.name==='access_detail'))db.exec('ALTER TABLE channels ADD COLUMN access_detail TEXT');
 if(!db.prepare('PRAGMA table_info(channels)').all().some(column=>column.name==='config_version'))db.exec('ALTER TABLE channels ADD COLUMN config_version INTEGER NOT NULL DEFAULT 0');
 db.prepare('INSERT OR IGNORE INTO settings(id,value) VALUES(1,?)').run(JSON.stringify(defaultSettings));
 for(const platform of platforms) db.prepare('INSERT OR IGNORE INTO channels(id,name,platform,route) VALUES(?,?,?,?)').run(platform,platformNames[platform],platform,'direct');
 if(!db.prepare('SELECT id FROM schema_migrations WHERE id=?').get('prefer-system-network')){
   db.exec('BEGIN IMMEDIATE');
   try{
     db.prepare("UPDATE channels SET route='direct',network_status=NULL,last_checked=NULL WHERE id IN ('telegram','whatsapp') AND route='proxy' AND NOT EXISTS(SELECT 1 FROM secrets WHERE name='proxy:'||channels.id)").run();
     db.prepare('INSERT INTO schema_migrations VALUES(?,?)').run('prefer-system-network',new Date().toISOString());
     db.exec('COMMIT');
   }catch(error){db.exec('ROLLBACK');throw error;}
 }
 migrateDestinations(db);
 const keyPath=path.join(directory,'master.key');
 if(!fs.existsSync(keyPath)) {
   if(db.prepare('SELECT count(*) AS n FROM secrets').get().n) throw new Error('کلید رمزگذاری داده‌های موجود پیدا نشد. master.key را از پشتیبان بازیابی کنید.');
   fs.writeFileSync(keyPath,randomBytes(32),{flag:'wx',mode:0o600});
 }
 const key=fs.readFileSync(keyPath);
 if(key.length!==32) throw new Error('کلید رمزگذاری معتبر نیست.');
 function seal(value){ const iv=randomBytes(12); const cipher=createCipheriv('aes-256-gcm',key,iv); const data=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]); return Buffer.concat([iv,cipher.getAuthTag(),data]).toString('base64'); }
 function unseal(value){const all=Buffer.from(value,'base64');const cipher=createDecipheriv('aes-256-gcm',key,all.subarray(0,12));cipher.setAuthTag(all.subarray(12,28));return Buffer.concat([cipher.update(all.subarray(28)),cipher.final()]).toString('utf8');}
 return {
   db,directory,
   settings(){const saved=JSON.parse(db.prepare('SELECT value FROM settings WHERE id=1').get().value);return Object.fromEntries(Object.entries(defaultSettings).map(([key,value])=>[key,key==='projectName'?appName:saved[key]??value]));},
   saveSettings(value){const clean=Object.fromEntries(Object.entries(defaultSettings).map(([key,fallback])=>[key,key==='projectName'?appName:value[key]??fallback]));db.prepare('UPDATE settings SET value=? WHERE id=1').run(JSON.stringify(clean));},
   secret(name){const row=db.prepare('SELECT value FROM secrets WHERE name=?').get(name);return row?unseal(row.value):'';},
   hasSecret(name){return !!db.prepare('SELECT name FROM secrets WHERE name=?').get(name);},
   saveSecret(name,value){if(value)db.prepare('INSERT INTO secrets(name,value) VALUES(?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value').run(name,seal(value));else db.prepare('DELETE FROM secrets WHERE name=?').run(name);},
   audit(actor,action,entity,detail={}){db.prepare('INSERT INTO audit(actor_id,action,entity_id,detail,created_at) VALUES(?,?,?,?,?)').run(actor||null,action,entity||null,JSON.stringify(detail),new Date().toISOString());},
   transaction(callback){db.exec('BEGIN IMMEDIATE');try{const result=callback();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}},
   close(){db.close();}
 };
}

export function publicUser(row){return row&&{id:row.id,username:row.username,name:row.name,role:row.role,channels:JSON.parse(row.channels).filter(channel=>typeof channel==='string'&&channel!=='whatsapp'),active:!!row.active};}
export function publicPost(row){return row&&{...row,body_entities:row.body_entities?JSON.parse(row.body_entities):[],fields:JSON.parse(row.fields),channels:JSON.parse(row.channels),media:JSON.parse(row.media),publication_media_ids:row.publication_media_ids?JSON.parse(row.publication_media_ids):row.primary_media_id?[row.primary_media_id]:[]};}
