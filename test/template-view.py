#!/usr/bin/env python3
"""Managed templates retain their full outline but expose no execution metrics."""
import base64
import importlib.util
import json
import os
import subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
os.environ['NAUTILUS_RENDERER_OUT'] = os.environ.get('NAUTILUS_TEMPLATE_VIEW_OUT', '/tmp/nautilus-template-view')
spec = importlib.util.spec_from_file_location('template_chart_fixture', ROOT / 'test/chart-renderer.py')
f = importlib.util.module_from_spec(spec);spec.loader.exec_module(f)
OUT = f.OUT


def install_view(page, owner='baseline-plan'):
    bundle = base64.b64encode((ROOT / 'extension.js').read_bytes()).decode()
    page.evaluate('''async ({bundle,owner}) => {
      const api=await import('data:text/javascript;base64,'+bundle);
      const listeners=new Map(),probe={owner,active:true,refresh:null,failRead:false};
      const options={host:window,resolveIdentity:()=>{if(probe.failRead)throw Error('fixture read failure');return {templateUid:'fixture-template',renderUid:probe.owner};},
        getLanguage:()=>nautilusLogR2.settings.language,isActive:()=>probe.active,
        watch:(uid,fn)=>{const set=listeners.get(uid)||new Set();set.add(fn);listeners.set(uid,set);return()=>{set.delete(fn);if(!set.size)listeners.delete(uid);};}};
      probe.create=()=>typeof api.createTemplatePresentation==='function'?api.createTemplatePresentation(options):null;
      probe.api=api;probe.options=options;probe.view=probe.create();probe.listeners=listeners;
      probe.notify=()=>{for(const set of [...listeners.values()])for(const fn of [...set])fn();probe.view?.refresh();};
      const container=document.querySelector('.nautilus-log-container > .nautilus-log-desk-host');
      probe.container=container;probe.view?.register({container,planUid:'baseline-plan'});
      window.__templateViewProbe=probe;
    }''', {'bundle':bundle,'owner':owner})
    f.settle_renderer(page)


def prepare(page, context, width, window='undated'):
    f.load(page,'planned-density',context,width,window=window)
    page.evaluate('''()=>{
      const rows=__chartHarness.sourceRows();
      for(const row of rows.slice(8))__chartHarness.removeChild(row['block/uid']);
      __chartHarness.updateChild(rows[6]['block/uid'],'{{[[TODO]]}} First routine task 45m');
      __chartHarness.updateChild(rows[7]['block/uid'],'{{[[TODO]]}} Second routine task 600m');
      Object.assign(nautilusLogR2.settings,{'workday-start':6,'workday-end':20});
      dispatchEvent(new Event('nautilus-log:settings-changed'));
    }''')
    f.set_clock(page,'2026-10-29T18:42:00')
    return page.evaluate('()=>__chartHarness.sourceRows()')


