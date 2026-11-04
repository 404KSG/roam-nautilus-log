#!/usr/bin/env python3
"""Original Blueprint glyphs with short toolbar feedback on the exact renderer.

Graph data and Calendar responses are fixtures. No host login or real writes.
"""
import importlib.util
import json
import os
import re
import subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
os.environ['NAUTILUS_RENDERER_OUT'] = os.environ.get('NAUTILUS_QUIET_OUT', '/tmp/nautilus-native-toolbar')
spec = importlib.util.spec_from_file_location('native_toolbar_fixture', ROOT / 'test/chart-renderer.py')
f = importlib.util.module_from_spec(spec);spec.loader.exec_module(f)
OUT = f.OUT
ICONS = json.loads((ROOT / 'test/fixtures/blueprint-toolbar-icons.json').read_text())
SELECTORS = ['.nautilus-log-desk-btn', '.nautilus-log-help-btn', '.nautilus-log-collapse-btn']


def settle(page):
    f.settle_renderer(page)
    page.wait_for_function('''()=>[...document.querySelectorAll('.nautilus-log-controls-top *')]
      .every(e=>e.getAnimations().every(a=>a.playState==='finished'))''')


def rgb(value, background=(255,255,255)):
    parts=[float(x) for x in re.findall(r'[\d.]+',value)]
    alpha=parts[3] if len(parts)==4 else 1
    return tuple(parts[i]*alpha+background[i]*(1-alpha) for i in range(3))


def contrast(a,b):
    def luminance(color):
        values=[v/255 for v in color]
        values=[v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in values]
        return sum(v*w for v,w in zip(values,[.2126,.7152,.0722]))
    low,high=sorted([luminance(a),luminance(b)])
    return (high+.05)/(low+.05)


def glyph(page,selector):
    return page.locator(selector).evaluate('''button=>{
      const svg=button.querySelector('svg'),path=svg.querySelector('path'),css=getComputedStyle(path);
      const native=svg.cloneNode(true);native.style.cssText='position:fixed;left:-9999px;opacity:0;pointer-events:none';
      document.body.append(native);const original=getComputedStyle(native.querySelector('path')).d;native.remove();
      const bounds=svg.getBoundingClientRect();return {attribute:path.getAttribute('d'),computed:css.d,original,
        fill:css.fill,stroke:css.stroke,color:getComputedStyle(button).color,width:bounds.width,height:bounds.height};
    }''')


def native_glyph(state):
    assert state['computed']==state['original'],state
    assert state['fill']==state['color'] and state['stroke']=='none',state
    assert state['width']==state['height']==18,state


def switch_colors(page):
    return page.evaluate('''()=>({paper:getComputedStyle(document.body).backgroundColor,
      track:getComputedStyle(document.querySelector('.nautilus-log-desk-switch-track')).backgroundColor,
      thumb:getComputedStyle(document.querySelector('.nautilus-log-desk-switch-thumb')).backgroundColor})''')


