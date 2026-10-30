#!/usr/bin/env python3
"""Exact-source SCI/Reagent gate: every source record belongs in the diagram.

The former footer/scroll acceptance was explicitly rejected. Frame height now
uses the full source titles, never the clock's scheduled subset. This remains
an isolated synthetic renderer, not a live Roam Desktop certification.
"""
import hashlib
import json
import os
import re
import subprocess
from pathlib import Path
from urllib.parse import urlencode
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
COMPONENT = ROOT / 'src/component.cljs'
NODE_MODULES = Path(os.environ.get('NAUTILUS_NODE_MODULES', ROOT / 'node_modules'))
NATIVE_CSS = [Path(p) for p in os.environ.get('NAUTILUS_NATIVE_CSS', '').split(os.pathsep) if p]
BASE = Path(os.environ.get('NAUTILUS_RENDERER_OUT', '/tmp/nautilus-renderer'))
OUT = BASE
suffix = 1
while OUT.exists():
    OUT = BASE.with_name(f'{BASE.name}-{suffix}'); suffix += 1
OUT.mkdir(parents=True)
EXPECTED_WARNINGS = ('ReactDOM.render is no longer supported', 'Each child in a list should have a unique "key" prop')
CLOCKS = ['2026-10-29T08:01:00', '2026-10-29T10:30:00', '2026-10-29T15:00:00',
          '2026-10-29T20:59:00', '2026-10-29T21:00:00', '2026-10-29T21:01:00', '2026-10-30T01:00:00']
NIGHT = ['2026-10-29T21:00:00', '2026-10-29T23:59:00', '2026-10-30T00:00:00',
         '2026-10-30T01:59:00', '2026-10-30T02:00:00', '2026-10-30T02:01:00']


def sha(text):
    return hashlib.sha256(text.encode()).hexdigest()


def script_tag(source, marker):
    assert '</script' not in source.lower()
    return f'<script type="application/x-scittle" data-chart-eval="{marker}">{source}</script>'


def write_page(source):
    shim = '''(ns roam.datascript)
(defn q [query & args] (.apply (.-q js/window.__chartHarness) nil (clj->js (into [query] args))))'''
    mount = '''(require '[reagent.dom :as rdom])
(rdom/render [nautilus-log-v1/main {:block-uid "baseline-plan"}] (.getElementById js/document "chart-root"))'''
    html = f'''<!doctype html><html><head><meta charset="utf-8">
{''.join(f'<link rel="stylesheet" href="{p.resolve().as_uri()}">' for p in NATIVE_CSS)}
<link rel="stylesheet" href="{(ROOT / 'extension.css').as_uri()}">
<style>body{{margin:0;color:#25262a;font:14px system-ui,sans-serif}}#renderer-shell{{width:960px;margin:24px}}#following-sentinel{{height:40px;background:#eee;margin-top:12px}}</style>
<script>window.__chartRealDate=Date;window.__chartFakeNowMs=Date.parse('2026-10-29T08:01:00');
window.Date=class extends window.__chartRealDate{{constructor(...args){{super(...(args.length?args:[window.__chartFakeNowMs]))}}static now(){{return window.__chartFakeNowMs}}}};</script>
<script src="{(NODE_MODULES / 'react/umd/react.development.js').as_uri()}"></script>
<script src="{(NODE_MODULES / 'react-dom/umd/react-dom.development.js').as_uri()}"></script>
<script src="{(NODE_MODULES / 'scittle/dist/scittle.js').as_uri()}"></script>
<script src="{(NODE_MODULES / 'scittle/dist/scittle.reagent.js').as_uri()}"></script>
<script src="{(NODE_MODULES / 'scittle/dist/scittle.pprint.js').as_uri()}"></script>
<script src="{(OUT / 'bundle/chart-renderer-harness.js').as_uri()}"></script>
</head><body><div id="main-render-context"><div id="renderer-shell" data-chart-context="main"><div id="chart-root"></div><div id="following-sentinel">Following content sentinel</div></div></div>
<div id="roam-right-sidebar-content"><div class="roam-right-sidebar-content" id="sidebar-render-context"></div></div>
<div class="rm-embed-container" id="embed-render-context"></div>
<script>const c=new URLSearchParams(location.search).get('context')||'main',s=document.querySelector('#renderer-shell');
(document.querySelector(c==='sidebar'?'#sidebar-render-context':c==='embed'?'#embed-render-context':'#main-render-context')).append(s);s.dataset.chartContext=c;
// Native embed CSS can outdent its host even before Nautilus mounts. Record
// that untouched host baseline; never compensate with production global CSS.
window.__chartHostBaseline={{documentOverflow:document.documentElement.scrollWidth-document.documentElement.clientWidth}};</script>
{script_tag(shim, 'roam-datascript-shim')}{script_tag(source, 'component-cljs-exact')}{script_tag(mount, 'reagent-mount')}</body></html>'''
    (OUT / 'index.html').write_text(html)


def settle_renderer(page):
    page.wait_for_function('document.fonts.status === "loaded"')
    page.evaluate('() => new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')


