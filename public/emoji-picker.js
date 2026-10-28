const normalize=s=>s.toLocaleLowerCase().replace(/[يى]/g,'ی').replace(/ك/g,'ک').replace(/[\u064B-\u065F\u200C\u200D\uFE0F]/g,'').trim();
let catalog;
export function emojiMatches(row,query){const tokens=normalize(query).split(/\s+/).filter(Boolean),haystack=normalize(row.slice(0,3).join(' '));return tokens.every(token=>haystack.includes(token));}
export function skinMatches(emoji,skin){if(skin==='all')return true;const modifiers=[...emoji].filter(c=>c.codePointAt(0)>=0x1F3FB&&c.codePointAt(0)<=0x1F3FF);return skin==='0'?!modifiers.length:!modifiers.length||modifiers.every(c=>c.codePointAt(0)===0x1F3FA+Number(skin));}
export function mountEmojiPicker(picker,{choose,onClose}){
 const search=picker.querySelector('[data-emoji-search]'),grid=picker.querySelector('.emoji-grid');let data=[],groups=[],limit=144,ready=false,recents=[],usage=new Map();
 try{const saved=JSON.parse(localStorage.getItem('mohta:recent-emoji')||'[]');if(Array.isArray(saved))recents=saved.filter(e=>typeof e==='string').slice(0,24);}catch{}
 try{const saved=JSON.parse(localStorage.getItem('mohta:emoji-usage')||'[]');if(Array.isArray(saved))usage=new Map(saved.filter(row=>Array.isArray(row)&&typeof row[0]==='string'&&Number.isSafeInteger(row[1])&&row[1]>0).slice(0,200));}catch{}
 const controls=document.createElement('div');controls.className='emoji-controls';
 const category=document.createElement('select');category.setAttribute('aria-label','دسته ایموجی');
 const skin=document.createElement('select');skin.setAttribute('aria-label','رنگ پوست ایموجی');
 for(const [value,label] of [['all','همه رنگ‌ها'],['0','رنگ پیش‌فرض'],['1','🏻 روشن'],['2','🏼 گندمی روشن'],['3','🏽 گندمی'],['4','🏾 تیره'],['5','🏿 تیره‌تر']])skin.add(new Option(label,value));
 const close=document.createElement('button');close.type='button';close.className='emoji-close';close.textContent='×';close.setAttribute('aria-label','بستن انتخابگر ایموجی');close.addEventListener('click',onClose);
 controls.append(category,skin,close);search.closest('label').after(controls);
 const status=document.createElement('p');status.className='emoji-results';status.setAttribute('role','status');
 const more=document.createElement('button');more.type='button';more.className='button secondary small emoji-more';more.textContent='نمایش بیشتر';more.hidden=true;grid.after(status,more);
 function draw(reset=true){
  if(!ready)return;if(reset){limit=144;grid.scrollTop=0;}
  const query=search.value.trim(),list=data.filter(row=>(query?emojiMatches(row,query):category.value==='recent'?recents.includes(row[0]):category.value==='frequent'?usage.has(row[0]):category.value==='all'||row[3]===Number(category.value))&&skinMatches(row[0],skin.value));
  if(!query&&category.value==='recent')list.sort((a,b)=>recents.indexOf(a[0])-recents.indexOf(b[0]));
  if(!query&&category.value==='frequent')list.sort((a,b)=>usage.get(b[0])-usage.get(a[0]));
  grid.replaceChildren();const fragment=document.createDocumentFragment();
  for(const row of list.slice(0,limit)){const button=document.createElement('button');button.type='button';button.textContent=row[0];button.title=row[1];button.setAttribute('aria-label',row[1]+' '+row[0]);button.dataset.emoji=row[0];fragment.append(button);}
  grid.append(fragment);if(!list.length)grid.textContent='ایموجی پیدا نشد';
  status.textContent=list.length.toLocaleString('fa-IR')+' ایموجی'+(list.length>limit?'؛ '+limit.toLocaleString('fa-IR')+' مورد نمایش داده شده':'');more.hidden=list.length<=limit;
 }
 grid.addEventListener('mousedown',event=>event.preventDefault());
 grid.addEventListener('click',event=>{const emoji=event.target.closest('[data-emoji]')?.dataset.emoji;if(!emoji)return;recents=[emoji,...recents.filter(e=>e!==emoji)].slice(0,24);usage.set(emoji,Math.min(Number.MAX_SAFE_INTEGER,(usage.get(emoji)||0)+1));usage=new Map([...usage].sort((a,b)=>b[1]-a[1]).slice(0,200));try{localStorage.setItem('mohta:recent-emoji',JSON.stringify(recents));localStorage.setItem('mohta:emoji-usage',JSON.stringify([...usage]));}catch{}choose(emoji);});
 picker.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onClose();}});
 search.addEventListener('input',()=>draw());category.addEventListener('change',()=>{search.value='';draw();});skin.addEventListener('change',()=>draw());more.addEventListener('click',()=>{limit+=144;draw(false);});
 async function open(){
  picker.hidden=false;search.focus();if(ready){draw();return;}
  status.textContent='در حال بارگذاری ایموجی‌ها…';
  try{catalog??=import('./emoji-data.js');const loaded=await catalog;data=loaded.emojiData;groups=loaded.emojiGroups;
   category.replaceChildren();category.add(new Option('همه ایموجی‌ها','all'));category.add(new Option('اخیراً استفاده‌شده','recent'));category.add(new Option('پراستفاده‌ها','frequent'));groups.forEach((name,index)=>category.add(new Option(name,String(index))));category.value=recents.length?'recent':'0';ready=true;draw();
  }catch{catalog=null;status.textContent='بارگذاری انجام نشد؛ انتخابگر را ببندید و دوباره باز کنید.';}
 }
 return {open};
}
