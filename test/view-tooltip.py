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


def visible_hint(page, message, name, control=None):
    switch=control if control is not None else page.locator('.nautilus-log-desk-btn')
    tooltip=page.get_by_role('tooltip')
    if not tooltip.count():
        # Diagnose the original CSS hint as well: it already contains the right
        # text, but the later native outline paints over its background.
        page.wait_for_function('e=>document.querySelector("[role=tooltip]")||(getComputedStyle(e,"::after").display!=="none"&&getComputedStyle(e,"::after").opacity==="1")',arg=switch.element_handle())
        if not tooltip.count():
            sample=switch.evaluate('''e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e,'::after');
              const w=parseFloat(s.width)+parseFloat(s.paddingLeft)+parseFloat(s.paddingRight)+parseFloat(s.borderLeftWidth)+parseFloat(s.borderRightWidth);
              const h=parseFloat(s.height)+parseFloat(s.paddingTop)+parseFloat(s.paddingBottom)+parseFloat(s.borderTopWidth)+parseFloat(s.borderBottomWidth);
              return {x:r.right-w+4,y:r.top+parseFloat(s.top)+h-4,content:s.content,opacity:s.opacity};}''')
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
                page.locator('#renderer-shell').evaluate('e=>e.style.marginTop="160px"')
                if language=='zh':page.locator('.nautilus-log-container').evaluate('e=>e.style.setProperty("--nl-exec-font-family","serif")')
                help_style=page.locator('.nautilus-log-help-btn').evaluate('''e=>{const s=getComputedStyle(e,'::after');return {
                  gap:9,
                  paint:[s.backgroundColor,s.color,s.borderTopColor,s.fontSize,s.fontWeight,s.paddingTop,s.paddingLeft,s.fontFamily]};}''')
                page.add_style_tag(content='#native-plan-outline{position:relative;z-index:20;min-height:240px;background:rgb(234,241,245)}#following-sentinel{height:1800px}')
                switch=page.locator('.nautilus-log-desk-btn');root=page.locator('.nautilus-log-container')
                to_chart='切换到图表' if language=='zh' else 'Switch to chart view'
                to_list='切换到列表' if language=='zh' else 'Switch to list view'
                baseline=switch.bounding_box()
                switch.click();expect(root).to_have_attribute('data-nautilus-view','list')
                help_button=page.locator('.nautilus-log-help-btn')
                help_message='帮助' if language=='zh' else 'Help'
                help_button.hover();help_box=visible_hint(page,help_message,context+'-help',help_button)
                assert abs(help_box['y']-help_button.bounding_box()['y']-32-9)<.25
                assert help_button.evaluate('e=>getComputedStyle(e,"::after").display')=='none'
                page.screenshot(path=str(OUT/f'{context}-help-list.png'))
                help_button.click();expect(page.get_by_role('dialog',name='Nautilus Log',exact=True)).to_be_visible()
                expect(page.get_by_role('tooltip')).to_have_count(0)
                page.keyboard.press('Escape')
                visible_hint(page,help_message,context+'-help-focus',help_button)
                switch.hover();visible_hint(page,to_chart,context)
                # Leaving a hovered sibling restores the actual keyboard-focus
                # owner rather than stealing or dropping its Help hint.
                page.mouse.move(1,1);visible_hint(page,help_message,context+'-help-restored',help_button)
                switch.hover();box=visible_hint(page,to_chart,context)
                assert abs(box['y']-(switch.bounding_box()['y']+32+help_style['gap']))<.25
                tooltip=page.get_by_role('tooltip')
                assert tooltip.get_attribute('data-placement')=='below'
                assert tooltip.evaluate('''e=>{const s=getComputedStyle(e);return [s.backgroundColor,s.color,s.borderTopColor,s.fontSize,s.fontWeight,s.paddingTop,s.paddingLeft,s.fontFamily]}''')==help_style['paint']
                assert tooltip.evaluate('e=>getComputedStyle(e,"::before").content!=="none"&&getComputedStyle(e,"::before").borderLeftWidth==="1px"')
                page.screenshot(path=str(OUT/f'{context}-list.png'))
                switch.click();box=visible_hint(page,to_list,context)
                assert abs(box['y']-(switch.bounding_box()['y']+32+help_style['gap']))<.25
                assert switch.bounding_box()==baseline
                switch.press('Space');visible_hint(page,to_chart,context)
                assert switch.bounding_box()==baseline
                switch.press('Escape');expect(page.get_by_role('tooltip')).to_have_count(0)
                idle_listeners=len(page.evaluate('()=>__chartHarness.activeClockListeners()'))
                page.mouse.move(1,1);switch.evaluate('e=>e.blur()')
                switch.focus();visible_hint(page,to_chart,context)
                assert len(page.evaluate('()=>__chartHarness.activeClockListeners()'))==idle_listeners+1
                switch.press('Escape');expect(page.get_by_role('tooltip')).to_have_count(0)
                assert len(page.evaluate('()=>__chartHarness.activeClockListeners()'))==idle_listeners
                assert switch.get_attribute('aria-describedby') is None
                switch.evaluate('e=>e.blur()')
                # Match Help's below placement even when there is room above.
                # Only a viewport-bottom collision may flip the hint upwards.
                page.locator('#renderer-shell').evaluate('e=>e.style.marginTop="0px"')
                switch.hover();box=visible_hint(page,to_chart,context)
                assert box['y']>=switch.bounding_box()['y']+32+8
                page.locator('#renderer-shell').evaluate('e=>e.style.marginTop="940px"')
                page.evaluate('()=>scrollTo(0,0)')
                switch.hover();box=visible_hint(page,to_chart,context)
                assert box['y']+box['height']<=switch.bounding_box()['y']-8
                assert page.get_by_role('tooltip').get_attribute('data-placement')=='above'
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
                report['cases'].append({'context':context,'language':language,'dark':dark,'bothStates':True,'sharedHelpHint':True,'helpStyleAndBelowPlacement':True,'nativeOcclusion':False,'viewportFlip':True,'anchorUnchanged':True,'cleanup':True})
            # Calendar shares the same label owner, including multiline copy,
            # live attribute changes and popover suppression.
            f.load(page,'mixed',real_desk=True)
            page.evaluate('()=>{Object.assign(nautilusLogR3.settings,{"google-calendar-enabled":true,"google-calendar-configured":true});dispatchEvent(new Event("nautilus-log:settings-changed"));nautilusLogR3.syncCalendarPlan=()=>new Promise(r=>window.resolveHintCalendar=r)}')
            calendar=page.locator('.nautilus-log-calendar-btn');calendar.hover()
            visible_hint(page,calendar.get_attribute('data-nautilus-tooltip'),'calendar',calendar)
            calendar.evaluate('e=>e.setAttribute("data-nautilus-tooltip","Calendar pending\\nKeep local edits")')
            visible_hint(page,'Calendar pending\nKeep local edits','calendar-updated',calendar)
            assert page.get_by_role('tooltip').evaluate('e=>getComputedStyle(e).whiteSpace')=='pre-line'
            calendar.click();expect(calendar).to_be_disabled()
            page.evaluate('()=>resolveHintCalendar({created:0,updated:0,removed:0,skipped:1})')
            expect(calendar).to_have_attribute('aria-expanded','true')
            expect(page.get_by_role('tooltip')).to_have_count(0)
            calendar.press('Escape');expect(calendar).to_have_attribute('aria-expanded','false')
            assert calendar.evaluate('e=>e.matches(":hover")'), 'The pointer must remain stationary on Calendar.'
            expect(page.get_by_role('tooltip')).to_have_text(calendar.get_attribute('data-nautilus-tooltip'),timeout=1500)
            # Escape dismisses a label after the disclosure has closed, but
            # closing the disclosure itself must not dismiss the next label.
            calendar.press('Escape');expect(page.get_by_role('tooltip')).to_have_count(0)
            page.mouse.move(1,1);calendar.hover()
            visible_hint(page,calendar.get_attribute('data-nautilus-tooltip'),'calendar-return',calendar)
            page.evaluate('()=>__chartHarness.unmount()');expect(page.get_by_role('tooltip')).to_have_count(0)
            report['sharedCalendarHint']=True

            # A parent renderer must not adopt or clean up a nested renderer's
            # switch. Use real nested DOM ownership without another graph pull.
            f.load(page,'mixed',real_desk=True)
            page.locator('.nautilus-log-desk-btn').press('Escape');page.mouse.move(1,1)
            page.evaluate('''()=>{const nested=document.createElement('div');nested.className='nautilus-log-container';nested.id='nested-hint-owner';
              nested.innerHTML='<div class="nautilus-log-controls-top"><button class="nautilus-log-desk-btn" data-nautilus-tooltip="Nested owner">Nested view</button></div>';
              document.querySelector('.nautilus-log-container').append(nested);}''')
            nested=page.locator('#nested-hint-owner button');nested.hover();nested.press('ArrowRight')
            assert nested.get_attribute('data-nautilus-floating-hint') is None
            expect(page.get_by_role('tooltip')).to_have_count(0)
            nested.evaluate('e=>{e.setAttribute("data-nautilus-floating-hint","true");window.savedNestedHint=e;}')
            page.evaluate('()=>__chartHarness.unmount()')
            assert page.evaluate('()=>savedNestedHint.getAttribute("data-nautilus-floating-hint")')=='true'
            report['nestedOwnerIgnored']=True
        finally:browser.close()
    assert not errors,errors
    report['pageErrors']=errors
    (OUT/'result.json').write_text(json.dumps(report,indent=2))
    print(f'PASS: both view hints, native overlap, keyboard, edge flip, scroll and cleanup; {OUT}')


if __name__=='__main__':run()