def load(page, scenario='mixed', context='main', width=720, window='normal', lang='en', real_clock=False):
    page.goto((OUT / 'index.html').as_uri() + '?' + urlencode({'scenario': scenario, 'context': context, 'window': window, 'lang': lang, 'realClock': '1' if real_clock else '0'}))
    page.wait_for_function('window.__chartEvaluator && (__chartEvaluator.completed || __chartEvaluator.error)', timeout=15000)
    runtime = page.evaluate('() => __chartEvaluator')
    assert not runtime.get('error'), runtime
    page.wait_for_selector('svg.nautilus-log-svg')
    settle_renderer(page)
    page.evaluate('(w)=>__chartHarness.setWidth(w)', width)
    page.wait_for_function('''w=>{const s=__chartHarness.state(),f=s.presentation;return f
      && Math.abs(s.observedShell.width-w)<.5 && Math.abs(s.lastPresentationObservation.width-w)<.5
      && s.viewBox===`0 0 ${f.viewBox.width} ${f.viewBox.height}`;}''', arg=width)
    settle_renderer(page)
    return state(page)


def state(page):
    return page.evaluate('() => __chartHarness.state()')


def set_clock(page, iso):
    page.evaluate('iso=>__chartHarness.setClock(iso)', iso)
    expected = page.evaluate('iso=>new __chartRealDate(iso).getTime()', iso)
    page.wait_for_function('epoch=>__chartHarness.state().lastTimeline?.input.currentDate===epoch', arg=expected)
    settle_renderer(page)
    s = state(page); timeline = s['lastTimeline']['result']
    minute = int(timeline['elapsedThroughMinutes'])
    expected_label = f'{minute // 60 % 24:02d}:{minute % 60:02d}' if timeline['showNow'] else None
    assert s['nowLabel'] == expected_label, (iso, s['nowLabel'], expected_label)
    assert s['activeClockIntervals'] == 1
    return s


def assert_rect_equal(a, b, label):
    assert a['viewBox'] == b['viewBox'], label
    for key in ('svg', 'workspace', 'stage', 'detail', 'status', 'desk', 'following'):
        assert a[key] and b[key], (label, key)
        assert all(abs(a[key][part] - b[key][part]) <= .5 for part in ('x', 'y', 'width', 'height')), (label, key, a[key], b[key])


def compact_record(s):
    return {k: s[k] for k in ('viewBox', 'svg', 'stage', 'workspace', 'detail', 'status', 'desk', 'following', 'nowLabel', 'recordCount')} | {
        'kinds': {r['uid']: r['kind'] for r in s['records']},
        'indexPaths': {r['uid']: r['indexPath'] for r in s['records'] if r['indexPath']},
    }


def coverage(page, hidden=False):
    s = state(page); expected = page.evaluate('() => __chartHarness.expectedSourceUids()')
    assert len(s['records']) == len(expected) == len({r['uid'] for r in s['records']})
    assert {r['uid'] for r in s['records']} == set(expected)
    for record in s['records']:
        assert record['marks'] > 0 and record['label'].strip(), record
        if not hidden: assert record['visible'], record
        if record['kind'] != 'timed': assert record['timeClaim'] == 'none' and record['indexPath'], record
    scene = page.evaluate('() => __chartHarness.scene()')
    by_uid = {r['uid']: r for r in s['records']}
    for record in scene['records']:
        if not record['label']['truncated']:
            assert re.sub(r'\s+', '', by_uid[record['uid']]['label']) == re.sub(r'\s+', '', record['event']['description']), record['uid']
        if record.get('slot'): assert 0 < record['slot']['spanDegrees'] <= 32
    assert not page.locator('.nautilus-log-untimed-history,.nautilus-log-untimed-item,.nautilus-log-compact-details').count()
    scrollers = page.locator('.nautilus-log-content').evaluate('''root=>[...root.querySelectorAll('*')].filter(e=>{
      const s=getComputedStyle(e);return (['auto','scroll'].includes(s.overflowX)&&e.scrollWidth>e.clientWidth+1)
       ||(['auto','scroll'].includes(s.overflowY)&&e.scrollHeight>e.clientHeight+1);
    }).map(e=>e.getAttribute('class'))''')
    assert not scrollers, scrollers
    host_baseline = page.evaluate('() => __chartHostBaseline.documentOverflow')
    local_overflow = page.locator('.nautilus-log-container').evaluate('e=>e.scrollWidth-e.clientWidth')
    assert s['writes'] == 0 and not s['bodyTooltipCount'] and s['documentOverflow'] <= host_baseline + 1 and local_overflow <= 1, {
        'writes': s['writes'], 'tooltips': s['bodyTooltipCount'], 'overflow': s['documentOverflow'],
        'hostBaseline': host_baseline, 'localOverflow': local_overflow,
        'context': s['context'], 'width': s['observedShell']['width'], 'svg': s['svg'],
    }
    for box in s['labels']:
        svg = s['svg']
        assert box['x'] >= svg['x'] - 1 and box['y'] >= svg['y'] - 1, (box, svg)
        assert box['x'] + box['width'] <= svg['x'] + svg['width'] + 1 and box['bottom'] <= svg['bottom'] + 1, (box, svg)
    detail = page.locator('.nautilus-log-detail-region')
    if 'is-expanded' not in detail.get_attribute('class'):
        assert abs(s['detail']['height'] - 44) < .5
    if detail.get_attribute('data-nautilus-detail') == 'active':
        tip = page.locator('.nautilus-log-detail-content').bounding_box()
        assert tip['width'] <= min(280, s['workspace']['width'] - 32) + 1, tip
        assert abs(tip['x'] + tip['width'] / 2 - s['workspace']['x'] - s['workspace']['width'] / 2) <= 1
        if 'is-expanded' not in detail.get_attribute('class'):
            assert tip['height'] <= 44.5, tip
        if detail.get_attribute('data-tip-more') == 'false':
            assert not page.locator('.nautilus-log-detail-expand').count()
            assert page.locator('.nautilus-log-detail-title').evaluate('e=>e.scrollWidth<=e.clientWidth')
            assert page.locator('.nautilus-log-detail-meta').evaluate('e=>e.scrollWidth<=e.clientWidth')
    if detail.get_attribute('data-nautilus-detail') == 'idle':
        assert not detail.text_content().strip()
        assert detail.evaluate('e=>getComputedStyle(e).visibility') == 'hidden'
    return s


