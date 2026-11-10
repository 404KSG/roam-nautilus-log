#!/usr/bin/env python3
"""Exact-renderer switch throughput, hidden work and geometry-read diagnostics."""
import importlib.util,json,os,subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[1]
os.environ['NAUTILUS_RENDERER_OUT']=os.environ.get('NAUTILUS_SWITCH_PERF_OUT','/tmp/nautilus-switch-performance')
spec=importlib.util.spec_from_file_location('switch_perf_fixture',ROOT/'test/chart-renderer.py')
f=importlib.util.module_from_spec(spec);spec.loader.exec_module(f)
OUT=f.OUT
INSTALL='''()=>{
 window.switchPerf={reads:0,adds:0,removes:0,heights:0,frames:0};
 const frame=()=>{switchPerf.frames++;requestAnimationFrame(frame)};requestAnimationFrame(frame);
 const api=roamAlphaAPI.data,pull=api.pull,add=api.addPullWatch,remove=api.removePullWatch;
 api.pull=(...a)=>{switchPerf.reads++;return pull(...a)};
 api.addPullWatch=(...a)=>{switchPerf.adds++;return add(...a)};
 api.removePullWatch=(...a)=>{switchPerf.removes++;return remove(...a)};
 const h=Object.getOwnPropertyDescriptor(HTMLElement.prototype,'offsetHeight');
 Object.defineProperty(HTMLElement.prototype,'offsetHeight',{configurable:true,get(){if(this.classList.contains('nautilus-desk__card'))switchPerf.heights++;return h.get.call(this)}});
 window.switchSample=()=>new Promise(resolve=>{
   const started=performance.now(),root=document.querySelector('.nautilus-log-container');
   document.querySelector('.nautilus-log-desk-btn').click();
   const handlerMs=performance.now()-started;
   queueMicrotask(()=>{switchPerf.immediate={mode:root.dataset.nautilusView,chartVisible:!!root.querySelector('svg.nautilus-log-svg')?.getClientRects().length,rawVisible:!!document.getElementById('native-plan-outline').getClientRects().length}});
   requestAnimationFrame(()=>{const firstFrame={ms:performance.now()-started,chartVisible:!!root.querySelector('svg.nautilus-log-svg')?.getClientRects().length};requestAnimationFrame(()=>resolve({ms:performance.now()-started,handlerMs,firstFrame,...switchPerf}))});
 });
 window.resetSwitchPerf=()=>Object.assign(switchPerf,{reads:0,adds:0,removes:0,heights:0,frames:0});
}'''
def run():
 (OUT/'bundle').mkdir();subprocess.check_call(['node','test/chart-renderer-bundle.cjs',str(OUT/'bundle')],cwd=ROOT);f.write_page(f.COMPONENT.read_text())
 report={'cases':[]};errors=[]
 with sync_playwright() as p:
  browser=p.chromium.launch(headless=True)
  try:
   page=browser.new_page(viewport={'width':1200,'height':1000});page.on('pageerror',lambda e:errors.append(str(e)));page.add_init_script('window.IntersectionObserver=undefined')
   for context,count in [('main',8),('main',160),('sidebar',160)]:
    f.load(page,'fold-small'if count==8 else'fold-dense',context,280 if context=='sidebar' else 720,real_desk=True)
    page.wait_for_function('n=>document.querySelectorAll(".nautilus-desk__card[data-preview-state=ready]").length===n',arg=count)
    page.mouse.move(1,1);page.evaluate(INSTALL)
    source=page.evaluate('()=>__chartHarness.sourceRows()')
    if count==8: page.evaluate('()=>window.retainedSwitchRow=document.querySelector("[data-task-uid=fold-1] .rm-desk-tile__text")')
    to_list=page.evaluate('()=>switchSample()');expect(page.locator('#native-plan-outline')).to_be_visible()
    page.evaluate('()=>resetSwitchPerf()')
    page.evaluate('()=>__chartHarness.updateChild("fold-0","{{[[TODO]]}} Updated from native List 3m")')
    if count==8: page.evaluate('()=>__chartHarness.updatePreviewOnly("preview-fold-1","Edited only inside native List")')
    f.settle_renderer(page);f.settle_renderer(page)
    hidden=page.evaluate('()=>({...switchPerf})')
    page.evaluate('()=>resetSwitchPerf()')
    started=page.evaluate('performance.now()');to_chart=page.evaluate('()=>switchSample()')
    page.wait_for_function('n=>switchPerf.adds>=n&&document.querySelectorAll(".nautilus-desk__card[data-preview-state=ready]").length===n',arg=count)
    all_ready=page.evaluate('()=>({ms:performance.now(),...switchPerf})');all_ready['ms']-=started
    result={'context':context,'cards':count,'toList':to_list,'hiddenUpdate':hidden,'toChart':to_chart,'allPreviewsReady':all_ready}
    report['cases'].append(result);(OUT/'result.json').write_text(json.dumps(report,indent=2));print(json.dumps(result),flush=True)
    if not os.environ.get('NAUTILUS_SWITCH_PERF_RECORD_ONLY'):
     assert not to_list['immediate']['chartVisible'], 'List switch left the old chart in flow until a Reagent frame.'
     assert hidden['heights']==0 and hidden['reads']==0, 'Hidden Desk still measured or projected cards on a native List edit.'
     assert all_ready['heights']<=count*8, 'Preview layout work still scales quadratically with card count.'
     if count==160: assert all_ready['frames']<count*.6, 'Preview admission still spends one animation frame per card.'
    if count==8:
     expect(page.locator('[data-task-uid=fold-1] .rm-desk-tile__text')).to_have_text('Edited only inside native List')
     assert page.evaluate('()=>retainedSwitchRow===document.querySelector("[data-task-uid=fold-1] .rm-desk-tile__text")')
     result['childOnlyEditRevalidatedWithRetainedDom']=True
     # Native fold is stronger than List parking: retire its buffer even if
     # the session was already hidden, then restore List without changing mode.
     page.locator('.nautilus-log-desk-btn').click()
     page.locator('#native-plan-caret').click()
     page.wait_for_function('()=>document.querySelectorAll(".nautilus-desk__card .rm-desk-tile__text").length===0')
     page.locator('#native-plan-caret').click()
     expect(page.locator('.nautilus-log-container')).to_have_attribute('data-nautilus-view','list')
     page.locator('.nautilus-log-desk-btn').click()
     page.wait_for_function('n=>document.querySelectorAll(".nautilus-desk__card[data-preview-state=ready]").length===n',arg=count)
     result['nativeFoldRetiresParkedBuffer']=True
     page.get_by_role('textbox',name='Search Desk',exact=True).fill('retained')
     expect(page.locator('.nautilus-desk__card')).to_have_count(7)
     page.locator('.nautilus-log-desk-btn').click()
     page.evaluate('''()=>{__chartHarness.updatePreviewOnly('preview-fold-2','Search-only modification');const api=roamAlphaAPI.data,add=api.addPullWatch;const held=[];api.addPullWatch=(...args)=>new Promise(resolve=>held.push(()=>{add(...args);resolve()}));window.releaseSwitchSearch=()=>{api.addPullWatch=add;held.splice(0).forEach(release=>release())}}''')
     page.locator('.nautilus-log-desk-btn').click()
     expect(page.locator('.nautilus-desk__card')).to_have_count(0)
     expect(page.locator('.nautilus-desk .rm-desk-card__missing')).to_have_text('Searching...')
     page.evaluate('()=>releaseSwitchSearch()')
     expect(page.locator('.nautilus-desk__card')).to_have_count(6)
     result['parkedSearchWaitsForFreshAdmission']=True
    assert f.state(page)['writes']==0
    rows=page.evaluate('()=>__chartHarness.sourceRows()');assert len(rows)==len(source)and rows[0]['block/string']=='{{[[TODO]]}} Updated from native List 3m'
    page.evaluate('()=>__chartHarness.unmount()')
   report['pageErrors']=errors
  finally:browser.close()
 assert not errors,errors
 (OUT/'result.json').write_text(json.dumps(report,indent=2));print(f'PASS: bounded view switch and hidden Desk work; {OUT}')
if __name__=='__main__':run()
