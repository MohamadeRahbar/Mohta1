export function bindChannelSelection(form){
 const toggle=form.querySelector('[data-select-all-channels]');
 const choices=[...form.querySelectorAll('input[name="channels"]:not(:disabled)')];
 const sync=()=>{const selected=choices.filter(input=>input.checked).length;toggle.disabled=!choices.length;toggle.checked=!!choices.length&&selected===choices.length;toggle.indeterminate=selected>0&&selected<choices.length;};
 toggle.addEventListener('change',()=>{for(const input of choices)input.checked=toggle.checked;sync();});
 form.addEventListener('change',event=>{if(event.target.matches('input[name="channels"]'))sync();});
 sync();
}