def geometry_audit(page):
    result = page.evaluate('''()=>{
      const nodes=[...document.querySelectorAll('.nautilus-log-event-slice-group')].filter(e=>getComputedStyle(e).visibility==='visible');
      const boxes=nodes.map(e=>({uid:e.dataset.taskUid,r:e.querySelector('.nautilus-log-record-title').getBoundingClientRect()}));
      const overlaps=[],crossings=[];
      for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
        const a=boxes[i].r,b=boxes[j].r;if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)overlaps.push([boxes[i].uid,boxes[j].uid]);
      }
      for(const node of nodes){const path=node.querySelector('.nautilus-log-record-leader'),matrix=path.getScreenCTM(),length=path.getTotalLength();
        for(let i=0;i<=64;i++){const p=path.getPointAtLength(length*i/64);const q=new DOMPoint(p.x,p.y).matrixTransform(matrix);
          for(const box of boxes){if(box.uid===node.dataset.taskUid)continue;const r=box.r;
            if(q.x>r.left+.5&&q.x<r.right-.5&&q.y>r.top+.5&&q.y<r.bottom-.5)crossings.push({from:node.dataset.taskUid,to:box.uid,point:{x:q.x,y:q.y},box:{x:r.x,y:r.y,width:r.width,height:r.height}});}
        }
      }
      return {frame:__chartHarness.scene().frame.viewBox,overlaps,crossings:crossings.slice(0,12)};
    }''')
    assert not result['overlaps'] and not result['crossings'], result
    return result


def ratio(fg, bg):
    alpha = fg[3] if len(fg) > 3 else 1
    fg = [alpha * a + (1 - alpha) * b for a, b in zip(fg[:3], bg[:3])]
    def luminance(rgb):
        values = [v / 255 / 12.92 if v / 255 <= .04045 else ((v / 255 + .055) / 1.055) ** 2.4 for v in rgb[:3]]
        return sum(v * w for v, w in zip(values, [.2126, .7152, .0722]))
    lo, hi = sorted([luminance(fg), luminance(bg)])
    return (hi + .05) / (lo + .05)


def contrast(page):
    page.mouse.move(1180, 980)
    page.locator('.nautilus-log-available-slot').first.focus()
    page.wait_for_function('''()=>[...document.querySelectorAll('.nautilus-log-toggle-btn,.nautilus-log-available-slot-hit')].every(e=>e.getAnimations().every(a=>a.playState==='finished'))''')
    paints = page.evaluate('''()=>{
      const rgb=s=>s.match(/[\\d.]+/g).map(Number),blend=(f,b)=>f.slice(0,3).map((c,i)=>c*(f[3]??1)+b[i]*(1-(f[3]??1)));
      let ancestry=[];for(let n=document.querySelector('.nautilus-log-chart-stage');n;n=n.parentElement)ancestry.unshift(n);
      const background=ancestry.reduce((b,n)=>blend(rgb(getComputedStyle(n).backgroundColor),b),[255,255,255]);
      const paint=(selector,prop)=>{const e=document.querySelector(selector);if(!e)throw Error('Missing paint '+selector);
        const s=getComputedStyle(e),c=rgb(s[prop]);let a=Number(s[prop==='stroke'?'strokeOpacity':'fillOpacity']);
        for(let n=e;n;n=n.parentElement)a*=Number(getComputedStyle(n).opacity);c[3]=(c[3]??1)*a;return c};
      return {background,
        task:paint('[data-task-uid="task-reference"] .nautilus-log-record-title','fill'),
        event:paint('[data-task-uid="event-standup"] .nautilus-log-record-title','fill'),
        completed:paint('[data-task-uid="task-completed"] .nautilus-log-record-title','fill'),
        index:paint('.nautilus-log-index-segment','stroke'),
        focus:paint('.nautilus-log-available-slot:focus .nautilus-log-available-slot-hit','stroke'),
        now:paint('.nautilus-log-now-needle-line','stroke'),
        control:paint('.nautilus-log-toggle-btn svg','stroke')};
    }''')
    scores = {k: ratio(v, paints['background']) for k, v in paints.items() if k != 'background'}
    assert min(scores[k] for k in ('task', 'event', 'completed')) >= 4.5, scores
    assert min(scores[k] for k in ('index', 'focus', 'now', 'control')) >= 3, scores
    return {'paint': paints, 'ratios': scores}


