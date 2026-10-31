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
from playwright.sync_api import expect, sync_playwright

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
    missing = [str(path) for path in NATIVE_CSS if not path.is_file()]
    if missing:
        raise FileNotFoundError(f'Configured native fixture CSS is missing: {missing}')
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


def load(page, scenario='mixed', context='main', width=720, window='normal', lang='en', real_clock=False, real_desk=False):
    page.goto((OUT / 'index.html').as_uri() + '?' + urlencode({'scenario': scenario, 'context': context, 'window': window, 'lang': lang, 'realClock': '1' if real_clock else '0', 'realDesk': '1' if real_desk else '0'}))
    if real_desk and not NATIVE_CSS:
        # Desk deliberately inherits host CSS; a bare browser's default h2
        # margins are not a native Desk environment. Do not compensate in production.
        page.add_style_tag(path=str(ROOT / 'test/desk-native-fixture.css'))
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


def assert_clock_layout(a, b, label):
    # Queue membership is a semantic state change, including a whole task
    # ceasing to fit before END. Ordinary motion of the same members is stable.
    assert set(a['sourceUids']) == set(b['sourceUids']), label
    same = ([r['uid'] for r in a['records']], a['queueKind'], [r['uid'] for r in a['queueItems']]) == ([r['uid'] for r in b['records']], b['queueKind'], [r['uid'] for r in b['queueItems']])
    if same:
        assert_rect_equal(a, b, label)


def compact_record(s):
    return {k: s[k] for k in ('viewBox', 'svg', 'stage', 'workspace', 'detail', 'status', 'desk', 'following', 'nowLabel', 'recordCount')} | {
        'kinds': {r['uid']: r['kind'] for r in s['records']},
        'queueKind': s['queueKind'], 'queueUids': [r['uid'] for r in s['queueItems']],
        'markerPaths': {r['uid']: r['markerPath'] for r in s['records'] if r['markerPath']},
    }


def coverage(page, hidden=False):
    s = state(page); expected = page.evaluate('() => __chartHarness.expectedSourceUids()')
    represented = [r['uid'] for r in s['records']] + [r['uid'] for r in s['queueItems']]
    assert len(represented) == len(expected) == len(set(represented))
    assert set(represented) == set(expected)
    if s['pendingQueue']:
        assert s['queueKind'] in ('unfinished', 'unscheduled')
        assert [r['uid'] for r in s['queueItems']] == [r['uid'] for r in s['pendingQueue']['items']]
        for ui, item in zip(s['queueItems'], s['pendingQueue']['items']):
            assert item['todo'] and not item['done'] and not item.get('meeting')
            assert item.get('start') is None and item.get('end') is None
            assert ui['title'] == item['description'] and ui['visible'] == s['queueOpen'], {'ui': ui, 'item': item, 'open': s['queueOpen']}
        if s['queueKind'] == 'unfinished': assert s['lastTimeline']['result']['relation'] == 'past'
    else:
        assert not page.locator('.nautilus-log-pending-queue').count()
    for record in s['records']:
        assert record['marks'] > 0 and record['label'].strip(), record
        if not hidden: assert record['visible'], record
        if record['kind'] != 'timed': assert record['timeClaim'] == 'none' and record['markerPath'], record
    scene = page.evaluate('() => __chartHarness.scene()')
    by_uid = {r['uid']: r for r in s['records']}
    for record in scene['records']:
        if not record['label']['truncated']:
            assert re.sub(r'\s+', '', by_uid[record['uid']]['label']) == re.sub(r'\s+', '', record['event']['description']), record['uid']
        if record['kind'] != 'timed':
            assert not record.get('anchor') and not record.get('slot') and not record.get('indexPath'), record
            assert record['marker']['size'] <= 6 and record['label']['side'] == record['label']['sourceSide']
        else:
            assert record['label']['side'] == ('left' if record['anchor']['x'] < scene['frame']['center']['x'] else 'right'), record
        if record['event']['time-claim'] == 'estimated-allocation':
            assert record['kind'] == 'timed' and record['event']['end'] - record['event']['start'] == record['event']['duration']
            assert record['event'].get('actual-minutes') in (None, 0)
            assert page.locator(f'[data-estimate-outline-for="{record["uid"]}"]').count() == 1
        if record['kind'] == 'completed-estimate-overflow':
            assert record['event'].get('estimate-unplaced-reason') in ('capacity', 'zero-duration', 'invalid-window')
        assert not record.get('connectionTarget')
    assert not scene.get('completionNode')
    assert not page.locator('.nautilus-log-completion-node,[data-chart-kind="untimed-completed"]').count()
    assert not page.locator('.nautilus-log-untimed-history,.nautilus-log-untimed-item,.nautilus-log-compact-details,.nautilus-log-index-segment,.nautilus-log-index-caption,.nautilus-log-overflow-panel').count()
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
    assert page.locator('.nautilus-log-hour-label').evaluate_all('''nodes=>nodes.every(e=>{
      const r=e.getBoundingClientRect(),svg=e.ownerSVGElement.getBoundingClientRect();
      return r.left>=svg.left-.5&&r.top>=svg.top-.5&&r.right<=svg.right+.5&&r.bottom<=svg.bottom+.5;
    })'''), 'compact chart padding must not clip hour labels'
    detail = page.locator('.nautilus-log-detail-region')
    expanded = 'is-expanded' in detail.get_attribute('class')
    full_content = detail.get_attribute('data-tip-content') == 'full'
    if not expanded and (not full_content or detail.get_attribute('data-nautilus-detail') == 'idle'):
        assert abs(s['detail']['height'] - 42) < .5
    if detail.get_attribute('data-nautilus-detail') == 'active':
        tip = page.locator('.nautilus-log-detail-content').bounding_box()
        assert tip['width'] <= s['workspace']['width'] - 32 + 1, tip
        assert abs(tip['x'] + tip['width'] / 2 - s['workspace']['x'] - s['workspace']['width'] / 2) <= 1
        if not expanded and not full_content:
            assert tip['height'] <= 38.5, tip
        if full_content:
            for selector in ['.nautilus-log-detail-title', '.nautilus-log-detail-meta']:
                assert page.locator(selector).evaluate('e=>getComputedStyle(e).textOverflow!=="ellipsis" && e.scrollWidth<=e.clientWidth+1 && e.scrollHeight<=e.clientHeight+1'), selector
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
      const boxes=nodes.flatMap(e=>[...e.querySelectorAll('.nautilus-log-record-title,.nautilus-log-record-meta')].map(t=>({uid:e.dataset.taskUid,kind:t.getAttribute('class'),r:t.getBoundingClientRect()})));
      const overlaps=[],crossings=[],markerCollisions=[];
      for(const node of nodes){const marker=node.querySelector('.nautilus-log-record-marker');if(!marker)continue;const a=marker.getBoundingClientRect();
        for(const box of boxes){const b=box.r;if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>.5&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>.5)markerCollisions.push([node.dataset.taskUid,box.uid]);}
      }
      for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
        const a=boxes[i].r,b=boxes[j].r;if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)overlaps.push([boxes[i].uid,boxes[j].uid]);
      }
      for(const node of nodes){const path=node.querySelector('.nautilus-log-record-leader'),matrix=path.getScreenCTM(),length=path.getTotalLength();
        for(let i=0;i<=64;i++){const p=path.getPointAtLength(length*i/64);const q=new DOMPoint(p.x,p.y).matrixTransform(matrix);
          for(const box of boxes){if(box.uid===node.dataset.taskUid)continue;const r=box.r;
            if(q.x>r.left+.5&&q.x<r.right-.5&&q.y>r.top+.5&&q.y<r.bottom-.5)crossings.push({from:node.dataset.taskUid,to:box.uid,point:{x:q.x,y:q.y},box:{x:r.x,y:r.y,width:r.width,height:r.height}});}
        }
      }
      const hours=[...document.querySelectorAll('.nautilus-log-hour-label')].map(e=>({text:e.textContent,pixels:parseFloat(getComputedStyle(e).fontSize)*Math.abs(e.getScreenCTM().a)}));
      return {frame:__chartHarness.scene().frame.viewBox,compact:__chartHarness.scene().frame.compact,hours,overlaps,markerCollisions,crossings:crossings.slice(0,12)};
    }''')
    assert not result['overlaps'] and not result['crossings'] and not result['markerCollisions'], result
    if result['compact']: assert all(h['pixels'] >= 8.5 for h in result['hours']), result
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
        estimateOutline:paint('.nautilus-log-estimated-outline path','stroke'),
        focus:paint('.nautilus-log-available-slot:focus .nautilus-log-available-slot-hit','stroke'),
        now:paint('.nautilus-log-now-needle-line','stroke'),
        clock:paint('.nautilus-log-center-now','fill'),
        control:paint('.nautilus-log-toggle-btn svg','stroke')};
    }''')
    scores = {k: ratio(v, paints['background']) for k, v in paints.items() if k != 'background'}
    assert min(scores[k] for k in ('task', 'event', 'completed', 'clock')) >= 4.5, scores
    assert min(scores[k] for k in ('estimateOutline', 'focus', 'now', 'control')) >= 3, scores
    return {'paint': paints, 'ratios': scores}


def select(page, uid):
    page.mouse.move(1180, 980)
    page.locator(f'svg.nautilus-log-svg [data-task-uid="{uid}"]').focus()
    page.wait_for_function('document.querySelector(".nautilus-log-detail-region").dataset.nautilusDetail === "active"')
    settle_renderer(page)


def pattern_contract(page):
    before = page.locator('.nautilus-log-unplanned-overlay pattern').get_attribute('id')
    set_clock(page, '2026-10-29T08:02:00')
    assert page.locator('.nautilus-log-unplanned-overlay pattern').get_attribute('id') == before
    ids = page.evaluate('''()=>{
      const host=document.createElement('div');host.id='pattern-proof';document.body.append(host);
      scittle.core.eval_string('(rdom/render [:svg [nautilus-log-v1/past-unplanned-overlay-component [] 50 {:center-x 150 :center-y 150} {:workday-start 300 :workday-end 1260} 500 1] [nautilus-log-v1/past-unplanned-overlay-component [] 50 {:center-x 150 :center-y 150} {:workday-start 300 :workday-end 1260} 500 1]] (.getElementById js/document "pattern-proof"))');
      const ids=[...document.querySelectorAll('.nautilus-log-unplanned-overlay pattern')].map(p=>p.id);
      ReactDOM.unmountComponentAtNode(host);host.remove();return ids;
    }''')
    assert len(ids) == len(set(ids)) == 3, ids
    set_clock(page, '2026-10-29T08:01:00')
    return {'stableDuringTick': True, 'distinctMountedPatternIds': ids}


