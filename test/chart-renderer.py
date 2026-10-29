#!/usr/bin/env python3
"""Actual Scittle/Reagent regression gate for the stable chart workspace."""
import hashlib
import json
import os
import subprocess
import sys
from urllib.parse import urlencode
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
# Inputs deliberately remain inside ROOT (or its installed dependencies). Historical
# evidence can be supplied as an opt-in report annotation, never as a test input.
OUTPUT_BASE = Path(os.environ.get('NAUTILUS_RENDERER_OUT', '/tmp/nautilus-renderer'))
COMPONENT = ROOT / 'src/component.cljs'
NODE_MODULES = Path(os.environ.get('NAUTILUS_NODE_MODULES', ROOT / 'node_modules'))
NATIVE_CSS = [Path(value) for value in os.environ.get('NAUTILUS_NATIVE_CSS', '').split(os.pathsep) if value]
EXPECTED_CONSOLE_WARNINGS = (
    'ReactDOM.render is no longer supported',
    'Each child in a list should have a unique "key" prop',
)


def sha256_bytes(value):
    return hashlib.sha256(value).hexdigest()


def sha256(path):
    return sha256_bytes(path.read_bytes())



def reserve_output_directory():
    candidate = OUTPUT_BASE
    suffix = 1
    while candidate.exists():
        candidate = OUTPUT_BASE.with_name(f'{OUTPUT_BASE.name}-{suffix}')
        suffix += 1
    candidate.mkdir(parents=True)
    return candidate


OUT = reserve_output_directory()



def script_tag(source, marker):
    # Do not add a newline or other wrapper to the production evaluator input.
    if '</script' in source.lower():
        raise RuntimeError('Component source cannot safely be embedded without changing evaluator input')
    return f'<script type="application/x-scittle" data-chart-eval="{marker}">{source}</script>'


def write_page(component_source):
    shim = '''(ns roam.datascript)
(defn q [query & args]
  (.apply (.-q js/window.__chartHarness) nil
          (clj->js (into [query] args))))'''
    mount = '''(require '[reagent.dom :as rdom])
(rdom/render [nautilus-log-v1/main {:block-uid "baseline-plan"}]
             (.getElementById js/document "chart-root"))'''
    html = f'''<!doctype html>
<html><head><meta charset="utf-8">
{''.join(f'<link rel="stylesheet" href="{path.resolve().as_uri()}">' for path in NATIVE_CSS)}
<link rel="stylesheet" href="{(ROOT / 'extension.css').as_uri()}">
<style>
body {{ margin: 0; color: #25262a; font: 14px system-ui, sans-serif; }}
#renderer-shell {{ width: 960px; margin: 24px; }}
#following-sentinel {{ height: 40px; background: #eee; margin-top: 12px; }}
</style>
<script>
window.__chartRealDate = window.Date;
window.__chartFakeNowMs = window.Date.parse('2026-10-29T08:01:00');
window.Date = class ChartFakeDate extends window.__chartRealDate {{
  constructor(...args) {{ super(...(args.length ? args : [window.__chartFakeNowMs])); }}
  static now() {{ return window.__chartFakeNowMs; }}
}};
</script>
<script src="{(NODE_MODULES / 'react/umd/react.development.js').as_uri()}"></script>
<script src="{(NODE_MODULES / 'react-dom/umd/react-dom.development.js').as_uri()}"></script>
<script src="{(NODE_MODULES / 'scittle/dist/scittle.js').as_uri()}"></script>
<script src="{(NODE_MODULES / 'scittle/dist/scittle.reagent.js').as_uri()}"></script>
<script src="{(NODE_MODULES / 'scittle/dist/scittle.pprint.js').as_uri()}"></script>
<script src="{(OUT / 'bundle/chart-renderer-harness.js').as_uri()}"></script>
</head><body>
<div id="main-render-context"><div id="renderer-shell" data-chart-context="main"><div id="chart-root"></div><div id="following-sentinel">Following content sentinel</div></div></div>
<div id="roam-right-sidebar-content"><div class="roam-right-sidebar-content" id="sidebar-render-context"></div></div>
<div class="rm-embed-container" id="embed-render-context"></div>
<script>
const chartContext = new URLSearchParams(location.search).get('context') || 'main';
const shell = document.querySelector('#renderer-shell');
const parent = chartContext === 'sidebar' ? document.querySelector('#sidebar-render-context')
  : chartContext === 'embed' ? document.querySelector('#embed-render-context')
  : document.querySelector('#main-render-context');
parent.append(shell); shell.dataset.chartContext = chartContext;
</script>
{script_tag(shim, 'roam-datascript-shim')}
{script_tag(component_source, 'component-cljs-exact')}
{script_tag(mount, 'reagent-mount')}
</body></html>'''
    (OUT / 'index.html').write_text(html)


def settle_renderer(page):
    page.wait_for_function('document.fonts && document.fonts.status === "loaded"', timeout=15000)
    page.evaluate('''() => new Promise((resolve) => requestAnimationFrame(() =>
      requestAnimationFrame(() => Promise.resolve(document.fonts.ready).then(resolve))))''')


def minute_label(iso):
    hour_minute = iso.split('T', 1)[1][:5]
    return hour_minute


def clock_expectation(iso):
    date, time = iso.split('T', 1)
    hour, minute = map(int, time[:5].split(':'))
    return {
        'iso': iso,
        'nowMinutes': hour * 60 + minute,
        'label': minute_label(iso) if date == '2026-10-29' else None,
    }


