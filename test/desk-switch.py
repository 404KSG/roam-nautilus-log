#!/usr/bin/env python3
"""Real Desk controller, synthetic graph: switch state belongs to the session."""
import importlib.util
import json
import os
import re
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('desk_fixture', ROOT / 'test/desk-view.py')
fixture = importlib.util.module_from_spec(spec); spec.loader.exec_module(fixture)
OUT = Path(os.environ.get('DESK_SWITCH_OUT', '/tmp/nautilus-desk-switch'))
fixture.OUT = OUT


def settle(page):
    page.wait_for_function('''()=>[...document.querySelectorAll('.nautilus-log-desk-switch-track,.nautilus-log-desk-switch-thumb')].every(e=>e.getAnimations().every(a=>a.playState==='finished'))''')


def run():
    fixture.bundle()
    reports = []; errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            page = browser.new_page(viewport={'width': 1200, 'height': 1100})
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.route('https://desk-fixture.invalid/**', lambda route: route.fulfill(status=200, content_type='image/png', body=fixture.RASTER_640_360))
            page.goto((OUT / 'index.html').as_uri())
            page.wait_for_function('()=>Boolean(window.deskHarness?.mount)')
            for dark, width, motion in [(False, 720, 'no-preference'), (True, 720, 'no-preference'), (False, 280, 'reduce')]:
                page.emulate_media(reduced_motion=motion)
                page.evaluate('(o)=>deskHarness.mount(o)', {'count': 3, 'dark': dark, 'switchControl': True})
                page.locator('[data-fixture-host="plan-desk"]').evaluate('(e,w)=>e.style.width=w+"px"', width)
                owner = page.locator('[data-fixture-host="plan-desk"]')
                toggle = owner.get_by_role('switch', name='Desk', exact=True)
                other = page.get_by_role('switch', name='Other Desk', exact=True)
                expect(toggle).to_have_attribute('aria-checked', 'false')
                off = toggle.locator('.nautilus-log-desk-switch-thumb').bounding_box()
                toggle.focus(); toggle.press('Space')
                expect(toggle).to_have_attribute('aria-checked', 'true')
                assert toggle.evaluate('e=>e.matches(":focus-visible") && getComputedStyle(e).outlineStyle === "solid" && parseFloat(getComputedStyle(e).outlineWidth) >= 2')
                expect(owner.locator('.nautilus-desk')).to_have_attribute('data-status', 'ready')
                expect(other).to_have_attribute('aria-checked', 'false')
                settle(page)
                on = toggle.locator('.nautilus-log-desk-switch-thumb').bounding_box()
                assert abs(on['x'] - off['x'] - 12) < .5
                box = toggle.bounding_box(); assert box['height'] == 32 and box['width'] == 70
                assert toggle.get_attribute('aria-expanded') is None
                toggle.press('Enter')
                expect(toggle).to_have_attribute('aria-checked', 'false'); expect(owner.locator('.nautilus-desk')).to_have_count(0)
                toggle.click(); expect(toggle).to_have_attribute('aria-checked', 'true')
                page.evaluate('()=>deskHarness.api.reloadView()')
                expect(toggle).to_have_attribute('aria-checked', 'true'); expect(owner.locator('.nautilus-desk')).to_have_count(1)
                page.evaluate('()=>deskHarness.api.setCollapsed("plan-desk",true)')
                page.evaluate('()=>deskHarness.api.replaceControl()')
                page.evaluate('()=>deskHarness.api.setCollapsed("plan-desk",false)')
                toggle = owner.get_by_role('switch', name='Desk', exact=True)
                expect(toggle).to_have_attribute('aria-checked', 'true')
                toggle.focus(); page.keyboard.down('Alt')
                expect(owner.locator('.nautilus-desk__grid')).to_have_class(re.compile('rm-desk-overview--numbers'))
                page.keyboard.up('Alt'); toggle.press('Alt+1')
                expect(page.get_by_role('dialog', name='Desk', exact=True)).to_be_visible()
                page.get_by_role('dialog', name='Desk', exact=True).get_by_role('button', name='Close', exact=True).click()
                owner.get_by_role('button', name='Hide Desk', exact=True).click()
                expect(toggle).to_have_attribute('aria-checked', 'false'); expect(toggle).to_be_focused()
                expect(owner.locator('.nautilus-desk')).to_have_count(0)
                toggle.click(); expect(toggle).to_have_attribute('aria-checked', 'true')
                other.click(); expect(other).to_have_attribute('aria-checked', 'true')
                owner.get_by_role('button', name='Hide Desk', exact=True).click()
                expect(toggle).to_have_attribute('aria-checked', 'false'); expect(other).to_have_attribute('aria-checked', 'true')
                toggle.click(); settle(page)
                if motion == 'reduce':
                    duration = toggle.locator('.nautilus-log-desk-switch-thumb').evaluate('e=>parseFloat(getComputedStyle(e).transitionDuration)')
                    assert duration <= .001, duration
                owner.screenshot(path=str(OUT / f'switch-{width}-{"dark" if dark else "light"}.png'))
                before = page.evaluate('()=>({writes:deskHarness.api.stats.writes,native:deskHarness.api.stats.nativeWrites,forbidden:deskHarness.api.stats.forbiddenWrites})')
                assert before == {'writes': [], 'native': [], 'forbidden': 0}, before
                page.evaluate('()=>deskHarness.api.destroy()')
                expect(toggle).to_have_attribute('aria-checked', 'false'); expect(other).to_have_attribute('aria-checked', 'false')
                reports.append({'dark': dark, 'width': width, 'reducedMotion': motion == 'reduce', 'thumbTravel': on['x'] - off['x'],
                                'keyboard': True, 'restoration': True, 'replacementControl': True, 'latestControlFocus': True, 'hostIsolation': True, 'graphWrites': 0})
            assert not errors, errors
        finally:
            browser.close()
    (OUT / 'results.json').write_text(json.dumps({'result': 'PASS', 'cases': reports, 'pageErrors': errors}, indent=2))
    print(f'PASSED: Desk switch keyboard/state/restoration/remount/isolation/reduced-motion; artifacts: {OUT}')


if __name__ == '__main__':
    run()