def completion_connections_contract(page):
    reports = {}
    for context, width, language in [('main', 720, 'en'), ('sidebar', 280, 'en'), ('sidebar', 280, 'zh'), ('embed', 520, 'en')]:
        load(page, 'connections', context, width, window='flow', lang=language)
        page.evaluate('''()=>{
          __chartHarness.updateChild('connection-done-0','{{[[DONE]]}} Default estimate');
          __chartHarness.updateChild('connection-done-1','{{[[DONE]]}} Explicit estimate 45m');
        }''')
        page.wait_for_function('__chartHarness.scene().records.find(r=>r.uid==="connection-done-0").event.duration===15')
        settle_renderer(page); before = state(page)
        def allocations():
            return page.evaluate('''()=>__chartHarness.scene().records.filter(r=>r.event['time-claim']==='estimated-allocation').map(r=>({uid:r.uid,start:r.event.start,end:r.event.end,duration:r.event.duration,actual:r.event['actual-minutes'],doneAt:r.event['done-at']}))''')
        proof = allocations()
        assert len(proof) == 7 and [r['duration'] for r in proof[:2]] == [15, 45]
        assert all(r['end'] - r['start'] == r['duration'] and not r['actual'] and r['doneAt'] is None for r in proof)
        for iso in ['2026-10-29T08:01:00', '2026-10-29T13:30:00', '2026-10-29T20:30:00']:
            current = set_clock(page, iso); coverage(page); geometry_audit(page)
            assert_clock_layout(before, current, 'estimated completion and changing pending membership')
            assert allocations() == proof
            if iso.endswith('08:01:00'):
                overlap = page.evaluate('''()=>{
                  const scene=__chartHarness.scene(),planned=__chartHarness.traces().filter(t=>t.kind==='schedule-tasks').at(-1).result.scheduledTasks;
                  const pairs=rows=>rows.map(r=>[r.uid,r.start,r.end]);
                  return {planned:pairs(planned),actual:pairs(scene.records.filter(r=>r.event.todo&&!r.event.done&&r.kind==='timed').map(r=>r.event)),
                    opacity:[...document.querySelectorAll('.nautilus-log-record--estimate-overlap .nautilus-log-slice')].map(e=>Number(getComputedStyle(e).fillOpacity)),
                    outlines:[...document.querySelectorAll('.nautilus-log-estimated-outline path')].map(e=>({dash:getComputedStyle(e).strokeDasharray,pointer:getComputedStyle(e).pointerEvents}))};
                }''')
                assert overlap['actual'] == overlap['planned'], overlap
                assert overlap['opacity'] and max(overlap['opacity']) <= .2
                assert overlap['outlines'] and all(r['dash'] != 'none' and r['pointer'] == 'none' for r in overlap['outlines'])
        before = state(page)
        expected = page.evaluate('()=>__chartHarness.expectedSourceUids()')
        assert [r['uid'] for r in before['records']] == [uid for uid in expected if uid not in {r['uid'] for r in before['queueItems']}]
        uid = 'connection-done-2'
        title = page.locator(f'[data-task-uid="{uid}"] .nautilus-log-record-title')
        idle_fill = title.evaluate('e=>getComputedStyle(e).fill')
        page.locator(f'[data-task-uid="{uid}"] .nautilus-log-record-label').hover()
        page.wait_for_function('document.querySelector("[data-estimate-outline-for=connection-done-2]").classList.contains("is-active")')
        assert title.evaluate('e=>getComputedStyle(e).fill') == idle_fill
        assert title.evaluate('e=>getComputedStyle(e).textDecorationLine') == 'none'
        assert page.locator('[data-task-uid][data-connection-active="true"]').count() == 1
        assert page.locator('[data-task-uid="connection-event-0"] .nautilus-log-record-title').evaluate('e=>getComputedStyle(e).opacity') == '1'
        assert_rect_equal(before, state(page), 'estimate hover cannot resize the frame')
        page.screenshot(path=str(OUT/'screenshots'/f'connections-{context}-{width}-{language}.png'), full_page=True)
        hide = 'Hide completed on chart' if language == 'en' else '在海螺中隐藏已完成'
        show = 'Show completed on chart' if language == 'en' else '在海螺中显示已完成'
        page.get_by_role('button', name=hide, exact=True).click(); settle_renderer(page)
        assert not page.locator('[data-time-claim="estimated-allocation"]').first.is_visible()
        assert not page.locator('.nautilus-log-estimated-outline').first.is_visible()
        assert_rect_equal(before, state(page), 'eye visibility preserves the source frame')
        page.get_by_role('button', name=show, exact=True).click(); settle_renderer(page)
        assert page.locator('[data-time-claim="estimated-allocation"]').first.is_visible()
        page.evaluate('''()=>{for(let i=0;i<7;i++)__chartHarness.updateChild(`connection-done-${i}`,`{{[[DONE]]}} Recorded task ${i} 30m d8`)}''')
        page.wait_for_function('document.querySelectorAll("[data-time-claim=estimated-allocation]").length===0')
        assert not page.locator('.nautilus-log-completion-node,[data-time-claim="estimated-allocation"]').count()
        # A local completion stamp replaces inferred placement, not estimated
        # duration. Its anchored interval remains dashed rather than implying CLOCK Actual.
        assert page.locator('[data-task-uid="connection-done-0"]').get_attribute('data-time-claim') == 'completion-estimate'
        assert page.locator('[data-estimate-outline-for="connection-done-0"] path').count() == 1
        coverage(page)
        reports[f'{context}-{width}-{language}'] = {'allocations': proof, 'overlap': overlap,
            'eyeHidesSlicesAndOutlines': True, 'localStampReplacesEstimatePlacement': True, 'sourceTabOrderPreserved': True}
    return reports


def density_and_control_contract(page):
    reports = {}
    for context, width in [('main', 720), ('embed', 520), ('sidebar', 280)]:
        load(page, 'connections', context, width, window='flow')
        select(page, 'connection-pending-0'); before = coverage(page); geometry_audit(page)
        measure = page.evaluate('''()=>{
          const tip=document.querySelector('.nautilus-log-detail-content').getBoundingClientRect();
          const host=document.querySelector('.nautilus-log-desk-host').getBoundingClientRect();
          const ink=Math.max(...[...document.querySelectorAll('.nautilus-log-record-title,.nautilus-log-record-meta,.nautilus-log-record-leader,.nautilus-log-slice,.nautilus-log-hour-label,.nautilus-log-record-marker')].map(e=>e.getBoundingClientRect().bottom));
          return {beforeTip:tip.top-ink,afterTip:host.top-tip.bottom,tipHeight:tip.height};
        }''')
        # The approved wide B shell is 336 rather than 300 view units across.
        # The symmetric, source-stable frame can retain up to half that growth
        # as orientation slack when no leader reaches the bottom of the shell.
        # This is bounded by the chosen plot size, not an extra text/card band.
        plot = before['presentation']['timeRadius'] * before['presentation']['plotScale'] * 2
        allowance = 14 + max(0, plot - 300) / 2 if width >= 640 else 20
        assert 0 <= measure['beforeTip'] <= allowance, (context, width, measure, allowance)
        assert 2 <= measure['afterTip'] <= 5 and measure['tipHeight'] <= 38.5, measure
        # B adds a real metadata row. Bound the frame by the source column
        # demand instead of the old title-only fixture's absolute 340px cap.
        budget = page.evaluate('''()=>{const s=__chartHarness.scene(),f=s.frame;let flexible=0,left=0,right=0;
          for(const r of s.records){if(r.event.todo&&!r.event.done&&!r.event.meeting)flexible+=r.label.height;
            else if(r.label.side==='left')left+=r.label.height;else right+=r.label.height;}
          return {height:f.viewBox.height,bound:14+Math.max(f.timeRadius*f.plotScale*2+16,flexible+Math.max(left,right)),tail:f.viewBox.height-f.timedBottom};}''')
        assert budget['height'] <= budget['bound'] + .5 and budget['tail'] == 2, budget
        for iso in ['2026-10-29T08:01:00', '2026-10-29T13:30:00', '2026-10-29T20:30:00']:
            after = set_clock(page, iso); coverage(page); geometry_audit(page)
            assert_clock_layout(before, after, 'same members stay stable; END moves pending work to the queue')
        select(page, 'connection-done-0'); geometry_audit(page)
        toggle = page.get_by_role('switch', name='Desk', exact=True)
        assert toggle.get_attribute('aria-checked') == 'false'
        assert toggle.get_attribute('aria-expanded') is None
        assert toggle.locator('svg').count() == 0 and toggle.locator('.nautilus-log-desk-switch-thumb').count() == 1
        box = toggle.bounding_box(); assert box['width'] == 40 and box['height'] == 32
        assert toggle.inner_text().strip() == '' and toggle.get_attribute('data-nautilus-tooltip') == 'Desk'
        assert toggle.evaluate('e=>getComputedStyle(e,"::after").whiteSpace==="nowrap"')
        # Verify the production CLJS callback boundary. The real Desk session
        # state/persistence/remount behavior is exercised by desk-switch.py.
        page.evaluate('''()=>{window.__deskCalls=[];window.nautilusLogExtensionData.openDesk=o=>__deskCalls.push({uid:o.planUid,origin:o.origin===document.querySelector('.nautilus-log-desk-btn'),host:o.container===document.querySelector('.nautilus-log-desk-host')})}''')
        toggle.click(); toggle.press('Space'); toggle.press('Enter')
        calls = page.evaluate('()=>window.__deskCalls')
        assert calls == [{'uid': 'baseline-plan', 'origin': True, 'host': True}] * 3, calls
        select(page, 'connection-done-2'); coverage(page)
        page.locator('.nautilus-log-container').screenshot(path=str(OUT/'screenshots'/f'density-{context}-{width}.png'))
        reports[f'{context}-{width}'] = {'spacing': measure, 'switchCallbacks': calls, 'clockStable': True, 'graphWrites': state(page)['writes']}
    load(page, 'stress', 'main', 720); set_clock(page, '2026-10-29T21:30:00')
    page.locator('.nautilus-log-pending-queue > summary').click(); settle_renderer(page)
    for uid in ['overflow-0', 'overflow-1', 'overflow-2', 'overflow-3']:
        page.locator(f'[data-queued-task-uid="{uid}"]').focus(); coverage(page); geometry_audit(page)
    load(page, 'connections', 'main', 720, window='flow', real_desk=True)
    set_clock(page, '2026-10-30T08:00:00')
    toggle = page.get_by_role('switch', name='Desk', exact=True)
    toggle.click()
    page.wait_for_function('document.querySelector(".nautilus-desk")?.dataset.status==="ready"')
    assert toggle.get_attribute('aria-checked') == 'true'
    set_clock(page, '2026-10-30T08:01:00')
    assert toggle.get_attribute('aria-checked') == 'true'
    page.get_by_role('button', name='Collapse Nautilus Log', exact=True).click()
    page.get_by_role('button', name='Expand Nautilus Log', exact=True).click(); settle_renderer(page)
    toggle = page.get_by_role('switch', name='Desk', exact=True)
    assert toggle.get_attribute('aria-checked') == 'true'
    assert page.locator('.nautilus-desk__card').count() == 2
    page.wait_for_function('()=>[...document.querySelectorAll(".nautilus-desk__card")].every(e=>e.dataset.previewState==="ready")')
    select(page, 'connection-done-0'); coverage(page); geometry_audit(page)
    composed = page.evaluate('''()=>{
      const tip=document.querySelector('.nautilus-log-detail-content').getBoundingClientRect();
      const queue=document.querySelector('.nautilus-log-pending-queue').getBoundingClientRect();
      const toolbar=document.querySelector('.nautilus-desk .rm-desk-page__toolbar').getBoundingClientRect();
      return {tipToQueue:queue.top-tip.bottom,queueToDesk:toolbar.top-queue.bottom,queueHeight:queue.height,cardUids:[...document.querySelectorAll('.nautilus-desk__card')].map(e=>e.dataset.taskUid),checked:document.querySelector('[role=switch]').getAttribute('aria-checked')};
    }''')
    assert 2 <= composed['tipToQueue'] <= 8 and 0 <= composed['queueToDesk'] <= 10, composed
    assert composed['cardUids'] == ['connection-pending-0', 'connection-pending-1'], composed
    page.locator('.nautilus-log-container').screenshot(path=str(OUT/'screenshots'/'density-with-native-desk.png'))
    page.get_by_role('button', name='Hide Desk', exact=True).click(); settle_renderer(page)
    assert toggle.get_attribute('aria-checked') == 'false' and not page.locator('.nautilus-desk').count()
    assert state(page)['writes'] == 0
    reports['nativeDeskComposition'] = composed
    return reports