def wait_for_clock(page, iso):
    expected = clock_expectation(iso)
    try:
        page.wait_for_function('''(expected) => {
          const state = window.__chartHarness?.state?.();
          const timeline = state?.lastTimeline;
          return state?.svgCount === 1
            && timeline?.input?.nowMinutes === expected.nowMinutes;
        }''', arg=expected, timeout=15000)
    except Exception as error:
        state = page.evaluate('() => window.__chartHarness.state()')
        raise RuntimeError(f'Clock readiness did not converge for {iso}: {state}') from error
    settle_renderer(page)
    state = page.evaluate('() => window.__chartHarness.state()')
    if state['lastTimeline']['input']['nowMinutes'] != expected['nowMinutes']:
        raise RuntimeError(f'Clock minute did not reach production timeline input: {state["lastTimeline"]}')
    expected_date = page.evaluate('(iso) => new window.__chartRealDate(iso).getTime()', expected['iso'])
    if state['lastTimeline']['input']['currentDate'] != expected_date:
        raise RuntimeError(f'Clock date did not reach production timeline input: {state["lastTimeline"]}')
    policy = state['lastTimeline']['result']
    minute = int(policy['elapsedThroughMinutes'])
    expected_label = f'{minute // 60 % 24:02d}:{minute % 60:02d}' if policy['showNow'] else None
    if state['nowLabel'] != expected_label:
        raise RuntimeError(f'Clock-specific DOM readiness failed for {iso}: {state}')
    return state


def assert_guards(page, page_errors, http_requests, label):
    if page_errors:
        raise RuntimeError(f'{label} produced page errors: {page_errors}')
    if http_requests:
        raise RuntimeError(f'{label} made HTTP(S) requests: {http_requests}')
    state = page.evaluate('() => window.__chartHarness.state()')
    writes = [entry for entry in page.evaluate('() => window.__chartHarness.traces()') if entry['kind'] == 'write']
    if state['writes'] != 0 or writes:
        raise RuntimeError(f'{label} attempted graph writes: {writes or state}')
    overview = state.get('overview')
    if overview and overview['rect']['width'] > 0:
        assert overview['chevron'], (label, overview)
        assert overview['scrollWidth'] <= overview['clientWidth'] + 1, (label, overview)
        assert overview['contentScrollWidth'] <= overview['contentClientWidth'] + 1, (label, overview)
        for item in overview['items']:
            box = item['rect']
            assert box['x'] + box['width'] <= overview['chevron']['x'] - 1, (label, overview)
            assert box['y'] >= overview['rect']['y'] - 0.5 and box['bottom'] <= overview['rect']['bottom'] + 0.5, (label, overview)


def detail_measurement(page):
    return page.evaluate('''() => {
      const el = document.querySelector('.nautilus-log-detail-region');
      const r = el.getBoundingClientRect();
      return { parentIsBody: el.parentElement === document.body,
        parentIsWorkspace: Boolean(el.closest('.nautilus-log-workspace')),
        x: r.x, y: r.y, width: r.width, height: r.height, text: el.textContent };
    }''')


NORMAL_CLOCKS = [
    ('0801', '2026-10-29T08:01:00'), ('1030', '2026-10-29T10:30:00'),
    ('1200', '2026-10-29T12:00:00'), ('1500', '2026-10-29T15:00:00'),
    ('1759', '2026-10-29T17:59:00'), ('2059', '2026-10-29T20:59:00'),
    ('end-2100', '2026-10-29T21:00:00'), ('after-end', '2026-10-29T21:01:00'),
    ('next-day', '2026-10-30T01:00:00'),
]
NIGHT_CLOCKS = [
    ('start', '2026-10-29T21:00:00'), ('2344', '2026-10-29T23:44:00'),
    ('2359', '2026-10-29T23:59:00'), ('midnight', '2026-10-30T00:00:00'),
    ('0159', '2026-10-30T01:59:00'), ('end-0200', '2026-10-30T02:00:00'),
    ('after-end', '2026-10-30T02:01:00'),
]


def rect_series(page, screenshots, page_errors, http_requests, prefix='baseline', clocks=None):
    observations = []
    for label, iso in (clocks or NORMAL_CLOCKS):
        page.evaluate('(iso) => window.__chartHarness.setClock(iso)', iso)
        state = wait_for_clock(page, iso)
        state['clock'] = iso
        observations.append(state)
        assert_guards(page, page_errors, http_requests, f'clock {label}')
        page.screenshot(path=str(screenshots / f'{prefix}-{label}.png'), full_page=True)
    return observations


def varies(observations, key):
    values = [json.dumps(item.get(key), sort_keys=True) for item in observations]
    return len(set(values)) > 1


def assert_label_bounds(state, label):
    svg = state['svg']
    for index, bounds in enumerate(state['labels']):
        if (bounds['x'] < svg['x'] - 0.5 or bounds['bottom'] > svg['bottom'] + 0.5
                or bounds['x'] + bounds['width'] > svg['x'] + svg['width'] + 0.5
                or bounds['y'] < svg['y'] - 0.5):
            raise RuntimeError(f'{label} label {index} escaped the SVG frame: {bounds} / {svg}')


def composite(foreground, background):
    alpha = foreground[3] if len(foreground) > 3 else 1
    return [alpha * foreground[i] + (1 - alpha) * background[i] for i in range(3)]


def contrast_ratio(rgb_a, rgb_b):
    rgb_b = composite(rgb_b, [255, 255, 255])
    rgb_a = composite(rgb_a, rgb_b)
    def luminance(rgb):
        channels = []
        for channel in rgb[:3]:
            normalized = channel / 255
            channels.append(normalized / 12.92 if normalized <= 0.04045 else ((normalized + 0.055) / 1.055) ** 2.4)
        return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
    lighter, darker = sorted((luminance(rgb_a), luminance(rgb_b)), reverse=True)
    return (lighter + 0.05) / (darker + 0.05)


