// Disclosures keep the original form controls mounted so closing never discards edits.
const remembered=new Map();
let serial=0;
export function mountSettingsAccordions(root,{scope='',sections=null,defaultOpen=false}={}){
 const document=root.ownerDocument,window=document.defaultView,records=new Map(),events=new AbortController();
 let frame=0,stopped=false;
 const sizes=window.ResizeObserver?new window.ResizeObserver(entries=>{
  for(const entry of entries){
   const record=records.get(entry.target.parentElement?.parentElement);
   if(!record?.motion||!record.open)continue;
   const height=record.inner.getBoundingClientRect().height;
   if(Math.abs(height-record.to)<.5)continue;
   // Keep the same timeline when a nested disclosure or help layout changes height.
   record.to=height;record.motion.effect.setKeyframes([{height:record.from+'px',opacity:record.opacity},{height:height+'px',opacity:1}]);
  }
 }):null;
 const storageKey=key=>JSON.stringify([scope,key]);
 const reduced=()=>window.matchMedia('(prefers-reduced-motion:reduce)').matches;
 function setOpen(record,open,{animate=true,remember=true}={}){
  const {details,summary,content,inner}=record;
  const from=details.open?content.getBoundingClientRect().height:0,opacity=details.open?window.getComputedStyle(content).opacity:0;
  record.motion?.cancel();record.motion=null;record.open=open;
  if(remember)remembered.set(storageKey(record.key),open);
  summary.setAttribute('aria-expanded',String(open));
  if(!open&&content.contains(document.activeElement))summary.focus({preventScroll:true});
  content.inert=!open;
  const expanded=duration=>{details.style.setProperty('--accordion-duration',duration+'ms');details.dataset.expanded=String(open);};
  const finish=()=>{details.open=open;content.style.height='';content.style.overflow='';};
  if(!animate||reduced()||!details.isConnected||!content.animate){expanded(230);finish();return;}
  details.open=true;
  const to=open?inner.getBoundingClientRect().height:0;
  // A closed ancestor has no visible height to animate.
  if(!details.getBoundingClientRect().height||Math.abs(from-to)<1){expanded(230);finish();return;}
  // Larger sections need more time to keep their travel as calm as short ones.
  const duration=Math.min(360,Math.max(230,Math.abs(from-to)*.9));
  expanded(duration);
  content.style.overflow='hidden';
  const motion=content.animate([{height:from+'px',opacity},{height:to+'px',opacity:open?1:0}],{duration,easing:'cubic-bezier(.2,.7,.3,1)',fill:'both'});
  record.from=from;record.to=to;record.opacity=opacity;
  record.motion=motion;
  motion.finished.then(()=>{if(record.motion!==motion)return;record.motion=null;finish();motion.cancel();}).catch(()=>{});
 }
 function register(details,key,summary,content,inner){
  details.classList.add('settings-accordion');details.dataset.settingsAccordion=key;
  summary.classList.add('settings-accordion-head');
  const arrow=document.createElement('span');arrow.className='settings-accordion-arrow';arrow.setAttribute('aria-hidden','true');
  arrow.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="m6 9 6 6 6-6"/></svg>';summary.append(arrow);
  content.classList.add('settings-accordion-content');inner.classList.add('settings-accordion-inner');
  content.id='settings-disclosure-'+(++serial);summary.setAttribute('aria-controls',content.id);
  const record={details,key,summary,content,inner,motion:null,open:false};records.set(details,record);
  sizes?.observe(inner);
  setOpen(record,remembered.get(storageKey(key))??defaultOpen,{animate:false,remember:false});
  summary.addEventListener('click',event=>{
   // The help button has its own click action and must not toggle this section.
   if(event.target.closest('button,a,input,select,textarea,label'))return;
   event.preventDefault();setOpen(record,!record.open);
  },{signal:events.signal});
  return details;
 }
 function convert(section,key,head){
  if(!section||section.dataset.settingsAccordion)return section;
  const details=document.createElement('details');for(const {name,value} of section.attributes)details.setAttribute(name,value);
  const summary=document.createElement('summary');summary.className=head.className;
  while(head.firstChild)summary.append(head.firstChild);head.remove();
  const content=document.createElement('div'),inner=document.createElement('div');
  while(section.firstChild)inner.append(section.firstChild);content.append(inner);details.append(summary,content);section.replaceWith(details);
  return register(details,key,summary,content,inner);
 }
 function nativeDetails(details,key){
  if(!details||details.dataset.settingsAccordion)return;
  const summary=details.querySelector(':scope>summary'),heading=document.createElement('h3');
  while(summary.firstChild)heading.append(summary.firstChild);summary.append(heading);
  const content=document.createElement('div'),inner=document.createElement('div');
  for(const node of [...details.childNodes])if(node!==summary)inner.append(node);
  content.append(inner);details.append(content);register(details,key,summary,content,inner);
 }
 function contactSections(){
  const editor=root.querySelector('#settings-form [data-contact-editor]');if(!editor)return;
  if(!editor.querySelector('[data-settings-accordion="phones"]')){
   const head=editor.querySelector(':scope>.contact-heading'),list=editor.querySelector(':scope>[data-phone-list]');
   if(head&&list){
    const section=document.createElement('section');section.className='settings-phone-section';editor.prepend(section);
    const body=document.createElement('div');body.className='settings-contact-body';
    const add=head.querySelector('[data-action="add-phone"]');if(add){const actions=document.createElement('div');actions.className='settings-phone-actions';actions.append(add);body.append(actions);}
    const help=editor.querySelector(':scope>.help');if(help)body.append(help);body.append(list);section.append(head,body);convert(section,'phones',head);
   }
  }
  nativeDetails(editor.querySelector('details.admin-contacts'),'admins');
 }
 function logoSection(){
  const logo=root.querySelector('.brand-logo-settings');if(!logo||logo.dataset.settingsAccordion)return;
  const title=logo.querySelector('.brand-logo-content>strong'),preview=logo.querySelector('#brand-logo-preview');if(!title||!preview)return;
  const head=document.createElement('div');head.className='settings-logo-head';
  const heading=document.createElement('h3');heading.textContent=title.textContent;title.remove();head.append(preview,heading);logo.prepend(head);
  convert(logo,'logo',head);
 }
 function scan(){
  frame=0;if(stopped)return;
  for(const [details,record] of records)if(!details.isConnected){record.motion?.cancel();sizes?.unobserve(record.inner);records.delete(details);}
  for(const [selector,key] of sections||[['.workspace-settings','brands'],['.account-settings','account'],['.brand-identity','identity'],['.brand-name-settings','brand-name'],['#brand-contacts-title','contacts'],['.brand-connections','connections'],['.settings-channels','channels'],['.settings-ai','ai'],['.settings-access','access'],['.settings-team','team'],['.settings-activity','activity']]){
   const selected=root.querySelector(selector),section=selector.startsWith('#')?selected?.closest('.panel'):selected;
   const head=section?.querySelector(':scope>.panel-head');if(section&&head)convert(section,key,head);
  }
  if(!sections){logoSection();contactSections();}
 }
 function schedule(){if(!stopped&&!frame)frame=window.requestAnimationFrame(scan);}
 const observer=new MutationObserver(schedule);observer.observe(root,{childList:true,subtree:true});
 root.addEventListener('invalid',event=>{
  const ancestors=[];let parent=event.target.closest('[data-settings-accordion]');
  while(parent){const record=records.get(parent);if(record)ancestors.unshift(record);parent=parent.parentElement?.closest('[data-settings-accordion]');}
  for(const record of ancestors)setOpen(record,true,{animate:false});
 },{capture:true,signal:events.signal});
 scan();
 return {
  reveal(key){
   const target=[...records.values()].find(record=>record.key===key);if(!target)return false;
   const ancestors=[];let parent=target.details;while(parent){const record=records.get(parent);if(record)ancestors.unshift(record);parent=parent.parentElement?.closest('[data-settings-accordion]');}
   for(const record of ancestors)setOpen(record,true,{animate:false});target.summary.scrollIntoView({block:'start',behavior:reduced()?'instant':'smooth'});return true;
  },
  destroy(){stopped=true;observer.disconnect();sizes?.disconnect();events.abort();if(frame)window.cancelAnimationFrame(frame);for(const record of records.values())record.motion?.cancel();records.clear();}
 };
}
