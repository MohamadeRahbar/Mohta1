// Keep the navigation in the layout during both directions of the transition.
export function mountNavigation(sidebar){
 const panel=sidebar.querySelector('.nav-panel'),toggle=sidebar.querySelector('.nav-toggle'),mobile=matchMedia('(max-width:760px)');
 function sync(){panel.inert=mobile.matches&&!sidebar.classList.contains('nav-open');toggle.setAttribute('aria-expanded',String(sidebar.classList.contains('nav-open')));}
 function setOpen(open){
  sidebar.classList.toggle('nav-open',open);sync();
  if(!open&&panel.contains(document.activeElement))toggle.focus();
  // Reading the animation list flushes the new style and includes the collapse.
  return Promise.allSettled(panel.getAnimations().map(animation=>animation.finished));
 }
 const resize=()=>{if(!mobile.matches)sidebar.classList.remove('nav-open');sync();};
 mobile.addEventListener('change',resize);sync();
 return {setOpen,toggle:()=>setOpen(!sidebar.classList.contains('nav-open')),destroy(){mobile.removeEventListener('change',resize);}};
}