def semantic_contrast(page):
    slot = page.locator('.nautilus-log-available-slot').first
    slot.focus()
    page.wait_for_function('''() => {
      const slot = document.querySelector('.nautilus-log-available-slot');
      const hit = slot?.querySelector('.nautilus-log-available-slot-hit');
      return slot?.matches(':focus') && hit && hit.getAnimations().every(a => a.playState === 'finished');
    }''')
    settle_renderer(page)
    return page.evaluate('''() => {
      const rgb = value => {
        if (!/^rgba?\\(/.test(value)) throw Error('Expected actual RGB paint: ' + value);
        return value.match(/[\\d.]+/g).map(Number);
      };
      const blend = (fg, bg) => fg.slice(0, 3).map((c, i) => c * (fg[3] ?? 1) + bg[i] * (1 - (fg[3] ?? 1)));
      const stage = document.querySelector('.nautilus-log-chart-stage');
      const ancestors = []; for (let el = stage; el; el = el.parentElement) ancestors.unshift(el);
      const background = ancestors.reduce((bg, el) => blend(rgb(getComputedStyle(el).backgroundColor), bg), [255, 255, 255]);
      const slot = document.querySelector('.nautilus-log-available-slot');
      const hit = slot.querySelector('.nautilus-log-available-slot-hit');
      if (!slot.matches(':focus')) throw Error('Available slot lost focus before paint measurement');
      const paint = (el, property) => {
        if (!el) throw Error('Missing rendered semantic element: ' + property);
        const style = getComputedStyle(el), color = rgb(style[property]);
        let opacity = Number(style[property === 'stroke' ? 'strokeOpacity' : 'fillOpacity']);
        for (let node = el; node; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
        color[3] = (color[3] ?? 1) * opacity; return color;
      };
      return {
        task: paint(document.querySelector('.nautilus-log-event-slice-group[aria-label*="Draft the project brief"] .nautilus-log-slice-group text'), 'fill'),
        event: paint(document.querySelector('.nautilus-log-event-slice-group[aria-label*="Stand-up"] .nautilus-log-slice-group text'), 'fill'),
        focus: paint(hit, 'stroke'),
        now: paint(document.querySelector('.nautilus-log-now-needle-line'), 'stroke'),
        background,
        focused: document.activeElement === slot,
      };
    }''')


def assert_semantic_contrast(page, theme):
    colors = semantic_contrast(page)
    text_ratios = {name: contrast_ratio(colors[name], colors['background']) for name in ('task', 'event')}
    graphic_ratios = {name: contrast_ratio(colors[name], colors['background'])
                      for name in ('focus', 'now')}
    if not colors['focused'] or colors['focus'][3] <= 0:
        raise RuntimeError(f'{theme} focus paint is absent/transparent: {colors}')
    if min(text_ratios.values()) < 4.5:
        raise RuntimeError(f'{theme} semantic text contrast is below 4.5:1: {text_ratios} ({colors})')
    if min(graphic_ratios.values()) < 3:
        raise RuntimeError(f'{theme} computed chart graphic contrast is below 3:1: {graphic_ratios} ({colors})')
    return {'colors': colors, 'textRatios': text_ratios, 'graphicRatios': graphic_ratios}


def assert_stable(observations, label):
    assert len(observations) > 1, label
    for state in observations[1:]:
        assert_rect_equal(observations[0], state, label)
    return {key: False for key in ('viewBox', 'svg', 'workspace', 'stage', 'detail', 'status', 'desk', 'following')}


def load_context(page, context, scenario='mixed', window_mode='normal'):
    page.goto((OUT / 'index.html').as_uri() + '?' + urlencode({'context': context, 'scenario': scenario, 'window': window_mode}))
    page.wait_for_load_state('networkidle')
    page.wait_for_function('window.__chartEvaluator && (window.__chartEvaluator.completed || window.__chartEvaluator.error)', timeout=15000)
    runtime = page.evaluate('() => window.__chartEvaluator')
    if runtime.get('error'):
        raise RuntimeError(f'{context} evaluator error: {runtime["error"]}')
    page.wait_for_selector('svg.nautilus-log-svg', timeout=15000)
    return wait_for_clock(page, '2026-10-29T08:01:00')


def assert_rect_equal(before, after, label):
    if before['viewBox'] != after['viewBox']:
        raise RuntimeError(f'{label} changed viewBox')
    for key in ('svg', 'workspace', 'stage', 'detail', 'status', 'desk', 'following'):
        a, b = before.get(key), after.get(key)
        if not a or not b or any(abs(a[field] - b[field]) > 0.5 for field in ('x', 'y', 'width', 'height')):
            raise RuntimeError(f'{label} changed {key} bounds: {a} / {b}')


def set_width(page, width):
    page.evaluate('(width) => window.__chartHarness.setWidth(width)', width)
    page.wait_for_function('''(width) => {
      const s = window.__chartHarness.state(), f = s.presentation;
      return Math.abs(s.observedShell.width - width) < 0.5
        && Math.abs((s.lastPresentationObservation?.width ?? -1) - width) < 0.5
        && s.viewBox === `0 0 ${f.viewBox.width} ${f.viewBox.height}`
        && s.workspaceClass.includes(`nautilus-log-workspace--${f.inspector}`);
    }''', arg=width)
    settle_renderer(page)


