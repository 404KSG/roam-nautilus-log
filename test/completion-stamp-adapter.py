#!/usr/bin/env python3
"""Production gesture adapter/writer with trusted browser input and a fake graph.
The host commits raw text and renders a separate native-shaped DOM. No live graph.
"""
import json, os, subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
ROOT=Path(__file__).resolve().parents[1]
BASE=Path(os.environ.get('NAUTILUS_STAMP_OUT','/tmp/nautilus-completion-stamp-verify'))
OUT=BASE;suffix=1
while OUT.exists():
    OUT=BASE.with_name(BASE.name+'-'+str(suffix));suffix+=1


def main():
    OUT.mkdir(parents=True)
    subprocess.run(['node',str(ROOT/'test/completion-stamp-bundle.cjs'),str(OUT)],cwd=ROOT,check=True)
    (OUT/'index.html').write_text('''<!doctype html><html><body><div class="roam-body"><main id="main"></main><aside id="right-sidebar"></aside></div>
<button id="selection-focus">Selection focus</button><script src="harness.js"></script></body></html>''')
    result={'checks':[],'pageErrors':[],'httpRequests':[]}
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True)
        try:
            page=browser.new_page(viewport={'width':1200,'height':1000})
            page.set_default_timeout(5000)
            page.on('pageerror',lambda e:result['pageErrors'].append(str(e)))
            page.on('request',lambda r:result['httpRequests'].append(r.url) if r.url.startswith(('http:','https:')) else None)
            page.goto((OUT/'index.html').as_uri());page.wait_for_function('completionStampHarness')
            def text(uid):return page.evaluate('(uid)=>completionStampHarness.blocks.get(uid)',uid)
            def complete(uid,scope=''):
                page.locator(f'{scope} input[data-checkbox-uid="{uid}"]').first.click()
            def stamped(uid,token='d10:31'):
                page.wait_for_function('([uid,token])=>completionStampHarness.blocks.get(uid)?.endsWith(" "+token)',arg=[uid,token])
            def drained():page.wait_for_function('completionStampHarness.watchCount()===0')

            page.evaluate("()=>completionStampHarness.block('#main','off-start','{{[[TODO]]}} Initially disabled')")
            complete('off-start');page.wait_for_function('completionStampHarness.blocks.get("off-start").includes("DONE")')
            assert text('off-start')=='{{[[DONE]]}} Initially disabled'
            assert page.evaluate('completionStampHarness.stampUpdates.length')==0
            page.evaluate('''()=>{const h=completionStampHarness;h.setEnabled(true);
                h.block('#main','main-0001','{{[[TODO]]}} Main task 30m');
                h.block('#right-sidebar','side-0001','{{[[TODO]]}} Sidebar task 15m');
                const desk=document.createElement('div');desk.id='desk';desk.className='nautilus-desk__focus-layer';document.body.append(desk);
                h.block('#desk','desk-0001','{{[[TODO]]}} Focus task 30m');
                h.nested('#desk','parent001','child-001');
                h.reference('#desk','wrap-0001','src--0001');
                h.reference('#desk','wrap-0002','src--0002',true);
            }''')
            assert not page.locator('[id$="main-0001"]').first.inner_text().startswith('{{'), 'rendered text must not masquerade as raw editor input'
            for uid in ['main-0001','side-0001','desk-0001','child-001']:
                complete(uid);stamped(uid)
            assert text('parent001')=='{{[[TODO]]}} Parent task'
            result['checks'].append('default-off and later main/sidebar/body portal/nested child trusted clicks')

            complete('src--0001');stamped('src--0001')
            assert text('wrap-0001')=='((src--0001))'
            complete('wrap-0002');stamped('wrap-0002')
            assert text('src--0002')=='{{[[TODO]]}} Reusable source 30m'
            assert page.locator('[id$="wrap-0001"] .rm-block-ref [id^="block-input-"]').count()==0
            result['checks'].append('inline data-uid source without an invented source editor; explicit outer marker and child ownership')

            page.evaluate("()=>completionStampHarness.block('#right-sidebar','main-0001','must not replace graph text')")
            complete('main-0001','#right-sidebar')
            page.wait_for_function('completionStampHarness.blocks.get("main-0001")==="{{[[TODO]]}} Main task 30m"')
            page.evaluate('()=>completionStampHarness.setMinute(37)')
            complete('main-0001','#main');stamped('main-0001','d10:37')
            assert text('main-0001').count(' d')==1
            result['checks'].append('multiple views share one owned stamp; reopen removes it and recompletion uses a new minute')

            for uid,chord in [('rapid0001','Meta+Enter'),('rapid0002','Control+Enter')]:
                page.evaluate('''uid=>{const h=completionStampHarness;h.blocks.set('draftsrc1','Reusable plain source 30m');
                    h.block('#desk',uid,'((draftsrc1))');h.edit(uid)}''',uid)
                field=page.locator(f'textarea[id$="{uid}"]')
                field.press(chord);field.press(chord)
                assert text(uid)=='((draftsrc1))', 'the native editor has not saved its new marker yet'
                assert field.input_value()=='{{[[DONE]]}} ((draftsrc1))'
                assert page.evaluate('uid=>completionStampHarness.stampUpdates.filter(x=>x.uid===uid).length',uid)==0
                stamped(uid,'d10:37')
                assert text('draftsrc1')=='Reusable plain source 30m'
                assert page.evaluate('uid=>completionStampHarness.stampUpdates.filter(x=>x.uid===uid).length',uid)==1
            result['checks'].append('both native keyboard shortcuts complete an unsaved TODO in Desk after the debounced graph save, with one wrapper stamp and no source edit')

            for uid,chord in [('keybd-001','Control+Enter'),('keybd-002','Meta+Enter')]:
                page.evaluate('(uid)=>{const h=completionStampHarness;h.block("#main",uid,"{{[[TODO]]}} Keyboard task");h.edit(uid)}',uid)
                page.locator(f'textarea[id$="{uid}"]').press(chord);stamped(uid,'d10:37')
            page.evaluate('''()=>{const h=completionStampHarness;h.block('#main','buffer001','{{[[TODO]]}} Old graph text');h.edit('buffer001','{{[[TODO]]}} New uncommitted text');h.setBufferDelay(90)}''')
            page.locator('textarea[id$="buffer001"]').press('Control+Enter');stamped('buffer001','d10:37')
            assert text('buffer001')=='{{[[DONE]]}} New uncommitted text d10:37'
            page.evaluate('()=>completionStampHarness.setBufferDelay(0)')
            result['checks'].append('trusted Cmd/Ctrl+Enter waits for the native raw-buffer commit and keeps current text')

            page.evaluate('''()=>{const h=completionStampHarness;
                h.blocks.set('edit-src1','Editorial fixture 20m');
                h.block('#main','settle001','{{[[TODO]]}} ((edit-src1))');h.edit('settle001');
                h.block('#desk','settle001','same block, second view');h.setBufferDelay(550)}''')
            complete('settle001','#desk');stamped('settle001','d10:37')
            assert text('settle001')=='{{[[DONE]]}} ((edit-src1)) d10:37'
            assert text('edit-src1')=='Editorial fixture 20m'
            assert page.evaluate('completionStampHarness.stampUpdates.filter(x=>x.uid==="settle001").length')==1
            page.evaluate('()=>completionStampHarness.setBufferDelay(0)')
            complete('settle001','#desk')
            page.wait_for_function('completionStampHarness.blocks.get("settle001")==="{{[[TODO]]}} ((edit-src1))"')
            result['checks'].append('first Desk click stamps an outer wrapper after a 550ms editor redraw without changing its referenced source')

            page.evaluate('''()=>{const h=completionStampHarness;h.block('#desk','cold00001','{{[[TODO]]}} Cold native commit');h.setNativeDelay(900)}''')
            complete('cold00001','#desk');stamped('cold00001','d10:37')
            assert page.evaluate('completionStampHarness.stampUpdates.filter(x=>x.uid==="cold00001").length')==1
            page.evaluate('()=>completionStampHarness.setNativeDelay(0)')
            result['checks'].append('a 900ms native commit is handled by the first trusted gesture')

            page.evaluate('''()=>{const h=completionStampHarness;h.block('#desk','slow00001','{{[[TODO]]}} Slow stamp response');h.setStampDelay(1000)}''')
            complete('slow00001','#desk');stamped('slow00001','d10:37')
            page.wait_for_function('completionStampHarness.hasReceipt("slow00001")')
            complete('slow00001','#desk')
            page.wait_for_function('completionStampHarness.blocks.get("slow00001")==="{{[[TODO]]}} Slow stamp response"')
            assert not page.evaluate('completionStampHarness.hasReceipt("slow00001")')
            page.evaluate('()=>completionStampHarness.setStampDelay(0)')
            result['checks'].append('an issued 1000ms write retains ownership and reopening removes only its verified suffix')

            page.evaluate('''()=>{const h=completionStampHarness;h.block('#desk','expire001','{{[[TODO]]}} Beyond observation budget');h.setNativeDelay(2700)}''')
            notices_before=page.evaluate('completionStampHarness.notices.length')
            complete('expire001','#desk')
            page.wait_for_function('completionStampHarness.blocks.get("expire001").includes("DONE")')
            drained();assert text('expire001')=='{{[[DONE]]}} Beyond observation budget'
            assert page.evaluate('completionStampHarness.stampUpdates.filter(x=>x.uid==="expire001").length')==0
            assert page.evaluate('(n)=>completionStampHarness.notices.slice(n).some(x=>x.includes("in time"))',notices_before)
            page.evaluate('()=>completionStampHarness.setNativeDelay(0)')
            result['checks'].append('a change beyond the bounded observation window remains unstamped with a visible timeout, never passive backfill')

            page.evaluate('''()=>{const h=completionStampHarness;h.block('#main','ime--0001','{{[[TODO]]}} IME task');h.edit('ime--0001')}''')
            field=page.locator('textarea[id$="ime--0001"]')
            field.dispatch_event('compositionstart');field.press('Control+Enter')
            assert text('ime--0001')=='{{[[TODO]]}} IME task'
            field.dispatch_event('compositionend');field.press('Control+Enter');stamped('ime--0001','d10:37')
            result['checks'].append('modeled composition blocks writes until the native editor ends composition')

            page.evaluate('''()=>{const h=completionStampHarness;h.block('#main','multi0001','{{[[TODO]]}} Multi one');h.block('#main','multi0002','{{[[TODO]]}} Multi two');h.setMinute(42);h.select(['multi0001','multi0002'])}''')
            page.keyboard.press('Control+Enter')
            stamped('multi0001','d10:42');stamped('multi0002','d10:42')
            assert all(not row['defaultPrevented'] for row in page.evaluate('completionStampHarness.keys'))
            page.evaluate('()=>completionStampHarness.select([])')
            result['checks'].append('bounded native multi-selection uses one instant and leaves keyboard events available to the host')

            page.evaluate('''()=>{const h=completionStampHarness;h.block('#main','manual001','{{[[TODO]]}} Manual d09:05');h.block('#desk','passive01','{{[[DONE]]}} Existing done');h.passive('passive01','{{[[DONE]]}} Synced done')}''')
            complete('manual001');page.wait_for_function('completionStampHarness.blocks.get("manual001").includes("DONE")')
            drained();assert text('manual001')=='{{[[DONE]]}} Manual d09:05'
            complete('manual001');page.wait_for_function('completionStampHarness.blocks.get("manual001").includes("TODO")')
            drained();assert text('manual001')=='{{[[TODO]]}} Manual d09:05'
            assert text('passive01')=='{{[[DONE]]}} Synced done'
            result['checks'].append('legacy/manual fields and passive/previously completed data are never adopted or backfilled')

            page.evaluate('''()=>{window.roamjs={loaded:new Set(['todo-trigger'])};completionStampHarness.block('#desk','conflict1','{{[[TODO]]}} Conflict task')}''')
            count=page.evaluate('completionStampHarness.stampUpdates.length')
            complete('conflict1');page.wait_for_function('completionStampHarness.blocks.get("conflict1").includes("DONE")')
            assert text('conflict1')=='{{[[DONE]]}} Conflict task'
            assert page.evaluate('completionStampHarness.stampUpdates.length')==count
            assert any('Todo Trigger' in n for n in page.evaluate('completionStampHarness.notices'))
            page.evaluate('()=>roamjs.loaded.clear()')
            result['checks'].append('known competing timestamp writer pauses optional suffixes visibly')

            page.evaluate('''()=>{const h=completionStampHarness;h.block('#main','late--001','{{[[TODO]]}} Delayed native task');h.setNativeDelay(200)}''')
            complete('late--001')
            page.evaluate('()=>{completionStampHarness.setEnabled(false);completionStampHarness.setEnabled(true)}')
            page.wait_for_function('completionStampHarness.blocks.get("late--001").includes("DONE")')
            assert text('late--001')=='{{[[DONE]]}} Delayed native task'
            page.evaluate('()=>completionStampHarness.setNativeDelay(0)')
            result['checks'].append('disable-enable does not revive an old native action')

            page.locator('#selection-focus').focus();page.keyboard.press('Control+z')
            page.evaluate('()=>completionStampHarness.passive("main-0001","{{[[DONE]]}} Main task 30m")')
            page.keyboard.press('Control+y')
            page.wait_for_timeout(800)
            assert text('main-0001')=='{{[[DONE]]}} Main task 30m'
            assert all(not row['defaultPrevented'] for row in page.evaluate('completionStampHarness.keys'))
            result['checks'].append('Undo/Redo events are untouched and passive host undo changes are not restamped; no atomic-undo claim')

            page.evaluate("()=>completionStampHarness.block('#main','direct001','{{[[TODO]]}} Direct task')")
            before=page.evaluate('completionStampHarness.stampUpdates.length')
            page.evaluate('()=>completionStampHarness.direct("direct001")')
            assert text('direct001')=='{{[[DONE]]}} Direct task d10:42'
            assert page.evaluate('completionStampHarness.stampUpdates.length')==before+1
            page.evaluate('()=>completionStampHarness.destroy()');drained()
            page.evaluate("()=>completionStampHarness.block('#desk','after--01','{{[[TODO]]}} After unload')")
            complete('after--01');page.wait_for_function('completionStampHarness.blocks.get("after--01").includes("DONE")')
            assert text('after--01')=='{{[[DONE]]}} After unload'
            result['checks'].append('direct marker+stamp is one update; unload leaves later native actions unstamped')
            result['stampWrites']=page.evaluate('completionStampHarness.stampUpdates')
            result['nativeWrites']=page.evaluate('completionStampHarness.nativeUpdates.length')
            result['realGraphWrites']=0
            assert not result['pageErrors'] and not result['httpRequests'],result
            result['result']='PASS'
            result['limitation']='Synthetic native-shaped DOM and low-level graph; not live Roam/OS IME or atomic native Undo certification.'
            (OUT/'result.json').write_text(json.dumps(result,indent=2))
        except Exception as error:
            result['result']='FAIL';result['error']=str(error)
            if 'page' in locals():
                result['notices']=page.evaluate('completionStampHarness.notices')
                result['stampWrites']=page.evaluate('completionStampHarness.stampUpdates')
                page.screenshot(path=str(OUT/'failure.png'))
            (OUT/'result.json').write_text(json.dumps(result,indent=2));raise
        finally:browser.close()
    print(json.dumps({'result':result['result'],'checks':len(result['checks']),'artifactDirectory':str(OUT),'pageErrors':result['pageErrors'],'httpRequests':result['httpRequests']}))

if __name__=='__main__':main()