def select(page, uid):
    page.mouse.move(1180, 980)
    page.locator(f'[data-task-uid="{uid}"]').focus()
    page.wait_for_function('document.querySelector(".nautilus-log-detail-region").dataset.nautilusDetail === "active"')
    settle_renderer(page)


def native_minute_contract(page):
    load(page, 'mixed', real_clock=True)
    before = state(page)
    before_path = page.locator('[data-task-uid="task-reference"] .nautilus-log-slice').first.get_attribute('d')
    page.evaluate('()=>__chartHarness.advanceWallClock("2026-10-29T13:30:00")')
    # The 60-second browser timer itself must fire. No manual clock callback,
    # focus/visibility signal or reduced interval is used in this proof.
    page.wait_for_function('__chartHarness.traces().some(t=>t.kind==="native-minute-fired")', timeout=90000)
    page.wait_for_function('__chartHarness.state().nowLabel==="13:30"', timeout=4000)
    settle_renderer(page);after=coverage(page)
    proof=page.evaluate('''()=>{const t=__chartHarness.traces(),wall=t.findIndex(x=>x.kind==='wall-clock-without-timer'),fired=t.findIndex(x=>x.kind==='native-minute-fired'),registration=t.find(x=>x.kind==='interval-register'&&x.delay===60000),updated=t.findIndex((x,i)=>i>wall&&x.kind==='timeline-day-state'&&x.input.nowMinutes===810);return {wall,fired,updated,elapsedNativeMs:t[fired].performanceMs-registration.performanceMs,record:__chartHarness.scene().records.find(r=>r.uid==='task-reference').event}}''')
    assert proof['wall'] < proof['fired'] < proof['updated'] and proof['elapsedNativeMs'] >= 59000, proof
    assert proof['record']['start']==810 and proof['record']['end']==840
    assert before_path != page.locator('[data-task-uid="task-reference"] .nautilus-log-slice').first.get_attribute('d')
    assert_rect_equal(before,after,'native minute callback')
    page.evaluate('()=>__chartHarness.unmount()');settle_renderer(page)
    assert state(page)['activeClockIntervals']==0 and page.evaluate('()=>__chartHarness.activeClockListeners()')==[]
    return proof


def timeflow_recovery(page):
    load(page, 'mixed')
    set_clock(page, '2026-10-29T04:59:00')
    assert not page.locator('svg [aria-current="true"]').count(), 'before START there is no current time slice'
    def snapshot():
        return page.evaluate('''()=>({now:__chartHarness.state().nowLabel,timeline:__chartHarness.state().lastTimeline,
          records:__chartHarness.scene().records.map(r=>({uid:r.uid,start:r.event.start,end:r.event.end,kind:r.kind,
            paths:[...document.querySelector(`[data-task-uid="${r.uid}"]`).querySelectorAll('.nautilus-log-slice')].map(p=>p.getAttribute('d'))})),
          scheduler:__chartHarness.traces().filter(t=>t.kind==='schedule-tasks').at(-1)})''')
    def resume(iso, signal):
        page.evaluate('iso=>__chartHarness.advanceWallClock(iso)', iso)
        page.evaluate(signal)
        epoch = page.evaluate('iso=>Math.floor(new __chartRealDate(iso).getTime()/60000)*60000', iso)
        page.wait_for_function('epoch=>__chartHarness.state().lastTimeline.input.currentDate===epoch', arg=epoch, timeout=4000)
        settle_renderer(page)
        return snapshot()
    records = []
    for iso in ['2026-10-29T13:29:00', '2026-10-29T13:30:00']:
        records.append(resume(iso, '()=>__chartHarness.signalFocus()'))
    first = [{r['uid']: r for r in item['records']} for item in records]
    assert first[0]['task-reference']['start'] == 809 and first[1]['task-reference']['start'] == 810
    assert first[0]['task-reference']['paths'] != first[1]['task-reference']['paths']
    assert first[0]['event-standup']['paths'] == first[1]['event-standup']['paths']
    for item in records:
        drawn = {r['uid']: r for r in item['records']}
        for scheduled in item['scheduler']['result']['scheduledTasks']:
            assert drawn[scheduled['uid']]['start'] == scheduled['start'] and drawn[scheduled['uid']]['end'] == scheduled['end']
            assert scheduled['end'] - scheduled['start'] == scheduled['duration']
    blocked = resume('2026-10-29T09:00:00', '()=>__chartHarness.signalPageShow()')
    assert next(r for r in blocked['records'] if r['uid']=='task-reference')['start'] == 570
    assert page.locator('[data-task-uid="event-standup"]').get_attribute('aria-current') == 'true'
    page.evaluate('()=>__chartHarness.signalVisibility("hidden")')
    page.evaluate('()=>__chartHarness.advanceWallClock("2026-10-29T10:00:00")')
    page.evaluate('()=>__chartHarness.signalVisibility("hidden")')
    assert state(page)['nowLabel'] == '09:00'
    visible = resume('2026-10-29T10:00:00', '()=>__chartHarness.signalVisibility("visible")')
    assert next(r for r in visible['records'] if r['uid']=='task-reference')['start'] == 600
    clock_change = resume('2026-10-29T10:01:00', '()=>__chartHarness.setClockEntries([])')
    assert next(r for r in clock_change['records'] if r['uid']=='task-reference')['start'] == 601
    resume('2026-10-29T08:01:00', '()=>__chartHarness.signalFocus()')
    next_day = resume('2026-10-30T08:01:00', '()=>__chartHarness.signalFocus()')
    assert next_day['timeline']['result']['relation'] == 'past' and next_day['now'] is None
    assert next_day['timeline']['result']['scheduleFromMinutes'] == 300
    set_clock(page, '2026-10-29T20:59:00'); ended = snapshot()
    assert all(r['kind']=='unplaced' for r in ended['records'] if r['uid'] in ['task-reference','task-long','task-unbroken'])
    assert len(page.evaluate('()=>__chartHarness.activeClockListeners()')) == 3
    page.evaluate('()=>__chartHarness.unmount()')
    assert page.evaluate('()=>__chartHarness.activeClockListeners()') == []
    assert state(page)['activeClockIntervals'] == 0
    return {'minuteAdvance':records,'blockedByEvent':blocked,'visibleResume':visible,'clockNotification':clock_change,'sameMinuteNextDay':next_day,'end':ended,'cleanup':True}


