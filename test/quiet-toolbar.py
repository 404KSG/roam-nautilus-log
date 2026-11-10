#!/usr/bin/env python3
"""Native Help and a labeled view switch: visual and accessibility checks."""
import importlib.util
import json
import os
import re
import subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
os.environ['NAUTILUS_RENDERER_OUT'] = os.environ.get('NAUTILUS_QUIET_OUT', '/tmp/nautilus-view-toolbar')
spec = importlib.util.spec_from_file_location('toolbar_fixture', ROOT / 'test/chart-renderer.py')
f = importlib.util.module_from_spec(spec); spec.loader.exec_module(f)
OUT = f.OUT


def settle(page):
    f.settle_renderer(page)
    page.wait_for_function('()=>[...document.querySelectorAll(".nautilus-log-controls-top *")].every(e=>e.getAnimations().every(a=>a.playState==="finished"))')


def rgb(value):
    return tuple(float(v) for v in re.findall(r'[\d.]+',value)[:3])


def contrast(a,b):
    def luminance(color):
        values = [v/255 for v in color]
        values = [v/12.92 if v <= .04045 else ((v+.055)/1.055)**2.4 for v in values]
        return sum(v*w for v,w in zip(values,[.2126,.7152,.0722]))
    low,high = sorted([luminance(a),luminance(b)])
    return (high+.05)/(low+.05)


