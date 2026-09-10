#!/usr/bin/env python3
"""Actual source reader + session + adapter + both launchers. Only the host graph/time is fake."""
import json
import subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path('/tmp/nautilus-real-today-plan')
TRIGGER = '.nautilus-log-timing__trigger'
ROOT_UID = 'nautilus-log-plan-2026-09-09'


def run():
    OUT.mkdir(exist_ok=True)
    subprocess.check_call(['node', str(ROOT/'test/real-today-plan-bundle.cjs'), str(OUT)], cwd=ROOT)
    (OUT/'index.html').write_text(f'''<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="{(ROOT/'extension.css').as_uri()}"><style>
main {{padding:12px;overflow-wrap:anywhere;line-height:1.6}} body {{margin:0;font:14px system-ui;background:#f4f6f8}} .rm-topbar {{height:45px;display:flex;gap:6px;align-items:center;padding:0 12px;background:white}} .rm-find-or-create-wrapper {{margin-left:auto;width:180px}} input {{max-width:100%}} .bp3-dark {{background:#182026;color:#eee}} .bp3-dark .rm-topbar {{background:#293742}} @media(max-width:500px){{.rm-find-or-create-wrapper{{display:none}}}}
</style></head><body><div class="rm-topbar"><button aria-label="back">←</button><button aria-label="forward">→</button><div class="rm-find-or-create-wrapper"><input placeholder="Find or create"></div></div><main><h1>Unrelated page</h1></main><script src="{(OUT/'harness.js').as_uri()}"></script></body></html>''')
    failures, passed, console = [], [], []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            page = browser.new_page(viewport={'width':1100,'height':740})
            page.on('pageerror', lambda e: failures.append('Browser error: '+str(e)))
            page.on('console', lambda msg: console.append(msg.type+': '+msg.text))
            page.goto((OUT/'index.html').as_uri())
            page.set_default_timeout(6000)
            page.wait_for_load_state('networkidle')
            page.wait_for_function('!!window.realPlan')
            def mount(surface, **options):
                page.evaluate('(opts)=>realPlan.mount(opts)', {'surface':surface, **options})
            def state(status):
                page.wait_for_function('(s)=>realPlan.state().status===s', arg=status, timeout=5000)
            def check(name, fn):
                try:
                    fn()
                    passed.append(name)
                except Exception as e:
                    failures.append(name+': '+str(e))
                    page.screenshot(path=str(OUT/(name+'-FAILED.png')))
            def full_tree():
                tree=page.evaluate('realPlan.tree()')
                assert tree['string']=='[[My day]] {{[[roam/render]]:((roam-render-Nautilus-Log-cljs)) 28 25 8 "focus" 22}}'
                assert [c['string'] for c in tree['children']]==['09:00-09:30 Stand-up','{{[[TODO]]}} Write 30m ((external-note))','{{[[DONE]]}} Prepared 15m','---','((clone-3)) and ((external-note))']
                step=tree['children'][1]['children'][0]
                assert step['string']=='**First step** ((clone-1))'
                assert step['properties']=={'open':False,'heading':0,'text-align':'right','children-view-type':'document'}
                blocks=page.evaluate('realPlan.blocks()')
                assert next(b for b in blocks if b['uid']==ROOT_UID)['parentUid']=='day'
                assert next(b for b in blocks if b['uid']=='weekly-tag')['string']=='#[[2026-W37]]'
                assert next(b for b in blocks if b['uid']=='source-step')['string']=='**First step** ((source-event))'
                assert len([b for b in blocks if b['uid'].startswith('clone-')])==6
            def replacement_tree():
                tree=page.evaluate('realPlan.tree()')
                assert tree['string']=='[[My day]] {{[[roam/render]]:((roam-render-Nautilus-Log-cljs)) 28 25 8 "focus" 22}}'
                children=tree['children']
                assert [c['string'] for c in children[:4]]==['09:00-09:30 Stand-up','{{[[TODO]]}} Write 30m ((external-note))','{{[[DONE]]}} Prepared 15m','---']
                event=children[0]; step=children[1]['children'][0]
                assert step['string']==f"**First step** (({event['uid']}))"
                assert children[4]['string']==f"(({step['uid']})) and ((external-note))"
                assert step['properties']=={'open':False,'heading':0,'text-align':'right','children-view-type':'document'}
                blocks=page.evaluate('realPlan.blocks()')
                assert next(b for b in blocks if b['uid']==ROOT_UID)['parentUid']=='day'
                assert next(b for b in blocks if b['uid']=='weekly-tag')['string']=='#[[2026-W37]]'
                assert next(b for b in blocks if b['uid']=='source-step')['string']=='**First step** ((source-event))'
            def tooltip_bounds():
                page.locator(TRIGGER).focus()
                page.locator(TRIGGER).hover()
                tip=page.locator('[role="tooltip"]')
                tip.wait_for(state='visible')
                page.wait_for_function('getComputedStyle(document.querySelector(\'[role="tooltip"]\')).opacity === "1"')
                metrics=tip.evaluate('el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return {x:r.x,right:r.right,width:r.width,scroll:el.scrollWidth,client:el.clientWidth,white:s.whiteSpace,box:s.boxSizing,viewport:innerWidth}}')
                assert metrics['width']<=320 and metrics['x']>=11 and metrics['right']<=metrics['viewport']-11, metrics
                assert metrics['scroll']<=metrics['client'] and metrics['white']=='normal' and metrics['box']=='border-box', metrics
            for surface in ['launcher','execution']:
                def single():
                    mount(surface)
                    state('ready-absent')
                    assert page.locator(TRIGGER).evaluate('el=>getComputedStyle(el).height')=='30px'
                    assert ';;' not in page.locator(TRIGGER).inner_text()
                    assert page.locator('.nautilus-log-timing__energy-track:visible').count()==0
                    page.locator(TRIGGER).click()
                    state('ready-present')
                    full_tree()
                    assert ['open',ROOT_UID] in page.evaluate('realPlan.trace()')
                    assert page.locator('main [data-block-uid]').count()==7
                    if surface=='execution': assert page.locator('.nautilus-log-timing__energy-track').is_visible()
                    page.screenshot(path=str(OUT/(surface+'-single-click.png')))
                check(surface+'-single-click',single)
                def partial():
                    mount(surface,scenario='partial')
                    page.locator(TRIGGER).click();state('partial')
                    assert page.locator(TRIGGER).inner_text().endswith('Creation incomplete')
                    page.locator(TRIGGER).click()
                    assert page.get_by_role('button',name='Inspect created blocks',exact=True).is_visible()
                    page.get_by_role('button',name='Inspect created blocks',exact=True).click();state('partial')
                    assert page.locator('.nautilus-log-timing__energy-track:visible').count()==0
                    page.evaluate('realPlan.recover()')
                    page.get_by_role('button',name='Continue creation',exact=True).click();state('ready-present')
                    full_tree()
                    mount(surface,scenario='partial');page.locator(TRIGGER).click();state('partial')
                    page.evaluate('realPlan.reload()');state('partial')
                    page.locator(TRIGGER).click()
                    assert page.get_by_role('button',name='Continue creation',exact=True).count()==0
                    page.get_by_role('button',name='Inspect created blocks',exact=True).click();state('partial')
                    page.screenshot(path=str(OUT/(surface+'-reload-partial.png')))
                check(surface+'-partial',partial)
                def unsupported():
                    mount(surface,scenario='unsupported');state('ready-blocked')
                    assert ';;' not in page.locator(TRIGGER).inner_text()
                    tooltip_bounds()
                    page.screenshot(path=str(OUT/(surface+'-tooltip.png')))
                    page.locator(TRIGGER).click()
                    assert 'LOGBOOK/CLOCK history' in page.get_by_role('dialog').inner_text()
                    page.get_by_role('button',name='View template',exact=True).click()
                    assert ['open','template'] in page.evaluate('realPlan.trace()')
                    assert not [r for r in page.evaluate('realPlan.trace()') if r[0]=='request']
                check(surface+'-unsupported-tooltip',unsupported)
                def long_word():
                    mount(surface,scenario='long-word');state('ready-blocked');tooltip_bounds()
                    page.screenshot(path=str(OUT/(surface+'-long-word.png')))
                check(surface+'-long-word-tooltip',long_word)
                def navigation():
                    mount(surface,scenario='nav-failed');page.locator(TRIGGER).click();state('nav-failed')
                    page.evaluate('realPlan.recover()');page.locator(TRIGGER).click();state('ready-present')
                    full_tree()
                check(surface+'-navigation',navigation)
                def watched_recreate():
                    mount(surface)
                    page.locator(TRIGGER).click();state('ready-present');full_tree()
                    writes=page.evaluate('realPlan.writes()')
                    page.evaluate('realPlan.deleteRoot()')
                    fired=page.evaluate('realPlan.fireRoot()')
                    if surface=='execution':
                        assert fired>=1, fired
                        page.wait_for_function('realPlan.state().status==="ready-absent"')
                        assert page.evaluate('realPlan.hasRoot()') is False
                        assert page.evaluate('realPlan.writes()')==writes
                    page.locator(TRIGGER).click();state('ready-present');replacement_tree()
                    assert page.evaluate('realPlan.writes()')-writes==7
                check(surface+'-watched-recreate',watched_recreate)
                def silent_recreate():
                    mount(surface)
                    page.locator(TRIGGER).click();state('ready-present');full_tree()
                    writes=page.evaluate('realPlan.writes()')
                    nav_before=page.evaluate('realPlan.navs()')
                    page.evaluate('realPlan.deleteRoot()')
                    assert page.evaluate('realPlan.fireRoot(true)')==0
                    page.locator(TRIGGER).click();state('ready-present');replacement_tree()
                    assert page.evaluate('realPlan.writes()')-writes==7
                    nav=page.evaluate('realPlan.navs()')
                    assert len(nav)==len(nav_before)+1, nav
                    assert nav[-1][0]=='open'
                    assert page.evaluate('realPlan.popoverOpen()') is False
                    assert page.evaluate('realPlan.popoverCount()')==0
                check(surface+'-silent-recreate',silent_recreate)
                def silent_shift_alt():
                    if surface!='execution':
                        return
                    for modifier, expected in (('Shift','sidebar'),('Alt','open')):
                        mount(surface)
                        page.locator(TRIGGER).click();state('ready-present');full_tree()
                        writes=page.evaluate('realPlan.writes()')
                        nav_before=page.evaluate('realPlan.navs()')
                        page.evaluate('realPlan.deleteRoot()')
                        assert page.evaluate('realPlan.fireRoot(true)')==0
                        page.locator(TRIGGER).click(modifiers=[modifier]);state('ready-present');replacement_tree()
                        assert page.evaluate('realPlan.writes()')-writes==7
                        nav=page.evaluate('realPlan.navs()')
                        assert len(nav)==len(nav_before)+1, (modifier, nav)
                        assert nav[-1][0]==expected, (modifier, nav[-1])
                        assert page.evaluate('realPlan.popoverOpen()') is False
                check(surface+'-silent-shift-alt',silent_shift_alt)
                def present_panel_once():
                    if surface!='execution':
                        return
                    mount(surface)
                    page.locator(TRIGGER).click();state('ready-present');full_tree()
                    nav_before=page.evaluate('realPlan.navs()')
                    page.locator(TRIGGER).click()
                    page.locator('.nautilus-log-timing__popover').wait_for()
                    assert page.evaluate('realPlan.popoverCount()')==1
                    assert page.evaluate('realPlan.navs()')==nav_before
                    page.locator(TRIGGER).click()
                    page.wait_for_function('realPlan.popoverOpen()===false')
                    assert page.evaluate('realPlan.navs()')==nav_before
                    page.locator(TRIGGER).click(modifiers=['Shift'])
                    page.wait_for_function('(n)=>realPlan.navs().length===n', arg=len(nav_before)+1)
                    assert page.evaluate('realPlan.navs()')[-1][0]=='sidebar'
                    assert page.evaluate('realPlan.popoverOpen()') is False
                    page.locator(TRIGGER).click(modifiers=['Alt'])
                    page.wait_for_function('(n)=>realPlan.navs().filter(r=>r[0]==="open").length===n', arg=len([r for r in nav_before if r[0]=='open'])+1)
                    assert page.evaluate('realPlan.navs()')[-1][0]=='open'
                check(surface+'-present-panel-once',present_panel_once)
                def delayed_keep_cancelled():
                    if surface!='execution':
                        return
                    mount(surface)
                    page.locator(TRIGGER).click();state('ready-present');full_tree()
                    nav_before=page.evaluate('realPlan.navs()')
                    page.evaluate('realPlan.holdIntegrity()')
                    page.locator(TRIGGER).click()
                    assert page.evaluate('realPlan.popoverOpen()') is False
                    page.evaluate('realPlan.cleanup()')
                    page.evaluate('realPlan.releaseIntegrity()')
                    page.wait_for_timeout(80)
                    assert page.evaluate('realPlan.popoverCount()')==0
                    assert page.evaluate('realPlan.navs()')==nav_before
                check(surface+'-delayed-keep-cancelled',delayed_keep_cancelled)
                def children_only_locate():
                    mount(surface)
                    page.locator(TRIGGER).click();state('ready-present');full_tree()
                    writes=page.evaluate('realPlan.writes()')
                    page.evaluate('realPlan.deleteChildren()')
                    page.evaluate('realPlan.fireRoot()')
                    page.wait_for_timeout(50)
                    assert page.evaluate('realPlan.hasRoot()') is True
                    assert page.evaluate('realPlan.childCount()')==0
                    page.locator(TRIGGER).click()
                    if surface=='launcher':
                        state('ready-present')
                    else:
                        page.locator('.nautilus-log-timing__popover').wait_for()
                    assert page.evaluate('realPlan.writes()')==writes
                    assert page.evaluate('realPlan.childCount()')==0
                check(surface+'-children-only-no-refill',children_only_locate)
                def present_read_failed():
                    mount(surface)
                    page.locator(TRIGGER).click();state('ready-present');full_tree()
                    writes=page.evaluate('realPlan.writes()')
                    opens=len([r for r in page.evaluate('realPlan.trace()') if r[0] in ('open','sidebar')])
                    page.evaluate('realPlan.deleteRoot()')
                    page.evaluate('realPlan.fireRoot(true)')
                    page.evaluate('realPlan.failDailyRead()')
                    page.locator(TRIGGER).click()
                    dialog=page.get_by_role('dialog')
                    dialog.wait_for()
                    assert 'unreadable' in dialog.inner_text().lower()
                    assert page.evaluate('realPlan.popoverOpen()') is False
                    assert page.evaluate('realPlan.writes()')==writes
                    page.get_by_role('button',name='Check again',exact=True).click()
                    assert page.evaluate('realPlan.writes()')==writes
                    page.locator(TRIGGER).click(modifiers=['Shift'])
                    assert page.evaluate('realPlan.writes()')==writes
                    assert len([r for r in page.evaluate('realPlan.trace()') if r[0] in ('open','sidebar')])==opens
                    page.locator(TRIGGER).click(modifiers=['Alt'])
                    assert page.evaluate('realPlan.writes()')==writes
                    assert len([r for r in page.evaluate('realPlan.trace()') if r[0] in ('open','sidebar')])==opens
                check(surface+'-present-read-failed',present_read_failed)
                def replacement_keep():
                    if surface!='execution':
                        return
                    mount(surface)
                    page.locator(TRIGGER).click();state('ready-present');full_tree()
                    writes=page.evaluate('realPlan.writes()')
                    page.evaluate('realPlan.moveRootOffDay()')
                    page.evaluate('realPlan.addManualPlan()')
                    page.locator(TRIGGER).click()
                    page.locator('.nautilus-log-timing__popover').wait_for()
                    assert page.evaluate('realPlan.state().planUid')=='manual-other-plan'
                    assert page.evaluate('realPlan.runtimePlanUid()')=='manual-other-plan'
                    assert page.evaluate('realPlan.writes()')==writes
                check(surface+'-replacement-keep',replacement_keep)
                def narrow():
                    page.set_viewport_size({'width':360,'height':700})
                    mount(surface,language='zh',dark=True)
                    page.locator(TRIGGER).focus();page.keyboard.press('Enter');state('ready-present');full_tree()
                    mount(surface,scenario='unsupported',language='zh',dark=True)
                    tooltip_bounds()
                    page.screenshot(path=str(OUT/(surface+'-zh-dark-narrow.png')))
                    page.keyboard.press('Enter')
                    assert page.get_by_role('dialog').is_visible()
                    page.keyboard.press('Escape')
                    assert page.locator(TRIGGER).evaluate('el=>el===document.activeElement')
                    page.set_viewport_size({'width':1100,'height':740})
                check(surface+'-zh-dark-keyboard',narrow)
                def midnight():
                    mount(surface,scenario='midnight');page.locator(TRIGGER).click();state('read-failed');full_tree()
                    assert page.evaluate('realPlan.state().pageTitle')=='September 10th, 2026'
                    assert not [r for r in page.evaluate('realPlan.trace()') if r[0]=='open']
                check(surface+'-midnight',midnight)
                def modifiers():
                    mount(surface)
                    page.locator(TRIGGER).click(modifiers=['Shift']);state('ready-present');full_tree()
                    assert ['sidebar',ROOT_UID] in page.evaluate('realPlan.trace()')
                    page.locator(TRIGGER).click(modifiers=['Alt'])
                    assert ['open',ROOT_UID] in page.evaluate('realPlan.trace()')
                    assert len([r for r in page.evaluate('realPlan.trace()') if r[0]=='create'])==7
                check(surface+'-modifiers',modifiers)
                def delayed():
                    mount(surface,scenario='delayed')
                    page.locator(TRIGGER).click();state('creating')
                    assert page.locator(TRIGGER).is_disabled()
                    page.evaluate('realPlan.recover()');state('ready-present');full_tree()
                check(surface+'-pending-disabled',delayed)
                def read_failure():
                    mount(surface,scenario='read-failed');state('read-failed');page.locator(TRIGGER).click()
                    assert 'unavailable' in page.get_by_role('dialog').inner_text()
                    page.evaluate('realPlan.recover()')
                    page.get_by_role('button',name='Check again',exact=True).click();state('ready-absent')
                    assert not [r for r in page.evaluate('realPlan.trace()') if r[0]=='request']
                check(surface+'-read-failure',read_failure)
            def read_error():
                mount('launcher',scenario='read-failed');state('read-failed');page.locator(TRIGGER).click()
                assert 'unavailable' in page.get_by_role('dialog').inner_text()
                page.evaluate('realPlan.recover()')
                page.get_by_role('button',name='Check again',exact=True).click();state('ready-absent')
                assert not [r for r in page.evaluate('realPlan.trace()') if r[0]=='request']
            check('read-only-retry',read_error)
            for timer in ['clock','pomo']:
                def priority():
                    mount('execution',timer=timer)
                    assert page.locator('.nautilus-log-timing__elapsed').is_visible()
                    page.locator(TRIGGER).click();page.get_by_role('tab',name='Plan',exact=True).click()
                    assert page.get_by_role('button',name='View template',exact=True).is_visible()
                    page.get_by_role('button',name="+ Create today's plan",exact=True).click();state('ready-present');full_tree()
                    if timer=='pomo': assert page.locator('.nautilus-log-timing__pomodoro-close').is_visible()
                check(timer+'-priority-plan-create',priority)
            def no_provider():
                mount('execution')
                page.evaluate('realPlan.noProvider()')
                assert page.locator('.nautilus-log-timing__energy-track:visible').count()==0
                assert '100%' not in page.locator(TRIGGER).inner_text()
            check('no-provider-no-capacity',no_provider)
            def command():
                mount('launcher')
                page.evaluate('realPlan.command()');state('ready-present');full_tree()
                assert ['open',ROOT_UID] in page.evaluate('realPlan.trace()')
            check('real-command-shared-session',command)
            page.evaluate('realPlan.cleanup()')
        finally:
            browser.close()
    (OUT/'results.json').write_text(json.dumps({'passed':passed,'failures':failures},indent=2))
    (OUT/'console.log').write_text('\n'.join(console))
    print(f'Real-session browser acceptance: {len(passed)} passed, {len(failures)} failed. Artifacts: {OUT}')
    for failure in failures: print(failure)
    return bool(failures)

if __name__=='__main__': raise SystemExit(run())
