#!/usr/bin/env python3
"""Production Desk + write/read adapters against a synthetic graph.
The native editor is a stand-in. Optional ROAM_NATIVE_CSS/ROAM_BLUEPRINT_CSS
snapshots validate the real host styles without shipping Roam's client bundle.
"""
import json
import os
import subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ.get('DESK_TEST_OUT', '/tmp/nautilus-desk-verify'))


def bundle():
    OUT.mkdir(parents=True, exist_ok=True)
    subprocess.run(['node', str(ROOT / 'test/desk-bundle.cjs'), str(OUT)], check=True, cwd=ROOT)
    native = Path(os.environ.get('ROAM_NATIVE_CSS', ROOT / 'test/desk-native-fixture.css'))
    blueprint = os.environ.get('ROAM_BLUEPRINT_CSS')
    bp_link = f'<link rel="stylesheet" href="{Path(blueprint).as_uri()}">' if blueprint else ''
    extra_links = ''.join(f'<link rel="stylesheet" href="{Path(value).as_uri()}">' for value in
                          [os.environ.get('ROAM_ICONS_CSS'), os.environ.get('ROAM_FONT_CSS')] if value)
    (OUT / 'index.html').write_text(f'''<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Nautilus native Desk fixture</title>{bp_link}{extra_links}
<link rel="stylesheet" href="{native.as_uri()}"><link rel="stylesheet" href="{(ROOT / 'extension.css').as_uri()}">
<style>
body {{ margin:0; font-family:Inter,sans-serif; font-size:15px; line-height:1.5; color:#202b33; }}
.roam-article {{ width:min(800px,100%); margin:auto; padding:30px 42px; font-size:15px; line-height:1.5; }}
.rm-article-wrapper {{ width:100%; overflow-x:auto; }}
.fixture-shell {{ height:130px; border-bottom:1px solid #e1e8ed; }}
.fixture-launch {{ float:right; }}
.fixture-raw {{ padding:10px; }}
.fixture-owner {{ margin-bottom:20px; }}
.nautilus-desk__native textarea {{ width:100%; display:block; min-height:90px; margin:8px 0; font:inherit; color:inherit; background:transparent; }}
body.bp3-dark {{ background:#293742;color:#e1e8ed; }}
#page-after {{ min-height:120px; }}
</style></head><body><div class="roam-app"><div class="roam-main"><div class="rm-article-wrapper"><article class="roam-article">
<h1>October 26th, 2026</h1><div id="launchers"></div><div id="page-after" contenteditable="true">Other page content remains editable.</div>
</article></div></div></div><script src="harness.js"></script></body></html>''')


