#!/usr/bin/env python3
"""Trusted image-area drags must use the whole Desk card as the native source.

This observes browser drag-source identity/payload, not OS drag-bitmap pixels.
Only a synthetic graph and local raster fixtures are used.
"""
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ.get('DESK_IMAGE_DRAG_OUT', '/tmp/nautilus-desk-image-drag'))
spec = importlib.util.spec_from_file_location('desk_image_fixture', ROOT / 'test/desk-view.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
fixture.OUT = OUT


def run():
    fixture.bundle()
    cases = []
    errors = []
    tall_png = 'data:image/png;base64,' + base64.b64encode(fixture.png(640, 1200)).decode()
    normal_tail = ['reference-wrapper', 'context-wrapper', 'code-literal', 'done-reference', 'divider']
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            page = browser.new_page(viewport={'width': 1280, 'height': 1000})
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.route('https://desk-fixture.invalid/**', lambda route: route.fulfill(content_type='image/png', body=fixture.RASTER_640_360))
            page.goto((OUT / 'index.html').as_uri())
            page.wait_for_function('() => Boolean(window.deskHarness?.mount)')
            page.evaluate('async () => { await document.fonts.ready; }')
            page.evaluate('''() => {
              window.imageDragTrace = []; window.customDragImages = 0;
              const native = DataTransfer.prototype.setDragImage;
              DataTransfer.prototype.setDragImage = function(...args) { customDragImages++; return native.apply(this, args); };
              for (const type of ['dragstart', 'drop', 'dragend']) document.addEventListener(type, event => {
                imageDragTrace.push({type, trusted:event.isTrusted, tag:event.target.tagName,
                  cardTarget:event.target.classList?.contains('nautilus-desk__card') || false,
                  uid:event.target.closest?.('[data-task-uid]')?.dataset.taskUid,
                  types:[...event.dataTransfer?.types || []].sort()});
              }, true);
            }''')
            definitions = [
                ('plain-card-control', 'task-1', None, ['event', 'done', 'task-0', 'task-2', 'task-3', 'task-1'] + normal_tail),
                ('large-single-image', 'task-0', 0, ['event', 'done', 'task-1', 'task-2', 'task-3', 'task-0'] + normal_tail),
                ('gallery-image', 'task-0', 1, ['event', 'done', 'task-1', 'task-2', 'task-3', 'task-0'] + normal_tail),
                ('embed-source-image', 'reference-wrapper', 0, ['event', 'done', 'task-0', 'task-1', 'task-2', 'task-3'] + normal_tail),
            ]
            for name, uid, image_index, expected in definitions:
                page.evaluate('() => deskHarness.mount({count:4})')
                if name == 'large-single-image':
                    page.evaluate('''url => {
                      for (const child of deskHarness.api.children('task-0')) deskHarness.api.remove(child.uid);
                      deskHarness.api.setString('task-0', '{{[[TODO]]}} Large illustrated card 45m ![Local raster](' + url + ')');
                    }''', tall_png)
                if name == 'embed-source-image':
                    page.evaluate('''() => {
                      deskHarness.api.setString('reference-wrapper', '{{embed-path: ((source-task)) closed}}');
                    }''')
                page.get_by_role('button', name='Open Desk', exact=True).click()
                expect(page.locator('.nautilus-desk')).to_have_attribute('data-status', 'ready')
                tile = page.locator(f'.nautilus-desk__card[data-task-uid="{uid}"]')
                target = page.locator('.nautilus-desk__card[data-task-uid="task-3"]')
                source = tile.locator('.rm-desk-tile__title') if image_index is None else tile.locator('img').nth(image_index)
                if image_index is not None:
                    expect(source).to_be_visible()
                    page.wait_for_function('''({uid,index}) => {
                      const image=document.querySelectorAll(`.nautilus-desk__card[data-task-uid="${uid}"] img`)[index];
                      return image?.complete && image.naturalWidth > 0;
                    }''', arg={'uid': uid, 'index': image_index})
                before = page.evaluate('''uid => ({strings:deskHarness.api.children('plan-desk').map(r=>[r.uid,r.string]).sort(),
                  children:deskHarness.api.children(uid), source:deskHarness.api.sourceSnapshot('source-task')})''', uid)
                page.evaluate('() => { imageDragTrace.length=0; customDragImages=0; }')
                box = target.bounding_box()
                source.drag_to(target, target_position={'x': box['width'] - 4, 'y': 20})
                page.wait_for_function('() => !deskHarness.api.pending()')
                page.wait_for_function('expected => JSON.stringify(deskHarness.api.children("plan-desk").map(r=>r.uid)) === JSON.stringify(expected)', arg=expected)
                evidence = page.evaluate('''uid => ({trace:imageDragTrace, customDragImages,
                  order:deskHarness.api.children('plan-desk').map(r=>r.uid),
                  strings:deskHarness.api.children('plan-desk').map(r=>[r.uid,r.string]).sort(),
                  children:deskHarness.api.children(uid), source:deskHarness.api.sourceSnapshot('source-task'),
                  writes:deskHarness.api.stats.writes.length, notice:document.querySelector('.nautilus-desk__notice').textContent})''', uid)
                starts = [event for event in evidence['trace'] if event['type'] == 'dragstart']
                drops = [event for event in evidence['trace'] if event['type'] == 'drop']
                evidence['case'] = name
                cases.append(evidence)
                (OUT / 'observations.json').write_text(json.dumps(cases, ensure_ascii=False, indent=2))
                assert len(starts) == len(drops) == 1, evidence
                assert starts[0]['trusted'] and starts[0]['cardTarget'] and starts[0]['uid'] == uid, evidence
                assert drops[0]['trusted'] and drops[0]['types'] == ['application/x-nautilus-desk-task'], evidence
                assert evidence['customDragImages'] == 0, evidence
                assert evidence['order'] == expected, evidence
                assert evidence['strings'] == before['strings'] and evidence['children'] == before['children'], evidence
                assert evidence['source'] == before['source'] and evidence['notice'] == '', evidence
                assert evidence['writes'] == (0 if name == 'embed-source-image' else 1), evidence
                expect(page.locator('.rm-desk-tile--dragging')).to_have_count(0)
                if image_index is not None:
                    # Disabling the image's own drag must not disable its click
                    # target. The fixture intercepts only this click, not a host
                    # viewer; OS/native viewer behavior is a separate boundary.
                    source.evaluate('''image => {
                      window.previewImageClick = false;
                      image.addEventListener('click', event => {
                        window.previewImageClick = event.isTrusted && event.target === image;
                        event.preventDefault(); event.stopPropagation();
                      }, {once:true});
                    }''')
                    source.click()
                    assert page.evaluate('previewImageClick'), 'image-area click target was disabled'
                    assert source.evaluate('image => image.draggable') is False
            # The setting is local to owned preview images, never a global image rule.
            assert page.evaluate('document.createElement("img").draggable') is True
            assert not errors, errors
            page.evaluate('() => deskHarness.destroy()')
            result = {'status': 'passed', 'cases': len(cases), 'pageErrors': errors,
                      'nativeModuleSha256': hashlib.sha256((ROOT/'src/desk-native.js').read_bytes()).hexdigest(),
                      'limitation': 'Trusted synthetic-browser drag source/payload and click target; no OS drag-bitmap pixel or live graph certification.'}
            (OUT / 'results.json').write_text(json.dumps(result, indent=2))
            print(json.dumps(result))
        except Exception as error:
            (OUT / 'failure.json').write_text(json.dumps({'error': str(error), 'cases': cases, 'pageErrors': errors}, ensure_ascii=False, indent=2))
            raise
        finally:
            browser.close()


if __name__ == '__main__':
    run()
