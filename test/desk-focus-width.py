#!/usr/bin/env python3
"""Production Desk focus geometry in the existing synthetic native-editor host.

The fixture substitutes only the graph/native editor. This is not live Roam certification.
"""
import importlib.util
import json
import os
from pathlib import Path
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ.get('DESK_FOCUS_OUT', '/tmp/nautilus-desk-focus-width'))
spec = importlib.util.spec_from_file_location('desk_view_fixture', ROOT / 'test/desk-view.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
fixture.OUT = OUT


def run():
    fixture.bundle()
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            page = browser.new_page(viewport={'width': 1280, 'height': 1000})
            errors, requests = [], []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.on('request', lambda request: requests.append(request.url) if request.url.startswith(('http:', 'https:')) else None)
            page.goto((OUT / 'index.html').as_uri())
            page.wait_for_function('() => Boolean(window.deskHarness?.mount)')
            dark = os.environ.get('DESK_FOCUS_THEME') == 'dark'
            page.evaluate('dark => deskHarness.mount({count:1,dark})', dark)
            page.get_by_role('button', name='Open Desk', exact=True).click()
            expect(page.locator('.nautilus-desk')).to_have_attribute('data-status', 'ready')
            expect(page.locator('.nautilus-desk__title-label')).to_have_text('Nautilus Desk · 4')
            overview_width = page.locator('.nautilus-desk').bounding_box()['width']
            page.locator('[data-task-uid="task-0"] .rm-desk-tile__preview').click()
            dialog = page.get_by_role('dialog', name='Desk', exact=True)
            editor = page.locator('.nautilus-desk__native[data-task-uid="task-0"]')
            expect(editor.locator('textarea[data-block-uid="task-0"]')).to_be_visible()
            page.wait_for_function('document.fonts.status === "loaded"')
            box = dialog.bounding_box()
            assert abs(box['width'] - 880) < .5, {'expectedWidth': 880, 'actual': box}
            assert abs(box['x'] - 200) < .5, box
            assert abs(page.locator('.nautilus-desk').bounding_box()['width'] - overview_width) < .5
            assert editor.locator('textarea[data-block-uid="task-0"]').bounding_box()['width'] >= 780
            expect(dialog.locator('.rm-desk__counter')).to_have_text('1 / 4')
            page.evaluate('''()=>{
              const native=document.createElement('section');native.className='rm-desk rm-desk--dialog';
              native.dataset.fixtureNativeDesk='';native.style.visibility='hidden';native.style.pointerEvents='none';
              document.body.append(native);
            }''')
            native = page.locator('[data-fixture-native-desk]')
            native_box = native.evaluate('e=>{const r=e.getBoundingClientRect();return {width:r.width,height:r.height}}')
            assert abs(native_box['width'] - 600) < .5, 'Roam-owned Desk must keep its native width'
            assert abs(box['height'] - native_box['height']) < .5, 'focus height must stay native'
            dialog.screenshot(path=str(OUT / 'wide-focus.png'))

            # Resize an active composition deep in the same native editor.
            # The native editor is the system-boundary stand-in, not a replacement
            # for any Desk controller. No real graph is opened or changed.
            field = editor.locator('textarea[data-block-uid="task-0-note-12"]')
            field.focus()
            initial_field_width = field.bounding_box()['width']
            page.wait_for_function('document.querySelector(".nautilus-desk__focus-body").scrollTop > 100')
            field.dispatch_event('compositionstart')
            field.evaluate('''e=>{
              window.__focusProof={editor:e.closest('.nautilus-desk__native'),field:e,original:e.value,
                scroll:document.querySelector('.nautilus-desk__focus-body').scrollTop,
                renders:deskHarness.api.stats.renders.length,unmounts:deskHarness.api.stats.unmounts,
                nativeWrites:deskHarness.api.stats.nativeWrites.length,writes:deskHarness.api.stats.writes.length,
                font:getComputedStyle(e).font,rootRows:deskHarness.api.children('plan-desk').map(r=>[r.uid,r.string,r.order])};
              e.value='中文输入法组合中的内容保持原位';
              e.setSelectionRange(2,8);
              e.dispatchEvent(new InputEvent('input',{bubbles:true,data:'中文',inputType:'insertCompositionText',isComposing:true}));
            }''')

            def retained():
                proof = page.evaluate('''()=>{
                  const p=__focusProof,s=deskHarness.api.stats,body=document.querySelector('.nautilus-desk__focus-body');
                  return {sameEditor:document.querySelector('.nautilus-desk__native')===p.editor,
                    sameField:document.activeElement===p.field,connected:p.field.isConnected,
                    value:p.field.value,selection:[p.field.selectionStart,p.field.selectionEnd],
                    scroll:body.scrollTop,expectedScroll:p.scroll,
                    renders:s.renders.length-p.renders,unmounts:s.unmounts-p.unmounts,
                    nativeWrites:s.nativeWrites.length-p.nativeWrites,writes:s.writes.length-p.writes,
                    fontUnchanged:getComputedStyle(p.field).font===p.font,
                    rowsUnchanged:JSON.stringify(deskHarness.api.children('plan-desk').map(r=>[r.uid,r.string,r.order]))===JSON.stringify(p.rootRows)};
                }''')
                assert proof['sameEditor'] and proof['sameField'] and proof['connected'], proof
                assert proof['value'] == '中文输入法组合中的内容保持原位' and proof['selection'] == [2, 8], proof
                assert abs(proof['scroll'] - proof['expectedScroll']) < 1, proof
                assert proof['renders'] == proof['unmounts'] == proof['nativeWrites'] == proof['writes'] == 0, proof
                assert proof['fontUnchanged'] and proof['rowsUnchanged'], proof
                return proof

            # Both background columns may become narrow. They do not constrain
            # this body-mounted modal or get silently closed to make room.
            page.evaluate('''()=>{
              const main=document.querySelector('.roam-main');main.style.marginLeft='240px';main.style.marginRight='440px';
              for(const [id,side,width] of [['fixture-left-nav','left',240],['right-sidebar','right',440]]){
                const node=document.createElement('aside');node.id=id;node.dataset.fixtureSidebar='';
                Object.assign(node.style,{position:'fixed',top:'0',bottom:'0',[side]:'0',width:width+'px'});document.body.append(node);
              }
            }''')
            page.wait_for_function('document.querySelector(".roam-main").getBoundingClientRect().width < 650')
            assert abs(dialog.bounding_box()['width'] - 880) < .5
            assert abs(dialog.bounding_box()['x'] - 200) < .5
            sidebar_proof = retained()
            page.evaluate('''()=>{
              const main=document.querySelector('.roam-main');main.style.marginLeft='';main.style.marginRight='';
              document.querySelectorAll('[data-fixture-sidebar]').forEach(e=>e.remove());
            }''')

            matrix = []
            for viewport_width, expected_width, expected_native in [(1280, 880, 600), (1024, 880, 600), (700, 668, 600), (632, 600, 600), (360, 328, 328), (280, 248, 248), (1280, 880, 600)]:
                page.set_viewport_size({'width': viewport_width, 'height': 1000})
                page.wait_for_function('''expected=>Math.abs(document.querySelector('.nautilus-desk__focus-layer .rm-desk--dialog').getBoundingClientRect().width-expected)<.5''', arg=expected_width)
                current = dialog.bounding_box()
                assert abs(current['x'] + current['width'] / 2 - viewport_width / 2) < .5, current
                assert current['x'] >= 15.5 and current['x'] + current['width'] <= viewport_width - 15.5, current
                reference = native.evaluate('e=>{const r=e.getBoundingClientRect();return {width:r.width,height:r.height}}')
                assert abs(reference['width'] - expected_native) < .5 and abs(current['height'] - reference['height']) < .5, (current, reference)
                input_width = field.bounding_box()['width']
                assert 0 < input_width <= current['width'], (current, input_width)
                # Host indentation differs from the offline fixture. The real
                # contract is that the editor gains/loses all of the frame's width.
                assert abs((input_width - initial_field_width) - (current['width'] - box['width'])) < 1, (current, input_width, initial_field_width)
                assert dialog.locator('.nautilus-desk__focus-body').evaluate('e=>e.scrollWidth<=e.clientWidth+1')
                assert dialog.locator('.rm-desk__header').evaluate('e=>e.scrollWidth<=e.clientWidth+1')
                assert dialog.locator('.rm-desk__header button').evaluate_all('''buttons=>buttons.length===5&&buttons.every(e=>{
                  const r=e.getBoundingClientRect(),d=e.closest('[role=dialog]').getBoundingClientRect();
                  return r.width>0&&r.height>=24&&r.left>=d.left&&r.right<=d.right&&r.top>=d.top&&r.bottom<=d.bottom;
                })'''), 'navigation and close controls must stay reachable at every width'
                retained()
                expect(dialog.locator('.rm-desk__counter')).to_have_text('1 / 4')
                matrix.append({'viewport': viewport_width, 'dialog': current, 'inputWidth': input_width, 'nativeWidth': reference['width']})

            # End the synthetic composition without persisting fixture text.
            field.evaluate('e=>{e.value=__focusProof.original;e.setSelectionRange(2,8)}')
            field.dispatch_event('compositionend')
            field.press('Escape')
            expect(dialog).to_be_visible()
            assert page.evaluate('document.querySelector(".nautilus-desk__native")===__focusProof.editor')
            dialog.focus()
            dialog.get_by_role('button', name='Next', exact=True).click()
            expect(page.locator('.nautilus-desk__native')).to_have_attribute('data-task-uid', 'reference-wrapper')
            expect(dialog.locator('.rm-desk__counter')).to_have_text('2 / 4')
            dialog.get_by_role('button', name='Previous', exact=True).click()
            expect(page.locator('.nautilus-desk__native')).to_have_attribute('data-task-uid', 'task-0')
            expect(dialog.locator('.rm-desk__counter')).to_have_text('1 / 4')
            page.wait_for_function('Math.abs(document.querySelector(".nautilus-desk__focus-body").scrollTop-__focusProof.scroll)<1')

            # Membership changes retain the existing selection policy, and the
            # counter derives its denominator from the same full task collection.
            page.evaluate('()=>deskHarness.api.setString("task-0","{{[[DONE]]}} Completed fixture task")')
            expect(page.locator('.nautilus-desk__native')).to_have_attribute('data-task-uid', 'reference-wrapper')
            expect(dialog.locator('.rm-desk__counter')).to_have_text('1 / 3')
            dialog.locator('.rm-desk__side--end').get_by_role('button', name='New note', exact=True).click()
            expect(dialog.locator('.rm-desk__counter')).to_have_text('new')
            page.set_viewport_size({'width': 700, 'height': 800})
            page.wait_for_function('Math.abs(document.querySelector(".nautilus-desk__focus-layer .rm-desk--dialog").getBoundingClientRect().width-668)<.5')
            expect(dialog.get_by_role('textbox', name='New note', exact=True)).to_be_focused()
            assert abs(dialog.bounding_box()['height'] - native.evaluate('e=>e.getBoundingClientRect().height')) < .5
            dialog.get_by_role('button', name='Close', exact=True).click()
            expect(dialog).to_have_count(0)
            expect(page.locator('[data-task-uid="reference-wrapper"] .rm-desk-tile__preview')).to_be_focused()
            page.locator('[data-task-uid="reference-wrapper"] .rm-desk-tile__preview').click()
            expect(dialog).to_be_visible()
            dialog.focus(); dialog.press('Escape')
            expect(dialog).to_have_count(0)
            page.locator('[data-task-uid="reference-wrapper"] .rm-desk-tile__preview').click()
            expect(dialog).to_be_visible()
            page.mouse.click(5, 5)
            expect(dialog).to_have_count(0)
            assert page.evaluate('deskHarness.api.stats.writes.length') == 0
            assert page.evaluate('deskHarness.api.stats.nativeWrites.length') == 0
            page.evaluate('()=>deskHarness.destroy()')
            page.wait_for_function('deskHarness.api.activeEditors()===0&&deskHarness.api.stats.watches===0')
            assert not errors and not requests, (errors, requests)
            report = {'result': 'PASS', 'theme': 'dark' if dark else 'light', 'focus': box, 'nativeWidth': native_box['width'], 'matrix': matrix,
                      'sidebarIsolation': sidebar_proof, 'compositionAndSelectionRetained': True,
                      'scrollRestoration': True, 'nativeEscapeAndClose': True, 'counterAndDraft': True, 'graphWrites': 0}
            (OUT / 'results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
            print(json.dumps(report, ensure_ascii=False, indent=2))
        finally:
            browser.close()


if __name__ == '__main__':
    run()
