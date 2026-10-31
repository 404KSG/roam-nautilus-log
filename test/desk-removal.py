#!/usr/bin/env python3
"""Remove footer through real production actions, against an isolated fake graph."""
import importlib.util,json,os
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[1];OUT=Path(os.environ.get('DESK_REMOVE_TEST_OUT','/tmp/nautilus-desk-removal'))
def run():
    spec=importlib.util.spec_from_file_location('fixture',ROOT/'test/desk-view.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);m.OUT=OUT;m.bundle()
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True)
        try:
            page=browser.new_page(viewport={'width':1280,'height':1000});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
            page.goto((OUT/'index.html').as_uri());page.wait_for_function('()=>deskHarness?.mount')
            def mount():
                page.evaluate('''()=>{deskHarness.mount({count:3});deskHarness.api.addChild('pure-wrapper','plan-desk','{{TODO}} ((outside-source))');}''')
                page.get_by_role('button',name='Open Desk',exact=True).click()
                expect(page.locator('.nautilus-desk')).to_have_attribute('data-status','ready')
            def card(uid,scope='[data-fixture-host="plan-desk"]'):
                return page.locator(f'{scope} .nautilus-desk__card[data-task-uid="{uid}"]')
            def remove(uid):
                card(uid).hover();card(uid).get_by_role('button',name='Remove from Desk',exact=True).click()
            mount();original=page.evaluate('()=>deskHarness.api.sourceSnapshot("outside-source")')
            remove('pure-wrapper');expect(card('pure-wrapper')).to_have_count(0)
            page.wait_for_function('deskHarness.api.stats.writes.length===1')
            assert page.evaluate('()=>deskHarness.api.stats.writes[0]')=={'type':'delete','uid':'pure-wrapper'}
            assert page.evaluate('()=>deskHarness.api.sourceSnapshot("outside-source")')==original
            expect(page.locator('.nautilus-desk__focus-layer')).to_have_count(0)
            assert page.evaluate('()=>deskHarness.api.stats.renders.length')==0
            # A pure reference owning local content is promoted, never erased.
            child=page.evaluate('()=>deskHarness.api.text("reference-wrapper-note")')
            remove('reference-wrapper');expect(card('reference-wrapper')).to_have_count(0)
            assert page.evaluate('()=>deskHarness.api.children("daily-page").at(-1).uid')=='reference-wrapper'
            assert page.evaluate('()=>deskHarness.api.text("reference-wrapper-note")')==child
            assert page.evaluate('()=>deskHarness.api.stats.writes.at(-1).type')=='move'
            before=page.evaluate('()=>deskHarness.api.sourceSnapshot("task-1")')
            remove('task-1');expect(card('task-1')).to_have_count(0)
            assert page.evaluate('()=>deskHarness.api.children("daily-page").at(-1).uid')=='task-1'
            after=json.loads(page.evaluate('()=>deskHarness.api.sourceSnapshot("task-1")'));before=json.loads(before)
            assert after['uid']==before['uid'] and after['string']==before['string'] and after['children']==before['children']
            # Outside native focus and global composition fail before mutation.
            mount();page.evaluate('()=>deskHarness.api.setExternalFocus("outside-source")')
            # Editing the referenced SOURCE is safe from local deletion only if
            # collateral snapshot stays unchanged; target/descendant editing blocks.
            page.evaluate('()=>deskHarness.api.setExternalFocus("pure-wrapper")')
            remove('pure-wrapper');expect(card('pure-wrapper')).to_have_count(1)
            expect(page.locator('.nautilus-desk__drop-toast')).to_contain_text('being edited')
            assert page.evaluate('()=>deskHarness.api.stats.writes.length')==0
            page.evaluate('()=>{deskHarness.api.setExternalFocus(null);document.body.dispatchEvent(new CompositionEvent("compositionstart",{bubbles:true}));}')
            remove('pure-wrapper');assert page.evaluate('()=>deskHarness.api.stats.writes.length')==0
            page.evaluate('()=>document.body.dispatchEvent(new CompositionEvent("compositionend",{bubbles:true}))')
            # Another same-plan native focus editor blocks a programmatic click.
            page.evaluate('()=>deskHarness.api.openCopy()')
            card('task-0').locator('[role="button"]').click()
            page.wait_for_function('deskHarness.api.activeEditors()===1')
            card('pure-wrapper','[data-fixture-host="copy"]').get_by_role('button',name='Remove from Desk',exact=True).evaluate('el=>el.click()')
            page.wait_for_timeout(50)
            assert page.evaluate('()=>deskHarness.api.stats.writes.length')==0
            page.locator('.rm-desk__side--end').get_by_role('button',name='Close',exact=True).click()
            page.wait_for_function('deskHarness.api.activeEditors()===0')
            # An unconfirmed removal blocks other Desk writes. Refresh can
            # verify a late result even after its card has disappeared.
            mount()
            page.evaluate('''()=>{roamAlphaAPI.data.block.delete=async({block})=>{
              deskHarness.api.stats.writes.push({type:'unconfirmed-delete',uid:block.uid});};}''')
            remove('pure-wrapper')
            expect(page.get_by_role('button',name='Refresh',exact=True)).to_be_visible()
            card('pure-wrapper').locator('[role="button"]').click()
            assert page.evaluate('()=>deskHarness.api.activeEditors()')==0
            card('task-1').hover();card('task-1').get_by_role('button',name='Move to top',exact=True).click()
            expect(card('task-1').get_by_role('button',name='Move to top',exact=True)).to_be_enabled()
            assert page.evaluate('()=>deskHarness.api.stats.writes.length')==1
            page.evaluate('()=>deskHarness.api.remove("pure-wrapper")')
            expect(card('pure-wrapper')).to_have_count(0)
            page.get_by_role('button',name='Refresh',exact=True).click()
            expect(page.get_by_role('button',name='Refresh',exact=True)).to_be_hidden()
            card('task-1').hover();card('task-1').get_by_role('button',name='Move to top',exact=True).click()
            page.wait_for_function('deskHarness.api.stats.writes.length===2')
            assert page.evaluate('()=>deskHarness.api.stats.writes[1].type')=='move'
            # Held host delete: disabled duplicate action and view disposal do
            # not issue a second write, or resurrect the closed interface.
            mount();page.evaluate('()=>deskHarness.api.holdNextDelete()')
            remove('pure-wrapper');page.wait_for_function('deskHarness.api.pending()')
            page.evaluate('()=>deskHarness.api.openCopy()')
            copy_card=card('pure-wrapper','[data-fixture-host="copy"]')
            copy_card.locator('[role="button"]').click()
            assert page.evaluate('()=>deskHarness.api.activeEditors()')==0
            page.evaluate('()=>deskHarness.api.removeHost("copy")')
            button=card('pure-wrapper').get_by_role('button',name='Remove from Desk',exact=True)
            expect(button).to_be_disabled();button.evaluate('el=>el.dispatchEvent(new MouseEvent("click",{bubbles:true}))')
            assert page.evaluate('()=>deskHarness.api.stats.writes.length')==1
            page.get_by_role('button',name='Open Desk',exact=True).click()
            page.evaluate('()=>deskHarness.api.release()')
            page.wait_for_function('deskHarness.api.text("pure-wrapper")===undefined')
            expect(page.locator('.nautilus-desk')).to_have_count(0)
            assert page.evaluate('()=>deskHarness.api.stats.writes.length')==1
            assert page.evaluate('()=>deskHarness.api.stats.forbiddenWrites')==0
            assert not errors,errors
            (OUT/'results.json').write_text(json.dumps({'status':'passed','cases':['childless wrapper delete/source preserved','owned reference children promoted','entity same UID/subtree promoted','external focus','global IME','same-plan focus surface','uncertain reservation and Refresh-only recovery','held duplicate and disposal'],'pageerrors':errors,'limitation':'Synthetic graph only; no live user data modified.'},indent=2))
            print(f'PASSED: guarded Remove footer and lifecycle; artifacts: {OUT}')
        finally:browser.close()
if __name__=='__main__':run()
