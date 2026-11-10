#!/usr/bin/env python3
"""Exact renderer and production Help controller; synthetic graph, no live host."""
import importlib.util
import json
import os
import subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
os.environ['NAUTILUS_RENDERER_OUT'] = os.environ.get('NAUTILUS_HELP_OUT', '/tmp/nautilus-chart-help')
spec = importlib.util.spec_from_file_location('chart_fixture', ROOT / 'test/chart-renderer.py')
f = importlib.util.module_from_spec(spec)
spec.loader.exec_module(f)
OUT = f.OUT
ICONS = json.loads((ROOT / 'test/fixtures/blueprint-toolbar-icons.json').read_text())


def assert_toolbar_icon(button, name):
    svg = button.locator('svg')
    expect(svg).to_have_attribute('data-icon', name)
    expect(svg).to_have_attribute('viewBox', ICONS['viewBox'])
    expect(svg.locator('path')).to_have_attribute('d', ICONS['icons'][name])
    expect(svg.locator('path')).to_have_attribute('fill-rule', ICONS['fillRule'])
    # Both the stored path and computed paint use the original native glyph.
    assert svg.evaluate('e=>getComputedStyle(e).stroke') == 'none'
    assert svg.locator('path').evaluate('e=>getComputedStyle(e).fill') == button.evaluate('e=>getComputedStyle(e).color')
    assert svg.locator('path').evaluate('e=>getComputedStyle(e).stroke') == 'none'
    box = svg.bounding_box()
    assert abs(box['width'] - 18) < .5 and abs(box['height'] - 18) < .5, box


def track_listeners(page):
    page.evaluate('''() => {
      window.helpListeners = [];
      const watched = new Set(['pointerdown','focusin','keydown','resize','scroll','hashchange','unload','nautilus-log:settings-changed','visibilitychange']);
      for (const target of [window, document]) {
        const add = target.addEventListener.bind(target), remove = target.removeEventListener.bind(target);
        const capture = options => typeof options === 'boolean' ? options : Boolean(options?.capture);
        target.addEventListener = (type, listener, options) => {
          if (watched.has(type)) helpListeners.push({target, type, listener, capture:capture(options), active:true});
          return add(type, listener, options);
        };
        target.removeEventListener = (type, listener, options) => {
          for (const row of helpListeners) if (row.target === target && row.type === type && row.listener === listener && row.capture === capture(options)) row.active = false;
          return remove(type, listener, options);
        };
      }
    }''')


def no_help(page):
    expect(page.locator('.nautilus-log-help-layer')).to_have_count(0)
    assert page.evaluate('() => helpListeners.filter(r => r.active).map(r => r.type)') == []


def open_help(page, button=None):
    button = button or page.locator('.nautilus-log-help-btn').first
    button.click()
    panel = page.get_by_role('dialog', name='Nautilus Log', exact=True)
    expect(panel).to_be_visible()
    expect(button).to_have_attribute('aria-expanded', 'true')
    expect(panel).to_be_focused()
    assert page.evaluate('() => helpListeners.filter(r => r.active).length') >= 8
    f.settle_renderer(page)
    return panel


def bounds(panel):
    result = panel.evaluate('''e => {const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,
      viewportWidth:innerWidth,viewportHeight:innerHeight,scroll:e.scrollHeight,client:e.clientHeight,fontSize:getComputedStyle(e).fontSize,
      background:getComputedStyle(e).backgroundColor,color:getComputedStyle(e).color};}''')
    assert result['x'] >= 11 and result['right'] <= result['viewportWidth'] - 11, result
    assert result['y'] >= 11 and result['bottom'] <= result['viewportHeight'] - 11, result
    assert float(result['fontSize'][:-2]) == 14, result
    return result


