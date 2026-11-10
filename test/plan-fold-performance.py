#!/usr/bin/env python3
"""Native fold first-frame budget with the exact renderer and synthetic graphs."""
import importlib.util
import json
import os
import subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[1]
os.environ['NAUTILUS_RENDERER_OUT']=os.environ.get('NAUTILUS_FOLD_PERF_OUT','/tmp/nautilus-fold-performance')
spec=importlib.util.spec_from_file_location('fold_performance_fixture',ROOT/'test/chart-renderer.py')
f=importlib.util.module_from_spec(spec);spec.loader.exec_module(f)
OUT=f.OUT

INSTALL='''cost=>{
 const owner=document.getElementById('native-plan-owner'), root=owner.querySelector('.nautilus-log-container');
 const api=roamAlphaAPI.data, remove=api.removePullWatch.bind(api), query=owner.querySelectorAll.bind(owner);
 window.foldProbe={cost,removes:0,scans:0,burst:0,maxBurst:0,events:[]};
 api.removePullWatch=(...args)=>{if(!foldProbe.burst)setTimeout(()=>foldProbe.burst=0,0);foldProbe.burst++;foldProbe.maxBurst=Math.max(foldProbe.maxBurst,foldProbe.burst);foldProbe.removes++;const t=performance.now();while(performance.now()-t<cost){};return remove(...args)};
 owner.querySelectorAll=selector=>{if(selector==='.rm-caret')foldProbe.scans++;return query(selector)};
 const control=document.createElement('section');control.id='ordinary-native-control';
 control.innerHTML='<button>Native control</button><div style="height:150px">Ordinary native children</div>';
 control.firstChild.onclick=()=>{control.lastChild.hidden=!control.lastChild.hidden};document.body.append(control);
 window.measureFold=selector=>new Promise(resolve=>{
   const beforeRemoves=foldProbe.removes, beforeScans=foldProbe.scans, started=performance.now();
   document.querySelector(selector).click();
   requestAnimationFrame(()=>{
     const first={ms:performance.now()-started,removes:foldProbe.removes-beforeRemoves,scans:foldProbe.scans-beforeScans,
       hidden:!root.getClientRects().length,focusLayers:document.querySelectorAll('.nautilus-desk__focus-layer').length};
     requestAnimationFrame(()=>resolve({...first,twoFrames:performance.now()-started}));
   });
 });
}'''


def run():
    (OUT/'bundle').mkdir()
    subprocess.check_call(['node','test/chart-renderer-bundle.cjs',str(OUT/'bundle')],cwd=ROOT)
    f.write_page(f.COMPONENT.read_text());report={'cases':[]};errors=[]
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True)
        try:
            page=browser.new_page(viewport={'width':1200,'height':1000})
            page.on('pageerror',lambda e:errors.append(str(e)))
            page.add_init_script('window.IntersectionObserver=undefined')
            for context,count,cost in [('main',8,0),('main',160,0),('main',160,.4),('sidebar',160,.4)]:
                f.load(page,'fold-small' if count==8 else 'fold-dense',context,280 if context=='sidebar' else 720,real_desk=True)
                page.wait_for_function('n=>document.querySelectorAll(".nautilus-desk__card[data-preview-state=ready]").length===n',arg=count)
                page.mouse.move(1,1);f.settle_renderer(page)
                source=page.evaluate('()=>__chartHarness.sourceRows()')
                page.evaluate(INSTALL,cost)
                native=page.evaluate('()=>measureFold("#ordinary-native-control button")')
                collapsed=page.evaluate('()=>measureFold("#native-plan-caret")')
                case={'context':context,'cards':count,'simulatedRemoveCostMs':cost,'native':native,'collapse':collapsed}
                report['cases'].append(case);(OUT/'result.json').write_text(json.dumps(report,indent=2));print(json.dumps(case),flush=True)
                assert collapsed['hidden'] and collapsed['focusLayers']==0
                # Actual native removal cost must not scale the first collapsed
                # frame. The zero-cost and injected cases are reported separately.
                if not os.environ.get('NAUTILUS_FOLD_PERF_RECORD_ONLY'):
                    assert collapsed['removes']==0, 'Native subscription teardown blocked the first collapsed frame.'
                    assert collapsed['scans']==0, 'Folding scanned the entire native subtree for its own caret.'
                    if cost: assert collapsed['ms']<=native['ms']+24, 'Fold exceeded the ordinary native frame budget.'
                page.wait_for_function('n=>foldProbe.removes>=n',arg=count*(2 if count==8 else 1))
                case['maxNativeRemovalBatch']=page.evaluate('foldProbe.maxBurst')
                if cost and not os.environ.get('NAUTILUS_FOLD_PERF_RECORD_ONLY'):
                    assert case['maxNativeRemovalBatch']<=20, 'Cleanup monopolized the next input task.'
                page.locator('#native-plan-caret').click()
                expect(page.locator('.nautilus-log-container')).to_be_visible()
                expect(page.locator('svg.nautilus-log-svg')).to_be_visible()
                if count==8:
                    # Reopen before retirement starts, then allow every old job
                    # to run. They must not clear the resumed cards or draft UI.
                    page.evaluate('''()=>new Promise(r=>{document.getElementById('native-plan-caret').click();requestAnimationFrame(()=>{document.getElementById('native-plan-caret').click();requestAnimationFrame(r)})})''')
                    expect(page.locator('.nautilus-log-container')).to_be_visible()
                    page.wait_for_function('n=>document.querySelectorAll(".nautilus-desk__card[data-preview-state=ready]").length===n',arg=count)
                    assert page.locator('.nautilus-desk__card .rm-desk-tile__text').count()>0
                    case['rapidReopenSurvivedRetiredJobs']=True
                assert page.evaluate('()=>__chartHarness.sourceRows()')==source and f.state(page)['writes']==0
                page.evaluate('()=>__chartHarness.unmount()')
            report['pageErrors']=errors
        finally:browser.close()
    (OUT/'result.json').write_text(json.dumps(report,indent=2))
    assert not errors,errors
    print(f'PASS: native fold reaches its first frame before bulk teardown; {OUT}')

if __name__=='__main__':run()
