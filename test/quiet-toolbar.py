#!/usr/bin/env python3
"""Quiet toolbar on the exact r2 renderer: paint, fallback, scope, and actions.

All graph data and Calendar responses are synthetic. No host login or network.
"""
import importlib.util
import io
import json
import os
import re
import subprocess
from pathlib import Path
from PIL import Image
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
os.environ['NAUTILUS_RENDERER_OUT'] = os.environ.get('NAUTILUS_QUIET_OUT', '/tmp/nautilus-quiet-toolbar')
spec = importlib.util.spec_from_file_location('quiet_chart_fixture', ROOT / 'test/chart-renderer.py')
f = importlib.util.module_from_spec(spec)
spec.loader.exec_module(f)
OUT = f.OUT
CSS = Path(os.environ.get('NAUTILUS_QUIET_STYLESHEET', ROOT / 'extension.css'))
ICONS = json.loads((ROOT / 'test/fixtures/blueprint-toolbar-icons.json').read_text())
SELECTORS = ['.nautilus-log-desk-btn', '.nautilus-log-help-btn', '.nautilus-log-collapse-btn']


def settle(page):
    f.settle_renderer(page)
    page.wait_for_function('''() => [...document.querySelectorAll('.nautilus-log-controls-top *')]
      .every(e => e.getAnimations().every(a => a.playState === 'finished'))''')


def rgb(value, background=(255, 255, 255)):
    parts = [float(x) for x in re.findall(r'[\d.]+', value)]
    alpha = parts[3] if len(parts) == 4 else 1
    return tuple(parts[i] * alpha + background[i] * (1 - alpha) for i in range(3))


def contrast(a, b):
    def luminance(color):
        values = [v / 255 for v in color]
        values = [v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in values]
        return sum(x * weight for x, weight in zip(values, [.2126, .7152, .0722]))
    values = sorted([luminance(a), luminance(b)])
    return (values[1] + .05) / (values[0] + .05)


def glyph_state(page, selector):
    return page.locator(selector).evaluate('''button => {
      const svg = button.querySelector('svg'), path = svg.querySelector('path');
      const css = getComputedStyle(path), bounds = path.getBBox(), rect = svg.getBoundingClientRect();
      const native = svg.cloneNode(true);
      native.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
      document.body.append(native);
      const nativePath = getComputedStyle(native.querySelector('path')).d;
      native.remove();
      return {attribute: path.getAttribute('d'), native: nativePath, computed: css.d, fill: css.fill, stroke: css.stroke,
        color: getComputedStyle(button).color, pathCount: svg.querySelectorAll('path').length,
        svgWidth: rect.width, svgHeight: rect.height,
        bounds: {x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height}};
    }''')


def assert_glyph(state, enhanced):
    assert state['pathCount'] == 1 and state['svgWidth'] == state['svgHeight'] == 16, state
    assert state['bounds']['width'] > 5 and state['bounds']['height'] > 5, state
    if enhanced:
        assert state['fill'] == 'none' and state['stroke'] == state['color'], state
        assert state['computed'] != state['native'], state
    else:
        assert state['fill'] == state['color'] and state['stroke'] == 'none', state
        assert state['computed'] == state['native'], state


def disable_line_paint(page):
    # Replace only this owned stylesheet in-place, then remove its feature gate.
    # The native geometry and all neutral base styles remain exactly available.
    return page.evaluate('''css => {
      const link = [...document.querySelectorAll('link[rel=stylesheet]')].find(e => e.href.endsWith('/extension.css'));
      if (!link) throw Error('Extension stylesheet missing');
      const style = document.createElement('style'); style.textContent = css; link.replaceWith(style);
      let removed = 0;
      for (let i=style.sheet.cssRules.length-1;i>=0;i--) {
        const rule=style.sheet.cssRules[i];
        if (rule.type===CSSRule.SUPPORTS_RULE && rule.conditionText.includes('d: path(')) {
          style.sheet.deleteRule(i); removed++;
        }
      }
      return removed;
    }''', CSS.read_text())


def ink(page, selector):
    state = glyph_state(page, selector)
    foreground = rgb(state['stroke'] if state['fill'] == 'none' else state['fill'])
    image = Image.open(io.BytesIO(page.locator(selector + ' svg').screenshot())).convert('RGB')
    denominator = sum(255 - value for value in foreground)
    return sum(min(1, sum(255 - value for value in image.getpixel((x, y))) / denominator)
               for y in range(image.height) for x in range(image.width))


