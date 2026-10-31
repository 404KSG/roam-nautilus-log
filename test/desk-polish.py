#!/usr/bin/env python3
"""Full preview, toolbar alignment and wheel response on an isolated graph."""
import importlib.util
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
ROOT=Path(__file__).resolve().parents[1]
OUT=Path(os.environ.get('DESK_POLISH_TEST_OUT','/tmp/nautilus-desk-polish'))


def run():
    spec=importlib.util.spec_from_file_location('desk_fixture',ROOT/'test/desk-view.py')
    fixture=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixture);fixture.OUT=OUT;fixture.bundle()
    results=[]
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True)
        try:
            page=browser.new_page(viewport={'width':1280,'height':1000})
            page.goto((OUT/'index.html').as_uri());page.wait_for_function('()=>deskHarness?.mount')
            errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
            def mount():
                page.evaluate('()=>deskHarness.mount({count:6})')
                page.get_by_role('button',name='Open Desk',exact=True).click()
                page.evaluate('async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));}')
            def opened(uid='task-2'):
                page.locator(f'[data-task-uid="{uid}"] .rm-desk-tile__preview').click()
                page.wait_for_function('(uid)=>document.querySelector(".nautilus-desk__native")?.dataset.taskUid===uid',arg=uid)
                expect(page.locator('.nautilus-desk__focus-body > [role="status"]')).to_be_hidden()
            def wheel(**data):
                return page.locator('.nautilus-desk__focus-body').evaluate('''(el,data)=>{
                  const {momentum,...init}=data;
                  const event=new WheelEvent('wheel',{bubbles:true,cancelable:true,...init});
                  if(momentum!==undefined) Object.defineProperty(event,'momentum',{value:momentum});
                  el.dispatchEvent(event);return event.defaultPrevented;
                }''',data)
            def uid(): return page.locator('.nautilus-desk__native').get_attribute('data-task-uid')
            def compact():
                mount()
                before=page.evaluate('()=>deskHarness.api.children("task-0").map(r=>({uid:r.uid,string:r.string,open:r.open}))')
                rows=page.locator('[data-task-uid="task-0"] .rm-desk-tile__row')
                expect(rows).to_have_count(11)
                expect(page.locator('[data-task-uid="task-0"] .rm-desk-tile__more')).to_have_text('...')
                opened('task-0')
                expect(page.locator('.nautilus-desk__native textarea')).to_have_count(21)
                assert page.evaluate('()=>deskHarness.api.children("task-0").map(r=>({uid:r.uid,string:r.string,open:r.open}))')==before
                assert page.evaluate('()=>deskHarness.api.stats.writes.length+deskHarness.api.stats.nativeWrites.length')==0
                page.locator('.rm-desk__side--end').get_by_role('button',name='Close',exact=True).click()
                # Search still reaches direct content beyond the rendered budget.
                page.get_by_role('textbox',name='Search Desk',exact=True).fill('第 19 轮')
                expect(page.locator('[data-task-uid="task-0"]')).to_be_visible()
                page.screenshot(path=str(OUT/'compact-preview.png'))
                return {'rows':11,'fullEditorRows':21,'sourceUnchanged':True}
            def toolbar():
                mount();measurements=[]
                def inspect(scope,width):
                    root=page.locator(scope)
                    m=root.evaluate('''root=>{
                      const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,cy:r.y+r.height/2,right:r.right};};
                      const bar=root.querySelector('.rm-desk-page__toolbar'),plus=root.querySelector('[aria-label="New note"]'),search=root.querySelector('[aria-label="Search Desk"]');
                      return {bar:rect(bar),plus:rect(plus),search:rect(search),sameGroup:plus.parentElement===search.parentElement.parentElement,
                        closeCount:bar.querySelectorAll('[aria-label="Hide Desk"],.bp3-icon-cross').length,overflow:bar.scrollWidth-bar.clientWidth};
                    }''')
                    assert m['closeCount']==0 and m['sameGroup'] and abs(m['plus']['cy']-m['search']['cy'])<=0.5,m
                    assert m['overflow']<=1 and m['plus']['w']>=30 and m['plus']['h']>=30,m
                    assert m['plus']['x']>=m['search']['right'],m
                    assert m['bar']['right']-m['plus']['right']<=14,m
                    measurements.append({'width':width,**m})
                    root.get_by_role('textbox',name='Search Desk',exact=True).focus()
                    page.keyboard.press('Tab');expect(root.get_by_role('button',name='New note',exact=True)).to_be_focused()
                    page.keyboard.press('Tab');expect(root.locator('.rm-desk-tile__preview').first).to_be_focused()
                inspect('[data-fixture-host="plan-desk"] .nautilus-desk','wide')
                page.evaluate('()=>deskHarness.api.openCopy()')
                for width in [280,320,360,480,520]:
                    page.locator('[data-fixture-host="copy"]').evaluate('(el,width)=>el.style.width=`${width}px`',width)
                    page.evaluate('()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
                    inspect('[data-fixture-host="copy"] .nautilus-desk',width)
                page.locator('[data-fixture-host="copy"] .rm-desk-page__toolbar').screenshot(path=str(OUT/'toolbar-aligned.png'))
                assert page.evaluate('()=>deskHarness.api.stats.writes.length')==0
                return measurements
            def gestures():
                mount();opened()
                assert wheel(shiftKey=True,deltaY=20,deltaX=0)
                page.evaluate('()=>new Promise(requestAnimationFrame)')
                partial=page.locator('.nautilus-desk__native').evaluate('el=>getComputedStyle(el).transform')
                assert partial!='none',partial
                assert uid()=='task-2'
                assert wheel(shiftKey=True,deltaY=60,deltaX=0)
                page.wait_for_function('document.querySelector(".nautilus-desk__native")?.dataset.taskUid==="task-1"')
                # Preserve native direction and one-step-per-gesture behavior.
                wheel(shiftKey=True,deltaY=120,deltaX=0,momentum=True)
                assert uid()=='task-1'
                wheel(deltaX=-100,deltaY=0,momentum=False)
                page.wait_for_function('document.querySelector(".nautilus-desk__native")?.dataset.taskUid==="task-2"')
                assert not wheel(ctrlKey=True,deltaX=100)
                assert not wheel(deltaX=0,deltaY=100)
                assert uid()=='task-2'
                assert page.evaluate('()=>deskHarness.api.stats.writes.length+deskHarness.api.stats.nativeWrites.length')==0
                # Old shortcuts stay; Opt+arrows are not introduced.
                page.locator('textarea[data-block-uid="task-2"]').focus();page.keyboard.press('Alt+ArrowLeft');assert uid()=='task-2'
                page.keyboard.press('Alt+ArrowRight');assert uid()=='task-2'
                page.keyboard.press('Alt+Comma');page.wait_for_function('document.querySelector(".nautilus-desk__native")?.dataset.taskUid==="task-3"')
                page.keyboard.press('Alt+Period');page.wait_for_function('document.querySelector(".nautilus-desk__native")?.dataset.taskUid==="task-2"')
                # An unfinished swipe must spring back, not leave transformed UI.
                wheel(deltaX=20,deltaY=0)
                page.wait_for_function('getComputedStyle(document.querySelector(".nautilus-desk__native")).transform==="none"',timeout=2000)
                return {'partialTransform':partial,'shiftWheel':True,'keyboardUnchanged':True,'graphWrites':0}
            def gesture_guards():
                mount()
                page.wait_for_function('''()=>[...document.querySelectorAll('.nautilus-desk__card')].every(card=>
                  deskHarness.api.watchSnapshot().some(w=>w.uid===card.dataset.taskUid&&w.state==='active'&&w.pattern==='[:block/string :block/open :block/children]'))''')
                opened()
                # Coalesce a burst into one visual write, with no selection or
                # graph reads/writes while still below the native threshold.
                batch=page.evaluate('''async()=>{
                  const node=document.querySelector('.nautilus-desk__native'),body=node.closest('.nautilus-desk__focus-body');
                  const changes=[];const observer=new MutationObserver(records=>changes.push(...records));
                  observer.observe(node,{attributes:true,attributeFilter:['style']});
                  const reads=deskHarness.api.stats.reads.length;
                  for(let i=0;i<20;i++) body.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaX:1}));
                  await new Promise(requestAnimationFrame);await Promise.resolve();observer.disconnect();
                  return {writes:changes.length,reads:deskHarness.api.stats.reads.length-reads,transform:getComputedStyle(node).transform};
                }''')
                assert batch['writes']<=1 and batch['reads']==0 and batch['transform']!='none',batch
                nested=page.evaluate('''()=>{
                  const scroller=document.createElement('div');scroller.style.cssText='width:80px;overflow-x:auto';
                  const inside=document.createElement('div');inside.style.width='500px';inside.textContent='Wide native content';
                  scroller.append(inside);document.querySelector('.nautilus-desk__focus-body').append(scroller);
                  const event=new WheelEvent('wheel',{bubbles:true,cancelable:true,shiftKey:true,deltaY:100});inside.dispatchEvent(event);
                  scroller.remove();return event.defaultPrevented;
                }''')
                assert not nested and uid()=='task-2'
                editor=page.locator('textarea[data-block-uid="task-2"]')
                editor.dispatch_event('compositionstart')
                assert not wheel(shiftKey=True,deltaY=100) and uid()=='task-2'
                editor.dispatch_event('compositionend')
                page.emulate_media(reduced_motion='reduce')
                wheel(shiftKey=True,deltaY=20)
                page.evaluate('()=>new Promise(requestAnimationFrame)')
                assert page.locator('.nautilus-desk__native').evaluate('el=>getComputedStyle(el).transform')=='none'
                wheel(shiftKey=True,deltaY=60)
                page.wait_for_function('document.querySelector(".nautilus-desk__native")?.dataset.taskUid==="task-1"')
                expect(page.locator('.nautilus-desk__focus-body > [role="status"]')).to_be_hidden()
                assert page.locator('.nautilus-desk__native').evaluate('el=>el.getAnimations().length')==0
                page.emulate_media(reduced_motion='no-preference')
                assert page.evaluate('()=>deskHarness.api.stats.writes.length+deskHarness.api.stats.nativeWrites.length')==0
                return {'batch':batch,'nestedScrollerUntouched':True,'imeUntouched':True,'reducedMotion':True}
            def gesture_lifecycle():
                mount();opened()
                page.evaluate('()=>deskHarness.api.holdNextRender()')
                wheel(shiftKey=True,deltaY=100)
                page.wait_for_function('deskHarness.api.pending()')
                wheel(shiftKey=True,deltaY=100,momentum=True)
                wheel(shiftKey=True,deltaY=20,momentum=False)
                assert uid()=='task-1'
                page.evaluate('()=>deskHarness.api.setCollapsed("plan-desk",true)')
                expect(page.locator('.nautilus-desk__focus-layer')).to_have_count(0)
                page.evaluate('()=>deskHarness.api.release()')
                page.wait_for_function('!deskHarness.api.pending() && deskHarness.api.activeEditors()===0')
                assert page.evaluate('()=>deskHarness.api.stats.renders.length')==2
                assert page.evaluate('()=>deskHarness.api.stats.writes.length+deskHarness.api.stats.nativeWrites.length')==0
                # Explicitly invoke cancelled frame callbacks after destruction;
                # generation ownership must prevent a stale transform write.
                mount();opened()
                late=page.evaluate('''async()=>{
                  const request=window.requestAnimationFrame,cancel=window.cancelAnimationFrame;
                  const held=[];let serial=1000000;
                  window.requestAnimationFrame=fn=>{held.push(fn);return ++serial};window.cancelAnimationFrame=()=>{};
                  const node=document.querySelector('.nautilus-desk__native');
                  node.closest('.nautilus-desk__focus-body').dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaX:20}));
                  window.requestAnimationFrame=request;window.cancelAnimationFrame=cancel;
                  deskHarness.destroy();await Promise.resolve();
                  const changes=[];const observer=new MutationObserver(records=>changes.push(...records));
                  observer.observe(node,{attributes:true,attributeFilter:['style']});
                  for(const fn of held) fn(performance.now());await Promise.resolve();observer.disconnect();
                  return {held:held.length,lateMutations:changes.length,connected:node.isConnected,transform:node.style.transform};
                }''')
                assert late['held']>=1 and late['lateMutations']==0 and not late['connected'] and not late['transform'],late
                return {'heldEditorCleaned':True,'lateFrames':late}
            for name,fn in [('compact',compact),('toolbar',toolbar),('gestures',gestures),('gesture-guards',gesture_guards),('gesture-lifecycle',gesture_lifecycle)]:
                try:results.append({'name':name,'status':'passed','evidence':fn()})
                except Exception as error:results.append({'name':name,'status':'failed','error':str(error)})
            report={'cases':results,'pageerrors':errors,'limitation':'Synthetic graph/editor and isolated browser; no live Desktop or clipboard actions.'}
            (OUT/'results.json').write_text(json.dumps(report,indent=2)+'\n')
            for row in results:print(row['name'],row['status'],row.get('error',''))
            assert all(row['status']=='passed' for row in results) and not errors,report
            print(f'PASSED: Desk full previews, aligned controls and wheel response; artifacts: {OUT}')
        finally:browser.close()


if __name__=='__main__':run()