def run():
    (OUT / 'bundle').mkdir(); (OUT / 'screenshots').mkdir()
    subprocess.check_call(['node', 'test/chart-renderer-bundle.cjs', str(OUT / 'bundle')], cwd=ROOT,
                          env={**os.environ, 'NODE_PATH': str(f.NODE_MODULES)})
    source = f.COMPONENT.read_text(); f.write_page(source)
    results = {'componentSha256': f.sha(source), 'helpModuleSha256': f.sha((ROOT / 'src/chart-help.js').read_text()), 'matrix': {}}
    errors, requests, resources, console_errors = [], [], [], []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            page = browser.new_page(viewport={'width': 1200, 'height': 1000})
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.on('request', lambda r: requests.append(r.url) if r.url.startswith(('http:', 'https:')) else None)
            page.on('requestfailed', lambda r: resources.append({'url': r.url, 'failure': r.failure}))
            page.on('console', lambda m: console_errors.append(m.text) if m.type == 'error' and not any(w in m.text for w in f.EXPECTED_WARNINGS) else None)
            for context, width, language, dark in [('main', 720, 'en', False), ('sidebar', 280, 'en', False),
                                                   ('embed', 520, 'zh', False), ('main', 720, 'en', True)]:
                f.load(page, 'untimed', context, width, lang=language)
                page.mouse.move(1, 1); f.settle_renderer(page)
                if dark:
                    page.locator('body').evaluate("e=>{e.classList.add('bp3-dark');e.style.background='#1d1e21';e.style.color='#ecedef'}")
                track_listeners(page)
                label = 'Nautilus Log help' if language == 'en' else 'Nautilus Log 帮助'
                button = page.get_by_role('button', name=label, exact=True)
                expect(button).to_have_attribute('aria-haspopup', 'dialog')
                expect(button).to_have_attribute('aria-expanded', 'false')
                toolbar = page.locator('.nautilus-log-controls-top')
                controls = toolbar.locator('button')
                assert controls.evaluate_all('nodes=>nodes.map(e=>e.getAttribute("role")==="switch"?"view":e.querySelector("svg")?.getAttribute("data-icon"))') == ['help', 'view']
                positions = controls.evaluate_all('nodes=>nodes.map(e=>e.getBoundingClientRect().x)')
                assert positions == sorted(positions) and len(set(positions)) == 2
                expect(page.locator('.nautilus-log-tidy-btn,[data-icon="crystal-ball"]')).to_have_count(0)
                expected_ink = 'rgb(167, 182, 194)' if dark else 'rgb(92, 112, 128)'
                hover_ink = 'rgb(225, 232, 237)' if dark else 'rgb(57, 75, 89)'
                for selector in ['.nautilus-log-help-btn']:
                    control = page.locator(selector)
                    for phase in ['idle', 'hover', 'focus']:
                        if phase == 'hover': control.hover()
                        if phase == 'focus':
                            page.mouse.move(1, 1)
                            control.focus()
                        f.settle_renderer(page)
                        page.wait_for_function('selector=>document.querySelector(selector).getAnimations().every(a=>a.playState==="finished")', arg=selector)
                        assert control.locator('path').evaluate('e=>getComputedStyle(e).fill') == (hover_ink if phase == 'hover' else expected_ink), (selector, phase)
                        assert control.locator('path').evaluate('e=>getComputedStyle(e).stroke') == 'none', (selector, phase)
                    control.evaluate('e=>e.blur()'); page.mouse.move(1, 1)
                expect(page.locator('.nautilus-log-desk-btn')).to_have_attribute('aria-checked', 'true')
                expect(page.locator('.nautilus-log-collapse-btn')).to_have_count(0)
                assert page.locator('[aria-label="Hide completed on chart"],[aria-label="Show completed on chart"],[aria-label="在海螺中隐藏已完成"],[aria-label="在海螺中显示已完成"]').count() == 0
                button.hover(); expect(page.locator('.nautilus-log-help-popover')).to_have_count(0)
                before = f.coverage(page)
                source_before = page.evaluate('() => __chartHarness.sourceRows()')
                reads_before = page.evaluate('() => __chartHarness.traces().filter(t => t.kind === "query").length')
                storage_before = page.evaluate('() => JSON.stringify({...localStorage})')
                panel = open_help(page, button)
                expect(panel.locator('.nautilus-log-help-setup')).to_contain_text('05:00–21:00')
                expect(panel.locator('[data-help-key="desk"]')).to_contain_text('List shows original blocks' if language == 'en' else '列表显示原始块')
                assert 'tidy' not in panel.inner_text().lower() and '整理' not in panel.inner_text()
                expect(panel.locator('[data-help-key="left"]')).to_contain_text('full-day Available' if language == 'en' else '全天可安排容量')
                assert panel.locator('a').get_attribute('rel') == 'noopener noreferrer'
                assert panel.locator('a').get_attribute('target') == '_blank'
                assert panel.locator('a').get_attribute('href') == 'https://github.com/404KSG/roam-nautilus-log/blob/' + 'a'*40 + '/docs/guide' + ('.zh-CN' if language == 'zh' else '') + '.md'
                measurements = bounds(panel)
                assert measurements['scroll'] <= measurements['client'] + 1, 'Normal Help must be compact enough to read without scrolling'
                f.assert_rect_equal(before, f.coverage(page), 'Help must not resize the chart or move following content')
                assert page.evaluate('() => __chartHarness.traces().filter(t => t.kind === "query").length') == reads_before
                page.evaluate('window.originalHelpPanel = document.querySelector(".nautilus-log-help-popover")')
                f.set_clock(page, '2026-10-29T08:02:00')
                assert panel.evaluate('e => e === originalHelpPanel'), 'Minute updates must not close/remount Help'
                assert all(r['visible'] for r in f.coverage(page)['records'])
                # Help belongs to the viewport. Full-document capture can
                # transiently emulate a 1x1 viewport for native embed fixtures,
                # legitimately dismissing a now-offscreen anchor before Tab.
                page.screenshot(path=str(OUT / 'screenshots' / f'help-{context}-{width}-{language}-{dark}.png'))
                page.keyboard.press('Tab'); expect(panel.locator('a')).to_be_focused()
                page.keyboard.press('Escape'); no_help(page); expect(button).to_be_focused()
                expect(button).to_have_attribute('aria-expanded', 'false')
                assert button.get_attribute('aria-controls') is None
                button.press('Space'); expect(page.locator('.nautilus-log-help-popover')).to_be_visible()
                button.focus(); button.press('Enter'); no_help(page)
                assert page.evaluate('() => __chartHarness.sourceRows()') == source_before
                assert page.evaluate('() => JSON.stringify({...localStorage})') == storage_before
                assert f.state(page)['writes'] == 0
                # The native caret hides either view without writing a preference.
                before_fold = f.coverage(page)
                caret = page.locator('#native-plan-caret')
                caret.press('Space'); no_help(page)
                expect(page.locator('svg.nautilus-log-svg')).to_have_count(0)
                expect(page.locator('.nautilus-log-container')).to_be_hidden()
                caret.press('Enter'); f.settle_renderer(page)
                f.assert_rect_equal(before_fold, f.coverage(page), 'native fold round trip')
                assert page.evaluate('() => __chartHarness.sourceRows()') == source_before
                assert f.state(page)['writes'] == 0
                page.locator('.nautilus-log-controls-top').screenshot(path=str(OUT / 'screenshots' / f'toolbar-{context}-{width}-{language}-{dark}.png'))
                results['matrix'][f'{context}-{width}-{language}-{dark}'] = measurements

            # Connected Calendar remains available after the three remaining
            # controls. Rendering/focusing it must not trigger a sync.
            f.load(page, 'untimed', 'sidebar', 280); track_listeners(page)
            page.evaluate("()=>{Object.assign(nautilusLogExtensionData.settings,{'google-calendar-enabled':true,'google-calendar-configured':true});window.dispatchEvent(new Event('nautilus-log:settings-changed'));}")
            calendar = page.locator('.nautilus-log-calendar-btn')
            expect(calendar).to_be_visible()
            controls = page.locator('.nautilus-log-controls-top button')
            assert controls.count() == 3
            assert controls.nth(1).evaluate('e=>e.classList.contains("nautilus-log-calendar-btn")')
            page.locator('.nautilus-log-help-btn').focus()
            for selector in ['.nautilus-log-calendar-btn', '.nautilus-log-desk-btn']:
                page.keyboard.press('Tab'); expect(page.locator(selector)).to_be_focused()
            assert f.state(page)['writes'] == 0
            results['toolbarOrderAndView'] = {'default': ['Help', 'Chart/List'], 'calendarInMiddle': True, 'keyboardRoundTrip': True}

            f.load(page, 'untimed'); track_listeners(page)
            page.locator('.nautilus-log-desk-btn').press('Space'); no_help(page)
            page.reload()
            page.wait_for_function('() => window.__chartEvaluator?.completed || window.__chartEvaluator?.error')
            expect(page.locator('.nautilus-log-desk-btn')).to_have_attribute('aria-checked', 'false')
            expect(page.locator('svg.nautilus-log-svg')).to_have_count(0)
            page.locator('.nautilus-log-desk-btn').press('Enter'); f.settle_renderer(page)
            assert all(row['visible'] for row in f.coverage(page)['records'])
            assert f.state(page)['writes'] == 0
            results['persistedViewState'] = True

            # Help owns Escape before application bubbling handlers, but never
            # takes the same key from an outside/native editor.
            f.load(page, 'untimed')
            page.evaluate("()=>{window.applicationEscapes=[];document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!e.isComposing)applicationEscapes.push(e.defaultPrevented);});}")
            track_listeners(page)
            panel = open_help(page)
            page.evaluate('''() => {const input=document.createElement('textarea');input.id='outside-editor';input.setAttribute('aria-label','Outside editor');input.value='keep this selection';document.body.append(input);
              window.outsideClicks=0;document.querySelector('.nautilus-log-header-copy').addEventListener('click',()=>outsideClicks++,{once:true});}''')
            page.locator('.nautilus-log-header-copy').click(); no_help(page)
            assert page.evaluate('outsideClicks') == 1
            assert not page.locator('.nautilus-log-help-btn').evaluate('e=>document.activeElement===e')
            panel = open_help(page)
            page.locator('#outside-editor').focus(); no_help(page)
            page.locator('#outside-editor').evaluate('''e=>{e.setSelectionRange(2,6);window.nativeEscape=false;e.addEventListener('keydown',v=>{if(v.key==='Escape')nativeEscape=!v.defaultPrevented;});}''')
            page.locator('#outside-editor').press('Escape')
            assert page.evaluate('nativeEscape')
            assert page.locator('#outside-editor').evaluate('e=>e.value==="keep this selection"&&e.selectionStart===2&&e.selectionEnd===6')
            panel = open_help(page)
            assert panel.evaluate("e=>!e.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true,isComposing:true}))") is False
            expect(panel).to_be_visible(); page.keyboard.press('Escape'); no_help(page)
            assert page.evaluate('applicationEscapes') == [False]
            results['outsideAndIme'] = True

            # The concurrently published native-image fix requires modal input
            # priority even when Roam leaves focus on the underlying chrome.
            f.load(page, 'untimed'); track_listeners(page)
            panel = open_help(page)
            modal = panel.evaluate('''panel => {
              const portal=document.createElement('div');portal.id='rm-modal-portal';
              const viewer=document.createElement('div');viewer.className='rm-enhanced-image-modal-container';portal.append(viewer);document.body.append(portal);
              let received=false, preventedBeforeNative=null;
              const native=e=>{if(e.key==='Escape'){received=true;preventedBeforeNative=e.defaultPrevented;portal.remove();}};
              document.addEventListener('keydown',native);
              panel.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
              document.removeEventListener('keydown',native);
              return {received,preventedBeforeNative,viewerStillOpen:portal.isConnected};
            }''')
            assert modal == {'received': True, 'preventedBeforeNative': False, 'viewerStillOpen': False}, modal
            no_help(page)
            open_help(page)
            page.evaluate("()=>{const p=document.createElement('div');p.id='rm-modal-portal';p.innerHTML='<div class=\"rm-enhanced-image-modal-container\"></div>';document.body.append(p);}")
            page.wait_for_function('!document.querySelector(".nautilus-log-help-layer")'); no_help(page)
            page.locator('.nautilus-log-help-btn').click(); no_help(page)
            page.evaluate('document.getElementById("rm-modal-portal").remove()')
            results['nativeImagePriority'] = modal

            # Changed settings close the old snapshot; reopening reflects the resolved chart settings.
            panel = open_help(page)
            page.evaluate("()=>{Object.assign(nautilusLogExtensionData.settings,{language:'zh','workday-start':21,'workday-end':2,'todo-duration':25});window.dispatchEvent(new Event('nautilus-log:settings-changed'));}")
            no_help(page)
            panel = open_help(page)
            expect(panel.locator('.nautilus-log-help-setup')).to_contain_text('21:00–次日 02:00')
            expect(panel.locator('.nautilus-log-help-setup')).to_contain_text('25m')
            page.keyboard.press('Escape'); no_help(page)
            results['resolvedSettings'] = True

            # Compact viewports constrain only Help; the full guide remains keyboard-reachable.
            page.set_viewport_size({'width': 390, 'height': 360})
            f.load(page, 'untimed', 'main', 300); track_listeners(page)
            panel = open_help(page); small = bounds(panel)
            page.keyboard.press('Tab'); expect(panel.locator('a')).to_be_focused()
            link = panel.locator('a').bounding_box(); box = panel.bounding_box()
            assert link['y'] >= box['y'] and link['y'] + link['height'] <= box['y'] + box['height'] + 1
            page.screenshot(path=str(OUT / 'screenshots' / 'help-small-viewport.png'))
            page.keyboard.press('Escape'); no_help(page)
            results['smallViewport'] = small
            page.set_viewport_size({'width': 1200, 'height': 1000})

            # Fold/unfold, navigation, external removal and extension disposal release resources.
            f.load(page, 'untimed'); track_listeners(page)
            open_help(page)
            page.locator('#native-plan-caret').click(); no_help(page)
            # Preserve the existing folded chrome: only Expand stays visible.
            expect(page.locator('.nautilus-log-help-btn')).to_be_hidden()
            page.locator('#native-plan-caret').click(); no_help(page)
            open_help(page); page.evaluate("window.dispatchEvent(new HashChangeEvent('hashchange'))"); no_help(page)
            open_help(page); page.evaluate("document.querySelector('.nautilus-log-help-btn').remove()")
            page.wait_for_function('!document.querySelector(".nautilus-log-help-layer")'); no_help(page)
            f.load(page, 'untimed'); track_listeners(page); open_help(page)
            page.evaluate('''()=>{window.heldHelpFrames=[];window.savedHelpRaf=requestAnimationFrame;window.requestAnimationFrame=fn=>{heldHelpFrames.push(fn);return 98765;};window.dispatchEvent(new Event('resize'));__chartHarness.destroyHelp();window.requestAnimationFrame=savedHelpRaf;heldHelpFrames.forEach(fn=>fn());}''')
            no_help(page)
            results['lifecycle'] = True

            # Multiple mounted charts share one transient Help owner, never a graph/model singleton.
            f.load(page, 'untimed'); track_listeners(page)
            page.evaluate('''()=>{const host=document.createElement('div');host.id='second-help-chart';host.style.width='520px';document.body.append(host);
              scittle.core.eval_string('(rdom/render [nautilus-log-r3/main {:block-uid "baseline-plan"}] (.getElementById js/document "second-help-chart"))');}''')
            expect(page.locator('.nautilus-log-help-btn')).to_have_count(2)
            first = page.locator('#chart-root .nautilus-log-help-btn'); second = page.locator('#second-help-chart .nautilus-log-help-btn')
            open_help(page, first); first_id = first.get_attribute('aria-controls')
            open_help(page, second)
            expect(first).to_have_attribute('aria-expanded', 'false')
            assert second.get_attribute('aria-controls') != first_id
            expect(page.locator('.nautilus-log-help-layer')).to_have_count(1)
            page.evaluate('ReactDOM.unmountComponentAtNode(document.getElementById("chart-root"))')
            expect(page.locator('.nautilus-log-help-layer')).to_have_count(1)
            page.evaluate('ReactDOM.unmountComponentAtNode(document.getElementById("second-help-chart"))')
            expect(page.locator('.nautilus-log-help-layer')).to_have_count(0)
            # Both renderers also dispose their own clock subscriptions.
            no_help(page)
            assert f.state(page)['writes'] == 0
            results['multipleCharts'] = True
            assert not errors and not requests and not resources and not console_errors, (errors, requests, resources, console_errors)
            results.update({'result': 'PASS', 'graphWrites': 0, 'pageErrors': errors, 'httpRequests': requests,
                            'resourceFailures': resources, 'consoleErrors': console_errors})
        finally:
            browser.close()
    (OUT / 'results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
    print(json.dumps({'result': 'PASS', 'artifactDirectory': str(OUT), 'matrixCases': len(results['matrix']),
                      'componentSha256': results['componentSha256'], 'helpModuleSha256': results['helpModuleSha256']}, indent=2))


if __name__ == '__main__':
    try:
        run()
    except Exception as error:
        (OUT / 'failure.json').write_text(json.dumps({'result': 'FAIL', 'error': str(error)}, ensure_ascii=False, indent=2))
        raise
