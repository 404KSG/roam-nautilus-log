#!/usr/bin/env python3
"""Exact-source two-row Tips regression; no authenticated Roam graph is used."""
import importlib.util
import json
import os
import subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
os.environ['NAUTILUS_RENDERER_OUT'] = os.environ.get('NAUTILUS_TIP_OUT', '/tmp/nautilus-fixed-tips')
spec = importlib.util.spec_from_file_location('renderer', ROOT / 'test/chart-renderer.py')
f = importlib.util.module_from_spec(spec)
spec.loader.exec_module(f)

MEASURE = '''()=>{
  const region=document.querySelector('.nautilus-log-detail-region'),content=region.querySelector('.nautilus-log-detail-content');
  const rect=e=>{if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height,bottom:r.bottom+scrollY};};
  const text=e=>{if(!e)return null;const s=getComputedStyle(e),r=document.createRange();r.selectNodeContents(e);
    return {text:e.textContent,height:e.clientHeight,width:e.clientWidth,scrollWidth:e.scrollWidth,
      rows:[...new Set([...r.getClientRects()].map(b=>Math.round(b.top*100)/100))].length,
      nowrap:s.whiteSpace==='nowrap',ellipsis:s.textOverflow==='ellipsis',font:s.fontSize,line:s.lineHeight};};
  return {slot:rect(region),content:rect(content),svg:rect(document.querySelector('svg.nautilus-log-svg')),
    queue:rect(document.querySelector('.nautilus-log-pending-queue')),desk:rect(document.querySelector('.nautilus-log-desk-host')),
    following:rect(document.querySelector('#following-sentinel')),workspace:rect(region.parentElement),
    title:text(region.querySelector('.nautilus-log-detail-title')),meta:text(region.querySelector('.nautilus-log-detail-meta')),
    expanded:region.classList.contains('is-expanded'),more:!!region.querySelector('.nautilus-log-detail-expand'),writes:__chartHarness.state().writes};
}'''


