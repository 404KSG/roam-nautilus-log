// Shared creation/diagnostic UI. All actions go to the one session owner.
export function planEntryLabel(state) {
  const l=state.labels;
  return ({'ready-absent':l.create,creating:l.creating,checking:l.checking,'ready-blocked':l.templateBlocked,
    partial:l.incomplete,'read-failed':l.readError,'nav-failed':l.retryLocate,'ready-present':l.locate})[state.status] || l.checking;
}
const node=(tag,text,className='')=>{const el=document.createElement(tag);el.textContent=text;el.className=className;return el;};
export function planActions(todayPlan,state) {
  const wrap=node('div','','nautilus-log-timing__plan-actions');
  const l=state.labels,status=state.status;
  wrap.append(node('div',state.message || planEntryLabel(state)));
  if(state.totalCount!==null && state.totalCount!==undefined) wrap.append(node('div',`${state.verifiedCount || 0} / ${state.totalCount} ${l.verifiedBlocks}`));
  const button=(label,action,primary=false,disabled=false)=>{
    const el=node('button',label,primary?'nautilus-log-timing__plan-create':'nautilus-log-timing__plan-secondary');
    el.type='button';el.disabled=disabled;
    el.addEventListener('click',event=>{
      const locateMode=event.shiftKey?'sidebar':'main';
      Promise.resolve().then(()=>action(locateMode)).catch(error=>{wrap.prepend(node('div',error.message));});
    });
    wrap.append(el);
  };
  if(status==='ready-absent' || status==='creating') button(status==='creating'?l.creating:l.create,locateMode=>todayPlan.ensureToday({locateMode}),true,status==='creating');
  if(status==='partial') {
    button(l.inspectCreated,locateMode=>todayPlan.locateToday({locateMode}));
    if(state.canResume) button(l.continueCreation,locateMode=>todayPlan.ensureToday({locateMode,resume:true}),true);
    else wrap.append(node('div',l.noReloadResume));
  }
  if(['read-failed','ready-blocked'].includes(status)) button(l.retry,()=>todayPlan.discover({authoritative:true}));
  if(status==='nav-failed') button(l.retryLocate,locateMode=>todayPlan.locateToday({locateMode}));
  if(['ready-absent','ready-blocked'].includes(status)) button(l.viewTemplate,locateMode=>todayPlan.openTemplate({locateMode}));
  return wrap;
}
export function positionTopbarTooltip(trigger,tooltip) {
  if(!trigger || !tooltip)return;
  const r=trigger.getBoundingClientRect(),width=tooltip.getBoundingClientRect().width;
  tooltip.style.left=`${Math.max(12,Math.min(r.left,window.innerWidth-width-12))}px`;
  tooltip.style.top=`${r.bottom+9}px`;
}
export function createPlanDiagnostics(todayPlan,anchor) {
  let panel=null;
  const close=()=>{panel?.remove();panel=null;document.removeEventListener('keydown',key);document.removeEventListener('mousedown',outside);};
  const key=e=>{if(e.key==='Escape'){close();anchor()?.focus();}};
  const outside=e=>{if(!panel?.contains(e.target) && !anchor()?.contains(e.target))close();};
  const render=()=>{
    if(!panel)return;
    const state=todayPlan.getState();
    if(['ready-present','ready-absent'].includes(state.status)){close();return;}
    panel.replaceChildren(planActions(todayPlan,state));
    const button=node('button',state.labels.close,'nautilus-log-timing__plan-secondary');button.type='button';button.addEventListener('click',()=>{close();anchor()?.focus();});panel.append(button);
    const r=anchor()?.getBoundingClientRect();
    panel.style.left=`${Math.max(12,Math.min(r?.left || 12,window.innerWidth-panel.getBoundingClientRect().width-12))}px`;
    panel.style.top=`${(r?.bottom || 45)+9}px`;
  };
  const unsubscribe=todayPlan?.subscribe?.(render);
  return {show(){
    close();panel=node('div','','nautilus-log-timing__plan-diagnostics');panel.setAttribute('role','dialog');
    panel.setAttribute('aria-label',todayPlan.getState().labels.details);panel.tabIndex=-1;
    // Inherit the host dark theme; never mount outside the current app shell.
    (anchor()?.parentElement || document.body).append(panel);render();panel?.focus();
    document.addEventListener('keydown',key);document.addEventListener('mousedown',outside);
  },destroy(){close();unsubscribe?.();}};
}