def run():
    (OUT/'bundle').mkdir()
    subprocess.check_call(['node','test/chart-renderer-bundle.cjs',str(OUT/'bundle')],cwd=ROOT)
    f.write_page(f.COMPONENT.read_text())
    errors=[]; report={'matrix':[]}
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True)
        try:
            page=browser.new_page(viewport={'width':1120,'height':1100},device_scale_factor=2)
            page.on('pageerror',lambda error:errors.append(str(error)))
            for name,context,width,dark,forced,lang in [
                ('light','main',720,False,False,'en'),('dark','main',720,True,False,'en'),
                ('sidebar','sidebar',280,False,False,'en'),('embed-zh','embed',520,False,False,'zh'),
                ('forced','main',720,False,True,'en'),('forced-dark','main',720,True,True,'en')]:
                page.emulate_media(forced_colors='active' if forced else 'none',reduced_motion='reduce')
                f.load(page,'untimed',context,width,lang=lang,real_desk=True)
                page.locator('body').evaluate('(e,d)=>{e.classList.toggle("bp3-dark",d);e.style.background=d?"#1d1e21":"#fff";e.style.color=d?"#ecedef":"#222326"}',dark)
                controls=page.locator('.nautilus-log-controls-top button')
                assert controls.count()==2
                assert controls.evaluate_all('es=>es.map(e=>e.matches("[role=switch]")?"view":e.querySelector("svg").dataset.icon)')==['help','view']
                assert controls.evaluate_all('es=>es.map(e=>[e.getBoundingClientRect().width,e.getBoundingClientRect().height])')==[[32,32],[82,32]]
                help_button=page.locator('.nautilus-log-help-btn'); switch=page.locator('.nautilus-log-desk-btn')
                path=help_button.locator('svg path')
                assert path.evaluate('e=>getComputedStyle(e).fill')==help_button.evaluate('e=>getComputedStyle(e).color')
                assert path.evaluate('e=>getComputedStyle(e).stroke')=='none'
                assert help_button.locator('svg').evaluate('e=>e.getBoundingClientRect().width')==16
                expect(switch.locator('.nautilus-log-view-label')).to_have_text('图表' if lang=='zh' else 'Chart')
                help_button.focus();page.keyboard.press('Tab');expect(switch).to_be_focused()
                assert switch.evaluate('e=>e.matches(":focus-visible")&&getComputedStyle(e).outlineWidth==="2px"')
                def colors():
                    return page.evaluate('()=>({paper:getComputedStyle(document.body).backgroundColor,icon:getComputedStyle(document.querySelector(".nautilus-log-help-btn")).color,track:getComputedStyle(document.querySelector(".nautilus-log-desk-switch-track")).backgroundColor,thumb:getComputedStyle(document.querySelector(".nautilus-log-desk-switch-thumb")).backgroundColor})')
                settle(page);on=colors();on_offset=switch.locator('.nautilus-log-desk-switch-thumb').evaluate('e=>e.getBoundingClientRect().x-e.parentElement.getBoundingClientRect().x')
                switch.press('Space');settle(page);off=colors();off_offset=switch.locator('.nautilus-log-desk-switch-thumb').evaluate('e=>e.getBoundingClientRect().x-e.parentElement.getBoundingClientRect().x')
                assert abs(on_offset-off_offset-12)<.1, (name,on_offset,off_offset)
                expect(switch.locator('.nautilus-log-view-label')).to_have_text('列表' if lang=='zh' else 'List')
                ratios={'icon':contrast(rgb(on['icon']),rgb(on['paper'])),'on':contrast(rgb(on['thumb']),rgb(on['track'])),'off':contrast(rgb(off['thumb']),rgb(off['track']))}
                assert min(ratios.values())>=3,ratios
                switch.press('Enter');settle(page)
                help_button.press('Enter');expect(page.get_by_role('dialog',name='Nautilus Log',exact=True)).to_be_visible()
                page.keyboard.press('Escape');expect(help_button).to_be_focused()
                page.mouse.move(1,1);page.evaluate('()=>document.activeElement.blur()');settle(page)
                page.locator('.nautilus-log-header').screenshot(path=str(OUT/f'{name}-header.png'))
                assert f.state(page)['writes']==0
                report['matrix'].append({'case':name,'contrast':ratios,'keyboard':True,'targetGeometry':True})
            page.emulate_media(forced_colors='none',reduced_motion='no-preference')
            f.load(page,'untimed',real_desk=True)
            before=f.state(page)['svg'];page.locator('.nautilus-log-help-btn').hover();settle(page)
            assert f.state(page)['svg']==before
            durations=page.locator('.nautilus-log-controls-top').evaluate('root=>[...root.querySelectorAll("button,.nautilus-log-desk-switch-track,.nautilus-log-desk-switch-thumb")].map(e=>getComputedStyle(e).transitionDuration)')
            assert all(all(float(v.strip().removesuffix('s'))<=.12 for v in row.split(',')) for row in durations)
            page.emulate_media(reduced_motion='reduce');settle(page)
            assert page.locator('.nautilus-log-controls-top').evaluate('root=>[...root.querySelectorAll("button,.nautilus-log-desk-switch-thumb")].every(e=>getComputedStyle(e).transitionDuration.split(",").every(v=>parseFloat(v)===0))')
            # Preserve manual Calendar sync and keep its control in the middle.
            page.evaluate('()=>{Object.assign(nautilusLogR3.settings,{"google-calendar-enabled":true,"google-calendar-configured":true});dispatchEvent(new Event("nautilus-log:settings-changed"));window.calendarCalls=0;nautilusLogR3.syncCalendarPlan=()=>{calendarCalls++;return new Promise(resolve=>window.calendarResolve=resolve)}}')
            calendar=page.locator('.nautilus-log-calendar-btn');expect(calendar).to_be_visible()
            assert page.locator('.nautilus-log-controls-top button').nth(1).evaluate('e=>e.classList.contains("nautilus-log-calendar-btn")')
            calendar.click();expect(calendar).to_be_disabled();expect(calendar).to_have_attribute('aria-busy','true')
            page.evaluate('()=>calendarResolve({created:0,updated:0,removed:0,skipped:1})');expect(calendar).to_be_enabled()
            assert page.evaluate('()=>calendarCalls')==1
            report['calendar']={'inMiddle':True,'fixtureCalls':1,'graphWrites':f.state(page)['writes']}
        finally:browser.close()
    assert not errors,errors
    report['pageErrors']=errors
    (OUT/'result.json').write_text(json.dumps(report,indent=2))
    print(f'PASS: Help/view toolbar, native glyph, contrast, focus, motion and Calendar; {OUT}')


if __name__=='__main__':run()
