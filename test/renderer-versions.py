#!/usr/bin/env python3
"""Actual r2 + frozen published v1 CLJS, scaffold, bridge, watcher and Desk.
All Roam I/O is an isolated raw graph fixture; this is not live-host certification.
"""
import hashlib
import importlib.util
import json
import os
import subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[1]
os.environ['NAUTILUS_RENDERER_OUT']=os.environ.get('NAUTILUS_VERSION_OUT','/tmp/nautilus-renderer-versions')
spec=importlib.util.spec_from_file_location('renderer',ROOT/'test/chart-renderer.py')
f=importlib.util.module_from_spec(spec);spec.loader.exec_module(f)
CURRENT=(ROOT/'src/component.cljs').read_text()
LEGACY=(ROOT/'test/fixtures/renderer-v1/component.cljs').read_text()
MOUNT_CURRENT='''(require '[reagent.dom :as rdom])
(rdom/render [nautilus-log-r2/main {:block-uid "baseline-plan"}] (.getElementById js/document "chart-root"))'''
MOUNT_LEGACY='''(require '[reagent.dom :as rdom])
(rdom/render [nautilus-log-v1/main {:block-uid "legacy-plan"}] (.getElementById js/document "legacy-root"))'''


def write_page(order):
    f.write_page(CURRENT)
    html=(f.OUT/'index.html').read_text().replace('<div id="following-sentinel">','<div id="legacy-root"></div><div id="following-sentinel">')
    current=f.script_tag(CURRENT,'component-cljs-exact')+f.script_tag(MOUNT_CURRENT,'reagent-mount')
    legacy=f.script_tag(LEGACY,'legacy-cljs-exact')+f.script_tag(MOUNT_LEGACY,'legacy-mount')
    assert current in html
    html=html.replace(current,current+legacy if order=='new-first' else legacy+current)
    (f.OUT/f'{order}.html').write_text(html)


