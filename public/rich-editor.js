import {mountEmojiPicker} from './emoji-picker.js';
import {richMarkup,normalizeEntities} from './rich-text.js';
export function richField(label,value,entities=[],prefix='description'){return `<div class="rich-field full"><span id="description-label" class="field-label">${label}</span><div class="rich-box"><div class="rich-toolbar" role="toolbar" aria-label="قالب بندی متن"><button type="button" data-rich-command="bold" aria-label="بولد" title="بولد (Ctrl+B)" aria-pressed="false"><b>B</b></button><button type="button" data-rich-command="underline" aria-label="زیرخط" title="زیرخط (Ctrl+U)" aria-pressed="false"><u>U</u></button><button type="button" data-rich-command="italic" aria-label="ایتالیک" title="ایتالیک (Ctrl+I)" aria-pressed="false"><i>I</i></button><button type="button" data-emoji-toggle aria-label="انتخاب ایموجی" aria-expanded="false">😊</button></div><div class="emoji-picker" hidden><label class="field"><span>جست وجوی ایموجی</span><input type="search" data-emoji-search placeholder="جست‌وجو به فارسی، انگلیسی یا با ایموجی"></label><div class="emoji-grid"></div><small>ظاهر ایموجی به دستگاه مخاطب بستگی دارد</small></div><div id="description-rich" class="rich-input" contenteditable="true" role="textbox" aria-multiline="true" aria-labelledby="description-label" dir="rtl">${richMarkup(value,entities).replace(/\n/g,'<br>')}</div></div><textarea name="description" hidden></textarea><small class="help">متن را انتخاب کنید و B، U یا I را بزنید نمایش قالب بندی به پشتیبانی مقصد بستگی دارد</small><button type="button" class="assist-button" data-action="text-assist" data-target="description" data-label="${label}">✦ کمک هوش مصنوعی</button></div>`.replaceAll('description-label',prefix+'-label').replace('id="description-rich"','id="'+prefix+'-rich"');}
export function readRich(root){
 let body='',entities=[];
 function visit(node,marks=[]){if(node.nodeType===3){const offset=body.length;body+=node.nodeValue;for(const type of marks)if(node.nodeValue.length)entities.push({type,offset,length:node.nodeValue.length});return;}if(node.nodeType!==1)return;if(node.tagName==='BR'){body+='\n';return;}
 const active=new Set(marks),style=node.style,tag=node.tagName;
 if(style.fontWeight==='normal'||(style.fontWeight&&Number(style.fontWeight)<600))active.delete('bold');if(style.fontStyle==='normal')active.delete('italic');if(style.textDecorationLine==='none')active.delete('underline');
 if(['B','STRONG'].includes(tag)||style.fontWeight==='bold'||Number(style.fontWeight)>=600)active.add('bold');if(['I','EM'].includes(tag)||style.fontStyle==='italic')active.add('italic');if(tag==='U'||style.textDecorationLine?.includes('underline'))active.add('underline');
 const block=['DIV','P'].includes(tag)&&node!==root;if(block&&body&&!body.endsWith('\n'))body+='\n';for(const child of node.childNodes)visit(child,[...active]);if(block&&node.nextSibling&&!body.endsWith('\n'))body+='\n';
 }for(const node of root.childNodes)visit(node);return {body,entities:normalizeEntities(body,entities)};
}
export function mountRichEditor(form,{prefix='description'}={}){
 const input=form.querySelector('#'+prefix+'-rich'),hidden=form.elements.description,picker=form.querySelector('.emoji-picker'),toggle=form.querySelector('[data-emoji-toggle]');
 let savedRange=null;hidden.value=readRich(input).body;
 function sync(){const value=readRich(input);hidden.value=value.body;hidden.dispatchEvent(new Event('input',{bubbles:true}));}
 function remember(){const selection=getSelection();if(selection.rangeCount&&input.contains(selection.anchorNode)&&input.contains(selection.focusNode))savedRange=selection.getRangeAt(0).cloneRange();}
 function restore(){input.focus();const selection=getSelection();selection.removeAllRanges();if(savedRange&&input.contains(savedRange.startContainer))selection.addRange(savedRange);else{const range=document.createRange();range.selectNodeContents(input);range.collapse(false);selection.addRange(range);}}
 function buttons(){remember();const selection=getSelection();if(!input.contains(selection.anchorNode))return;form.querySelectorAll('[data-rich-command]').forEach(button=>button.setAttribute('aria-pressed',String(document.queryCommandState(button.dataset.richCommand))));}
 function command(name,value){restore();document.execCommand(name,false,value);remember();sync();buttons();}
 form.querySelectorAll('[data-rich-command]').forEach(button=>{button.addEventListener('mousedown',event=>event.preventDefault());button.addEventListener('click',()=>command(button.dataset.richCommand));});
 input.addEventListener('input',()=>{remember();sync();});input.addEventListener('keyup',buttons);input.addEventListener('mouseup',buttons);
 input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();command('insertLineBreak');}if((event.ctrlKey||event.metaKey)&&['b','u','i'].includes(event.key.toLowerCase())){event.preventDefault();command({b:'bold',u:'underline',i:'italic'}[event.key.toLowerCase()]);}});
 input.addEventListener('drop',event=>{event.preventDefault();const value=event.dataTransfer.getData('text/plain');if(value)command('insertText',value);});
 input.addEventListener('paste',event=>{event.preventDefault();remember();command('insertText',event.clipboardData.getData('text/plain'));});
 const closePicker=()=>{picker.hidden=true;toggle.setAttribute('aria-expanded','false');restore();};
 const emojiPicker=mountEmojiPicker(picker,{choose:emoji=>{command('insertText',emoji);closePicker();},onClose:closePicker});
 toggle.addEventListener('mousedown',event=>event.preventDefault());toggle.addEventListener('click',()=>{remember();if(!picker.hidden){closePicker();return;}toggle.setAttribute('aria-expanded','true');emojiPicker.open();});
 input.addEventListener('keydown',event=>{if(event.key==='Escape'){picker.hidden=true;toggle.setAttribute('aria-expanded','false');}});
 return {get:()=>readRich(input),set(value){input.innerHTML=richMarkup(value).replace(/\n/g,'<br>');savedRange=null;sync();}};
}
