#!/usr/bin/env python3
"""Actual Desk masonry in offline Chromium: bounded layout work and old/new geometry parity."""
import json
import os
import subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ.get('DESK_MASONRY_TEST_OUT', '/tmp/nautilus-desk-masonry'))


def run():
    OUT.mkdir(parents=True, exist_ok=True)
    subprocess.run(['node', str(ROOT / 'test/desk-masonry-bundle.cjs'), str(OUT)], cwd=ROOT, check=True)
    (OUT / 'index.html').write_text(f'''<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="{(ROOT / 'test/desk-native-fixture.css').as_uri()}">
<link rel="stylesheet" href="{(ROOT / 'extension.css').as_uri()}"></head>
<body><script src="masonry.js"></script></body></html>''')
    scenarios, errors, requests = [], [], []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            page = browser.new_page(viewport={'width': 1280, 'height': 1000})
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.on('request', lambda request: requests.append(request.url) if request.url.startswith(('http:', 'https:')) else None)
            page.route('http://**/*', lambda route: route.abort())
            page.route('https://**/*', lambda route: route.abort())
            page.goto((OUT / 'index.html').as_uri())
            page.evaluate('async () => { await document.fonts.ready; const h=Object.getOwnPropertyDescriptor(HTMLElement.prototype,"offsetHeight");window.tileHeightReads=0;Object.defineProperty(HTMLElement.prototype,"offsetHeight",{configurable:true,get(){if(this.classList.contains("nautilus-desk__card"))tileHeightReads++;return h.get.call(this)}}); }')
            cdp = page.context.new_cdp_session(page)
            cdp.send('Performance.enable')

            def metrics():
                return {row['name']: row['value'] for row in cdp.send('Performance.getMetrics')['metrics']}

            def settle():
                page.evaluate('() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')

            for count, width in [(20, 720), (100, 720), (300, 720), (100, 280)]:
                geometry = {}
                timings = {}
                for baseline in [True, False]:
                    name = 'baseline' if baseline else 'current'
                    page.evaluate('(options) => masonryHarness.prepare(options)', {'count': count, 'width': width, 'baseline': baseline})
                    settle()
                    before = metrics()
                    elapsed = page.evaluate('() => masonryHarness.layout()')
                    after = metrics()
                    timings[name] = {
                        'layouts': int(after['LayoutCount'] - before['LayoutCount']),
                        'layoutMs': (after['LayoutDuration'] - before['LayoutDuration']) * 1000,
                        'callMs': elapsed,
                    }
                    settle()
                    snapshots = {'initial': page.evaluate('() => masonryHarness.geometry()')}
                    page.evaluate('tileHeightReads=0')
                    page.evaluate('() => masonryHarness.changeCard()')
                    settle()
                    timings[name]['singleResizeHeightReads']=page.evaluate('tileHeightReads')
                    snapshots['previewResize'] = page.evaluate('() => masonryHarness.geometry()')
                    page.evaluate('(width) => masonryHarness.resize(width)', 280 if width == 720 else 720)
                    settle()
                    snapshots['viewportResize'] = page.evaluate('() => masonryHarness.geometry()')
                    page.evaluate('() => masonryHarness.removeCard()')
                    settle()
                    snapshots['removal'] = page.evaluate('() => masonryHarness.geometry()')
                    geometry[name] = snapshots
                    page.evaluate('() => masonryHarness.destroy()')
                assert geometry['current'] == geometry['baseline'], f'Geometry changed: {count} cards, {width}px'
                scenarios.append({'count': count, 'width': width, 'geometryMatches': True, **timings})
                (OUT / f'geometry-{count}-{width}.json').write_text(json.dumps(geometry['current'], indent=2))
        finally:
            browser.close()
    report = {'scenarios': scenarios, 'pageErrors': errors, 'httpRequests': requests,
              'scope': 'Offline Chromium with production masonry and native CSS fixture, not live Roam latency'}
    (OUT / 'result.json').write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))
    assert not errors and not requests
    assert all(row['current']['singleResizeHeightReads']<=4 for row in scenarios), 'One changed preview must not remeasure every unrelated card.'
    assert all(row['current']['layouts'] <= 4 for row in scenarios), 'Card count must not multiply synchronous browser layout passes'


if __name__ == '__main__':
    run()
