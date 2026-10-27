import path from 'node:path';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createWorkspaces} from '../src/accounts/workspaces.mjs';
import {issueRecovery} from '../src/accounts/recovery.mjs';
const options={};for(let i=2;i<process.argv.length;i+=2){if(!['--data-dir','--username','--base-url'].includes(process.argv[i])||!process.argv[i+1])throw new Error('از --data-dir، --username و --base-url استفاده کنید.');options[process.argv[i]]=process.argv[i+1];}
const root=fileURLToPath(new URL('../',import.meta.url));
const directory=path.resolve(options['--data-dir']||process.env.DATA_DIR||path.join(root,'data'));
if(!fs.existsSync(path.join(directory,'workspaces.sqlite')))throw new Error('پایگاه حساب ها پیدا نشد؛ پوشه اصلی داده نصب را مشخص کنید');
const url=new URL(options['--base-url']||process.env.PUBLIC_URL||'http://127.0.0.1:8787/');
if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('آدرس پنل معتبر نیست.');url.search='';url.hash='';
const workspaces=createWorkspaces(directory,()=>({})),store=workspaces.accounts.store;
try{
 let user;
 if(options['--username']){const found=workspaces.accounts.candidates(options['--username']);if(found.length!==1)throw new Error('شناسه یک حساب فعال را با --username مشخص کنید');user=found[0];}
 else{const admins=store.db.prepare('SELECT id FROM users WHERE can_create_brands=1 AND active=1').all();if(admins.length!==1)throw new Error('شناسه حساب موردنظر را با --username مشخص کنید');user=admins[0];}
 if(!user)throw new Error('حساب فعال با این نام کاربری پیدا نشد.');
 const grant=issueRecovery(store,user.id);url.hash='reset='+grant.token;
 console.log(JSON.stringify({url:url.href,username:grant.username,expiresAt:new Date(grant.expires).toISOString()}));
}finally{workspaces.close();}
