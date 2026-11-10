#!/usr/bin/env python3
"""View hints stay legible above native embed layers in both switch states."""
import importlib.util
import json
import os
import subprocess
from pathlib import Path
from PIL import Image
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[1]
os.environ['NAUTILUS_RENDERER_OUT']=os.environ.get('NAUTILUS_HINT_OUT','/tmp/nautilus-view-hints')
spec=importlib.util.spec_from_file_location('hint_fixture',ROOT/'test/chart-renderer.py')
f=importlib.util.module_from_spec(spec);spec.loader.exec_module(f)
OUT=f.OUT


def visible_hint(page, message, name):
    switch=page.locator('.nautilus-log-desk-btn')
    tooltip=page.get_by_role('tooltip')
    if not tooltip.count():
        # Diagnose the original CSS hint as well: it already contains the right
        # text, but the later native outline paints over its background.
        page.wait_for_function('()=>document.querySelector("[role=tooltip]")||(getComputedStyle(document.querySelector(".nautilus-log-desk-btn"),"::after").display!=="none"&&getComputedStyle(document.querySelector(".nautilus-log-desk-btn"),"::after").opacity==="1")')
        if not tooltip.count():
            sample=switch.evaluate('''e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e,'::after');
              const w=parseFloat(s.width)+parseFloat(s.paddingLeft)+parseFloat(s.paddingRight)+parseFloat(s.borderLeftWidth)+parseFloat(s.borderRightWidth);
              return {x:r.right-w+4,y:r.top+parseFloat(s.top)+4,content:s.content,opacity:s.opacity};}''')
            shot=OUT/f'{name}-before.png';page.screenshot(path=str(shot))
            pixel=Image.open(shot).convert('RGB').getpixel((int(sample['x']),int(sample['y'])))
            print(json.dumps({'cssHint':sample,'visiblePixel':pixel,'nativeBackground':[234,241,245]}),flush=True)
            assert pixel!=(234,241,245), 'The hint text exists, but the native embed paints over it.'
    expect(tooltip).to_have_text(message)
    expect(tooltip).to_be_visible()
    assert tooltip.evaluate('e=>e.parentElement===document.body')
    assert switch.get_attribute('aria-describedby').split().count(tooltip.get_attribute('id'))==1
    assert tooltip.evaluate('e=>getComputedStyle(e).pointerEvents==="none"')
    # Temporarily enable hit testing solely to prove the label is actually above
    # its neighbours. Restore pointer transparency without dispatching a click.
    assert tooltip.evaluate('''e=>{const r=e.getBoundingClientRect(),before=e.style.pointerEvents;
      e.style.pointerEvents='auto';const hit=document.elementFromPoint(r.x+4,r.y+4)===e;
      e.style.pointerEvents=before;return hit;}''')
    box=tooltip.bounding_box();viewport=page.viewport_size
    assert box['x']>=11.5 and box['x']+box['width']<=viewport['width']-11.5
    assert box['y']>=11.5 and box['y']+box['height']<=viewport['height']-11.5
    return box


def run():
    (OUT/'bundle').mkdir()
    subprocess.check_call(['node','test/chart-renderer-bundle.cjs',str(OUT/'bundle')],cwd=ROOT)
    f.write_page(f.COMPONENT.read_text())
    errors=[];report={'cases':[]}
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True)
        try:
            page=browser.new_page(viewport={'width':1120,'height':1000})
            page.on('pageerror',lambda error:errors.append(str(error)))
            for context,width,language,dark in [('main',720,'en',False),('sidebar',280,'en',False),('embed',520,'zh',True)]:
                f.load(page,'mixed',context,width,lang=language,real_desk=True)
                page.locator('body').evaluate('(e,d)=>e.classList.toggle("bp3-dark",d)',dark)
                page.add_style_tag(content='#native-plan-outline{position:relative;z-index:20;min-height:240px;background:rgb(234,241,245)}#following-sentinel{height:1800px}')
                switch=page.locator('.nautilus-log-desk-btn');root=page.locator('.nautilus-log-container')
                to_chart='切换到图表' if language=='zh' else 'Switch to chart view'
                to_list='切换到列表' if language=='zh' else 'Switch to list view'
                baseline=switch.bounding_box()
                switch.click();expect(root).to_have_attribute('data-nautilus-view','list')
                switch.hover();visible_hint(page,to_chart,context)
                page.screenshot(path=str(OUT/f'{context}-list.png'))
                switch.click();visible_hint(page,to_list,context)
                assert switch.bounding_box()==baseline
                switch.press('Space');visible_hint(page,to_chart,context)
                assert switch.bounding_box()==baseline
                switch.press('Escape');expect(page.get_by_role('tooltip')).to_have_count(0)
                page.mouse.move(1,1);switch.evaluate('e=>e.blur()')
                switch.focus();visible_hint(page,to_chart,context)
                switch.press('Escape');expect(page.get_by_role('tooltip')).to_have_count(0)
                assert switch.get_attribute('aria-describedby') is None
                switch.evaluate('e=>e.blur()')
                # Near the viewport top, flip below the anchor. It must still
                # remain above the native outline rather than getting clipped.
                page.locator('#renderer-shell').evaluate('e=>e.style.marginTop="0px"')
                switch.hover();box=visible_hint(page,to_chart,context)
                assert box['y']>=switch.bounding_box()['y']+32+8
                switch.press('ArrowRight')
                expect(switch).to_be_focused()
                page.locator('#renderer-shell').evaluate('e=>e.style.marginTop="600px"')
                page.evaluate('()=>{scrollTo(0,500);dispatchEvent(new Event("scroll"))}')
                f.settle_renderer(page);visible_hint(page,to_chart,context)
                # Native folding/unmount cancels pending hints and body layers.
                page.locator('#native-plan-caret').evaluate('e=>e.click()')
                expect(page.get_by_role('tooltip')).to_have_count(0)
                page.locator('#native-plan-caret').evaluate('e=>e.click()')
                switch.hover();visible_hint(page,to_chart,context)
                page.evaluate('()=>__chartHarness.unmount()')
                expect(page.get_by_role('tooltip')).to_have_count(0)
                assert f.state(page)['writes']==0
                report['cases'].append({'context':context,'language':language,'dark':dark,'bothStates':True,'nativeOcclusion':False,'viewportFlip':True,'anchorUnchanged':True,'cleanup':True})
        finally:browser.close()
    assert not errors,errors
    report['pageErrors']=errors
    (OUT/'result.json').write_text(json.dumps(report,indent=2))
    print(f'PASS: both view hints, native overlap, keyboard, edge flip, scroll and cleanup; {OUT}')


if __name__=='__main__':run()
