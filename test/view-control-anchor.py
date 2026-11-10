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
                    native_gap=0 if calendar else (16 if context=='embed' else 8)
                    page.add_style_tag(content='''#native-plan-outline{position:relative}
                      .fixture-native-embed{position:relative;min-height:56px;margin-top:var(--fixture-native-gap);background:#eaf1f5}
                      .fixture-embed-tools{display:flex;position:absolute;right:0;top:2px;width:56px;height:28px;background:#eaf1f5;z-index:20;border-radius:4px;opacity:0;pointer-events:none}
                      .fixture-native-embed:hover>.fixture-embed-tools,.fixture-embed-tools:focus-within{opacity:1;pointer-events:auto;top:-28px}
                      .fixture-embed-tools button{width:28px;height:28px;border:0;padding:0;background:transparent}''')
                    page.evaluate('''gap=>{window.nativeEmbedClicks=0;const embed=document.createElement('div');embed.className='rm-embed-container fixture-native-embed';
                      embed.style.setProperty('--fixture-native-gap',gap+'px');
                      const tools=document.createElement('div');tools.className='rm-embed-settings fixture-embed-tools';
                      tools.innerHTML='<button aria-label="Native embed menu">⋯</button><button aria-label="Native embed edit">✎</button>';
                      tools.addEventListener('click',()=>nativeEmbedClicks++);embed.append(tools);document.getElementById('native-plan-outline').prepend(embed);}''',native_gap)
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
                        case={'context':context,'width':width,'language':language,'dark':dark,'calendar':calendar,'nativeGap':native_gap,'baseline':baseline,'samples':samples}
                        (OUT/'current-case.json').write_text(json.dumps(case,indent=2))
                        assert all(abs(delta[key])<=.25 for delta in deltas for key in delta), f'Controls moved after switching: {case}'
                        assert page.evaluate('()=>anchorSwitch===document.querySelector("#chart-root .nautilus-log-desk-btn")')
                        assert page.evaluate('p=>document.elementFromPoint(p.x,p.y)?.closest(".nautilus-log-desk-btn")===anchorSwitch',{'x':reference['centerX'],'y':reference['centerY']})
                        assert switch.inner_text().strip()==''
                        if expected=='list':
                            page.locator('.fixture-native-embed').hover()
                            tools=page.locator('.fixture-embed-tools');expect(tools).to_be_visible()
                            f.settle_renderer(page);f.settle_renderer(page)
                            bar=tools.bounding_box()
                            clearance=bar['y']-max(b['y']+b['height'] for b in current)
                            sample['nativeToolbarClearance']=round(clearance,3)
                            sample['listPadding']=float(root.evaluate('e=>getComputedStyle(e).paddingBottom').removesuffix('px'))
                            assert 1.75<=clearance<=2.75, f'Native embed tools must be close and disjoint: {case}'
                            expect(root).to_have_attribute('data-nautilus-plan-has-children','true')
                            assert page.evaluate('''points=>points.every(p=>{
                              const b=document.elementFromPoint(p.centerX,p.centerY)?.closest('button');
                              return b?.closest('.nautilus-log-controls-top')&&b.getBoundingClientRect().y===p.y;
                            })''',current)
                            tools.get_by_role('button',name='Native embed menu').press('Enter')
                            tools.get_by_role('button',name='Native embed edit').click()
                            if round_index==0:page.screenshot(path=str(OUT/'screenshots'/f'{context}-{width}-{dark}-{calendar}-clearance.png'),clip={'x':0,'y':0,'width':1000,'height':280})
                        if round_index<2:root.locator('.nautilus-log-header').screenshot(path=str(OUT/'screenshots'/f'{context}-{width}-{language}-{dark}-{calendar}-{expected}.png'))
                    # Folding List must remove its reserved space as well as
                    # restoring the selected view with the same button anchor.
                    switch.click();expect(root).to_have_attribute('data-nautilus-view','list')
                    page.wait_for_function('()=>document.querySelector(".nautilus-log-container").style.getPropertyValue("--nautilus-log-list-clearance")!==""')
                    # Existing native spacing can change after a responsive
                    # reflow; credit it without changing the button anchor.
                    page.locator('.fixture-native-embed').evaluate('e=>e.style.setProperty("--fixture-native-gap","12px")')
                    page.wait_for_function('()=>parseFloat(getComputedStyle(document.querySelector(".nautilus-log-container")).paddingBottom)===18')
                    value=root.evaluate('e=>e.style.getPropertyValue("--nautilus-log-list-clearance")')
                    f.settle_renderer(page);f.settle_renderer(page)
                    assert root.evaluate('e=>e.style.getPropertyValue("--nautilus-log-list-clearance")')==value
                    page.locator('#native-plan-caret').click();expect(root).to_be_hidden()
                    assert root.evaluate('e=>e.getBoundingClientRect().height')==0
                    page.locator('#native-plan-caret').click();f.settle_renderer(page)
                    expect(root).to_have_attribute('data-nautilus-view','list')
                    restored=measure(page)
                    assert all(abs(a['top']-b['top'])<=.25 and abs(a['right']-b['right'])<=.25 for a,b in zip(baseline,restored))
                    switch.click()
                    assert page.evaluate('()=>nativeEmbedClicks')==6
                    assert f.state(page)['writes']==0
                    report['cases'].append(case)
            f.load(page,'mixed',real_desk=True)
            page.locator('.nautilus-log-desk-btn').click()
            page.wait_for_function('()=>parseFloat(getComputedStyle(document.querySelector(".nautilus-log-container")).paddingBottom)===8')
            report['plainListGap']=8
            f.load(page,'empty',real_desk=True)
            page.locator('.nautilus-log-desk-btn').click()
            empty=page.locator('.nautilus-log-container')
            expect(empty).to_have_attribute('data-nautilus-view','list')
            expect(empty).to_have_attribute('data-nautilus-plan-has-children','false')
            assert empty.evaluate('e=>getComputedStyle(e).paddingBottom')=='0px'
            report['emptyListHasNoClearance']=True
            report['pageErrors']=errors
        finally:browser.close()
    assert not errors,errors
    (OUT/'result.json').write_text(json.dumps(report,indent=2))
    print(f'PASS: shared control anchor, native embed clearance, same-point clicks, empty/fold cleanup; {OUT}')


if __name__=='__main__':run()