def compact_context_matrix(page, screenshots, page_errors, http_requests):
    results = {}
    # Keep the browser viewport fixed and resize only the production-context
    # shell.  Both disclosure states are exercised at every compact width.
    for context in ('main', 'sidebar'):
        load_context(page, context)
        for width in (280, 320, 360, 480, 520):
            set_width(page, width)
            for open_state in (False, True):
                details = page.locator('.nautilus-log-compact-details')
                if details.evaluate('el => el.open') != open_state:
                    details.locator('.nautilus-log-compact-summary').click()
                wait_for_clock(page, '2026-10-29T08:01:00')
                before = page.evaluate('() => window.__chartHarness.state()')
                if before['shellClientWidth'] <= 0 or before['shell']['width'] <= 0:
                    raise RuntimeError(f'{context}/{width} did not record local shell dimensions: {before}')
                if before['scheduleOpen'] != open_state:
                    raise RuntimeError(f'{context}/{width} Schedule state did not converge: {before}')
                key = f'{context}-{width}-{"open" if open_state else "folded"}'
                states = rect_series(page, screenshots, page_errors, http_requests, key)
                for state in states:
                    assert_rect_equal(before, state, key)
                results[key] = {'before': before, 'after': states[-1], 'observations': states}
                page.screenshot(path=str(screenshots / f'{key}.png'), full_page=True)
                page.evaluate("() => window.__chartHarness.setClock('2026-10-29T08:01:00')")
    return results


def responsive_matrix(page, screenshots, page_errors, http_requests):
    results = {}
    for width in (280, 320, 360, 480, 520, 521, 839, 840, 960):
        set_width(page, width)
        expected = 'nautilus-log-workspace--side' if width >= 840 else 'nautilus-log-workspace--bottom'
        state = page.evaluate('() => window.__chartHarness.state()')
        if expected not in state['workspaceClass']:
            raise RuntimeError(f'Width {width} did not select {expected}: {state}')
        if state['documentOverflow'] > 1:
            raise RuntimeError(f'Width {width} produced horizontal overflow: {state}')
        if width <= 520 and state['externalLabelCount'] != 0:
            raise RuntimeError(f'Width {width} retained external labels: {state}')
        if state['detail']['height'] != 112 and width < 840:
            raise RuntimeError(f'Width {width} detail region lost its fixed height: {state}')
        if width <= 520 and state['compactList'] and state['compactList']['height'] != 168:
            raise RuntimeError(f'Width {width} compact Schedule viewport is not fixed: {state}')
        if state['detailIdleLayout']['idle'] and state['detailIdleLayout']['idle']['x'] != state['detailIdleLayout']['eyebrow']['x']:
            raise RuntimeError(f'Width {width} placed idle Details in an implicit grid column: {state}')
        assert_guards(page, page_errors, http_requests, f'width {width}')
        results[str(width)] = state
        page.screenshot(path=str(screenshots / f'width-{width}.png'), full_page=True)
    return results


def setting_boundaries(page, screenshots, page_errors, http_requests):
    results = {}
    for mode, scenario, clocks, limits in [
            ('normal', 'dense', NORMAL_CLOCKS, (300, 1260)),
            ('overnight', 'overnight', NIGHT_CLOCKS, (1260, 1560))]:
        for context, width, opened in [('main', 960, False), ('main', 320, True),
                                        ('sidebar', 320, False), ('embed', 840, False)]:
            load_context(page, context, scenario, mode)
            set_width(page, width)
            if width <= 520:
                disclosure = page.locator('.nautilus-log-compact-details')
                if disclosure.evaluate('el => el.open') != opened:
                    disclosure.locator('summary').click()
            key = f'{mode}-{context}-{width}'
            states = rect_series(page, screenshots, page_errors, http_requests, key, clocks)
            for state in states:
                inputs = state['lastTimeline']['input']
                assert (inputs['startMinutes'], inputs['endMinutes']) == limits, (key, inputs)
            assert any(state['overflowCount'] == 0 for state in states), key
            assert any(state['overflowCount'] > 0 for state in states), key
            end = next(state for state in states if state['clock'].endswith('02:00:00' if mode == 'overnight' else '21:00:00'))
            assert end['lastTimeline']['result']['showNow'] is False, key
            if mode == 'overnight':
                carry = next(state for state in states if state['clock'] == '2026-10-30T01:59:00')
                assert carry['lastTimeline']['result']['showNow'] is True and carry['nowLabel'] == '01:59', key
            results[key] = {'observations': states, 'dynamic': assert_stable(states, key)}
    return results


