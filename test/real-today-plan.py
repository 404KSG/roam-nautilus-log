#!/usr/bin/env python3
"""Actual source reader + session + adapter + both launchers. Only the host graph/time is fake."""
import json
import subprocess
import traceback
from pathlib import Path
from unittest import SkipTest
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path('/tmp/nautilus-real-today-plan')
TRIGGER = '.nautilus-log-timing__trigger'
TOKEN = '.nautilus-log-timing__capacity-token'
ROOT_UID = 'nautilus-log-plan-2026-09-09'
DAILY_READ = 'realPlan.trace().filter(r=>r[0]==="query"&&r[1].includes("?page-uid ?uid ?string ?order ?parent-uid")).length'
HOLD_RAF_JS = '''() => {
    if (window.__nlHeldRaf) window.__nlHeldRaf.restore();
    const request=window.requestAnimationFrame, cancel=window.cancelAnimationFrame;
    const nativeSet=window.setTimeout, nativeClear=window.clearTimeout;
    const frames=new Map();
    const leaked=[];
    const marks={};
    const zeros=[];
    const zeroById=new Map();
    const nativeTimers=new Map();
    let nextId=9000000;
    let holdZero=false;
    const stats={framesRegistered:0,framesCancelled:0,framesFired:0,framesForced:0,zerosRegistered:0,zerosCancelled:0,zerosFired:0,zerosForced:0,nativeRegistered:0,nativeCancelled:0};
    const pendingZeros=()=>zeros.filter(z=>!z.cancelled&&!z.fired).length;
    window.requestAnimationFrame=fn=>{
        const handle=++nextId;
        const entry={handle,fn,fired:false,forced:false};
        frames.set(handle,entry);
        leaked.push(entry);
        stats.framesRegistered+=1;
        return handle;
    };
    window.cancelAnimationFrame=n=>{
        if (frames.delete(n)) { stats.framesCancelled+=1; return; }
        if (typeof cancel==='function') cancel.call(window,n);
    };
    window.setTimeout=(fn,delay,...args)=>{
        const ms=Number(delay)||0;
        if (holdZero && ms===0) {
            const id=++nextId;
            const entry={id,fn:()=>fn(...args),cancelled:false,fired:false};
            zeros.push(entry);
            zeroById.set(id,entry);
            stats.zerosRegistered+=1;
            return id;
        }
        let id;
        const wrapped=(...a)=>{ nativeTimers.delete(id); fn(...a); };
        id=nativeSet(wrapped,ms,...args);
        nativeTimers.set(id,{id,delay:ms,cancelled:false});
        stats.nativeRegistered+=1;
        return id;
    };
    window.clearTimeout=n=>{
        const z=zeroById.get(n);
        if (z) {
            if (!z.cancelled && !z.fired) { z.cancelled=true; stats.zerosCancelled+=1; }
            return;
        }
        const t=nativeTimers.get(n);
        if (t && !t.cancelled) { t.cancelled=true; stats.nativeCancelled+=1; nativeTimers.delete(n); }
        nativeClear(n);
    };
    const runFrames=(name,force)=>{
        let n=0;
        holdZero=true;
        try {
            (marks[name]||[]).forEach(entry=>{
                if (!force && (entry.fired || entry.forced || !frames.has(entry.handle))) return;
                frames.delete(entry.handle);
                if (force) { entry.forced=true; stats.framesForced+=1; }
                else { entry.fired=true; stats.framesFired+=1; }
                n+=1;
                entry.fn(performance.now());
            });
        } finally { holdZero=false; }
        return n;
    };
    window.__nlHeldRaf={
        size(){ return frames.size; },
        pendingZeros,
        snapshotHandles(){ return [...frames.keys()]; },
        stats(){ return Object.assign({},stats,{pendingFrames:frames.size,pendingZeros:pendingZeros()}); },
        mark(name){ marks[name]=leaked.slice(); },
        fireMark(name){ return runFrames(name,false); },
        forceMark(name){ return runFrames(name,true); },
        firePendingZeros(){
            const pending=zeros.filter(z=>!z.cancelled&&!z.fired);
            pending.forEach(z=>{ z.fired=true; stats.zerosFired+=1; z.fn(); });
            return pending.length;
        },
        forceCancelledZeros(){
            const cancelled=zeros.filter(z=>z.cancelled&&!z.fired);
            cancelled.forEach(z=>{ z.fired=true; stats.zerosForced+=1; z.fn(); });
            return cancelled.length;
        },
        restore(){
            window.requestAnimationFrame=request;
            window.cancelAnimationFrame=cancel;
            window.setTimeout=nativeSet;
            window.clearTimeout=nativeClear;
            frames.clear(); leaked.length=0; zeros.length=0; zeroById.clear(); nativeTimers.clear();
            window.__nlHeldRaf=null;
        }
    };
}'''
RESTORE_RAF_JS = '() => window.__nlHeldRaf && window.__nlHeldRaf.restore()'