def run():
    (OUT / 'bundle').mkdir()
    subprocess.run(['node', 'test/chart-renderer-bundle.cjs', str(OUT / 'bundle')], cwd=ROOT, check=True)
    source = f.COMPONENT.read_text()
    f.write_page(source)
    if CSS.resolve() != (ROOT / 'extension.css').resolve():
        html = (OUT / 'index.html').read_text().replace((ROOT / 'extension.css').as_uri(), CSS.resolve().as_uri())
        (OUT / 'index.html').write_text(html)
    errors, requests, unexpected_console = [], [], []
    report = {'componentSha256': f.sha(source), 'matrix': []}
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            page = browser.new_page(viewport={'width': 1120, 'height': 1100}, device_scale_factor=2)
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.on('request', lambda request: requests.append(request.url) if request.url.startswith(('http:', 'https:')) else None)
            page.on('console', lambda message: unexpected_console.append(message.text) if message.type == 'error'
                    and not any(marker in message.text for marker in (*f.EXPECTED_WARNINGS, 'quiet-toolbar-test-calendar-error')) else None)
            for name, context, width, dark, forced, lang in [
                ('light', 'main', 720, False, False, 'en'),
                ('dark', 'main', 720, True, False, 'en'),
                ('sidebar', 'sidebar', 280, False, False, 'en'),
                ('embed-zh', 'embed', 520, False, False, 'zh'),
                ('forced', 'main', 720, False, True, 'en'),
            ]:
                page.emulate_media(forced_colors='active' if forced else 'none', reduced_motion='reduce')
                f.load(page, 'untimed', context, width, lang=lang, real_desk=True)
                page.locator('body').evaluate("(e,d)=>{e.classList.toggle('bp3-dark',d);e.style.background=d?'#1d1e21':'#fff';e.style.color=d?'#ecedef':'#222326'}", dark)
                gate = page.evaluate(r'''css => {
                  const sheet=new CSSStyleSheet();sheet.replaceSync(css);
                  const rule=[...sheet.cssRules].find(r=>r.type===CSSRule.SUPPORTS_RULE && r.conditionText.includes('d: path('));
                  if(!rule)return null;
                  const paths=[...rule.cssRules].map(r=>r.style?.getPropertyValue('d')).filter(Boolean);
                  const guarded=[...rule.conditionText.matchAll(/path\("[^"]*"\)/g)].map(match=>{
                    const node=document.createElementNS('http://www.w3.org/2000/svg','path');
                    node.style.d=match[0];return node.style.d;
                  });
                  return {supported:CSS.supports(rule.conditionText),paths:paths.length,
                    exact:guarded.length===paths.length && paths.every(value=>guarded.includes(value))};
                }''', CSS.read_text())
                assert gate == {'supported': True, 'paths': 3, 'exact': True}, gate
                controls = page.locator('.nautilus-log-controls-top button')
                assert controls.count() == 3
                assert controls.evaluate_all('es=>es.map(e=>e.matches("[role=switch]")?"Desk":e.querySelector("svg").dataset.icon)') == ['Desk', 'help', 'eye-off']
                assert controls.evaluate_all('es=>es.map(e=>[e.getBoundingClientRect().width,e.getBoundingClientRect().height,getComputedStyle(e).opacity])') == [[40,32,'1'],[32,32,'1'],[32,32,'1']]
                switch = page.locator(SELECTORS[0])
                if switch.get_attribute('aria-checked') == 'true': switch.click()
                settle(page)
                off = switch.locator('.nautilus-log-desk-switch-thumb').bounding_box()
                switch.focus(); switch.press('Space')
                expect(switch).to_have_attribute('aria-checked', 'true'); settle(page)
                on = switch.locator('.nautilus-log-desk-switch-thumb').bounding_box()
                assert abs(on['x'] - off['x'] - 10) < .1 and on['width'] == on['height'] == 10
                assert switch.locator('.nautilus-log-desk-switch-track').evaluate('e=>e.offsetWidth===24&&e.offsetHeight===14')
                for index, selector in enumerate(SELECTORS):
                    if index: page.keyboard.press('Tab')
                    control = page.locator(selector); expect(control).to_be_focused()
                    assert control.evaluate('e=>e.matches(":focus-visible")&&getComputedStyle(e).outlineWidth==="2px"')
                help_state = glyph_state(page, SELECTORS[1]); eye_state = glyph_state(page, SELECTORS[2])
                assert_glyph(help_state, True); assert_glyph(eye_state, True)
                assert eye_state['attribute'] == ICONS['icons']['eye-off']
                colors = page.evaluate('''() => ({paper:getComputedStyle(document.body).backgroundColor,
                  track:getComputedStyle(document.querySelector('.nautilus-log-desk-switch-track')).backgroundColor,
                  thumb:getComputedStyle(document.querySelector('.nautilus-log-desk-switch-thumb')).backgroundColor})''')
                paper = rgb(colors['paper']); track = rgb(colors['track'], paper)
                ratios = {'icon': contrast(rgb(help_state['stroke']), paper), 'thumb': contrast(rgb(colors['thumb'], track), track)}
                assert min(ratios.values()) >= 3, ratios
                help_button = page.locator(SELECTORS[1]); help_button.press('Enter')
                expect(page.get_by_role('dialog', name='Nautilus Log', exact=True)).to_be_visible()
                page.keyboard.press('Escape'); expect(help_button).to_be_focused()
                collapse = page.locator(SELECTORS[2]); collapse.press('Space')
                expect(collapse).to_have_attribute('aria-expanded', 'false'); expect(collapse).to_be_visible()
                expect(help_button).to_be_hidden(); assert_glyph(glyph_state(page, SELECTORS[2]), True)
                assert glyph_state(page, SELECTORS[2])['attribute'] == ICONS['icons']['eye-open']
                collapse.press('Enter'); settle(page)
                page.mouse.move(1,1); page.evaluate('()=>document.activeElement.blur()'); settle(page)
                page.locator('.nautilus-log-header').screenshot(path=str(OUT / f'{name}-header.png'))
                report['matrix'].append({'case':name,'enhanced':True,'contrast':ratios,'targetGeometry':True,'keyboardAndRestore':True})
                assert f.state(page)['writes'] == 0

            # Compare supported paint and native fallback on the same scale/background.
            page.emulate_media(forced_colors='none', reduced_motion='reduce')
            f.load(page, 'untimed', 'main', 720, real_desk=True)
            page.mouse.move(1,1); page.evaluate('()=>document.activeElement.blur()'); settle(page)
            before = {selector:glyph_state(page, selector) for selector in SELECTORS[1:]}
            supported_ink = {selector:ink(page, selector) for selector in SELECTORS[1:]}
            geometry = f.state(page)['svg']
            assert disable_line_paint(page) == 1
            settle(page)
            fallback_ink = {selector:ink(page, selector) for selector in SELECTORS[1:]}
            for selector in SELECTORS[1:]:
                current = glyph_state(page, selector); assert_glyph(current, False)
                assert current['attribute'] == before[selector]['attribute']
                assert supported_ink[selector] < fallback_ink[selector] * .85, (selector,supported_ink,fallback_ink)
            assert f.state(page)['svg'] == geometry
            page.locator(SELECTORS[1]).press('Enter'); expect(page.get_by_role('dialog', name='Nautilus Log', exact=True)).to_be_visible()
            page.keyboard.press('Escape')
            page.locator(SELECTORS[2]).press('Space')
            expect(page.locator(SELECTORS[2])).to_have_attribute('aria-expanded', 'false')
            expect(page.locator(SELECTORS[2] + ' svg[data-icon="eye-open"]')).to_be_visible()
            assert_glyph(glyph_state(page, SELECTORS[2]), False)
            page.locator(SELECTORS[2]).press('Enter'); settle(page)
            page.locator('.nautilus-log-header').screenshot(path=str(OUT / 'fallback-header.png'))
            report['fallback'] = {'usable':True,'attributeGeometryUnchanged':True,'supportedInk':supported_ink,'fallbackInk':fallback_ink}

            # The nearest renderer owns paint, including nested charts in a Desk
            # or embed. Exercise both immutable expanded and direct control paths.
            f.load(page, 'untimed')
            ownership = page.evaluate('''() => {
              const source=document.querySelector('.nautilus-log-controls-top'), results=[];
              const container=revision=>{
                const root=document.createElement('div');root.className='nautilus-log-container';
                if(revision!==null)root.dataset.nautilusRenderer=revision;return root;
              };
              for(const outer of ['body',null,'1','2','3']) for(const inner of [null,'1','2','3']) for(const layout of ['expanded','direct']) {
                const host=outer==='body'?document.createElement('div'):container(outer),root=container(inner);
                const controls=source.cloneNode(true);
                if(layout==='expanded') {
                  const shell=document.createElement('div'),header=document.createElement('header'),actions=document.createElement('div');
                  shell.className='nautilus-log-shell';header.className='nautilus-log-header';actions.className='nautilus-log-header-actions';
                  actions.append(controls);header.append(actions);shell.append(header);root.append(shell);
                } else root.append(controls);
                host.append(root);document.body.append(host);
                const paint=[...controls.querySelectorAll('svg path')].map(path=>({fill:getComputedStyle(path).fill,stroke:getComputedStyle(path).stroke}));
                results.push({outer,inner,layout,paint});host.remove();
              }
              return results;
            }''')
            failures = [row for row in ownership if not all(
                (paint['fill'] == 'none' and paint['stroke'] != 'none') if row['inner'] == '2'
                else (paint['fill'] != 'none' and paint['stroke'] == 'none') for paint in row['paint'])]
            assert not failures, failures
            report['rendererScope'] = {'nearestOwnerOnly':True,'cases':len(ownership),'matrix':ownership}

            # Calendar responses are fixture promises; no OAuth or real sync is invoked.
            page.evaluate("()=>{Object.assign(nautilusLogR2.settings,{'google-calendar-enabled':true,'google-calendar-configured':true});window.dispatchEvent(new Event('nautilus-log:settings-changed'));window.quietCalendarCalls=0;nautilusLogR2.syncCalendarPlan=()=>{quietCalendarCalls++;return new Promise((resolve,reject)=>{window.quietCalendarResolve=resolve;window.quietCalendarReject=reject})};}")
            calendar = page.locator('.nautilus-log-calendar-btn'); expect(calendar).to_be_visible()
            assert page.locator('.nautilus-log-controls-top button').nth(3).evaluate('e=>e.classList.contains("nautilus-log-calendar-btn")')
            calendar.focus(); assert calendar.evaluate('e=>getComputedStyle(e).outlineWidth==="2px"')
            calendar.click(); expect(calendar).to_have_attribute('aria-busy', 'true'); expect(calendar).to_be_disabled()
            expect(calendar.locator('.nautilus-log-calendar-spinner')).to_have_count(1)
            assert calendar.locator('.nautilus-log-calendar-spinner').evaluate('e=>getComputedStyle(e).animationName') == 'nautilus-log-calendar-spin'
            page.evaluate('()=>quietCalendarResolve({created:0,updated:0,removed:0,skipped:1})')
            expect(calendar).to_have_attribute('aria-busy', 'false'); expect(calendar).to_be_enabled()
            expect(page.locator('.nautilus-log-calendar-popover')).to_be_visible()
            calendar.press('Escape'); calendar.click()
            page.evaluate("()=>quietCalendarReject(new Error('quiet-toolbar-test-calendar-error'))")
            expect(page.locator('.nautilus-log-calendar-popover--error')).to_contain_text('quiet-toolbar-test-calendar-error')
            assert page.evaluate('()=>quietCalendarCalls') == 2 and f.state(page)['writes'] == 0
            report['calendar'] = {'fourth':True,'busyAndResultAndError':True,'syntheticCalls':2,'graphWrites':0}

            touch = browser.new_page(viewport={'width':400,'height':900}, has_touch=True)
            f.load(touch, 'untimed', 'main', 280, real_desk=True)
            assert touch.evaluate('()=>matchMedia("(pointer: coarse)").matches')
            for selector in SELECTORS: expect(touch.locator(selector)).to_be_visible()
            touch.locator(SELECTORS[2]).tap(); expect(touch.locator(SELECTORS[2])).to_be_visible()
            touch.locator(SELECTORS[2]).tap(); expect(touch.locator(SELECTORS[1])).to_be_visible()
            assert f.state(touch)['writes'] == 0
            touch.close(); report['touch'] = {'alwaysDiscoverable':True,'restore':True}
        finally:
            browser.close()
    assert not errors and not requests and not unexpected_console, (errors,requests,unexpected_console)
    report.update(pageErrors=errors,httpRequests=requests,unexpectedConsoleErrors=unexpected_console)
    (OUT / 'result.json').write_text(json.dumps(report, indent=2))
    print(f'PASS: quiet toolbar paint, exact source, fallback, scope, keyboard, touch, contrast and Calendar fixtures; {OUT}')


if __name__ == '__main__':
    run()
