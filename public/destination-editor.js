import {rebaseEntities} from './rich-text.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function mountDestinationEditor(host,{initial={},shared,name,onChange}){
 const cache=structuredClone(initial),events=new AbortController();let selected=[],signature='';
 function draw(){
  host.innerHTML=selected.length?selected.map(id=>{
   const custom=Object.hasOwn(cache,id);
   return `<section class="destination-document" data-destination-document="${esc(id)}"><label class="field"><span>متن پیام ${esc(name(id))}</span><textarea data-destination-body="${esc(id)}" rows="5" maxlength="15000">${esc((custom?cache[id]:shared()).body)}</textarea></label><button type="button" class="button ghost small" data-destination-reset="${esc(id)}" ${custom?'':'hidden'}>استفاده از متن مشترک</button></section>`;
  }).join(''):'';
 }
 host.addEventListener('input',event=>{const id=event.target.dataset.destinationBody;if(!id)return;const before=cache[id]||shared();cache[id]={body:event.target.value,entities:rebaseEntities(before.body,event.target.value,before.entities)};onChange();},{signal:events.signal});
 host.addEventListener('click',event=>{const button=event.target.closest('[data-destination-reset]');if(!button)return;delete cache[button.dataset.destinationReset];draw();onChange();},{signal:events.signal});
 return {
  update(ids){selected=[...ids];host.hidden=!ids.length;const section=host.closest('[data-destination-text-section]');if(section)section.hidden=!ids.length;const next=JSON.stringify(ids);if(next!==signature){signature=next;draw();}for(const input of host.querySelectorAll('[data-destination-body]')){const id=input.dataset.destinationBody;if(!Object.hasOwn(cache,id))input.value=shared().body;const reset=[...host.querySelectorAll('[data-destination-reset]')].find(button=>button.dataset.destinationReset===id);if(reset)reset.hidden=!Object.hasOwn(cache,id);}},
  get(ids=selected){return Object.fromEntries(ids.filter(id=>Object.hasOwn(cache,id)).map(id=>[id,structuredClone(cache[id])]));},
  has:id=>Object.hasOwn(cache,id),
  setBody(id,body){const previous=cache[id]||shared();cache[id]={body,entities:rebaseEntities(previous.body,body,previous.entities)};const input=[...host.querySelectorAll('[data-destination-body]')].find(input=>input.dataset.destinationBody===id);if(input)input.value=body;},
  destroy(){events.abort();},
 };
}