def long_detail_contract(page, screenshots, page_errors, http_requests):
    results = {}
    for context, width in [('main', 960), ('sidebar', 280), ('embed', 840)]:
        load_context(page, context, 'long')
        set_width(page, width)
        expected = page.evaluate('() => window.__chartHarness.longTitles()')
        records = []
        for uid, title in expected.items():
            page.mouse.move(1180, 880)
            before = page.evaluate('() => window.__chartHarness.state()')
            # Source labels may be truncated; the full accessible name is not.
            target = page.locator('.nautilus-log-event-slice-group').evaluate_all(
                '(nodes, title) => nodes.findIndex(n => n.getAttribute("aria-label").startsWith(title))', title)
            assert target >= 0, (context, uid)
            page.locator('.nautilus-log-event-slice-group').nth(target).focus()
            page.wait_for_function('(title) => document.querySelector(".nautilus-log-detail-title")?.textContent === title', arg=title)
            settle_renderer(page)
            active = page.evaluate('() => window.__chartHarness.state()')
            assert_rect_equal(before, active, f'{context}/{uid} active Details')
            detail = page.locator('.nautilus-log-detail-region')
            detail.focus()
            detail.press('End')
            page.wait_for_function('''() => {
              const el = document.querySelector('.nautilus-log-detail-region');
              return el.scrollHeight > el.clientHeight && el.scrollTop > 0 && el.scrollHeight - el.clientHeight - el.scrollTop <= 2;
            }''')
            tail = detail.evaluate('''el => {
              const title = el.querySelector('.nautilus-log-detail-title');
              const text = title.firstChild, range = document.createRange();
              range.setStart(text, Math.max(0, text.length - 5)); range.setEnd(text, text.length);
              const r = range.getBoundingClientRect(), box = el.getBoundingClientRect();
              return {bottom:r.bottom, top:r.top, viewportTop:box.top, viewportBottom:box.bottom,
                scrollTop:el.scrollTop, scrollHeight:el.scrollHeight, clientHeight:el.clientHeight};
            }''')
            assert tail['top'] >= tail['viewportTop'] - 1 and tail['bottom'] <= tail['viewportBottom'] + 1, (uid, tail)
            assert_rect_equal(before, page.evaluate('() => window.__chartHarness.state()'), f'{context}/{uid} scroll')
            page.screenshot(path=str(screenshots / f'long-{context}-{uid}.png'), full_page=True)
            # Changing a selected record without changing its UID cannot keep old Details.
            page.evaluate('({uid}) => window.__chartHarness.updateChild(uid, "{{TODO}} Updated project brief 30m")', {'uid': uid})
            page.wait_for_function('''() => {
              const el = document.querySelector('.nautilus-log-detail-region');
              return el.dataset.nautilusDetail === 'idle' || el.querySelector('.nautilus-log-detail-title')?.textContent === 'Updated project brief';
            }''')
            assert_rect_equal(before, page.evaluate('() => window.__chartHarness.state()'), f'{context}/{uid} update')
            assert_guards(page, page_errors, http_requests, f'{context}/{uid}')
            records.append({'uid': uid, 'titleLength': len(title), 'tail': tail, 'before': before, 'active': active})
        results[context] = records
    load_context(page, 'main', 'completed')
    completed = page.locator('.nautilus-log-event-slice-group[aria-label*="Completed milestone"]')
    completed.focus()
    page.wait_for_function('document.querySelector(".nautilus-log-detail-title")?.textContent === "Completed milestone"')
    completed_state = page.evaluate('() => window.__chartHarness.state()')
    assert_guards(page, page_errors, http_requests, 'completed detail')
    results['completed'] = completed_state
    load_context(page, 'main')
    page.locator('.nautilus-log-available-slot').first.focus()
    page.wait_for_function('document.querySelector(".nautilus-log-detail-region")?.dataset.nautilusDetail === "active"')
    page.evaluate('() => window.__chartHarness.updateChild("task-reference", "{{TODO}} Changed estimate 60m")')
    page.wait_for_function('document.querySelector(".nautilus-log-detail-region")?.dataset.nautilusDetail === "idle"')
    assert_guards(page, page_errors, http_requests, 'available slot plan update')
    results['availableUpdate'] = page.evaluate('() => window.__chartHarness.state()')
    return results


