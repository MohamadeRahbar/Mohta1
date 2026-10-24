import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
// Stream local attachments sequentially; an eight-file album never sits in memory.
export function multipart(fields,files){
 const boundary='desk-'+randomUUID(),parts=[];
 for(const [name,value] of Object.entries(fields))if(value!==undefined&&value!==null)parts.push({head:Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${typeof value==='string'?value:JSON.stringify(value)}\r\n`)});
 for(const file of files){const name=file.name.replace(/[\r\n"\\]/g,'_');parts.push({head:Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${name}"\r\nContent-Type: ${file.mime}\r\n\r\n`),path:file.path,size:fs.statSync(file.path).size});}
 const tail=Buffer.from(`--${boundary}--\r\n`),length=parts.reduce((sum,p)=>sum+p.head.length+(p.path?p.size+2:0),tail.length);
 async function* stream(){for(const part of parts){yield part.head;if(part.path){yield* fs.createReadStream(part.path);yield Buffer.from('\r\n');}}yield tail;}
 return {headers:{'Content-Type':'multipart/form-data; boundary='+boundary,'Content-Length':length},bodyStream:stream()};
}
