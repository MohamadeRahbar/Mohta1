import fs from 'node:fs';

export function streamMedia(req,res,filePath,media){
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{Allow:'GET, HEAD'});res.end();return;}
 const size=fs.statSync(filePath).size,headers={'Content-Type':media.mime,'Cache-Control':'private, max-age=300','Accept-Ranges':'bytes'};
 let start=0,end=size-1,partial=false;
 const range=req.method==='GET'?req.headers.range:null;
 if(range){
   const match=/^bytes=(\d*)-(\d*)$/.exec(range);let valid=!!match&&(match[1]!==''||match[2]!=='');
   if(valid){
     if(match[1]===''){const suffix=Number(match[2]);valid=Number.isSafeInteger(suffix)&&suffix>0;start=Math.max(0,size-suffix);}
     else{start=Number(match[1]);end=match[2]===''?size-1:Number(match[2]);valid=Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&start<=end;end=Math.min(end,size-1);}
     valid=valid&&start<size&&start>=0;
   }
   if(!valid){res.writeHead(416,{...headers,'Content-Range':'bytes */'+size,'Content-Length':0});res.end();return;}
   partial=true;headers['Content-Range']='bytes '+start+'-'+end+'/'+size;
 }
 res.writeHead(partial?206:200,{...headers,'Content-Length':Math.max(0,end-start+1)});
 if(req.method==='HEAD'||!size){res.end();return;}
 const stream=fs.createReadStream(filePath,{start,end});stream.once('error',()=>res.destroy());res.once('close',()=>stream.destroy());stream.pipe(res);
}