def afternoon_flow_contract(page):
    load(page,'flow','main',640,window='flow')
    observations=[]
    for iso in ['2026-10-29T13:29:00','2026-10-29T13:30:00','2026-10-29T13:31:00']:
        set_clock(page,iso);coverage(page)
        data=page.evaluate('''()=>({clock:__chartHarness.state().nowLabel,
          capacity:__chartHarness.traces().filter(t=>t.kind==='capacity').at(-1).result,
          scheduler:__chartHarness.traces().filter(t=>t.kind==='schedule-tasks').at(-1).result,
          first:__chartHarness.scene().records.find(r=>r.uid==='flow-task-0').event,
          firstPath:document.querySelector('[data-task-uid="flow-task-0"] .nautilus-log-slice').getAttribute('d'),
          fixedPath:document.querySelector('[data-task-uid="flow-current-event"] .nautilus-log-slice').getAttribute('d'),
          fixedPhase:document.querySelector('[data-task-uid="flow-current-event"]').dataset.visualPhase,
          caption:document.querySelector('.nautilus-log-index-caption').textContent})''')
        observations.append(data)
        if data['clock']=='13:29':
            select(page,'flow-review');coverage(page)
            assert not page.locator('.nautilus-log-detail-expand').count()
            page.screenshot(path=str(OUT/'screenshots'/'afternoon-flow-1329.png'),full_page=True)
    a,b,c=observations
    assert (a['capacity']['demandMinutes'],a['capacity']['availableMinutes'],a['capacity']['overloadMinutes'],a['capacity']['unplacedMinutes'])==(310,275,35,75)
    assert [t['uid'] for t in a['scheduler']['overflowTasks']]==['flow-task-6','flow-task-7']
    assert a['first']['start']==b['first']['start']==810 and c['first']['start']==811
    assert a['firstPath']==b['firstPath'] and b['firstPath']!=c['firstPath']
    assert a['fixedPath']==b['fixedPath']==c['fixedPath']
    assert a['fixedPhase']=='current' and b['fixedPhase']=='elapsed'
    assert 'Wait 2' in a['caption'] and 'No time 2' in a['caption']
    return observations


def material_and_tip_contract(page):
    load(page, 'mixed')
    def paint(uid):
        page.wait_for_function('''uid=>[...document.querySelector(`[data-task-uid="${uid}"]`).querySelectorAll('.nautilus-log-slice')].every(e=>e.getAnimations().every(a=>a.playState==='finished'))''', arg=uid)
        return page.locator(f'[data-task-uid="{uid}"]').evaluate('''e=>({phase:e.dataset.visualPhase,category:e.dataset.category,current:e.getAttribute('aria-current'),fill:getComputedStyle(e.querySelector('.nautilus-log-slice')).fill,opacity:getComputedStyle(e.querySelector('.nautilus-log-slice')).fillOpacity})''')
    at_start = {'task': paint('task-reference'), 'event': paint('event-standup')}
    assert at_start['task']['phase']=='current' and at_start['event']['phase']=='future'
    assert at_start['task']['fill'] != at_start['event']['fill']
    set_clock(page, '2026-10-29T09:00:00')
    during = {'task': paint('task-reference'), 'event': paint('event-standup')}
    assert during['event']['phase']=='current' and during['event']['current']=='true' and during['task']['phase']=='future'
    set_clock(page, '2026-10-29T09:30:00')
    after = {'task': paint('task-reference'), 'event': paint('event-standup')}
    assert after['event']['phase']=='elapsed' and after['task']['phase']=='current'
    assert len({at_start['event']['fill'],during['event']['fill'],after['event']['fill']})==3
    assert at_start['task']['opacity']==during['task']['opacity']==after['task']['opacity']
    assert 'Past, no record' in page.locator('.nautilus-log-html-legend').first.text_content()
    result={'materials':{'start':at_start,'duringEvent':during,'afterEvent':after},'tips':{}}
    for context,width in [('main',960),('sidebar',280),('embed',520)]:
        load(page,'routine',context,width)
        page.evaluate('()=>__chartHarness.updateChild("routine-0","18:30-19:00 Review")')
        page.wait_for_function('document.querySelector("[data-task-uid=routine-0]").dataset.recordTitle==="Review"')
        select(page,'routine-0');coverage(page)
        short=page.locator('.nautilus-log-detail-content').bounding_box()
        assert short['width'] < 250 and short['height'] <= 36, short
        assert not page.locator('.nautilus-log-detail-expand').count()
        before=state(page)
        page.evaluate('()=>__chartHarness.updateChild("routine-0","18:30-19:00 核对项目全部材料并完成交付内容的逐项检查和验收确认工作")')
        page.wait_for_function('document.querySelector("[data-task-uid=routine-0]").dataset.recordTitle.includes("验收")')
        settle_renderer(page)
        assert page.locator('.nautilus-log-detail-region').get_attribute('data-nautilus-detail') == 'idle'
        # focus() on the already-focused SVG node emits no new event. Model a
        # real re-entry rather than weakening stale-detail invalidation.
        page.locator('[data-task-uid="routine-0"]').evaluate('e=>e.blur()')
        select(page,'routine-0');coverage(page)
        long=page.locator('.nautilus-log-detail-content').bounding_box()
        assert long['width'] <= min(280,width-32)+1 and long['height'] <= 44.5
        assert page.get_by_role('button',name='Full text',exact=True).count()==1
        page.screenshot(path=str(OUT/'screenshots'/f'compact-tip-{context}-{width}.png'),full_page=True)
        result['tips'][f'{context}-{width}']={'short':short,'long':long}
    return result