def run():
    bundle()
    checks = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            page = browser.new_page(viewport={'width': 1280, 'height': 1000})
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.goto((OUT / 'index.html').as_uri())
            page.wait_for_function('() => window.deskHarness?.mount')
            page.evaluate('async () => { await document.fonts.ready; return true; }')

            def mount(**options):
                page.evaluate('(o) => deskHarness.mount(o)', options)
                page.get_by_role('button', name='Open Desk', exact=True).click()
                expect(page.locator('.nautilus-desk').first).to_have_attribute('data-status', 'ready')

            def card(uid):
                return page.locator(f'.nautilus-desk__card[data-task-uid="{uid}"]')

            def activate(uid):
                card(uid).locator('.rm-desk-tile__preview').click()
                focused(uid)

            def focused(uid):
                expect(page.locator('.nautilus-desk__native')).to_have_attribute('data-task-uid', uid)
                expect(page.locator('.nautilus-desk__focus-body > [role="status"]')).to_be_hidden()

            def close_focus():
                page.locator('.rm-desk__side--end').get_by_role('button', name='Close', exact=True).click()
                expect(page.locator('.nautilus-desk__focus-layer')).to_have_count(0)

            def top(uid):
                card(uid).hover()
                card(uid).get_by_role('button', name='Move to top', exact=True).click()

            mount()
            expect(page.locator('.nautilus-desk__card')).to_have_count(9)
            expect(page.locator('[data-fixture-host="plan-desk"] > .fixture-raw')).to_be_hidden()
            expect(page.locator('[data-fixture-host="other-plan"] > .fixture-raw')).to_be_visible()
            expect(page.locator('.nautilus-desk__focus-layer')).to_have_count(0)
            assert page.evaluate('() => deskHarness.api.stats.writes.length') == 0
            assert page.evaluate('() => deskHarness.api.stats.renders.length') == 0
            for uid in ['event', 'done', 'done-reference', 'divider']:
                expect(card(uid)).to_have_count(0)
            expect(card('task-2')).to_be_visible()
            page.wait_for_function('Number(document.querySelector(".nautilus-desk__grid").dataset.columns) >= 4')
            styles = card('task-0').locator('.rm-desk-tile__preview').evaluate('(el) => ({size:getComputedStyle(el).fontSize,line:getComputedStyle(el).lineHeight})')
            assert styles == {'size':'13px','line':'19.5px'}, styles
            assert page.locator('.rm-desk-page__title').evaluate('(el) => getComputedStyle(el).fontSize') == '22px'
            expect(card('task-0').locator('.rm-desk-tile__check--done')).to_have_count(1)
            checks.append('native style classes/metrics, wide auto-fill, task filters, no editor mounts or graph writes on opening')

            before = page.evaluate('() => deskHarness.api.children("plan-desk").map(r=>[r.uid,r.string,r.open])')
            top('task-4')
            page.wait_for_function('deskHarness.api.children("plan-desk")[0].uid === "task-4"')
            expect(page.locator('.nautilus-desk__card').first).to_have_attribute('data-task-uid', 'task-4')
            expect(page.locator('[data-raw-plan="plan-desk"] > div').first).to_have_attribute('data-raw-uid', 'task-4')
            after = page.evaluate('() => deskHarness.api.children("plan-desk").map(r=>[r.uid,r.string,r.open])')
            assert sorted(before) == sorted(after)
            card('task-2').drag_to(card('task-4'))
            page.wait_for_function('deskHarness.api.children("plan-desk")[0].uid === "task-2"')
            assert page.evaluate('() => deskHarness.api.stats.writes.at(-1).uid') == 'task-2'
            assert page.evaluate('() => deskHarness.api.stats.forbiddenWrites') == 0
            checks.append('Move to top and real drag move original UIDs to outline index zero, without changing text/open state or native Desk')

            order = page.evaluate('() => deskHarness.api.children("plan-desk").map(r=>r.uid)')
            page.evaluate('() => deskHarness.api.failNextMove()')
            top('task-3')
            expect(page.locator('.nautilus-desk__notice')).to_contain_text('Move failed')
            assert page.evaluate('() => deskHarness.api.children("plan-desk").map(r=>r.uid)') == order
            page.evaluate('() => deskHarness.api.holdNextMove()')
            top('task-3')
            page.wait_for_function('deskHarness.api.pending()')
            expect(card('task-3').get_by_role('button', name='Move to top')).to_be_disabled()
            assert page.evaluate('() => deskHarness.api.children("plan-desk").map(r=>r.uid)') == order
            page.evaluate('() => deskHarness.api.release()')
            page.wait_for_function('deskHarness.api.children("plan-desk")[0].uid === "task-3"')
            checks.append('failed and pending writes do not optimistically reorder cards; duplicate actions are disabled')

            activate('task-0')
            assert page.evaluate('() => deskHarness.api.stats.renders.at(-1).zoom') is True
            expect(page.locator('.nautilus-desk__native .rm-block-children')).to_be_visible()
            current = page.evaluate('() => deskHarness.api.stats.renders.length')
            edit = page.locator('textarea[data-block-uid="task-0"]')
            edit.fill('{{[[TODO]]}} Edited original title 45m')
            page.locator('.rm-desk--dialog').focus()
            expect(card('task-0').locator('[role="button"]')).to_have_attribute('aria-label', 'Edited original title 45m')
            assert page.evaluate('() => deskHarness.api.stats.renders.length') == current
            edit.fill('')
            page.evaluate('() => deskHarness.api.setString("task-0", "")')
            focused('task-0')
            expect(edit).to_be_focused()
            edit.fill('{{[[TODO]]}} Edited original title 45m')
            page.evaluate('() => deskHarness.api.setString("task-0", "{{[[TODO]]}} Edited original title 45m")')
            assert page.evaluate('() => deskHarness.api.stats.renders.length') == current
            page.locator('textarea[data-block-uid="task-0-note-0"]').fill('Changed original child log')
            page.keyboard.press('Alt+Comma')
            focused('task-1')
            assert page.evaluate('() => deskHarness.api.text("task-0-note-0")') == 'Changed original child log'
            page.keyboard.press('Alt+Period')
            focused('task-0')
            page.locator('.nautilus-desk__focus-body').evaluate('(el) => el.scrollTop=400')
            page.locator('.rm-desk--dialog').focus()
            page.keyboard.press('Alt+Comma'); focused('task-1')
            page.keyboard.press('Alt+Period'); focused('task-0')
            page.wait_for_function('document.querySelector(".nautilus-desk__focus-body").scrollTop >= 399')
            close_focus()
            activate('reference-wrapper')
            expect(page.locator('.rm-desk__header').get_by_role('button', name='Next', exact=True)).to_be_disabled()
            close_focus()
            checks.append('native UID/children editing, zoom path, bounded native navigation, no remount on text edits, and per-task scroll restoration')

            visible_order = page.locator('.nautilus-desk__card').evaluate_all('(els) => els.map(el=>el.dataset.taskUid)')
            card(visible_order[0]).locator('[role="button"]').focus()
            page.keyboard.down('Alt')
            expect(page.locator('.nautilus-desk__grid')).to_have_class('rm-desk-overview rm-desk-overview--masonry nautilus-desk__grid rm-desk-overview--numbers')
            page.keyboard.press('2')
            page.keyboard.up('Alt')
            focused(visible_order[1]); close_focus()
            activate('task-1')
            previous_uid = visible_order[visible_order.index('task-1') - 1]
            page.locator('.nautilus-desk__focus-body').evaluate('''el => {
              el.dispatchEvent(new WheelEvent('wheel',{bubbles:true,deltaX:100,deltaY:0}));
              el.dispatchEvent(new WheelEvent('wheel',{bubbles:true,deltaX:100,deltaY:0}));
            }''')
            focused(previous_uid)
            page.locator('.nautilus-desk__focus-body').dispatch_event('wheel',{'deltaX':-100,'deltaY':0})
            focused('task-1')
            close_focus()
            checks.append('native Alt-number hints and selection, horizontal swipe navigation, and one step per gesture')

            activate('task-1')
            page.get_by_role('button', name='More', exact=True).click()
            expect(page.get_by_role('menuitem', name='Move to top', exact=True)).to_be_visible()
            expect(page.get_by_role('menuitem', name='Open in main window', exact=True)).to_be_visible()
            page.keyboard.press('Escape')
            focused('task-1')
            expect(page.get_by_role('menuitem', name='Move to top', exact=True)).to_be_hidden()
            page.get_by_role('button', name='More', exact=True).click()
            page.get_by_role('menuitem', name='Open in main window', exact=True).click()
            expect(page.locator('.nautilus-desk__focus-layer')).to_have_count(0)
            assert page.evaluate('() => deskHarness.api.stats.opened.at(-1)') == {'uid':'task-1','sidebar':False}
            checks.append('native-style More menu exposes named actions and Escape closes the menu before the Desk')

            count_writes = page.evaluate('() => deskHarness.api.stats.writes.length')
            page.locator('.rm-desk-page__new-note').click()
            expect(page.get_by_role('textbox', name='New note', exact=True)).to_be_focused()
            assert page.evaluate('() => deskHarness.api.stats.writes.length') == count_writes
            close_focus()
            assert page.evaluate('() => deskHarness.api.stats.writes.length') == count_writes
            activate('task-1')
            page.locator('.rm-desk__side--end').get_by_role('button', name='New note', exact=True).click()
            page.evaluate('() => deskHarness.api.holdNextCreate()')
            page.get_by_role('textbox', name='New note', exact=True).fill('First draft')
            page.wait_for_function('deskHarness.api.pending()')
            page.get_by_role('textbox', name='New note', exact=True).fill('First draft with the remaining input preserved')
            page.evaluate('() => deskHarness.api.release()')
            page.wait_for_function('deskHarness.api.stats.writes.filter(w=>w.type==="create").length===1')
            new_uid = page.evaluate('() => deskHarness.api.stats.writes.find(w=>w.type==="create").uid')
            focused(new_uid)
            assert page.evaluate('(uid) => deskHarness.api.text(uid)', new_uid) == 'First draft with the remaining input preserved'
            assert page.evaluate('() => deskHarness.api.children("plan-desk")[0].uid') == new_uid
            assert page.evaluate('() => deskHarness.api.stats.writes.find(w=>w.type==="create").parent') == 'plan-desk'
            close_focus()
            checks.append('both plus controls use native-style drafts; no empty-note junk; one root-child creation with buffered text preserved')

            page.locator('.rm-desk-page__new-note').click()
            draft = page.get_by_role('textbox', name='New note', exact=True)
            draft.dispatch_event('compositionstart')
            draft.fill('中文输入法提交后才创建')
            assert page.evaluate('() => deskHarness.api.stats.writes.filter(w=>w.type==="create").length') == 1
            draft.dispatch_event('compositionend')
            page.wait_for_function('deskHarness.api.stats.writes.filter(w=>w.type==="create").length===2')
            uid2 = page.evaluate('() => deskHarness.api.stats.writes.filter(w=>w.type==="create").at(-1).uid')
            focused(uid2); close_focus()
            checks.append('IME draft composition is committed once, only after composition ends')

            search = page.get_by_role('textbox', name='Search Desk', exact=True)
            search.fill('中文输入法')
            expect(page.locator('.nautilus-desk__card')).to_have_count(1)
            expect(card(uid2)).to_be_visible()
            search.fill('')
            expect(card('task-0')).to_be_visible()
            checks.append('native search controls filter the active task view without changing graph membership')

            before_count = page.evaluate('() => deskHarness.api.stats.writes.length')
            page.evaluate('() => deskHarness.api.removeHost("plan-desk")')
            expect(page.locator('.nautilus-desk')).to_have_count(0)
            page.evaluate('() => deskHarness.api.restoreHost()')
            expect(page.locator('.nautilus-desk')).to_have_count(1)
            expect(page.locator('[data-fixture-host="plan-desk"] > .fixture-raw')).to_be_hidden()
            page.evaluate('() => deskHarness.api.reloadView()')
            expect(page.locator('.nautilus-desk')).to_have_count(1)
            assert page.evaluate('() => deskHarness.api.stats.writes.length') == before_count
            prefs = page.evaluate('() => Object.fromEntries(Object.entries(localStorage).filter(([k])=>k.startsWith("nautilus-log:desk-view:")))')
            assert list(prefs.values()) == ['true'], prefs
            page.get_by_role('button', name='Hide Desk', exact=True).click()
            expect(page.locator('[data-fixture-host="plan-desk"] > .fixture-raw')).to_be_visible()
            page.evaluate('() => deskHarness.api.reloadView()')
            expect(page.locator('.nautilus-desk')).to_have_count(0)
            page.get_by_role('button', name='Open Desk', exact=True).click()
            checks.append('navigate away/back and controller reload restore Desk; explicit close restores the original outline and persists off')

            activate('task-0')
            # Completion replaces this editor. Freeze the UID and assert graph
            # state, rather than letting check() retry against the next checkbox.
            page.locator('.nautilus-desk__native[data-task-uid="task-0"]').get_by_role('checkbox', name='Complete task').click()
            page.wait_for_function('deskHarness.api.text("task-0").startsWith("{{[[DONE]]}}")')
            expect(card('task-0')).to_have_count(0)
            page.evaluate('() => deskHarness.api.setString("source-task", "{{[[DONE]]}} Source completed")')
            expect(card('reference-wrapper')).to_have_count(0)
            close_focus()
            completion_state = page.evaluate('''() => ({task1:deskHarness.api.text('task-1'), writes:deskHarness.api.stats.nativeWrites, cards:[...document.querySelectorAll('.nautilus-desk__card')].map(n=>n.dataset.taskUid)})''')
            assert 'task-1' in completion_state['cards'], completion_state
            page.evaluate('() => deskHarness.api.failNextRender()')
            card('task-1').locator('[role="button"]').click()
            expect(page.locator('.nautilus-desk__focus-body > [role="status"]')).to_contain_text('could not open')
            page.get_by_role('button', name='Try again', exact=True).click(); focused('task-1')
            page.evaluate('() => deskHarness.api.failRead(true)')
            expect(page.locator('.nautilus-desk')).to_have_attribute('data-status', 'unavailable')
            expect(page.locator('.nautilus-desk__focus-layer')).to_have_count(0)
            expect(card('task-1').get_by_role('button', name='Move to top')).to_be_disabled()
            page.evaluate('() => deskHarness.api.failRead(false)')
            expect(page.locator('.nautilus-desk')).to_have_attribute('data-status', 'ready')
            checks.append('completion/reference state, mount-error retry, stale-read pause, and recovery remain safe')

            watches = page.evaluate('() => deskHarness.api.stats.watches')
            page.evaluate('() => deskHarness.api.openCopy()')
            expect(page.locator('.nautilus-desk')).to_have_count(2)
            assert page.evaluate('() => deskHarness.api.stats.watches') == watches
            sidebar = page.locator('[data-fixture-host="copy"] .nautilus-desk')
            expect(sidebar.locator('.nautilus-desk__grid')).to_have_attribute('data-columns', '1')
            assert sidebar.evaluate('(el) => el.getBoundingClientRect().width <= 280')
            page.evaluate('() => deskHarness.api.removeHost("copy")')
            expect(page.locator('.nautilus-desk')).to_have_count(1)
            checks.append('sidebar is confined and responsive; duplicate plan instances share watches and clean up independently')

            mount(editor=False)
            card('task-0').locator('[role="button"]').click()
            expect(page.locator('.nautilus-desk__focus-body > [role="status"]')).to_contain_text('unavailable')
            close_focus()
            mount()
            page.evaluate('() => deskHarness.api.holdNextRender()')
            card('task-1').locator('[role="button"]').click()
            page.wait_for_function('deskHarness.api.pending()')
            page.locator('.rm-desk__header').get_by_role('button', name='Next', exact=True).click()
            close_focus()
            page.get_by_role('button', name='Hide Desk', exact=True).click()
            page.evaluate('() => deskHarness.api.release()')
            page.wait_for_function('deskHarness.api.activeEditors()===0 && deskHarness.api.stats.watches===0')
            assert page.evaluate('() => deskHarness.api.stats.renders.length') == 1
            expect(page.locator('.nautilus-desk__focus-layer')).to_have_count(0)
            checks.append('missing native APIs fail explicitly; delayed native mounts cannot resurrect a closed view')

            mount(empty=True)
            expect(page.locator('.nautilus-desk__card')).to_have_count(0)
            page.locator('.rm-desk-page__new-note').click()
            page.get_by_role('textbox', name='New note', exact=True).fill('New content in an empty plan')
            page.wait_for_function('deskHarness.api.stats.writes.some(w=>w.type==="create")')
            created = page.evaluate('() => deskHarness.api.stats.writes.find(w=>w.type==="create").uid')
            focused(created); close_focus()
            expect(page.locator('.nautilus-desk__card')).to_have_count(1)
            page.reload()
            page.wait_for_function('() => window.deskHarness?.mount')
            page.evaluate('() => deskHarness.mount({preservePreferences:true})')
            expect(page.locator('.nautilus-desk')).to_have_count(1)
            expect(page.locator('[data-fixture-host="plan-desk"] > .fixture-raw')).to_be_hidden()
            checks.append('empty plans can create content and a full browser reload restores the persisted Desk flag')

            activate('task-1')
            writes_before = page.evaluate('() => deskHarness.api.stats.writes.length')
            page.evaluate('''() => {roamAlphaAPI.graph.name='other-graph';window.dispatchEvent(new HashChangeEvent('hashchange'));}''')
            expect(page.locator('.nautilus-desk')).to_have_count(0)
            page.wait_for_function('deskHarness.api.activeEditors()===0')
            assert page.evaluate('() => deskHarness.api.stats.writes.length') == writes_before
            page.evaluate('() => deskHarness.api.reloadView()')
            expect(page.locator('.nautilus-desk')).to_have_count(0)
            assert page.evaluate('() => localStorage.getItem("nautilus-log:desk-view:v1:desk-fixture:plan-desk")') == 'true'
            checks.append('graph changes release the editor and outline hiding without leaking a saved view flag into another graph')

            mount()
            for width, minimum in [(1700, 5), (900, 3), (390, 1)]:
                page.set_viewport_size({'width':width,'height':1000})
                page.wait_for_function('(n) => Number(document.querySelector(".nautilus-desk__grid").dataset.columns) >= n', arg=minimum)
                if width == 390:
                    expect(page.locator('.nautilus-desk__grid')).to_have_attribute('data-columns','1')
                page.evaluate('() => new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
                assert page.locator('.nautilus-desk').evaluate('(el) => {const r=el.getBoundingClientRect();return r.left>=-1 && r.right<=innerWidth+1}')
            page.set_viewport_size({'width':1280,'height':1000})
            page.wait_for_function('Number(document.querySelector(".nautilus-desk__grid").dataset.columns)>=4')
            card('task-1').hover()
            page.wait_for_function('getComputedStyle(document.querySelector("[data-task-uid=\\"task-1\\"] .rm-desk-tile__actions")).opacity === "1"')
            page.locator('.nautilus-desk').screenshot(path=str(OUT/'native-desk-overview.png'))
            activate('task-1')
            page.screenshot(path=str(OUT/'native-desk-focus.png'))
            checks.append('native auto-fill adapts from one to five columns without changing fonts or overflowing its surface')
            page.evaluate('() => deskHarness.destroy()')
            page.wait_for_function('deskHarness.api.activeEditors()===0 && deskHarness.api.stats.watches===0')
            expect(page.locator('[data-fixture-host="plan-desk"] > .fixture-raw')).to_be_visible()
            assert page.evaluate('() => deskHarness.api.stats.forbiddenWrites') == 0
            assert not errors, errors
            checks.append('unload releases native editors, watches, outline hiding, and layout observers')
            (OUT/'results.json').write_text(json.dumps({'status':'passed','checks':checks,'pageerrors':errors,
                'native_css':os.environ.get('ROAM_NATIVE_CSS','offline fixture'),
                'limitation':'Graph and native editor are simulated; real-host read-only parity validation is separate.'},ensure_ascii=False,indent=2))
            print(f'PASSED: {len(checks)} native Desk scenario groups; artifacts: {OUT}')
        finally:
            browser.close()


if __name__ == '__main__':
    run()
