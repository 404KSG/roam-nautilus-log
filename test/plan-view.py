#!/usr/bin/env python3
"""Chart/list policy on the exact renderer and production Desk lifecycle.

The native caret markup was inspected read-only in Roam on 2026-11-10.
Graph, editor, and native caret actions here remain isolated fixtures.
"""
import importlib.util
import json
import os
import subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
os.environ['NAUTILUS_RENDERER_OUT'] = os.environ.get('NAUTILUS_VIEW_OUT', '/tmp/nautilus-plan-view')
spec = importlib.util.spec_from_file_location('chart_fixture', ROOT / 'test/chart-renderer.py')
f = importlib.util.module_from_spec(spec); spec.loader.exec_module(f)
OUT = f.OUT


def run():
    (OUT / 'bundle').mkdir()
    subprocess.check_call(['node', 'test/chart-renderer-bundle.cjs', str(OUT / 'bundle')], cwd=ROOT)
    f.write_page(f.COMPONENT.read_text())
    report = {'matrix': [], 'fixture': 'exact current CLJS + production view/Desk; synthetic graph'}
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            page = browser.new_page(viewport={'width':1200,'height':1000})
            page.on('pageerror', lambda error: errors.append(str(error)))
            for context, width, language, dark in [('main',720,'en',False), ('sidebar',280,'en',False), ('embed',520,'zh',False), ('main',720,'en',True)]:
                f.load(page, 'mixed', context, width, lang=language, real_desk=True)
                page.locator('body').evaluate('(e,d)=>e.classList.toggle("bp3-dark",d)', dark)
                root = page.locator('.nautilus-log-container')
                switch = page.get_by_role('switch', name='图表视图' if language == 'zh' else 'Chart view', exact=True)
                controls = root.locator('.nautilus-log-controls-top button')
                assert controls.evaluate_all('nodes=>nodes.map(e=>e.matches("[role=switch]")?"view":e.querySelector("svg")?.dataset.icon)') == ['help','view']
                expect(page.locator('.nautilus-log-collapse-btn,[data-icon="eye-open"],[data-icon="eye-off"]')).to_have_count(0)
                expect(switch).to_have_attribute('aria-checked','true')
                expect(root.locator('.nautilus-desk')).to_be_visible()
                expect(page.locator('#native-plan-outline')).to_be_hidden()
                before = page.evaluate('()=>__chartHarness.sourceRows()')
                raw_identity = page.evaluate('()=>{window.originalNativeOutline=document.getElementById("native-plan-outline");return originalNativeOutline.childElementCount}')
                page.mouse.move(1,1)
                root.screenshot(path=str(OUT / f'chart-{context}-{language}-{dark}.png'))
                switch.focus(); switch.press('Space'); f.settle_renderer(page)
                expect(root).to_have_attribute('data-nautilus-view','list')
                expect(switch).to_have_attribute('aria-checked','false')
                expect(page.locator('svg.nautilus-log-svg')).to_have_count(0)
                expect(page.locator('#native-plan-outline')).to_be_visible()
                assert page.evaluate('()=>originalNativeOutline===document.getElementById("native-plan-outline")')
                assert page.locator('#native-plan-outline [contenteditable=true]').count() == raw_identity
                page.locator('#renderer-shell').screenshot(path=str(OUT / f'list-{context}-{language}-{dark}.png'))
                # Caret folding is local and never overwrites the selected view.
                page.locator('#native-plan-caret').click(); expect(root).to_be_hidden()
                expect(page.locator('#native-plan-outline')).to_be_hidden()
                page.locator('#native-plan-caret').click(); expect(root).to_be_visible()
                expect(root).to_have_attribute('data-nautilus-view','list')
                expect(page.locator('#native-plan-outline')).to_be_visible()
                page.reload(); page.wait_for_function('()=>__chartEvaluator.completed || __chartEvaluator.error')
                expect(root).to_have_attribute('data-nautilus-view','list')
                expect(page.locator('svg.nautilus-log-svg')).to_have_count(0)
                switch.press('Enter'); expect(root.locator('.nautilus-desk')).to_be_visible()
                expect(page.locator('svg.nautilus-log-svg')).to_have_count(1)
                page.locator('#native-plan-caret').press('Enter'); expect(root).to_be_hidden()
                expect(page.locator('svg.nautilus-log-svg')).to_have_count(0)
                page.locator('#native-plan-caret').press('Enter'); expect(root).to_be_visible()
                expect(switch).to_have_attribute('aria-checked','true')
                # Connected Calendar stays between Help and the rightmost switch.
                page.evaluate('()=>{Object.assign(nautilusLogR3.settings,{"google-calendar-enabled":true,"google-calendar-configured":true});dispatchEvent(new Event("nautilus-log:settings-changed"))}')
                expect(root.locator('.nautilus-log-calendar-btn')).to_be_visible()
                assert controls.evaluate_all('es=>es.map(e=>e.matches("[role=switch]")?"view":e.matches(".nautilus-log-calendar-btn")?"calendar":"help")') == ['help','calendar','view']
                positions = controls.evaluate_all('es=>es.map(e=>e.getBoundingClientRect().x)')
                assert positions == sorted(positions) and len(set(positions)) == 3
                root.locator('.nautilus-log-help-btn').focus()
                page.keyboard.press('Tab'); expect(root.locator('.nautilus-log-calendar-btn')).to_be_focused()
                page.keyboard.press('Tab'); expect(switch).to_be_focused()
                assert page.evaluate('()=>__chartHarness.sourceRows()') == before
                assert f.state(page)['writes'] == 0
                report['matrix'].append({'context':context,'width':width,'language':language,'dark':dark,'roundTrip':True,'nativeFold':True,'persistedList':True,'writes':0})
            # Old Desk/Eye keys do not become a new view preference.
            page.evaluate('()=>{for(const key of Object.keys(localStorage))if(key.startsWith("nautilus-log:view:"))localStorage.removeItem(key);localStorage.setItem("nautilus-log:desk-view:v1:chart-desk-fixture:baseline-plan","false");localStorage.setItem("nautilus-log:collapsed:v2:baseline-plan:main","true")}')
            page.reload(); page.wait_for_function('()=>__chartEvaluator.completed || __chartEvaluator.error')
            expect(page.locator('.nautilus-log-container')).to_have_attribute('data-nautilus-view','chart')
            expect(page.locator('.nautilus-desk')).to_be_visible()
            # Older native markup may expose a caret directly under the main
            # row. Observe that caret, never the renderer's own label subtree.
            page.evaluate('()=>{const owner=document.getElementById("native-plan-owner"),caret=document.getElementById("native-plan-caret");caret.parentElement.replaceWith(caret);owner.classList.remove("rm-block--open","rm-block--closed")}')
            page.evaluate('()=>{const caret=document.getElementById("native-plan-caret");caret.classList.remove("rm-caret-open");caret.classList.add("rm-caret-closed")}')
            expect(page.locator('.nautilus-log-container')).to_be_hidden()
            page.evaluate('()=>{const caret=document.getElementById("native-plan-caret");caret.classList.remove("rm-caret-closed");caret.classList.add("rm-caret-open")}')
            expect(page.locator('.nautilus-log-container')).to_be_visible()
            report['caretOnlyHostFallback'] = True
            # A childless native block must retain the switch even if the host
            # labels it closed and hides its unusable caret.
            page.evaluate('()=>{document.getElementById("native-plan-caret").classList.add("rm-caret-hidden");document.getElementById("native-plan-owner").classList.add("rm-block--closed")}')
            expect(page.locator('.nautilus-log-container')).to_be_visible()
            report['legacyPreferencesIgnored'] = True
            report['childlessReachable'] = True
            page.evaluate('()=>__chartHarness.unmount()')
            expect(page.locator('[data-nautilus-desk-hidden]')).to_have_count(0)
        finally:
            browser.close()
    assert not errors, errors
    report['pageErrors'] = errors
    (OUT / 'result.json').write_text(json.dumps(report,indent=2))
    print(f'PASS: exact renderer chart/list, native caret, keyboard, preferences and outline identity; {OUT}')


if __name__ == '__main__': run()
