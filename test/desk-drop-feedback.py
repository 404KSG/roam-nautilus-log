#!/usr/bin/env python3
"""Synthetic import feedback: visibility is not the same as non-occlusion.
Reuses the production Desk harness and optional cached native styles. No live graph.
"""
import importlib.util
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ.get('DESK_DROP_FEEDBACK_TEST_OUT', '/tmp/nautilus-desk-drop-feedback'))


def bundle():
    spec = importlib.util.spec_from_file_location('desk_view_fixture', ROOT / 'test/desk-view.py')
    fixture = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fixture)
    fixture.OUT = OUT
    fixture.bundle()


def run():
    bundle()
    cases = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            page = browser.new_page(viewport={'width': 1280, 'height': 1000})
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto((OUT / 'index.html').as_uri())
            page.wait_for_function('() => window.deskHarness?.mount')
            page.evaluate('async () => { await document.fonts.ready; }')
            page.clock.install()

            def mount(empty=False, width=None):
                page.evaluate('''empty => {
                  // Plain, image-free tasks isolate feedback geometry from
                  // unrelated lazy image decode/preview hydration. Those races
                  // remain covered by desk-view and desk-preview-lifecycle.
                  deskHarness.mount({empty:true, count:0});
                  if(!empty) {
                    deskHarness.api.addChild('feedback-task-1','plan-desk','{{[[TODO]]}} First ordinary task');
                    deskHarness.api.addChild('feedback-task-2','plan-desk','{{[[TODO]]}} Second ordinary task');
                  }
                }''', empty)
                page.get_by_role('button', name='Open Desk', exact=True).click()
                scope = '[data-fixture-host="plan-desk"] .nautilus-desk'
                if width:
                    page.evaluate('''() => {
                      deskHarness.api.openCopy();
                      // Isolate the sidebar surface: a second copy of this
                      // plan stacked above it would move it when cards are
                      // legitimately added, independently of status feedback.
                      deskHarness.api.removeHost('plan-desk');
                    }''')
                    page.locator('[data-fixture-host="copy"]').evaluate('(el,width)=>el.style.width=`${width}px`', width)
                    scope = '[data-fixture-host="copy"] .nautilus-desk'
                root = page.locator(scope)
                expect(root).to_have_attribute('data-status', 'ready')
                root.locator('.rm-desk-page__toolbar').scroll_into_view_if_needed()
                page.evaluate('() => new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
                return scope, root

            def drop(scope, files=0, source_uid='outside-source'):
                page.evaluate('''({scope,files,uid})=>{
                  const source=document.querySelector(`#fixture-external-outline [data-block-uid="${uid}"] .rm-bullet`);
                  const target=document.querySelector(scope);
                  const data={types:['roam/block-uid-list-only-parents','roam/block-uid-list','roam/roam-uri-list'],files:{length:files},effectAllowed:'copy',getData:type=>({
                    'roam/block-uid-list-only-parents':uid,'roam/block-uid-list':uid,
                    'roam/roam-uri-list':`https://roamresearch.com/#/app/desk-fixture/page/${uid}`})[type]||''};
                  for(const [node,type] of [[source,'dragstart'],[target,'dragover'],[target,'drop'],[source,'dragend']]) {
                    const event=new Event(type,{bubbles:true,cancelable:true});
                    Object.defineProperty(event,'dataTransfer',{value:data});node.dispatchEvent(event);
                  }
                }''', {'scope': scope, 'files': files, 'uid': source_uid})

            def measure(root):
                return root.evaluate('''root=>{
                  const rect=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
                  const toast=root.querySelector('.nautilus-desk__drop-toast');
                  const box=rect(toast);
                  const controls=[...root.querySelectorAll('.rm-desk-page__toolbar input,.rm-desk-page__toolbar button')].map(el=>{
                    const r=rect(el);const style=getComputedStyle(el);
                    return {name:el.getAttribute('aria-label'),box:r,visible:style.visibility!=='hidden'&&style.display!=='none'&&Number(style.opacity)>0,
                      intersects:box.x<r.right&&box.right>r.x&&box.y<r.bottom&&box.bottom>r.y};
                  });
                  return {root:rect(root),grid:rect(root.querySelector('.nautilus-desk__grid')),title:rect(root.querySelector('.rm-desk-page__title')),
                    toast:box,hidden:toast.hidden,controls};
                }''')

            def unobstructed(root):
                expect(root.locator('.nautilus-desk__drop-toast')).to_be_visible()
                result = measure(root)
                assert all(c['visible'] and c['box']['width'] > 0 and c['box']['height'] > 0 and not c['intersects'] for c in result['controls']), result
                assert result['toast']['x'] >= result['title']['x'] - 0.5 and result['toast']['right'] <= result['title']['right'] + 0.5, result
                assert result['toast']['y'] >= result['title']['y'] - 0.5 and result['toast']['bottom'] <= result['title']['bottom'] + 0.5, result
                name = root.locator('.nautilus-desk__title-label').text_content()
                expect(root.get_by_role('heading', name=name, exact=True)).to_be_visible()
                expect(root.locator('.nautilus-desk__drop-status')).to_have_text(root.locator('.nautilus-desk__drop-toast').text_content())
                return result

            def unchanged(before, after, include_height=True, include_grid=True):
                for surface in ['root', 'grid'] if include_grid else ['root']:
                    for key in ['x', 'y', 'width'] + (['height'] if include_height else []):
                        assert abs(before[surface][key] - after[surface][key]) <= 0.5, (surface, key, before, after)

            # All three outcome states, both empty and populated, in wide main
            # and actual .rm-sidebar-window hosts. No generic visibility-only gate.
            for empty in [True, False]:
                for width in [None, 280, 320, 360]:
                    scope, root = mount(empty, width)
                    name = f'{"empty" if empty else "cards"}-{width or "wide"}'
                    before = measure(root)
                    source_before = page.evaluate('() => deskHarness.api.sourceSnapshot("outside-source")')
                    page.evaluate('() => deskHarness.api.holdNextCreate()')
                    drop(scope)
                    page.wait_for_function('deskHarness.api.pending()')
                    pending = unobstructed(root)
                    unchanged(before, pending)
                    page.clock.fast_forward(6000)
                    expect(root.locator('.nautilus-desk__drop-toast')).to_have_text('Adding reference. Original kept.')
                    unobstructed(root)
                    page.evaluate('() => deskHarness.api.release()')
                    page.wait_for_function('deskHarness.api.stats.referenceRequests.at(-1)?.state === "fulfilled"')
                    expect(root.locator('.nautilus-desk__drop-toast')).to_have_text('Added reference. Original kept.')
                    success = unobstructed(root)
                    unchanged(before, success, include_height=False, include_grid=not empty)
                    root.locator('.rm-desk-page__toolbar').screenshot(path=str(OUT / f'{name}-success.png'))
                    page.clock.fast_forward(5100)
                    expect(root.locator('.nautilus-desk__drop-toast')).to_be_hidden()
                    expect(root.locator('.nautilus-desk__drop-status')).to_have_text('')
                    assert root.locator('.rm-desk-page__title').get_attribute('title') is None
                    assert root.locator('.nautilus-desk__title-label').evaluate('el=>getComputedStyle(el).opacity') == '1'
                    unchanged(success, measure(root))
                    error_before = measure(root)
                    drop(scope, files=1)
                    page.wait_for_function('deskHarness.api.stats.referenceRequests.at(-1)?.state === "rejected"')
                    expect(root.locator('.nautilus-desk__drop-toast')).to_have_text('Could not confirm the reference. Check this plan before retrying.')
                    failure = unobstructed(root)
                    unchanged(error_before, failure)
                    expect(root.locator('.rm-desk-page__title')).to_have_attribute('title', 'Could not confirm the reference. Check this plan before retrying.')
                    root.locator('.rm-desk-page__toolbar').screenshot(path=str(OUT / f'{name}-error.png'))
                    page.clock.fast_forward(5100)
                    expect(root.locator('.nautilus-desk__drop-toast')).to_be_hidden()
                    assert page.evaluate('() => deskHarness.api.stats.writes.length') == 1
                    assert page.evaluate('() => deskHarness.api.sourceSnapshot("outside-source")') == source_before
                    cases.append({'name': name, 'pending': pending, 'success': success, 'error': failure})

            # A previous terminal timer must not clear a newer pending import.
            scope, root = mount()
            drop(scope)
            page.wait_for_function('deskHarness.api.stats.referenceRequests.at(-1)?.state === "fulfilled"')
            page.evaluate('''()=>{
              deskHarness.api.addChild('second-source','outside-parent','Second ordinary task');
              const owner=document.createElement('div');owner.dataset.blockUid='second-source';
              const bullet=document.createElement('span');bullet.className='rm-bullet';owner.append(bullet);
              document.querySelector('#fixture-external-outline').append(owner);
              deskHarness.api.holdNextCreate();
            }''')
            drop(scope, source_uid='second-source')
            page.wait_for_function('deskHarness.api.pending()')
            page.clock.fast_forward(6000)
            expect(root.locator('.nautilus-desk__drop-toast')).to_have_text('Adding reference. Original kept.')
            unobstructed(root)
            page.evaluate('() => deskHarness.api.release()')
            page.wait_for_function('deskHarness.api.stats.referenceRequests.at(-1)?.state === "fulfilled"')
            assert page.evaluate('() => deskHarness.api.stats.writes.length') == 2
            page.clock.fast_forward(5100)
            expect(root.locator('.nautilus-desk__drop-toast')).to_be_hidden()

            # Terminal feedback has no pending operation: cleanup must still
            # clear its timer, tooltip and visible text on each lifecycle edge.
            for lifecycle in ['blur', 'hashchange', 'fold', 'destroy']:
                scope, root = mount()
                drop(scope, files=1)
                page.wait_for_function('deskHarness.api.stats.referenceRequests.at(-1)?.state === "rejected"')
                unobstructed(root)
                page.evaluate('''({scope,kind})=>{
                  window.oldToast=document.querySelector(scope+' .nautilus-desk__drop-toast');
                  window.oldTitle=document.querySelector(scope+' .rm-desk-page__title');
                  if(kind==='fold') deskHarness.api.setCollapsed('plan-desk',true);
                  else if(kind==='destroy') deskHarness.destroy();
                  else window.dispatchEvent(new Event(kind));
                }''', {'scope': scope, 'kind': lifecycle})
                page.clock.fast_forward(6000)
                assert page.evaluate('() => oldToast.hidden && oldToast.textContent==="" && !oldTitle.hasAttribute("title")')
            assert not errors, errors
            (OUT / 'results.json').write_text(json.dumps({'status': 'passed', 'cases': cases,
                'terminalTimer': 'expires, does not clear a newer pending import, and cleans on blur/hash/fold/destroy',
                'pageerrors': errors, 'native_css': os.environ.get('ROAM_NATIVE_CSS', 'offline fixture'),
                'limitation': 'Synthetic graph and drag events; no live Desktop or clipboard activity.'}, indent=2))
            print(f'PASSED: {len(cases)} feedback geometry/occlusion cases, expiry, timer replacement, and lifecycle cleanup; artifacts: {OUT}')
        finally:
            browser.close()


if __name__ == '__main__':
    run()
