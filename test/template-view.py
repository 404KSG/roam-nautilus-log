#!/usr/bin/env python3
"""Templates use normal non-date rendering without changing content or dated timing."""
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


def prepare(page, context, width, window='undated'):
    f.load(page,'planned-density',context,width,window=window)
    page.evaluate('''()=>{
      const rows=__chartHarness.sourceRows();
      for(const row of rows.slice(8))__chartHarness.removeChild(row['block/uid']);
      __chartHarness.updateChild(rows[6]['block/uid'],'{{[[TODO]]}} First routine task 45m');
      __chartHarness.updateChild(rows[7]['block/uid'],'{{[[TODO]]}} Second routine task 600m');
      Object.assign(nautilusLogR3.settings,{'workday-start':6,'workday-end':20});
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
                metrics=page.locator('.nautilus-log-metrics')
                overview=page.locator('.nautilus-log-compact-overview')
                expect(metrics if width>520 else overview).to_be_visible()
                expect(page.locator('.nautilus-log-pending-queue')).to_be_visible()
                assert f.state(page)['pendingQueue']['minutes']==600
                expect(page.locator('.nautilus-log-template-caption')).to_have_count(0)
                page.locator('.nautilus-log-header').screenshot(path=str(OUT/f'{context}-template-header.png'))
                for language in ['en','zh']:
                    page.evaluate('language=>{nautilusLogR3.settings.language=language;dispatchEvent(new Event("nautilus-log:settings-changed"));}',language)
                    f.settle_renderer(page)
                    initial=metrics.text_content()
                    for clock in ['2026-10-29T08:00:00','2026-10-29T23:00:00']:
                        f.set_clock(page,clock)
                        assert f.state(page)['nowLabel'] is None
                        expect(page.locator('.nautilus-log-now-needle')).to_have_count(0)
                        assert metrics.text_content()==initial, 'non-date previews keep full-day capacity'
                        assert f.state(page)['pendingQueue']['minutes']==600
                        expect(page.locator('.nautilus-log-template-caption')).to_have_count(0)
                collapse=page.locator('#native-plan-caret');collapse.press('Space')
                expect(page.locator('svg.nautilus-log-svg')).to_have_count(0)
                collapse.press('Enter');f.settle_renderer(page)
                expect(metrics if width>520 else overview).to_be_visible()
                expect(page.locator('.nautilus-log-pending-queue')).to_be_visible()
                expect(page.locator('.nautilus-log-template-caption')).to_have_count(0)
                assert page.evaluate('()=>__chartHarness.sourceRows()')==original
                assert f.state(page)['writes']==0
                cases.append({'context':context,'width':width,'normalMetrics':True,'staticFullDayPreview':True,'outlinePreserved':True,'graphWrites':0})
            daily_original=prepare(page,'main',720,window='flow')
            expect(page.locator('.nautilus-log-metrics')).to_be_visible()
            expect(page.locator('.nautilus-log-pending-queue')).to_be_visible()
            expect(page.locator('.nautilus-log-template-caption')).to_have_count(0)
            assert f.state(page)['nowLabel']=='18:42'
            assert page.evaluate('()=>__chartHarness.sourceRows()')==daily_original
            assert f.state(page)['writes']==0
        finally:browser.close()
    assert not errors and not requests,(errors,requests)
    (OUT/'result.json').write_text(json.dumps({'cases':cases,'datedPlanTimeRetained':True,'pageErrors':errors,'httpRequests':requests,'componentSha256':f.sha(f.COMPONENT.read_text())},indent=2))
    print(f'PASS: normal template display preserves content and full-day preview in main/sidebar/embed; {OUT}')


if __name__=='__main__':run()