def main():
    assert contrast_ratio([0, 0, 0, 0], [250, 250, 250]) == 1
    assert contrast_ratio([0, 0, 0, 0.1], [250, 250, 250]) < 3
    (OUT / 'bundle').mkdir()
    (OUT / 'screenshots').mkdir()
    component_source = COMPONENT.read_text()
    component_sha = sha256(COMPONENT)
    subprocess.check_call(['node', 'test/chart-renderer-bundle.cjs', str(OUT / 'bundle')], cwd=ROOT,
                          env={**os.environ, 'NODE_PATH': str(NODE_MODULES)})
    write_page(component_source)

    report = {
        'artifactDirectory': str(OUT),
        'componentSha256': component_sha,
        'componentBytes': len(COMPONENT.read_bytes()),
        'evaluator': {
            'call': "scittle.core.eval_script_tags(document.querySelectorAll('script[type=application/x-scittle][data-chart-eval]'))",
            'namespace': 'nautilus-log-v1',
            'sourceMode': 'raw current src/component.cljs as the component evaluator input',
        },
        'assets': {
            'scittle': 'node_modules/scittle/dist/scittle.js',
            'reagent': 'node_modules/scittle/dist/scittle.reagent.js',
            'pprint': 'node_modules/scittle/dist/scittle.pprint.js',
            'react': 'node_modules/react/umd/react.development.js',
            'reactDom': 'node_modules/react-dom/umd/react-dom.development.js',
            'logCore': 'webpack bundle imports ../src/log-core.js directly',
            'timingCore': 'webpack bundle imports ../src/timing-core.js directly',
        },
    }
    page_errors, http_requests, resource_failures, console = [], [], [], []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            page = browser.new_page(viewport={'width': 1200, 'height': 900})
            page.on('pageerror', lambda error: page_errors.append(str(error)))
            page.on('requestfailed', lambda request: resource_failures.append({'url': request.url, 'failure': request.failure}))
            page.on('request', lambda request: http_requests.append(request.url)
                    if request.url.startswith(('http:', 'https:')) else None)
            page.on('console', lambda message: console.append({'type': message.type, 'text': message.text}))
            page.goto((OUT / 'index.html').as_uri())
            page.wait_for_load_state('networkidle')
            page.wait_for_function('window.__chartEvaluator && (window.__chartEvaluator.completed || window.__chartEvaluator.error)', timeout=15000)
            report['evaluatorRuntime'] = page.evaluate('() => window.__chartEvaluator')
            if report['evaluatorRuntime'].get('error'):
                raise RuntimeError(report['evaluatorRuntime']['error'])
            page.wait_for_selector('svg.nautilus-log-svg', timeout=15000)
            exact_evaluator_input = page.evaluate('''() => document.querySelector(
              'script[data-chart-eval="component-cljs-exact"]').textContent''')
            evaluator_input_sha = sha256_bytes(exact_evaluator_input.encode())
            report['evaluatorInput'] = {
                'sha256': evaluator_input_sha,
                'bytes': len(exact_evaluator_input.encode()),
                'equalsProductionSource': exact_evaluator_input == component_source,
                'productionSha256': component_sha,
            }
            if exact_evaluator_input != component_source:
                raise RuntimeError('Actual component evaluator input differs from src/component.cljs')
            initial = wait_for_clock(page, '2026-10-29T08:01:00')
            report['stylesheetOrder'] = page.evaluate('() => [...document.querySelectorAll("link[rel=stylesheet]")].map(el => el.href)')
            report['loadedFonts'] = page.evaluate('() => [...document.fonts].filter(f => f.status === "loaded").map(f => ({family:f.family,weight:f.weight,style:f.style}))')
            if initial['sliceCount'] < 1:
                raise RuntimeError(f'Expected actual chart slices, got {initial}')
            assert_guards(page, page_errors, http_requests, 'initial mount')

            # Available range IDs come from the same vector that is rendered.
            # Advancing the clock invalidates the focused range and must clear it.
            available = page.locator('.nautilus-log-available-slot').first
            available.focus()
            page.wait_for_function("""() => document.querySelector('.nautilus-log-detail-region')
              ?.dataset.nautilusDetail === 'active'""", timeout=5000)
            page.evaluate("() => window.__chartHarness.setClock('2026-10-29T10:30:00')")
            page.wait_for_function("""() => document.querySelector('.nautilus-log-detail-region')
              ?.dataset.nautilusDetail === 'idle'""", timeout=5000)
            assert_guards(page, page_errors, http_requests, 'available-slot clock reconciliation')
            page.evaluate("() => window.__chartHarness.setClock('2026-10-29T08:01:00')")
            wait_for_clock(page, '2026-10-29T08:01:00')

            target = page.locator('.nautilus-log-event-slice-group[aria-label*="Draft the project brief"]')
            target.focus()
            page.wait_for_function('''() => document.querySelector('.nautilus-log-detail-region')
              ?.textContent.includes('Draft the project brief')''', timeout=5000)
            settle_renderer(page)
            detail = detail_measurement(page)
            assert_guards(page, page_errors, http_requests, 'first detail')
            page.screenshot(path=str(OUT / 'screenshots' / 'detail-task.png'), full_page=True)

            # A pointer detail may temporarily supersede focus, but leaving the
            # workspace restores the focused segment instead of keeping stale hover text.
            page.locator('.nautilus-log-event-slice-group').nth(1).hover()
            page.wait_for_function("""() => document.querySelector('.nautilus-log-detail-region')
              ?.textContent.includes('Stand-up')""", timeout=5000)
            # Restore keyboard focus while the pointer still owns B, then prove
            # that leaving B reveals A rather than stale pointer data.
            target.focus()
            page.locator('.nautilus-log-workspace').evaluate(
                "el => el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }))")
            page.wait_for_timeout(100)
            mixed_after_leave = page.evaluate('() => ({ state: window.__chartHarness.state(), active: document.activeElement?.className || null })')
            if 'Draft the project brief' not in mixed_after_leave['state']['detailText']:
                raise RuntimeError(f'Pointer exit did not restore focused Details: {mixed_after_leave}')

            page.locator('.nautilus-log-event-slice-group').nth(1).focus()
            page.wait_for_function('''() => document.querySelector('.nautilus-log-detail-region')
              ?.textContent.includes('Stand-up')''', timeout=5000)
            settle_renderer(page)
            second_detail = detail_measurement(page)
            if any(abs(detail[key] - second_detail[key]) > 0.5 for key in ('x', 'y', 'width', 'height')):
                raise RuntimeError(f'Focus changed fixed detail bounds: {detail} / {second_detail}')
            # Actual task routing remains current-surface by default and uses the
            # existing Shift path for the right sidebar; Space remains inert.
            target.evaluate("el => el.dispatchEvent(new MouseEvent('click', { bubbles: true }))")
            target.focus()
            target.press('Enter')
            target.press('Shift+Enter')
            before_space = page.evaluate("() => window.__chartHarness.traces().filter(x => x.kind === 'locate').length")
            page.keyboard.press('Space')
            after_space = page.evaluate("() => window.__chartHarness.traces().filter(x => x.kind === 'locate').length")
            locations = [entry for entry in page.evaluate('() => window.__chartHarness.traces()') if entry['kind'] == 'locate']
            if [item['sidebar'] for item in locations[-3:]] != [False, False, True] or before_space != after_space:
                raise RuntimeError(f'Task routing or Space behavior changed: {locations}')
            page.locator('.nautilus-log-event-slice-group').nth(1).evaluate("el => el.dispatchEvent(new MouseEvent('click', { bubbles: true }))")
            if len([entry for entry in page.evaluate('() => window.__chartHarness.traces()') if entry['kind'] == 'locate']) != after_space:
                raise RuntimeError('Non-task chart interaction unexpectedly navigated')
            assert_guards(page, page_errors, http_requests, 'mixed pointer/keyboard detail')
            page.screenshot(path=str(OUT / 'screenshots' / 'detail-event.png'), full_page=True)

            # Unload, source removal, and folding all leave the local Details region idle.
            page.evaluate('() => window.__chartHarness.unload()')
            page.wait_for_function("""() => document.querySelector('.nautilus-log-detail-region')
              ?.dataset.nautilusDetail === 'idle'""", timeout=5000)
            page.locator('.nautilus-log-event-slice-group').nth(1).focus()
            target.focus()
            page.wait_for_function("""() => document.querySelector('.nautilus-log-detail-region')
              ?.textContent.includes('Draft the project brief')""", timeout=5000)
            page.evaluate('() => window.__chartHarness.unload()')
            page.wait_for_function("""() => document.querySelector('.nautilus-log-detail-region')
              ?.dataset.nautilusDetail === 'idle'""", timeout=5000)
            page.locator('.nautilus-log-event-slice-group').nth(1).focus()
            target.focus()
            page.wait_for_function("""() => document.querySelector('.nautilus-log-detail-region')
              ?.textContent.includes('Draft the project brief')""", timeout=5000)
            page.evaluate("() => window.__chartHarness.removeChild('task-reference')")
            page.wait_for_timeout(150)
            removal_state = page.evaluate('() => window.__chartHarness.state()')
            if 'Draft the project brief' in removal_state['detailText']:
                raise RuntimeError(f'Selected item removal retained stale Details: {removal_state}')
            page.locator('.nautilus-log-collapse-btn').click()
            page.wait_for_selector('.nautilus-log-workspace', state='detached', timeout=5000)
            page.locator('.nautilus-log-collapse-btn').click()
            page.wait_for_selector('.nautilus-log-workspace', timeout=5000)
            if page.evaluate('() => window.__chartHarness.state().detailText').find('Hover or focus') == -1:
                raise RuntimeError('Fold/re-expand retained stale Details content')
            assert_guards(page, page_errors, http_requests, 'detail lifecycle cleanup')

            observations = rect_series(page, OUT / 'screenshots', page_errors, http_requests)
            baseline_traces = page.evaluate('() => window.__chartHarness.traces()')
            resolved = [entry['result'] for entry in baseline_traces if entry['kind'] == 'resolve-task-instance']
            if not any(item['sourceUid'] == 'source-todo' and item['kind'] == 'task' for item in resolved):
                raise RuntimeError(f'Real timing-core reference resolution was not observed: {resolved}')
            if not any(item['sourceUid'] == 'source-done' and item['status'] == 'DONE' for item in resolved):
                raise RuntimeError(f'Real timing-core completion resolution was not observed: {resolved}')
            if not any(item['kind'] == 'event' for item in resolved):
                raise RuntimeError(f'Real timing-core event resolution was not observed: {resolved}')

            compact_clock = {}
            for width in (280, 320, 360, 480, 520):
                set_width(page, width)
                compact_state = page.evaluate('() => window.__chartHarness.state()')
                if compact_state['compactList'] is None or compact_state['compactList']['height'] != 168:
                    raise RuntimeError(f'Open compact Schedule is not a fixed 168px viewport at {width}: {compact_state}')
                compact_observations = rect_series(page, OUT / 'screenshots', page_errors, http_requests, f'compact-{width}')[:-1]
                compact_clock[str(width)] = {
                    'dynamic': assert_stable(compact_observations, f'compact width {width}'),
                    'observations': compact_observations,
                }

            responsive = responsive_matrix(page, OUT / 'screenshots', page_errors, http_requests)
            compact_contexts = compact_context_matrix(page, OUT / 'screenshots', page_errors, http_requests)
            load_context(page, 'main')
            light_contrast = assert_semantic_contrast(page, 'light')

            context_matrix = {}
            for context, width in (('sidebar', 320), ('embed', 320), ('embed', 840)):
                load_context(page, context)
                set_width(page, width)
                context_state = page.evaluate('() => window.__chartHarness.state()')
                if context_state['context'] != context:
                    raise RuntimeError(f'{context} context did not mount its actual ancestor: {context_state}')
                if context == 'sidebar' and context_state['scheduleOpen'] is not False:
                    raise RuntimeError(f'Right sidebar did not default its Schedule to folded: {context_state}')
                if context == 'sidebar':
                    page.locator('.nautilus-log-compact-details > .nautilus-log-compact-summary').click()
                    context_state = page.evaluate('() => window.__chartHarness.state()')
                    if context_state['compactList']['height'] != 168:
                        raise RuntimeError(f'Right sidebar Schedule lost its fixed viewport: {context_state}')
                context_target = page.locator('.nautilus-log-event-slice-group').first
                context_target.focus()
                page.wait_for_function("""() => document.querySelector('.nautilus-log-detail-region')
                  ?.dataset.nautilusDetail === 'active'""", timeout=5000)
                page.evaluate('() => window.__chartHarness.unload()')
                page.wait_for_function("""() => document.querySelector('.nautilus-log-detail-region')
                  ?.dataset.nautilusDetail === 'idle'""", timeout=5000)
                context_observations = rect_series(page, OUT / 'screenshots', page_errors, http_requests, f'{context}-{width}')[:-1]
                context_matrix[f'{context}-{width}'] = {
                    'dynamic': assert_stable(context_observations, f'{context} width {width}'),
                    'state': page.evaluate('() => window.__chartHarness.state()'),
                }
                assert_guards(page, page_errors, http_requests, f'{context} context')
                page.screenshot(path=str(OUT / 'screenshots' / f'{context}-{width}.png'), full_page=True)

            # Restore the main context for visual contrast and unmount cleanup.
            load_context(page, 'main')
            page.locator('body').evaluate("body => { body.classList.add('bp3-dark'); body.style.background = '#1d1e21'; body.style.color = '#ecedef'; }")
            page.emulate_media(reduced_motion='reduce')
            settle_renderer(page)
            dark_state = page.evaluate('() => window.__chartHarness.state()')
            dark_contrast = assert_semantic_contrast(page, 'dark')
            assert_guards(page, page_errors, http_requests, 'dark reduced-motion')
            page.screenshot(path=str(OUT / 'screenshots' / 'dark-reduced-motion.png'), full_page=True)
            page.emulate_media(reduced_motion='no-preference')
            page.locator('body').evaluate("body => { body.classList.remove('bp3-dark'); body.style.background = ''; body.style.color = ''; }")

            scenario_smoke = {}
            for scenario in ('sparse', 'dense', 'cjk', 'empty'):
                page.goto((OUT / 'index.html').as_uri() + f'?scenario={scenario}')
                page.wait_for_load_state('networkidle')
                page.wait_for_function('window.__chartEvaluator && (window.__chartEvaluator.completed || window.__chartEvaluator.error)', timeout=15000)
                runtime = page.evaluate('() => window.__chartEvaluator')
                if runtime.get('error'):
                    raise RuntimeError(f'{scenario} evaluator error: {runtime["error"]}')
                page.wait_for_selector('svg.nautilus-log-svg', timeout=15000)
                scenario_state = wait_for_clock(page, '2026-10-29T08:01:00')
                expected_slices = 0 if scenario == 'empty' else 1
                if scenario_state['sliceCount'] < expected_slices:
                    raise RuntimeError(f'{scenario} did not produce expected real chart DOM: {scenario_state}')
                assert_label_bounds(scenario_state, scenario)
                assert_guards(page, page_errors, http_requests, f'{scenario} scenario')
                scenario_smoke[scenario] = scenario_state
                page.screenshot(path=str(OUT / 'screenshots' / f'scenario-{scenario}.png'), full_page=True)

            boundaries = setting_boundaries(page, OUT / 'screenshots', page_errors, http_requests)
            long_details = long_detail_contract(page, OUT / 'screenshots', page_errors, http_requests)
            page.evaluate('() => window.__chartHarness.unmount()')
            page.wait_for_function('window.__chartHarness.state().svgCount === 0', timeout=5000)
            unmount_state = page.evaluate('() => window.__chartHarness.state()')
            if unmount_state['activeClockIntervals'] != 0:
                raise RuntimeError(f'Unmount leaked chart clock intervals: {unmount_state}')
            if not any(entry['kind'] == 'session-destroy' for entry in page.evaluate('() => window.__chartHarness.traces()')):
                raise RuntimeError('Unmount did not destroy the renderer plan session')

            expected_console = [entry for entry in console if any(marker in entry['text'] for marker in EXPECTED_CONSOLE_WARNINGS)]
            unexpected_console = [entry for entry in console if entry['type'] == 'error'
                                  and not any(marker in entry['text'] for marker in EXPECTED_CONSOLE_WARNINGS)]
            if unexpected_console or resource_failures:
                raise RuntimeError(f'Unexpected console/resource errors: {unexpected_console}; {resource_failures}')
            assert_guards(page, page_errors, http_requests, 'complete run')
            within_day = observations[:-1]
            dynamic = {
                'viewBox': varies(within_day, 'viewBox'),
                'svg': varies(within_day, 'svg'),
                'workspace': varies(within_day, 'workspace'),
                'stage': varies(within_day, 'stage'),
                'detail': varies(within_day, 'detail'),
                'desk': varies(within_day, 'desk'),
                'following': varies(within_day, 'following'),
            }
            report.update({
                'initial': initial,
                'detail': detail,
                'detailSecondTarget': second_detail,
                'observations': observations,
                'scenarioSmoke': scenario_smoke,
                'settingBoundaries': boundaries,
                'longDetails': long_details,
                'responsive': responsive,
                'compactContexts': compact_contexts,
                'compactClock': compact_clock,
                'contexts': context_matrix,
                'semanticContrast': {'light': light_contrast, 'dark': dark_contrast},
                'darkReducedMotion': dark_state,
                'unmount': unmount_state,
                'traces': baseline_traces,
                'console': console,
                'expectedConsoleWarnings': expected_console,
                'pageErrors': page_errors,
                'httpRequests': http_requests,
                'resourceFailures': resource_failures,
                'baselineDiagnostic': {
                    'withinDayDynamicMeasurements': dynamic,
                    'dateBoundaryObservation': observations[-1],
                    'fixedLocalDetail': detail['parentIsWorkspace'] and not detail['parentIsBody'],
                    'stableInvarianceAssertion': {
                        'expected': 'within-day SVG, workspace, stage, detail, Desk, and following-sibling rectangles and viewBox remain equal',
                        'actual': dynamic,
                        'result': 'passed' if not any(dynamic.values()) else 'failed',
                    },
                },
            })
            if not report['baselineDiagnostic']['fixedLocalDetail']:
                raise RuntimeError(f'Detail region is not local: {detail}')
            if page.locator('[role="tooltip"]').count() != 0:
                raise RuntimeError('Timeline detail unexpectedly created a body tooltip')
            if any(dynamic.values()):
                raise RuntimeError(f'Clock changed stable chart geometry: {dynamic}')
        finally:
            browser.close()
    (OUT / 'results.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({
        'result': 'stable-workspace-passed',
        'artifactDirectory': str(OUT),
        'componentSha256': component_sha,
        'evaluatorInputSha256': report['evaluatorInput']['sha256'],
        'dynamic': report['baselineDiagnostic']['withinDayDynamicMeasurements'],
        'detail': report['detail'],
    }, indent=2))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        OUT.mkdir(parents=True, exist_ok=True)
        failure = {'result': 'blocked-or-not-reproduced', 'artifactDirectory': str(OUT), 'error': str(error)}
        (OUT / 'failure.json').write_text(json.dumps(failure, indent=2) + '\n')
        print(json.dumps(failure, indent=2), file=sys.stderr)
        raise