def lifecycle(page):
    load(page, 'untimed')
    start = coverage(page)
    kinds = {r['uid']: r['kind'] for r in start['records']}
    assert all(kinds[k] == 'untimed-completed' for k in ['untimed-local', 'untimed-reference', 'running-only', 'other-day'])
    select(page, 'untimed-reference')
    aria = page.locator('[data-task-uid="untimed-reference"]').get_attribute('aria-label')
    assert 'Completion status from reference' in aria and not re.search(r'\d\d:\d\d', aria)
    page.locator('[data-task-uid="untimed-reference"]').press('Shift+Enter')
    assert page.evaluate('()=>__chartHarness.traces().filter(t=>t.kind==="locate").at(-1)') == {'kind': 'locate', 'uid': 'untimed-reference', 'sidebar': True}
    header = page.locator('.nautilus-log-header-copy').inner_text()
    page.get_by_role('button', name='Hide completed on chart', exact=True).click()
    settle_renderer(page); hidden = coverage(page, True)
    assert [r['uid'] for r in hidden['records'] if r['visible']] == ['pending-next']
    assert page.locator('.nautilus-log-header-copy').inner_text() == header
    assert_rect_equal(start, hidden, 'eye toggle')
    page.get_by_role('button', name='Show completed on chart', exact=True).click(); settle_renderer(page)
    page.evaluate('()=>__chartHarness.updateChild("pending-next","{{[[DONE]]}} Draft next chapter 30m")')
    page.wait_for_function('document.querySelector("[data-task-uid=pending-next]").dataset.chartKind === "untimed-completed"')
    settle_renderer(page); done = coverage(page); assert_rect_equal(start, done, 'TODO to untimed DONE')
    select(page, 'untimed-reference')
    page.evaluate('()=>__chartHarness.setClockEntries([{taskUid:"untimed-reference",start:"2026-10-29T07:00:00",end:"2026-10-29T07:10:00",running:false}])')
    page.wait_for_function('document.querySelector("[data-task-uid=untimed-reference]").dataset.timeClaim === "actual"')
    settle_renderer(page); actual = coverage(page); assert_rect_equal(start, actual, 'local CLOCK evidence')
    assert '07:00–07:10' in page.locator('[data-task-uid="untimed-reference"]').get_attribute('aria-label')
    assert page.locator('.nautilus-log-detail-region').get_attribute('data-nautilus-detail') == 'idle'
    select(page, 'untimed-local')
    page.evaluate('()=>__chartHarness.removeChild("untimed-local")')
    page.wait_for_function('!document.querySelector("[data-task-uid=untimed-local]")')
    settle_renderer(page)
    assert page.locator('.nautilus-log-detail-region').get_attribute('data-nautilus-detail') == 'idle'
    load(page, 'mixed')
    select(page, 'task-reference')
    page.locator('[data-task-uid="event-standup"] .nautilus-log-record-title').hover()
    assert 'Stand-up' in page.locator('.nautilus-log-detail-title').inner_text()
    page.mouse.move(1180, 980); settle_renderer(page)
    assert 'Draft the project brief' == page.locator('.nautilus-log-detail-title').inner_text()
    page.get_by_role('button', name='Collapse Nautilus Log', exact=True).focus()
    page.get_by_role('button', name='Collapse Nautilus Log', exact=True).press('Enter')
    page.wait_for_function('document.querySelectorAll("svg.nautilus-log-svg").length===0')
    page.mouse.move(1180, 980)
    page.get_by_role('button', name='Expand Nautilus Log', exact=True).press('Enter')
    page.wait_for_selector('svg.nautilus-log-svg'); settle_renderer(page)
    assert page.locator('.nautilus-log-detail-region').get_attribute('data-nautilus-detail') == 'idle'
    select(page, 'task-reference'); page.evaluate('()=>__chartHarness.unload()'); settle_renderer(page)
    assert page.locator('.nautilus-log-detail-region').get_attribute('data-nautilus-detail') == 'idle'
    page.evaluate('()=>__chartHarness.unmount()'); settle_renderer(page)
    assert state(page)['activeClockIntervals'] == 0 and not page.locator('svg.nautilus-log-svg').count()
    return {'before': compact_record(start), 'hidden': compact_record(hidden), 'done': compact_record(done), 'actual': compact_record(actual), 'navigation': True, 'foldAndUnload': True}


