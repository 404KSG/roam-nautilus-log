#!/usr/bin/env python3
"""Native-shaped block origins and removal-to-import recovery through production actions.
Only the graph, native editor and drag event payload are synthetic; no live graph or OS drag.
"""
import importlib.util
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ.get('DESK_IMPORT_RECOVERY_OUT', '/tmp/nautilus-desk-import-recovery'))

DROP = '''({uid, sourceSelector, fields: overrides, types, files, revoke, modifier, afterDrop}) => {
  const source = document.querySelector(sourceSelector), dest = document.querySelector('.nautilus-desk__grid');
  const fields = {'roam/block-uid-list-only-parents': uid, 'roam/block-uid-list': uid,
    'roam/roam-uri-list': `https://roamresearch.com/#/app/desk-fixture/page/${uid}`, ...overrides};
  let readable = true, hostOver = 0, hostDrop = 0;
  const data = {types: types || Object.keys(fields), files: {length: files || 0}, effectAllowed: 'copy', dropEffect: 'none',
    getData: type => readable ? fields[type] || '' : ''};
  const overHost = () => hostOver++, dropHost = () => hostDrop++;
  document.addEventListener('dragover', overHost); document.addEventListener('drop', dropHost);
  const fire = (node, type) => {
    const rect = dest.getBoundingClientRect(), event = new Event(type, {bubbles:true,cancelable:true});
    Object.defineProperties(event, {dataTransfer:{value:data}, clientX:{value:rect.x+4}, clientY:{value:rect.y+2}, altKey:{value:Boolean(modifier)}});
    node.dispatchEvent(event); return event.defaultPrevented;
  };
  fire(source, 'dragstart'); const over = fire(dest, 'dragover'), drop = fire(dest, 'drop');
  if (revoke) readable = false;
  if (afterDrop === 'change-user') roamAlphaAPI.user.uid = () => 'changed-user';
  // Keyboard events originate at the focused element, not the document node.
  if (afterDrop === 'escape') document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',bubbles:true,cancelable:true}));
  fire(source, 'dragend');
  document.removeEventListener('dragover', overHost); document.removeEventListener('drop', dropHost);
  return {over, drop, hostOver, hostDrop};
}'''


