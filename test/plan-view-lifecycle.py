#!/usr/bin/env python3
"""Unify presentation without losing native editor or uncommitted draft state."""
import importlib.util
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('desk_fixture',ROOT/'test/desk-view.py')
f=importlib.util.module_from_spec(spec);spec.loader.exec_module(f)
f.OUT=Path(os.environ.get('NAUTILUS_VIEW_LIFECYCLE_OUT','/tmp/nautilus-view-lifecycle'))


def run():
    f.bundle()
    errors=[];report={}
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True)
        try:
            page=browser.new_page(viewport={'width':1280,'height':1000})
            page.on('pageerror',lambda error:errors.append(str(error)))
            page.goto((f.OUT/'index.html').as_uri())
            page.wait_for_function('()=>window.deskHarness?.mount')
            page.evaluate('()=>deskHarness.mount({count:3,unifiedView:true})')
            owner=page.locator('[data-fixture-host="plan-desk"]')
            root=owner.locator('.nautilus-log-container');switch=owner.get_by_role('switch',name='Chart view',exact=True)
            raw=owner.locator('.fixture-raw')
            expect(owner.locator('.nautilus-desk')).to_have_attribute('data-status','ready')
            expect(raw).to_be_hidden()
            assert switch.evaluate('e=>e.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true}))')
            expect(root).to_have_attribute('data-nautilus-view','chart')
            before=page.evaluate('()=>deskHarness.api.children("plan-desk")')
            page.evaluate('()=>deskHarness.api.holdNextRender()')
            owner.locator('[data-task-uid="task-0"] [role="button"]').click()
            page.wait_for_function('()=>deskHarness.api.pending()')
            expect(page.locator('.nautilus-desk__focus-layer')).to_have_count(1)
            # Simulate a view request arriving while a native mount is in flight.
            switch.evaluate('e=>e.click()')
            expect(root).to_have_attribute('data-nautilus-view','list')
            expect(page.locator('.nautilus-desk__focus-layer')).to_have_count(0)
            expect(raw).to_be_hidden()
            page.evaluate('()=>deskHarness.api.release()')
            expect(raw).to_be_visible()
            assert page.evaluate('()=>deskHarness.api.activeEditors()')==0
            assert page.evaluate('()=>deskHarness.api.stats.unmounts')==1
            assert page.evaluate('()=>deskHarness.api.stats.writes.length')==0
            switch.click();expect(owner.locator('.nautilus-desk')).to_be_visible()
            expect(raw).to_be_hidden()
            report['delayedNativeUnmountBeforeList']=True

            # Native fold pauses the same Desk, drops the body-mounted editor,
            # and keeps the selected Chart view and outline claim.
            page.evaluate('()=>{const render=roamAlphaAPI.ui.components.renderBlock;roamAlphaAPI.ui.components.renderBlock=async options=>{await render(options);options.el.style.minHeight="2000px"}}')
            owner.locator('[data-task-uid="task-0"] [role="button"]').click()
            expect(page.locator('.nautilus-desk__native textarea[data-block-uid="task-0"]')).to_be_visible()
            page.locator('.nautilus-desk__focus-body').evaluate('e=>e.scrollTop=300')
            page.evaluate('()=>{window.originalDesk=document.querySelector("[data-fixture-host=plan-desk] .nautilus-desk");window.retiredFoldEditor=document.querySelector(".nautilus-desk__native")}')
            owner.get_by_role('button',name='Fold plan').evaluate('e=>e.click()')
            expect(root).to_be_hidden();expect(raw).to_be_hidden()
            expect(page.locator('.nautilus-desk__focus-layer')).to_have_count(0)
            owner.get_by_role('button',name='Fold plan').click()
            expect(root).to_be_visible();expect(switch).to_have_attribute('aria-checked','true')
            assert page.evaluate('()=>originalDesk===document.querySelector("[data-fixture-host=plan-desk] .nautilus-desk")')
            assert page.evaluate('()=>deskHarness.api.children("plan-desk")')==before
            report['nativeFoldRetainsSession']=True
            owner.locator('[data-task-uid="task-0"] [role="button"]').click()
            expect(page.locator('.nautilus-desk__native textarea[data-block-uid="task-0"]')).to_be_visible()
            assert page.evaluate('()=>retiredFoldEditor!==document.querySelector(".nautilus-desk__native")&&deskHarness.api.activeEditors()===1')
            assert page.locator('.nautilus-desk__focus-body').evaluate('e=>e.scrollTop')==300
            page.locator('.rm-desk__close').click()
            report['retiredFoldUnmountCannotTouchFreshEditor']=True

            # List mode parks a nonempty uncommitted IME draft. Returning to
            # New task restores the text without an implicit create.
            owner.locator('.rm-desk-page__new-note').click()
            draft=page.locator('.rm-desk-draft__input')
            expect(draft).to_be_visible()
            draft.evaluate('e=>{e.dispatchEvent(new CompositionEvent("compositionstart",{bubbles:true}));e.value="尚未确认的输入";e.dispatchEvent(new InputEvent("input",{bubbles:true,isComposing:true}))}')
            switch.evaluate('e=>e.click()');expect(root).to_have_attribute('data-nautilus-view','list')
            switch.click();owner.locator('.rm-desk-page__new-note').click()
            expect(draft).to_have_value('尚未确认的输入')
            assert page.evaluate('()=>deskHarness.api.stats.writes.length')==0
            page.locator('.rm-desk__close').click()
            report['uncommittedImeDraftRestored']=True
            page.evaluate('()=>{deskHarness.mount({count:3,unifiedView:true});const generate=roamAlphaAPI.util.generateUID;window.foldDraftUids=[];roamAlphaAPI.util.generateUID=()=>{const uid=generate();foldDraftUids.push(uid);return uid}}')
            owner.locator('.rm-desk-page__new-note').click()
            draft.evaluate('e=>{e.dispatchEvent(new CompositionEvent("compositionstart",{bubbles:true}));window.foldDraftHeightReads=0;Object.defineProperty(e,"scrollHeight",{configurable:true,get(){foldDraftHeightReads++;return 42}})}')
            owner.get_by_role('button',name='Fold plan').evaluate('e=>e.click()')
            expect(root).to_be_hidden()
            assert page.evaluate('foldDraftHeightReads')==0, 'Fold must capture draft text without forcing textarea layout.'
            owner.get_by_role('button',name='Fold plan').click()
            owner.locator('.rm-desk-page__new-note').click()
            expect(draft).to_be_visible()
            draft.evaluate('e=>delete e.scrollHeight')
            assert page.evaluate('foldDraftUids.length')==1, 'An empty composing draft lost its reserved UID on fold.'
            page.locator('.rm-desk__close').click()
            report['emptyImeFoldRetainsReservation']=True

            # The same plan in the sidebar follows its own native caret and
            # remembers its own view without changing the main window.
            page.evaluate('()=>deskHarness.api.openCopy()')
            sidebar=page.locator('[data-fixture-host="copy"]')
            expect(sidebar.locator('.nautilus-desk')).to_be_visible()
            sidebar.get_by_role('button',name='Fold plan').click()
            expect(sidebar.locator('.nautilus-log-container')).to_be_hidden();expect(root).to_be_visible()
            sidebar.get_by_role('button',name='Fold plan').click()
            sidebar.get_by_role('switch',name='Chart view').click()
            expect(sidebar.locator('.fixture-raw')).to_be_visible();expect(raw).to_be_hidden()
            expect(root).to_have_attribute('data-nautilus-view','chart')
            report['sidebarIsolation']=True

            # A separately evaluated extension bundle has its own private claim
            # map. Its retired owner must not reveal the new owner's Chart
            # outline when a queued editor cleanup finishes after rebinding.
            page.evaluate('''async source=>{
              const other=await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(source));
              const container=document.querySelector('[data-fixture-host="plan-desk"] .nautilus-log-desk-host');
              const retired=other.createDeskOutlineVisibility(container,window);
              retired.setHidden(true);retired.destroy();
            }''',(ROOT/'src/desk-host.js').read_text())
            expect(raw).to_be_hidden()
            expect(root).to_have_attribute('data-nautilus-view','chart')
            assert page.evaluate('()=>deskHarness.api.stats.writes.length')==0
            report['retiredBundleCannotRevealSuccessorOutline']=True
            switch.click();expect(raw).to_be_visible()
            switch.click();expect(raw).to_be_hidden()
            report['successorStillReleasesInList']=True
            page.evaluate('()=>deskHarness.destroy()')
            expect(page.locator('[data-nautilus-desk-hidden]')).to_have_count(0)
            expect(page.locator('.nautilus-desk__focus-layer')).to_have_count(0)
            report['teardownReleasedClaims']=True
        finally:browser.close()
    assert not errors,errors
    report['pageErrors']=errors
    (f.OUT/'view-result.json').write_text(json.dumps(report,indent=2))
    print(f'PASS: view transition, delayed editor cleanup, native fold, IME draft and sidebar isolation; {f.OUT}')


if __name__=='__main__':run()
