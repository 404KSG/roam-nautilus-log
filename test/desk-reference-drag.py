#!/usr/bin/env python3
"""Reference-block bullet imports through production actions/editor/preview seams.
Native reference-text drag is not inferred from a hand-authored payload.
"""
import importlib.util
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ.get('DESK_REFERENCE_DRAG_OUT', '/tmp/nautilus-desk-reference-drag'))
LEAF = 'reference-leaf'
ENTRY = 'ref-reference-leaf'

DROP = '''({uid, selector, target}) => {
  const source=document.querySelector(selector),dest=document.querySelector(target);
  const fields={'roam/block-uid-list-only-parents':uid,'roam/block-uid-list':uid,
    'roam/roam-uri-list':`https://roamresearch.com/#/app/desk-fixture/page/${uid}`};
  let readable=true;
  const data={types:Object.keys(fields),files:{length:0},effectAllowed:'copy',dropEffect:'none',getData:t=>readable?fields[t]||'':''};
  const fire=(node,type)=>{const r=dest.getBoundingClientRect(),event=new Event(type,{bubbles:true,cancelable:true});
    Object.defineProperties(event,{dataTransfer:{value:data},clientX:{value:r.x+2},clientY:{value:r.y+2}});node.dispatchEvent(event);};
  fire(source,'dragstart');fire(dest,'dragover');fire(dest,'drop');readable=false;fire(source,'dragend');
}'''


