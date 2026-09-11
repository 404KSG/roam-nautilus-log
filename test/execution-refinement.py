#!/usr/bin/env python3
"""Rendered execution regressions using synthetic tasks; never connects to Roam."""
import importlib.util
import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
OUT = Path('/tmp/nautilus-execution-refinement')
spec = importlib.util.spec_from_file_location('energy_fixture', ROOT / 'test/energy-bar-settlement.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
fixture.OUT = OUT


def run():
    fixture.bundle()
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            page = browser.new_page(viewport={'width': 1280, 'height': 720})
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto((OUT / 'index.html').as_uri())
            page.wait_for_function('() => window.energyBarHarness?.mount')

            page.evaluate('''() => energyBarHarness.mount({
                workdayStart: 21, workdayEnd: 3, now: new Date(2026, 8, 9, 23, 30)
            })''')
            fixture.open_plan(page)
            rows = page.locator('.nautilus-log-timing__row-meta')
            expect(rows.nth(0)).to_have_text('Today 23:30–next day 00:30 · Planned 1h')
            expect(rows.nth(1)).to_have_text('next day 00:30–next day 01:30 · Planned 1h')
            page.screenshot(path=str(OUT / 'overnight.png'))

            page.evaluate('''() => energyBarHarness.mount({
                now: new Date(2026, 8, 9, 10, 7)
            })''')
            fixture.open_plan(page)
            layout_reads = page.evaluate('''() => {
                let count=0;const original=Element.prototype.getBoundingClientRect;
                Element.prototype.getBoundingClientRect=function(...args){count++;return original.apply(this,args);};
                try {energyBarHarness.api.tickMinute(0);} finally {Element.prototype.getBoundingClientRect=original;}
                return count;
            }''')
            assert layout_reads == 0, f'unchanged time tick performed {layout_reads} geometry reads'
            panel = page.locator('.nautilus-log-timing__capacity')
            expect(panel).to_contain_text('56% left · 8h53m free')
            page.evaluate('''() => {
                window.originalComplete = document.querySelector('.nautilus-log-timing__icon-button.is-complete');
                originalComplete.focus();
                energyBarHarness.api.tickMinute(3);
            }''')
            expect(page.locator('.nautilus-log-timing__capacity-value')).to_have_text('55%')
            expect(panel).to_contain_text('55% left · 8h50m free')
            expect(page.locator('.nautilus-log-timing__row-meta').first).to_contain_text('10:10–11:10')
            assert page.evaluate('() => originalComplete.isConnected && document.activeElement === originalComplete')
            page.screenshot(path=str(OUT / 'capacity.png'))

            timing = page.get_by_role('tab', name='Timing', exact=True)
            timing.focus()
            page.keyboard.press('Enter')
            expect(page.get_by_role('tab', name='Timing', exact=True)).to_be_focused()
            page.keyboard.press('ArrowRight')
            plan = page.get_by_role('tab', name='Plan', exact=True)
            expect(plan).to_be_focused()
            expect(plan).to_have_attribute('aria-selected', 'true')
            page.keyboard.press('End')
            expect(page.get_by_role('tab', name='Review', exact=True)).to_be_focused()
            page.keyboard.press('Home')
            expect(page.get_by_role('tab', name='Timing', exact=True)).to_be_focused()
            page.get_by_role('tab', name='Plan', exact=True).click()
            page.locator('.nautilus-log-timing__icon-button.is-complete').first.focus()
            page.keyboard.press('Enter')
            expect(page.locator('.nautilus-log-timing__row')).to_have_count(1)
            expect(page.locator('.nautilus-log-timing__icon-button.is-complete').first).to_be_focused()
            page.evaluate('() => energyBarHarness.api.failNextComplete()')
            page.keyboard.press('Enter')
            expect(page.locator('.nautilus-log-timing__notice')).to_contain_text('complete failed')
            expect(page.locator('.nautilus-log-timing__icon-button.is-complete').first).to_be_focused()
            page.keyboard.press('Enter')
            expect(page.locator('.nautilus-log-timing__row')).to_have_count(0)
            expect(page.get_by_role('tab', name='Plan', exact=True)).to_be_focused()
            page.keyboard.press('Escape')
            expect(page.locator('.nautilus-log-timing__popover')).to_have_count(0)
            expect(page.locator('.nautilus-log-timing__trigger')).to_be_focused()
            page.keyboard.press('Enter')
            expect(page.get_by_role('tab', name='Plan', exact=True)).to_be_focused()

            page.evaluate('''() => energyBarHarness.mount({tasks: Array.from({length: 25}, (_, i) => ({
                uid: `task-${i}`, title: `Task ${i}`, status: 'TODO', plannedMinutes: 10, remainingMinutes: 10
            }))})''')
            fixture.open_plan(page)
            task = page.locator('[data-task-uid="task-10"] .is-complete')
            task.focus()
            before = page.locator('.nautilus-log-timing__list').evaluate('(el) => el.scrollTop')
            assert before > 0
            page.keyboard.press('Enter')
            expect(page.locator('[data-task-uid="task-10"]')).to_have_count(0)
            expect(page.locator('[data-task-uid="task-11"] .is-complete')).to_be_focused()
            after = page.locator('.nautilus-log-timing__list').evaluate('(el) => el.scrollTop')
            assert abs(before - after) <= 1, (before, after)
            page.evaluate('() => energyBarHarness.destroy()')
            assert not errors, errors
            (OUT / 'results.json').write_text(json.dumps({'status': 'passed', 'pageerrors': errors}, indent=2))
            print(f'PASSED: execution refinement; artifacts: {OUT}')
        finally:
            browser.close()


if __name__ == '__main__':
    run()
