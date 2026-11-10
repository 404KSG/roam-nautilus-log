#!/usr/bin/env python3
"""Renderer diagnostics must follow whole-widget folding, including sidebars."""
import importlib.util
import json
import os
import subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
os.environ['NAUTILUS_RENDERER_OUT'] = os.environ.get('NAUTILUS_NOTICE_OUT', '/tmp/nautilus-renderer-notice')
spec = importlib.util.spec_from_file_location('notice_chart_fixture', ROOT / 'test/chart-renderer.py')
f = importlib.util.module_from_spec(spec)
spec.loader.exec_module(f)
OUT = f.OUT
MESSAGE = 'The managed template has 2 renderer blocks. Keep one root; check unused references before removing them, then reload. Contents were preserved.'


def set_notice(page, text, language):
    page.evaluate('''({text,language}) => {
      nautilusLogR3.error = text;
      nautilusLogR3.settings.language = language;
      window.dispatchEvent(new Event('nautilus-log:settings-changed'));
    }''', {'text': text, 'language': language})


def run():
    (OUT / 'bundle').mkdir()
    subprocess.run(['node', 'test/chart-renderer-bundle.cjs', str(OUT / 'bundle')], cwd=ROOT, check=True)
    f.write_page(f.COMPONENT.read_text())
    cases, errors, requests = [], [], []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            page = browser.new_page(viewport={'width':1200,'height':1000})
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.on('request', lambda request: requests.append(request.url) if request.url.startswith(('http:', 'https:')) else None)
            for context, width in [('main',720),('sidebar',280),('embed',520)]:
                f.load(page, 'mixed', context, width)
                before = page.evaluate('() => __chartHarness.sourceRows()')
                set_notice(page, MESSAGE, 'zh')
                notice = page.locator('.nautilus-log-container > .nautilus-log-renderer-notice')
                expect(notice).to_have_text(MESSAGE)
                expect(notice).to_be_visible()
                header = page.locator('.nautilus-log-header')
                assert notice.bounding_box()['y'] + notice.bounding_box()['height'] <= header.bounding_box()['y'] + .5
                page.locator('.nautilus-log-header').screenshot(path=str(OUT / f'{context}-expanded-header.png'))
                collapse = page.locator('#native-plan-caret')
                collapse.press('Space')
                expect(collapse).to_have_attribute('aria-expanded', 'false')
                page.screenshot(path=str(OUT / f'{context}-collapsed.png'))
                expect(notice).to_be_hidden()
                assert notice.evaluate('e => e.getClientRects().length') == 0, 'A folded diagnostic must not overlap the following outline'
                expect(page.locator('svg.nautilus-log-svg')).to_have_count(0)
                collapse.press('Enter')
                expect(collapse).to_have_attribute('aria-expanded', 'true')
                expect(notice).to_be_visible()
                expect(notice).to_have_text(MESSAGE)
                set_notice(page, '', 'en')
                expect(notice).to_have_count(0)
                assert page.evaluate('() => __chartHarness.sourceRows()') == before
                assert f.state(page)['writes'] == 0
                cases.append({'context':context,'width':width,'hiddenWhileFolded':True,'restoredWhileExpanded':True,'clearedAfterRecovery':True,'graphWrites':0})
            # A folded ancestor must not style another renderer's own diagnostic.
            scope = page.evaluate('''() => {
              const outer=document.createElement('div');outer.className='nautilus-log-container nautilus-log-collapsed';
              const own=document.createElement('div');own.className='nautilus-log-renderer-notice';own.textContent='Outer notice';
              const inner=document.createElement('div');inner.className='nautilus-log-container';
              const nested=document.createElement('div');nested.className='nautilus-log-renderer-notice';nested.textContent='Inner notice';
              inner.append(nested);outer.append(own,inner);document.body.append(outer);
              const result={own:getComputedStyle(own).display,inner:getComputedStyle(nested).display};outer.remove();return result;
            }''')
            assert scope['own'] == 'none' and scope['inner'] != 'none', scope
        finally:
            browser.close()
    assert not errors and not requests, (errors, requests)
    report={'cases':cases,'ownedScope':scope,'pageErrors':errors,'httpRequests':requests,'componentSha256':f.sha(f.COMPONENT.read_text())}
    (OUT / 'result.json').write_text(json.dumps(report,indent=2))
    print(f'PASS: renderer notices follow fold/expand/recovery in main, sidebar and embed; {OUT}')


if __name__ == '__main__':
    run()
