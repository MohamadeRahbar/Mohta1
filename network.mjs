import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import {Readable,pipeline} from 'node:stream';
import {check} from './content.mjs';
function connectionError(message,code){const error=new Error(message);error.code=code;return error;}

export function validateProxy(value){
 if(!value)return '';let url;try{url=new URL(value);}catch{check(false,'آدرس پروکسی معتبر نیست.');}
 check(['http:','https:'].includes(url.protocol),'در این نسخه، پروکسی HTTP یا HTTPS وارد کنید؛ برای SOCKS از ورودی HTTP نرم‌افزار پروکسی استفاده کنید.');
 check(url.hostname&&(!url.pathname||url.pathname==='/')&&!url.search&&!url.hash,'پروکسی نباید مسیر یا پارامتر داشته باشد.');return url.href;
}

export async function requestJson(url,{method='GET',headers={},body,rawBody,bodyStream,responseType='json',proxy='',timeout=10000}={}){
 const target=new URL(url);check(['http:','https:'].includes(target.protocol),'پروتکل اتصال معتبر نیست.');
 let agent;
 if(proxy){
   check(target.protocol==='https:','مسیر پروکسی برای مقصد HTTPS پشتیبانی می‌شود.');
   const p=new URL(validateProxy(proxy));
   const socket=await new Promise((resolve,reject)=>{
     const client=(p.protocol==='https:'?https:http).request({hostname:p.hostname,port:p.port|| (p.protocol==='https:'?443:80),method:'CONNECT',path:`${target.hostname}:${target.port||443}`,headers:{Host:`${target.hostname}:${target.port||443}`,...(p.username?{'Proxy-Authorization':'Basic '+Buffer.from(decodeURIComponent(p.username)+':'+decodeURIComponent(p.password)).toString('base64')}:{})}});
     client.setTimeout(timeout,()=>client.destroy(connectionError('پروکسی در زمان مقرر پاسخ نداد.','PROXY_TIMEOUT')));
     client.once('connect',(response,socket,head)=>{client.setTimeout(0);if(response.statusCode!==200){socket.destroy();reject(connectionError('پروکسی اتصال را نپذیرفت.',response.statusCode===407?'PROXY_AUTH_REQUIRED':'PROXY_CONNECT_FAILED'));return;}if(head.length)socket.unshift(head);resolve(socket);});
     client.once('response',response=>{response.resume();client.destroy();reject(connectionError('پروکسی از CONNECT پشتیبانی نکرد.','PROXY_CONNECT_FAILED'));});
     client.once('error',reject);client.end();
   });
   const secured=await new Promise((resolve,reject)=>{const connection=tls.connect({socket,servername:target.hostname,rejectUnauthorized:true});connection.setTimeout(timeout,()=>connection.destroy(connectionError('برقراری اتصال امن به مقصد طول کشید.','ETIMEDOUT')));connection.once('secureConnect',()=>{connection.setTimeout(0);resolve(connection);});connection.once('error',reject);});
   agent=new https.Agent({keepAlive:false});agent.createConnection=(_options,callback)=>{callback(null,secured);};
 }
 return new Promise((resolve,reject)=>{
   const data=rawBody!==undefined?Buffer.from(rawBody):body===undefined?undefined:Buffer.from(JSON.stringify(body));
   const req=(target.protocol==='https:'?https:http).request(target,{method,agent,headers:{Accept:'application/json',...headers,...(data?{...(rawBody===undefined?{'Content-Type':'application/json'}:{}),'Content-Length':data.length}:{})}},res=>{
     let size=0;const chunks=[];res.on('data',chunk=>{size+=chunk.length;if(size>2*1024*1024){req.destroy(new Error('پاسخ مقصد بیش از حد بزرگ است.'));return;}chunks.push(chunk);});
     res.once('end',()=>{const raw=Buffer.concat(chunks).toString('utf8');let value;try{value=JSON.parse(raw);}catch{value=null;}agent?.destroy();resolve({status:res.statusCode,data:value,...(responseType==='text'?{raw}:{})});});res.once('error',reject);
   });
   req.setTimeout(timeout,()=>req.destroy(connectionError('اتصال به مقصد در زمان مقرر پاسخ نداد.','ETIMEDOUT')));
   req.once('error',error=>{agent?.destroy();reject(error);});if(bodyStream)pipeline(Readable.from(bodyStream),req,error=>{if(error)req.destroy(error);});else{if(data)req.write(data);req.end();}
 });
}

export const networkTargets={telegram:'https://api.telegram.org/',whatsapp:'https://graph.facebook.com/',bale:'https://tapi.bale.ai/',rubika:'https://botapi.rubika.ir/',eitaa:'https://eitaayar.ir/'};