def four_corrections_contract(page):
    reports = {}
    title_text = '核对项目资料分类与交付说明文本'
    for context, width, lang in [('main', 720, 'en'), ('sidebar', 280, 'zh')]:
        load(page, 'connections', context, width, window='flow', lang=lang)
        page.evaluate('text=>__chartHarness.updateChild("connection-done-0","{{[[DONE]]}} "+text+" 30m")', title_text)
        page.wait_for_function('text=>document.querySelector("[data-task-uid=connection-done-0]").dataset.recordTitle===text', arg=title_text)
        select(page, 'connection-done-0'); coverage(page)
        def tip_metrics():
            return page.evaluate('''()=>{
              const t=document.querySelector('.nautilus-log-detail-title'),b=document.querySelector('.nautilus-log-detail-expand'),range=document.createRange();range.selectNodeContents(b);
              return {title:t.textContent,titleWidth:t.clientWidth,titleScroll:t.scrollWidth,more:b.textContent,moreWidth:b.clientWidth,moreScroll:b.scrollWidth,whiteSpace:getComputedStyle(b).whiteSpace,rows:[...new Set([...range.getClientRects()].map(r=>Math.round(r.y)))],height:document.querySelector('.nautilus-log-detail-content').getBoundingClientRect().height};
            }''')
        normal = tip_metrics()
        assert normal['title'] == title_text and normal['titleScroll'] <= normal['titleWidth'], normal
        assert normal['moreScroll'] <= normal['moreWidth'] + 1 and len(normal['rows']) == 1 and normal['whiteSpace'] == 'nowrap', normal
        pressure_style = page.add_style_tag(content='.nautilus-log-content{overflow-wrap:anywhere;word-break:break-word}.nautilus-log-detail-expand{font-size:13px!important;letter-spacing:.4px}')
        settle_renderer(page); pressure = tip_metrics()
        assert pressure['titleScroll'] <= pressure['titleWidth'] and pressure['moreScroll'] <= pressure['moreWidth'] + 1 and len(pressure['rows']) == 1, pressure
        if width <= 360:
            assert pressure['height'] <= 38.5, pressure
        else:
            coverage(page)  # Full-mode metadata may wrap rather than be truncated.
        pressure_style.evaluate('e=>e.remove()'); settle_renderer(page)
        colors = page.locator('.nautilus-log-html-legend').first.locator('.nautilus-log-legend-dot').evaluate_all('els=>els.map(e=>getComputedStyle(e).backgroundColor)')
        assert colors == ['rgb(194, 75, 75)', 'rgb(173, 139, 36)', 'rgb(19, 124, 189)'], colors
        switch = page.get_by_role('switch', name='Desk', exact=True)
        assert switch.inner_text().strip() == '' and not switch.locator('.nautilus-log-desk-switch-label').count()
        switch.hover()
        page.wait_for_function('getComputedStyle(document.querySelector(".nautilus-log-desk-btn"),"::after").opacity==="1"')
        assert switch.evaluate('e=>getComputedStyle(e,"::after").content.includes("Desk")&&getComputedStyle(e,"::after").whiteSpace==="nowrap"')
        rows_before = page.evaluate('()=>__chartHarness.sourceRows()')
        past = set_clock(page, '2026-10-30T08:00:00'); coverage(page)
        assert past['queueKind'] == 'unfinished' and not past['queueOpen']
        assert [r['uid'] for r in past['queueItems']] == ['connection-pending-0', 'connection-pending-1']
        assert past['pendingQueue']['minutes'] == 90
        assert not page.locator('svg [data-task-uid^="connection-pending-"]').count()
        capacity = page.evaluate('()=>__chartHarness.traces().filter(t=>t.kind==="capacity").at(-1).result')
        assert capacity['demandMinutes'] == 0 and capacity['overloadMinutes'] == 0 and capacity['unplacedMinutes'] == 0, capacity
        hidden = 'Hide completed on chart' if lang == 'en' else '在海螺中隐藏已完成'
        shown = 'Show completed on chart' if lang == 'en' else '在海螺中显示已完成'
        page.get_by_role('button', name=hidden, exact=True).click(); coverage(page, hidden=True)
        assert page.locator('.nautilus-log-pending-queue').is_visible()
        page.get_by_role('button', name=shown, exact=True).click(); settle_renderer(page)
        select(page, 'connection-done-0'); before = coverage(page)
        page.locator('.nautilus-log-container').screenshot(path=str(OUT/'screenshots'/f'corrections-{context}-{width}-{lang}.png'))
        page.locator('.nautilus-log-pending-queue > summary').click(); settle_renderer(page); opened = coverage(page)
        assert all(r['visible'] for r in opened['queueItems'])
        assert all(abs(opened['svg'][k] - before['svg'][k]) < .5 for k in ['width', 'height'])
        before_locates = len(page.evaluate('()=>__chartHarness.traces().filter(t=>t.kind==="locate")'))
        page.locator('[data-queued-task-uid="connection-pending-0"]').press('Shift+Enter')
        calls = page.evaluate('()=>__chartHarness.traces().filter(t=>t.kind==="locate")')
        assert len(calls) == before_locates + 1 and calls[-1]['uid'] == 'connection-pending-0' and calls[-1]['sidebar']
        assert page.evaluate('()=>__chartHarness.sourceRows()') == rows_before
        page.evaluate('()=>__chartHarness.updateChild("connection-pending-0","{{[[DONE]]}} Write 45m")')
        page.wait_for_function('document.querySelector("svg [data-task-uid=connection-pending-0]")?.dataset.timeClaim==="estimated-allocation"')
        assert [r['uid'] for r in coverage(page)['queueItems']] == ['connection-pending-1']
        page.evaluate('()=>__chartHarness.updateChild("connection-pending-1","{{[[DONE]]}} Ship 45m")')
        page.wait_for_function('!document.querySelector(".nautilus-log-pending-queue")'); coverage(page)
        reports[f'{context}-{width}-{lang}'] = {'normalTip': normal, 'hostFontPressure': pressure, 'colors': colors,
          'pastCapacity': capacity, 'pastQueueMinutes': 90, 'fullTitlesAndNavigation': True, 'eyeIndependent': True, 'completedRejoinsDiagram': True}
    load(page, 'sparse'); set_clock(page, '2026-10-29T20:30:00'); coverage(page)
    assert not state(page)['pendingQueue']
    set_clock(page, '2026-10-29T20:31:00'); coverage(page)
    assert state(page)['queueKind'] == 'unscheduled' and [r['uid'] for r in state(page)['queueItems']] == ['task-reference']
    assert not page.locator('svg [data-task-uid="task-reference"]').count()
    load(page, 'connections', window='flow'); set_clock(page, '2026-10-28T23:00:00'); coverage(page)
    assert state(page)['lastTimeline']['result']['relation'] == 'future' and not state(page)['pendingQueue']
    load(page, 'overnight', window='overnight'); set_clock(page, '2026-10-30T00:15:00'); coverage(page)
    assert state(page)['lastTimeline']['result']['relation'] == 'today' and not state(page)['pendingQueue']
    set_clock(page, '2026-10-30T00:31:00'); coverage(page)
    assert state(page)['lastTimeline']['result']['relation'] == 'today' and state(page)['queueKind'] == 'unscheduled'
    set_clock(page, '2026-10-30T02:00:00'); coverage(page)
    assert state(page)['lastTimeline']['result']['relation'] == 'past' and state(page)['queueKind'] == 'unfinished'
    reports['dayBoundaries'] = {'beforeEndOverflow': True, 'futureFromStart': True, 'overnightCarryover': True, 'logicalEndBecomesPast': True}
    return reports


