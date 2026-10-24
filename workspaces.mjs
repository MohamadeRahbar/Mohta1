import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {openStore,activePlatforms} from './store.mjs';
import {openAccounts} from './accounts.mjs';
import {check,text} from './content.mjs';
export function createWorkspaces(directory,makeRuntime){
 const stores=new Map(),runtimes=new Map(),defaultStore=openStore(directory);
 stores.set('default',defaultStore);
 const catalog=new DatabaseSync(path.join(directory,'workspaces.sqlite'));
 catalog.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS workspaces(id TEXT PRIMARY KEY,name TEXT NOT NULL,owner_id TEXT,created_at TEXT NOT NULL)');
 const owner=defaultStore.db.prepare("SELECT id FROM users WHERE role='admin' AND active=1 ORDER BY created_at LIMIT 1").get();
 catalog.prepare('INSERT OR IGNORE INTO workspaces VALUES(?,?,?,?)').run('default',defaultStore.settings().brand||'برند اصلی',owner?.id||null,new Date().toISOString());
 const accounts=openAccounts(directory);
 function get(id='default'){
  const row=catalog.prepare('SELECT * FROM workspaces WHERE id=?').get(id);check(row,'فضای برند پیدا نشد',404);
  if(!stores.has(id))stores.set(id,openStore(path.join(directory,'brands',id)));
  return {row,store:stores.get(id)};
 }
 for(const row of catalog.prepare("SELECT * FROM workspaces ORDER BY CASE WHEN id='default' THEN 0 ELSE 1 END,created_at").all())accounts.migrate(row.id,get(row.id).store,row.owner_id);
 function member(id,accountId){
  const grant=accounts.db.prepare('SELECT user_id FROM memberships WHERE workspace_id=? AND account_id=?').get(id,accountId);
  if(!grant)return null;
  const user=get(id).store.db.prepare('SELECT * FROM users WHERE id=? AND active=1').get(grant.user_id);
  return user?{...user,account_id:accountId}:null;
 }
 function accessible(accountId){
  return accounts.db.prepare('SELECT workspace_id FROM memberships WHERE account_id=?').all(accountId).flatMap(item=>{const row=catalog.prepare('SELECT id,name FROM workspaces WHERE id=?').get(item.workspace_id);return row&&member(row.id,accountId)?[row]:[];});
 }
 function list(id,user){return accessible(user.account_id||user.id);}
 function addGrant(workspaceId,accountId,userId){accounts.db.prepare('INSERT OR REPLACE INTO memberships(account_id,workspace_id,user_id) VALUES(?,?,?)').run(accountId,workspaceId,userId);}
 function create(id,user,name){
  const account=accounts.user(user.account_id||user.id);check(account?.active&&account.can_create_brands,'افزودن برند برای این حساب فعال نیست',403);
  name=text(name||'',100);check(name,'نام برند یا شرکت را وارد کنید');
  check(!catalog.prepare('SELECT id FROM workspaces WHERE owner_id=? AND name=?').get(account.id,name),'این نام برند قبلا ثبت شده است',409);
  const key=randomUUID(),created=new Date().toISOString(),tenant=openStore(path.join(directory,'brands',key));
  try{
   tenant.db.prepare('INSERT INTO users(id,username,name,password,role,channels,active,created_at) VALUES(?,?,?,?,?,?,1,?)').run(account.id,account.username,account.name,account.password,'admin',JSON.stringify(activePlatforms),created);
   tenant.saveSettings({...tenant.settings(),brand:name});tenant.audit(account.id,'workspace.create',key,{name});
   catalog.prepare('INSERT INTO workspaces VALUES(?,?,?,?)').run(key,name,account.id,created);
   addGrant(key,account.id,account.id);stores.set(key,tenant);
  }catch(error){catalog.prepare('DELETE FROM workspaces WHERE id=?').run(key);tenant.close();throw error;}
  accounts.store.audit(account.id,'workspace.create',key,{name});return {id:key,name};
 }
 function claimDefault(account){
  const tenant=get('default').store;
  check(!tenant.db.prepare('SELECT id FROM users LIMIT 1').get(),'مدیر قبلا ساخته شده است',409);
  tenant.db.prepare('INSERT INTO users(id,username,name,password,role,channels,active,created_at) VALUES(?,?,?,?,?,?,1,?)').run(account.id,account.username,account.name,account.password,'admin',JSON.stringify(activePlatforms),account.created_at);
  catalog.prepare("UPDATE workspaces SET owner_id=? WHERE id='default' AND owner_id IS NULL").run(account.id);addGrant('default',account.id,account.id);tenant.audit(account.id,'setup',account.id);
 }
 function addMember(id,identity,role,channels){
  const tenant=get(id).store,account=accounts.provision(identity);
  check(!accounts.db.prepare('SELECT account_id FROM memberships WHERE workspace_id=? AND account_id=?').get(id,account.id),'این حساب قبلا عضو برند شده است',409);
  check(!tenant.db.prepare('SELECT id FROM users WHERE username=?').get(account.username),'این نام در برند موجود است',409);
  tenant.db.prepare('INSERT INTO users(id,username,name,password,role,channels,active,created_at) VALUES(?,?,?,?,?,?,1,?)').run(account.id,account.username,identity.name||account.name,account.password,role,JSON.stringify(channels),new Date().toISOString());addGrant(id,account.id,account.id);return account.id;
 }
 function revokeBrandSelection(id,userId){const grant=accounts.db.prepare('SELECT account_id FROM memberships WHERE workspace_id=? AND user_id=?').get(id,userId);if(grant)accounts.db.prepare('UPDATE sessions SET workspace_id=NULL WHERE workspace_id=? AND user_id=?').run(id,grant.account_id);}
 function validSession(id,tokenHash,userId){
  const session=accounts.db.prepare('SELECT s.user_id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires>? AND s.workspace_id=? AND u.active=1').get(tokenHash,Date.now(),id);
  if(!session)return false;const user=member(id,session.user_id);return !!user&&user.id===userId&&['admin','publisher','editor'].includes(user.role);
 }
 function runtime(id){const item=get(id);if(!runtimes.has(id))runtimes.set(id,makeRuntime(item.store,item.row));return runtimes.get(id);}
 function all(){return catalog.prepare('SELECT id FROM workspaces').all().map(row=>row.id);}
 function scheduledActor(id,userId){const grant=accounts.db.prepare('SELECT m.account_id FROM memberships m JOIN users u ON u.id=m.account_id WHERE m.workspace_id=? AND m.user_id=? AND u.active=1').get(id,userId);return grant?member(id,grant.account_id):null;}
 function rename(id,user,name){check(user.role==='admin','تغییر نام برند با مدیر است',403);name=text(name||'',100);check(name,'نام برند را وارد کنید');catalog.prepare('UPDATE workspaces SET name=? WHERE id=?').run(name,id);}
 function close(){for(const store of stores.values())store.close();catalog.close();accounts.close();}
 return {accounts,get,list,accessible,member,create,claimDefault,addMember,revokeBrandSelection,validSession,runtime,rename,close,all,scheduledActor};
}