def full_text(page, context, width):
    load(page, 'stress', context, width)
    select(page, 'overflow-3')
    before = coverage(page)
    scroll_before = page.evaluate('() => scrollY')
    page.get_by_role('button', name='Full text', exact=True).click(); settle_renderer(page)
    expanded = coverage(page)
    assert 'END_LONG' in page.locator('.nautilus-log-detail-title').inner_text()
    assert page.locator('.nautilus-log-detail-title').evaluate('e=>getComputedStyle(e).webkitLineClamp') == 'none'
    assert expanded['detail']['height'] > before['detail']['height']
    assert all(abs(expanded['svg'][key] - before['svg'][key]) < .5 for key in ('x', 'width', 'height')), 'explicit expansion must not resize the SVG'
    assert abs(expanded['svg']['y'] + page.evaluate('() => scrollY') - before['svg']['y'] - scroll_before) < .5, 'the diagram must keep its document-flow position'
    page.locator('[data-task-uid="overflow-1"] .nautilus-log-record-title').hover(); settle_renderer(page)
    assert 'END_LONG' in page.locator('.nautilus-log-detail-title').inner_text(), 'expanded reading must be pinned'
    page.get_by_role('button', name='Collapse text', exact=True).click(); page.mouse.move(1180, 980); settle_renderer(page)
    assert abs(state(page)['detail']['height'] - 44) < .5
    page.screenshot(path=str(OUT / 'screenshots' / f'fulltext-{context}-{width}.png'), full_page=True)
    return {'closed': compact_record(before), 'expandedHeight': expanded['detail']['height'], 'pinned': True, 'noInternalScroll': True}