def full_tip_palette_contract(page):
    reports = {}
    text = '复核项目文档与交付材料并确认全部细节都能够完整阅读而不是省略'
    for context, width in [('main', 720), ('embed', 520), ('sidebar', 280)]:
        load(page, 'connections', context, width, window='flow', real_desk=True)
        set_clock(page, '2026-10-30T08:00:00')
        page.evaluate('s=>__chartHarness.updateChild("connection-done-0","{{[[DONE]]}} "+s+" 30m")', text)
        page.wait_for_function('s=>document.querySelector("[data-task-uid=connection-done-0]").dataset.recordTitle===s', arg=text)
        toggle = page.get_by_role('switch', name='Desk', exact=True)
        if toggle.get_attribute('aria-checked') != 'true': toggle.click()
        page.wait_for_function('document.querySelector(".nautilus-desk")?.dataset.status==="ready"')
        settle_renderer(page); before = state(page)['svg']; select(page, 'connection-done-0'); after = coverage(page)
        page.wait_for_function('''()=>document.querySelector('.nautilus-log-desk-switch-track').getAnimations().every(a=>a.playState==='finished')''')
        data = page.evaluate('''()=>{
          const region=document.querySelector('.nautilus-log-detail-region'),tip=region.querySelector('.nautilus-log-detail-content'),title=region.querySelector('.nautilus-log-detail-title');
          const queue=document.querySelector('.nautilus-log-pending-queue'),summary=queue.querySelector('summary'),toolbar=document.querySelector('.nautilus-desk .rm-desk-page__toolbar');
          return {mode:region.dataset.tipContent,width:tip.getBoundingClientRect().width,title:title.textContent,titleWidth:title.clientWidth,titleScroll:title.scrollWidth,titleHeight:title.clientHeight,titleScrollHeight:title.scrollHeight,textOverflow:getComputedStyle(title).textOverflow,gradient:getComputedStyle(title).backgroundImage,
            unfinishedAccent:getComputedStyle(queue).getPropertyValue('--nautilus-log-event').trim(),heading:getComputedStyle(queue.querySelector('.nautilus-log-queue-title')).color,marker:getComputedStyle(summary,'::marker').color,count:getComputedStyle(queue.querySelector('.nautilus-log-queue-count')).color,total:getComputedStyle(queue.querySelector('.nautilus-log-queue-total')).color,row:getComputedStyle(queue.querySelector('.nautilus-log-queue-item')).color,
            positive:getComputedStyle(queue).getPropertyValue('--nautilus-log-positive').trim(),switchColor:getComputedStyle(document.querySelector('.nautilus-log-desk-switch-track')).backgroundColor,
            tipBottom:tip.getBoundingClientRect().bottom,queueTop:queue.getBoundingClientRect().top,deskTop:toolbar.getBoundingClientRect().top,
            colors:[...document.querySelectorAll('.nautilus-log-html-legend .nautilus-log-legend-dot')].slice(0,3).map(e=>getComputedStyle(e).backgroundColor)};
        }''')
        assert data['title'] == text and data['colors'] == ['rgb(194, 75, 75)', 'rgb(173, 139, 36)', 'rgb(19, 124, 189)'], data
        assert data['positive'] == '#277a59' and data['switchColor'] == 'rgb(19, 124, 189)', 'preserve the user-selected native blue and positive green references'
        assert data['gradient'] == 'none', 'full-width content must use semantic text colors, not a gradient'
        assert page.locator('.nautilus-log-detail-title').evaluate('e=>getComputedStyle(e).color') == page.locator('[data-task-uid="connection-done-0"] .nautilus-log-record-title').evaluate('e=>getComputedStyle(e).fill')
        assert data['heading'] == 'rgb(123, 101, 26)' and data['marker'] == 'rgb(173, 139, 36)', data
        assert data['count'] == data['total'] and data['count'] != data['heading'] and data['row'] == 'rgb(16, 107, 163)', data
        assert data['queueTop'] >= data['tipBottom'] and data['deskTop'] >= data['tipBottom'], data
        assert all(abs(before[k]-after['svg'][k]) < .5 for k in ['width','height'])
        if width > 360:
            assert data['mode'] == 'full' and data['width'] > 280 and data['textOverflow'] != 'ellipsis', data
            assert data['titleScroll'] <= data['titleWidth'] + 1 and data['titleScrollHeight'] <= data['titleHeight'] + 1, data
        else:
            assert data['mode'] == 'compact' and data['width'] <= width - 32 and data['textOverflow'] == 'ellipsis', data
            assert page.get_by_role('button', name='Full text', exact=True).count() == 1
        page.locator('.nautilus-log-container').screenshot(path=str(OUT/'screenshots'/f'full-tip-{context}-{width}.png'))
        set_clock(page, '2026-10-29T20:30:00'); coverage(page)
        assert state(page)['queueKind'] == 'unscheduled'
        assert page.locator('.nautilus-log-queue-title').evaluate('e=>getComputedStyle(e).color') != data['heading']
        reports[f'{context}-{width}'] = data
    load(page, 'connections', 'main', 720, window='flow'); set_clock(page, '2026-10-30T08:00:00')
    page.locator('body').evaluate('e=>{e.classList.add("bp3-dark");e.style.background="#1d1e21";e.style.color="#ecedef"}')
    dark = page.evaluate('''()=>({colors:[...document.querySelectorAll('.nautilus-log-html-legend .nautilus-log-legend-dot')].slice(0,3).map(e=>getComputedStyle(e).backgroundColor),title:getComputedStyle(document.querySelector('.nautilus-log-queue-title')).color,marker:getComputedStyle(document.querySelector('.nautilus-log-pending-queue > summary'),'::marker').color,row:getComputedStyle(document.querySelector('.nautilus-log-queue-item')).color})''')
    assert dark['colors'] == ['rgb(194, 75, 75)', 'rgb(173, 139, 36)', 'rgb(19, 124, 189)'], dark
    assert dark['title'] == 'rgb(215, 191, 112)' and dark['marker'] == 'rgb(173, 139, 36)' and dark['row'] == 'rgb(142, 192, 222)', dark
    reports['darkPalette'] = dark
    load(page, 'long', 'main', 640)
    before = state(page)['svg']; select(page, 'long-unbroken'); wide = coverage(page)
    assert page.locator('.nautilus-log-detail-title').inner_text() == page.evaluate('()=>__chartHarness.longTitles()["long-unbroken"]')
    assert page.get_by_role('button', name='Full text', exact=True).count() == 0, 'wide title must not require More'
    assert page.locator('.nautilus-log-detail-title').evaluate('e=>getComputedStyle(e).backgroundImage==="none"')
    assert wide['detail']['height'] > 42
    assert all(abs(before[k]-wide['svg'][k]) < .5 for k in ['width','height'])
    page.evaluate('()=>__chartHarness.setWidth(280)')
    page.wait_for_function('document.querySelector(".nautilus-log-detail-region").dataset.nautilusDetail==="idle"')
    page.locator('svg [data-task-uid="long-unbroken"]').evaluate('e=>e.blur()')
    select(page, 'long-unbroken'); coverage(page)
    assert page.locator('.nautilus-log-detail-region').get_attribute('data-tip-content') == 'compact'
    page.get_by_role('button', name='Full text', exact=True).click(); settle_renderer(page); coverage(page)
    assert 'END_UNBROKEN' in page.locator('.nautilus-log-detail-title').inner_text()
    reports['unbrokenAndResize'] = {'wideAutomaticFullText': True, 'svgUnchanged': True, 'narrowExpansion': True, 'graphWrites': state(page)['writes']}
    return reports


def tagged_urgency_palette_contract(page):
    report = {}
    for theme, classes in [('light', ''), ('bp3', 'bp3-dark'), ('roam', 'roam-app rm-dark-theme'), ('dark', 'dark')]:
        load(page, 'mixed')
        page.locator('body').evaluate('''(e,c)=>{e.className=c;e.style.background=c?'#1d1e21':'#fff';e.style.color=c?'#ecedef':'#222326'}''', classes)
        page.evaluate('''()=>{window.nautilusLogExtensionData.settings['color-1-trigger']='#Priority';
          window.dispatchEvent(new Event('nautilus-log:settings-changed'));
          __chartHarness.updateChild('task-reference','{{[[TODO]]}} Priority task #Priority 30m');
          __chartHarness.updateChild('event-standup','09:00-09:30 Priority event #Priority');}''')
        page.wait_for_function('''()=>['task-reference','event-standup'].every(uid=>__chartHarness.scene().records.find(r=>r.uid===uid)?.event['bg-color']==='rgba(194,75,75,0.72)')''')
        page.wait_for_function('''()=>[...document.querySelectorAll('.nautilus-log-slice')].every(e=>e.getAnimations().every(a=>a.playState==='finished'))''')
        paint = page.evaluate('''()=>({legend:getComputedStyle(document.querySelector('.nautilus-log-legend-dot--urgent')).backgroundColor,
          slices:['task-reference','event-standup'].map(uid=>getComputedStyle(document.querySelector(`[data-task-uid="${uid}"] .nautilus-log-slice`)).fill),
          needle:getComputedStyle(document.querySelector('.nautilus-log-now-needle-line')).stroke})''')
        assert paint['legend'] == 'rgb(194, 75, 75)' and paint['slices'] == ['rgba(194, 75, 75, 0.72)'] * 2, paint
        assert paint['needle'] == ('rgb(229, 143, 140)' if classes else 'rgb(194, 75, 75)'), paint
        assert state(page)['writes'] == 0
        report[theme] = paint
    return report


