#!/usr/bin/env python3
"""Collapse regression with the production Desk/CSS and renderer-shaped DOM.
The graph/editor are synthetic; no real Roam content is read or changed.
A folded chart hides the complete Desk UI but retains its narrow raw-outline claim;
its saved preference restores cards only after the chart expands again.
"""
import importlib.util
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ.get('DESK_COLLAPSE_TEST_OUT', '/tmp/nautilus-desk-collapse'))
spec = importlib.util.spec_from_file_location('desk_fixture', ROOT / 'test/desk-view.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
fixture.OUT = OUT

MEASURE = '''() => {
 const owner=document.querySelector('[data-fixture-host="plan-desk"]');
 const widget=owner.querySelector('.nautilus-log-container');
 const desk=owner.querySelector('.nautilus-desk');
 const next=document.querySelector('[data-collapse-neighbor]');
 const r=desk?.getBoundingClientRect(), n=next.getBoundingClientRect();
 const prefix=owner.querySelector('.fixture-plan-title').getBoundingClientRect();
 const visible=Boolean(desk && desk.getClientRects().length>0 && getComputedStyle(desk).visibility!=='hidden');
 return {collapsed:widget.classList.contains('nautilus-log-collapsed'), widgetHeight:widget.getBoundingClientRect().height,
   deskVisible:visible, deskTop:r?.top ?? null, deskBottom:r?.bottom ?? null, followingTop:n.top, overlap:visible && n.top<r.bottom,
   prefixBottom:prefix.bottom, overlapsPrefix:visible && r.top<prefix.bottom,
   deskCount:document.querySelectorAll('.nautilus-desk').length, deskHidden:Boolean(desk?.hidden), focusLayers:document.querySelectorAll('.nautilus-desk__focus-layer').length,
   contained:Boolean(desk && widget.contains(desk))};
}'''


def run():
    fixture.bundle()
    # Optional A/B replay against an exact tracked stylesheet. Runtime code and
    # renderer-shaped DOM stay identical; no production file is modified.
    baseline = os.environ.get('DESK_COLLAPSE_BASELINE_CSS')
    if baseline:
        index = OUT / 'index.html'
        source = (ROOT / 'extension.css').as_uri()
        html = index.read_text()
        assert source in html
        index.write_text(html.replace(source, Path(baseline).resolve().as_uri()))
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True)
        try:
            page=browser.new_page(viewport={'width':1280,'height':900})
            page.goto((OUT/'index.html').as_uri())
            page.wait_for_function('() => window.deskHarness?.mount')
            errors=[]
            page.on('pageerror',lambda error:errors.append(str(error)))
            results=[]

            def settle():
                page.evaluate('() => new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')

            def add_neighbor():
                page.evaluate('''() => {
                  const owner=document.querySelector('[data-fixture-host="plan-desk"]');
                  const next=document.createElement('div'); next.dataset.collapseNeighbor='';
                  next.textContent='[[Following outline block]]'; owner.after(next);
                }''')

            def assert_layout(expect_desk=True):
                settle()
                result=page.evaluate(MEASURE)
                (OUT/'collapse-measurements.json').write_text(json.dumps(result,indent=2))
                page.screenshot(path=str(OUT/'collapsed.png'),full_page=True)
                print(json.dumps(result))
                assert not result['overlap'], 'Collapsed Desk content escaped its zero-height widget and overlaps the following outline block.'
                assert not result['overlapsPrefix'], 'Collapsed Desk must remain below its own block title.'
                if expect_desk:
                    assert not result['deskVisible'] and result['contained'] and result['deskHidden'], 'Collapse must hide the entire Desk while retaining its scoped outline claim.'
                    assert result['deskCount'] == 1 and result['focusLayers'] == 0, 'Collapse must also remove any native-focus dialog layer.'
                else:
                    assert result['deskCount'] == 0 and result['focusLayers'] == 0, 'Desk-off cleanup must not leave hidden UI behind.'
                assert result['widgetHeight'] == 0, 'Collapsed geometry must remain compact with no reserved Desk space.'
                results.append(result)

            for count in [0,3]:
                page.evaluate('(count) => deskHarness.mount({count})',count)
                page.get_by_role('button',name='Open Desk',exact=True).click()
                expect(page.locator('.nautilus-desk')).to_have_attribute('data-status','ready')
                add_neighbor()
                owner=page.locator('[data-fixture-host="plan-desk"]')
                if not count:
                    expect(owner.locator('.nautilus-desk__card')).to_have_count(0)
                page.evaluate('window.originalDesk=document.querySelector(".nautilus-desk")')
                initial=page.evaluate('() => deskHarness.api.children("plan-desk")')
                for _ in range(3):
                    owner.get_by_role('button',name='Collapse Nautilus Log',exact=True).click()
                    expect(owner.get_by_role('button',name='Expand Nautilus Log',exact=True)).to_be_visible()
                    assert_layout()
                    expect(owner.locator('.fixture-raw')).to_be_hidden()
                    owner.get_by_role('button',name='Expand Nautilus Log',exact=True).click()
                    expect(owner.locator('.fixture-shell')).to_be_visible()
                    expect(owner.locator('.nautilus-desk')).to_be_visible()
                    assert page.evaluate('() => originalDesk===document.querySelector(".nautilus-desk")')
                if count:
                    owner.locator('.nautilus-desk__card').first.locator('[role="button"]').click()
                    expect(page.locator('.nautilus-desk__focus-layer')).to_have_count(1)
                    page.evaluate('() => deskHarness.api.setCollapsed("plan-desk", true)')
                    assert_layout()
                    expect(owner.locator('.fixture-raw')).to_be_hidden()
                    owner.get_by_role('button',name='Expand Nautilus Log',exact=True).click()
                    expect(owner.locator('.nautilus-desk')).to_be_visible()
                assert page.evaluate('() => deskHarness.api.children("plan-desk")') == initial
                assert page.evaluate('() => deskHarness.api.stats.writes.length') == 0
                assert page.evaluate('() => localStorage.getItem("nautilus-log:desk-view:v1:desk-fixture:plan-desk")') == 'true'

                owner.get_by_role('button',name='Collapse Nautilus Log',exact=True).click()
                page.evaluate('() => deskHarness.api.reloadView()')
                assert_layout()
                expect(owner.locator('.fixture-raw')).to_be_hidden()
                owner.get_by_role('button',name='Expand Nautilus Log',exact=True).click()
                expect(owner.locator('.nautilus-desk')).to_be_visible()
                page.get_by_role('button',name='Hide Desk',exact=True).click()
                expect(owner.locator('.fixture-raw')).to_be_visible()
                owner.get_by_role('button',name='Collapse Nautilus Log',exact=True).click()
                assert_layout(expect_desk=False)
                expect(owner.locator('.fixture-raw')).to_be_visible()
                owner.get_by_role('button',name='Expand Nautilus Log',exact=True).click()
                owner.get_by_role('button',name='Open Desk',exact=True).click()
                owner.get_by_role('button',name='Collapse Nautilus Log',exact=True).click()
                assert_layout()

            # A fresh, already-collapsed renderer keeps the preference dormant
            # until expand. Its sidebar replica has an independent collapse state.
            page.evaluate('() => deskHarness.mount({count:3,collapsed:true,preservePreferences:true})')
            add_neighbor()
            assert_layout()
            expect(page.locator('[data-fixture-host="plan-desk"] .fixture-raw')).to_be_hidden()
            page.locator('[data-fixture-host="plan-desk"]').get_by_role('button',name='Expand Nautilus Log',exact=True).click()
            expect(page.locator('[data-fixture-host="plan-desk"] .nautilus-desk')).to_be_visible()
            page.evaluate('() => deskHarness.api.openCopy()')
            sidebar=page.locator('[data-fixture-host="copy"]')
            expect(sidebar.locator('.nautilus-desk')).to_be_visible()
            sidebar.get_by_role('button',name='Collapse Nautilus Log',exact=True).click()
            assert sidebar.locator('.nautilus-desk').count() == 1
            expect(sidebar.locator('.nautilus-desk')).to_be_hidden()
            assert sidebar.locator('.nautilus-log-container').evaluate('(el) => el.getBoundingClientRect().height') == 0
            assert not page.locator('[data-fixture-host="plan-desk"] .nautilus-log-container').evaluate('(el) => el.classList.contains("nautilus-log-collapsed")')
            sidebar.get_by_role('button',name='Expand Nautilus Log',exact=True).click()
            expect(sidebar.locator('.nautilus-desk')).to_be_visible()
            page.evaluate('() => deskHarness.destroy()')
            expect(page.locator('[data-nautilus-desk-active]')).to_have_count(0)
            assert not errors,errors
            (OUT/'results.json').write_text(json.dumps({'status':'passed','measurements':results,'pageerrors':errors},indent=2))
            print(f'PASSED: collapse/expand, following-block layout, persisted restoration, sidebar isolation, cleanup; artifacts: {OUT}')
        finally:
            browser.close()


if __name__=='__main__':
    run()
