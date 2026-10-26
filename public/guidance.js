const prefix='desk:guidance:v1:';
export async function guidanceScope(account,workspace,session){
 if(!account||!session)return null;
 // Only a non-authenticating digest is stored; credentials and CSRF values stay out of storage.
 let sessionId;try{const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('guidance:'+session));sessionId=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');}catch{sessionId=guidanceId('guidance:'+session);}
 return {sessionPrefix:prefix+encodeURIComponent(account)+':'+sessionId+':',accountPrefix:prefix+encodeURIComponent(account)+':',key:prefix+encodeURIComponent(account)+':'+sessionId+':'+encodeURIComponent(workspace||'account')};
}
export function guidanceId(value){
 let a=2166136261,b=3339675911;for(const char of String(value)){a=Math.imul(a^char.codePointAt(0),16777619);b=Math.imul(b^char.codePointAt(0),2246822519);}
 return (a>>>0).toString(16).padStart(8,'0')+(b>>>0).toString(16).padStart(8,'0');
}
export function createGuidanceStore(storage){
 let scope=null;const memory=new Map();
 function read(){if(!scope)return new Set();try{const value=JSON.parse(storage?.getItem(scope.key)||'null');if(Array.isArray(value))memory.set(scope.key,new Set(value.filter(id=>typeof id==='string'&&id.length<=100).slice(-500)));}catch{}return memory.get(scope.key)||new Set();}
 function keys(){try{return Array.from({length:storage?.length||0},(_,i)=>storage.key(i)).filter(Boolean);}catch{return [];}}
 return {
  get key(){return scope?.key||null;},
  use(next){scope=next;if(!scope)return;for(const key of [...keys(),...memory.keys()])if(key.startsWith(scope.accountPrefix)&&!key.startsWith(scope.sessionPrefix)){try{storage?.removeItem(key);}catch{}memory.delete(key);}},
  has(id){return read().has(id);},
  dismiss(id){if(!scope)return;const ids=read();ids.add(id);const bounded=[...ids].slice(-500);memory.set(scope.key,new Set(bounded));try{storage?.setItem(scope.key,JSON.stringify(bounded));}catch{}},
  clearSession(){if(scope)for(const key of [...keys(),...memory.keys()])if(key.startsWith(scope.sessionPrefix)){try{storage?.removeItem(key);}catch{}memory.delete(key);}scope=null;}
 };
}
export function normalizeHelpItems(items){
 const seen=new Set();return items.map(({title='',text=''})=>({title:String(title).trim().replace(/\s+/g,' '),text:String(text).trim().replace(/\s+/g,' ')})).filter(item=>{if(!item.text)return false;const key=JSON.stringify([item.title,item.text]);if(seen.has(key))return false;seen.add(key);return true;});
}
const candidates='[data-help-note],[data-guidance-note],.help,.form-note,.status-line,.net-hint:not(.access-result),label.field>small';
const excluded='.error,.video-error,[role="alert"],.access-result,.form-result,.publication-result,.preview-message,.rich-input,.auth-page,#caption-count,#preview-error,#ai-connection-message,#brand-logo-error';
export function mountGuidance({roots,context,storage}){
 const document=roots[0].ownerDocument,window=document.defaultView,store=createGuidanceStore(storage),events=new AbortController(),groups=new Map(),sources=new WeakMap(),banners=new WeakMap(),bannerMotions=new Map(),anchorLocks=new Map();
 const tooltip=document.createElement('div');tooltip.id='desk-section-tooltip';tooltip.className='help-tooltip';tooltip.dir='rtl';tooltip.role='tooltip';tooltip.hidden=true;document.body.append(tooltip);
 let enabled=false,generation=0,frame=0,openTimer=0,closeTimer=0,active=null,pinned=false,motion=null,labelSerial=0;
 const clean=node=>{const copy=node.cloneNode(true);for(const control of copy.querySelectorAll('.guidance-close,.help-trigger'))control.remove();return copy.textContent.trim().replace(/\s+/g,' ');};
 const reduced=()=>window.matchMedia('(prefers-reduced-motion:reduce)').matches;
 function cancelTimers(){window.clearTimeout(openTimer);window.clearTimeout(closeTimer);}
 function hideTooltip(immediate=false){
  cancelTimers();const old=active;active=null;pinned=false;
  if(old){old.button.setAttribute('aria-expanded','false');old.button.removeAttribute('aria-describedby');}
  const opacity=window.getComputedStyle(tooltip).opacity,transform=window.getComputedStyle(tooltip).transform;motion?.cancel();motion=null;if(tooltip.hidden)return;
  const finish=()=>{if(!active){tooltip.hidden=true;tooltip.replaceChildren();}};
  if(immediate||reduced()){finish();return;}
  const fade=tooltip.animate([{opacity,transform},{opacity:0,transform:'translateY(-4px)'}],{duration:160,easing:'ease-out',fill:'forwards'});motion=fade;
  fade.finished.catch(()=>{}).then(()=>{if(motion===fade){finish();fade.cancel();motion=null;}});
 }
 function entries(group){return normalizeHelpItems([...group.notes.values()].flat());}
 function renderTooltip(group){
  const title=document.createElement('strong');title.className='help-tooltip-title';title.textContent=group.title;
  const list=document.createElement('ul');list.className='help-tooltip-items';let previousTitle='';
  for(const entry of entries(group)){const item=document.createElement('li');if(entry.title&&entry.title!==group.title&&entry.title!==previousTitle){const label=document.createElement('strong');label.textContent=entry.title;item.append(label);}const text=document.createElement('span');text.textContent=entry.text;item.append(text);list.append(item);previousTitle=entry.title;}
  tooltip.replaceChildren(title,list);
 }
 function positionTooltip(){
  if(!active)return;const anchor=active.button;if(!anchor.isConnected){hideTooltip(true);return;}
  const rect=anchor.getBoundingClientRect(),viewportWidth=document.documentElement.clientWidth,viewportHeight=window.innerHeight;
  const scroller=anchor.closest('.main,.preview-scroll,.modal'),clip=scroller?.getBoundingClientRect();
  if(rect.bottom<0||rect.top>viewportHeight||clip&&(rect.bottom<clip.top||rect.top>clip.bottom)){hideTooltip(true);return;}
  const gap=9,padding=12,width=Math.min(390,viewportWidth-padding*2);
  tooltip.style.width=width+'px';tooltip.style.maxHeight=(viewportHeight-padding*2)+'px';
  const natural=tooltip.scrollHeight+2,below=viewportHeight-rect.bottom-gap-padding,above=rect.top-gap-padding,down=natural<=below||below>=above;
  tooltip.style.maxHeight=Math.max(70,Math.min(viewportHeight-padding*2,down?below:above))+'px';
  const height=tooltip.getBoundingClientRect().height,left=Math.max(padding,Math.min(viewportWidth-width-padding,rect.right-width));
  tooltip.style.left=Math.round(left)+'px';tooltip.style.top=Math.round(Math.max(padding,Math.min(viewportHeight-height-padding,down?rect.bottom+gap:rect.top-height-gap)))+'px';
 }
 function showTooltip(group,pin=false){
  if(!enabled||!entries(group).length)return;cancelTimers();
  if(active===group){pinned=pinned||pin;return;}
  hideTooltip(true);active=group;pinned=pin;renderTooltip(group);tooltip.dataset.content=JSON.stringify(entries(group));tooltip.hidden=false;
  group.button.setAttribute('aria-expanded','true');group.button.setAttribute('aria-describedby',tooltip.id);positionTooltip();
  if(active&&!reduced())motion=tooltip.animate([{opacity:0,transform:'translateY(4px)'},{opacity:1,transform:'translateY(0)'}],{duration:180,easing:'cubic-bezier(.2,.7,.3,1)'});
 }
 function delayHide(group){window.clearTimeout(openTimer);window.clearTimeout(closeTimer);closeTimer=window.setTimeout(()=>{if(active===group&&!pinned&&document.activeElement!==group.button&&!tooltip.matches(':hover'))hideTooltip();},130);}
 function headingFor(note){
  if(note.dataset.guidanceNote==='dashboard-start')return document.querySelector('.main .topbar h1');
  const section=note.closest('[data-settings-accordion],.panel,.channel-card,.modal');
  return section?.querySelector(':scope>summary h2,:scope>summary h3,:scope>summary h4,:scope>.panel-head h2,:scope>.panel-head h3,:scope>.channel-title h2,:scope>h2,:scope>.section-heading>h2')||document.querySelector('.main .topbar h1');
 }
 function groupFor(heading){
  if(!heading)return null;let group=groups.get(heading);if(group)return group;
  const summary=heading.closest('summary');if(summary&&!summary.hasAttribute('aria-label')&&!summary.hasAttribute('aria-labelledby'))summary.setAttribute('aria-label',clean(heading));
  const wrapper=document.createElement('div');wrapper.className='section-heading';heading.before(wrapper);wrapper.append(heading);
  const button=document.createElement('button');button.type='button';button.className='help-trigger';button.innerHTML='<span aria-hidden="true">i</span>';const title=clean(heading);
  button.setAttribute('aria-label','راهنمای '+title);button.setAttribute('aria-expanded','false');button.setAttribute('aria-controls',tooltip.id);wrapper.append(button);
  group={heading,wrapper,button,title,notes:new Map()};groups.set(heading,group);
  button.addEventListener('pointerenter',()=>{window.clearTimeout(closeTimer);window.clearTimeout(openTimer);openTimer=window.setTimeout(()=>showTooltip(group),65);});
  button.addEventListener('pointerleave',()=>delayHide(group));button.addEventListener('focus',()=>showTooltip(group));
  button.addEventListener('blur',()=>{if(active===group)pinned=false;delayHide(group);});
  button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();if(active===group&&pinned)hideTooltip();else showTooltip(group,true);});
  button.addEventListener('keydown',event=>{
   if(event.key==='Escape'){event.preventDefault();event.stopPropagation();hideTooltip();}
   else if(active===group&&['ArrowDown','ArrowUp','PageDown','PageUp','Home','End'].includes(event.key)){event.preventDefault();if(event.key==='Home')tooltip.scrollTop=0;else if(event.key==='End')tooltip.scrollTop=tooltip.scrollHeight;else tooltip.scrollBy({top:(event.key.includes('Up')?-1:1)*(event.key.startsWith('Page')?tooltip.clientHeight*.8:50),behavior:'instant'});}
  });
  return group;
 }
 function sourceEntries(note){
  if(note.dataset.guidanceNote==='dashboard-start')return [...note.querySelectorAll('li')].map(item=>({title:item.querySelector('strong')?.textContent||'',text:item.querySelector('small')?.textContent||clean(item)}));
  const field=note.closest('label.field'),logo=note.closest('.brand-logo-settings'),details=note.closest('details.admin-contacts'),contacts=note.closest('.contacts-editor'),media=note.closest('.media-section');
  const label=field?.querySelector(':scope>span')||logo?.querySelector('strong')||details?.querySelector('summary')||contacts?.querySelector('h3')||media?.querySelector('h3');
  return [{title:label?clean(label):'',text:clean(note)}];
 }
 function restore(note){const previous=sources.get(note);if(!previous)return;previous.group.notes.delete(note);note.hidden=previous.hidden;note.inert=false;note.removeAttribute('data-guidance-source');sources.delete(note);}
 function register(note){
  if(note.matches('.banner[data-guidance-note]')){registerBanner(note);return;}
  if(note.closest(excluded)||note.parentElement?.closest('[data-guidance-source]')||note.querySelector('input,textarea,select,button:not(.guidance-close),a[href],video,audio')){restore(note);return;}
  if(note.matches('label.field>small')){const label=note.parentElement,caption=label.querySelector(':scope>span'),input=label.querySelector('input,textarea,select');if(caption&&input&&!input.hasAttribute('aria-label')&&!input.hasAttribute('aria-labelledby')){if(!caption.id)caption.id='help-field-'+(++labelSerial);input.setAttribute('aria-labelledby',caption.id);}}
  const items=sourceEntries(note);if(!items.some(item=>item.text)){restore(note);return;}
  const group=groupFor(headingFor(note));if(!group)return;const previous=sources.get(note);
  if(previous&&previous.group!==group)restore(note);
  if(!sources.has(note)){sources.set(note,{group,hidden:note.hidden});note.dataset.guidanceSource='';note.hidden=true;note.inert=true;}
  group.notes.set(note,items);
 }
 function registerBanner(note){
  if(!store.key||banners.get(note)===store.key)return;
  cancelBannerMotion(note);
  note.querySelector(':scope>.guidance-close')?.remove();note.hidden=false;note.inert=false;delete note.dataset.guidanceDismissed;
  const id=note.dataset.guidanceNote;banners.set(note,store.key);note.dataset.guidanceId=id;note.classList.add('guidance-note');
  const button=document.createElement('button');button.type='button';button.className='guidance-close';button.setAttribute('aria-label','بستن اطلاعیه');button.innerHTML='<span aria-hidden="true">×</span>';
  button.addEventListener('click',event=>{event.preventDefault();store.dismiss(id);dismissBanner(note,true);});note.prepend(button);if(store.has(id))dismissBanner(note);
 }
 function lockScrollAnchor(scroller){
  if(!scroller)return ()=>{};let lock=anchorLocks.get(scroller);
  if(!lock){lock={value:scroller.style.overflowAnchor,count:0};anchorLocks.set(scroller,lock);scroller.style.overflowAnchor='none';}lock.count++;
  return ()=>{if(--lock.count===0){scroller.style.overflowAnchor=lock.value;anchorLocks.delete(scroller);}};
 }
 function cancelBannerMotion(note){const record=bannerMotions.get(note);if(!record)return;bannerMotions.delete(note);record.fade.cancel();record.release();}
 function cancelBannerMotions(){for(const note of bannerMotions.keys()){note.hidden=true;cancelBannerMotion(note);}}
 function dismissBanner(note,animate=false){
  if(note.dataset.guidanceDismissed)return;note.dataset.guidanceDismissed='true';note.inert=true;
  if(!animate||reduced()){note.hidden=true;return;}
  const height=note.getBoundingClientRect().height,style=window.getComputedStyle(note),release=lockScrollAnchor(note.closest('.main,.preview-scroll,.modal'));
  // The last animation frame must occupy exactly zero space, including borders and minimum size.
  const fade=note.animate([{height:height+'px',minHeight:'0px',boxSizing:'border-box',opacity:1,paddingTop:(parseFloat(style.paddingTop)+parseFloat(style.borderTopWidth))+'px',paddingBottom:(parseFloat(style.paddingBottom)+parseFloat(style.borderBottomWidth))+'px',marginTop:style.marginTop,marginBottom:style.marginBottom,borderTopWidth:'0px',borderBottomWidth:'0px',overflow:'hidden'},{height:'0px',minHeight:'0px',boxSizing:'border-box',opacity:0,paddingTop:'0px',paddingBottom:'0px',marginTop:'0px',marginBottom:'0px',borderTopWidth:'0px',borderBottomWidth:'0px',overflow:'hidden'}],{duration:260,easing:'cubic-bezier(.2,.7,.3,1)',fill:'both'});
  const record={fade,release};bannerMotions.set(note,record);
  const finish=()=>{if(bannerMotions.get(note)!==record)return;note.hidden=true;bannerMotions.delete(note);fade.cancel();release();};
  fade.finished.then(finish,finish);
 }
 function scan(){
  frame=0;if(!enabled)return;
  for(const root of roots)for(const note of root.querySelectorAll(candidates))register(note);
  for(const [heading,group] of groups){for(const note of group.notes.keys())if(!note.isConnected)group.notes.delete(note);if(!heading.isConnected||!group.notes.size){if(active===group)hideTooltip(true);group.button.remove();if(group.wrapper.isConnected)group.wrapper.replaceWith(heading);groups.delete(heading);}}
  if(active){const signature=JSON.stringify(entries(active));if(tooltip.dataset.content!==signature){tooltip.dataset.content=signature;renderTooltip(active);positionTooltip();}}
 }
 function scheduleScan(){if(enabled&&!frame)frame=window.requestAnimationFrame(scan);}
 const observer=new MutationObserver(scheduleScan);for(const root of roots)observer.observe(root,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['class','role']});
 tooltip.addEventListener('pointerenter',()=>window.clearTimeout(closeTimer));tooltip.addEventListener('pointerleave',()=>active&&delayHide(active));
 document.addEventListener('pointerdown',event=>{if(active&&!tooltip.contains(event.target)&&!active.button.contains(event.target))hideTooltip();},{signal:events.signal});
 document.addEventListener('keydown',event=>{if(active&&event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();hideTooltip();}},{signal:events.signal});
 window.addEventListener('resize',positionTooltip,{passive:true,signal:events.signal});
 document.addEventListener('scroll',event=>{if(event.target!==tooltip)positionTooltip();},{capture:true,passive:true,signal:events.signal});
 window.addEventListener('storage',event=>{if(event.key===store.key)for(const root of roots)for(const note of root.querySelectorAll('.banner[data-guidance-id]'))if(store.has(note.dataset.guidanceId))dismissBanner(note);},{signal:events.signal});
 return {
  async setContext({accountId,workspaceId,sessionKey}){const current=++generation,scope=await guidanceScope(accountId,workspaceId,sessionKey);if(current!==generation)return;if(store.key!==scope?.key){hideTooltip(true);cancelBannerMotions();}store.use(scope);enabled=!!scope;scan();},
  deactivate(){generation++;enabled=false;store.use(null);hideTooltip(true);cancelBannerMotions();},
  clearSession(){generation++;enabled=false;store.clearSession();hideTooltip(true);cancelBannerMotions();},
  destroy(){enabled=false;observer.disconnect();events.abort();cancelTimers();if(frame)window.cancelAnimationFrame(frame);motion?.cancel();cancelBannerMotions();tooltip.remove();for(const [heading,group] of groups){for(const note of group.notes.keys())restore(note);group.button.remove();if(group.wrapper.isConnected)group.wrapper.replaceWith(heading);}groups.clear();}
 };
}
