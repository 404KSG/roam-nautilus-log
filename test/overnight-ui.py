#!/usr/bin/env python3
"""Real runtime, active-plan controller and topbar on an isolated overnight graph."""
import json
import os
import subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
ROOT=Path(__file__).resolve().parents[1]
BASE=Path(os.environ.get('NAUTILUS_OVERNIGHT_OUT','/tmp/nautilus-overnight-ui'))
OUT=BASE;n=1
while OUT.exists():OUT=BASE.with_name(f'{BASE.name}-{n}');n+=1
OUT.mkdir(parents=True)
TRIGGER='.nautilus-log-timing__trigger'


def run(page,kind):
    errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
    options={'scenario':'overnight','surface':'light' if kind=='light' else 'execution','calendarPlan':kind!='light',
             'language':'zh' if kind=='own-window' else 'en','ownWindow':kind=='own-window'}
    if kind=='running-end':options['timer']='clock'
    page.evaluate('(options)=>realPlan.mount(options)',options)
    page.wait_for_function('realPlan.state().activeWorkday===true && realPlan.state().planUid==="night-plan"')
    if kind=='light':
        expect(page.locator(TRIGGER)).to_have_attribute('aria-label','Open the active plan for November 1st, 2026')
        page.locator(TRIGGER).click();page.wait_for_function('realPlan.navs().at(-1)?.[1]==="night-plan"')
        assert page.evaluate('realPlan.writes()')==0
        page.evaluate('()=>realPlan.command()')
        page.wait_for_function('realPlan.calendarState().status==="ready-present"')
        blocks=page.evaluate('realPlan.blocks()')
        roots=[row for row in blocks if row['uid']=='nautilus-log-plan-2026-11-02']
        assert len(roots)==1 and roots[0]['parentUid']=='11-02-2026'
        assert page.evaluate('realPlan.state().planUid')=='night-plan'
        assert len([row for row in blocks if row['parentUid']=='11-01-2026'])==1
    else:
        page.locator(TRIGGER).click();page.wait_for_selector('.nautilus-log-timing__popover')
        page.get_by_role('tab',name='计划' if kind=='own-window' else 'Plan',exact=True).click()
        expect(page.locator('.nautilus-log-timing__workday')).to_contain_text('November 1st, 2026')
        expect(page.locator('.nautilus-log-timing__workday')).to_contain_text('02:00')
        assert page.evaluate('realPlan.runtimeSnapshot().planSnapshot.execution.availableMinutes')==90
        row=page.locator('.nautilus-log-timing__row[data-task-uid="night-task"]')
        expect(row).to_contain_text('00:30');expect(row).to_contain_text('02:00')
        page.get_by_role('tab',name='复盘' if kind=='own-window' else 'Review',exact=True).click()
        review=page.locator('.nautilus-log-timing__review-row[data-task-uid="night-done"]')
        expect(review.locator('.nautilus-log-timing__review-actual')).to_contain_text('45m')
        assert page.evaluate('realPlan.runtimeSnapshot().dailyReview.summary.actualMinutes')==45
        if kind=='running-end':
            before=page.evaluate('realPlan.blocks().find(row=>row.uid==="night-running").string')
            page.evaluate('()=>realPlan.advanceInstant("2026-11-02T02:00:00")')
            assert page.evaluate('realPlan.runtimePlanUid()')=='today-plan'
            assert page.evaluate('realPlan.blocks().find(row=>row.uid==="night-running").string')==before
            page.get_by_role('tab',name='Timing',exact=True).click()
            old=page.locator('.nautilus-log-timing__row[data-task-uid="night-task"]')
            expect(old).to_contain_text('November 1st, 2026')
            expect(old.locator('[data-focus-key="complete"]')).to_be_disabled()
            expect(old.locator('[data-focus-key="clock"]')).to_be_enabled()
            old.locator('[data-focus-key="clock"]').click()
            page.wait_for_function('realPlan.blocks().find(row=>row.uid==="night-running").string.includes("--")')
            assert 'TODO' in page.evaluate('realPlan.blocks().find(row=>row.uid==="night-task").string')
        else:
            page.get_by_role('tab',name='计划' if kind=='own-window' else 'Plan',exact=True).click()
            action=page.locator('.nautilus-log-timing__calendar-plan')
            expect(action).to_contain_text('November 2nd, 2026')
            action.click();page.wait_for_function('realPlan.navs().at(-1)?.[1]==="today-plan"')
            assert page.evaluate('realPlan.writes()')==0
            assert page.evaluate('realPlan.runtimePlanUid()')=='night-plan'
    page.screenshot(path=str(OUT/f'{kind}.png'),full_page=True)
    assert not errors,errors
    return {'case':kind,'activeOwner':page.evaluate('realPlan.state().pageTitle'),'calendar':page.evaluate('realPlan.calendarState().pageTitle'),
            'writes':page.evaluate('realPlan.writes()'),'navigation':page.evaluate('realPlan.navs()'),'errors':errors}


if __name__=='__main__':
    subprocess.check_call(['node',str(ROOT/'test/real-today-plan-bundle.cjs'),str(OUT)],cwd=ROOT)
    (OUT/'index.html').write_text(f'''<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="{(ROOT/'extension.css').as_uri()}">
<style>body{{margin:0;font:14px system-ui}}main{{padding:16px}}.rm-topbar{{height:45px;display:flex;gap:6px;align-items:center;padding:0 12px}}.rm-find-or-create-wrapper{{margin-left:auto;width:180px}}</style>
</head><body><div class="rm-topbar"><button aria-label="back">←</button><button aria-label="forward">→</button><div class="rm-find-or-create-wrapper"><input placeholder="Find or create"></div></div><main></main><script src="{(OUT/'harness.js').as_uri()}"></script></body></html>''')
    report=[]
    with sync_playwright() as p:
        browser=p.chromium.launch()
        try:
            for kind in ['light','execution','own-window','running-end']:
                page=browser.new_page(viewport={'width':1100,'height':800})
                try:
                    page.goto((OUT/'index.html').as_uri());page.wait_for_function('!!window.realPlan')
                    report.append(run(page,kind))
                except Exception:
                    page.screenshot(path=str(OUT/f'{kind}-failure.png'),full_page=True)
                    (OUT/f'{kind}-failure.json').write_text(json.dumps({'body':page.locator('body').inner_text(),
                        'state':page.evaluate('realPlan.state()'),'runtime':page.evaluate('realPlan.runtimeSnapshot()')},ensure_ascii=False,indent=2,default=str))
                    raise
                finally:page.close()
        finally:browser.close()
    (OUT/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    print(json.dumps({'passed':len(report),'artifacts':str(OUT)}))