def run(page,order):
    errors=[]
    page.version_errors=errors
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.on('console',lambda message:errors.append(message.text) if message.type=='error' and not any(warning in message.text for warning in f.EXPECTED_WARNINGS) else None)
    page.goto((f.OUT/f'{order}.html').as_uri()+'?scenario=mixed&realBridge=1&lang=en')
    page.wait_for_selector('#chart-root svg.nautilus-log-svg')
    page.wait_for_selector('#legacy-root svg.nautilus-log-svg')
    assert page.locator('script[data-chart-eval="component-cljs-exact"]').text_content()==CURRENT
    assert page.locator('script[data-chart-eval="legacy-cljs-exact"]').text_content()==LEGACY
    expect(page.locator('#legacy-root [data-task-uid="legacy-task"]')).to_have_count(1)
    page.locator('#chart-root .nautilus-log-desk-btn').click()
    expect(page.locator('#chart-root .nautilus-desk')).to_have_count(1)
    expect(page.locator('#chart-root .nautilus-desk [data-task-uid="task-long"]')).to_have_count(1)
    page.locator('#chart-root .nautilus-log-help-btn').click()
    expect(page.locator('.nautilus-log-help-popover')).to_have_count(1)
    page.evaluate('''()=>{window.__r2MainBefore=scittle.core.eval_string('nautilus-log-r2/main');window.__r2CoreBefore=nautilusLogR2.core;}''')
    page.evaluate('source=>scittle.core.eval_string(source)',LEGACY)
    assert page.evaluate('()=>window.__r2MainBefore===scittle.core.eval_string("nautilus-log-r2/main")')
    before=page.evaluate('()=>__rendererVersion.currentSource()')
    writes=page.evaluate('()=>__rendererVersion.legacyWrite()')
    assert writes and any(row[1]=='roam-render-Nautilus-Log-cljs' for row in writes),writes
    assert page.evaluate('()=>__rendererVersion.currentSource()')==before
    assert not any(row[1]=='roam-render-Nautilus-Log-r2-cljs' for row in writes),writes
    expect(page.locator('#chart-root .nautilus-desk')).to_have_count(1)
    page.evaluate('()=>__chartHarness.updateChild("task-long","{{[[TODO]]}} After legacy evaluation 45m")')
    page.wait_for_function('''()=>document.querySelector('#chart-root [data-task-uid="task-long"][data-record-title]')?.dataset.recordTitle==='After legacy evaluation' ''')
    expect(page.locator('#chart-root .nautilus-desk [data-task-uid="task-long"]')).to_contain_text('After legacy evaluation')
    source_checks=[page.evaluate('kind=>__rendererVersion.verifySourceRefusal(kind)',kind) for kind in ['same','newer']]
    assert all(value['message'] and value['preserved'] and not value['writes'] for value in source_checks),source_checks
    ambiguous=page.evaluate('()=>__rendererVersion.verifyAmbiguousTemplate()')
    assert ambiguous['message'] and ambiguous['preserved'],ambiguous
    # Replace the current bridge while delaying its predecessor's cleanup.
    page.evaluate('''()=>{__rendererVersion.install();__chartHarness.syncServiceIntervals();}''')
    # The live CLJS help callback captures the replacement owner on this click.
    page.locator('#chart-root .nautilus-log-help-btn').click()
    page.evaluate('''()=>{__rendererVersion.staleCleanup();__rendererVersion.disposePrevious();__chartHarness.syncServiceIntervals();}''')
    expect(page.locator('#chart-root .nautilus-desk')).to_have_count(1)
    expect(page.locator('.nautilus-log-help-popover')).to_have_count(1)
    assert page.evaluate('()=>__rendererVersion.state().running')
    # A retained v1 session must follow the replacement compatibility reader.
    page.evaluate('()=>__rendererVersion.updateLegacyTitle("{{[[DONE]]}} Historical view after reload 20m d10:20")')
    page.wait_for_function('''()=>document.querySelector('#legacy-root [data-task-uid="legacy-task"]')?.dataset.recordTitle==='Historical view after reload' ''')
    page.evaluate('''()=>{__rendererVersion.legacyGlobalCleanup();__chartHarness.syncServiceIntervals();ReactDOM.unmountComponentAtNode(document.querySelector('#legacy-root'));}''')
    page.evaluate('()=>__chartHarness.updateChild("task-long","{{[[TODO]]}} After legacy disposal 45m")')
    page.wait_for_function('''()=>document.querySelector('#chart-root [data-task-uid="task-long"][data-record-title]')?.dataset.recordTitle==='After legacy disposal' ''')
    expect(page.locator('#chart-root .nautilus-desk')).to_have_count(1)
    expect(page.locator('.nautilus-log-help-popover')).to_have_count(1)
    assert page.evaluate('()=>nautilusLogR2.core===window.__r2CoreBefore')
    # Actual CLJS feeds the optional event floors into the production scheduler.
    default_start=page.evaluate('()=>__chartHarness.scene().records.find(row=>row.uid==="task-reference").event.start')
    assert default_start==481,default_start
    page.evaluate('''()=>{nautilusLogR2.settings['respect-event-order']=true;window.dispatchEvent(new CustomEvent('nautilus-log:settings-changed'));}''')
    page.wait_for_function('()=>__chartHarness.scene().records.find(row=>row.uid==="task-reference").event.start===570')
    page.evaluate('()=>__chartHarness.updateChild("event-standup","{{[[DONE]]}} 09:00-09:30 Stand-up")')
    page.wait_for_function('()=>__chartHarness.scene().records.find(row=>row.uid==="event-standup").event.done===true')
    assert page.evaluate('()=>__chartHarness.scene().records.find(row=>row.uid==="task-reference").event.start')==570
    page.evaluate('''()=>{nautilusLogR2.settings.language='zh';window.dispatchEvent(new CustomEvent('nautilus-log:settings-changed'));}''')
    expect(page.locator('#chart-root .nautilus-desk .rm-desk-page__new-note')).to_have_attribute('aria-label','新任务')
    expect(page.locator('#chart-root .nautilus-desk .rm-desk-page__new-note')).to_contain_text('新任务')
    page.locator('#chart-root .nautilus-desk [data-task-uid="task-reference"]').click()
    expect(page.locator('.rm-desk__previous')).to_have_attribute('aria-label','新任务')
    page.screenshot(path=str(f.OUT/f'{order}.png'),full_page=True)
    state=page.evaluate('()=>__rendererVersion.state()')
    page.evaluate('''()=>{ReactDOM.unmountComponentAtNode(document.querySelector('#chart-root'));__rendererVersion.destroy();}''')
    page.wait_for_function('()=>__rendererVersion.state().watches===0')
    expect(page.locator('.nautilus-log-help-popover')).to_have_count(0)
    assert not errors,errors
    return {'order':order,'sourceRefusal':source_checks,'ambiguousTemplate':ambiguous,'legacyWrites':writes,'stateBeforeFinalCleanup':state,'errors':errors}


if __name__=='__main__':
    subprocess.check_call(['node','test/chart-renderer-bundle.cjs',str(f.OUT/'bundle')],cwd=ROOT,env={**os.environ,'NODE_PATH':str(f.NODE_MODULES)})
    report={'currentSHA256':hashlib.sha256(CURRENT.encode()).hexdigest(),'legacySHA256':hashlib.sha256(LEGACY.encode()).hexdigest(),
            'legacyCommit':'f0bb0d9030421f19e4c3556a4d0a6b193de66c9d','cases':[]}
    with sync_playwright() as p:
        browser=p.chromium.launch()
        try:
            for order in ['new-first','legacy-first']:
                write_page(order);page=browser.new_page(viewport={'width':1280,'height':1100})
                try:report['cases'].append(run(page,order))
                except Exception:
                    page.screenshot(path=str(f.OUT/f'{order}-failure.png'),full_page=True)
                    (f.OUT/f'{order}-failure.html').write_text(page.content())
                    (f.OUT/f'{order}-failure.json').write_text(json.dumps({'errors':getattr(page,'version_errors',[]),
                        'body':page.locator('body').inner_text()[:12000],
                        'state':page.evaluate('()=>window.__rendererVersion?.state()')},ensure_ascii=False,indent=2))
                    raise
                finally:page.close()
        finally:browser.close()
    (f.OUT/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    print(json.dumps({'passed':len(report['cases']),'artifacts':str(f.OUT)}))