def tip_surface_contract(page):
    report = {}
    for theme, dark in [('light', False), ('dark', True)]:
        for context, width, language in [('main', 720, 'en'), ('sidebar', 280, 'zh')]:
            load(page, 'connections', context, width, window='flow', lang=language)
            page.locator('body').evaluate('''(e,dark)=>{e.classList.toggle('bp3-dark',dark);e.style.background=dark?'#1d1e21':'#fff';e.style.color=dark?'#ecedef':'#222326'}''', dark)
            text = '核对项目资料分类与交付说明文本'
            page.evaluate('text=>__chartHarness.updateChild("connection-done-0","{{[[DONE]]}} "+text+" 30m")', text)
            page.wait_for_function('text=>document.querySelector("[data-task-uid=connection-done-0]").dataset.recordTitle===text', arg=text)
            settle_renderer(page)
            idle = state(page)
            select(page, 'connection-done-0'); coverage(page)
            assert_rect_equal(idle, state(page), 'showing a tip uses the reserved slot')
            def metrics():
                return page.evaluate('''()=>{
                  const content=document.querySelector('.nautilus-log-detail-content'),region=content.parentElement;
                  const title=content.querySelector('.nautilus-log-detail-title'),meta=content.querySelector('.nautilus-log-detail-meta'),button=content.querySelector('.nautilus-log-detail-expand');
                  const s=getComputedStyle(content),m=getComputedStyle(meta),b=getComputedStyle(button),r=content.getBoundingClientRect();
                  const tr=title.getBoundingClientRect(),mr=meta.getBoundingClientRect(),br=button.getBoundingClientRect();
                  const textBox=e=>{const range=document.createRange();range.selectNodeContents(e);return range.getBoundingClientRect()};
                  const mt=textBox(meta),bt=textBox(button);
                  return {titleFont:getComputedStyle(title).fontSize,metaFont:m.fontSize,metaTextTop:mt.top,buttonTextTop:bt.top,topSpace:r.top-region.getBoundingClientRect().top,padding:[s.paddingTop,s.paddingRight,s.paddingBottom,s.paddingLeft].map(parseFloat),rowGap:parseFloat(s.rowGap),columnGap:parseFloat(s.columnGap),radius:parseFloat(s.borderRadius),shadow:s.boxShadow,background:s.backgroundColor,border:s.borderTopColor,
                    titleLeft:tr.left-r.left,metaLeft:mr.left-r.left,titleTop:tr.top-r.top,buttonHeight:br.height,buttonWidth:br.width,buttonLeft:br.left,textRight:Math.max(tr.right,mr.right),panelCenter:r.top+r.height/2,buttonCenter:br.top+br.height/2,buttonColor:b.color,metaColor:m.color,
                    bottomSpace:region.getBoundingClientRect().bottom-r.bottom,height:r.height,titleFits:title.scrollWidth<=title.clientWidth,buttonFits:button.scrollWidth<=button.clientWidth,metaLineHeight:m.lineHeight};
                }''')
            normal = metrics()
            assert normal['padding'] == [4, 6, 4, 6] and normal['rowGap'] == 0 and normal['columnGap'] == 4, normal
            assert normal['radius'] == 4 and normal['shadow'] == 'none', normal
            assert abs(normal['titleLeft'] - normal['metaLeft']) < .5 and abs(normal['titleTop'] - 5) < .5, normal
            assert abs(normal['height'] - 38) < .5 and abs(normal['bottomSpace'] - 2) < .5 and abs(normal['topSpace'] - 2) < .5, normal
            assert normal['titleFont'] == normal['metaFont'] == '11px', normal
            assert normal['buttonHeight'] >= 24 and normal['buttonWidth'] >= 28 and normal['buttonFits'] and normal['titleFits'], normal
            assert abs(normal['buttonTextTop'] - normal['metaTextTop']) < .5 and normal['metaLineHeight'] == '14px', normal
            assert normal['buttonLeft'] - normal['textRight'] >= 3.5, 'the 24px action must not overlap either text row'
            assert normal['buttonColor'] == normal['metaColor'], normal
            background = [float(n) for n in re.findall(r'[\d.]+', normal['background'])]
            foreground = [float(n) for n in re.findall(r'[\d.]+', normal['metaColor'])]
            border = [float(n) for n in re.findall(r'[\d.]+', normal['border'])]
            assert max(background[:3]) - min(background[:3]) <= 3 and len(border) == 4 and border[3] <= .1, normal
            assert ratio(foreground, background) >= 4.5, normal
            page.locator('.nautilus-log-detail-content').screenshot(path=str(OUT / 'screenshots' / f'tip-surface-{theme}-{width}.png'))
            page.locator('.nautilus-log-container').screenshot(path=str(OUT / 'screenshots' / f'tip-layout-{theme}-{width}.png'))
            button = page.locator('.nautilus-log-detail-expand')
            button.hover()
            assert button.evaluate('e=>getComputedStyle(e).backgroundColor') != 'rgba(0, 0, 0, 0)'
            button.focus()
            assert button.evaluate('e=>getComputedStyle(e).outlineStyle') != 'none'
            button.press('Enter')
            expect(button).to_have_attribute('aria-expanded', 'true')
            coverage(page)
            expanded = metrics()
            assert expanded['padding'] == normal['padding'] and expanded['titleLeft'] == normal['titleLeft'], expanded
            assert expanded['height'] >= normal['height'] and abs(expanded['bottomSpace'] - 2) < .5, expanded
            button.press('Enter')
            expect(button).to_have_attribute('aria-expanded', 'false')
            settle_renderer(page)
            assert_rect_equal(idle, state(page), 'collapse restores the stable reserved slot')
            assert state(page)['writes'] == 0
            report[f'{theme}-{width}'] = {'closed': normal, 'expandedHeight': expanded['height'], 'stableSlot': True, 'graphWrites': 0}
    return report


def detail_name_semantics_contract(page):
    title = page.locator('.nautilus-log-detail-title')
    report = {}

    def paint():
        return title.evaluate('''e=>{const s=getComputedStyle(e),panel=getComputedStyle(e.closest('.nautilus-log-detail-content'));
          return {image:s.backgroundImage,fill:s.webkitTextFillColor,color:s.color,font:s.fontSize,
            animation:s.animationName,panel:panel.backgroundColor};}''')

    def semantic_name(uid, tone):
        select(page, uid); coverage(page)
        expect(title).to_have_class(re.compile('nautilus-log-detail-title--' + tone))
        p = paint()
        original = page.locator(f'[data-task-uid="{uid}"] .nautilus-log-record-title').evaluate('e=>getComputedStyle(e).fill')
        assert p['color'] == p['fill'] == original and p['image'] == 'none', p
        assert p['font'] == page.locator('.nautilus-log-detail-meta').evaluate('e=>getComputedStyle(e).fontSize') == '11px', p
        foreground = [float(n) for n in re.findall(r'[\d.]+', p['color'])]
        background = [float(n) for n in re.findall(r'[\d.]+', p['panel'])]
        score = ratio(foreground, background)
        assert score >= 4.5, (uid, p, score)
        return {'color': p['color'], 'contrast': score}

    for theme, classes in [('light', ''), ('bp3', 'bp3-dark'), ('roam', 'roam-app rm-dark-theme'), ('dark', 'dark')]:
        for context, width in [('main', 720), ('sidebar', 280)]:
            load(page, 'mixed', context, width)
            page.locator('body').evaluate('''(e,c)=>{e.className=c;e.style.background=c?'#1d1e21':'#fff';e.style.color=c?'#ecedef':'#222326'}''', classes)
            center_before = page.locator('.nautilus-log-center-date text').evaluate_all('nodes=>nodes.map(e=>({text:e.textContent,fill:getComputedStyle(e).fill}))')
            colors = {}
            for uid, tone in [('task-reference', 'task'), ('event-standup', 'event'), ('task-completed', 'completed'), ('task-long', 'task')]:
                colors[uid] = semantic_name(uid, tone)
                if theme in ('light', 'bp3'):
                    page.locator('.nautilus-log-detail-content').screenshot(path=str(OUT / 'screenshots' / f'detail-name-{theme}-{width}-{uid}.png'))
            assert len({colors[uid]['color'] for uid in ['task-reference', 'event-standup', 'task-completed']}) == 3
            assert page.locator('.nautilus-log-center-date text').evaluate_all('nodes=>nodes.map(e=>({text:e.textContent,fill:getComputedStyle(e).fill}))') == center_before
            semantic_name('task-unbroken', 'task')
            if width <= 360:
                page.get_by_role('button', name='Full text', exact=True).click()
            else:
                assert page.get_by_role('button', name='Full text', exact=True).count() == 0
                assert title.evaluate('e=>getComputedStyle(e).textOverflow!=="ellipsis" && e.scrollHeight<=e.clientHeight')
            expect(title).to_contain_text('XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX')
            coverage(page)
            assert paint()['image'] == 'none' and state(page)['writes'] == 0
            report[f'{theme}-{width}'] = {'colors': colors, 'completeLongTitle': True}

    for media in [{'forced_colors': 'active'}, {'media': 'print'}]:
        page.emulate_media(**media)
        p = paint()
        assert p['image'] == 'none' and p['fill'] not in ('transparent', 'rgba(0, 0, 0, 0)'), p
        page.emulate_media(media='screen', forced_colors='none')
    page.emulate_media(reduced_motion='reduce')
    assert paint()['animation'] == 'none'
    page.emulate_media(reduced_motion='no-preference')

    # A completed fixed event follows the chart's neutral completion styling too.
    load(page, 'untimed')
    semantic_name('fixed-done', 'completed')
    load(page, 'empty', 'main', 720)
    for target, text in [('.nautilus-log-available-slot', 'Available'), ('.nautilus-log-past-gap', 'Past gap')]:
        page.locator(target).first.focus()
        expect(title).to_contain_text(text)
        expect(title).to_have_class('nautilus-log-detail-title')
        p = paint()
        assert p['image'] == 'none' and p['fill'] not in ('transparent', 'rgba(0, 0, 0, 0)'), p
    assert state(page)['writes'] == 0
    return {'themesAndWidths': report, 'noGradient': True, 'statusLabelsUnchanged': True,
            'forcedColorsAndPrintReadable': True, 'graphWrites': 0}


def point_inside_gap(page, path, fraction=.5, click=False):
    # A continuous, folded sector's bounding-box center can be outside its fill
    # (or inside the other turn). Use a real interior point, then independently
    # verify both SVG containment and the browser's actual hit target.
    point = path.evaluate('''(e,fraction)=>{
      const owner=e.closest('[data-past-gap-key]'),s=__chartHarness.scene(),input=__chartHarness.sceneInput();
      const start=Number(owner.dataset.pastGapStart),end=Number(owner.dataset.pastGapEnd),minute=start+(end-start)*fraction;
      const radiusScale=s.frame.timeRadius/150,r=nautilusLogCore.shellRadii({minute,startMinutes:input.startMinutes,endMinutes:input.endMinutes,innerRadius:50*radiusScale,radiusScale});
      const angle=(minute-900)*Math.PI/360,radius=(r.inner+r.outer)/2;
      const local=new DOMPoint(s.frame.center.x+Math.cos(angle)*radius,s.frame.center.y+Math.sin(angle)*radius);
      const screen=local.matrixTransform(e.getScreenCTM()),hit=document.elementFromPoint(screen.x,screen.y)?.closest('[data-past-gap-key]');
      return {x:screen.x,y:screen.y,inside:e.isPointInFill(local),target:hit?.dataset.pastGapKey,expected:owner.dataset.pastGapKey};
    }''', fraction)
    assert point['inside'] and point['target'] == point['expected'], point
    if click: page.mouse.click(point['x'], point['y'])
    else: page.mouse.move(point['x'], point['y'])
    return point


