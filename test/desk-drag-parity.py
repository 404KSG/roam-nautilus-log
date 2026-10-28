#!/usr/bin/env python3
"""Current native Desk position/rail contract through production handlers.
All graphs, transfer data and events are synthetic; no live graph or OS drag.
"""
import importlib.util
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ.get('DESK_DRAG_PARITY_TEST_OUT', '/tmp/nautilus-desk-drag-parity'))


def run():
    spec=importlib.util.spec_from_file_location('desk_fixture', ROOT/'test/desk-view.py')
    fixture=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixture);fixture.OUT=OUT;fixture.bundle()
    checks=[]
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True)
        try:
            page=browser.new_page(viewport={'width':1280,'height':1000})
            errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
            page.goto((OUT/'index.html').as_uri());page.wait_for_function('()=>window.deskHarness?.mount')
            def mount(empty=False):
                page.evaluate('''empty=>{
                  deskHarness.mount({empty:true,count:0});
                  if(!empty) for(let i=0;i<12;i++) deskHarness.api.addChild(`parity-${i}`,'plan-desk',`{{[[TODO]]}} ${i%2?'Keep':'Hide'} item ${i}`);
                }''',empty)
                page.get_by_role('button',name='Open Desk',exact=True).click()
                expect(page.locator('.nautilus-desk')).to_have_attribute('data-status','ready')
                page.evaluate('async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));}')
            def card(i): return page.locator(f'[data-task-uid="parity-{i}"]')
            def fire(selector,kind,side='before',external=False,modifier=False):
                return page.evaluate('''({selector,kind,side,external,modifier})=>{
                  const node=document.querySelector(selector),r=node.getBoundingClientRect();
                  if(kind==='dragstart') {
                    const fields=new Map();
                    if(external) {
                      fields.set('roam/block-uid-list-only-parents','outside-source');fields.set('roam/block-uid-list','outside-source');
                      fields.set('roam/roam-uri-list','https://roamresearch.com/#/app/desk-fixture/page/outside-source');
                    }
                    window.parityData={get types(){return [...fields.keys()]},files:{length:0},effectAllowed:'all',dropEffect:'none',
                      setData:(k,v)=>fields.set(k,v),getData:k=>fields.get(k)||'',clearData:()=>fields.clear(),setDragImage:()=>{throw Error('Unexpected custom drag image')}};
                  }
                  const event=new Event(kind,{bubbles:true,cancelable:true});
                  Object.defineProperties(event,{dataTransfer:{value:window.parityData},clientX:{value:side==='before'?r.left+2:r.right-2},
                    clientY:{value:r.top+r.height/2},altKey:{value:modifier}});
                  node.dispatchEvent(event);
                  return {prevented:event.defaultPrevented,types:window.parityData.types,effect:window.parityData.dropEffect};
                }''',{'selector':selector,'kind':kind,'side':side,'external':external,'modifier':modifier})
            def badge(tile):
                return tile.evaluate('''el=>{const s=getComputedStyle(el,'::after');return {content:s.content,background:s.backgroundColor,color:s.color,border:s.borderTopWidth,top:s.top,right:s.right,line:s.lineHeight};}''')
            def rail(tile,kind,number):
                marker=tile.locator(f':scope > .rm-desk-tile__drop--{kind}')
                expect(marker).to_have_count(1);expect(marker.locator('.rm-desk-tile__drop-position')).to_have_text(str(number))
                assert marker.evaluate('el=>getComputedStyle(el).width')=='3px'
                key='insetInlineStart' if kind=='before' else 'insetInlineEnd'
                inset = marker.evaluate('(el,key)=>getComputedStyle(el)[key]',key)
                assert abs(float(inset.removesuffix('px')) + 7.5) < 0.1, {'inset':inset,'kind':kind,'number':number,'styles':marker.evaluate('el=>({class:el.className,direction:getComputedStyle(el).direction,left:getComputedStyle(el).left,right:getComputedStyle(el).right,parent:el.parentElement.dataset.taskUid})')}
                assert badge(tile)['content']=='none'
            mount()
            expect(page.locator('.nautilus-desk__position')).to_have_count(0)
            before=card(0).bounding_box()
            card(0).locator('[role="button"]').focus();page.keyboard.down('Alt');page.wait_for_timeout(450)
            alt=badge(card(0));assert alt['background']=='rgb(19, 124, 189)' and 'counter(' in alt['content'],alt
            assert badge(card(9))['content'] in ['none','normal']
            assert card(0).bounding_box()==before
            page.keyboard.up('Alt')
            # Full-list positions survive filtering; Alt selection remains visible-order.
            page.get_by_role('textbox',name='Search Desk',exact=True).fill('Keep')
            expect(card(1)).to_be_visible()
            assert card(1).get_attribute('data-position')=='2'
            assert card(3).get_attribute('data-position')=='4'
            card(1).locator('[role="button"]').focus();page.keyboard.down('Alt');page.wait_for_timeout(450)
            page.keyboard.press('Digit2');page.keyboard.up('Alt')
            expect(page.locator('.nautilus-desk__native')).to_have_attribute('data-task-uid','parity-3')
            page.locator('.rm-desk__side--end').get_by_role('button',name='Close',exact=True).click()
            assert page.evaluate('()=>deskHarness.api.stats.writes.length')==0
            fire('[data-task-uid="parity-1"]','dragstart')
            assert badge(card(3))['content']=='"4"'
            card(1).locator('[role="button"]').focus();page.keyboard.down('Alt');page.wait_for_timeout(450)
            assert badge(card(3))['content']=='"4"'  # Gray drag wins while Alt is held.
            fire('[data-task-uid="parity-1"]','dragend')
            assert 'counter(' in badge(card(3))['content'] and badge(card(3))['background']=='rgb(19, 124, 189)'
            page.keyboard.up('Alt')
            checks.append('native blue Alt counters use visible order; gray positions retain full collection order')
            page.get_by_role('textbox',name='Search Desk',exact=True).fill('')
            start=fire('[data-task-uid="parity-0"]','dragstart')
            assert start['types']==['application/x-nautilus-desk-task'],start
            assert card(0).evaluate('el=>el.classList.contains("rm-desk-tile--dragging")')
            assert not page.locator('.nautilus-desk__grid').evaluate('el=>el.classList.contains("rm-desk-overview--numbers")')
            gray=badge(card(9));assert gray['content']=='"10"' and gray['background']=='rgb(245, 248, 250)' and gray['color']=='rgb(138, 155, 168)' and gray['line']=='16px',gray
            over=fire('[data-task-uid="parity-3"]','dragover','before');assert over['effect']=='move'
            rail(card(3),'before',3)
            sticky = page.evaluate('''()=>{
              const target=document.querySelector('[data-task-uid="parity-3"]'),grid=document.querySelector('.nautilus-desk__grid');
              const r=target.getBoundingClientRect(),original=target.querySelector('.rm-desk-tile__drop');
              // contains() is inclusive. A bubbling child leave whose related
              // target is the grid must retain the existing insertion marker.
              target.dispatchEvent(new DragEvent('dragleave',{bubbles:true,relatedTarget:grid}));
              const retainedAfterLeave=original.isConnected;
              const event=new Event('dragover',{bubbles:true,cancelable:true});
              Object.defineProperties(event,{dataTransfer:{value:parityData},clientX:{value:r.left-1},clientY:{value:r.top+r.height/2}});
              grid.dispatchEvent(event);
              return {containsSelf:grid.contains(grid),retainedAfterLeave,retainedAfterOver:original===target.querySelector('.rm-desk-tile__drop')};
            }''')
            assert sticky == {'containsSelf':True,'retainedAfterLeave':True,'retainedAfterOver':True},sticky
            rail(card(3),'before',3)  # Complete leave -> gap-over sequence, within native sticky slop.
            fire('[data-task-uid="parity-3"]','dragover','after');rail(card(3),'after',4)
            page.locator('.nautilus-desk__grid').evaluate('el=>el.style.direction="rtl"')
            fire('[data-task-uid="parity-3"]','dragover','before');rail(card(3),'after',4)
            page.locator('.nautilus-desk__grid').evaluate('el=>el.style.direction="ltr"')
            fire('[data-task-uid="parity-0"]','dragover');expect(card(0).locator('.rm-desk-tile__drop')).to_have_count(0)
            fire('[data-task-uid="parity-0"]','dragend')
            expect(page.locator('.rm-desk-tile__drop,.rm-desk-tile--dragging')).to_have_count(0)
            checks.append('native private internal drag, gray badges, source exclusion, horizontal/RTL rails and insertion arithmetic')
            gap_results=[]
            for external in [False,True]:
                mount()
                source_uid='outside-source' if external else 'parity-0'
                source_before=page.evaluate('(uid)=>deskHarness.api.sourceSnapshot(uid)',source_uid)
                fire('#fixture-external-outline .rm-bullet' if external else '[data-task-uid="parity-0"]','dragstart',external=external)
                fire('[data-task-uid="parity-3"]','dragover','before')
                result=page.evaluate('''()=>{
                  const grid=document.querySelector('.nautilus-desk__grid'),target=document.querySelector('[data-task-uid="parity-3"]');
                  const r=target.getBoundingClientRect(),original=target.querySelector('.rm-desk-tile__drop');
                  target.dispatchEvent(new DragEvent('dragleave',{bubbles:true,relatedTarget:grid}));
                  const afterLeave=original.isConnected;
                  const send=type=>{const event=new Event(type,{bubbles:true,cancelable:true});
                    Object.defineProperties(event,{dataTransfer:{value:parityData},clientX:{value:r.left-1},clientY:{value:r.top+r.height/2}});
                    grid.dispatchEvent(event);};
                  send('dragover');
                  const retained=target.querySelector('.rm-desk-tile__drop');
                  const snapshot={containsSelf:grid.contains(grid),afterLeave,sameRail:retained===original,number:retained?.textContent};
                  send('drop');return snapshot;
                }''')
                assert result=={'containsSelf':True,'afterLeave':True,'sameRail':True,'number':'4' if external else '3'},result
                page.wait_for_function('deskHarness.api.stats.writes.length===1')
                inserted='ref-outside-source' if external else 'parity-0'
                page.wait_for_function('(uid)=>{const order=deskHarness.api.children("plan-desk").map(row=>row.uid);return order.indexOf(uid)===order.indexOf("parity-3")-1;}',arg=inserted)
                order=page.evaluate('()=>deskHarness.api.children("plan-desk").map(row=>row.uid)')
                assert order[-1]=='parity-11',order
                assert page.evaluate('(uid)=>deskHarness.api.sourceSnapshot(uid)',source_uid)==source_before
                gap_results.append({'external':external,**result,'order':order})
            # A genuine point outside the previous tile's expanded rectangle
            # must still switch to the collection end, not stick indefinitely.
            mount();fire('[data-task-uid="parity-0"]','dragstart');fire('[data-task-uid="parity-3"]','dragover','before')
            boundary_control=page.evaluate('''()=>{
              const grid=document.querySelector('.nautilus-desk__grid'),target=document.querySelector('[data-task-uid="parity-3"]');
              const g=grid.getBoundingClientRect(),t=target.getBoundingClientRect(),slop=parseFloat(getComputedStyle(grid).columnGap)+4;
              const point={x:g.right-2,y:g.bottom-2};
              target.dispatchEvent(new DragEvent('dragleave',{bubbles:true,relatedTarget:grid}));
              const send=type=>{const e=new Event(type,{bubbles:true,cancelable:true});
                Object.defineProperties(e,{dataTransfer:{value:parityData},clientX:{value:point.x},clientY:{value:point.y}});grid.dispatchEvent(e);};
              send('dragover');
              const marker=grid.querySelector('.rm-desk-tile__drop');
              const result={outsideSlop:point.x<t.left-slop||point.x>t.right+slop||point.y<t.top-slop||point.y>t.bottom+slop,
                targetUid:marker?.parentElement.dataset.taskUid,number:marker?.textContent};
              send('drop');return result;
            }''')
            assert boundary_control=={'outsideSlop':True,'targetUid':'parity-11','number':'12'},boundary_control
            page.wait_for_function('deskHarness.api.children("plan-desk").at(-1).uid==="parity-0"')
            checks.append('bubbling card leave -> grid gap over -> drop keeps the prior slot; only leaving sticky slop switches to full end')
            # Pointer-driven browser events cover the same boundary without
            # prescribing relatedTarget. This is still an isolated fake graph,
            # not an OS/Desktop drag or a live user note.
            mount()
            page.evaluate('''()=>{
              window.pointerTrace=[];
              const grid=document.querySelector('.nautilus-desk__grid');
              for(const type of ['dragleave','dragover','drop']) grid.addEventListener(type,event=>{
                pointerTrace.push({type,trusted:event.isTrusted,targetIsGrid:event.target===grid,
                  relatedIsGrid:event.relatedTarget===grid,containsRelated:grid.contains(event.relatedTarget),
                  targetUid:event.target.closest?.('[data-task-uid]')?.dataset.taskUid||null});
              },true);
            }''')
            source_box=card(0).bounding_box();target_box=card(3).bounding_box()
            try:
                page.mouse.move(source_box['x']+14,source_box['y']+14);page.mouse.down()
                page.mouse.move(source_box['x']+42,source_box['y']+20,steps=8)
                page.wait_for_function('document.querySelector("[data-task-uid=parity-0].rm-desk-tile--dragging")')
                page.mouse.move(target_box['x']+10,target_box['y']+target_box['height']/2,steps=10)
                # Chromium may emit dragenter on the first arrival; a second
                # motion produces dragover before we inspect its insertion UI.
                page.mouse.move(target_box['x']+10,target_box['y']+target_box['height']/2)
                page.wait_for_function('document.querySelector("[data-task-uid=parity-3] > .rm-desk-tile__drop--before")')
                page.mouse.move(target_box['x']-1,target_box['y']+target_box['height']/2,steps=3)
                page.mouse.move(target_box['x']-1,target_box['y']+target_box['height']/2)
                rail(card(3),'before',3)
                page.mouse.up()
                page.wait_for_function('deskHarness.api.stats.writes.length===1')
                pointer_order=page.evaluate('()=>deskHarness.api.children("plan-desk").map(row=>row.uid)')
                assert pointer_order.index('parity-0')==pointer_order.index('parity-3')-1 and pointer_order[-1]=='parity-11',pointer_order
            finally:
                pointer_trace=page.evaluate('()=>window.pointerTrace')
                (OUT/'pointer-gap-events.json').write_text(json.dumps(pointer_trace,indent=2))
            assert any(event['type']=='dragleave' and event['relatedIsGrid'] and event['containsRelated'] and event['trusted'] for event in pointer_trace),pointer_trace
            assert any(event['type']=='drop' and event['targetIsGrid'] and event['trusted'] for event in pointer_trace),pointer_trace
            checks.append('trusted pointer-driven headless drag enters the gap and drops before the intended card rather than at the end')
            # Real guarded outline moves through before AND after, with hidden rows.
            for side in ['before','after']:
                mount();source_before=page.evaluate('()=>deskHarness.api.sourceSnapshot("parity-0")')
                fire('[data-task-uid="parity-0"]','dragstart')
                fire('[data-task-uid="parity-3"]','dragover',side)
                fire('[data-task-uid="parity-3"]','drop',side)
                page.wait_for_function('deskHarness.api.stats.writes.length===1')
                page.wait_for_function('!document.querySelector(".rm-desk-tile--dragging")')
                ordered=page.evaluate('()=>deskHarness.api.children("plan-desk").map(r=>r.uid)')
                assert ordered.index('parity-0')==ordered.index('parity-3')+(-1 if side=='before' else 1),ordered
                assert page.evaluate('()=>deskHarness.api.sourceSnapshot("parity-0")')==source_before
            checks.append('before/after feedback reaches the guarded real-order move without changing source content')
            # Padding means full-collection end, even if search hides that final
            # card. The visual end rail remains on the last visible tile.
            for external in [False,True]:
                mount();page.get_by_role('textbox',name='Search Desk',exact=True).fill('Hide')
                fire('#fixture-external-outline .rm-bullet' if external else '[data-task-uid="parity-0"]','dragstart',external=external)
                fire('.nautilus-desk__grid','dragover','after')
                page.evaluate('''()=>{
                  window.heldRail=document.querySelector('[data-task-uid="parity-10"] .rm-desk-tile__drop');
                  deskHarness.api.setString('parity-6','{{[[TODO]]}} Hide Updated item 6');
                }''')
                page.wait_for_function('document.querySelector("[data-task-uid=parity-6] .rm-desk-tile__title").textContent.includes("Updated")')
                assert page.evaluate('()=>heldRail.isConnected && heldRail===document.querySelector("[data-task-uid=parity-10] .rm-desk-tile__drop")'), 'Ready/preview updates must not remount an unchanged native insertion marker'
                rail(card(10),'after',13 if external else 12)
                fire('.nautilus-desk__grid','drop','after')
                page.wait_for_function('deskHarness.api.stats.writes.length===1 && !deskHarness.api.pending()')
                uid='ref-outside-source' if external else 'parity-0'
                page.wait_for_function('(uid)=>deskHarness.api.children("plan-desk").at(-1).uid===uid',arg=uid)
            # Clearing a hovered target or leaving the surface cannot leave a
            # stale detached marker; the current source can still be cancelled.
            mount();fire('[data-task-uid="parity-0"]','dragstart')
            fire('[data-task-uid="parity-3"]','dragover')
            page.evaluate('''()=>{
              window.oldDropTarget=document.querySelector('[data-task-uid="parity-3"]');
              deskHarness.api.remove('parity-3');
            }''')
            expect(page.locator('.rm-desk-tile__drop')).to_have_count(0)
            assert page.evaluate('()=>!oldDropTarget.querySelector(".rm-desk-tile__drop")')
            fire('[data-task-uid="parity-4"]','dragover')
            page.locator('.nautilus-desk__grid').evaluate('el=>el.dispatchEvent(new MouseEvent("dragleave",{bubbles:true,relatedTarget:document.body}))')
            expect(page.locator('.rm-desk-tile__drop')).to_have_count(0)
            fire('[data-task-uid="parity-0"]','dragend')
            assert page.evaluate('()=>deskHarness.api.stats.writes.length')==0
            checks.append('filtered background targets full collection end; target removal and leaving clear native rails')
            # External source shares the same native chrome but only adds a reference.
            for side in ['before','after']:
                mount();source_before=page.evaluate('()=>deskHarness.api.sourceSnapshot("outside-source")')
                fire('#fixture-external-outline .rm-bullet','dragstart',external=True)
                over=fire('[data-task-uid="parity-3"]','dragover',side);assert over['effect']=='copy' and over['prevented'],over
                rail(card(3),side,4 if side=='before' else 5)
                assert badge(card(9))['background']=='rgb(245, 248, 250)'
                page.screenshot(path=str(OUT/f'external-{side}.png'))
                fire('[data-task-uid="parity-3"]','drop',side)
                page.wait_for_function('deskHarness.api.stats.referenceRequests[0]?.status==="added"')
                ordered=page.evaluate('()=>deskHarness.api.children("plan-desk").map(r=>r.uid)')
                assert ordered.index('ref-outside-source')==ordered.index('parity-3')+(-1 if side=='before' else 1),ordered
                assert page.evaluate('()=>deskHarness.api.sourceSnapshot("outside-source")')==source_before
                assert page.evaluate('()=>deskHarness.api.stats.writes.length')==1
            mount(empty=True)
            fire('#fixture-external-outline .rm-bullet','dragstart',external=True)
            fire('.nautilus-desk > .rm-desk-card__missing','dragover')
            expect(page.locator('.rm-desk-overview--drop')).to_have_count(1)
            modified=fire('.nautilus-desk > .rm-desk-card__missing','dragover',modifier=True)
            assert not modified['prevented'];expect(page.locator('.rm-desk-overview--drop')).to_have_count(0)
            assert page.evaluate('()=>deskHarness.api.stats.writes.length')==0
            for effect in ['move','link','linkMove','none']:
                fire('#fixture-external-outline .rm-bullet','dragstart',external=True)
                page.evaluate('value=>window.parityData.effectAllowed=value',effect)
                fire('.nautilus-desk > .rm-desk-card__missing','dragover')
                expect(page.locator('.rm-desk-overview--drop')).to_have_count(0)
                fire('.nautilus-desk > .rm-desk-card__missing','drop')
                assert page.evaluate('()=>deskHarness.api.stats.writes.length')==0
            mount();fire('[data-task-uid="parity-0"]','dragstart');fire('[data-task-uid="parity-3"]','dragover')
            page.evaluate('()=>document.body.classList.add("bp3-dark")')
            dark_badge=badge(card(9))
            assert dark_badge['background']=='rgb(41, 55, 66)' and dark_badge['color']=='rgb(167, 182, 194)',dark_badge
            rail(card(3),'before',3)
            page.evaluate('()=>document.body.classList.remove("bp3-dark")')
            fire('[data-task-uid="parity-0"]','dragend')
            checks.append('external copy cursor, shared rail, exact single reference insertion, empty outline, modifier yield and dark chrome')
            # Differential computed-style control against the actual current
            # host stylesheet, outside Nautilus scope. Legacy hosts use the
            # scoped compatibility rules and are covered by the same assertions.
            native_path=Path(os.environ.get('ROAM_NATIVE_CSS', ROOT/'test/desk-native-fixture.css'))
            native_control=None
            if 'rm-desk-tile__drop-position' in native_path.read_text():
                mount();fire('[data-task-uid="parity-0"]','dragstart');fire('[data-task-uid="parity-3"]','dragover')
                native_control=page.evaluate('''()=>{
                  const page=document.createElement('div');page.className='rm-desk-page';page.style.cssText='position:fixed;left:-10000px;width:700px';
                  page.innerHTML='<div class="rm-desk-overview rm-desk-overview--masonry"><div class="rm-desk-tile rm-desk-tile--dragging" data-position="1"></div><div class="rm-desk-tile" data-position="2"><div class="rm-desk-tile__drop rm-desk-tile__drop--before"><span class="rm-desk-tile__drop-position">2</span></div></div></div>';
                  document.body.append(page);
                  const fields=['top','right','minWidth','paddingLeft','paddingRight','fontSize','fontWeight','lineHeight','color','backgroundColor','borderTopWidth','borderTopColor','borderRadius'];
                  const styles=(el,pseudo)=>{const s=getComputedStyle(el,pseudo);return Object.fromEntries(fields.map(key=>[key,s[key]]));};
                  const result={native:styles(page.querySelector('.rm-desk-tile'),'::after'),ours:styles(document.querySelector('[data-task-uid="parity-0"]'),'::after'),
                    nativeRail:styles(page.querySelector('.rm-desk-tile__drop-position')),ourRail:styles(document.querySelector('.nautilus-desk .rm-desk-tile__drop-position'))};
                  page.remove();return result;
                }''')
                assert native_control['native']==native_control['ours'],native_control
                assert native_control['nativeRail']==native_control['ourRail'],native_control
                fire('[data-task-uid="parity-0"]','dragend')
                checks.append('computed badge and rail label styles match a genuine native-page control outside Nautilus')
            assert not errors,errors
            (OUT/'results.json').write_text(json.dumps({'status':'passed','checks':checks,'alt':alt,'gray':gray,'sticky':sticky,'gap_results':gap_results,'boundary_control':boundary_control,'pointer_order':pointer_order,'native_control':native_control,'pageerrors':errors,
                'native_css':os.environ.get('ROAM_NATIVE_CSS','offline fixture'),'limitation':'Synthetic graph/events, not physical OS drag or live Desktop.'},indent=2))
            print(f'PASSED: {len(checks)} native drag-parity scenario groups; artifacts: {OUT}')
        finally:
            browser.close()


if __name__=='__main__': run()
