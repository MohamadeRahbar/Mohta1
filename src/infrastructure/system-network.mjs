import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {validateProxy} from './network.mjs';
const run=promisify(execFile);
export function bypasses(host,value=''){
 return value.split(/[;,]/).map(x=>x.trim()).filter(Boolean).some(pattern=>{
   if(pattern==='*')return true;if(pattern==='<local>')return !host.includes('.');
   pattern=pattern.replace(/:\d+$/,'').toLowerCase();
   if(pattern.startsWith('.'))return host===pattern.slice(1)||host.endsWith(pattern);
   const expression=pattern.split('*').map(part=>part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('.*');
   return new RegExp('^'+expression+'$','i').test(host);
 });
}
export function windowsProxyFor(url,settings){
 if(!settings.enabled||bypasses(new URL(url).hostname,settings.bypass))return '';
 const raw=String(settings.server||'').trim();if(!raw)return '';
 let chosen=raw;
 if(raw.includes('=')){const parts=Object.fromEntries(raw.split(';').map(part=>{const split=part.indexOf('=');return [part.slice(0,split).trim(),part.slice(split+1).trim()];}));chosen=parts[new URL(url).protocol.slice(0,-1)]||'';}
 if(!chosen)return '';return validateProxy(chosen.includes('://')?chosen:'http://'+chosen);
}
export async function readWindowsProxy(){
 const command="$p=Get-ItemProperty -LiteralPath 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings' -ErrorAction Stop;[pscustomobject]@{enabled=[bool]$p.ProxyEnable;server=[string]$p.ProxyServer;bypass=[string]$p.ProxyOverride;pac=[bool]$p.AutoConfigURL}|ConvertTo-Json -Compress";
 try{const {stdout}=await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,timeout:4000,maxBuffer:16384});return {...JSON.parse(stdout),available:true};}catch{return {available:false,enabled:false};}
}
export async function resolveNetworkRoute(channel,url,{manualProxy='',env=process.env,platform=process.platform,readSettings=readWindowsProxy}={}){
 if(channel.route==='proxy')return {proxy:validateProxy(manualProxy),source:'manual_proxy'};
 const host=new URL(url).hostname;
 if(!bypasses(host,env.NO_PROXY||env.no_proxy||'')){
   const configured=new URL(url).protocol==='https:'?(env.HTTPS_PROXY||env.https_proxy||env.HTTP_PROXY||env.http_proxy):(env.HTTP_PROXY||env.http_proxy);
   if(configured)return {proxy:validateProxy(configured),source:'environment_proxy'};
 }
 if(platform==='win32'){
   const settings=await readSettings();const proxy=windowsProxyFor(url,settings);
   if(proxy)return {proxy,source:'windows_proxy'};
   if(settings.pac&&!settings.enabled){const error=new Error('مسیر PAC ویندوز در این نسخه پشتیبانی نمی‌شود؛ از مسیر عادی سیستم یا پروکسی دستی استفاده کنید.');error.code='SYSTEM_PAC_UNSUPPORTED';throw error;}
   return {proxy:'',source:'system_routing',systemProxyEnabled:!!settings.enabled,systemSettingsReadable:settings.available!==false};
 }
 return {proxy:'',source:'system_routing'};
}
export function publicRoute(route){return {source:route.source,systemProxyEnabled:route.systemProxyEnabled,systemSettingsReadable:route.systemSettingsReadable};}