def past_gap_inspection_contract(page):
    detail = page.locator('.nautilus-log-detail-region')

    def graph_reads():
        return page.evaluate('()=>__chartHarness.traces().filter(t=>["query","read-string"].includes(t.kind)).length')

    def pinned(gap, text):
        # Reagent commits on a later animation frame. Wait for rendered state,
        # not a fixed delay or aria-pressed read in the input handler's tick.
        expect(gap).to_have_attribute('aria-pressed', 'true')
        expect(detail).to_have_class(re.compile(r'\bis-expanded\b'))
        expect(detail).to_contain_text(text)
        page.mouse.move(1180, 980)
        settle_renderer(page)
        expect(detail).to_have_attribute('data-nautilus-detail', 'active')

    def dismissed():
        expect(detail).to_have_attribute('data-nautilus-detail', 'idle')
        expect(page.locator('.nautilus-log-past-gap[aria-pressed="true"]')).to_have_count(0)

    # Today: the past ends at NOW; future availability stays a separate target.
    before = load(page, 'empty', 'main', 720)
    today_gap = page.locator('[data-past-gap-key="past-gap:300:481"]')
    expect(today_gap).to_have_count(1)
    assert page.locator('.nautilus-log-available-slot').count() >= 1
    reads_before = graph_reads()
    point_inside_gap(page, today_gap.locator('.nautilus-log-past-gap-hit').first)
    expect(detail).to_contain_text('05:00–08:01 · 3h01m')
    expect(today_gap).to_have_attribute('aria-pressed', 'false')
    assert_rect_equal(before, state(page), 'past-gap hover cannot resize the frame')
    today_gap.focus()
    expect(today_gap).to_have_attribute('aria-pressed', 'false')
    today_gap.press('Enter')
    pinned(today_gap, '05:00–08:01 · 3h01m')
    expect(detail).to_contain_text('actual activity is unknown')
    assert graph_reads() == reads_before and state(page)['writes'] == 0
    # Escape works from the detail button too, not only from the SVG target.
    collapse = page.get_by_role('button', name='Collapse text', exact=True)
    collapse.focus(); collapse.press('Escape'); dismissed()
    today_gap.focus(); today_gap.press('Space')
    pinned(today_gap, '05:00–08:01 · 3h01m')
    set_clock(page, '2026-10-29T08:02:00')
    dismissed()
    expect(page.locator('[data-past-gap-key="past-gap:300:482"]')).to_have_count(1)
    set_clock(page, '2026-10-29T04:59:00')
    expect(page.locator('.nautilus-log-past-gap')).to_have_count(0)
    set_clock(page, '2026-10-28T08:01:00')
    expect(page.locator('.nautilus-log-past-gap')).to_have_count(0)

    # Historical day: one continuous gap surface, no Available slot. Both
    # early and late interior points must resolve to the same logical gap.
    load(page, 'sparse', 'main', 720)
    set_clock(page, '2026-10-30T08:01:00')
    gaps = page.locator('.nautilus-log-past-gap')
    expect(gaps).to_have_count(2)
    assert not page.locator('.nautilus-log-available-slot').count()
    gap = page.locator('[data-past-gap-key="past-gap:570:1260"]')
    target = {'start': 570, 'end': 1260, 'duration': 690,
              'paths': gap.locator('.nautilus-log-past-gap-hit').count()}
    assert target['paths'] == 1, target
    reads_before = graph_reads()
    for fraction in [.2, .8]:
        point_inside_gap(page, gap.locator('.nautilus-log-past-gap-hit').first, fraction)
        expect(detail).to_contain_text('09:30–21:00 · 11h30m')
        expect(gap).to_have_attribute('aria-pressed', 'false')
    point_inside_gap(page, gap.locator('.nautilus-log-past-gap-hit').first, click=True)
    pinned(gap, '09:30–21:00 · 11h30m')
    expect(detail).to_contain_text('actual activity is unknown')
    other = gaps.first
    point_inside_gap(page, other.locator('.nautilus-log-past-gap-hit').first, click=True)
    pinned(other, '05:00–09:00 · 4h')
    expect(gap).to_have_attribute('aria-pressed', 'false')
    other.press('Escape'); dismissed()
    gap.focus(); expect(gap).to_have_attribute('aria-pressed', 'false')
    gap.press('Enter'); pinned(gap, '09:30–21:00 · 11h30m')
    gap.press('Escape'); dismissed()
    gap.focus(); gap.press('Space'); pinned(gap, '09:30–21:00 · 11h30m')
    assert graph_reads() == reads_before and state(page)['writes'] == 0
    page.evaluate('()=>__chartHarness.updateChild("event-standup", "05:00-21:00 Full-day synthetic event")')
    dismissed()
    expect(gaps).to_have_count(0)

    # Today the task stays in SVG; historical unfinished tasks stay in the queue.
    # A pinned gap must not intercept either normal locate action.
    load(page, 'sparse', 'main', 720)
    gap = page.locator('.nautilus-log-past-gap').first
    point_inside_gap(page, gap.locator('.nautilus-log-past-gap-hit').first, click=True)
    pinned(gap, 'actual activity is unknown')
    page.locator('[data-task-uid="task-reference"] .nautilus-log-slice').first.click()
    page.wait_for_function('()=>__chartHarness.traces().filter(t=>t.kind==="locate").at(-1)?.uid === "task-reference"')
    dismissed()
    set_clock(page, '2026-10-30T08:01:00')
    gap = page.locator('.nautilus-log-past-gap').first
    point_inside_gap(page, gap.locator('.nautilus-log-past-gap-hit').first, click=True)
    pinned(gap, '05:00–09:00 · 4h')
    assert not page.locator('svg [data-task-uid="task-reference"]').count()
    page.locator('.nautilus-log-pending-queue > summary').click()
    before_locates = len(page.evaluate('()=>__chartHarness.traces().filter(t=>t.kind==="locate")'))
    page.locator('[data-queued-task-uid="task-reference"]').click()
    page.wait_for_function('n=>__chartHarness.traces().filter(t=>t.kind==="locate").length===n+1', arg=before_locates)
    dismissed()

    # Hidden completions/estimates still occupy their original intervals.
    load(page, 'untimed', 'main', 720)
    set_clock(page, '2026-10-30T08:01:00')
    assert page.locator('[data-time-claim="estimated-allocation"]').count() > 0
    gap_keys = page.locator('.nautilus-log-past-gap').evaluate_all('nodes=>nodes.map(n=>n.dataset.pastGapKey)')
    page.get_by_role('button', name='Hide completed on chart', exact=True).click()
    settle_renderer(page)
    assert page.locator('.nautilus-log-past-gap').evaluate_all('nodes=>nodes.map(n=>n.dataset.pastGapKey)') == gap_keys
    assert state(page)['writes'] == 0

    # Cross-midnight elapsed time uses one logical interval and clock labels.
    load(page, 'empty', 'main', 720, window='overnight')
    set_clock(page, '2026-10-30T01:15:00')
    night = page.locator('[data-past-gap-key="past-gap:1260:1515"]')
    night.focus(); night.press('Enter')
    pinned(night, '21:00–01:15 · 4h15m')
    night.press('Escape'); dismissed()
    assert state(page)['writes'] == 0

    # Full text is readable on a genuinely dark surface, including Chinese.
    for language in ['en', 'zh']:
        load(page, 'sparse', 'sidebar', 280, lang=language)
        set_clock(page, '2026-10-30T08:01:00')
        page.locator('body').evaluate('e=>{e.classList.add("bp3-dark");e.style.background="#1d1e21";e.style.color="#ecedef"}')
        page.emulate_media(reduced_motion='reduce')
        narrow_gap = page.locator('.nautilus-log-past-gap').first
        point_inside_gap(page, narrow_gap.locator('.nautilus-log-past-gap-hit').first, click=True)
        pinned(narrow_gap, '05:00–09:00 · 4h')
        expect(detail).to_contain_text('actual activity is unknown' if language == 'en' else '实际活动未知')
        assert state(page)['documentOverflow'] <= 0 and state(page)['writes'] == 0
        page.locator('.nautilus-log-container').screenshot(path=str(OUT / 'screenshots' / f'past-gap-dark-narrow-{language}.png'))
        page.emulate_media(reduced_motion='no-preference')
    return {'todayKeyboardAndClockInvalidation': True, 'crossHourRange': target,
            'pinDismissInvalidate': True, 'hiddenCompletedOccupancy': True,
            'overnight': True, 'narrowDarkLanguages': ['en', 'zh'], 'interactionGraphReads': 0, 'graphWrites': 0}


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
    assert next_day['timeline']['result']['scheduleFromMinutes'] == 1260
    assert state(page)['queueKind'] == 'unfinished'
    assert [r['uid'] for r in state(page)['queueItems']] == ['task-reference','task-long','task-unbroken']
    assert not any(r['uid'] in ['task-reference','task-long','task-unbroken'] for r in next_day['records'])
    set_clock(page, '2026-10-29T20:59:00'); ended = snapshot()
    assert state(page)['queueKind'] == 'unscheduled'
    assert [r['uid'] for r in state(page)['queueItems']] == ['task-reference','task-long','task-unbroken']
    assert not any(r['uid'] in ['task-reference','task-long','task-unbroken'] for r in ended['records'])
    assert len(page.evaluate('()=>__chartHarness.activeClockListeners()')) == 3
    page.evaluate('()=>__chartHarness.unmount()')
    assert page.evaluate('()=>__chartHarness.activeClockListeners()') == []
    assert state(page)['activeClockIntervals'] == 0
    return {'minuteAdvance':records,'blockedByEvent':blocked,'visibleResume':visible,'clockNotification':clock_change,'sameMinuteNextDay':next_day,'end':ended,'cleanup':True}


def afternoon_flow_contract(page):
    load(page,'flow','main',640,window='flow')
    before=set_clock(page,'2026-10-29T13:29:00')
    observations=[]
    for iso in ['2026-10-29T13:29:00','2026-10-29T13:30:00','2026-10-29T13:31:00']:
        set_clock(page,iso);coverage(page)
        assert_rect_equal(before,state(page),'ordinary pending flow frame')
        data=page.evaluate('''()=>({clock:__chartHarness.state().nowLabel,
          capacity:__chartHarness.traces().filter(t=>t.kind==='capacity').at(-1).result,
          scheduler:__chartHarness.traces().filter(t=>t.kind==='schedule-tasks').at(-1).result,
          first:__chartHarness.scene().records.find(r=>r.uid==='flow-task-0').event,
          firstPath:document.querySelector('[data-task-uid="flow-task-0"] .nautilus-log-slice').getAttribute('d'),
          fixedPath:document.querySelector('[data-task-uid="flow-current-event"] .nautilus-log-slice').getAttribute('d'),
          fixedPhase:document.querySelector('[data-task-uid="flow-current-event"]').dataset.visualPhase,
          looseKinds:[...document.querySelectorAll('.nautilus-log-loose-record')].map(e=>e.dataset.chartKind)})''')
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
    assert a['looseKinds'] == []
    assert [r['uid'] for r in state(page)['queueItems']] == ['flow-task-6', 'flow-task-7']
    assert page.locator('[data-time-claim="estimated-allocation"]').count() == 2
    set_clock(page,'2026-10-29T20:00:00');coverage(page)
    assert_clock_layout(before,state(page),'pending membership changes at END')
    assert page.locator('[data-queued-task-uid]').count() == 8
    assert not page.locator('svg [data-task-uid^="flow-task-"]').count()
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
    assert page.locator('.nautilus-log-html-legend').first.locator('.nautilus-log-legend-item').count() == 3
    assert page.locator('.nautilus-log-unplanned-overlay pattern').count() == 1
    result={'materials':{'start':at_start,'duringEvent':during,'afterEvent':after},'tips':{}}
    for context,width in [('main',960),('sidebar',280),('embed',520)]:
        load(page,'routine',context,width)
        page.evaluate('()=>__chartHarness.updateChild("routine-0","18:30-19:00 Review")')
        page.wait_for_function('document.querySelector("[data-task-uid=routine-0]").dataset.recordTitle==="Review"')
        select(page,'routine-0');coverage(page)
        short=page.locator('.nautilus-log-detail-content').bounding_box()
        assert short['width'] < 250 and short['height'] <= 38.5, short
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
        assert long['width'] <= min(720,width)-32+1
        if width <= 360:
            assert long['height'] <= 38.5
            assert page.get_by_role('button',name='Full text',exact=True).count()==1
        else:
            assert page.locator('.nautilus-log-detail-title').evaluate('e=>e.scrollWidth<=e.clientWidth && e.scrollHeight<=e.clientHeight')
            assert page.get_by_role('button',name='Full text',exact=True).count()==0
        page.screenshot(path=str(OUT/'screenshots'/f'compact-tip-{context}-{width}.png'),full_page=True)
        result['tips'][f'{context}-{width}']={'short':short,'long':long}
    return result