def run():
    (OUT/'bundle').mkdir()
    subprocess.run(['node','test/chart-renderer-bundle.cjs',str(OUT/'bundle')],cwd=ROOT,check=True)
    f.write_page(f.COMPONENT.read_text())
    errors=[];requests=[];console_errors=[];report={'componentSha256':f.sha(f.COMPONENT.read_text()),'matrix':[]}
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True)
        try:
            page=browser.new_page(viewport={'width':1120,'height':1100},device_scale_factor=2)
            page.on('pageerror',lambda error:errors.append(str(error)))
            page.on('request',lambda request:requests.append(request.url) if request.url.startswith(('http:','https:')) else None)
            page.on('console',lambda m:console_errors.append(m.text) if m.type=='error' and not any(s in m.text for s in (*f.EXPECTED_WARNINGS,'native-toolbar-test-calendar-error')) else None)
            for name,context,width,dark,forced,lang in [
                ('light','main',720,False,False,'en'),('dark','main',720,True,False,'en'),
                ('sidebar','sidebar',280,False,False,'en'),('embed-zh','embed',520,False,False,'zh'),
                ('forced','main',720,False,True,'en')]:
                page.emulate_media(forced_colors='active' if forced else 'none',reduced_motion='reduce')
                f.load(page,'untimed',context,width,lang=lang,real_desk=True)
                page.locator('body').evaluate("(e,d)=>{e.classList.toggle('bp3-dark',d);e.style.background=d?'#1d1e21':'#fff';e.style.color=d?'#ecedef':'#222326'}",dark)
                controls=page.locator('.nautilus-log-controls-top button')
                assert controls.count()==3
                assert controls.evaluate_all('es=>es.map(e=>e.matches("[role=switch]")?"Desk":e.querySelector("svg").dataset.icon)')==['Desk','help','eye-off']
                assert controls.evaluate_all('es=>es.map(e=>[e.getBoundingClientRect().width,e.getBoundingClientRect().height,getComputedStyle(e).opacity])')==[[40,32,'1'],[32,32,'1'],[32,32,'1']]
                for selector in SELECTORS[1:]:native_glyph(glyph(page,selector))
                assert glyph(page,SELECTORS[2])['attribute']==ICONS['icons']['eye-off']
                switch=page.locator(SELECTORS[0])
                if switch.get_attribute('aria-checked')=='true':switch.click()
                settle(page);off=switch.locator('.nautilus-log-desk-switch-thumb').bounding_box();off_colors=switch_colors(page)
                assert switch.locator('.nautilus-log-desk-switch-track').evaluate('e=>e.offsetWidth===28&&e.offsetHeight===16')
                switch.focus();switch.press('Space');expect(switch).to_have_attribute('aria-checked','true');settle(page)
                on=switch.locator('.nautilus-log-desk-switch-thumb').bounding_box();on_colors=switch_colors(page)
                assert abs(on['x']-off['x']-12)<.1 and on['width']==on['height']==12
                for index,selector in enumerate(SELECTORS):
                    if index:page.keyboard.press('Tab')
                    control=page.locator(selector);expect(control).to_be_focused()
                    assert control.evaluate('e=>e.matches(":focus-visible")&&getComputedStyle(e).outlineWidth==="2px"')
                help_state=glyph(page,SELECTORS[1]);paper=rgb(on_colors['paper'])
                ratios={'icon':contrast(rgb(help_state['fill']),paper),'thumbOn':contrast(rgb(on_colors['thumb']),rgb(on_colors['track'])),'thumbOff':contrast(rgb(off_colors['thumb']),rgb(off_colors['track']))}
                assert min(ratios.values())>=3,ratios
                help_button=page.locator(SELECTORS[1]);help_button.press('Enter')
                expect(page.get_by_role('dialog',name='Nautilus Log',exact=True)).to_be_visible()
                page.keyboard.press('Escape');expect(help_button).to_be_focused()
                collapse=page.locator(SELECTORS[2]);collapse.press('Space')
                expect(collapse).to_have_attribute('aria-expanded','false');expect(help_button).to_be_hidden()
                native_glyph(glyph(page,SELECTORS[2]));assert glyph(page,SELECTORS[2])['attribute']==ICONS['icons']['eye-open']
                collapse.press('Enter');settle(page)
                page.mouse.move(1,1);page.evaluate('()=>document.activeElement.blur()');settle(page)
                page.locator('.nautilus-log-header').screenshot(path=str(OUT/f'{name}-header.png'))
                assert f.state(page)['writes']==0
                report['matrix'].append({'case':name,'nativeGlyphs':True,'contrast':ratios,'targetGeometry':True,'keyboardAndRestore':True})
            # Feedback is brief and never changes the chart's bounds.
            page.emulate_media(forced_colors='none',reduced_motion='no-preference')
            f.load(page,'untimed','main',720,real_desk=True)
            before=f.state(page)['svg'];page.locator(SELECTORS[1]).hover();settle(page)
            motion=page.locator('.nautilus-log-controls-top').evaluate('''root=>[...root.querySelectorAll('button,.nautilus-log-desk-switch-track,.nautilus-log-desk-switch-thumb')].map(e=>({duration:getComputedStyle(e).transitionDuration,transform:getComputedStyle(e).transform,button:e.tagName==='BUTTON'}))''')
            assert all(all(float(v.strip().removesuffix('s'))<=.12 for v in row['duration'].split(',')) for row in motion),motion
            assert all(row['transform']=='none' for row in motion if row['button']),motion
            assert f.state(page)['svg']==before
            page.emulate_media(reduced_motion='reduce');settle(page)
            assert page.locator('.nautilus-log-controls-top').evaluate("root=>[...root.querySelectorAll('button,.nautilus-log-desk-switch-thumb')].every(e=>getComputedStyle(e).transitionDuration.split(',').every(v=>parseFloat(v)<=.00001))")
            report['feedback']={'maximumSeconds':.12,'chartBoundsUnchanged':True,'reducedMotion':True}
            # No renderer, including a nested one, receives substitute path paint.
            ownership=page.evaluate('''()=>{
              const source=document.querySelector('.nautilus-log-controls-top'),results=[];
              const container=revision=>{const root=document.createElement('div');root.className='nautilus-log-container';if(revision!==null)root.dataset.nautilusRenderer=revision;return root;};
              for(const outer of ['body',null,'1','2','3'])for(const inner of [null,'1','2','3'])for(const layout of ['expanded','direct']){
                const host=outer==='body'?document.createElement('div'):container(outer),root=container(inner),controls=source.cloneNode(true);
                if(layout==='expanded'){const shell=document.createElement('div'),header=document.createElement('header'),actions=document.createElement('div');shell.className='nautilus-log-shell';header.className='nautilus-log-header';actions.className='nautilus-log-header-actions';actions.append(controls);header.append(actions);shell.append(header);root.append(shell);}else root.append(controls);
                host.append(root);document.body.append(host);const paint=[...controls.querySelectorAll('svg path')].map(path=>({fill:getComputedStyle(path).fill,stroke:getComputedStyle(path).stroke}));results.push({outer,inner,layout,paint});host.remove();
              }return results;
            }''')
            assert all(all(p['fill']!='none' and p['stroke']=='none' for p in row['paint']) for row in ownership)
            report['rendererScope']={'nativeAcrossFamilies':True,'cases':len(ownership)}
            # Calendar is a fixture: preserve the fourth control and busy/error flow.
            page.evaluate("()=>{Object.assign(nautilusLogR2.settings,{'google-calendar-enabled':true,'google-calendar-configured':true});dispatchEvent(new Event('nautilus-log:settings-changed'));window.nativeCalendarCalls=0;nautilusLogR2.syncCalendarPlan=()=>{nativeCalendarCalls++;return new Promise((resolve,reject)=>{window.nativeCalendarResolve=resolve;window.nativeCalendarReject=reject})};}")
            calendar=page.locator('.nautilus-log-calendar-btn');expect(calendar).to_be_visible()
            assert page.locator('.nautilus-log-controls-top button').nth(3).evaluate('e=>e.classList.contains("nautilus-log-calendar-btn")')
            calendar.click();expect(calendar).to_have_attribute('aria-busy','true');expect(calendar).to_be_disabled()
            page.evaluate('()=>nativeCalendarResolve({created:0,updated:0,removed:0,skipped:1})')
            expect(calendar).to_be_enabled();expect(page.locator('.nautilus-log-calendar-popover')).to_be_visible()
            calendar.press('Escape');calendar.click();page.evaluate("()=>nativeCalendarReject(new Error('native-toolbar-test-calendar-error'))")
            expect(page.locator('.nautilus-log-calendar-popover--error')).to_contain_text('native-toolbar-test-calendar-error')
            assert page.evaluate('()=>nativeCalendarCalls')==2 and f.state(page)['writes']==0
            report['calendar']={'fourth':True,'syntheticCalls':2,'graphWrites':0}
            touch=browser.new_page(viewport={'width':400,'height':900},has_touch=True)
            f.load(touch,'untimed','main',280,real_desk=True)
            for selector in SELECTORS:expect(touch.locator(selector)).to_be_visible()
            touch.locator(SELECTORS[2]).tap();expect(touch.locator(SELECTORS[2])).to_be_visible()
            touch.locator(SELECTORS[2]).tap();expect(touch.locator(SELECTORS[1])).to_be_visible()
            assert f.state(touch)['writes']==0;touch.close();report['touch']={'restore':True}
        finally:browser.close()
    assert not errors and not requests and not console_errors,(errors,requests,console_errors)
    report.update(pageErrors=errors,httpRequests=requests,consoleErrors=console_errors)
    (OUT/'result.json').write_text(json.dumps(report,indent=2))
    print(f'PASS: native toolbar icons, short feedback, scope, keyboard/touch and Calendar; {OUT}')


if __name__=='__main__':run()
