#!/usr/bin/env python3
"""Opt-in diagnostics: privacy, geometry capture, close reasons, and cleanup.
Uses production view/commands with a synthetic graph; never a live Roam window.
"""
import importlib.util
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ.get('DESK_DIAGNOSTICS_TEST_OUT', '/tmp/nautilus-desk-diagnostics'))
spec = importlib.util.spec_from_file_location('desk_fixture', ROOT / 'test/desk-view.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
fixture.OUT = OUT
PREFIX = 'Nautilus Log: '


def run():
    fixture.bundle()
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            page = browser.new_page(viewport={'width': 1280, 'height': 1000}, accept_downloads=True)
            errors, network = [], []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto((OUT / 'index.html').as_uri())
            page.wait_for_function('() => window.deskHarness?.mount')
            page.evaluate('() => document.fonts.ready.then(() => true)')
            page.evaluate('() => deskHarness.mount({count:4})')
            page.evaluate('() => deskHarness.api.setString("task-0", "{{[[TODO]]}} PRIVATE_NOTE_SENTINEL 30m")')
            page.on('request', lambda request: network.append(request.url) if request.url.startswith(('http:', 'https:')) else None)

            def command(name):
                page.evaluate('(label) => deskHarness.api.runDiagnosticCommand(label)', PREFIX + name)

            def report():
                return page.evaluate('() => deskHarness.api.diagnosticReport()')

            def settle():
                page.evaluate('() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))))')

            def open_focus():
                page.locator('[data-task-uid="task-0"] .rm-desk-tile__preview').click()
                expect(page.locator('.nautilus-desk__native')).to_have_attribute('data-task-uid', 'task-0')
                expect(page.locator('.nautilus-desk__focus-body > [role="status"]')).to_be_hidden()

            assert len(page.evaluate('() => deskHarness.api.diagnosticCommands()')) == 3
            assert report()['enabled'] is False and report()['events'] == []
            command('Show Desk diagnostics')
            panel = page.get_by_role('region', name='Desk diagnostics', exact=True)
            expect(panel).to_be_visible()
            assert report()['events'] == [], 'Showing the panel while off must not sample layout'
            panel.get_by_role('button', name='Close diagnostics', exact=True).click()
            expect(panel).to_have_count(0)

            storage = page.evaluate('() => JSON.stringify(localStorage)')
            command('Start Desk diagnostics (temporary)')
            assert report()['enabled'] is True
            assert page.evaluate('() => JSON.stringify(localStorage)') == storage, 'Diagnostics must not persist its switch or records'
            expect(panel).to_have_count(0)
            page.get_by_role('button', name='Open Desk', exact=True).click()
            expect(page.locator('.nautilus-desk')).to_have_attribute('data-status', 'ready')
            settle()
            events = report()['events']
            assert any(e['reason'] == 'before-open' and not e['layout']['surfaces'][0]['deskMounted'] for e in events)
            assert any(e['reason'] == 'after-open' and e['layout']['surfaces'][0]['deskMounted'] for e in events)

            count = len(events)
            page.evaluate('''() => { const input = document.createElement('input'); input.id = 'unrelated-private-input';
              input.value = 'PRIVATE_INPUT_SENTINEL'; document.body.append(input); }''')
            page.locator('#unrelated-private-input').fill('PRIVATE_TYPED_SENTINEL')
            page.keyboard.type('unrelated-letters')
            settle()
            assert len(report()['events']) == count, 'Ordinary typing must not be logged'
            page.evaluate('() => document.querySelector("#unrelated-private-input").remove()')

            open_focus()
            page.keyboard.press('Escape')
            expect(page.locator('.nautilus-desk__focus-layer')).to_have_count(0)
            settle()
            assert any(e['reason'] == 'shortcut-back' and e.get('trustedAction') is True for e in report()['events'])
            assert any(e['reason'] == 'focus-escape' for e in report()['events'])
            open_focus()
            page.locator('.rm-desk__side--end').get_by_role('button', name='Close', exact=True).click()
            settle()
            assert any(e['reason'] == 'focus-close-button' for e in report()['events'])
            open_focus()
            page.locator('.rm-desk-backdrop').click(position={'x': 5, 'y': 5})
            settle()
            assert any(e['reason'] == 'focus-backdrop' for e in report()['events'])
            open_focus()
            page.evaluate('() => { location.hash = "PRIVATE_ROUTE_SENTINEL"; }')
            expect(page.locator('.nautilus-desk__focus-layer')).to_have_count(0)
            settle()
            assert any(e['reason'] == 'focus-hashchange' for e in report()['events'])

            # Capture first; the fixed diagnostic UI must not move page content,
            # lock scrolling, or steal the active editor/card focus.
            page.evaluate('window.focusBeforeDiagnosticPanel = document.activeElement')
            geometry = page.locator('.nautilus-desk').evaluate('el => ({x:el.getBoundingClientRect().x,width:el.getBoundingClientRect().width,overflow:document.body.style.overflow})')
            command('Show Desk diagnostics')
            expect(panel).to_be_visible()
            assert page.evaluate('() => document.activeElement === focusBeforeDiagnosticPanel')
            assert page.locator('.nautilus-desk').evaluate('el => ({x:el.getBoundingClientRect().x,width:el.getBoundingClientRect().width,overflow:document.body.style.overflow})') == geometry
            panel.get_by_role('button', name='Capture layout', exact=True).click()
            value = panel.get_by_role('textbox', name='Desk diagnostic report').input_value()
            for private in ['PRIVATE_NOTE_SENTINEL', 'PRIVATE_INPUT_SENTINEL', 'PRIVATE_TYPED_SENTINEL', 'PRIVATE_ROUTE_SENTINEL', 'plan-desk', 'task-0', 'October 26th', 'desk-fixture', 'unrelated-letters']:
                assert private not in value, private
            parsed = json.loads(value)
            assert parsed['revision'] == 'd' * 40
            surface = parsed['events'][-1]['layout']['surfaces'][0]
            assert surface['cardCount'] == 7 and surface['grid']['width'] > 0
            assert surface['ancestors'] and surface['wrapper']['scrollWidth'] > 0
            with page.expect_download() as downloaded:
                panel.get_by_role('button', name='Download report', exact=True).click()
            downloaded.value.save_as(str(OUT / 'exported-report.json'))
            exported = json.loads((OUT / 'exported-report.json').read_text())
            assert exported == report()
            assert not network, network
            assert page.evaluate('() => deskHarness.api.stats.writes.length + deskHarness.api.stats.nativeWrites.length') == 0
            page.screenshot(path=str(OUT / 'diagnostics-panel.png'), full_page=True)

            panel.get_by_role('button', name='Stop and clear', exact=True).click()
            assert report()['enabled'] is False and report()['events'] == []
            assert json.loads(panel.get_by_role('textbox', name='Desk diagnostic report').input_value())['events'] == []
            assert page.evaluate('() => deskHarness.api.captureDiagnostic("manual")') is False
            panel.get_by_role('button', name='Close diagnostics', exact=True).click()

            command('Start Desk diagnostics (temporary)')
            open_focus()
            page.locator('.nautilus-desk__focus-layer').evaluate('el => el.remove()')
            settle()
            assert any(e['reason'] == 'focus-layer-detached' for e in report()['events'])
            page.evaluate('() => deskHarness.api.reloadView()')
            settle()
            assert report()['enabled'] is False and report()['events'] == []
            assert len(page.evaluate('() => deskHarness.api.diagnosticCommands()')) == 3
            command('Start Desk diagnostics (temporary)')
            command('Show Desk diagnostics')
            panel.get_by_role('button', name='Close diagnostics', exact=True).click()
            assert report()['enabled'] is False and report()['events'] == []
            command('Start Desk diagnostics (temporary)')
            page.evaluate('() => deskHarness.destroy()')
            assert report()['enabled'] is False and report()['events'] == []
            assert page.evaluate('() => deskHarness.api.diagnosticCommands()') == []
            expect(panel).to_have_count(0)
            assert not errors, errors
            result = {'status': 'passed', 'defaultOff': True, 'localOnly': True, 'graphWrites': 0,
                      'inputLogging': False, 'persistentStorage': False, 'outboundRequests': network,
                      'reasonTypes': sorted({e['reason'] for e in exported['events']}), 'pageerrors': errors}
            (OUT / 'results.json').write_text(json.dumps(result, indent=2))
            print('PASSED: diagnostic privacy, layout/close capture, export, off/reset/unload;', OUT)
        finally:
            browser.close()


if __name__ == '__main__':
    run()