def main():
    (OUT / 'bundle').mkdir(); (OUT / 'screenshots').mkdir()
    subprocess.check_call(['node', 'test/chart-renderer-bundle.cjs', str(OUT / 'bundle')], cwd=ROOT,
                          env={**os.environ, 'NODE_PATH': str(NODE_MODULES)})
    source = COMPONENT.read_text(); write_page(source)
    report = {'artifactDirectory': str(OUT), 'componentSha256': sha(source), 'componentBytes': len(source.encode()),
              'acceptance': 'All source records have diagram marks and labels; no footer inventory or nested scroll reading.'}
    errors, requests, resources, console_errors = [], [], [], []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            page = browser.new_page(viewport={'width': 1200, 'height': 1000})
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.on('request', lambda r: requests.append(r.url) if r.url.startswith(('http:', 'https:')) else None)
            page.on('requestfailed', lambda r: resources.append({'url': r.url, 'failure': r.failure}))
            page.on('console', lambda m: console_errors.append(m.text) if m.type == 'error' and not any(w in m.text for w in EXPECTED_WARNINGS) else None)
            load(page)
            evaluated = page.locator('script[data-chart-eval="component-cljs-exact"]').text_content()
            assert evaluated == source
            report['evaluatorInput'] = {'sha256': sha(evaluated), 'equalsProductionSource': True, 'productionSha256': sha(source)}
            report['evaluatorRuntime'] = page.evaluate('()=>__chartEvaluator')
            initializer = re.search(r'hover-info-state\s+(\(r/atom\s+\{[^}]+\}\))', source).group(1)
            report['readerCompatibility'] = page.evaluate('''initializer=>{
              const negative=scittle.core.eval_string('(try (clojure.edn/read-string "(atom ::unseen)") (catch :default e (.-message e)))');
              if(typeof negative!=='string'||!negative.includes('::unseen'))throw Error('Reader negative control failed');
              scittle.core.eval_string('(clojure.edn/read-string '+JSON.stringify(initializer)+')');
              return {initializer,namespaceFreeRead:true,negative,scope:'Initializer compatibility, not the private host reader'};
            }''', initializer)
            report['stylesheetOrder'] = page.locator('link[rel=stylesheet]').evaluate_all('els=>els.map(e=>e.href)')
            report['loadedFonts'] = page.evaluate('()=>[...document.fonts].filter(f=>f.status==="loaded").map(f=>({family:f.family,weight:f.weight,status:f.status}))')
            report['contrast'] = {'light': contrast(page)}
            page.locator('body').evaluate("e=>{e.classList.add('bp3-dark');e.style.background='#1d1e21';e.style.color='#ecedef'}")
            page.emulate_media(reduced_motion='reduce'); settle_renderer(page)
            report['contrast']['nativeDark'] = contrast(page)
            coverage(page); page.screenshot(path=str(OUT / 'screenshots/dark.png'), full_page=True)
            page.emulate_media(reduced_motion='no-preference')
            report['matrix'] = {}
            for context in ['main', 'sidebar', 'embed']:
                for width in [280, 320, 520, 640, 960]:
                    before = load(page, 'realistic', context, width)
                    coverage(page); geometry = geometry_audit(page)
                    if before['presentation']['plotScale'] < .9:
                        date_rows = page.locator('.nautilus-log-center-date > text:not(.nautilus-log-center-now)').all_text_contents()
                        assert date_rows == ['October', '29th'], date_rows
                    for label in page.locator('[data-record-title^="Commute"] .nautilus-log-record-title').all():
                        lines = label.locator('tspan').all_text_contents()
                        assert not any(line.rstrip().endswith(('Commu', 'Commut')) for line in lines), lines
                    observations = []
                    for iso in CLOCKS:
                        current = set_clock(page, iso); coverage(page)
                        assert_rect_equal(before, current, f'{context}/{width}/{iso}')
                        observations.append(compact_record(current))
                    select(page, 'unknown-2'); active = coverage(page)
                    assert_rect_equal(before, active, 'hover/focus frame')
                    if context == 'main' or width == 280:
                        page.screenshot(path=str(OUT / 'screenshots' / f'realistic-{context}-{width}.png'), full_page=True)
                    report['matrix'][f'{context}-{width}'] = {'observations': observations, 'geometry': geometry,
                        'hostBaseline': page.evaluate('() => __chartHostBaseline')}
            report['stress'] = {}
            for context, width in [('main', 960), ('main', 520), ('sidebar', 320), ('sidebar', 280), ('embed', 640)]:
                before = load(page, 'stress', context, width); coverage(page); geometry = geometry_audit(page)
                cjk = next(r for r in before['records'] if r['uid'] == 'overflow-0')
                assert cjk['label'].replace(' ', '') == cjk['title'].replace(' ', ''), cjk
                late = set_clock(page, '2026-10-29T21:01:00'); coverage(page)
                assert_rect_equal(before, late, 'END cannot drop overflow or resize frame')
                for uid in ['overflow-0', 'overflow-1', 'overflow-2', 'overflow-3']:
                    a = next(r for r in before['records'] if r['uid'] == uid); b = next(r for r in late['records'] if r['uid'] == uid)
                    assert a['kind'] == b['kind'] == 'unplaced' and a['indexPath'] == b['indexPath']
                page.screenshot(path=str(OUT / 'screenshots' / f'stress-{context}-{width}.png'), full_page=True)
                report['stress'][f'{context}-{width}'] = {'before': compact_record(before), 'after': compact_record(late), 'geometry': geometry}
            report['scenarios'] = {}
            for scenario in ['untimed-many', 'outside', 'sparse', 'dense', 'cjk', 'empty', 'completed', 'routine']:
                load(page, scenario); s = coverage(page); geometry_audit(page)
                if scenario == 'untimed-many': assert s['recordCount'] == 12 and s['sliceCount'] == 0
                if scenario == 'outside':
                    assert all(r['kind'] == 'outside-window' and r['timeClaim'] == 'none' for r in s['records'])
                    assert '01:00–01:30' in s['records'][0]['aria']
                    assert '23:40–00:00' in s['records'][2]['aria'] and 'Completed' in s['records'][2]['aria']
                report['scenarios'][scenario] = compact_record(s)
            report['overnight'] = {}
            for context, width in [('main', 960), ('sidebar', 280), ('embed', 520)]:
                before = load(page, 'overnight', context, width, window='overnight')
                observations = []
                for iso in NIGHT:
                    current = set_clock(page, iso); coverage(page); assert_rect_equal(before, current, 'overnight frame')
                    observations.append(compact_record(current))
                assert observations[3]['nowLabel'] == '01:59' and observations[4]['nowLabel'] is None
                report['overnight'][f'{context}-{width}'] = observations
            report['fullText'] = {f'{c}-{w}': full_text(page, c, w) for c, w in [('main', 960), ('sidebar', 280), ('embed', 520)]}
            load(page, 'untimed', 'sidebar', 280, lang='zh'); select(page, 'untimed-reference'); coverage(page)
            assert '非排程位置' in page.locator('.nautilus-log-index-caption').text_content()
            assert '未记时' in page.locator('.nautilus-log-index-caption').text_content()
            assert page.get_by_role('button', name='全文', exact=True).count() == 1
            report['chinese'] = compact_record(state(page))
            report['afternoonFlow'] = afternoon_flow_contract(page)
            report['materialsAndTips'] = material_and_tip_contract(page)
            report['timeflowRecovery'] = timeflow_recovery(page)
            report['lifecycle'] = lifecycle(page)
            report['nativeMinuteTimer'] = native_minute_contract(page)
            assert not errors and not requests and not resources and not console_errors, (errors, requests, resources, console_errors)
            report.update({'pageErrors': errors, 'httpRequests': requests, 'resourceFailures': resources, 'consoleErrors': console_errors,
                           'result': 'PASS', 'graphWrites': 0})
        finally:
            browser.close()
    (OUT / 'results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'result': 'PASS', 'artifactDirectory': str(OUT), 'componentSha256': sha(source),
                      'matrixCases': len(report['matrix']), 'stressCases': len(report['stress']), 'sourceOnlySupported': True}, indent=2))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        (OUT / 'failure.json').write_text(json.dumps({'result': 'FAIL', 'error': str(error)}, ensure_ascii=False, indent=2))
        raise