def run():
    (OUT/'bundle').mkdir()
    subprocess.run(['node','test/chart-renderer-bundle.cjs',str(OUT/'bundle')],cwd=ROOT,check=True)
    f.write_page(f.COMPONENT.read_text())
    cases=[];errors=[];requests=[]
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True)
        try:
            page=browser.new_page(viewport={'width':1200,'height':1000})
            page.on('pageerror',lambda error:errors.append(str(error)))
            page.on('request',lambda request:requests.append(request.url) if request.url.startswith(('http:','https:')) else None)
            for context,width in [('main',720),('sidebar',280),('embed',520)]:
                original=prepare(page,context,width)
                assert f.state(page)['pendingQueue']['minutes']==600
                metrics=page.locator('.nautilus-log-container > .nautilus-log-shell > .nautilus-log-header > .nautilus-log-header-copy > .nautilus-log-metrics')
                metrics.wait_for(state='attached')
                initial_metrics_visible=metrics.is_visible()
                install_view(page)
                expect(metrics).to_be_hidden()
                expect(page.locator('.nautilus-log-pending-queue')).to_be_hidden()
                expect(page.locator('.nautilus-log-template-caption')).to_have_count(1)
                expect(page.locator('.nautilus-log-template-caption')).to_contain_text('Template preview')
                accessible=page.locator('.nautilus-log-container').aria_snapshot()
                assert 'No fitting slot' not in accessible and 'Event time is elapsing' not in accessible
                assert page.locator('svg.nautilus-log-svg').is_visible()
                assert page.locator('svg.nautilus-log-svg [data-task-uid]').count()==7
                for clock in ['2026-10-29T08:00:00','2026-10-29T23:00:00']:
                    f.set_clock(page,clock)
                    expect(page.locator('.nautilus-log-template-caption')).to_have_count(1)
                    expect(page.locator('.nautilus-log-burning-icon:visible')).to_have_count(0)
                page.evaluate("()=>{nautilusLogR2.settings.language='zh';dispatchEvent(new Event('nautilus-log:settings-changed'));__templateViewProbe.notify();}")
                expect(page.locator('.nautilus-log-template-caption')).to_contain_text('模板预览')
                page.locator('.nautilus-log-header').screenshot(path=str(OUT/f'{context}-template-header.png'))
                collapse=page.locator('.nautilus-log-collapse-btn');collapse.press('Space')
                expect(page.locator('.nautilus-log-template-caption')).to_have_count(0)
                collapse.press('Enter');expect(page.locator('.nautilus-log-template-caption')).to_have_count(1)
                expect(page.locator('.nautilus-log-pending-queue')).to_be_hidden()
                assert page.evaluate('()=>__chartHarness.sourceRows()')==original
                # The identical source is a normal plan when it is not the managed template.
                page.evaluate("()=>{__templateViewProbe.owner='different-root';__templateViewProbe.notify();}")
                expect(page.locator('.nautilus-log-template-caption')).to_have_count(0)
                expect(page.locator('.nautilus-log-pending-queue')).to_be_visible()
                page.evaluate("()=>{__templateViewProbe.owner='baseline-plan';__templateViewProbe.notify();}")
                expect(page.locator('.nautilus-log-template-caption')).to_have_count(1)
                assert f.state(page)['writes']==0
                page.evaluate('()=>{__templateViewProbe.failRead=true;__templateViewProbe.notify();}')
                expect(page.locator('.nautilus-log-template-caption')).to_have_count(1)
                page.evaluate('()=>{__templateViewProbe.failRead=false;__templateViewProbe.notify();}')
                cases.append({'context':context,'width':width,'initialMetricsVisible':initial_metrics_visible,'outlinePreserved':True,'graphWrites':0})
            # Direct owner chains must not hide a nested, ordinary renderer.
            nested=page.evaluate('''()=>{
              const outer=document.querySelector('.nautilus-log-container'),inner=document.createElement('div');
              inner.className='nautilus-log-container';inner.dataset.nautilusRenderer='2';inner.dataset.nautilusLogBlock='other-plan';
              inner.innerHTML='<div class="nautilus-log-shell"><header class="nautilus-log-header"><div class="nautilus-log-header-copy"><div class="nautilus-log-metrics">Other plan metrics</div></div></header><div class="nautilus-log-content"><div class="nautilus-log-workspace"><details class="nautilus-log-pending-queue"><summary>Other plan queue</summary></details></div></div></div><div class="nautilus-log-desk-host"></div>';
              outer.append(inner);const container=inner.lastElementChild;
              __templateViewProbe.view.register({container,planUid:'other-plan'});
              window.__nestedTemplateProbe={inner,container};return true;
            }''')
            f.settle_renderer(page)
            assert page.evaluate("()=>!__nestedTemplateProbe.inner.hasAttribute('data-nautilus-template-view')&&getComputedStyle(__nestedTemplateProbe.inner.querySelector('.nautilus-log-metrics')).display!=='none'&&getComputedStyle(__nestedTemplateProbe.inner.querySelector('.nautilus-log-pending-queue')).display!=='none'")
            page.evaluate('()=>{__templateViewProbe.view.close(__nestedTemplateProbe.container);__nestedTemplateProbe.inner.remove();}')
            # A superseded controller cannot tear down a newer owner's caption or scope.
            page.evaluate('''()=>{const p=__templateViewProbe,old=p.view;p.view=p.create();p.view.register({container:p.container,planUid:'baseline-plan'});old.destroy();}''')
            expect(page.locator('.nautilus-log-template-caption')).to_have_count(1)
            page.evaluate('()=>{__templateViewProbe.active=false;__templateViewProbe.notify();}')
            expect(page.locator('.nautilus-log-template-caption')).to_have_count(0)
            expect(page.locator('.nautilus-log-pending-queue')).to_be_visible()
            assert page.evaluate('()=>__templateViewProbe.listeners.size')==0
            # Real dated plans keep their current time, capacity, and overflow.
            daily_original=prepare(page,'main',720,window='flow')
            install_view(page,owner='some-template-root')
            expect(page.locator('.nautilus-log-template-caption')).to_have_count(0)
            expect(page.locator('.nautilus-log-pending-queue')).to_be_visible()
            expect(page.locator('.nautilus-log-metrics')).to_be_visible()
            assert f.state(page)['nowLabel']=='18:42'
            assert page.evaluate('()=>__chartHarness.sourceRows()')==daily_original
            # Native watch removal must wait for late registration to settle.
            page.evaluate('''()=>{
              const p=__templateViewProbe;p.view.destroy();p.owner='baseline-plan';
              const pending=[],removed=[];window.__templateWatchProbe={pending,removed};
              roamAlphaAPI.data={addPullWatch:(pattern,uid,callback)=>new Promise(resolve=>pending.push({uid,callback,resolve})),removePullWatch:(pattern,uid,callback)=>removed.push({uid,callback})};
              const {watch,...options}=p.options;p.view=p.api.createTemplatePresentation(options);
              p.view.register({container:p.container,planUid:'baseline-plan'});
            }''')
            page.wait_for_function('()=>__templateWatchProbe.pending.length===3')
            page.evaluate('()=>{const p=__templateViewProbe;p.view.close(p.container);p.view.register({container:p.container,planUid:"baseline-plan"});}')
            page.wait_for_function('()=>__templateWatchProbe.pending.length===6')
            assert page.evaluate('()=>__templateWatchProbe.pending.slice(0,3).every(old=>__templateWatchProbe.pending.slice(3).every(next=>old.callback!==next.callback))')
            assert page.evaluate('()=>__templateWatchProbe.removed.length')==0
            page.evaluate('()=>__templateWatchProbe.pending.slice(0,3).forEach(row=>row.resolve())')
            page.wait_for_function('()=>__templateWatchProbe.removed.length===3')
            assert page.evaluate('()=>__templateWatchProbe.removed.every(old=>__templateWatchProbe.pending.slice(3).every(next=>old.callback!==next.callback))')
            expect(page.locator('.nautilus-log-template-caption')).to_have_count(1)
            page.evaluate('()=>{__templateViewProbe.view.destroy();__templateWatchProbe.pending.slice(3).forEach(row=>row.resolve());}')
            page.wait_for_function('()=>__templateWatchProbe.removed.length===6')
            assert f.state(page)['writes']==0
        finally:
            browser.close()
    assert not errors and not requests,(errors,requests)
    (OUT/'result.json').write_text(json.dumps({'cases':cases,'pageErrors':errors,'httpRequests':requests,'componentSha256':f.sha(f.COMPONENT.read_text())},indent=2))
    print(f'PASS: template-only time state suppression preserves content in main/sidebar/embed; {OUT}')


if __name__=='__main__':run()
