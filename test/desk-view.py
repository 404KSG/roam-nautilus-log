#!/usr/bin/env python3
"""Desk UI regressions: production view/reads/watch bridge, synthetic native editor.
Never connects to a real Roam graph. Real Roam editor/IME compatibility is a
separate manual acceptance step, not something this fixture can prove.
"""
import json
import subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUT = Path('/tmp/nautilus-desk-verify')


def bundle():
    OUT.mkdir(parents=True, exist_ok=True)
    subprocess.run(['node', str(ROOT / 'test/desk-bundle.cjs'), str(OUT)], check=True, cwd=ROOT)
    (OUT / 'index.html').write_text(f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Nautilus Desk test fixture</title>
<link rel="stylesheet" href="{(ROOT / 'extension.css').as_uri()}">
<style>
body {{ margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }}
body {{ color: #202b33; background: white; }}
body.bp3-dark {{ background: #202b33; color: #e6edf2; }}
#launchers, .fixture-page-header, #page-after {{ max-width: 800px; margin: 24px auto; padding: 0 24px; }}
.fixture-page-header {{ font-size: 28px; font-weight: 600; }}
.fixture-chart {{ padding: 0 0 28px; }}
.fixture-chart-toolbar {{ display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid #dfe6ec; }}
.fixture-launch {{ font: inherit; background: transparent; border: 1px solid #dfe6ec; border-radius: 4px; padding: 4px 9px; color: inherit; }}
.fixture-shell svg {{ display: block; width: 260px; height: 175px; margin: 10px auto; }}
#page-after {{ min-height: 180px; }}
.nautilus-desk__native label {{ display: block; margin: 14px 0; font-size: 12px; color: var(--desk-muted); }}
.nautilus-desk__native textarea {{ display: block; box-sizing: border-box; width: 100%; resize: vertical;
  padding: 8px; border: 1px solid var(--desk-line); border-radius: 4px; font: inherit; line-height: 1.6;
  background: var(--desk-surface); color: var(--desk-text); }}
</style></head><body><h1 class="fixture-page-header">October 26th, 2026</h1>
<div id="launchers"></div><div id="page-after" contenteditable="true">Original page content remains available below the chart.</div>
<script src="harness.js"></script></body></html>''')


def run():
    bundle()
    checks = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            page = browser.new_page(viewport={'width': 1280, 'height': 900})
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto((OUT / 'index.html').as_uri())
            page.wait_for_function('() => window.deskHarness?.mount')

            def mount(**options):
                page.evaluate('(options) => deskHarness.mount(options)', options)
                page.get_by_role('button', name='Open Desk', exact=True).click()
                expect(page.locator('.nautilus-desk')).to_have_attribute('data-status', 'ready')

            def card(uid):
                return page.locator(f'.nautilus-desk__card[data-task-uid="{uid}"]')

            def focused(uid):
                expect(page.locator('.nautilus-desk__native')).to_have_attribute('data-task-uid', uid)
                expect(page.locator('.nautilus-desk__editor-status')).to_be_hidden()

            mount()
            expect(page.locator('.nautilus-desk__card')).to_have_count(9)
            expect(page.locator('.nautilus-desk__focus-layer')).to_be_hidden()
            assert page.evaluate('() => deskHarness.api.stats.renders.length') == 0
            assert page.evaluate('() => deskHarness.api.stats.forbiddenWrites') == 0
            expect(card('done-task')).to_have_count(0)
            expect(card('fixed-event')).to_have_count(0)
            expect(card('done-reference')).to_have_count(0)
            expect(card('other-task')).to_have_count(0)
            expect(card('task-2')).to_be_visible()  # 9999m must not disappear as unscheduled.
            expect(card('task-0').locator('.nautilus-desk__preview')).to_contain_text('☑ Prompt 1')
            expect(page.get_by_role('button', name='New Note', exact=True)).to_have_count(0)
            expect(page.get_by_role('button', name='New Task', exact=True)).to_have_count(0)
            page.wait_for_function('''() => [...document.querySelectorAll('.nautilus-desk__card')]
              .filter(el => el.getBoundingClientRect().top < innerHeight)
              .every(el => deskHarness.api.stats.reads.includes(el.dataset.taskUid))''')
            geometry = page.locator('.nautilus-desk').evaluate('''el => ({
              position:getComputedStyle(el).position, role:el.getAttribute('role'), modal:el.getAttribute('aria-modal'),
              inline:el.parentElement.classList.contains('nautilus-log-desk-host'),
              below:el.getBoundingClientRect().top >= el.closest('.fixture-chart').querySelector('.fixture-shell').getBoundingClientRect().bottom
            })''')
            assert geometry == {'position':'relative','role':'region','modal':None,'inline':True,'below':True}, geometry
            assert not page.locator('body').evaluate('(el) => el.classList.contains("nautilus-desk-focus-open")')
            page.screenshot(path=str(OUT / 'overview.png'))
            checks.append('overview first; task/event/reference filtering; no creation controls or editor mounts')

            card('task-0').click()
            focused('task-0')
            assert page.evaluate('() => deskHarness.api.stats.renders[0]') == {'uid': 'task-0', 'open': True, 'zoom': False}
            assert 'DONE' in page.locator('textarea[data-block-uid="task-0-note-0"]').input_value()
            root_editor = page.locator('textarea[data-block-uid="task-0"]')
            root_editor.fill('{{[[TODO]]}} Edited task title 55m')
            page.locator('.nautilus-desk__focus').focus()
            expect(card('task-0')).to_have_attribute('aria-label', 'Edited task title')
            assert page.evaluate('() => deskHarness.api.stats.renders.length') == 1
            log = page.locator('textarea[data-block-uid="task-0-note-0"]')
            log.fill('Changed in the native editor stand-in')
            page.keyboard.press('Alt+Comma')
            focused('task-1')
            assert page.evaluate('() => deskHarness.api.text("task-0-note-0")') == 'Changed in the native editor stand-in'
            page.keyboard.press('Alt+Period')
            focused('task-0')
            assert log.input_value() == 'Changed in the native editor stand-in'
            page.locator('.nautilus-desk__focus-body').evaluate('(el) => el.scrollTop = 620')
            page.locator('.nautilus-desk__focus').focus()
            page.keyboard.press('Alt+Comma')
            focused('task-1')
            page.keyboard.press('Alt+Period')
            focused('task-0')
            page.wait_for_function('() => document.querySelector(".nautilus-desk__focus-body").scrollTop >= 619')
            page.keyboard.press('Escape')
            expect(page.locator('.nautilus-desk__focus-layer')).to_be_hidden()
            expect(card('task-0')).to_be_focused()
            expect(card('task-0').locator('.nautilus-desk__preview')).to_contain_text('Changed in the native editor stand-in')
            page.wait_for_function('() => deskHarness.api.activeEditors() === 0')
            checks.append('original UID editing and blur commit; no remount on text updates; shortcuts; per-task scroll; Escape to cards')

            card('task-0').click()
            focused('task-0')
            page.get_by_role('checkbox', name='Complete task').check()
            focused('task-1')
            expect(card('task-0')).to_have_count(0)
            page.evaluate('() => deskHarness.api.setString("source-task", "{{[[DONE]]}} Referenced prompt 30m")')
            expect(card('reference-wrapper')).to_have_count(0)
            page.evaluate('() => deskHarness.api.move("task-1", 80)')
            focused('task-1')
            page.keyboard.press('Escape')
            expect(card('task-1')).to_be_focused()
            checks.append('completion advances; referenced source completion removes wrapper; reorder keeps selected UID')

            card('task-2').click()
            focused('task-2')
            page.evaluate('() => deskHarness.api.failRead(true)')
            expect(page.locator('.nautilus-desk')).to_have_attribute('data-status', 'unavailable')
            expect(page.locator('.nautilus-desk__focus-layer')).to_be_hidden()
            expect(page.locator('.nautilus-desk__notice')).to_contain_text('out of date')
            expect(card('task-2')).to_be_disabled()
            expect(page.get_by_role('button', name='Hide Desk', exact=True)).to_be_focused()
            page.wait_for_function('() => deskHarness.api.activeEditors() === 0')
            page.evaluate('() => deskHarness.api.failRead(false)')
            expect(page.locator('.nautilus-desk')).to_have_attribute('data-status', 'ready')
            page.evaluate('() => deskHarness.api.remove("plan-desk")')
            expect(page.locator('.nautilus-desk')).to_have_attribute('data-status', 'missing')
            expect(page.locator('.nautilus-desk__card')).to_have_count(0)
            checks.append('read failures are stale, not empty; editor closes; recovery and confirmed plan deletion')

            mount(count=1)
            card('task-0').click()
            focused('task-0')
            page.get_by_role('checkbox', name='Complete task').check()
            focused('reference-wrapper')
            page.evaluate('() => deskHarness.api.setString("source-task", "{{[[DONE]]}} Last task")')
            expect(page.locator('.nautilus-desk__focus-layer')).to_be_hidden()
            expect(page.locator('.nautilus-desk__empty')).to_contain_text('No unfinished tasks')
            page.wait_for_function('() => deskHarness.api.activeEditors() === 0')
            checks.append('last completion returns to a genuine empty overview')

            mount()
            page.evaluate('() => deskHarness.api.failNextRender()')
            card('task-0').click()
            expect(page.locator('.nautilus-desk__editor-status')).to_contain_text('could not open')
            page.get_by_role('button', name='Try again', exact=True).click()
            focused('task-0')
            page.keyboard.press('Escape')
            page.evaluate('() => deskHarness.api.holdNextRender()')
            card('task-1').click()
            page.wait_for_function('() => deskHarness.api.pendingRender()')
            page.keyboard.press('Alt+Comma')
            page.keyboard.press('Escape')
            page.keyboard.press('Escape')
            expect(page.locator('.nautilus-desk')).to_have_count(0)
            page.evaluate('() => deskHarness.api.release()')
            page.wait_for_function('() => deskHarness.api.activeEditors() === 0 && deskHarness.api.stats.watches === 0')
            expect(page.get_by_role('button', name='Open Desk', exact=True)).to_be_focused()
            assert page.evaluate('() => deskHarness.api.stats.renders.map(x => x.uid)') == ['task-0', 'task-0', 'task-1']
            assert not page.locator('body').evaluate('(el) => el.classList.contains("nautilus-desk-focus-open")')
            checks.append('native mount error retry; pending mount/rapid switch/close race; unmount and watch cleanup')

            mount(editor=False)
            card('task-0').click()
            expect(page.locator('.nautilus-desk__editor-status')).to_contain_text('does not expose')
            page.keyboard.press('Escape')
            expect(page.locator('.nautilus-desk__focus-layer')).to_be_hidden()
            checks.append('missing native API has an explicit, recoverable error')

            mount()
            card('task-0').click()
            focused('task-0')
            page.locator('textarea[data-block-uid="task-0"]').focus()
            page.evaluate('''() => {
              const input = document.activeElement;
              input.dispatchEvent(new CompositionEvent('compositionstart', {bubbles:true}));
              input.dispatchEvent(new KeyboardEvent('keydown', {bubbles:true,altKey:true,code:'Comma',key:'≤'}));
              deskHarness.api.setString('task-0','{{[[DONE]]}} Completed during composition');
            }''')
            expect(page.locator('.nautilus-desk__native')).to_have_attribute('data-task-uid', 'task-0')
            page.evaluate('() => document.activeElement.dispatchEvent(new CompositionEvent("compositionend", {bubbles:true}))')
            focused('task-1')
            page.locator('textarea[data-block-uid="task-1"]').evaluate('''(el) => {
              el.addEventListener('keydown', (e) => e.preventDefault(), {once:true});
              el.dispatchEvent(new KeyboardEvent('keydown', {bubbles:true,cancelable:true,key:'Escape'}));
            }''')
            focused('task-1')
            page.locator('textarea[data-block-uid="task-1"]').focus()
            page.evaluate('() => document.activeElement.dispatchEvent(new CompositionEvent("compositionstart", {bubbles:true}))')
            page.evaluate('() => deskHarness.api.failRead(true)')
            expect(page.locator('.nautilus-desk')).to_have_attribute('data-status', 'unavailable')
            page.evaluate('() => deskHarness.api.failRead(false)')
            expect(page.locator('.nautilus-desk')).to_have_attribute('data-status', 'ready')
            card('task-1').click()
            focused('task-1')
            page.keyboard.press('Alt+Comma')
            focused('task-2')
            page.keyboard.press('Escape')
            checks.append('IME defers switching; native-consumed Escape is respected; read failures reset composition safely')

            page.evaluate('''() => deskHarness.api.setString('task-2', '{{[[TODO]]}} <img src=x onerror="window.deskInjected=1"> 10m')''')
            expect(card('task-2')).to_have_attribute('aria-label', '<img src=x onerror="window.deskInjected=1">')
            expect(page.locator('.nautilus-desk img')).to_have_count(0)
            assert not page.evaluate('() => window.deskInjected')
            checks.append('card strings are rendered as text, never injected HTML')

            mount(count=100)
            assert not page.evaluate('() => deskHarness.api.stats.reads.includes("task-99")'), 'offscreen logs were eagerly read'
            target = card('task-25')
            target.scroll_into_view_if_needed()
            target.click()
            focused('task-25')
            before = page.evaluate('() => window.scrollY')
            assert before > 0
            page.keyboard.press('Escape')
            expect(target).to_be_focused()
            after = page.evaluate('() => window.scrollY')
            assert abs(before - after) <= 1, (before, after)
            page.keyboard.press('Escape')
            page.wait_for_function('() => deskHarness.api.stats.watches === 0')
            reads = page.evaluate('() => deskHarness.api.stats.reads.length')
            page.evaluate('() => deskHarness.api.setString("task-1", "{{[[TODO]]}} Changed while closed")')
            assert page.evaluate('() => deskHarness.api.stats.reads.length') == reads
            page.evaluate('() => deskHarness.api.setString("task-1", "{{[[DONE]]}} Completed while closed")')
            page.get_by_role('button', name='Open Desk', exact=True).click()
            expect(card('task-1')).to_have_count(0)
            expect(page.locator('.nautilus-desk__focus-layer')).to_be_hidden()
            page.keyboard.press('Escape')
            checks.append('lazy offscreen previews; overview scroll preserved; no reads after close; fresh overview on reopen')

            page.get_by_role('button', name='Open other Desk', exact=True).click()
            expect(page.locator('.nautilus-desk__card')).to_have_count(1)
            expect(card('other-task')).to_be_visible()
            expect(page.locator('.nautilus-desk__date').first).to_contain_text('October 25th')
            card('other-task').click()
            focused('other-task')
            page.evaluate('''() => {
              window.roamAlphaAPI.graph.name = 'different-graph';
              window.dispatchEvent(new HashChangeEvent('hashchange'));
            }''')
            expect(page.locator('.nautilus-desk')).to_have_count(0)
            page.wait_for_function('() => deskHarness.api.activeEditors() === 0')
            checks.append('clicked plan/date scope and graph-navigation cleanup')

            mount(count=5)
            page.wait_for_function('document.querySelector(".nautilus-desk__grid").dataset.columns === "2"')
            outline_before = page.evaluate('() => deskHarness.api.children("plan-desk").map(n => [n.uid,n.order,n.string])')
            page.locator('#page-after').fill('Original page remains editable with Desk open.')
            page.keyboard.press('Escape')
            expect(page.locator('.nautilus-desk')).to_have_count(1)
            card('reference-wrapper').focus()
            page.keyboard.press('Tab')
            expect(page.get_by_role('button', name='Open other Desk', exact=True)).to_be_focused()
            card('task-0').focus()
            card('task-0').evaluate('''el => el.dispatchEvent(new DragEvent('dragstart', {bubbles:true,cancelable:true,dataTransfer:new DataTransfer()}))''')
            page.keyboard.press('Escape')
            expect(page.locator('.nautilus-desk')).to_have_count(1)
            expect(page.locator('.nautilus-desk__card.is-dragging')).to_have_count(0)
            checks.append('inline Desk leaves the page editable, releases Tab focus, and Escape cancels dragging without closing the view')
            target_box = card('task-2').bounding_box()
            card('task-0').drag_to(card('task-2'), target_position={'x': 40, 'y': target_box['height'] - 5})
            page.wait_for_function('''() => [...document.querySelectorAll('.nautilus-desk__card')].map(n=>n.dataset.taskUid).slice(0,3).join() === 'task-1,task-2,task-0' ''')
            expect(page.locator('.nautilus-desk__focus-layer')).to_have_count(0)
            assert page.evaluate('() => deskHarness.api.stats.renders.length') == 0
            assert page.evaluate('() => deskHarness.api.children("plan-desk").map(n => [n.uid,n.order,n.string])') == outline_before
            card('task-0').focus()
            page.keyboard.press('Enter')
            focused('task-0')
            expect(page.locator('.nautilus-desk__position')).to_have_text('3 / 6')
            page.keyboard.press('Escape')
            page.get_by_role('button', name='Open Desk', exact=True).click()
            expect(page.locator('.nautilus-desk')).to_have_count(0)
            page.get_by_role('button', name='Open Desk', exact=True).click()
            expect(page.locator('.nautilus-desk__card').first).to_have_attribute('data-task-uid', 'task-1')
            page.get_by_role('button', name='Restore outline order').click()
            expect(page.locator('.nautilus-desk__card').first).to_have_attribute('data-task-uid', 'task-0')
            card('task-0').focus()
            page.keyboard.press('Alt+Shift+ArrowRight')
            expect(page.locator('.nautilus-desk__card').first).to_have_attribute('data-task-uid', 'task-1')
            assert page.evaluate('() => deskHarness.api.stats.forbiddenWrites') == 0
            assert page.evaluate('() => deskHarness.api.children("plan-desk").map(n => [n.uid,n.order,n.string])') == outline_before
            checks.append('real pointer drag, keyboard reorder, session-only layout, reset, and zero outline/schedule writes')

            page.evaluate('() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')
            boxes = page.locator('.nautilus-desk__card').evaluate_all('(els) => els.map(el => {const r=el.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})')
            assert len(set(round(b['h']) for b in boxes)) > 1, boxes
            for i, a in enumerate(boxes):
                for b in boxes[i+1:]:
                    assert (a['x'] + a['w'] <= b['x'] + 1 or b['x'] + b['w'] <= a['x'] + 1
                            or a['y'] + a['h'] <= b['y'] + 1 or b['y'] + b['h'] <= a['y'] + 1), (a,b)
            page.get_by_role('button', name='Restore outline order').click()
            card('task-0').scroll_into_view_if_needed()
            page.screenshot(path=str(OUT / 'inline-masonry.png'))
            checks.append('natural, unequal card heights and packed columns without overlaps')

            watches_before = page.evaluate('() => deskHarness.api.stats.watches')
            page.evaluate('() => deskHarness.api.openCopy()')
            expect(page.locator('.nautilus-desk')).to_have_count(2)
            assert page.evaluate('() => deskHarness.api.stats.watches') == watches_before
            main_card = page.locator('[data-fixture-host="plan-desk"] .nautilus-desk__card').first
            main_card.focus()
            page.evaluate('() => deskHarness.api.setString("task-1", "{{[[TODO]]}} Updated without stealing focus 45m")')
            expect(page.locator('[data-fixture-host="copy"] .nautilus-desk__card[data-task-uid="task-1"]')).to_have_attribute('aria-label', 'Updated without stealing focus')
            expect(main_card).to_be_focused()
            page.get_by_role('button', name='Open Desk', exact=True).click()
            expect(page.locator('.nautilus-desk')).to_have_count(1)
            assert page.evaluate('() => deskHarness.api.stats.watches') == watches_before
            page.locator('[data-fixture-host="copy"] .nautilus-desk__card').first.click()
            expect(page.locator('.nautilus-desk__editor-status')).to_be_hidden()
            page.evaluate('() => deskHarness.api.removeHost("copy")')
            expect(page.locator('.nautilus-desk')).to_have_count(0)
            expect(page.locator('.nautilus-desk__focus-layer')).to_have_count(0)
            page.wait_for_function('() => deskHarness.api.activeEditors() === 0 && deskHarness.api.stats.watches === 0')
            checks.append('independent chart instances share watches; renderer removal cleans up its Desk and focus editor')

            mount(language='zh', dark=True)
            expect(page.locator('.nautilus-desk__summary')).to_have_text('(9)')
            expect(page.locator('.nautilus-desk__summary')).to_have_attribute('aria-label', '9 项未完成任务')
            expect(card('task-0').locator('.nautilus-desk__preview')).to_contain_text('☑ 第 1 轮')
            page.wait_for_function('''() => [...document.querySelectorAll('.nautilus-desk__card')]
              .filter(el => el.getBoundingClientRect().top < innerHeight)
              .every(el => deskHarness.api.stats.reads.includes(el.dataset.taskUid))''')
            page.screenshot(path=str(OUT / 'overview-dark-zh.png'))
            card('task-0').click()
            focused('task-0')
            page.screenshot(path=str(OUT / 'focus-dark-zh.png'))
            page.keyboard.press('Escape')
            page.set_viewport_size({'width': 390, 'height': 844})
            page.wait_for_function('document.querySelector(".nautilus-desk__grid").dataset.columns === "1"')
            assert page.locator('.nautilus-desk').evaluate('(el) => el.scrollWidth <= el.clientWidth')
            page.screenshot(path=str(OUT / 'overview-mobile.png'))
            card('task-0').click()
            focused('task-0')
            assert page.locator('.nautilus-desk__focus').evaluate('(el) => el.getBoundingClientRect().right <= innerWidth')
            page.screenshot(path=str(OUT / 'focus-mobile.png'))
            page.evaluate('() => deskHarness.destroy()')
            expect(page.locator('.nautilus-desk')).to_have_count(0)
            page.wait_for_function('() => deskHarness.api.activeEditors() === 0 && deskHarness.api.stats.watches === 0')
            assert page.evaluate('() => deskHarness.api.stats.forbiddenWrites') == 0
            assert not errors, errors
            checks.append('Chinese/dark/mobile layouts; unload removes all mounted editors and watches; no plugin writes')
            page.set_viewport_size({'width': 1280, 'height': 1000})
            mount(language='zh', count=4)
            page.wait_for_function('''() => [...document.querySelectorAll('.nautilus-desk__card')]
              .every(el => deskHarness.api.stats.reads.includes(el.dataset.taskUid))''')
            page.locator('.nautilus-desk').screenshot(path=str(OUT / 'inline-cards-zh.png'))
            page.evaluate('() => deskHarness.destroy()')
            expect(page.locator('.nautilus-desk')).to_have_count(0)
            (OUT / 'results.json').write_text(json.dumps({'status':'passed','checks':checks,'pageerrors':errors,
                'limitation':'Native block editor is simulated; not a real Roam Desktop acceptance run.'}, ensure_ascii=False, indent=2))
            print(f'PASSED: {len(checks)} Desk scenario groups; artifacts: {OUT}')
        finally:
            browser.close()


if __name__ == '__main__':
    run()