def run(page):
    report = {}
    medium = '项目生产力指南：整体内容清晰易读并且便于执行与核对 v5'
    for dark in [False, True]:
        for context, width, lang in [('main', 720, 'en'), ('main', 640, 'en'), ('embed', 520, 'en'), ('sidebar', 400, 'zh'), ('sidebar', 280, 'zh')]:
            f.load(page, 'planned-density', context, width, window='flow', lang=lang, real_desk=True)
            f.set_clock(page, '2026-10-29T09:24:00')
            page.locator('body').evaluate('''(e,dark)=>{e.classList.toggle('bp3-dark',dark);e.style.background=dark?'#1d1e21':'#fff';e.style.color=dark?'#ecedef':'#222326'}''', dark)
            page.evaluate('title=>__chartHarness.updateChild("density-task-2","{{[[TODO]]}} "+title+" 30m")', medium)
            page.wait_for_function('title=>document.querySelector("[data-task-uid=density-task-2]")?.dataset.recordTitle===title', arg=medium)
            toggle = page.get_by_role('switch')
            if toggle.get_attribute('aria-checked') != 'true': toggle.click()
            page.wait_for_function('document.querySelector(".nautilus-desk")?.dataset.status==="ready"')
            page.mouse.move(1180, 980); f.settle_renderer(page)
            original = page.evaluate('()=>__chartHarness.sourceRows()')
            states = {'idle': page.evaluate(MEASURE)}
            # A frame sampler catches transient layout jumps, not just settled snapshots.
            page.evaluate('''()=>{window.__tipFrames=[];window.__tipSampling=true;const sample=()=>{
              if(!window.__tipSampling)return;const r=document.querySelector('.nautilus-log-detail-region').getBoundingClientRect(),q=document.querySelector('.nautilus-log-pending-queue').getBoundingClientRect();
              __tipFrames.push({height:r.height,top:r.top+scrollY,bottom:r.bottom+scrollY,queueTop:q.top+scrollY});requestAnimationFrame(sample);};requestAnimationFrame(sample);}''')
            for label, uid in [('short', 'density-task-10'), ('medium', 'density-task-2'), ('long', 'density-task-8'), ('short-again', 'density-task-10')]:
                page.locator(f'[data-task-uid="{uid}"] .nautilus-log-record-title').hover()
                page.wait_for_function('uid=>document.querySelector(".nautilus-log-detail-title")?.textContent===__chartHarness.scene().records.find(r=>r.uid===uid)?.event.description', arg=uid)
                f.settle_renderer(page); states[label] = page.evaluate(MEASURE)
            for kind in ['available-slot', 'past-gap']:
                target = page.locator(f'.nautilus-log-{kind}').first
                assert target.count(), kind
                target.focus(); page.mouse.move(1180, 980); f.settle_renderer(page)
                states[kind] = page.evaluate(MEASURE)
                target.evaluate('e=>e.blur()'); f.settle_renderer(page)
            page.mouse.move(1180, 980); f.settle_renderer(page)
            states['idle-again'] = page.evaluate(MEASURE)
            page.evaluate('()=>window.__tipSampling=false')
            frames = page.evaluate('()=>window.__tipFrames')
            key = f'{"dark" if dark else "light"}-{context}-{width}-{lang}'
            report[key] = {'states': states, 'frames': frames}
            (f.OUT/'results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
            baseline = states['idle']
            for label, state in states.items():
                assert abs(state['slot']['height'] - 42) < .1, (key, label, state)
                for name in ['slot', 'svg', 'queue', 'desk', 'following', 'workspace']:
                    assert all(abs(state[name][part]-baseline[name][part]) < .5 for part in ['x','y','width','height']), (key,label,name,baseline[name],state[name])
                if state['content']:
                    assert abs(state['content']['height']-38) < .1
                    assert state['content']['width'] <= state['workspace']['width']-32+.5
                    assert abs(state['content']['x']+state['content']['width']/2-state['workspace']['x']-state['workspace']['width']/2) < .5
                    for field in ['title', 'meta']:
                        t=state[field]
                        assert t['rows']==1 and t['height']==14 and t['nowrap'] and t['ellipsis'], (key,label,field,t)
                        assert t['font']=='11px' and t['line']=='14px', t
                    if any(state[field]['scrollWidth']>state[field]['width']+1 for field in ['title','meta']):
                        assert state['more'], (key,label,'clipped text must have a full-text action')
            assert frames and all(abs(v['height']-42)<.1 and abs(v['top']-baseline['slot']['y'])<.5 and abs(v['queueTop']-baseline['queue']['y'])<.5 for v in frames), (key,frames)
            assert states['short']['content']['width'] < states['medium']['content']['width'] <= states['long']['content']['width']
            if width>=520:
                assert states['medium']['content']['width']>280
                assert states['medium']['title']['scrollWidth']<=states['medium']['title']['width']+1
                assert not states['medium']['more'], 'fitting title and summary need no extra action'
            assert states['long']['more']
            f.select(page,'density-task-8')
            page.locator('.nautilus-log-container').screenshot(path=str(f.OUT/'screenshots'/f'{key}.png'))
            page.get_by_role('button',name='全文' if lang=='zh' else 'Full text',exact=True).click();f.settle_renderer(page)
            expanded=page.evaluate(MEASURE)
            assert expanded['expanded'] and expanded['title']['text']==states['long']['title']['text']
            assert expanded['slot']['height']>42 and expanded['title']['scrollWidth']<=expanded['title']['width']+1
            assert expanded['svg']==baseline['svg']
            page.locator('[data-task-uid="density-task-10"] .nautilus-log-record-title').hover();f.settle_renderer(page)
            assert page.evaluate(MEASURE)['slot']==expanded['slot'], 'explicit full-text reading stays pinned during hover'
            page.get_by_role('button',name='收起全文' if lang=='zh' else 'Collapse text',exact=True).click();f.settle_renderer(page)
            assert page.evaluate(MEASURE)['slot']==baseline['slot']
            assert page.evaluate('()=>__chartHarness.sourceRows()')==original and f.state(page)['writes']==0
            f.coverage(page);f.geometry_audit(page)
            report[key]['expandedHeight']=expanded['slot']['height']

    # A short title must not hide the separate metadata-only overflow case.
    f.load(page, 'reference-completion', 'sidebar', 280, window='flow')
    f.set_clock(page, '2026-10-29T23:55:00')
    page.evaluate('()=>__chartHarness.updateReferenceSource("completion-source",{pageUid:"project-page"})')
    page.wait_for_function('document.querySelector("[data-task-uid=completion-wrapper]")?.dataset.chartKind==="outside-window"')
    # A project page is valid plan-clock evidence. Exercise genuine unavailable
    # timing instead of the retired source-page date gate to keep this long-
    # metadata layout regression meaningful under the corrected policy.
    page.evaluate('()=>__chartHarness.setClockReadAvailable(false)')
    page.wait_for_function('document.querySelector("[data-task-uid=completion-wrapper]")?.dataset.chartKind==="unverified-completion"')
    f.select(page, 'completion-wrapper')
    clipped=page.evaluate(MEASURE)
    assert clipped['slot']['height']==42 and clipped['content']['height']==38
    assert clipped['title']['scrollWidth']<=clipped['title']['width']+1
    assert clipped['meta']['scrollWidth']>clipped['meta']['width']+1 and clipped['meta']['rows']==1 and clipped['more']
    page.locator('.nautilus-log-detail-content').screenshot(path=str(f.OUT/'screenshots'/'metadata-ellipsis.png'))
    page.get_by_role('button',name='Full text',exact=True).click();f.settle_renderer(page)
    expanded=page.evaluate(MEASURE)
    assert '23:54' in expanded['meta']['text'] and 'unverified' in expanded['meta']['text'].lower()
    assert 'Local CLOCK history unavailable' in expanded['meta']['text']
    assert expanded['meta']['scrollWidth']<=expanded['meta']['width']+1
    assert expanded['svg']==clipped['svg'] and expanded['writes']==0
    report['metadata-only-overflow']={'preview':clipped,'expanded':expanded}
    return report


def main():
    (f.OUT/'bundle').mkdir();(f.OUT/'screenshots').mkdir()
    subprocess.check_call(['node','test/chart-renderer-bundle.cjs',str(f.OUT/'bundle')],cwd=ROOT,env={**os.environ,'NODE_PATH':str(f.NODE_MODULES)})
    f.write_page(f.COMPONENT.read_text())
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True)
        try:
            page=browser.new_page(viewport={'width':1200,'height':1100})
            errors=[];requests=[];resources=[];console_errors=[]
            page.on('pageerror',lambda error:errors.append(str(error)))
            page.on('request',lambda r:requests.append(r.url) if r.url.startswith(('http:','https:')) else None)
            page.on('requestfailed',lambda r:resources.append({'url':r.url,'failure':r.failure}))
            page.on('console',lambda m:console_errors.append(m.text) if m.type=='error' and not any(w in m.text for w in f.EXPECTED_WARNINGS) else None)
            report=run(page)
            assert not errors and not requests and not resources and not console_errors, (errors,requests,resources,console_errors)
            (f.OUT/'results.json').write_text(json.dumps({'result':'PASS','componentSha256':f.sha(f.COMPONENT.read_text()),
                'sceneSha256':f.sha((ROOT/'src/chart-scene.js').read_text()),'cssSha256':f.sha((ROOT/'extension.css').read_text()),
                'cases':report,'pageErrors':errors,'httpRequests':requests,'resourceFailures':resources,'consoleErrors':console_errors},ensure_ascii=False,indent=2))
            print(json.dumps({'result':'PASS','cases':len(report),'artifactDirectory':str(f.OUT)}))
        finally: browser.close()


if __name__=='__main__':main()
