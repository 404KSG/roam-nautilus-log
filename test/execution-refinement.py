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


def contrast_ratio(foreground, background):
    alpha = foreground[3] if len(foreground) > 3 else 1
    foreground = [alpha * channel + (1 - alpha) * background[index] for index, channel in enumerate(foreground[:3])]
    def luminance(color):
        channels = [channel / 255 for channel in color[:3]]
        linear = [channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4 for channel in channels]
        return sum(channel * weight for channel, weight in zip(linear, (0.2126, 0.7152, 0.0722)))
    low, high = sorted((luminance(foreground), luminance(background)))
    return (high + 0.05) / (low + 0.05)


def add_review_contrast_fixture(page):
    page.evaluate('''() => {
      const fixture = document.createElement('div');
      fixture.dataset.executionContrastFixture = 'true';
      fixture.innerHTML = `<section class="nautilus-log-timing__review-summary">
        <div class="nautilus-log-timing__review-counts">Completed <strong>1/2</strong></div>
        <div class="nautilus-log-timing__review-totals">Planned <strong>2h</strong></div>
      </section>
      <div class="nautilus-log-timing__review-row">
        <span class="nautilus-log-timing__review-state">Compared</span>
        <div class="nautilus-log-timing__review-row-metrics">Planned 1h</div>
      </div>`;
      document.querySelector('.nautilus-log-timing__popover').append(fixture);
    }''')


def assert_text_contrast(page, selectors, label, *, warning=False):
    samples = page.evaluate('''({selectors, warning}) => {
      const rgba = (paint) => {
        const values = (paint.match(/[\\d.]+/g) || []).map(Number);
        return values.length >= 3 ? [...values.slice(0, 3), values[3] ?? 1] : [0, 0, 0, 0];
      };
      const blend = (foreground, background) => foreground.slice(0, 3).map(
        (channel, index) => channel * foreground[3] + background[index] * (1 - foreground[3]),
      );
      const ancestors = (element) => {
        const nodes = [];
        for (let node = element; node; node = node.parentElement) nodes.unshift(node);
        return nodes;
      };
      const effectiveBackground = (element) => ancestors(element).reduce(
        (background, node) => blend(rgba(getComputedStyle(node).backgroundColor), background), [255, 255, 255],
      );
      const effectiveOpacity = (element) => ancestors(element).reduce(
        (opacity, node) => opacity * Number(getComputedStyle(node).opacity), 1,
      );
      const samplesBySelector = Object.fromEntries(selectors.map((selector) => [selector, [...document.querySelectorAll(selector)].map((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        const sample = {selector, color: rgba(style.color), background: effectiveBackground(element), opacity: effectiveOpacity(element), visible: style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0};
        if (warning) {
          const probe = document.createElement('span');
          probe.style.color = 'var(--nl-exec-warning)';
          element.append(probe);
          sample.warningToken = rgba(getComputedStyle(probe).color);
          probe.remove();
        }
        return sample;
      })]));
      return samplesBySelector;
    }''', {'selectors': selectors, 'warning': warning})
    missing = [selector for selector, samples in samples.items() if not samples]
    hidden = [selector for selector, samples in samples.items() if not all(sample['visible'] for sample in samples)]
    assert not missing, (label, 'missing selectors', missing)
    assert not hidden, (label, 'hidden selectors', hidden)
    flat_samples = [sample for samples in samples.values() for sample in samples]
    assert all(sample['opacity'] == 1 for sample in flat_samples), (label, 'non-opaque ancestry', flat_samples)
    ratios = [contrast_ratio(sample['color'], sample['background']) for sample in flat_samples]
    assert all(score >= 4.5 for score in ratios), (label, [{'selector': sample['selector'], 'ratio': score, 'color': sample['color'], 'background': sample['background'], 'opacity': sample['opacity']} for sample, score in zip(flat_samples, ratios)])
    if warning:
        assert all(sample['color'] == sample['warningToken'] for sample in flat_samples), (label, flat_samples)


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
            expect(panel).to_contain_text('56% free · 8h53m free')
            page.evaluate('''() => {
                window.originalComplete = document.querySelector('.nautilus-log-timing__icon-button.is-complete');
                originalComplete.focus();
                energyBarHarness.api.tickMinute(3);
            }''')
            expect(page.locator('.nautilus-log-timing__capacity-value')).to_have_text('55%')
            expect(panel).to_contain_text('55% free · 8h50m free')
            expect(page.locator('.nautilus-log-timing__row-meta').first).to_contain_text('10:10–11:10')
            assert page.evaluate('() => originalComplete.isConnected && document.activeElement === originalComplete')
            page.screenshot(path=str(OUT / 'capacity.png'))
            assert_text_contrast(page, [
                '.nautilus-log-timing__capacity',
                '.nautilus-log-timing__plan-heading',
                '.nautilus-log-timing__row-meta',
            ], 'light execution metadata')
            page.get_by_role('tab', name='Review', exact=True).click()
            add_review_contrast_fixture(page)
            assert_text_contrast(page, [
                '.nautilus-log-timing__review-counts',
                '.nautilus-log-timing__review-totals',
                '.nautilus-log-timing__review-row-metrics',
                '.nautilus-log-timing__review-state',
            ], 'light review metadata')

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

            page.evaluate('''() => energyBarHarness.mount({
                tasks: energyBarHarness.tasks.WARNING_TASKS,
            })''')
            fixture.open_plan(page)
            assert_text_contrast(page, ['.nautilus-log-timing__capacity-part.is-warning strong'], 'light execution warning', warning=True)

            for theme in ('bp3-dark', 'dark'):
                page.evaluate('''theme => { document.body.className = theme; energyBarHarness.mount(); }''', theme)
                fixture.open_plan(page)
                assert_text_contrast(page, [
                    '.nautilus-log-timing__capacity',
                    '.nautilus-log-timing__plan-heading',
                    '.nautilus-log-timing__row-meta',
                ], f'{theme} execution metadata')
                page.get_by_role('tab', name='Review', exact=True).click()
                add_review_contrast_fixture(page)
                assert_text_contrast(page, [
                    '.nautilus-log-timing__review-counts',
                    '.nautilus-log-timing__review-totals',
                    '.nautilus-log-timing__review-row-metrics',
                    '.nautilus-log-timing__review-state',
                ], f'{theme} review metadata')
                page.evaluate('''theme => { document.body.className = theme; energyBarHarness.mount({ tasks: energyBarHarness.tasks.WARNING_TASKS }); }''', theme)
                fixture.open_plan(page)
                assert_text_contrast(page, ['.nautilus-log-timing__capacity-part.is-warning strong'], f'{theme} execution warning', warning=True)
            page.evaluate('''() => { document.body.className = ''; energyBarHarness.mount({ tasks: [] }); }''')
            page.locator('.nautilus-log-timing__capacity-token').click()
            page.wait_for_selector('.nautilus-log-timing__popover')
            page.get_by_role('tab', name='Plan', exact=True).click()
            assert_text_contrast(page, ['.nautilus-log-timing__empty'], 'light execution empty state')
            page.evaluate('() => energyBarHarness.destroy()')
            assert not errors, errors
            (OUT / 'results.json').write_text(json.dumps({'status': 'passed', 'pageerrors': errors}, indent=2))
            print(f'PASSED: execution refinement; artifacts: {OUT}')
        finally:
            browser.close()


if __name__ == '__main__':
    run()
