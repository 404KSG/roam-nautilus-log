#!/usr/bin/env python3
"""The complete control row keeps one anchor across Chart/List transitions."""
import importlib.util
import json
import os
import subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[1]
os.environ['NAUTILUS_RENDERER_OUT']=os.environ.get('NAUTILUS_ANCHOR_OUT','/tmp/nautilus-control-anchor')
spec=importlib.util.spec_from_file_location('anchor_fixture',ROOT/'test/chart-renderer.py')
f=importlib.util.module_from_spec(spec);spec.loader.exec_module(f)
OUT=f.OUT


def measure(page):
    return page.locator('#chart-root .nautilus-log-container').evaluate('''root=>{
      const r=root.getBoundingClientRect(),owner=root.closest('.roam-block-container').getBoundingClientRect();
      return [...root.querySelectorAll('.nautilus-log-controls-top button')].map(button=>{
        const b=button.getBoundingClientRect();return {kind:button.matches('[role=switch]')?'switch':button.matches('.nautilus-log-calendar-btn')?'calendar':'help',
          x:b.x,y:b.y,width:b.width,height:b.height,top:b.top-r.top,right:r.right-b.right,ownerTop:b.top-owner.top,
          centerX:b.x+b.width/2,centerY:b.y+b.height/2};
      });
    }''')


def run():
    (OUT/'bundle').mkdir();(OUT/'screenshots').mkdir()
    subprocess.check_call(['node','test/chart-renderer-bundle.cjs',str(OUT/'bundle')],cwd=ROOT)
    f.write_page(f.COMPONENT.read_text())
    report={'cases':[]};errors=[]
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True)
        try:
            page=browser.new_page(viewport={'width':1280,'height':1100})
            page.on('pageerror',lambda error:errors.append(str(error)))
            for context,width,language,dark in [('main',720,'en',False),('sidebar',280,'en',False),('embed',520,'zh',False),('main',720,'en',True)]:
                for calendar in [False,True]:
                    f.load(page,'mixed',context,width,lang=language,real_desk=True)
                    page.locator('body').evaluate('(e,d)=>e.classList.toggle("bp3-dark",d)',dark)
                    # Keep the scroll origin stable even if the view becomes
                    # shorter; viewport clamping is not a control-layout test.
                    page.locator('#following-sentinel').evaluate('e=>e.style.height="1800px"')
                    page.evaluate('enabled=>{Object.assign(nautilusLogR3.settings,{"google-calendar-enabled":enabled,"google-calendar-configured":enabled});dispatchEvent(new Event("nautilus-log:settings-changed"))}',calendar)
                    f.settle_renderer(page)
                    root=page.locator('#chart-root .nautilus-log-container');switch=root.locator('.nautilus-log-desk-btn')
                    page.mouse.move(1,1)
                    baseline=measure(page)
                    assert [b['kind'] for b in baseline]==(['help','calendar','switch'] if calendar else ['help','switch'])
                    reference=baseline[-1]
                    page.evaluate('()=>window.anchorSwitch=document.querySelector("#chart-root .nautilus-log-desk-btn")')
                    samples=[]
                    for round_index in range(6):
                        page.mouse.click(reference['centerX'],reference['centerY'])
                        f.settle_renderer(page)
                        expected='list' if round_index%2==0 else 'chart'
                        expect(root).to_have_attribute('data-nautilus-view',expected)
                        current=measure(page)
                        sample={'mode':expected,'controls':current};samples.append(sample)
                        deltas=[{key:round(after[key]-before[key],3) for key in ['x','y','top','right','ownerTop']} for before,after in zip(baseline,current)]
                        sample['deltas']=deltas
                        case={'context':context,'width':width,'language':language,'dark':dark,'calendar':calendar,'baseline':baseline,'samples':samples}
                        (OUT/'current-case.json').write_text(json.dumps(case,indent=2))
                        assert all(abs(delta[key])<=.25 for delta in deltas for key in delta), f'Controls moved after switching: {case}'
                        assert page.evaluate('()=>anchorSwitch===document.querySelector("#chart-root .nautilus-log-desk-btn")')
                        assert page.evaluate('p=>document.elementFromPoint(p.x,p.y)?.closest(".nautilus-log-desk-btn")===anchorSwitch',{'x':reference['centerX'],'y':reference['centerY']})
                        assert switch.inner_text().strip()==''
                        if round_index<2:root.locator('.nautilus-log-header').screenshot(path=str(OUT/'screenshots'/f'{context}-{width}-{language}-{dark}-{calendar}-{expected}.png'))
                    # Each control remains on the same row when native folding
                    # is restored, and the compact list keeps no ghost chart.
                    page.locator('#native-plan-caret').click();expect(root).to_be_hidden()
                    page.locator('#native-plan-caret').click();f.settle_renderer(page)
                    restored=measure(page)
                    assert all(abs(a['top']-b['top'])<=.25 and abs(a['right']-b['right'])<=.25 for a,b in zip(baseline,restored))
                    assert f.state(page)['writes']==0
                    report['cases'].append(case)
            report['pageErrors']=errors
        finally:browser.close()
    assert not errors,errors
    (OUT/'result.json').write_text(json.dumps(report,indent=2))
    print(f'PASS: same control anchor, repeated same-point clicks, Calendar and native-fold restoration; {OUT}')


if __name__=='__main__':run()
