#!/usr/bin/env python3
"""Real Desk/search render with a test-only parser counter; no live graph or network."""
import json
import os
import subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ.get('DESK_PREVIEW_PERF_OUT', '/tmp/nautilus-desk-preview-performance'))


def run():
    OUT.mkdir(parents=True, exist_ok=True)
    subprocess.run(['node', str(ROOT / 'test/desk-preview-performance-bundle.cjs'), str(OUT)], cwd=ROOT, check=True)
    (OUT / 'index.html').write_text(f'''<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="{(ROOT / 'test/desk-native-fixture.css').as_uri()}">
<link rel="stylesheet" href="{(ROOT / 'extension.css').as_uri()}">
<style>.roam-article{{width:min(800px,100%);margin:auto;padding:30px 42px;}}
.fixture-shell{{height:130px;}}.fixture-owner{{margin-bottom:20px;}}</style></head>
<body><div id="rm-modal-portal" class="roam-lift-modal"></div>
<div class="roam-app"><div class="roam-main"><div class="rm-article-wrapper"><article class="roam-article">
<div id="launchers"></div><div id="page-after" contenteditable="true">Other page content.</div>
</article></div></div></div><script src="harness.js"></script></body></html>''')
    errors, requests = [], []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            page = browser.new_page(viewport={'width': 1280, 'height': 1000})
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.on('request', lambda request: requests.append(request.url) if request.url.startswith(('http:', 'https:')) else None)
            page.route('http://**/*', lambda route: route.abort())
            page.route('https://**/*', lambda route: route.abort())
            # Exercise the existing eager fallback to admit every card, including
            # those outside the viewport, before measuring a loaded redraw.
            page.add_init_script('window.IntersectionObserver = undefined;')
            page.goto((OUT / 'index.html').as_uri())
            page.evaluate('() => deskHarness.mount({count: 100})')
            page.get_by_role('button', name='Open Desk', exact=True).click()
            page.wait_for_function('() => document.querySelectorAll(\'.nautilus-desk__card[data-preview-state="ready"]\').length === 103')
            assert page.evaluate('() => deskPreviewPerformance.fallbackParses > 0'), 'Unloaded fallback must still parse; counter must be connected'
            before = page.locator('.nautilus-desk__card .rm-desk-tile__title').all_text_contents()
            page.evaluate('() => { deskPreviewPerformance.fallbackParses = 0; deskHarness.api.stats.reads.length = 0; }')
            page.get_by_role('textbox', name='Search Desk', exact=True).fill(' ')
            after = page.locator('.nautilus-desk__card .rm-desk-tile__title').all_text_contents()
            result = page.evaluate('''() => ({
              fallbackParses: deskPreviewPerformance.fallbackParses,
              graphReads: deskHarness.api.stats.reads.length,
              writes: deskHarness.api.stats.writes.length,
              nativeWrites: deskHarness.api.stats.nativeWrites.length,
              forbiddenWrites: deskHarness.api.stats.forbiddenWrites
            })''')
            result.update(cards=len(before), titlesUnchanged=before == after, pageErrors=errors, httpRequests=requests)
            page.evaluate('() => deskHarness.destroy()')
        finally:
            browser.close()
    (OUT / 'result.json').write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))
    assert result['cards'] == 103 and result['titlesUnchanged'] and not errors and not requests
    assert result['graphReads'] == result['writes'] == result['nativeWrites'] == result['forbiddenWrites'] == 0
    assert result['fallbackParses'] == 0, 'Loaded cards must not parse and discard fallback text during search render'


if __name__ == '__main__':
    run()
