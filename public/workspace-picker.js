const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export function workspacePickerMarkup(items,selected){
 const current=items.find(item=>item.id===selected);
 return `<button type="button" id="workspace-picker" class="workspace-trigger" role="combobox" aria-label="برند فعال" aria-haspopup="listbox" aria-expanded="false" aria-controls="workspace-menu" value="${escape(selected)}"><span class="workspace-current">${escape(current?.name||'انتخاب برند')}</span><svg class="workspace-arrow" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m5 7.5 5 5 5-5"/></svg></button><div id="workspace-menu" class="workspace-menu" popover="auto" role="listbox" aria-label="برندهای شما">${items.map((item,index)=>`<div id="workspace-option-${index}" class="workspace-option" role="option" aria-selected="${item.id===selected}" data-workspace-id="${escape(item.id)}"><span>${escape(item.name)}</span><svg class="workspace-selected" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m4 10 4 4 8-8"/></svg></div>`).join('')}</div>`;
}
export function mountWorkspacePicker(root,{onSelect}){
 const trigger=root.querySelector('.workspace-trigger'),menu=root.querySelector('.workspace-menu'),options=[...menu.querySelectorAll('[role="option"]')],events=new AbortController();
 let active=-1,typed='',typedAt=0;
 const isOpen=()=>menu.matches(':popover-open');
 function position(){
  const rect=trigger.getBoundingClientRect(),viewport=window.visualViewport,viewportLeft=viewport?.offsetLeft||0,viewportTop=viewport?.offsetTop||0,width=viewport?.width||window.innerWidth,height=viewport?.height||window.innerHeight;
  const below=viewportTop+height-rect.bottom-16,above=rect.top-viewportTop-16,up=below<160&&above>below,maxHeight=Math.min(280,Math.max(48,up?above:below)),menuWidth=Math.min(rect.width,width-24);
  menu.dataset.placement=up?'above':'below';menu.style.width=menuWidth+'px';menu.style.maxHeight=maxHeight+'px';menu.style.left=Math.max(viewportLeft+12,Math.min(rect.right-menuWidth,viewportLeft+width-menuWidth-12))+'px';
  menu.style.top=(up?Math.max(viewportTop+12,rect.top-Math.min(menu.scrollHeight,maxHeight)-8):rect.bottom+8)+'px';
 }
 function highlight(index){
  active=(index+options.length)%options.length;options.forEach((option,i)=>option.classList.toggle('is-highlighted',i===active));
  if(options[active]){trigger.setAttribute('aria-activedescendant',options[active].id);options[active].scrollIntoView({block:'nearest'});}
 }
 function close({focus=false}={}){if(isOpen())menu.hidePopover();trigger.setAttribute('aria-expanded','false');trigger.removeAttribute('aria-activedescendant');if(focus)trigger.focus();typed='';}
 function open(index=options.findIndex(option=>option.getAttribute('aria-selected')==='true')){
  if(trigger.disabled||!options.length)return;
  if(!isOpen()){position();menu.showPopover();position();}trigger.setAttribute('aria-expanded','true');highlight(Math.max(0,index));
 }
 function choose(option){const id=option?.dataset.workspaceId;if(!id)return;close({focus:true});if(id!==trigger.value)onSelect(id);}
 trigger.addEventListener('click',()=>isOpen()?close():open(),{signal:events.signal});
 menu.addEventListener('click',event=>choose(event.target.closest('[role="option"]')),{signal:events.signal});
 menu.addEventListener('pointermove',event=>{if(event.pointerType==='touch')return;const index=options.indexOf(event.target.closest('[role="option"]'));if(index>=0)highlight(index);},{signal:events.signal});
 menu.addEventListener('toggle',()=>{trigger.setAttribute('aria-expanded',String(isOpen()));if(!isOpen())trigger.removeAttribute('aria-activedescendant');},{signal:events.signal});
 root.addEventListener('keydown',event=>{
  if(event.isComposing||event.ctrlKey||event.metaKey||event.altKey)return;
  const key=event.key;
  if(key==='Tab'){close();return;}
  if(key==='Escape'&&isOpen()){event.preventDefault();event.stopPropagation();close({focus:true});return;}
  if(['ArrowDown','ArrowUp','Home','End','Enter',' '].includes(key)){
   event.preventDefault();event.stopPropagation();
   if(key==='Enter'||key===' '){if(isOpen())choose(options[active]);else open();return;}
   if(key==='Home'||key==='End'){open(key==='Home'?0:options.length-1);return;}
   if(!isOpen())open();else highlight(active+(key==='ArrowDown'?1:-1));return;
  }
  if(key.length===1){
   const time=performance.now();typed=time-typedAt>700?key:typed+key;typedAt=time;
   const normalize=value=>value.replace(/[\s\u200c]/g,'').toLocaleLowerCase('fa');const query=normalize(typed),start=Math.max(0,active+1);
   const index=options.map((_,i)=>(start+i)%options.length).find(i=>normalize(options[i].textContent).startsWith(query));if(index!==undefined){event.preventDefault();open(index);}
  }
 },{signal:events.signal});
 const reposition=()=>{if(isOpen())position();};
 window.addEventListener('resize',reposition,{signal:events.signal});window.addEventListener('scroll',reposition,{capture:true,signal:events.signal});
 window.visualViewport?.addEventListener('resize',reposition,{signal:events.signal});
 return {destroy(){close();events.abort();}};
}