def run():
    spec = importlib.util.spec_from_file_location('desk_fixture', ROOT / 'test/desk-view.py')
    fixture = importlib.util.module_from_spec(spec); spec.loader.exec_module(fixture)
    fixture.OUT = OUT; fixture.bundle()
    cases = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            page = browser.new_page(viewport={'width':1280,'height':1000})
            errors = []; requests = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.on('request', lambda request: requests.append(request.url) if request.url.startswith(('http://','https://')) else None)
            page.goto((OUT / 'index.html').as_uri())
            page.wait_for_function('() => Boolean(window.deskHarness?.mount)')

            def settle():
                page.evaluate('async () => { await document.fonts.ready; for(let i=0;i<3;i++) await new Promise(r=>requestAnimationFrame(r)); }')

            def mount():
                page.evaluate('''() => {
                  deskHarness.mount({count:3});
                  deskHarness.api.addBlock('another-source','{{[[TODO]]}} Another source 25m','outside-parent');
                  deskHarness.api.setPage('another-source','external-page');
                }''')
                page.get_by_role('button', name='Open Desk', exact=True).click()
                expect(page.locator('.nautilus-desk')).to_have_attribute('data-status','ready')
                settle()

            def card(uid):
                return page.locator(f'.nautilus-desk__card[data-task-uid="{uid}"]')

            def origin(classes=(), uid='outside-source', location='roam-article'):
                # Native-shaped leaf: context ancestors may have their own UID,
                # but the bullet belongs to the closest block UID, not that context.
                page.evaluate('''({classes,uid,location}) => {
                  const root=document.querySelector('#fixture-external-outline'); root.className=location;
                  root.replaceChildren(); let parent=root;
                  for(const className of classes){const node=document.createElement('div');node.className=className;parent.append(node);parent=node;}
                  const context=document.createElement('div');context.dataset.blockUid='context-ancestor';parent.append(context);
                  const leaf=document.createElement('div');leaf.className='roam-block-container';leaf.dataset.blockUid=uid;
                  leaf.innerHTML='<div class="rm-block-main"><div class="controls"><span class="rm-bullet"><span class="rm-bullet__inner">•</span></span></div><div class="roam-block">Fixture task</div></div>';
                  context.append(leaf);
                }''', {'classes':list(classes),'uid':uid,'location':location})

            def drag(uid='outside-source', source='#fixture-external-outline .rm-bullet__inner', fields=None, types=None, files=0, revoke=False, modifier=False, after_drop=None):
                return page.evaluate(DROP, {'uid':uid,'sourceSelector':source,'fields':fields or {},'types':types,'files':files,'revoke':revoke,'modifier':modifier,'afterDrop':after_drop})

            def idle():
                page.wait_for_function('() => deskHarness.api.stats.referenceRequests.every(row => row.state !== "pending")')
                settle()

            def added(uid='outside-source'):
                idle(); expect(card(f'ref-{uid}')).to_be_visible(timeout=2500)

            def no_writes(before=0):
                idle(); assert page.evaluate('deskHarness.api.stats.writes.length') == before

            def check(name, action):
                try:
                    action(); cases.append({'case':name,'status':'passed'})
                except Exception as error:
                    cases.append({'case':name,'status':'failed','error':str(error)})
                    page.screenshot(path=str(OUT / f'failure-{len(cases):02d}.png'))
                (OUT / 'results.json').write_text(json.dumps({'cases':cases,'pageErrors':errors,'httpRequests':requests},indent=2)+'\n')

            surfaces = [
                ('ordinary-outline', (), 'roam-article'),
                ('sidebar-outline', ('rm-sidebar-outline',), 'rm-sidebar-window'),
                ('linked-reference', ('rm-reference-container','rm-reference-item'), 'roam-article'),
                ('query-result', ('roam-query','roam-query-content'), 'roam-article'),
                ('embedded-outline', ('rm-embed-container','rm-embed'), 'roam-article'),
                ('nested-reference-embed', ('rm-reference-container','rm-reference-item','rm-embed-container'), 'roam-article'),
                ('other-native-location', (), 'fixture-native-location'),
            ]
            for name, classes, location in surfaces:
                def positive(classes=classes, location=location):
                    mount(); origin(classes, location=location)
                    source = page.evaluate('deskHarness.api.sourceSnapshot("outside-source")')
                    gesture = drag(revoke=True); added()
                    assert gesture == {'over':True,'drop':True,'hostOver':0,'hostDrop':0}
                    assert page.evaluate('deskHarness.api.stats.writes.length') == 1
                    assert page.evaluate('deskHarness.api.text("ref-outside-source")') == '{{embed-path: ((outside-source)) closed}}'
                    assert page.evaluate('deskHarness.api.sourceSnapshot("outside-source")') == source
                check(name, positive)

            negatives = [
                ('container-not-leaf', '#fixture-external-outline .rm-reference-container', {}, None, 0),
                ('text-not-bullet', '#fixture-external-outline .roam-block', {}, None, 0),
                ('uid-mismatch', '#fixture-external-outline .rm-bullet__inner', {'roam/block-uid-list-only-parents':'another-source','roam/block-uid-list':'another-source','roam/roam-uri-list':'https://roamresearch.com/#/app/desk-fixture/page/another-source'}, None, 0),
                ('multiple-blocks', '#fixture-external-outline .rm-bullet__inner', {'roam/block-uid-list':'outside-source\nanother-source'}, None, 0),
                ('cross-graph', '#fixture-external-outline .rm-bullet__inner', {'roam/roam-uri-list':'https://roamresearch.com/#/app/other-graph/page/outside-source'}, None, 0),
                ('files', '#fixture-external-outline .rm-bullet__inner', {}, None, 1),
                ('plain-text-only', '#fixture-external-outline .rm-bullet__inner', {}, ['text/plain'], 0),
            ]
            for name, selector, fields, types, files in negatives:
                def negative(selector=selector, fields=fields, types=types, files=files):
                    mount(); origin(('rm-reference-container',))
                    source = page.evaluate('deskHarness.api.sourceSnapshot("outside-source")')
                    drag(source=selector, fields=fields, types=types, files=files); no_writes()
                    expect(card('ref-outside-source')).to_have_count(0)
                    assert page.evaluate('deskHarness.api.sourceSnapshot("outside-source")') == source
                check(name, negative)

            def page_source():
                mount(); origin(('rm-reference-container',), uid='external-page')
                drag(uid='external-page'); no_writes()
            check('page-entity-is-not-a-block', page_source)

            def page_heading():
                mount(); origin(('rm-title-display',))
                drag(); no_writes()
            check('page-heading-is-not-a-block-origin', page_heading)

            for label, text in [('completed-source','{{[[DONE]]}} Completed source'), ('query-container-block','{{[[query]]: {and: [[TODO]]}}}'), ('renderer-source-block','{{[[roam/render]]:((code-source))}}')]:
                def ineligible(text=text):
                    mount(); origin(('rm-reference-container',));page.evaluate('text => deskHarness.api.setString("outside-source",text)',text)
                    drag();no_writes()
                    assert page.evaluate('deskHarness.api.text("outside-source")')==text
                check(label,ineligible)

            def modifier_passthrough():
                mount();origin(('rm-reference-container',));gesture=drag(modifier=True);no_writes()
                assert gesture=={'over':False,'drop':False,'hostOver':1,'hostDrop':1}
            check('modifier-remains-native-owned',modifier_passthrough)

            def delayed_remove_setup(kind='delete'):
                mount();origin();drag();added()
                if kind == 'move':
                    page.evaluate('deskHarness.api.addChild("kept-local-note","ref-outside-source","Local content stays attached",false)')
                page.evaluate('''kind => {
                  const original=roamAlphaAPI.data.block[kind];window.removalIssueCount=0;window.finishRemovalProjection=null;
                  roamAlphaAPI.data.block[kind]=async args=>{removalIssueCount++;window.finishRemovalProjection=()=>original(args);};
                }''',kind)
                card('ref-outside-source').get_by_role('button',name='Remove from Desk',exact=True).evaluate('el=>el.click()')
                expect(page.locator('.nautilus-desk__drop-status')).to_contain_text('Removal could not be confirmed')
                expect(page.get_by_role('button',name='Refresh',exact=True)).to_be_visible()
                assert page.evaluate('removalIssueCount')==1

            def recovery():
                delayed_remove_setup()
                source=page.evaluate('deskHarness.api.sourceSnapshot("outside-source")')
                page.evaluate('finishRemovalProjection()');expect(card('ref-outside-source')).to_have_count(0)
                origin(uid='another-source');drag(uid='another-source',revoke=True);added('another-source')
                assert page.evaluate('removalIssueCount')==1
                assert page.evaluate('deskHarness.api.stats.writes.map(row=>row.type)')==['create','delete','create']
                assert page.evaluate('deskHarness.api.sourceSnapshot("outside-source")')==source
                expect(page.get_by_role('button',name='Refresh',exact=True)).to_be_hidden()
            check('late-delete-next-import-verifies-without-replay-or-reload',recovery)

            def promotion_recovery():
                delayed_remove_setup('move')
                source=page.evaluate('deskHarness.api.sourceSnapshot("outside-source")')
                page.evaluate('finishRemovalProjection()');expect(card('ref-outside-source')).to_have_count(0)
                origin(('rm-reference-container',),uid='another-source');drag(uid='another-source',revoke=True);added('another-source')
                assert page.evaluate('deskHarness.api.stats.writes.map(row=>row.type)')==['create','move','create']
                assert page.evaluate('removalIssueCount')==1
                assert page.evaluate('deskHarness.api.children("daily-page").at(-1).uid')=='ref-outside-source'
                assert page.evaluate('deskHarness.api.text("kept-local-note")')=='Local content stays attached'
                assert page.evaluate('roamAlphaAPI.data.pull("[:block/open]",[":block/uid","kept-local-note"])["block/open"]') is False
                assert page.evaluate('deskHarness.api.sourceSnapshot("outside-source")')==source
            check('late-promotion-keeps-UID-subtree-and-recovers-next-import',promotion_recovery)

            def changed_context():
                delayed_remove_setup();page.evaluate('finishRemovalProjection()');expect(card('ref-outside-source')).to_have_count(0)
                origin(uid='another-source');drag(uid='another-source',revoke=True,after_drop='change-user');no_writes(2)
                expect(card('ref-another-source')).to_have_count(0)
                assert page.evaluate('removalIssueCount')==1
            check('user-change-before-reconciliation-cannot-import',changed_context)

            def cancelled_recovery():
                delayed_remove_setup();page.evaluate('finishRemovalProjection()');expect(card('ref-outside-source')).to_have_count(0)
                origin(uid='another-source');drag(uid='another-source',revoke=True,after_drop='escape');no_writes(2)
                assert page.evaluate('removalIssueCount')==1
                expect(page.locator('.nautilus-desk')).to_have_count(0)
                page.get_by_role('button',name='Open Desk',exact=True).click()
                expect(page.locator('.nautilus-desk')).to_have_attribute('data-status','ready')
                origin(uid='another-source');drag(uid='another-source');added('another-source')
                assert page.evaluate('deskHarness.api.stats.writes.map(row=>row.type)')==['create','delete','create']
            check('cancelled-drop-keeps-receipt-without-writing-and-a-fresh-intent-recovers',cancelled_recovery)

            def still_unknown():
                delayed_remove_setup();origin(uid='another-source');drag(uid='another-source',revoke=True);no_writes(1)
                assert page.evaluate('deskHarness.api.stats.referenceRequests.length')==2
                expect(card('ref-outside-source')).to_have_count(1);expect(card('ref-another-source')).to_have_count(0)
                assert page.evaluate('removalIssueCount')==1
                expect(page.get_by_role('button',name='Refresh',exact=True)).to_be_visible()
            check('unknown-removal-still-blocks-the-next-import',still_unknown)

            def source_conflict():
                delayed_remove_setup();page.evaluate('finishRemovalProjection()');expect(card('ref-outside-source')).to_have_count(0)
                page.evaluate('deskHarness.api.setString("outside-source","{{[[TODO]]}} Source changed independently 20m")')
                origin(uid='another-source');drag(uid='another-source');no_writes(2)
                assert page.evaluate('deskHarness.api.stats.referenceRequests.length')==2
                expect(card('ref-another-source')).to_have_count(0)
                assert page.evaluate('removalIssueCount')==1
            check('source-conflict-does-not-unlock-or-overwrite',source_conflict)

            def unrelated_presentation():
                mount();origin();drag();added()
                page.evaluate('''() => {const remove=roamAlphaAPI.data.block.delete;roamAlphaAPI.data.block.delete=async args=>{await remove(args);deskHarness.api.setOpen('other-plan',false);};}''')
                card('ref-outside-source').get_by_role('button',name='Remove from Desk',exact=True).evaluate('el=>el.click()')
                expect(card('ref-outside-source')).to_have_count(0)
                expect(page.locator('.nautilus-desk__drop-status')).to_have_text('Local reference removed. Source unchanged.')
                origin(('rm-embed-container',),uid='another-source');drag(uid='another-source');added('another-source')
                assert page.evaluate('deskHarness.api.stats.writes.map(row=>row.type)')==['create','delete','create']
            check('unrelated-presentation-change-does-not-poison-later-imports',unrelated_presentation)

            failures=[case for case in cases if case['status']!='passed']
            report={'status':'failed' if failures or errors or requests else 'passed','cases':cases,'pageErrors':errors,'httpRequests':requests,
              'limitation':'Synthetic native-shaped DOM/payload and public graph adapters. No claim of a reproduced installed-host trigger or physical OS drag.'}
            (OUT/'results.json').write_text(json.dumps(report,indent=2)+'\n')
            assert not failures and not errors and not requests, report
            print(f'PASSED: {len(cases)} native-origin and removal/import recovery cases; {OUT}')
        finally:
            browser.close()


if __name__ == '__main__':
    run()
