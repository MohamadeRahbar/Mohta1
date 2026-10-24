// Stored as plain text plus UTF-16 ranges; never accept arbitrary HTML.
export const markTypes=['bold','italic','underline'];
const fail=()=>{const e=new Error('قالب بندی متن معتبر نیست');e.status=400;throw e;};
const boundary=(s,n)=>!(n>0&&n<s.length&&/[\uD800-\uDBFF]/.test(s[n-1])&&/[\uDC00-\uDFFF]/.test(s[n]));
export function normalizeEntities(body,entities=[]){
 if(!Array.isArray(entities)||entities.length>1000)fail();
 const ranges=entities.map(e=>{if(!e||!markTypes.includes(e.type)||!Number.isInteger(e.offset)||!Number.isInteger(e.length)||e.offset<0||e.length<=0||e.offset+e.length>body.length||!boundary(body,e.offset)||!boundary(body,e.offset+e.length))fail();return {type:e.type,offset:e.offset,length:e.length};});
 // Split crossing ranges into disjoint runs with nested marks, accepted by messengers.
 const points=[...new Set(ranges.flatMap(e=>[e.offset,e.offset+e.length]))].sort((a,b)=>a-b),out=[];
 for(let i=0;i<points.length-1;i++)for(const type of markTypes)if(ranges.some(e=>e.type===type&&e.offset<=points[i]&&e.offset+e.length>=points[i+1]))out.push({type,offset:points[i],length:points[i+1]-points[i]});
 if(out.length>1000)fail();return out;
}
export function cleanDocument(body,entities=[],collapse=false){
 const valid=normalizeEntities(body,entities),start=body.length-body.trimStart().length,end=body.trimEnd().length;
 let text='',map=[];for(let i=start;i<end;i++){if(collapse&&body[i]==='\n'&&text.endsWith('\n\n'))continue;map.push(i);text+=body[i];}
 const projected=valid.flatMap(e=>{const indices=[];for(let i=0;i<map.length;i++)if(map[i]>=e.offset&&map[i]<e.offset+e.length)indices.push(i);return indices.length?[{type:e.type,offset:indices[0],length:indices.length}]:[];});
 return {body:text,entities:normalizeEntities(text,projected)};
}
export function rebaseEntities(before,after,entities=[]){
 let start=0;while(start<before.length&&start<after.length&&before[start]===after[start])start++;
 while(start>0&&(!boundary(before,start)||!boundary(after,start)))start--;
 let oldEnd=before.length,newEnd=after.length;while(oldEnd>start&&newEnd>start&&before[oldEnd-1]===after[newEnd-1]){oldEnd--;newEnd--;}
 while(oldEnd<before.length&&(!boundary(before,oldEnd)||!boundary(after,newEnd))){oldEnd++;newEnd++;}
 const delta=newEnd-oldEnd;
 return normalizeEntities(after,normalizeEntities(before,entities).flatMap(e=>{const end=e.offset+e.length;if(end<=start)return [e];if(e.offset>=oldEnd)return [{...e,offset:e.offset+delta}];const out=[];if(e.offset<start)out.push({...e,length:start-e.offset});if(end>oldEnd)out.push({...e,offset:newEnd,length:end-oldEnd});return out;}));
}
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function richMarkup(body,entities=[],links=[]){
 const valid=normalizeEntities(body,entities),safeLinks=links.filter(l=>Number.isInteger(l.offset)&&l.offset>=0&&l.length>0&&l.offset+l.length<=body.length&&/^(https?:\/\/|tel:)/i.test(l.url||''));
 const points=[...new Set([0,body.length,...valid.flatMap(e=>[e.offset,e.offset+e.length]),...safeLinks.flatMap(e=>[e.offset,e.offset+e.length])])].sort((a,b)=>a-b);
 let html='';for(let i=0;i<points.length-1;i++){const a=points[i],b=points[i+1];let part=escape(body.slice(a,b));for(const [type,tag] of [['underline','u'],['italic','em'],['bold','strong']])if(valid.some(e=>e.type===type&&e.offset<=a&&e.offset+e.length>=b))part=`<${tag}>${part}</${tag}>`;const link=safeLinks.find(e=>e.offset<=a&&e.offset+e.length>=b);if(link)part='<a href="'+escape(link.url)+'" target="_blank" rel="noopener noreferrer">'+part+'</a>';html+=part;}return html;
}