def run():
    OUT.mkdir(exist_ok=True)
    subprocess.check_call(['node', str(ROOT/'test/real-today-plan-bundle.cjs'), str(OUT)], cwd=ROOT)
    (OUT/'index.html').write_text(f'''<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="{(ROOT/'extension.css').as_uri()}"><style>
main {{padding:12px;overflow-wrap:anywhere;line-height:1.6}} body {{margin:0;font:14px system-ui;background:#f4f6f8}} .rm-topbar {{height:45px;display:flex;gap:6px;align-items:center;padding:0 12px;background:white}} .rm-find-or-create-wrapper {{margin-left:auto;width:180px}} input {{max-width:100%}} .bp3-dark {{background:#182026;color:#eee}} .bp3-dark .rm-topbar {{background:#293742}} @media(max-width:500px){{.rm-find-or-create-wrapper{{display:none}}}}
</style></head><body><div class="rm-topbar"><button aria-label="back">←</button><button aria-label="forward">→</button><div class="rm-find-or-create-wrapper"><input placeholder="Find or create"></div></div><main><h1>Unrelated page</h1></main><script src="{(OUT/'harness.js').as_uri()}"></script></body></html>''')
    failures, passed, skipped, console = [], [], [], []
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
                except SkipTest:
                    skipped.append(name)
                except Exception:
                    failures.append(name+': '+traceback.format_exc())
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
                        raise SkipTest('launcher has no execution popover seam')
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
                        raise SkipTest('launcher has no execution popover seam')
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
                def responsive_popup():
                    if surface!='execution':
                        raise SkipTest('launcher has no execution popover seam')
                    mount(surface)
                    page.locator(TRIGGER).click();state('ready-present');full_tree()
                    reads=page.evaluate(DAILY_READ)
                    # Hold the scheduling boundary, not the app/session. The
                    # shell must be usable before graph validation can start.
                    # Snapshot open/close in one turn so a later bounded timer
                    # cannot start validation before this check.
                    page.evaluate(HOLD_RAF_JS)
                    try:
                        snap=page.evaluate('''() => {
                            const reads=()=>realPlan.trace().filter(r=>r[0]==="query"&&r[1].includes("?page-uid ?uid ?string ?order ?parent-uid")).length;
                            const before=reads();
                            document.querySelector('.nautilus-log-timing__capacity-token').click();
                            const dialog=document.querySelector('.nautilus-log-timing__popover');
                            const opened={
                                visible:Boolean(dialog),
                                busy:dialog?dialog.getAttribute('aria-busy'):null,
                                buttons:dialog?dialog.querySelectorAll('button').length:0,
                                header:Boolean(dialog?.querySelector('.nautilus-log-timing__popover-header')),
                                labels:dialog?[...dialog.querySelectorAll('.nautilus-log-timing__tab')].map(el=>el.textContent):[],
                                checkingText:Boolean(dialog?.textContent.includes("Checking today's plan")),
                                rows:dialog?dialog.querySelectorAll('[data-task-uid]').length:0,
                                reads:reads()-before,
                            };
                            document.querySelector('.nautilus-log-timing__trigger').click();
                            return Object.assign(opened,{closed:!realPlan.popoverOpen(),readsAfterClose:reads()-before});
                        }''')
                        assert snap['visible']
                        assert snap['busy']=='true'
                        assert snap['buttons']==0, 'unverified data must expose no actions'
                        assert snap['header'], 'pending must retain the panel chrome, not a standalone checking message'
                        assert snap['labels']==['Timing','Plan','Review'], snap
                        assert not snap['checkingText'], 'ready-plan clicks must not flash Checking text'
                        assert snap['rows']==0, 'pending must not present cached task rows as validated'
                        assert snap['reads']==0
                        assert snap['closed']
                        assert snap['readsAfterClose']==0
                    finally:
                        page.evaluate(RESTORE_RAF_JS)
                    page.wait_for_timeout(60)
                    assert page.evaluate('realPlan.popoverOpen()') is False
                    assert page.evaluate(DAILY_READ)==reads
                    page.locator(TOKEN).click()
                    page.wait_for_selector('.nautilus-log-timing__popover[aria-busy="false"]')
                    assert page.get_by_role('tab',name='Plan',exact=True).get_attribute('aria-selected')=='true'
                    assert page.evaluate(DAILY_READ)==reads+1
                    # Ordinary close must not perform even an indexed graph read.
                    close=page.evaluate('''() => {
                        const reads=()=>realPlan.trace().filter(r=>r[0]==='query'||r[0]==='pull').length;
                        const before=reads();
                        document.querySelector('.nautilus-log-timing__trigger').click();
                        return {closed:!realPlan.popoverOpen(),reads:reads()-before};
                    }''')
                    assert close=={'closed':True,'reads':0}, close
                check(surface+'-responsive-popup',responsive_popup)
                def held_raf_bounded_ready():
                    if surface!='execution':
                        raise SkipTest('launcher has no execution popover seam')
                    mount(surface)
                    page.locator(TRIGGER).click();state('ready-present');full_tree()
                    reads=page.evaluate(DAILY_READ)
                    page.evaluate(HOLD_RAF_JS)
                    try:
                        snap=page.evaluate('''() => {
                            const reads=()=>realPlan.trace().filter(r=>r[0]==="query"&&r[1].includes("?page-uid ?uid ?string ?order ?parent-uid")).length;
                            const before=reads();
                            document.querySelector('.nautilus-log-timing__capacity-token').click();
                            const dialog=document.querySelector('.nautilus-log-timing__popover');
                            window.__nlHeldRaf.mark('open');
                            return {
                                visible:Boolean(dialog),
                                busy:dialog?dialog.getAttribute('aria-busy'):null,
                                buttons:dialog?dialog.querySelectorAll('button').length:0,
                                reads:reads()-before,
                                pendingFrames:window.__nlHeldRaf.size(),
                                pendingZeros:window.__nlHeldRaf.pendingZeros(),
                            };
                        }''')
                        assert snap['visible'] and snap['busy']=='true', snap
                        assert snap['buttons']==0
                        assert snap['reads']==0
                        assert snap['pendingFrames']>=1, snap
                        assert snap['pendingZeros']==0, snap
                        page.wait_for_selector('.nautilus-log-timing__popover[aria-busy="false"]', timeout=800)
                        dialog=page.locator('.nautilus-log-timing__popover')
                        assert dialog.locator('[data-task-uid]').count()>=1
                        assert dialog.locator('.nautilus-log-timing__row-actions button').count()>=1
                        ready_reads=page.evaluate(DAILY_READ)
                        assert ready_reads==reads+1
                        st=page.evaluate('window.__nlHeldRaf.stats()')
                        assert st['pendingFrames']==0, st
                        assert st['framesCancelled']>=1, st
                        forced=page.evaluate('window.__nlHeldRaf.forceMark("open")')
                        assert forced>=1, 'must force the cancelled rAF, not an empty run'
                        assert page.evaluate(DAILY_READ)==ready_reads, 'late cancelled rAF must not reread'
                        assert page.evaluate('realPlan.popoverCount()')==1
                    finally:
                        page.evaluate(RESTORE_RAF_JS)
                check(surface+'-held-raf-bounded-ready',held_raf_bounded_ready)
                def held_raf_stale_callbacks():
                    if surface!='execution':
                        raise SkipTest('launcher has no execution popover seam')
                    mount(surface)
                    page.locator(TRIGGER).click();state('ready-present');full_tree()
                    reads=page.evaluate(DAILY_READ)
                    page.evaluate(HOLD_RAF_JS)
                    try:
                        snap=page.evaluate('''() => {
                            const reads=()=>realPlan.trace().filter(r=>r[0]==="query"&&r[1].includes("?page-uid ?uid ?string ?order ?parent-uid")).length;
                            const before=reads();
                            document.querySelector('.nautilus-log-timing__capacity-token').click();
                            const dialog=document.querySelector('.nautilus-log-timing__popover');
                            window.__nlHeldRaf.mark('first');
                            const fired=window.__nlHeldRaf.fireMark('first');
                            return {
                                visible:Boolean(dialog),
                                busy:dialog?dialog.getAttribute('aria-busy'):null,
                                buttons:dialog?dialog.querySelectorAll('button').length:0,
                                reads:reads()-before,
                                fired,
                                pendingFrames:window.__nlHeldRaf.size(),
                                pendingZeros:window.__nlHeldRaf.pendingZeros(),
                            };
                        }''')
                        assert snap['visible'] and snap['busy']=='true', snap
                        assert snap['buttons']==0
                        assert snap['reads']==0
                        assert snap['fired']>=1, snap
                        assert snap['pendingZeros']>=1, 'rAF arrival must leave a held 0ms yield'
                        assert snap['pendingFrames']==0, snap
                        page.wait_for_selector('.nautilus-log-timing__popover[aria-busy="false"]', timeout=800)
                        ready_reads=page.evaluate(DAILY_READ)
                        assert ready_reads==reads+1
                        rows=page.evaluate('[...document.querySelectorAll("[data-task-uid]")].map(row=>row.dataset.taskUid)')
                        assert rows
                        st=page.evaluate('window.__nlHeldRaf.stats()')
                        assert st['zerosCancelled']>=1, st
                        empty=page.evaluate('window.__nlHeldRaf.firePendingZeros()')
                        assert empty==0, 'cancelled 0ms must not run on the normal queue'
                        forced=page.evaluate('window.__nlHeldRaf.forceCancelledZeros()')
                        assert forced>=1, 'must force the cancelled 0ms, not an empty run'
                        assert page.evaluate(DAILY_READ)==ready_reads, 'late 0ms must not reread after fallback won'
                        assert page.evaluate('realPlan.popoverCount()')==1
                        assert page.evaluate('[...document.querySelectorAll("[data-task-uid]")].map(row=>row.dataset.taskUid)')==rows
                    finally:
                        page.evaluate(RESTORE_RAF_JS)
                check(surface+'-held-raf-stale-callbacks',held_raf_stale_callbacks)
                def held_raf_close_reopen_stale():
                    if surface!='execution':
                        raise SkipTest('launcher has no execution popover seam')
                    mount(surface)
                    page.locator(TRIGGER).click();state('ready-present');full_tree()
                    reads=page.evaluate(DAILY_READ)
                    page.evaluate(HOLD_RAF_JS)
                    try:
                        first=page.evaluate('''() => {
                            const reads=()=>realPlan.trace().filter(r=>r[0]==="query"&&r[1].includes("?page-uid ?uid ?string ?order ?parent-uid")).length;
                            const before=reads();
                            document.querySelector('.nautilus-log-timing__capacity-token').click();
                            window.__nlHeldRaf.mark('first');
                            const fired=window.__nlHeldRaf.fireMark('first');
                            const opened=Boolean(document.querySelector('.nautilus-log-timing__popover[aria-busy="true"]'));
                            const pendingZeros=window.__nlHeldRaf.pendingZeros();
                            document.querySelector('.nautilus-log-timing__trigger').click();
                            const st=window.__nlHeldRaf.stats();
                            return {opened, closed:!realPlan.popoverOpen(), fired, pendingZeros, reads:reads()-before, zerosCancelled:st.zerosCancelled, nativeCancelled:st.nativeCancelled};
                        }''')
                        assert first['opened'] and first['closed'], first
                        assert first['fired']>=1, first
                        assert first['pendingZeros']>=1, first
                        assert first['reads']==0, first
                        assert first['zerosCancelled']>=1, first
                        assert first['nativeCancelled']>=1, first
                        second=page.evaluate('''() => {
                            const reads=()=>realPlan.trace().filter(r=>r[0]==="query"&&r[1].includes("?page-uid ?uid ?string ?order ?parent-uid")).length;
                            const before=reads();
                            document.querySelector('.nautilus-log-timing__capacity-token').click();
                            const dialog=document.querySelector('.nautilus-log-timing__popover');
                            const handles=window.__nlHeldRaf.snapshotHandles();
                            const forcedFrames=window.__nlHeldRaf.forceMark('first');
                            const forcedZeros=window.__nlHeldRaf.forceCancelledZeros();
                            const after=window.__nlHeldRaf.snapshotHandles();
                            return {
                                visible:Boolean(dialog),
                                busy:dialog?dialog.getAttribute('aria-busy'):null,
                                buttons:dialog?dialog.querySelectorAll('button').length:0,
                                reads:reads()-before,
                                held:handles.length,
                                after:after.length,
                                same:JSON.stringify(handles)===JSON.stringify(after),
                                forcedFrames,
                                forcedZeros,
                            };
                        }''')
                        assert second['visible'] and second['busy']=='true', second
                        assert second['buttons']==0
                        assert second['reads']==0
                        assert second['held']>=1, second
                        assert second['same'], second
                        assert second['forcedFrames']>=1, second
                        assert second['forcedZeros']>=1, second
                        page.wait_for_selector('.nautilus-log-timing__popover[aria-busy="false"]', timeout=800)
                        assert page.locator('.nautilus-log-timing__popover [data-task-uid]').count()>=1
                        assert page.evaluate('realPlan.popoverCount()')==1
                        assert page.evaluate(DAILY_READ)==reads+1, 'cancelled first wait must not read; reopen reads once'
                        closed=page.evaluate('''() => {
                            const reads=()=>realPlan.trace().filter(r=>r[0]==="query"&&r[1].includes("?page-uid ?uid ?string ?order ?parent-uid")).length;
                            const before=reads();
                            document.querySelector('.nautilus-log-timing__trigger').click();
                            window.__nlHeldRaf.forceMark('first');
                            window.__nlHeldRaf.forceCancelledZeros();
                            return {closed:!realPlan.popoverOpen(), count:realPlan.popoverCount(), reads:reads()-before};
                        }''')
                        assert closed=={'closed':True,'count':0,'reads':0}, closed
                    finally:
                        page.evaluate(RESTORE_RAF_JS)
                check(surface+'-held-raf-close-reopen-stale',held_raf_close_reopen_stale)
                def held_raf_cancel():
                    if surface!='execution':
                        raise SkipTest('launcher has no execution popover seam')
                    for action in ['escape','outside','destroy']:
                        mount(surface)
                        page.locator(TRIGGER).click();state('ready-present');full_tree()
                        reads=page.evaluate(DAILY_READ)
                        page.evaluate(HOLD_RAF_JS)
                        try:
                            snap=page.evaluate('''(action)=>{
                                const reads=()=>realPlan.trace().filter(r=>r[0]==="query"&&r[1].includes("?page-uid ?uid ?string ?order ?parent-uid")).length;
                                const before=reads();
                                document.querySelector('.nautilus-log-timing__capacity-token').click();
                                const dialog=document.querySelector('.nautilus-log-timing__popover');
                                const openedFrames=window.__nlHeldRaf.size();
                                if(action==='escape'){
                                    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
                                }else if(action==='outside'){
                                    document.querySelector('main').dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,clientX:5,clientY:5,view:window}));
                                }else{
                                    realPlan.cleanup();
                                }
                                const st=window.__nlHeldRaf.stats();
                                return {
                                    visible:Boolean(dialog),
                                    busy:dialog?dialog.getAttribute('aria-busy'):null,
                                    buttons:dialog?dialog.querySelectorAll('button').length:0,
                                    openedFrames,
                                    closed:!realPlan.popoverOpen(),
                                    reads:reads()-before,
                                    framesCancelled:st.framesCancelled,
                                    nativeCancelled:st.nativeCancelled,
                                    pendingFrames:window.__nlHeldRaf.size(),
                                    pendingZeros:window.__nlHeldRaf.pendingZeros(),
                                    zerosRegistered:st.zerosRegistered,
                                };
                            }''', action)
                            assert snap['visible'] and snap['busy']=='true', (action, snap)
                            assert snap['buttons']==0, (action, snap)
                            assert snap['openedFrames']>=1, (action, snap)
                            assert snap['closed'], (action, snap)
                            assert snap['reads']==0, (action, snap)
                            assert snap['framesCancelled']>=1, (action, snap)
                            assert snap['nativeCancelled']>=1, (action, snap)
                            assert snap['pendingFrames']==0, (action, snap)
                            assert snap['pendingZeros']==0, (action, snap)
                            after=page.evaluate('''() => new Promise(resolve=>{
                                const reads=()=>realPlan.trace().filter(r=>r[0]==="query"&&r[1].includes("?page-uid ?uid ?string ?order ?parent-uid")).length;
                                const before=reads();
                                const empty=window.__nlHeldRaf.firePendingZeros();
                                setTimeout(()=>{
                                    resolve({
                                        empty,
                                        open:realPlan.popoverOpen(),
                                        count:realPlan.popoverCount(),
                                        reads:reads()-before,
                                    });
                                }, 80);
                            })''')
                            assert after['empty']==0, (action, after)
                            assert after['open'] is False, (action, after)
                            assert after['count']==0, (action, after)
                            assert after['reads']==0, (action, after)
                            assert page.evaluate(DAILY_READ)==reads, action
                        finally:
                            page.evaluate(RESTORE_RAF_JS)
                check(surface+'-held-raf-cancel',held_raf_cancel)
                def no_raf_compat():
                    if surface!='execution':
                        raise SkipTest('launcher has no execution popover seam')
                    mount(surface)
                    page.locator(TRIGGER).click();state('ready-present');full_tree()
                    page.evaluate('''() => {
                        window.__nlOrigRaf=window.requestAnimationFrame;
                        window.__nlOrigCaf=window.cancelAnimationFrame;
                        window.requestAnimationFrame=undefined;
                        window.cancelAnimationFrame=undefined;
                    }''')
                    try:
                        page.locator(TOKEN).click()
                        page.wait_for_selector('.nautilus-log-timing__popover[aria-busy="false"]', timeout=800)
                        assert page.locator('.nautilus-log-timing__popover [data-task-uid]').count()>=1
                        assert page.locator('.nautilus-log-timing__row-actions button').count()>=1
                    finally:
                        page.evaluate('''() => {
                            if (window.__nlOrigRaf) window.requestAnimationFrame=window.__nlOrigRaf;
                            if (window.__nlOrigCaf) window.cancelAnimationFrame=window.__nlOrigCaf;
                        }''')
                check(surface+'-no-raf-compat',no_raf_compat)
                def paint_yield_before_read():
                    if surface!='execution':
                        raise SkipTest('launcher has no execution popover seam')
                    mount(surface)
                    page.locator(TRIGGER).click();state('ready-present');full_tree()
                    snap=page.evaluate('''() => {
                        const reads=()=>realPlan.trace().filter(r=>r[0]==="query"&&r[1].includes("?page-uid ?uid ?string ?order ?parent-uid")).length;
                        const orig=window.requestAnimationFrame;
                        let registered=0;
                        window.requestAnimationFrame=fn=>{registered+=1;return orig.call(window, fn);};
                        const before=reads();
                        document.querySelector('.nautilus-log-timing__capacity-token').click();
                        const dialog=document.querySelector('.nautilus-log-timing__popover');
                        const sync={
                            registered,
                            busy:dialog?dialog.getAttribute('aria-busy'):null,
                            buttons:dialog?dialog.querySelectorAll('button').length:0,
                            reads:reads()-before,
                        };
                        window.requestAnimationFrame=orig;
                        return sync;
                    }''')
                    assert snap['registered']>=1, 'healthy path must still request a paint opportunity'
                    assert snap['busy']=='true'
                    assert snap['buttons']==0
                    assert snap['reads']==0, 'click must not read the Daily Note before a paint yield'
                    page.wait_for_selector('.nautilus-log-timing__popover[aria-busy="false"]')
                    assert page.locator('.nautilus-log-timing__popover [data-task-uid]').count()>=1
                check(surface+'-paint-yield-before-read',paint_yield_before_read)
                def delayed_keep_cancelled():
                    if surface!='execution':
                        raise SkipTest('launcher has no execution popover seam')
                    mount(surface)
                    page.locator(TRIGGER).click();state('ready-present');full_tree()
                    nav_before=page.evaluate('realPlan.navs()')
                    page.evaluate('realPlan.holdIntegrity()')
                    page.locator(TRIGGER).click()
                    page.wait_for_selector('.nautilus-log-timing__popover[aria-busy="true"]')
                    assert page.locator('.nautilus-log-timing__popover button').count()==0
                    page.evaluate('realPlan.cleanup()')
                    page.evaluate('realPlan.releaseIntegrity()')
                    page.wait_for_timeout(80)
                    assert page.evaluate('realPlan.popoverCount()')==0
                    assert page.evaluate('realPlan.navs()')==nav_before
                check(surface+'-delayed-keep-cancelled',delayed_keep_cancelled)
                def dismiss_pending():
                    if surface!='execution':
                        raise SkipTest('launcher has no execution popover seam')
                    for action in ['escape','outside','trigger']:
                        mount(surface)
                        page.locator(TRIGGER).click();state('ready-present')
                        writes=page.evaluate('realPlan.writes()')
                        nav=page.evaluate('realPlan.navs()')
                        page.evaluate('realPlan.holdIntegrity()')
                        page.locator(TRIGGER).click();state('checking')
                        assert page.locator('.nautilus-log-timing__popover').get_attribute('aria-busy')=='true'
                        assert page.locator('.nautilus-log-timing__popover button').count()==0
                        assert "Checking today's plan" not in page.locator(TRIGGER).inner_text(), 'validation must not replace the existing topbar display'
                        assert not page.locator(TRIGGER).is_disabled()
                        if action=='escape':
                            page.keyboard.press('Escape')
                            assert page.locator(TRIGGER).evaluate('el=>el===document.activeElement'), 'Escape must restore trigger focus during the read'
                        elif action=='outside':
                            page.locator('main').click(position={'x':5,'y':5})
                        else:
                            page.locator(TRIGGER).click()
                        assert page.evaluate('realPlan.popoverOpen()') is False
                        page.evaluate('realPlan.releaseIntegrity()');state('ready-present')
                        page.wait_for_timeout(60)
                        assert page.evaluate('realPlan.popoverOpen()') is False
                        assert page.evaluate('realPlan.writes()')==writes
                        assert page.evaluate('realPlan.navs()')==nav
                check(surface+'-dismiss-pending',dismiss_pending)
                def pending_graph_changed():
                    if surface!='execution':
                        raise SkipTest('launcher has no execution popover seam')
                    mount(surface)
                    page.locator(TRIGGER).click();state('ready-present')
                    writes=page.evaluate('realPlan.writes()')
                    page.evaluate('realPlan.holdIntegrity()')
                    page.locator(TRIGGER).click();state('checking')
                    page.evaluate('() => {window.roamAlphaAPI={...window.roamAlphaAPI,graph:{name:"other-graph"}};realPlan.releaseIntegrity();}')
                    state('read-failed')
                    page.wait_for_timeout(60)
                    assert page.evaluate('realPlan.popoverCount()')==0, 'old checking shell must not survive a graph switch'
                    assert page.evaluate('realPlan.writes()')==writes
                check(surface+'-pending-graph-changed',pending_graph_changed)
                def confirmed_rows_are_fresh():
                    if surface!='execution':
                        raise SkipTest('launcher has no execution popover seam')
                    mount(surface)
                    page.locator(TRIGGER).click();state('ready-present')
                    # Simulate a host edit with a missed watch notification.
                    uid=page.evaluate('''() => {
                        const task=realPlan.blocks().find(b=>b.parentUid==='nautilus-log-plan-2026-09-09'&&b.string.startsWith('{{[[TODO]]}} Write'));
                        task.string=task.string.replace('TODO','DONE');
                        window.readyTaskUids=null;
                        const observer=new MutationObserver(()=>{
                            const panel=document.querySelector('.nautilus-log-timing__popover[aria-busy="false"]');
                            if(!panel)return;
                            window.readyTaskUids=[...panel.querySelectorAll('[data-task-uid]')].map(row=>row.dataset.taskUid);
                            observer.disconnect();
                        });
                        observer.observe(document.body,{subtree:true,attributes:true,attributeFilter:['aria-busy']});
                        return task.uid;
                    }''')
                    page.locator('.nautilus-log-timing__capacity-token').click()
                    page.wait_for_function('window.readyTaskUids !== null')
                    assert uid not in page.evaluate('window.readyTaskUids'), 'confirmed panel must not briefly offer actions on a stale task'
                check(surface+'-confirmed-rows-are-fresh',confirmed_rows_are_fresh)
                def unchanged_refresh():
                    if surface!='execution':
                        raise SkipTest('launcher has no execution popover seam')
                    mount(surface)
                    page.locator(TRIGGER).click();state('ready-present')
                    page.locator('.nautilus-log-timing__capacity-token').click()
                    page.wait_for_selector('.nautilus-log-timing__popover[aria-busy="false"]')
                    page.evaluate('''() => {
                        window.retainedAction=document.querySelector('.nautilus-log-timing__icon-button.is-complete');
                        retainedAction.focus();
                    }''')
                    page.evaluate('realPlan.refresh()')
                    assert page.evaluate('retainedAction.isConnected && document.activeElement === retainedAction'), 'unchanged refresh must retain action nodes and focus'
                check(surface+'-unchanged-refresh',unchanged_refresh)
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
                        raise SkipTest('launcher has no execution popover seam')
                    mount(surface)
                    page.locator(TRIGGER).click();state('ready-present');full_tree()
                    writes=page.evaluate('realPlan.writes()')
                    page.evaluate('realPlan.moveRootOffDay()')
                    page.evaluate('realPlan.addManualPlan()')
                    page.locator(TRIGGER).click()
                    page.wait_for_selector('.nautilus-log-timing__popover[aria-busy="false"]')
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
    (OUT/'results.json').write_text(json.dumps({'passed':passed,'skipped':skipped,'failures':failures},indent=2))
    (OUT/'console.log').write_text('\n'.join(console))
    print(f'Real-session browser acceptance: {len(passed)} passed, {len(skipped)} skipped, {len(failures)} failed. Artifacts: {OUT}')
    for failure in failures: print(failure)
    return bool(failures)

if __name__=='__main__': raise SystemExit(run())
