export const librarySections=[['all','همه محتواها'],['draft','پیش نویس ها'],['ready','صف انتشار'],['published','منتشر شده ها'],['archived','بایگانی شده ها'],['deleted','زباله دان']];
export const settingsSections=[['brands','مدیریت برندها'],['connections','تنظیمات اتصال'],['access','دسترسی'],['account','حساب اصلی من']];
export function libraryRoute(view){return librarySections.some(([key])=>key===view.split('/')[1])?view.split('/')[1]:'all';}
export function settingsRoute(view){return ({brands:'brands',connections:'connections',access:'access',account:'account',channels:'channels',ai:'ai',team:'team',activity:'activity',timezone:'timezone'})[view.split('/')[1]]||'';}
export function navigationGroups({view,filter='all',section='',canCreate=false,needsBrand=false}){
 section=({channels:'connections',ai:'connections',team:'access',activity:'access',timezone:'brands'})[section]||section;
 const groups=needsBrand?['settings']:['dashboard','posts','calendar','settings'];
 return groups.map(key=>({key,active:view===key||key==='posts'&&view==='editor',children:key==='posts'?[...(canCreate?[{label:'محتوای جدید',action:'create',active:view==='editor'}]:[]),...librarySections.map(([value,label])=>({label,view:'posts/'+value,active:view==='posts'&&filter===value}))]:key==='settings'?settingsSections.filter(([value])=>!needsBrand||['brands','account'].includes(value)).map(([value,label])=>({label,view:'settings/'+value,active:view==='settings'&&section===value})):[]}));
}
// Keep the navigation in the layout during both directions of the transition.
export function mountNavigation(sidebar,{onSubmenuChange=()=>{}}={}){
 const panel=sidebar.querySelector('.nav-panel'),toggle=sidebar.querySelector('.nav-toggle'),compact=matchMedia('(max-width:1024px)');
 const groups=[...sidebar.querySelectorAll('[data-nav-group]')];
 function setSubmenu(key,open=true){
  for(const group of groups)group.dataset.expanded=String(group.dataset.navGroup===key&&open);
  if(compact.matches)sidebar.classList.toggle('nav-open',open);sync();
  onSubmenuChange(open?key:'');
 }
 function sync(){panel.inert=false;toggle.setAttribute('aria-expanded',String(sidebar.classList.contains('nav-open')));for(const group of groups){const expanded=group.dataset.expanded==='true'&&(!compact.matches||sidebar.classList.contains('nav-open'));group.querySelector('.nav-submenu').inert=!expanded;group.querySelector('[data-action="toggle-subnav"]').setAttribute('aria-expanded',String(expanded));}}
 function setOpen(open){
  sidebar.classList.toggle('nav-open',open);sync();
  if(!open&&(document.activeElement?.closest('.nav-submenu')||document.activeElement?.classList.contains('nav-sheet-backdrop')))(groups.find(group=>group.dataset.expanded==='true')?.querySelector('.nav-main')||toggle).focus();
  // Reading the animation list flushes the new style and includes the collapse.
  return Promise.allSettled(panel.getAnimations().map(animation=>animation.finished));
 }
 const resize=()=>{sidebar.classList.remove('nav-open');sync();};
 compact.addEventListener('change',resize);sync();
 return {setOpen,toggle:()=>setOpen(!sidebar.classList.contains('nav-open')),toggleSubmenu(key){const group=groups.find(group=>group.dataset.navGroup===key);if(group)setSubmenu(key,group.dataset.expanded!=='true'||compact.matches&&!sidebar.classList.contains('nav-open'));},destroy(){compact.removeEventListener('change',resize);}};
}
