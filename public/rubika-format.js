// Keep hashtag text untouched and outside style ranges in Rubika's Bot API.
// Its documented MetadataTypeEnum has no native Hashtag variant.
export function hashtagRanges(text){
 return [...text.matchAll(/(^|[^\p{L}\p{N}_\/#@])(#[\p{L}\p{M}\p{N}_\u200c]+)/gu)].map(match=>({offset:match.index+match[1].length,length:match[2].length}));
}
export function rubikaEntities(text,entities=[]){
 const tags=hashtagRanges(text),styles=new Set(['bold','italic','underline']);
 return entities.flatMap(entity=>{
  if(!styles.has(entity.type))return [entity];
  let ranges=[{start:entity.offset,end:entity.offset+entity.length}];
  for(const tag of tags)ranges=ranges.flatMap(range=>{const start=Math.max(range.start,tag.offset),end=Math.min(range.end,tag.offset+tag.length);if(start>=end)return [range];return [...(range.start<start?[{start:range.start,end:start}]:[]),...(end<range.end?[{start:end,end:range.end}]:[])];});
  return ranges.map(range=>({...entity,offset:range.start,length:range.end-range.start}));
 });
}