def run():
    spec=importlib.util.spec_from_file_location('desk_fixture',ROOT/'test/desk-view.py')
    fixture=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixture);fixture.OUT=OUT;fixture.bundle()
    cases=[]
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True)
        try:
            page=browser.new_page(viewport={'width':1280,'height':1000})
            errors=[];requests=[]
            page.on('pageerror',lambda error:errors.append(str(error)))
            page.on('request',lambda request:requests.append(request.url) if request.url.startswith(('http://','https://')) else None)
            page.goto((OUT/'index.html').as_uri());page.wait_for_function('()=>Boolean(window.deskHarness?.mount)')

            def settle():
                page.evaluate('async()=>{await document.fonts.ready;for(let i=0;i<3;i++)await new Promise(r=>requestAnimationFrame(r));}')

            def mount(text='((outside-source))', nested='{{[[TODO]]}} Nested source 20m', middle='((outside-source))', depth=None, source_clock=False):
                page.evaluate('''({text,nested,middle,depth,sourceClock})=>{
                  deskHarness.mount({count:3});deskHarness.api.setString('outside-source',nested);
                  for(const [uid,string] of [['reference-middle',middle],['reference-leaf',text],['another-source','{{[[TODO]]}} Another source 25m']]){
                    deskHarness.api.addBlock(uid,string,'outside-parent');deskHarness.api.setPage(uid,'external-page');
                  }
                  if(depth){for(let i=1;i<depth;i++){const uid=`depth-${String(i).padStart(2,'0')}`,string=i===depth-1?'{{[[TODO]]}} Depth leaf 20m':`((depth-${String(i+1).padStart(2,'0')}))`;
                    deskHarness.api.addBlock(uid,string,'outside-parent');deskHarness.api.setPage(uid,'external-page');}}
                  if(sourceClock){deskHarness.api.addChild('source-clock','reference-leaf','CLOCK: [2026-10-26 08:00]--[2026-10-26 08:05]',false);deskHarness.api.setPage('source-clock','external-page');}
                  const root=document.querySelector('#fixture-external-outline');root.className='roam-article rm-reference-container';
                  const owner=root.querySelector('[data-block-uid]');owner.dataset.blockUid='reference-leaf';owner.className='roam-block-container';
                  const ref=document.createElement('span');ref.className='rm-block-ref';ref.dataset.uid='outside-source';ref.textContent='Rendered reference';owner.append(ref);
                }''',{'text':text,'nested':nested,'middle':middle,'depth':depth,'sourceClock':source_clock})
                page.get_by_role('button',name='Open Desk',exact=True).click()
                expect(page.locator('.nautilus-desk')).to_have_attribute('data-status','ready');settle()

            def card():
                return page.locator(f'.nautilus-desk__card[data-task-uid="{ENTRY}"]')

            def drag(target='.nautilus-desk__grid', inline=False):
                page.evaluate(DROP,{'uid':'outside-source' if inline else LEAF,
                    'selector':'#fixture-external-outline .rm-block-ref' if inline else '#fixture-external-outline .rm-bullet','target':target})
                page.wait_for_function('()=>deskHarness.api.stats.referenceRequests.every(row=>row.state!=="pending")');settle()

            def snapshots():
                return page.evaluate('()=>["reference-leaf","reference-middle","outside-source","another-source"].map(uid=>deskHarness.api.sourceSnapshot(uid))')

            def check(name, action):
                try:
                    action();cases.append({'case':name,'status':'passed'})
                except Exception as error:
                    cases.append({'case':name,'status':'failed','error':str(error)})
                    page.screenshot(path=str(OUT/f'failure-{len(cases):02d}.png'))
                (OUT/'results.json').write_text(json.dumps({'cases':cases,'pageErrors':errors,'httpRequests':requests},indent=2)+'\n')

            positives=[
                ('pure-reference','((outside-source))','{{[[TODO]]}} Nested source 20m',None),
                ('two-hop-reference','((reference-middle))','{{[[TODO]]}} Nested source 20m',None),
                ('local-TODO-reference','{{[[TODO]]}} ((outside-source)) 30m','{{[[TODO]]}} Nested source 20m',None),
                ('local-TODO-over-DONE','{{[[TODO]]}} ((outside-source)) 30m','{{[[DONE]]}} Nested source 20m',None),
                ('contextual-reference','Review ((outside-source)) 10m','{{[[TODO]]}} Nested source 20m',None),
                ('multiple-readable-references','Review ((outside-source)) and ((another-source)) 30m','{{[[TODO]]}} Nested source 20m',None),
                ('local-prose-with-known-empty-reference','Review ((outside-source)) 10m','',None),
                ('eight-lookup-levels','((depth-01))','{{[[TODO]]}} Nested source 20m',8),
            ]
            for name,text,nested,depth in positives:
                def positive(text=text,nested=nested,depth=depth):
                    mount(text,nested,depth=depth);before=snapshots();drag();expect(card()).to_be_visible()
                    assert page.evaluate('deskHarness.api.text("ref-reference-leaf")')=='{{embed-path: ((reference-leaf)) closed}}'
                    assert page.evaluate('deskHarness.api.stats.writes.length')==1
                    assert snapshots()==before
                    card().locator('.rm-desk-tile__preview').click()
                    expect(page.locator('.nautilus-desk__native')).to_have_attribute('data-task-uid',ENTRY)
                    expect(page.locator('.nautilus-desk__native')).to_have_attribute('data-editor-uid',LEAF)
                    assert page.locator('.nautilus-desk__native textarea[data-block-uid="reference-leaf"]').input_value()==text
                    page.locator('.rm-desk__side--end').get_by_role('button',name='Close',exact=True).click()
                    assert snapshots()==before and page.evaluate('deskHarness.api.stats.nativeWrites.length')==0
                check(name,positive)

            negatives=[
                ('inherited-DONE','((outside-source))','{{[[DONE]]}} Completed source','((outside-source))',None),
                ('local-DONE','{{[[DONE]]}} ((outside-source))','{{[[TODO]]}} Open source','((outside-source))',None),
                ('missing-dependency','Task ((missing-source))','{{[[TODO]]}} Open source','((outside-source))',None),
                ('self-cycle','Task ((reference-leaf))','{{[[TODO]]}} Open source','((outside-source))',None),
                ('nested-cycle','Task ((reference-middle))','{{[[TODO]]}} Open source','((reference-leaf))',None),
                ('plan-reference-cycle','Task ((plan-desk))','{{[[TODO]]}} Open source','((outside-source))',None),
                ('unsupported-dependency','((outside-source))','{{[[query]]: {and: [[TODO]]}}}','((outside-source))',None),
                ('inherited-fixed-event','((outside-source))','09:00-10:00 Fixed event','((outside-source))',None),
                ('excessive-depth','((depth-01))','{{[[TODO]]}} Open source','((outside-source))',9),
            ]
            for name,text,nested,middle,depth in negatives:
                def negative(text=text,nested=nested,middle=middle,depth=depth):
                    mount(text,nested,middle,depth);before=snapshots();drag();expect(card()).to_have_count(0)
                    assert page.evaluate('deskHarness.api.stats.writes.length')==0 and snapshots()==before
                check(name,negative)

            def inline_not_assumed():
                mount();before=snapshots();drag(inline=True)
                assert page.evaluate('deskHarness.api.stats.writes.length')==0 and snapshots()==before
                assert page.evaluate('deskHarness.api.stats.referenceRequests.length')==0
            check('reference-text-is-not-manufactured-into-a-native-drag',inline_not_assumed)

            def source_clock_not_copied():
                mount(source_clock=True);before=snapshots();drag();expect(card()).to_be_visible()
                assert page.evaluate('deskHarness.api.children("ref-reference-leaf").length')==0
                assert page.evaluate('deskHarness.api.text("source-clock")')=='CLOCK: [2026-10-26 08:00]--[2026-10-26 08:05]'
                assert snapshots()==before
            check('referenced-CLOCK-remains-source-content-not-entry-Actual',source_clock_not_copied)

            def duplicate_moves_wrapper_only():
                mount();before=snapshots();drag();expect(card()).to_be_visible()
                drag('[data-task-uid="task-0"]')
                page.wait_for_function('deskHarness.api.children("plan-desk")[0].uid==="ref-reference-leaf"')
                assert page.evaluate('deskHarness.api.stats.writes.map(row=>row.type)')==['create','move']
                assert snapshots()==before
            check('positioned-duplicate-revalidates-and-moves-only-its-wrapper',duplicate_moves_wrapper_only)

            def change_before_duplicate_move():
                mount();drag();expect(card()).to_be_visible()
                page.evaluate('''()=>{const pull=roamAlphaAPI.data.pull;window.referenceOriginalPull=pull;let changed=false;
                  roamAlphaAPI.data.pull=(pattern,lookup)=>{if(!changed&&deskHarness.api.stats.referenceRequests.at(-1)?.status==='existing-reference'){
                    changed=true;deskHarness.api.setString('outside-source','{{[[TODO]]}} Dependency changed before move 20m');}return pull(pattern,lookup);};}''')
                drag('[data-task-uid="task-0"]')
                expect(page.locator('.nautilus-desk__drop-status')).to_contain_text('source changed')
                assert page.evaluate('deskHarness.api.stats.writes.map(row=>row.type)')==['create']
                page.evaluate('()=>{roamAlphaAPI.data.pull=referenceOriginalPull;}')
                drag('[data-task-uid="task-0"]')
                page.wait_for_function('deskHarness.api.children("plan-desk")[0].uid==="ref-reference-leaf"')
                assert page.evaluate('deskHarness.api.stats.writes.map(row=>row.type)')==['create','move']
            check('nested-change-before-duplicate-move-rejects-without-moving',change_before_duplicate_move)

            def change_after_duplicate_move():
                mount();drag();expect(card()).to_be_visible()
                page.evaluate('''()=>{const move=roamAlphaAPI.data.block.move;roamAlphaAPI.data.block.move=async args=>{
                  await move(args);deskHarness.api.setString('outside-source','{{[[TODO]]}} Dependency changed after move 20m');};}''')
                drag('[data-task-uid="task-0"]')
                expect(page.locator('.nautilus-desk__drop-status')).to_contain_text('Could not confirm the existing note')
                assert page.evaluate('deskHarness.api.stats.writes.map(row=>row.type)')==['create','move']
                assert page.evaluate('deskHarness.api.children("plan-desk")[0].uid')==ENTRY
            check('nested-change-after-move-warns-without-a-second-move',change_after_duplicate_move)

            def change_after_create():
                mount()
                page.evaluate('''()=>{const create=roamAlphaAPI.data.block.create;roamAlphaAPI.data.block.create=async args=>{
                  await create(args);deskHarness.api.setString('outside-source','{{[[TODO]]}} Dependency changed after create 20m');};}''')
                drag();expect(page.locator('.nautilus-desk__drop-status')).to_contain_text('Could not confirm the reference')
                assert page.evaluate('deskHarness.api.stats.writes.length')==1
                assert page.evaluate('deskHarness.api.text("ref-reference-leaf")')=='{{embed-path: ((reference-leaf)) closed}}'
                drag();expect(page.locator('.nautilus-desk__drop-status')).to_contain_text('Already in this plan.')
                assert page.evaluate('deskHarness.api.stats.writes.length')==1
            check('nested-change-after-create-does-not-claim-success-or-create-twice',change_after_create)

            failures=[case for case in cases if case['status']!='passed']
            report={'status':'failed' if failures or errors or requests else 'passed','cases':cases,'pageErrors':errors,'httpRequests':requests,
                'limitation':'Synthetic native-bullet/public-adapter and stand-in native editor tests; not a live-host gesture capture or certification of inline reference text dragging.'}
            (OUT/'results.json').write_text(json.dumps(report,indent=2)+'\n')
            assert not failures and not errors and not requests,report
            print(f'PASSED: {len(cases)} reference identity/dependency cases; {OUT}')
        finally:
            browser.close()


if __name__ == '__main__':
    run()