def lifecycle(page):
    load(page, 'untimed')
    start = coverage(page)
    kinds = {r['uid']: r['kind'] for r in start['records']}
    for uid in ['untimed-local', 'untimed-reference', 'running-only', 'other-day']:
        assert kinds[uid] == 'timed'
        assert page.locator(f'[data-task-uid="{uid}"]').get_attribute('data-time-claim') == 'estimated-allocation'
    select(page, 'untimed-reference')
    aria = page.locator('[data-task-uid="untimed-reference"]').get_attribute('aria-label')
    assert 'Completion status from reference' in aria and 'Not a recorded completion time' in aria
    assert 'Estimated allocation' in aria and 'Actual' not in aria
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
    page.wait_for_function('document.querySelector("[data-task-uid=pending-next]").dataset.timeClaim === "estimated-allocation"')
    settle_renderer(page); done = coverage(page)
    # Explicit status/CLOCK edits change the source allocation; only subsequent
    # clock-only updates must preserve its source-sized frame.
    assert done['sourceUids'] == start['sourceUids']
    assert page.locator('[data-estimate-outline-for="pending-next"]').count() == 1
    after_tick = set_clock(page, '2026-10-29T08:02:00')
    assert_rect_equal(done, after_tick, 'minute-only update after source status edit')
    select(page, 'untimed-reference')
    page.evaluate('()=>__chartHarness.setClockEntries([{taskUid:"untimed-reference",start:"2026-10-29T07:00:00",end:"2026-10-29T07:10:00",running:false}])')
    page.wait_for_function('document.querySelector("[data-task-uid=untimed-reference]").dataset.timeClaim === "actual"')
    settle_renderer(page); actual = coverage(page)
    assert actual['sourceUids'] == start['sourceUids']
    assert not page.locator('[data-estimate-outline-for="untimed-reference"]').count()
    after_tick = set_clock(page, '2026-10-29T08:03:00')
    assert_rect_equal(actual, after_tick, 'minute-only update after local CLOCK edit')
    assert '07:00–07:10' in page.locator('[data-task-uid="untimed-reference"]').get_attribute('aria-label')
    assert page.locator('.nautilus-log-detail-region').get_attribute('data-nautilus-detail') == 'idle'
    select(page, 'untimed-local')
    page.evaluate('()=>__chartHarness.removeChild("untimed-local")')
    page.wait_for_function('!document.querySelector("[data-task-uid=untimed-local]")')
    settle_renderer(page)
    assert page.locator('.nautilus-log-detail-region').get_attribute('data-nautilus-detail') == 'idle'
    load(page, 'mixed')
    select(page, 'task-reference')
    page.locator('[data-task-uid="event-standup"] .nautilus-log-record-label').hover()
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
    return {'before': compact_record(start), 'hidden': compact_record(hidden), 'done': compact_record(done), 'actual': compact_record(actual), 'navigation': True, 'foldAndUnload': True, 'explicitSourceEditsMayReflow': True}


def full_text(page, context, width):
    load(page, 'long', context, width)
    # Extra provenance legitimately offers More; the wide title itself is
    # already complete and must not depend on that action.
    page.evaluate('()=>__chartHarness.updateChild("long-unbroken","{{[[DONE]]}} "+__chartHarness.longTitles()["long-unbroken"]+" 30m")')
    page.wait_for_function('document.querySelector("[data-task-uid=long-unbroken]").dataset.timeClaim==="estimated-allocation"')
    select(page, 'long-unbroken')
    before = coverage(page)
    assert page.locator('.nautilus-log-detail-expand').bounding_box()['height'] <= 24.5, 'More must not stretch over a long wide title'
    scroll_before = page.evaluate('() => scrollY')
    page.get_by_role('button', name='Full text', exact=True).click(); settle_renderer(page)
    expanded = coverage(page)
    assert 'END_UNBROKEN' in page.locator('.nautilus-log-detail-title').inner_text()
    assert page.locator('.nautilus-log-detail-title').evaluate('e=>getComputedStyle(e).webkitLineClamp') == 'none'
    if width <= 360:
        assert expanded['detail']['height'] > before['detail']['height']
    # In a full-width view the title may reflow into fewer lines when More
    # moves beside metadata. Verify revealed content, not forced extra height.
    assert 'Not a recorded completion time' in page.locator('.nautilus-log-detail-meta').inner_text()
    assert all(abs(expanded['svg'][key] - before['svg'][key]) < .5 for key in ('x', 'width', 'height')), 'explicit expansion must not resize the SVG'
    assert abs(expanded['svg']['y'] + page.evaluate('() => scrollY') - before['svg']['y'] - scroll_before) < .5, 'the diagram must keep its document-flow position'
    label = page.locator('[data-task-uid="long-cjk"] .nautilus-log-record-label')
    label.hover(); settle_renderer(page)
    hit = label.evaluate('''e=>{const r=e.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('[data-task-uid]')?.dataset.taskUid}''')
    assert hit == 'long-cjk', 'multiline label gaps must belong to their own interactive record'
    assert 'END_UNBROKEN' in page.locator('.nautilus-log-detail-title').inner_text(), 'expanded reading must be pinned'
    page.get_by_role('button', name='Collapse text', exact=True).click(); settle_renderer(page)
    # Less must collapse its own record, not expose a stale hover acquired
    # behind the pinned inspector and remove the focused action mid-render.
    assert 'END_UNBROKEN' in page.locator('.nautilus-log-detail-title').inner_text(), 'collapse changed the inspected record'
    page.mouse.move(1180, 980); settle_renderer(page)
    if width <= 360:
        assert abs(state(page)['detail']['height'] - 42) < .5
    else:
        assert 'END_UNBROKEN' in page.locator('.nautilus-log-detail-title').inner_text()
        assert page.locator('.nautilus-log-detail-title').evaluate('e=>getComputedStyle(e).textOverflow!=="ellipsis" && e.scrollHeight<=e.clientHeight')
    page.screenshot(path=str(OUT / 'screenshots' / f'fulltext-{context}-{width}.png'), full_page=True)
    return {'closed': compact_record(before), 'expandedHeight': expanded['detail']['height'], 'pinned': True, 'noInternalScroll': True}


def center_clock_contract(page):
    report = {}

    def quiet_typography():
        proof = page.locator('.nautilus-log-center-now').evaluate('''e=>{
          const s=getComputedStyle(e),svg=getComputedStyle(e.closest('svg')),
            date=getComputedStyle(e.parentElement.querySelector('text')),m=e.getScreenCTM(),r=e.getBoundingClientRect();
          return {pixels:parseFloat(s.fontSize)*Math.hypot(m.c,m.d),weight:s.fontWeight,
            family:s.fontFamily,uiFamily:svg.fontFamily,numerals:s.fontVariantNumeric,
            spacing:s.letterSpacing,uiSpacing:svg.letterSpacing,fill:s.fill,dateFill:date.fill,
            dateWeight:date.fontWeight,width:r.width};
        }''')
        assert 8.9 <= proof['pixels'] <= 16.05, proof
        assert proof['weight'] == '400' and proof['dateWeight'] == '500', proof
        assert proof['family'] == proof['uiFamily'] and proof['spacing'] == proof['uiSpacing'], proof
        assert 'tabular-nums' in proof['numerals'], proof
        return proof

    for lang in ['en', 'zh']:
        for context, width in [('main', 960), ('embed', 520), ('sidebar', 280)]:
            before = load(page, 'mixed', context, width, lang=lang)
            center = page.locator('.nautilus-log-center-date')
            rows = center.locator('text').all_text_contents()
            assert len(rows) == 2 and rows[0] in ['October 29th', 'Oct 29'] and rows[1] == '08:01', rows
            assert not page.locator('.nautilus-log-center-caption').count()
            assert center.get_attribute('aria-label') == 'October 29th 08:01'
            now_name = 'Current time' if lang == 'en' else '当前时间'
            expect(page.locator('.nautilus-log-now-needle')).to_have_attribute('aria-label', f'{now_name} 08:01')
            typography = {'light': quiet_typography()}
            assert typography['light']['fill'] == typography['light']['dateFill'], typography
            if width == 960:
                assert abs(typography['light']['pixels'] - 16) < .05, typography
            current = set_clock(page, '2026-10-29T08:02:00')
            assert center.locator('text').all_text_contents() == [rows[0], '08:02']
            assert center.get_attribute('aria-label') == 'October 29th 08:02'
            assert_rect_equal(before, current, 'caption-free center retains the clock and stable frame')
            assert abs(quiet_typography()['width'] - typography['light']['width']) < .05, 'tabular time must not jump at a minute update'
            page.locator('.nautilus-log-container').screenshot(path=str(OUT / 'screenshots' / f'center-clock-{lang}-{context}-{width}.png'))
            page.locator('body').evaluate("e=>{e.classList.add('bp3-dark');e.style.background='#1d1e21';e.style.color='#ecedef'}")
            settle_renderer(page)
            typography['dark'] = quiet_typography()
            assert typography['dark']['fill'] == typography['dark']['dateFill'], typography
            assert typography['dark']['fill'] != typography['light']['fill'], typography
            page.locator('.nautilus-log-container').screenshot(path=str(OUT / 'screenshots' / f'center-clock-dark-{lang}-{context}-{width}.png'))
            page.emulate_media(forced_colors='active'); settle_renderer(page)
            typography['forcedColors'] = quiet_typography()
            canvas_text = page.evaluate('''()=>{const e=document.createElement('span');e.style.cssText='position:absolute;visibility:hidden;color:CanvasText';
              document.body.append(e);const value=getComputedStyle(e).color;e.remove();return value;}''')
            assert typography['forcedColors']['fill'] == canvas_text, typography
            page.emulate_media(forced_colors='none')
            set_clock(page, '2026-10-29T21:01:00')
            assert center.locator('text').all_text_contents() == [rows[0]]
            assert center.get_attribute('aria-label') == 'October 29th'
            assert not page.locator('.nautilus-log-now-needle').count()
            assert state(page)['writes'] == 0
            report[f'{lang}-{context}-{width}'] = {'date': rows[0], 'time': '08:02', 'visibleCaption': False,
                'accessibleTimeRetained': True, 'clockRangePreserved': True, 'typography': typography, 'graphWrites': 0}
    return report


