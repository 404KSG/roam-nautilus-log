#!/usr/bin/env python3
"""Production Desk + write/read adapters against a synthetic graph.
The native editor is a stand-in. Optional ROAM_NATIVE_CSS/ROAM_BLUEPRINT_CSS
snapshots validate the real host styles without shipping Roam's client bundle.
"""
import json
import os
import subprocess
import struct
import zlib
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ.get('DESK_TEST_OUT', '/tmp/nautilus-desk-verify'))


def png(width=640, height=360):
    """A local opaque raster; browser interception prevents all network I/O."""
    raw = b''.join(b'\x00' + bytes((35, 120, 210, 255)) * width for _ in range(height))
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')


RASTER_640_360 = png()


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
    geometry = {}
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

            def drag_start(tile):
                tile.evaluate('''el => el.dispatchEvent(new DragEvent('dragstart', {
                  bubbles:true, cancelable:true, dataTransfer:new DataTransfer()
                }))''')

            def drag_end(tile):
                tile.evaluate('''el => el.dispatchEvent(new DragEvent('dragend', {
                  bubbles:true, cancelable:true, dataTransfer:new DataTransfer()
                }))''')

            def external_drag(target='.nautilus-desk__grid', modifiers=None, payload=None):
                return page.evaluate('''({target, modifiers, payload}) => {
                  const source=document.querySelector('#fixture-external-outline .rm-bullet');
                  const dest=document.querySelector(target);
                  const fields={
                    'roam/block-uid-list-only-parents':'outside-source',
                    'roam/block-uid-list':'outside-source',
                    'roam/roam-uri-list':'https://roamresearch.com/#/app/desk-fixture/page/outside-source',
                    ...payload.fields,
                  };
                  const data={types:payload.types || Object.keys(fields),files:{length:payload.files || 0},effectAllowed:'copy',dropEffect:'none',getData:type=>fields[type] || ''};
                  let hostOver=0,hostDrop=0;
                  const overHost=()=>hostOver++,dropHost=()=>hostDrop++;
                  document.addEventListener('dragover',overHost); document.addEventListener('drop',dropHost);
                  const fire=(node,type)=>{
                    const rect=dest.getBoundingClientRect();
                    const event=new Event(type,{bubbles:true,cancelable:true});
                    const props={dataTransfer:{value:data},clientX:{value:rect.x+4},clientY:{value:rect.y+2}};
                    for(const key of ['altKey','ctrlKey','metaKey','shiftKey']) props[key]={value:Boolean(modifiers[key])};
                    Object.defineProperties(event,props);node.dispatchEvent(event);return event;
                  };
                  fire(source,'dragstart');
                  const over=fire(dest,'dragover');
                  const empty=document.querySelector('.nautilus-desk > .rm-desk-card__missing');
                  const feedback={root:dest.closest('.nautilus-desk').classList.contains('rm-desk-overview--drop'),
                    empty:empty?.classList.contains('rm-desk-overview--drop'),outline:empty ? getComputedStyle(empty).outlineWidth : null};
                  const drop=fire(dest,'drop'); fire(source,'dragend');
                  document.removeEventListener('dragover',overHost); document.removeEventListener('drop',dropHost);
                  return {over:over.defaultPrevented,drop:drop.defaultPrevented,hostOver,hostDrop,feedback};
                }''', {'target': target, 'modifiers': modifiers or {}, 'payload': payload or {}})

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

            code_requests = []
            page.route('https://desk-fixture.invalid/code.png', lambda route: code_requests.append(route))
            mount()
            # Simulate a late legacy extension rule. The native span formula
            # assumes zero row-gap; a one-class legacy override otherwise turns
            # every 4px grid track into a large vertical reservation.
            page.evaluate('''() => {
              const legacy=document.createElement('style');
              legacy.dataset.fixtureLegacyDeskGap='';
              legacy.textContent='.nautilus-desk__grid { gap: 16px; }';
              document.head.append(legacy);
              const next=document.createElement('div'); next.dataset.deskFollowing='';
              next.textContent='Following ordinary outline block';
              document.querySelector('[data-fixture-host="plan-desk"]').after(next);
            }''')
            expect(page.locator('.nautilus-desk__card')).to_have_count(11)
            expect(page.locator('[data-fixture-host="plan-desk"] > .fixture-raw')).to_be_hidden()
            expect(page.locator('[data-fixture-host="other-plan"] > .fixture-raw')).to_be_visible()
            expect(page.locator('.nautilus-desk__focus-layer')).to_have_count(0)
            assert page.evaluate('() => deskHarness.api.stats.writes.length') == 0
            assert page.evaluate('() => deskHarness.api.stats.renders.length') == 0
            for uid in ['event', 'done', 'done-reference', 'divider']:
                expect(card(uid)).to_have_count(0)
            expect(card('task-2')).to_be_visible()
            page.wait_for_function('Number(document.querySelector(".nautilus-desk__grid").dataset.columns) >= 1')
            styles = card('task-0').locator('.rm-desk-tile__preview').evaluate('(el) => ({size:getComputedStyle(el).fontSize,line:getComputedStyle(el).lineHeight})')
            assert styles == {'size':'13px','line':'19.5px'}, styles
            assert page.locator('.rm-desk-page__title').evaluate('(el) => getComputedStyle(el).fontSize') == '22px'
            expect(card('task-0').locator('.rm-desk-tile__check--done')).to_have_count(1)
            gap = page.evaluate('''() => {
              const grid=document.querySelector('.nautilus-desk__grid');
              const tiles=[...grid.querySelectorAll('.rm-desk-tile')];
              const gr=grid.getBoundingClientRect(), last=Math.max(...tiles.map(tile=>tile.getBoundingClientRect().bottom));
              const next=document.querySelector('[data-desk-following]').getBoundingClientRect();
              const style=getComputedStyle(grid);
              return {rowGap:style.rowGap, autoRows:style.gridAutoRows, columnGap:style.columnGap,
                gridBottom:gr.bottom, lastCardBottom:last, followingTop:next.top,
                reserved:gr.bottom-last, followingGap:next.top-last};
            }''')
            assert gap['rowGap'] == '0px', gap
            assert gap['autoRows'] == '4px', gap
            assert gap['reserved'] <= 32 and gap['followingGap'] <= 80, gap
            (OUT/'gap-measurement-after-open.json').write_text(json.dumps(gap, indent=2))
            page.wait_for_function('''()=>['task-0','task-1','task-2'].every(uid=>{const e=document.querySelector(`.nautilus-desk__card[data-task-uid="${uid}"]`);return e?.dataset.previewState==='ready'&&e.style.gridRowEnd===`span ${Math.ceil((e.offsetHeight+12)/4)}`})''')
            masonry = page.evaluate('''()=>{
              const grid=document.querySelector('.nautilus-desk__grid');
              const box=uid=>{const e=grid.querySelector(`[data-task-uid="${uid}"]`),r=e.getBoundingClientRect();return {uid,x:r.x,y:r.y,bottom:r.bottom,height:r.height,span:e.style.gridRowEnd}};
              return {columns:Number(grid.dataset.columns),a:box('task-0'),b:box('task-1'),c:box('task-2'),order:[...grid.children].map(e=>e.dataset.taskUid)};
            }''')
            assert masonry['columns'] == 2, masonry
            assert masonry['a']['height'] > masonry['b']['height'], masonry
            assert abs(masonry['c']['x'] - masonry['b']['x']) < 1, masonry
            assert masonry['b']['bottom'] <= masonry['c']['y'] < masonry['a']['bottom'], masonry
            (OUT/'masonry-flow.json').write_text(json.dumps(masonry, indent=2))
            checks.append('masonry places the next card beneath the shorter column, not an equal-height row')
            expect(card('task-0').locator('.rm-desk-tile__images img')).to_have_count(2)
            expect(card('task-0').locator('.rm-desk-tile__images img').nth(1)).to_have_js_property('naturalWidth', 40)
            # Code remains literal whether the asynchronous preview has loaded
            # yet or not; the lifecycle suite also proves a truly offscreen case.
            expect(card('code-literal').locator('.rm-desk-tile__title')).to_contain_text('![literal](https://desk-fixture.invalid/code.png) ((source-task))')
            assert not code_requests
            expect(card('context-wrapper').locator('.rm-desk-tile__title')).to_contain_text('Review')
            expect(card('context-wrapper').locator('.rm-desk-tile__title')).to_contain_text('tomorrow 15m')
            expect(card('reference-wrapper').locator('.rm-desk-tile__image img')).to_have_count(1)
            expect(card('task-1').locator('img')).to_have_count(0)
            page.evaluate('() => { window.unchangedPreview = document.querySelector(`[data-task-uid="reference-wrapper"] img`); }')
            # A pure descendant-image removal refreshes only this card.
            page.evaluate('() => deskHarness.api.setString("task-0-note-0", "Changed child without image")')
            expect(card('task-0').locator('.rm-desk-tile__image img')).to_have_count(1)
            assert page.evaluate('() => window.unchangedPreview === document.querySelector(`[data-task-uid="reference-wrapper"] img`)')
            page.route('https://desk-fixture.invalid/many-*.png', lambda route: route.fulfill(status=200, content_type='image/png', body=RASTER_640_360))
            page.evaluate('''() => deskHarness.api.setString("task-0-note-0", `Many images
              ![one](https://desk-fixture.invalid/many-1.png) ![two](https://desk-fixture.invalid/many-2.png)
              ![three](https://desk-fixture.invalid/many-3.png) ![four](https://desk-fixture.invalid/many-4.png)`)''')
            expect(card('task-0').locator('.rm-desk-tile__images-cell')).to_have_count(3)
            expect(card('task-0').locator('.rm-desk-tile__images-more')).to_have_text('+2')
            page.unroute('https://desk-fixture.invalid/many-*.png')
            page.evaluate('() => deskHarness.api.setString("task-0-note-0", "Changed child without image")')

            # A real held response, not a synthetic load event: verify the image
            # begins undecoded, then grows the card and its 4px masonry span.
            held = []
            page.route('https://desk-fixture.invalid/delayed-640.png', lambda route: held.append(route))
            before_delayed = card('task-3').evaluate('(el) => ({height:el.offsetHeight,span:el.style.gridRowEnd})')
            page.evaluate('''() => deskHarness.api.setString("task-3",
              "{{[[TODO]]}} Delayed fixture ![wide](https://desk-fixture.invalid/delayed-640.png)")''')
            delayed = card('task-3').locator('.rm-desk-tile__image img')
            expect(delayed).to_have_js_property('naturalWidth', 0)
            page.wait_for_timeout(100)
            assert len(held) == 1, 'the synthetic image request must be held'
            held.pop().fulfill(status=200, content_type='image/png', body=RASTER_640_360)
            page.unroute('https://desk-fixture.invalid/delayed-640.png')
            expect(delayed).to_have_js_property('naturalWidth', 640)
            page.evaluate('() => new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
            delayed_after = card('task-3').evaluate('(el) => ({height:el.offsetHeight,span:el.style.gridRowEnd})')
            assert delayed_after['height'] > before_delayed['height'], (before_delayed, delayed_after)
            assert delayed_after['span'].startswith('span ') and delayed_after['span'] != before_delayed['span'], (before_delayed, delayed_after)
            final_gap = page.evaluate('''() => { const grid=document.querySelector('.nautilus-desk__grid'); const cards=[...grid.children];
              const last=Math.max(...cards.map(card=>card.getBoundingClientRect().bottom)); const next=document.querySelector('[data-desk-following]').getBoundingClientRect().top;
              return {gridBottom:grid.getBoundingClientRect().bottom,last,followingGap:next-last}; }''')
            assert final_gap['gridBottom'] - final_gap['last'] <= 32 and final_gap['followingGap'] <= 80, final_gap
            geometry['delayed640x360'] = {'before': before_delayed, 'after': delayed_after, 'gap': final_gap}
            # Removal while a response is held makes its late completion harmless.
            # The lifecycle suite separately tests old-to-new image replacement.
            stale = []
            page.route('https://desk-fixture.invalid/stale.png', lambda route: stale.append(route))
            page.evaluate('''() => deskHarness.api.setString("task-0-note-0",
              "Stale fixture ![old](https://desk-fixture.invalid/stale.png)")''')
            page.wait_for_timeout(100); assert len(stale) == 1
            page.evaluate('() => deskHarness.api.setString("task-0-note-0", "Removed stale image")')
            stale.pop().fulfill(status=200, content_type='image/png', body=RASTER_640_360)
            page.unroute('https://desk-fixture.invalid/stale.png')
            page.wait_for_timeout(100)
            expect(card('task-0').locator('img')).to_have_count(1)
            page.route('https://desk-fixture.invalid/fail.png', lambda route: route.abort())
            page.evaluate('''() => deskHarness.api.setString("task-0-note-0",
              "Failing fixture ![bad](https://desk-fixture.invalid/fail.png)")''')
            page.wait_for_timeout(100)
            expect(card('task-0').locator('img')).to_have_count(1)
            page.unroute('https://desk-fixture.invalid/fail.png')
            checks.append('native image previews cover root, descendants, references, real held 640x360 decode geometry, late completion after removal, and intercepted request failure')
            checks.append('native style classes/metrics, wide auto-fill, task filters, no editor mounts or graph writes on opening; legacy row-gap cannot create a masonry reservation gap')

            before = page.evaluate('() => deskHarness.api.children("plan-desk").map(r=>[r.uid,r.string,r.open])')
            page.evaluate('() => { window.taskPreviewBeforeMove = document.querySelector(`[data-task-uid="task-0"] img`); }')
            top('task-4')
            page.wait_for_function('deskHarness.api.children("plan-desk")[0].uid === "task-4"')
            expect(page.locator('.nautilus-desk__card').first).to_have_attribute('data-task-uid', 'task-4')
            expect(page.locator('[data-raw-plan="plan-desk"] > div').first).to_have_attribute('data-raw-uid', 'task-4')
            after = page.evaluate('() => deskHarness.api.children("plan-desk").map(r=>[r.uid,r.string,r.open])')
            assert sorted(before) == sorted(after)
            assert page.evaluate('() => window.taskPreviewBeforeMove === document.querySelector(`[data-task-uid="task-0"] img`)')
            card('task-2').drag_to(card('task-4'), target_position={'x': 12, 'y': 12})
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

            # Generic host prelude only: native Escape selects this block, then
            # an in-memory copy callback reads it. No OS clipboard, app switch,
            # paste, send, or macro is invoked by this fixture.
            prelude_before = page.evaluate('''() => ({
              writes: deskHarness.api.stats.writes.length,
              nativeWrites: deskHarness.api.stats.nativeWrites.length,
              value: deskHarness.api.text('task-0'), hash: location.hash,
              preferences: JSON.stringify(Object.fromEntries(Object.entries(localStorage)
                .filter(([key]) => key.startsWith('nautilus-log:desk-view:'))))
            })''')
            page.evaluate('''() => {
              window.copyPreludeAfterPlugin = [];
              document.addEventListener('keydown', event => window.copyPreludeAfterPlugin.push({
                defaultPrevented: event.defaultPrevented,
                focusUid: document.querySelector('.nautilus-desk__native')?.dataset.taskUid || null
              }), { once: true });
            }''')
            prelude = page.evaluate('() => deskHarness.api.replayEscapeBeforeCopy("task-0")')
            assert prelude == {'defaultPrevented': False, 'copied': {
              'uid': 'task-0', 'block': prelude_before['value']}}, prelude
            focused('task-0')
            expect(page.locator('.nautilus-desk__escape-hint')).to_have_text('Roam editor')
            assert page.evaluate('() => window.copyPreludeAfterPlugin') == [{'defaultPrevented': False, 'focusUid': 'task-0'}]
            prelude_after = page.evaluate('''() => ({
              writes: deskHarness.api.stats.writes.length,
              nativeWrites: deskHarness.api.stats.nativeWrites.length,
              value: deskHarness.api.text('task-0'), hash: location.hash,
              preferences: JSON.stringify(Object.fromEntries(Object.entries(localStorage)
                .filter(([key]) => key.startsWith('nautilus-log:desk-view:')))),
              nativeEscape: deskHarness.api.stats.nativeEscapes.at(-1),
              fakeCopy: deskHarness.api.stats.fakeCopies.at(-1),
              outbound: [deskHarness.api.stats.appActivations, deskHarness.api.stats.pastes,
                deskHarness.api.stats.sends, deskHarness.api.stats.outboundCallbacks]
            })''')
            assert {key: prelude_after[key] for key in ['writes', 'nativeWrites', 'value', 'hash', 'preferences']} == prelude_before
            assert prelude_after['nativeEscape'] == {'uid': 'task-0', 'defaultPreventedBefore': False, 'prevented': False}
            assert prelude_after['fakeCopy'] == prelude['copied']
            assert prelude_after['outbound'] == [0, 0, 0, 0]
            # A native handler that owns and prevents Escape remains compatible.
            prevented = page.evaluate('() => deskHarness.api.replayEscapeBeforeCopy("task-0", { preventDefault: true })')
            assert prevented['defaultPrevented'] is True and prevented['copied']['uid'] == 'task-0'
            focused('task-0')
            checks.append('generic native Escape-before-fake-Copy prelude keeps the same focus/editor selection, preserves graph/hash/preferences, and has no outbound operations')
            current = page.evaluate('() => deskHarness.api.stats.renders.length')
            edit = page.locator('textarea[data-block-uid="task-0"]')
            edit.fill('{{[[TODO]]}} Edited original title 45m')
            page.locator('.rm-desk--dialog').focus()
            expect(page.locator('.nautilus-desk__escape-hint')).to_have_text('Close')
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
            activate('code-literal')
            expect(page.locator('.rm-desk__header').get_by_role('button', name='Next', exact=True)).to_be_disabled()
            close_focus()
            checks.append('native UID/children editing, zoom path, bounded native navigation, no remount on text edits, and per-task scroll restoration')

            visible_order = page.locator('.nautilus-desk__card').evaluate_all('(els) => els.map(el=>el.dataset.taskUid)')
            hint_writes = page.evaluate('() => deskHarness.api.stats.writes.length')
            card(visible_order[0]).locator('[role="button"]').focus()
            page.keyboard.down('Alt')
            expect(page.locator('.nautilus-desk__grid')).to_have_class('rm-desk-overview rm-desk-overview--masonry nautilus-desk__grid rm-desk-overview--numbers')
            assert page.locator('.nautilus-desk__card').nth(9).evaluate('el => getComputedStyle(el,"::after").content') in ['none', 'normal']
            expect(page.locator('.nautilus-desk__position')).to_have_count(0)
            # A normal ready update reorders cards while Alt remains held.
            # Native counters and Alt+Digit follow the updated visible order.
            page.evaluate('() => deskHarness.api.setOrder("task-3", 0)')
            page.wait_for_function('document.querySelector(".nautilus-desk__card")?.dataset.taskUid === "task-3"')
            alt_order = page.locator('.nautilus-desk__card').evaluate_all('(els) => els.map(el => ({uid:el.dataset.taskUid,label:el.dataset.position,content:getComputedStyle(el,"::after").content}))')
            assert all(row['label'] == str(index + 1) and 'counter(' in row['content'] for index, row in enumerate(alt_order[:9])), alt_order
            assert all(row['content'] in ['none', 'normal'] for row in alt_order[9:]), alt_order
            page.keyboard.press('2')
            page.keyboard.up('Alt')
            focused(alt_order[1]['uid']); close_focus()
            assert page.evaluate('() => deskHarness.api.stats.writes.length') == hint_writes

            # This real pointer motion enters the production HTML drag path.
            # The grid contains more than nine cards, so its DOM mapping proves
            # drag mode extends native first-nine feedback to every visible card.
            grid = page.locator('.nautilus-desk__grid')
            badge_geometry_before = grid.evaluate('''el => [...el.children].map(card => {
              const image=card.querySelector('img')?.getBoundingClientRect();
              const title=card.querySelector('.rm-desk-tile__title')?.getBoundingClientRect();
              const footer=card.querySelector('.rm-desk-tile__footer')?.getBoundingClientRect();
              const action=card.querySelector('.rm-desk-tile__actions')?.getBoundingClientRect();
              return {height:card.offsetHeight, span:card.style.gridRowEnd, image:image&&[image.x,image.y,image.width,image.height],
                title:title&&[title.x,title.y,title.width,title.height], footer:footer&&[footer.x,footer.y,footer.width,footer.height],
                action:action&&[action.x,action.y,action.width,action.height]};
            })''')
            drag_preview = card(visible_order[2]).locator('.rm-desk-tile__preview').bounding_box()
            page.mouse.move(drag_preview['x'] + 12, drag_preview['y'] + 12)
            page.mouse.down()
            page.mouse.move(drag_preview['x'] + 42, drag_preview['y'] + 24, steps=8)
            page.wait_for_function('document.querySelector(".nautilus-desk__card.rm-desk-tile--dragging")')
            assert not grid.evaluate('(el) => el.classList.contains("rm-desk-overview--numbers")')
            positions = grid.evaluate('(el) => [...el.children].map(card => card.dataset.position)')
            assert positions == [str(index) for index in range(1, len(positions) + 1)] and len(positions) > 9, positions
            badge_mapping = {'unfiltered': positions}
            tenth_badge = grid.locator('.nautilus-desk__card').nth(9).evaluate('el => { const s=getComputedStyle(el,"::after");return {text:s.content,pointerEvents:s.pointerEvents,background:s.backgroundColor}; }')
            assert tenth_badge == {'text': '"10"', 'pointerEvents': 'none', 'background': 'rgb(245, 248, 250)'}, tenth_badge
            badge_geometry_during = grid.evaluate('''el => [...el.children].map(card => {
              const image=card.querySelector('img')?.getBoundingClientRect();
              const title=card.querySelector('.rm-desk-tile__title')?.getBoundingClientRect();
              const footer=card.querySelector('.rm-desk-tile__footer')?.getBoundingClientRect();
              const action=card.querySelector('.rm-desk-tile__actions')?.getBoundingClientRect();
              return {height:card.offsetHeight, span:card.style.gridRowEnd, image:image&&[image.x,image.y,image.width,image.height],
                title:title&&[title.x,title.y,title.width,title.height], footer:footer&&[footer.x,footer.y,footer.width,footer.height],
                action:action&&[action.x,action.y,action.width,action.height]};
            })''')
            assert badge_geometry_during == badge_geometry_before
            grid.screenshot(path=str(OUT/'drag-number-badges.png'))
            page.mouse.up()
            page.wait_for_function('!document.querySelector(".nautilus-desk__card.rm-desk-tile--dragging")')
            assert not grid.evaluate('(el) => el.classList.contains("rm-desk-overview--numbers")')
            expect(page.locator('.nautilus-desk__focus-layer')).to_have_count(0)

            # Gray native drag pills retain full collection positions. Only Alt
            # counters use filtered visible order. Synthetic events supplement the real drag.
            full_positions = grid.evaluate('el => Object.fromEntries([...el.children].map(card=>[card.dataset.taskUid,card.dataset.position]))')
            search_control = page.get_by_role('textbox', name='Search Desk', exact=True)
            search_control.fill('整理')
            page.wait_for_function('(total) => { const count=document.querySelectorAll(".nautilus-desk__grid > .nautilus-desk__card").length; return count > 0 && count < total; }', arg=len(visible_order))
            filtered = page.locator('.nautilus-desk__card')
            filtered_count = filtered.count()
            drag_start(filtered.first)
            # Search admission can settle between two browser calls. Capture
            # UID and position together without mixing different filter frames.
            filtered_snapshot = grid.evaluate('(el) => [...el.children].map(card => ({uid:card.dataset.taskUid,position:card.dataset.position}))')
            filtered_positions = [row['position'] for row in filtered_snapshot]
            filtered_uids = [row['uid'] for row in filtered_snapshot]
            assert filtered_positions == [full_positions[uid] for uid in filtered_uids]
            badge_mapping['filtered'] = filtered_positions
            drag_end(filtered.first)
            assert not grid.evaluate('(el) => el.classList.contains("rm-desk-overview--numbers")')
            search_control.fill('')
            expect(page.locator('.nautilus-desk__card')).to_have_count(len(visible_order))

            # Drag and Alt reasons compose: neither cleanup removes the other.
            drag_source = card(visible_order[0])
            drag_source.locator('[role="button"]').focus()
            drag_start(drag_source)
            page.keyboard.down('Alt'); page.wait_for_timeout(450)
            assert grid.evaluate('(el) => !!el.querySelector(".rm-desk-tile--dragging") && el.classList.contains("rm-desk-overview--numbers")')
            page.keyboard.up('Alt')
            assert grid.evaluate('(el) => !!el.querySelector(".rm-desk-tile--dragging") && !el.classList.contains("rm-desk-overview--numbers")')
            drag_end(drag_source)
            assert not grid.evaluate('(el) => el.classList.contains("rm-desk-overview--numbers")')

            drag_source.locator('[role="button"]').focus()
            drag_start(drag_source)
            page.keyboard.down('Alt'); page.wait_for_timeout(450)
            drag_end(drag_source)
            assert grid.evaluate('(el) => !el.querySelector(".rm-desk-tile--dragging") && el.classList.contains("rm-desk-overview--numbers")')
            page.keyboard.up('Alt')
            assert not grid.evaluate('(el) => el.classList.contains("rm-desk-overview--numbers")')

            # Escape and blur cancel only the drag feedback; neither opens focus
            # nor closes the entire Desk. Folding cancels the same active state.
            drag_source.locator('[role="button"]').focus()
            drag_start(drag_source)
            page.keyboard.press('Escape')
            page.wait_for_function('!document.querySelector(".nautilus-desk__card.rm-desk-tile--dragging")')
            assert page.locator('.nautilus-desk').count() == 1 and not grid.evaluate('(el) => el.classList.contains("rm-desk-overview--numbers")')
            drag_start(drag_source)
            page.evaluate('() => window.dispatchEvent(new Event("blur"))')
            page.wait_for_function('!document.querySelector(".nautilus-desk__card.rm-desk-tile--dragging")')
            assert not grid.evaluate('(el) => el.classList.contains("rm-desk-overview--numbers")')
            drag_start(drag_source)
            page.evaluate('() => deskHarness.api.setCollapsed("plan-desk", true)')
            expect(page.locator('.nautilus-desk')).to_be_hidden()
            assert not grid.evaluate('(el) => el.classList.contains("rm-desk-overview--numbers")')
            page.evaluate('() => deskHarness.api.setCollapsed("plan-desk", false)')
            expect(page.locator('.nautilus-desk')).to_be_visible()

            # Native hints remain unavailable from text/IME and unrelated toolbar
            # controls, while card-grid Alt+Digit continues to work above.
            search_control.focus()
            page.keyboard.down('Alt'); page.wait_for_timeout(450)
            assert not grid.evaluate('(el) => el.classList.contains("rm-desk-overview--numbers")')
            page.keyboard.up('Alt')
            search_control.evaluate('el => el.dispatchEvent(new KeyboardEvent("keydown", {key:"Alt", bubbles:true, isComposing:true}))')
            page.wait_for_timeout(450)
            assert not grid.evaluate('(el) => el.classList.contains("rm-desk-overview--numbers")')
            page.get_by_role('button', name='New note', exact=True).first.focus()
            page.keyboard.down('Alt'); page.wait_for_timeout(450)
            assert not grid.evaluate('(el) => el.classList.contains("rm-desk-overview--numbers")')
            page.keyboard.up('Alt')
            (OUT/'drag-number-mapping.json').write_text(json.dumps(badge_mapping, indent=2))
            checks.append('native Alt first-nine hints and Alt+Digit remain write-free; physical and synthetic drag state numbers every visible card, composes with Alt, and clears on end, Escape, blur, and fold')

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
            # Folding during held create must retain the reservation until the
            # save loop persists the later input, without reopening focus late.
            page.evaluate('() => deskHarness.api.setCollapsed("plan-desk", true)')
            expect(page.locator('.nautilus-desk__focus-layer')).to_have_count(0)
            page.evaluate('() => deskHarness.api.release()')
            page.wait_for_function('deskHarness.api.stats.writes.filter(w=>w.type==="create").length===1')
            new_uid = page.evaluate('() => deskHarness.api.stats.writes.find(w=>w.type==="create").uid')
            page.wait_for_function('(uid) => deskHarness.api.text(uid) === "First draft with the remaining input preserved"', arg=new_uid)
            assert page.locator('.nautilus-desk__focus-layer').count() == 0
            assert page.evaluate('(uid) => deskHarness.api.text(uid)', new_uid) == 'First draft with the remaining input preserved'
            assert page.evaluate('() => deskHarness.api.children("plan-desk")[0].uid') == new_uid
            assert page.evaluate('() => deskHarness.api.stats.writes.find(w=>w.type==="create").parent') == 'plan-desk'
            page.evaluate('() => deskHarness.api.setCollapsed("plan-desk", false)')
            expect(page.locator('.nautilus-desk')).to_be_visible()
            expect(page.locator('.nautilus-desk__focus-layer')).to_have_count(0)
            checks.append('folded pending draft preserves final authorized text with one UID/create and no late focus resurrection')

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

            toolbar_geometry = []
            wide = page.locator('[data-fixture-host="plan-desk"] .rm-desk-page__toolbar').evaluate('''toolbar => {
              const rect = el => { const r = el.getBoundingClientRect(); return {left:r.left, right:r.right, top:r.top, bottom:r.bottom, width:r.width, height:r.height, centerY:(r.top+r.bottom)/2}; };
              const title = toolbar.querySelector('.rm-desk-page__title');
              const close = toolbar.querySelector('[aria-label="Hide Desk"]');
              const search = toolbar.querySelector('[aria-label="Search Desk"]');
              const add = toolbar.querySelector('.rm-desk-page__new-note');
              const rows = [...toolbar.querySelectorAll('input, button')].map(el => rect(el).centerY)
                .sort((a, b) => a - b).reduce((all, y) => !all.length || y - all.at(-1) > 4 ? [...all, y] : all, []);
              return { toolbar:rect(toolbar), title:rect(title), close:rect(close), search:rect(search), add:rect(add),
                overflow:toolbar.scrollWidth-toolbar.clientWidth, rows };
            }''')
            toolbar_geometry.append({'width': 'wide-main', **wide})
            assert abs(wide['close']['centerY'] - wide['add']['centerY']) <= 0.5, wide
            assert wide['close']['width'] >= 30 and wide['close']['height'] >= 30, wide
            assert wide['close']['left'] >= wide['toolbar']['left'] - 1 and wide['close']['right'] <= wide['toolbar']['right'] + 1, wide
            assert wide['search']['left'] >= wide['toolbar']['left'] - 1 and wide['search']['right'] <= wide['toolbar']['right'] + 1, wide
            assert wide['add']['left'] >= wide['toolbar']['left'] - 1 and wide['add']['right'] <= wide['toolbar']['right'] + 1, wide
            assert wide['overflow'] <= 1 and len(wide['rows']) == 1, wide
            assert 120 <= wide['search']['width'] <= 220, wide
            assert wide['close']['left'] >= wide['add']['right'], wide
            assert wide['toolbar']['right'] - wide['close']['right'] <= 20, wide

            watches = page.evaluate('() => deskHarness.api.stats.watches')
            page.evaluate('() => deskHarness.api.openCopy()')
            expect(page.locator('.nautilus-desk')).to_have_count(2)
            assert page.evaluate('() => deskHarness.api.stats.watches') >= watches
            sidebar = page.locator('[data-fixture-host="copy"] .nautilus-desk')
            owner = page.locator('[data-fixture-host="copy"]')
            sidebar_grid = sidebar.locator('.nautilus-desk__grid')
            main_grid = page.locator('[data-fixture-host="plan-desk"] .nautilus-desk__grid')
            expect(sidebar_grid).to_have_attribute('data-columns', '1')
            assert sidebar.evaluate('(el) => el.getBoundingClientRect().width <= 280')
            drag_start(sidebar.locator('.nautilus-desk__card').first)
            assert sidebar_grid.evaluate('(el) => !!el.querySelector(".rm-desk-tile--dragging")')
            assert not main_grid.evaluate('(el) => el.classList.contains("rm-desk-overview--numbers")')
            drag_end(sidebar.locator('.nautilus-desk__card').first)
            assert not sidebar_grid.evaluate('(el) => el.classList.contains("rm-desk-overview--numbers")')
            for width in [280, 320, 360, 480, 520]:
                owner.evaluate('(el, width) => { el.style.width = `${width}px`; }', width)
                page.evaluate('() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')
                metrics = sidebar.locator('.rm-desk-page__toolbar').evaluate('''toolbar => {
                  const rect = el => { const r = el.getBoundingClientRect(); return {left:r.left, right:r.right, top:r.top, bottom:r.bottom, width:r.width, height:r.height, centerY:(r.top+r.bottom)/2}; };
                  const title = toolbar.querySelector('.rm-desk-page__title');
                  const close = toolbar.querySelector('[aria-label="Hide Desk"]');
                  const search = toolbar.querySelector('[aria-label="Search Desk"]');
                  const add = toolbar.querySelector('.rm-desk-page__new-note');
                  const rows = [...toolbar.querySelectorAll('input, button')].map(el => rect(el).centerY)
                    .sort((a, b) => a - b).reduce((all, y) => !all.length || y - all.at(-1) > 4 ? [...all, y] : all, []);
                  const tools=toolbar.querySelector('.rm-desk-page__tools'),style=getComputedStyle(tools);
                  const searchBudget=tools.getBoundingClientRect().width-rect(add).width-rect(close).width-2*(parseFloat(style.columnGap)||0);
                  return { toolbar:rect(toolbar), title:rect(title), close:rect(close), search:rect(search), add:rect(add),
                    overflow:toolbar.scrollWidth-toolbar.clientWidth, rows, searchBudget };
                }''')
                toolbar_geometry.append({'width': width, **metrics})
                assert abs(metrics['close']['centerY'] - metrics['add']['centerY']) <= 0.5, metrics
                assert metrics['close']['left'] >= metrics['toolbar']['left'] - 1 and metrics['close']['right'] <= metrics['toolbar']['right'] + 1, metrics
                assert metrics['close']['width'] >= 30 and metrics['close']['height'] >= 30, metrics
                assert metrics['overflow'] <= 1, metrics
                assert metrics['search']['left'] >= metrics['toolbar']['left'] - 1 and metrics['search']['right'] <= metrics['toolbar']['right'] + 1, metrics
                assert metrics['add']['left'] >= metrics['toolbar']['left'] - 1 and metrics['add']['right'] <= metrics['toolbar']['right'] + 1, metrics
                assert len(metrics['rows']) <= 2, metrics
                # Close now shares this row by user request. Search should use
                # all remaining room up to the native 200px cap, not retain a
                # minimum derived from the previous two-control row.
                assert metrics['search']['width'] >= min(200, metrics['searchBudget']) - 0.5, metrics
            # Preserve the original logical order: search, create, then dismiss.
            owner.evaluate('(el) => { el.style.width = "320px"; }')
            sidebar.get_by_role('textbox', name='Search Desk', exact=True).focus()
            page.keyboard.press('Tab')
            expect(sidebar.get_by_role('button', name='New note', exact=True)).to_be_focused()
            page.keyboard.press('Tab')
            expect(sidebar.get_by_role('button', name='Hide Desk', exact=True)).to_be_focused()
            writes_before_close = page.evaluate('() => deskHarness.api.stats.writes.length')
            sidebar.get_by_role('button', name='Hide Desk', exact=True).click()
            expect(sidebar).to_have_count(0)
            expect(page.locator('[data-fixture-host="copy"] > .fixture-raw')).to_be_visible()
            assert page.evaluate('() => deskHarness.api.stats.writes.length') == writes_before_close
            # Removing an actively dragging duplicate host clears only its scoped
            # badges and does not disturb the main Desk instance.
            page.get_by_role('button', name='Open copy Desk', exact=True).click()
            expect(sidebar).to_have_count(1)
            drag_start(sidebar.locator('.nautilus-desk__card').first)
            assert sidebar.locator('.nautilus-desk__grid').evaluate('(el) => !!el.querySelector(".rm-desk-tile--dragging")')
            page.evaluate('() => deskHarness.api.removeHost("copy")')
            expect(sidebar).to_have_count(0)
            assert not main_grid.evaluate('(el) => el.classList.contains("rm-desk-overview--numbers")')
            (OUT/'sidebar-toolbar-geometry.json').write_text(json.dumps(toolbar_geometry, indent=2))
            checks.append('sidebar toolbar aligns Hide Desk with New note at 280–520px, has no overflow or third control row, preserves keyboard order, and closes without writes')

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
            for width in [1700, 900, 390]:
                page.set_viewport_size({'width':width,'height':1000})
                # ResizeObserver/rAF may still carry the previous width's data.
                # Wait for the expected *new* layout, not merely any positive count.
                page.wait_for_function('''() => {
                  const grid=document.querySelector('.nautilus-desk__grid'), style=getComputedStyle(grid);
                  const available=grid.clientWidth-(parseFloat(style.paddingLeft)||0)-(parseFloat(style.paddingRight)||0);
                  const gap=parseFloat(style.columnGap)||0, expected=Math.max(1,Math.floor((available+gap)/(240+gap)));
                  return Number(grid.dataset.columns)===expected && style.gridTemplateColumns.split(/\\s+/).filter(Boolean).length===expected;
                }''')
                columns = page.locator('.nautilus-desk__grid').evaluate('''grid => {
                  const style=getComputedStyle(grid), available=grid.clientWidth-(parseFloat(style.paddingLeft)||0)-(parseFloat(style.paddingRight)||0);
                  const gap=parseFloat(style.columnGap)||0;
                  return {actual:Number(grid.dataset.columns), expected:Math.max(1,Math.floor((available+gap)/(240+gap)))};
                }''')
                assert columns['actual'] == columns['expected'], (width, columns)
                if width == 390:
                    expect(page.locator('.nautilus-desk__grid')).to_have_attribute('data-columns','1')
                page.evaluate('() => new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
                assert page.locator('.nautilus-desk').evaluate('(el) => {const r=el.getBoundingClientRect();return r.left>=-1 && r.right<=innerWidth+1}')
                if width == 390:
                    narrow_main = page.locator('.nautilus-desk .rm-desk-page__toolbar').evaluate('''toolbar => {
                      const add=toolbar.querySelector('[aria-label="New note"]').getBoundingClientRect();
                      const close=toolbar.querySelector('[aria-label="Hide Desk"]').getBoundingClientRect();
                      return {overflow:toolbar.scrollWidth-toolbar.clientWidth, centerDelta:Math.abs((add.top+add.bottom-close.top-close.bottom)/2)};
                    }''')
                    assert narrow_main['overflow'] <= 1 and narrow_main['centerDelta'] <= 0.5, narrow_main
            page.set_viewport_size({'width':1280,'height':1000})
            page.wait_for_function('Number(document.querySelector(".nautilus-desk__grid").dataset.columns)>=1')
            responsive_gaps = []
            for width in [1280, 900, 390]:
                page.set_viewport_size({'width':width,'height':1000})
                page.evaluate('() => new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
                responsive_gaps.append(page.evaluate('''() => {
                  const grid=document.querySelector('.nautilus-desk__grid'), tiles=[...grid.querySelectorAll('.rm-desk-tile')];
                  const r=grid.getBoundingClientRect(), last=Math.max(...tiles.map(tile=>tile.getBoundingClientRect().bottom));
                  return {width:innerWidth, rowGap:getComputedStyle(grid).rowGap, reserved:r.bottom-last};
                }'''))
            assert all(row['rowGap'] == '0px' and row['reserved'] <= 32 for row in responsive_gaps), responsive_gaps
            (OUT/'gap-measurement-responsive.json').write_text(json.dumps(responsive_gaps, indent=2))
            page.set_viewport_size({'width':1280,'height':1000})
            page.wait_for_function('Number(document.querySelector(".nautilus-desk__grid").dataset.columns)>=1')
            card('task-1').hover()
            page.wait_for_function('getComputedStyle(document.querySelector("[data-task-uid=\\"task-1\\"] .rm-desk-tile__actions")).opacity === "1"')
            page.locator('.nautilus-desk').screenshot(path=str(OUT/'native-desk-overview.png'))
            activate('task-1')
            page.screenshot(path=str(OUT/'native-desk-focus.png'))
            close_focus()

            # A ready snapshot can reconcile while the browser still owns a
            # dragend on a source that is about to detach. It must clean state
            # without relying on that late event bubbling back to the grid.
            reconcile_grid = page.locator('.nautilus-desk__grid')
            reconcile_source = card('task-4')
            drag_start(reconcile_source)
            page.evaluate('''() => { window.retainedDragSource = document.querySelector('[data-task-uid="task-4"]'); }''')
            stale_writes = page.evaluate('() => deskHarness.api.stats.writes.length')
            page.evaluate('() => deskHarness.api.setString("task-4", "{{[[DONE]]}} Completed while dragging")')
            expect(card('task-4')).to_have_count(0)
            expect(page.locator('.nautilus-desk')).to_have_attribute('data-status', 'ready')
            assert not reconcile_grid.evaluate('(el) => el.classList.contains("rm-desk-overview--numbers") || el.querySelector(".rm-desk-tile--dragging,.rm-desk-tile__drop")')
            stale_source = page.evaluate('''() => ({
              dragging:window.retainedDragSource.classList.contains('rm-desk-tile--dragging'),
              rail:!!window.retainedDragSource.querySelector('.rm-desk-tile__drop')
            })''')
            assert stale_source == {'dragging': False, 'rail': False}, stale_source
            page.evaluate('''() => {
              for (const type of ['drop', 'dragend']) window.retainedDragSource.dispatchEvent(new DragEvent(type, {
                bubbles:true, cancelable:true, dataTransfer:new DataTransfer()
              }));
            }''')
            assert page.evaluate('() => deskHarness.api.stats.writes.length') == stale_writes

            # A new source can start cleanly after completion cleanup; deletion
            # follows the same ready-snapshot reconciliation path.
            deletion_source = card('task-3')
            drag_start(deletion_source)
            assert reconcile_grid.evaluate('(el) => !!el.querySelector(".rm-desk-tile--dragging")')
            page.evaluate('''() => { window.retainedDeletedDragSource = document.querySelector('[data-task-uid="task-3"]'); }''')
            page.evaluate('() => deskHarness.api.remove("task-3")')
            expect(card('task-3')).to_have_count(0)
            expect(page.locator('.nautilus-desk')).to_have_attribute('data-status', 'ready')
            assert not reconcile_grid.evaluate('(el) => el.classList.contains("rm-desk-overview--numbers") || el.querySelector(".rm-desk-tile--dragging,.rm-desk-tile__drop")')
            deleted_source = page.evaluate('''() => ({
              dragging:window.retainedDeletedDragSource.classList.contains('rm-desk-tile--dragging'),
              rail:!!window.retainedDeletedDragSource.querySelector('.rm-desk-tile__drop')
            })''')
            assert deleted_source == {'dragging': False, 'rail': False}, deleted_source

            # A ready reorder or filter can detach non-source live cards. The
            # valid source remains active and its visible-order mapping refreshes.
            mapping_source = card('task-1')
            drag_start(mapping_source)
            page.evaluate('() => deskHarness.api.setOrder("task-2", 0)')
            expect(mapping_source).to_be_visible()
            assert mapping_source.evaluate('(el) => el.classList.contains("rm-desk-tile--dragging")')
            assert reconcile_grid.evaluate('(el) => [...el.children].map(card => card.dataset.position)') == [str(index) for index in range(1, reconcile_grid.locator('.nautilus-desk__card').count() + 1)]
            ready_positions = reconcile_grid.evaluate('el=>Object.fromEntries([...el.children].map(card=>[card.dataset.taskUid,card.dataset.position]))')
            reconcile_search = page.get_by_role('textbox', name='Search Desk', exact=True)
            page.evaluate('''() => { window.retainedFilteredCard = document.querySelector('[data-task-uid="reference-wrapper"]'); }''')
            reconcile_search.fill('提示词')
            expect(mapping_source).to_be_visible()
            assert mapping_source.evaluate('(el) => el.classList.contains("rm-desk-tile--dragging")')
            page.wait_for_function('!window.retainedFilteredCard.isConnected')
            assert page.evaluate('() => !window.retainedFilteredCard.querySelector(".rm-desk-tile__drop")')
            ready_filtered = reconcile_grid.evaluate('el=>[...el.children].map(card=>({uid:card.dataset.taskUid,position:card.dataset.position}))')
            assert all(row['position']==ready_positions[row['uid']] for row in ready_filtered)
            reconcile_search.fill('')
            expect(mapping_source).to_be_visible()
            drag_end(mapping_source)

            # These are synthetic native-shaped events, not physical OS drops.
            # Hold the real adapter promise BEFORE repeated/modified/internal
            # gestures; a retry after settlement cannot cover this race.
            source_before = page.evaluate('() => deskHarness.api.sourceSnapshot("outside-source")')
            import_before = page.evaluate('() => deskHarness.api.stats.writes.length')
            drop_geometry_before = page.locator('.nautilus-desk__grid').evaluate('el => { const r=el.getBoundingClientRect(); return [r.x,r.y,r.width]; }')
            page.evaluate('() => deskHarness.api.holdNextCreate()')
            imported = external_drag('[data-task-uid="task-1"]')
            assert imported['over'] and imported['drop'] and imported['hostDrop'] == 0 and imported['hostOver'] == 0, imported
            page.wait_for_function('deskHarness.api.pending()')
            assert page.evaluate('() => deskHarness.api.stats.referenceRequests') == [{'state': 'pending', 'aborted': False}]
            repeat = external_drag('[data-task-uid="task-1"]')
            assert repeat['drop'] and repeat['hostDrop'] == 0, repeat
            for modifier in ['altKey', 'ctrlKey', 'metaKey', 'shiftKey']:
                modified = external_drag('[data-task-uid="task-1"]', modifiers={modifier: True})
                assert not modified['over'] and not modified['drop'] and modified['hostOver'] == 1 and modified['hostDrop'] == 1, modified
            drag_start(card('task-1'))
            assert card('task-1').evaluate('el=>el.classList.contains("rm-desk-tile--dragging")')
            drag_end(card('task-1'))
            page.locator('#page-after').dispatch_event('dragstart', {'bubbles': True})
            assert page.evaluate('() => deskHarness.api.stats.referenceRequests') == [{'state': 'pending', 'aborted': False}]
            assert page.evaluate('() => deskHarness.api.stats.writes.length') == import_before + 1
            assert page.evaluate('() => deskHarness.api.children("plan-desk").some(row=>row.uid==="ref-outside-source")') is False
            page.evaluate('() => deskHarness.api.release()')
            page.wait_for_function('deskHarness.api.stats.referenceRequests[0]?.state === "fulfilled"')
            assert page.evaluate('() => deskHarness.api.stats.referenceRequests') == [{'state': 'fulfilled', 'aborted': False, 'status': 'added'}]
            drop_geometry_after = page.locator('.nautilus-desk__grid').evaluate('el => { const r=el.getBoundingClientRect(); return [r.x,r.y,r.width]; }')
            assert drop_geometry_after == drop_geometry_before, (drop_geometry_before, drop_geometry_after)
            toast = page.locator('.nautilus-desk__drop-toast')
            expect(toast).to_have_text('Added reference. Original kept.')
            assert toast.evaluate('el => ({position:getComputedStyle(el).position,pointerEvents:getComputedStyle(el).pointerEvents})') == {'position': 'absolute', 'pointerEvents': 'none'}
            imported_row = page.evaluate('() => deskHarness.api.children("plan-desk").find(row => row.uid === "ref-outside-source")')
            assert imported_row['string'] == '{{[[TODO]]}} ((outside-source))', imported_row
            assert page.evaluate('() => deskHarness.api.sourceSnapshot("outside-source")') == source_before
            # Settled retry and a fresh view/action owner also do not create again.
            external_drag('[data-task-uid="task-1"]')
            page.wait_for_function('deskHarness.api.stats.referenceRequests.at(-1)?.status === "existing-reference"')
            page.evaluate('() => deskHarness.api.reloadView()')
            expect(card('ref-outside-source')).to_be_visible()
            external_drag('[data-task-uid="task-1"]')
            page.wait_for_function('deskHarness.api.stats.referenceRequests.length === 3 && deskHarness.api.stats.referenceRequests.at(-1)?.state === "fulfilled"')
            assert page.evaluate('() => deskHarness.api.stats.writes.length') == import_before + 1
            checks.append('held reference create survives repeated, modifier, internal, and unrelated drags; settled/reloaded retries make no second create')

            # Rejected unmodified drops are owned too: later host handlers must
            # never receive a file, malformed multi-block, HTML, or URL fallback.
            for payload in [
                {'files': 1},
                {'fields': {'roam/block-uid-list': 'outside-source\\noutside-other'}},
                {'fields': {'roam/roam-uri-list': 'https://roamresearch.com/#/app/other/page/outside-source'}},
                {'types': ['text/html'], 'fields': {'text/html': '<div>not a block</div>'}},
                {'types': ['text/uri-list'], 'fields': {'text/uri-list': 'https://example.invalid/'}},
            ]:
                rejected = external_drag('[data-task-uid="task-1"]', payload=payload)
                assert rejected['over'] and rejected['drop'] and rejected['hostOver'] == 0 and rejected['hostDrop'] == 0, rejected
                page.wait_for_function('deskHarness.api.stats.referenceRequests.every(r=>r.state!=="pending")')
                assert page.evaluate('() => deskHarness.api.stats.writes.length') == import_before + 1
            checks.append('owned rejected drops cannot reach later host bubble handlers or create content')

            mount(empty=True)
            empty_target = page.locator('.nautilus-desk > .rm-desk-card__missing')
            expect(empty_target).to_be_visible()
            empty_geometry = page.locator('.nautilus-desk').evaluate('el=>{const r=el.getBoundingClientRect();return [r.x,r.y,r.width,r.height];}')
            page.evaluate('() => deskHarness.api.holdNextCreate()')
            empty_drop = external_drag('.nautilus-desk > .rm-desk-card__missing')
            page.wait_for_function('deskHarness.api.pending()')
            assert empty_drop['feedback'] == {'root': False, 'empty': True, 'outline': '2px'}, empty_drop
            expect(empty_target).to_be_visible()
            expect(page.locator('.nautilus-desk__drop-toast')).to_be_visible()
            assert page.locator('.nautilus-desk').evaluate('el=>{const r=el.getBoundingClientRect();return [r.x,r.y,r.width,r.height];}') == empty_geometry
            page.screenshot(path=str(OUT/'empty-drop-pending.png'))
            page.evaluate('() => deskHarness.api.release()')
            expect(card('ref-outside-source')).to_be_visible()
            expect(empty_target).to_be_hidden()
            assert page.evaluate('() => deskHarness.api.stats.writes.length') == 1
            checks.append('empty target receives visible landing feedback and pending toast without flow geometry changes')

            # Lifecycle cancellation cannot revoke an issued host call. Late
            # completion is not reported as success and cannot resurrect UI.
            for lifecycle in ['fold', 'destroy', 'blur', 'hashchange']:
                mount(count=3)
                source_before = page.evaluate('() => deskHarness.api.sourceSnapshot("outside-source")')
                page.evaluate('() => deskHarness.api.holdNextCreate()')
                external_drag('[data-task-uid="task-1"]')
                page.wait_for_function('deskHarness.api.pending()')
                page.evaluate('''kind=>{
                  if(kind==='fold') deskHarness.api.setCollapsed('plan-desk',true);
                  else if(kind==='destroy') deskHarness.destroy();
                  else window.dispatchEvent(new Event(kind));
                }''', lifecycle)
                page.wait_for_function('deskHarness.api.stats.referenceRequests[0]?.aborted')
                page.evaluate('() => deskHarness.api.release()')
                page.wait_for_function('deskHarness.api.stats.referenceRequests[0]?.state === "rejected"')
                assert page.evaluate('() => deskHarness.api.stats.writes.length') == 1
                assert page.evaluate('() => deskHarness.api.sourceSnapshot("outside-source")') == source_before
                assert page.evaluate('() => [...document.querySelectorAll(".nautilus-desk__drop-toast")].every(el=>el.hidden || !el.isConnected)')
            checks.append('fold, unload, blur, and navigation cancel ownership without claiming rollback of a late host create')
            # Desk's production typography boundary copies the host surface,
            # even when the chart deliberately uses another font family.
            page.evaluate("document.querySelector('.roam-article').style.fontFamily='Georgia, serif'")
            mount(count=3)
            themed_fonts = page.evaluate('''() => {
              const host=document.querySelector('.roam-article'),desk=document.querySelector('.nautilus-desk');
              const native=desk.cloneNode(false);native.append(desk.querySelector('.rm-desk-tile').cloneNode(true));
              host.append(native); // Same native rules, outside the chart inheritance scope.
              const result={host:getComputedStyle(host).fontFamily,
                chart:getComputedStyle(document.querySelector('.nautilus-log-shell')).fontFamily,
                desk:getComputedStyle(desk).fontFamily,explicitDeskFont:desk.style.fontFamily,
                card:getComputedStyle(desk.querySelector('.rm-desk-tile__title')).fontFamily,
                native:getComputedStyle(native).fontFamily,
                nativeCard:getComputedStyle(native.querySelector('.rm-desk-tile__title')).fontFamily};
              native.remove();return result;
            }''')
            assert themed_fonts['desk'] == themed_fonts['host'] == themed_fonts['native'], themed_fonts
            assert themed_fonts['card'] == themed_fonts['nativeCard'], themed_fonts
            assert themed_fonts['chart'] != themed_fonts['host'] and 'Inter' in themed_fonts['chart'], themed_fonts
            (OUT/'host-typography.json').write_text(json.dumps(themed_fonts,indent=2))
            checks.append('Desk preserves a distinct host font while the chart owns its typography')

            drag_start(card('task-1'))
            assert page.locator('.nautilus-desk__grid').evaluate('(el) => !!el.querySelector(".rm-desk-tile--dragging")')
            checks.append('native auto-fill follows the contained chart width from one column upward without changing fonts or overflowing its surface')
            page.evaluate('() => deskHarness.destroy()')
            expect(page.locator('.nautilus-desk')).to_have_count(0)
            page.wait_for_function('deskHarness.api.activeEditors()===0 && deskHarness.api.stats.watches===0')
            expect(page.locator('[data-fixture-host="plan-desk"] > .fixture-raw')).to_be_visible()
            assert page.evaluate('() => deskHarness.api.stats.forbiddenWrites') == 0
            assert not errors, errors
            checks.append('unload releases native editors, watches, outline hiding, and layout observers')
            (OUT/'results.json').write_text(json.dumps({'status':'passed','checks':checks,'geometry':geometry,'pageerrors':errors,
                'native_css':os.environ.get('ROAM_NATIVE_CSS','offline fixture'),
                'limitation':'Graph and native editor are simulated; real-host read-only parity validation is separate.'},ensure_ascii=False,indent=2))
            print(f'PASSED: {len(checks)} native Desk scenario groups; artifacts: {OUT}')
        finally:
            browser.close()


if __name__ == '__main__':
    run()