def continuous_shell_contract(page):
    report = {}
    for context, width in [('main', 720), ('embed', 520), ('sidebar', 280)]:
        load(page, 'mixed', context, width)
        page.mouse.move(1180, 980); settle_renderer(page)
        before = state(page); geometry_audit(page)
        proof = page.evaluate('''()=>{
          const scene=__chartHarness.scene(),input=__chartHarness.sceneInput(),svg=document.querySelector('svg.nautilus-log-svg');
          const options={startMinutes:input.startMinutes,endMinutes:input.endMinutes,centerX:scene.frame.center.x,centerY:scene.frame.center.y,innerRadius:50,radiusScale:1};
          const records=scene.records.filter(r=>r.kind==='timed').map(r=>{const node=document.querySelector(`svg [data-task-uid="${r.uid}"]`),paths=[...node.querySelectorAll('.nautilus-log-slice')],meta=node.querySelector('.nautilus-log-record-meta'),hit=node.querySelector('.nautilus-log-label-hit').getBoundingClientRect(),mr=meta.getBoundingClientRect();return {uid:r.uid,count:paths.length,path:paths[0].getAttribute('d'),expected:nautilusLogCore.shellInterval({...options,start:r.event.start,end:r.event.end}).path,meta:meta.textContent,metadataInside:mr.left>=hit.left-1&&mr.right<=hit.right+1&&mr.bottom<=hit.bottom+1};});
          const gradients=[...svg.querySelectorAll('radialGradient')].map(g=>({id:g.id,stops:[...g.querySelectorAll('stop')].map(s=>getComputedStyle(s).stopColor)}));
          const fill=getComputedStyle(document.querySelector('[data-task-uid="task-long"] .nautilus-log-slice')).fill;
          return {records,gradients,fill,inlineMaterial:svg.style.getPropertyValue('--nautilus-log-task-future-fill'),oldHourSectors:svg.querySelectorAll('.nautilus-log-grid .nautilus-log-slice').length,outline:svg.querySelector('.nautilus-log-shell-outline').getAttribute('d'),base:svg.querySelector('.nautilus-log-shell-base').getAttribute('d')};
        }''')
        assert all(r['count'] == 1 and r['path'] == r['expected'] and r['path'].count('M') == 1 and r['path'].endswith('Z') and r['metadataInside'] for r in proof['records']), proof
        assert len(proof['gradients']) == 4 and len({g['id'] for g in proof['gradients']}) == 4, proof
        assert proof['inlineMaterial'].startswith('url(#nautilus-shell-') and 'url(' in proof['fill'], 'Reagent CSS variables must use string keys and actually paint the gradients'
        assert proof['oldHourSectors'] == 0 and proof['outline'] == proof['base'], proof
        original_paths = {r['uid']: r['path'] for r in proof['records']}
        select(page, 'task-long')
        page.wait_for_function('''()=>document.querySelector('[data-task-uid="task-long"] .nautilus-log-slice').getAnimations().every(a=>a.playState==='finished')''')
        after = coverage(page); assert_rect_equal(before, after, 'B hover/focus preserves the full source frame')
        hover = page.locator('[data-task-uid="task-long"]').evaluate('''e=>({width:parseFloat(getComputedStyle(e.querySelector('.nautilus-log-slice')).strokeWidth),stroke:getComputedStyle(e.querySelector('.nautilus-log-slice')).stroke,leader:getComputedStyle(e.querySelector('.nautilus-log-record-leader')).stroke,highlight:getComputedStyle(e.querySelector('.nautilus-log-label-highlight')).fill,hit:getComputedStyle(e.querySelector('.nautilus-log-label-hit')).fill})''')
        assert hover['width'] == 2 and hover['stroke'] == hover['leader'] and hover['highlight'] != 'rgba(0, 0, 0, 0)', hover
        assert hover['hit'] in ['transparent', 'rgba(0, 0, 0, 0)'], hover
        assert page.locator('svg [data-connection-active="true"]').count() == 1
        now_paths = page.locator('svg [data-task-uid]').evaluate_all('nodes=>Object.fromEntries(nodes.filter(e=>e.querySelector(".nautilus-log-slice")).map(e=>[e.dataset.taskUid,e.querySelector(".nautilus-log-slice").getAttribute("d")]))')
        assert now_paths == original_paths
        page.locator('.nautilus-log-container').screenshot(path=str(OUT/'screenshots'/f'shell-hover-{context}-{width}.png'))
        report[f'{context}-{width}'] = {'proof': proof, 'hover': hover, 'geometryStable': True}

    load(page, 'untimed', 'main', 720)
    select(page, 'clock-done'); coverage(page)
    expect(page.locator('.nautilus-log-detail-meta')).to_contain_text('Actual 15m')
    expect(page.locator('[data-task-uid="clock-done"] .nautilus-log-record-meta')).to_contain_text('Completed · Actual 15m')
    assert not page.locator('[data-estimate-outline-for="clock-done"]').count()
    page.locator('.nautilus-log-container').screenshot(path=str(OUT/'screenshots'/'shell-actual.png'))
    select(page, 'untimed-local'); before = coverage(page)
    expect(page.locator('.nautilus-log-detail-meta')).to_contain_text('Completed · Estimate 20m')
    surface = page.locator('[data-task-uid="untimed-local"] .nautilus-log-slice').get_attribute('d')
    outline = page.locator('[data-estimate-outline-for="untimed-local"] path')
    assert outline.count() == 1 and outline.get_attribute('d') == surface
    assert outline.evaluate('e=>getComputedStyle(e).strokeDasharray') != 'none'
    assert page.locator('[data-task-uid="untimed-local"] .nautilus-log-slice').evaluate('e=>getComputedStyle(e).stroke') == 'none', 'hover must not paint a solid border underneath the dashed estimate outline'
    page.get_by_role('button', name='Full text', exact=True).click(); settle_renderer(page)
    expect(page.locator('.nautilus-log-detail-meta')).to_contain_text('Not a recorded completion time')
    expanded = coverage(page)
    assert all(abs(before['svg'][k]-expanded['svg'][k]) < .5 for k in ['x','y','width','height'])
    page.locator('.nautilus-log-container').screenshot(path=str(OUT/'screenshots'/'shell-estimate-expanded.png'))
    assert state(page)['writes'] == 0
    report['completion'] = {'actualVisibleInSummary': True, 'estimateUsesIdenticalDashedPath': True, 'expandedDetailsKeepSvgFrame': True, 'graphWrites': 0}
    return report


def main():
    (OUT / 'bundle').mkdir(); (OUT / 'screenshots').mkdir()
    subprocess.check_call(['node', 'test/chart-renderer-bundle.cjs', str(OUT / 'bundle')], cwd=ROOT,
                          env={**os.environ, 'NODE_PATH': str(NODE_MODULES)})
    source = COMPONENT.read_text(); write_page(source)
    report = {'artifactDirectory': str(OUT), 'componentSha256': sha(source), 'componentBytes': len(source.encode()),
              'acceptance': 'Observed/completed/planned intervals stay in the diagram; past unfinished and unscheduled TODOs remain in a truthful collapsible queue. No task loss or nested scroll reading.'}
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
            report['pastPattern'] = pattern_contract(page)
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
                        assert date_rows == ['Oct 29'], date_rows  # Compact B keeps one date row above the stronger time value.
                        assert 'October 29th' in page.locator('.nautilus-log-center-date').get_attribute('aria-label')
                    for label in page.locator('[data-record-title^="Commute"] .nautilus-log-record-title').all():
                        lines = label.locator('tspan').all_text_contents()
                        assert not any(line.rstrip().endswith(('Commu', 'Commut')) for line in lines), lines
                    observations = []
                    for iso in CLOCKS:
                        current = set_clock(page, iso); coverage(page)
                        assert_clock_layout(before, current, f'{context}/{width}/{iso}')
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
                cjk = next(r for r in before['queueItems'] if r['uid'] == 'overflow-0')
                assert cjk['title'] == next(r['description'] for r in before['pendingQueue']['items'] if r['uid'] == 'overflow-0')
                assert before['queueKind'] == 'unscheduled' and not before['queueOpen']
                late = set_clock(page, '2026-10-29T21:01:00'); coverage(page)
                assert_rect_equal(before, late, 'END cannot drop overflow or resize frame')
                for uid in ['overflow-0', 'overflow-1', 'overflow-2', 'overflow-3']:
                    a = next(r for r in before['queueItems'] if r['uid'] == uid); b = next(r for r in late['queueItems'] if r['uid'] == uid)
                    assert a['title'] == b['title'] and a['duration'] == b['duration']
                page.locator('.nautilus-log-pending-queue > summary').click(); settle_renderer(page); opened = coverage(page)
                assert all(r['visible'] for r in opened['queueItems'])
                assert all(abs(opened['svg'][key] - late['svg'][key]) < .5 for key in ['width', 'height'])
                assert 'END_LONG' in page.locator('[data-queued-task-uid="overflow-3"]').inner_text()
                page.screenshot(path=str(OUT / 'screenshots' / f'stress-{context}-{width}.png'), full_page=True)
                report['stress'][f'{context}-{width}'] = {'before': compact_record(before), 'after': compact_record(late), 'geometry': geometry}
            report['scenarios'] = {}
            for scenario in ['untimed-many', 'outside', 'sparse', 'dense', 'cjk', 'empty', 'completed', 'routine']:
                load(page, scenario); s = coverage(page); geometry_audit(page)
                if scenario == 'untimed-many':
                    assert s['recordCount'] == 12 and s['sliceCount'] >= 12
                    assert all(r['kind'] == 'timed' and r['timeClaim'] == 'estimated-allocation' for r in s['records'])
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
                    current = set_clock(page, iso); coverage(page); assert_clock_layout(before, current, 'overnight queue transition')
                    observations.append(compact_record(current))
                assert observations[3]['nowLabel'] == '01:59' and observations[4]['nowLabel'] is None
                report['overnight'][f'{context}-{width}'] = observations
            report['fullText'] = {f'{c}-{w}': full_text(page, c, w) for c, w in [('main', 960), ('sidebar', 280), ('embed', 520)]}
            load(page, 'untimed', 'sidebar', 280, lang='zh'); select(page, 'untimed-reference'); coverage(page)
            assert not page.locator('.nautilus-log-index-caption').count()
            assert '不是记录的完成时刻' in page.locator('[data-task-uid="untimed-reference"]').get_attribute('aria-label')
            assert page.get_by_role('button', name='全文', exact=True).count() == 1
            report['chinese'] = compact_record(state(page))
            report['completionConnections'] = completion_connections_contract(page)
            report['densityAndControl'] = density_and_control_contract(page)
            report['fourCorrections'] = four_corrections_contract(page)
            report['fullTipPalette'] = full_tip_palette_contract(page)
            report['taggedUrgencyPalette'] = tagged_urgency_palette_contract(page)
            report['afternoonFlow'] = afternoon_flow_contract(page)
            report['materialsAndTips'] = material_and_tip_contract(page)
            report['pastGapInspection'] = past_gap_inspection_contract(page)
            report['detailNameSemantics'] = detail_name_semantics_contract(page)
            report['tipSurface'] = tip_surface_contract(page)
            report['continuousShell'] = continuous_shell_contract(page)
            report['centerClock'] = center_clock_contract(page)
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
