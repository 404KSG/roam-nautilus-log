#!/usr/bin/env python3
"""Deterministic preview races against production Desk and a synthetic graph.
No live graph, real attachment, synthetic image load/error event, or timed sleep.
"""
import importlib.util
import json
import os
import traceback
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ.get('DESK_PREVIEW_TEST_OUT', '/tmp/nautilus-desk-preview-lifecycle'))
spec = importlib.util.spec_from_file_location('desk_fixture', ROOT / 'test/desk-view.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
fixture.OUT = OUT
HOST = 'https://desk-fixture.invalid'
PNG = fixture.png(640, 360)
TALL_PNG = fixture.png(320, 640)
ROOT_PATTERN = '[:block/string :block/open :block/children]'


class Images:
    def __init__(self, page):
        self.page = page
        self.held = set()
        self.failed = set()
        self.pending = {}
        self.requests = []
        page.evaluate('window.receivedImages = []')
        page.route(HOST + '/**', self.route)

    def route(self, route):
        path = urlsplit(route.request.url).path
        self.requests.append(path)
        if path in self.held:
            self.pending[path] = route
        self.page.evaluate('(path) => receivedImages.push(path)', path)
        if path in self.failed:
            route.abort('failed')
        elif path not in self.held:
            route.fulfill(status=200, content_type='image/png', body=PNG)

    def wait(self, path):
        self.page.wait_for_function('(path) => receivedImages.includes(path)', arg=path)

    def finish(self, path, body=PNG):
        self.wait(path)
        self.pending.pop(path).fulfill(status=200, content_type='image/png', body=body)


def settle(page):
    page.evaluate('() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))))')


def card(page, uid='task-3'):
    return page.locator(f'.nautilus-desk__card[data-task-uid="{uid}"]')


def prepare(page, **options):
    page.evaluate('(o) => deskHarness.mount(o)', {'count': 4, **options})


def open_desk(page):
    page.get_by_role('button', name='Open Desk', exact=True).click()
    expect(page.locator('.nautilus-desk')).to_have_attribute('data-status', 'ready')


def all_loaded(page):
    page.wait_for_function('''pattern => [...document.querySelectorAll('.nautilus-desk__card')].every(el =>
      deskHarness.api.watchSnapshot().some(w => w.uid === el.dataset.taskUid && w.pattern === pattern && w.state === 'active'))''', arg=ROOT_PATTERN)
    settle(page)


def snapshot(page):
    return page.evaluate('''() => ({html: document.querySelector('#launchers').innerHTML,
      reads: deskHarness.api.stats.reads.length, writes: deskHarness.api.stats.writes.length,
      focus: document.querySelectorAll('.nautilus-desk__focus-layer').length})''')


def stop_view(page, mode):
    if mode == 'fold':
        page.evaluate('() => deskHarness.api.setCollapsed("plan-desk", true)')
        expect(page.locator('.nautilus-desk')).to_be_hidden()
    elif mode == 'off':
        page.get_by_role('button', name='Open Desk', exact=True).click()
        expect(page.locator('.nautilus-desk')).to_have_count(0)
    else:
        page.evaluate('() => deskHarness.destroy()')
        expect(page.locator('.nautilus-desk')).to_have_count(0)
    raw = page.locator('[data-fixture-host="plan-desk"] .fixture-raw')
    if mode == 'fold':
        expect(raw).to_be_hidden()
    else:
        expect(raw).to_be_visible()
    expect(page.locator('.nautilus-desk__focus-layer')).to_have_count(0)
    settle(page)


def assert_geometry(page, uid='task-3'):
    settle(page)
    result = card(page, uid).evaluate('''tile => {
      const grid = tile.closest('.nautilus-desk__grid'), style = getComputedStyle(grid);
      const last = Math.max(...[...grid.children].map(el => el.getBoundingClientRect().bottom));
      return {height: tile.offsetHeight, span: tile.style.gridRowEnd,
        expected: `span ${Math.ceil((tile.offsetHeight + parseFloat(style.columnGap)) / 4)}`,
        rowGap: style.rowGap, reserved: grid.getBoundingClientRect().bottom - last};
    }''')
    assert result['span'] == result['expected'] and result['rowGap'] == '0px', result
    assert 0 <= result['reserved'] <= 32, result
    return result


def watch_teardown(page, images, mode, result='undefined'):
    prepare(page, watchResult=result)
    page.evaluate('() => deskHarness.api.holdNextWatchRegistration("task-3")')
    open_desk(page)
    page.wait_for_function('() => deskHarness.api.watchSnapshot().some(w => w.uid === "task-3" && w.state === "held")')
    held = page.evaluate('() => deskHarness.api.watchSnapshot().find(w => w.uid === "task-3" && w.state === "held")')
    assert held['pattern'] == ROOT_PATTERN, held  # Not a Plan registration.
    stop_view(page, mode)
    assert page.evaluate('(id) => deskHarness.api.watchSnapshot().find(w => w.id === id).state', held['id']) == 'held'
    page.evaluate('() => deskHarness.api.release()')
    page.wait_for_function('(id) => deskHarness.api.watchSnapshot().find(w => w.id === id).state === "removed"', arg=held['id'])
    events = page.evaluate('(id) => deskHarness.api.stats.watchEvents.filter(e => e.id === id)', held['id'])
    assert [e['action'] for e in events] == ['held', 'registered', 'removed'], events
    assert events[-1]['wasActive'], events
    assert page.evaluate('() => deskHarness.api.watchSnapshot().filter(w => w.state === "active" && w.pattern.includes(":block/open")).length') == 0
    if mode == 'destroy':
        assert page.evaluate('() => deskHarness.api.stats.watches') == 0
    before = snapshot(page)
    page.evaluate('(id) => deskHarness.api.fireWatch(id)', held['id'])  # A host callback queued before removal.
    settle(page)
    assert snapshot(page) == before, 'A disposed exact callback changed/read the view'
    assert before['writes'] == 0
    return {'mode': mode, 'apiResult': result, 'exactRegistration': held, 'events': events}


def watch_reopen(page, images):
    prepare(page)
    page.evaluate('() => deskHarness.api.holdNextWatchRegistration("task-3")')
    open_desk(page)
    page.wait_for_function('() => deskHarness.api.watchSnapshot().some(w => w.uid === "task-3" && w.state === "held")')
    old = page.evaluate('() => deskHarness.api.watchSnapshot().find(w => w.uid === "task-3" && w.state === "held").id')
    stop_view(page, 'fold')
    page.evaluate('() => deskHarness.api.setCollapsed("plan-desk", false)')
    all_loaded(page)
    current = page.evaluate('pattern => deskHarness.api.watchSnapshot().find(w => w.uid === "task-3" && w.pattern === pattern && w.state === "active").id', ROOT_PATTERN)
    assert current != old
    before = snapshot(page)
    page.evaluate('() => deskHarness.api.release()')
    page.wait_for_function('(id) => deskHarness.api.watchSnapshot().find(w => w.id === id).state === "removed"', arg=old)
    page.evaluate('(id) => deskHarness.api.fireWatch(id)', old)
    settle(page)
    assert snapshot(page) == before
    assert page.evaluate('(id) => deskHarness.api.watchSnapshot().find(w => w.id === id).state', current) == 'active'
    page.evaluate('(url) => deskHarness.api.addChild("after-reopen", "task-3", "New ![](" + url + ")")', HOST + '/after-reopen.png')
    expect(card(page).locator('img')).to_have_attribute('src', HOST + '/after-reopen.png')
    return {'oldRegistration': old, 'currentRegistration': current, 'newSubscriptionStillUpdates': True}


def late_image(page, images, mode):
    path = '/late-' + mode + '.png'
    images.held.add(path)
    prepare(page)
    page.evaluate('(url) => deskHarness.api.setString("task-3", "{{[[TODO]]}} Late image ![](" + url + ")")', HOST + path)
    open_desk(page)
    image = card(page).locator('img')
    images.wait(path)
    expect(image).to_have_js_property('naturalWidth', 0)
    image.evaluate('''el => { window.oldImage = el; window.oldLoaded = false;
      el.addEventListener('load', () => oldLoaded = true, {once: true}); }''')
    card(page).evaluate('el => window.oldGrid = el.closest(".nautilus-desk__grid")')
    stop_view(page, mode)
    page.evaluate('''() => { window.lateMutations = [];
      window.gridProbe = new MutationObserver(rows => lateMutations.push(...rows.map(r => r.attributeName)));
      gridProbe.observe(oldGrid, {subtree: true, attributes: true}); }''')
    before = snapshot(page)
    images.finish(path)
    page.wait_for_function('() => oldLoaded && oldImage.naturalWidth === 640')
    settle(page)
    assert page.evaluate('() => oldImage.isConnected') is False
    assert page.evaluate('() => lateMutations') == [], 'Late decode touched old masonry attributes'
    assert snapshot(page) == before, 'Late image completion resurrected/read/mutated the view'
    assert before['writes'] == 0
    return {'mode': mode, 'decoded': [640, 360], 'lateMutations': []}


def replacement(page, images):
    old, new = '/old-held.png', '/new-held.png'
    images.held.update([old, new])
    prepare(page)
    page.evaluate('(url) => deskHarness.api.setString("task-3", "{{[[TODO]]}} Replacement ![](" + url + ")")', HOST + old)
    open_desk(page)
    images.wait(old)
    card(page).locator('img').evaluate('''el => { window.oldImage = el; window.oldLoaded = false;
      el.addEventListener('load', () => oldLoaded = true, {once: true}); }''')
    page.evaluate('(url) => deskHarness.api.setString("task-3", "{{[[TODO]]}} Replacement ![](" + url + ")")', HOST + new)
    images.wait(new)
    image = card(page).locator('img')
    expect(image).to_have_attribute('src', HOST + new)
    expect(image).to_have_js_property('naturalWidth', 0)
    before_decode = assert_geometry(page)
    images.finish(new, TALL_PNG)
    expect(image).to_have_js_property('naturalWidth', 320)
    expect(image).to_have_js_property('naturalHeight', 640)
    decoded = assert_geometry(page)
    assert decoded['height'] > before_decode['height'] and decoded['span'] != before_decode['span']
    image.evaluate('el => window.newImage = el')
    images.finish(old)
    page.wait_for_function('() => oldLoaded && oldImage.naturalWidth === 640')
    assert assert_geometry(page) == decoded
    assert image.evaluate('el => el === newImage')
    expect(image).to_have_attribute('src', HOST + new)
    # Removal and actual failure are distinct from replacement.
    page.evaluate('() => deskHarness.api.setString("task-3", "{{[[TODO]]}} No image")')
    expect(card(page).locator('img')).to_have_count(0)
    removed = assert_geometry(page)
    assert removed['height'] < decoded['height']
    images.failed.add('/failure.png')
    page.evaluate('(url) => deskHarness.api.setString("task-3", "{{[[TODO]]}} No image ![](" + url + ")")', HOST + '/failure.png')
    images.wait('/failure.png')
    expect(card(page).locator('img')).to_have_count(0)
    failed = assert_geometry(page)
    assert failed['height'] == removed['height'] and failed['span'] == removed['span']
    return {'undecoded': before_decode, 'newDecoded': decoded, 'afterRemoval': removed, 'afterFailure': failed}


def typing_preview_stability(page, images, mode='focus-child'):
    prepare(page)
    page.evaluate('''host => {
      const a=deskHarness.api;
      a.setString('task-3','{{[[TODO]]}} Stable preview 30m');
      a.addChild('typing-image','task-3','![]('+host+'/typing-stable.png)');
      a.addChild('typing-text','task-3','Committed text 0');
      a.addChild('typing-sibling','task-3','Unchanged sibling');
      a.addChild('typing-other-image','task-0','![]('+host+'/typing-other.png)');
    }''', HOST)
    open_desk(page); all_loaded(page)
    tile=card(page); tile.scroll_into_view_if_needed()
    expect(tile.locator('.rm-desk-tile__text')).to_have_text(['Committed text 0','Unchanged sibling'])
    page.wait_for_function('document.querySelector("[data-task-uid=task-3] img").naturalWidth>0 && document.querySelector("[data-task-uid=task-0] img").naturalWidth>0')
    uid='task-3' if mode.endswith('root') else 'typing-text'
    if mode.startswith('sidebar'):
        page.evaluate('''async()=>{
          const sidebar=document.createElement('div');sidebar.id='typing-sidebar';sidebar.className='rm-sidebar-window';
          sidebar.style.cssText='position:fixed;right:0;top:0;width:280px;height:100vh;overflow:auto;background:white;z-index:500';
          document.body.append(sidebar);
          await roamAlphaAPI.ui.components.renderBlock({uid:'task-3',el:sidebar,'open?':true,'zoom-path?':true});
        }''')
        active=page.locator(f'#typing-sidebar textarea[data-block-uid="{uid}"]')
    else:
        tile.locator('.rm-desk-tile__preview').click()
        active=page.locator(f'.nautilus-desk__native textarea[data-block-uid="{uid}"]')
    active.focus(); active.evaluate('e=>e.setSelectionRange(2,5)')
    page.evaluate('''()=>{
      const scroll=document.querySelector('#typing-sidebar')||document.querySelector('.nautilus-desk__focus-body');
      const filler=document.createElement('div');filler.style.height='1200px';scroll.append(filler);scroll.scrollTop=40;
      const tile=document.querySelector('[data-task-uid=task-3]'),img=tile.querySelector('img');
      const sibling=[...tile.querySelectorAll('.rm-desk-tile__row')].find(e=>e.textContent==='Unchanged sibling');
      window.typingProof={tile,img,sibling,rootCheck:tile.querySelector('.rm-desk-tile__title .rm-desk-tile__check'),input:document.activeElement,layer:document.querySelector('.nautilus-desk__focus-layer'),
        renders:deskHarness.api.stats.renders.length,unmounts:deskHarness.api.stats.unmounts,
        other:document.querySelector('[data-task-uid=task-0]'),otherImage:document.querySelector('[data-task-uid=task-0] img'),
        scroll,scrollTop:scroll.scrollTop,
        removedImages:0,removedSiblings:0,emptyFrames:0,undecodedFrames:0,movedOtherCards:0,heights:[],sampling:true};
      const p=typingProof;
      p.markEditor=()=>{p.value=p.input.value;p.selectionStart=p.input.selectionStart;p.selectionEnd=p.input.selectionEnd;p.inputScroll=p.input.scrollTop;p.scrollTop=p.scroll.scrollTop;};
      p.markEditor();
      p.observer=new MutationObserver(changes=>{for(const c of changes)for(const n of c.removedNodes){
        if(n===p.img||n.contains?.(p.img))p.removedImages++;
        if(n===p.sibling||n.contains?.(p.sibling))p.removedSiblings++;
      }});p.observer.observe(tile,{subtree:true,childList:true});
      p.gridObserver=new MutationObserver(changes=>{for(const c of changes)for(const n of c.removedNodes)if(n===p.other)p.movedOtherCards++;});
      p.gridObserver.observe(tile.parentElement,{childList:true});
      const sample=()=>{if(!p.sampling)return;p.heights.push(tile.getBoundingClientRect().height);
        if(!tile.querySelector('img')||!tile.querySelector('.rm-desk-tile__row'))p.emptyFrames++;
        if(!tile.querySelector('img')?.naturalWidth)p.undecodedFrames++;
        requestAnimationFrame(sample);};requestAnimationFrame(sample);
    }''')
    def proof():
        return page.evaluate('''()=>{const p=typingProof;return {
          sameImage:p.tile.querySelector('img')===p.img&&p.img.isConnected,
          sameSibling:p.sibling.isConnected&&p.tile.contains(p.sibling),
          sameCheck:!!p.rootCheck&&p.tile.querySelector('.rm-desk-tile__title .rm-desk-tile__check')===p.rootCheck,
          sameEditor:document.activeElement===p.input&&p.input.isConnected,
          sameLayer:document.querySelector('.nautilus-desk__focus-layer')===p.layer,
          sameMounts:deskHarness.api.stats.renders.length===p.renders&&deskHarness.api.stats.unmounts===p.unmounts,
          sameScroll:p.scroll.scrollTop===p.scrollTop,
          sameBuffer:p.input.value===p.value,sameSelection:p.input.selectionStart===p.selectionStart&&p.input.selectionEnd===p.selectionEnd,
          sameInputScroll:p.input.scrollTop===p.inputScroll,
          sameOtherImage:p.other.isConnected&&p.other.querySelector('img')===p.otherImage,
          removedImages:p.removedImages,removedSiblings:p.removedSiblings,emptyFrames:p.emptyFrames,
          undecodedFrames:p.undecodedFrames,movedOtherCards:p.movedOtherCards,
          height:p.tile.getBoundingClientRect().height};}''')
    initial=proof()
    # Simulate a real host commit while its public watch registration is delayed.
    # The last admitted preview must remain visible throughout this interval.
    text='{{[[TODO]]}} Stable preview v1 30m' if uid=='task-3' else 'Committed text 1'
    active.fill(text)
    page.evaluate('()=>typingProof.markEditor()')
    page.evaluate('''({uid,text})=>{deskHarness.api.holdNextWatchRegistration('task-3');deskHarness.api.setString(uid,text);}''',{'uid':uid,'text':text})
    page.wait_for_function('deskHarness.api.watchSnapshot().some(w=>w.uid==="task-3"&&w.state==="held")')
    settle(page); held=proof()
    assert all(held[k] for k in ['sameImage','sameSibling','sameCheck','sameEditor','sameLayer','sameMounts','sameScroll','sameInputScroll','sameBuffer','sameSelection','sameOtherImage']) and held['height']==initial['height'], {'mode':mode,'initial':initial,'held':held}
    page.evaluate('()=>deskHarness.api.release()')
    expected='Stable preview v1 30m' if uid=='task-3' else text
    target=tile.locator('.rm-desk-tile__title') if uid=='task-3' else tile.locator('.rm-desk-tile__text').first
    expect(target).to_have_text(expected); settle(page)
    for n in range(2,8):
        text=f'{{{{[[TODO]]}}}} Stable preview v{n} 30m' if uid=='task-3' else f'Committed text {n}'
        active.fill(text)
        page.evaluate('()=>typingProof.markEditor()')
        page.evaluate('({uid,text})=>deskHarness.api.setString(uid,text)',{'uid':uid,'text':text})
        expect(target).to_have_text(f'Stable preview v{n} 30m' if uid=='task-3' else text)
    settle(page); final=proof()
    assert all(final[k] for k in ['sameImage','sameSibling','sameCheck','sameEditor','sameLayer','sameMounts','sameScroll','sameInputScroll','sameBuffer','sameSelection','sameOtherImage']),final
    assert final['removedImages']==final['removedSiblings']==final['emptyFrames']==final['undecodedFrames']==final['movedOtherCards']==0,final
    # A different committed descendant may refresh while native IME is uncommitted.
    buffer='未提交输入法缓冲\n'*30
    active.dispatch_event('compositionstart');active.fill(buffer)
    active.evaluate('e=>{e.setSelectionRange(2,5);e.scrollTop=70;typingProof.scroll.scrollTop=40;typingProof.markEditor()}')
    page.evaluate('()=>deskHarness.api.setString("typing-sibling","Updated sibling")')
    expect(tile.locator('.rm-desk-tile__text').last).to_have_text('Updated sibling');settle(page)
    assert active.input_value()==buffer
    assert active.evaluate('e=>e.selectionStart===2&&e.selectionEnd===5&&e.scrollTop===typingProof.inputScroll&&typingProof.inputScroll>0')
    ime=proof();assert all(ime[k] for k in ['sameImage','sameSibling','sameCheck','sameEditor','sameLayer','sameMounts','sameScroll','sameInputScroll','sameBuffer','sameSelection','sameOtherImage']),ime
    assert ime['removedImages']==ime['removedSiblings']==ime['emptyFrames']==ime['undecodedFrames']==ime['movedOtherCards']==0,ime
    assert page.evaluate('()=>deskHarness.api.stats.writes.length')==0
    page.evaluate('()=>{typingProof.sampling=false;typingProof.observer.disconnect();typingProof.gridObserver.disconnect()}')
    page.screenshot(path=str(OUT/f'typing-{mode}.png'))
    return {'held':held,'final':final,'ime':ime,'graphWrites':0}


def retained_image_settlement(page, images):
    # Without ResizeObserver, this specifically exercises the retained image's
    # callback owner while a newer text admission is still pending.
    page.evaluate('window.ResizeObserver=undefined')
    images.held.add('/typing-held.png')
    prepare(page)
    page.evaluate('''host=>{
      deskHarness.api.setString('task-3','{{[[TODO]]}} Retained image 30m');
      deskHarness.api.addChild('retained-image','task-3','![]('+host+'/typing-held.png)');
      deskHarness.api.addChild('retained-text','task-3','Initial text');
    }''', HOST)
    open_desk(page); all_loaded(page)
    tile=card(page);tile.scroll_into_view_if_needed();images.wait('/typing-held.png')
    page.evaluate('window.retainedImage=document.querySelector("[data-task-uid=task-3] img")')
    page.evaluate('''()=>{deskHarness.api.holdNextWatchRegistration('task-3');deskHarness.api.setString('retained-text','Latest text');}''')
    page.wait_for_function('deskHarness.api.watchSnapshot().some(w=>w.uid==="task-3"&&w.state==="held")')
    assert page.evaluate('document.querySelector("[data-task-uid=task-3] img")===retainedImage')
    before_decode=assert_geometry(page)
    images.finish('/typing-held.png', TALL_PNG)
    page.wait_for_function('retainedImage.naturalWidth===320')
    pending_geometry=assert_geometry(page)
    assert pending_geometry['height']>before_decode['height'] and pending_geometry['span']!=before_decode['span']
    page.evaluate('()=>deskHarness.api.release()')
    expect(tile.locator('.rm-desk-tile__text')).to_have_text(['Latest text'])
    assert page.evaluate('document.querySelector("[data-task-uid=task-3] img")===retainedImage')
    page.evaluate('url=>deskHarness.api.setString("retained-image","![Updated alt]("+url+")")',HOST+'/typing-held.png')
    expect(tile.locator('img')).to_have_attribute('alt','Updated alt')
    assert page.evaluate('document.querySelector("[data-task-uid=task-3] img")===retainedImage')
    assert images.requests.count('/typing-held.png')==1,images.requests
    assert page.evaluate('()=>deskHarness.api.stats.writes.length')==0
    return {'pendingImageLayout':pending_geometry,'sameImageAfterTextAndAltChanges':True,'imageRequests':1,'graphWrites':0}


def failed_image_text_stability(page, images):
    images.failed.add('/typing-broken.png')
    prepare(page)
    page.evaluate('''host=>{
      deskHarness.api.setString('task-3','{{[[TODO]]}} Mixed images 30m');
      deskHarness.api.addChild('mixed-good','task-3','![]('+host+'/typing-good.png)');
      deskHarness.api.addChild('mixed-broken','task-3','![]('+host+'/typing-broken.png)');
      deskHarness.api.addChild('mixed-text','task-3','Initial caption');
    }''', HOST)
    open_desk(page);all_loaded(page);tile=card(page);tile.scroll_into_view_if_needed()
    images.wait('/typing-broken.png');expect(tile.locator('img')).to_have_count(1)
    page.wait_for_function('document.querySelector("[data-task-uid=task-3] img").naturalWidth===640')
    page.evaluate('window.mixedGoodImage=document.querySelector("[data-task-uid=task-3] img")')
    for n in range(3):
        page.evaluate('n=>deskHarness.api.setString("mixed-text","Caption "+n)',n)
        expect(tile.locator('.rm-desk-tile__text')).to_have_text([f'Caption {n}']);settle(page)
        assert page.evaluate('document.querySelector("[data-task-uid=task-3] img")===mixedGoodImage')
    assert images.requests.count('/typing-good.png')==images.requests.count('/typing-broken.png')==1,images.requests
    stop_view(page,'fold');page.evaluate('()=>deskHarness.api.setCollapsed("plan-desk",false)');all_loaded(page)
    page.wait_for_function('receivedImages.filter(p=>p==="/typing-broken.png").length===2')
    expect(card(page).locator('img')).to_have_count(1)
    assert page.evaluate('()=>deskHarness.api.stats.writes.length')==0
    return {'textEditsDoNotRetryFailedImagesOrReplaceHealthyImages':True,'explicitResetRetries':True,'graphWrites':0}


def live_focus_preview(page, images, mode='task'):
    if mode == 'no-observer':
        page.evaluate('window.IntersectionObserver = undefined')
    prepare(page)
    page.evaluate('''host => {
      const a = deskHarness.api;
      a.setString('task-3', '{{[[TODO]]}} Live image card 30m');
      a.addChild('live-group', 'task-3', 'Image section');
      a.addChild('live-image', 'live-group', 'Nested image ![](' + host + '/live.png)');
      a.addChild('live-sibling', 'task-3', 'Sibling note');
    }''', HOST)
    open_desk(page)
    all_loaded(page)
    tile = card(page)
    tile.scroll_into_view_if_needed()
    expect(tile.locator('.rm-desk-tile__text')).to_have_text(['Image section', 'Nested image', 'Sibling note'])
    page.wait_for_function('document.querySelector(\'[data-task-uid="task-3"] img\').naturalWidth > 0')
    page.evaluate('''() => {
      window.liveOtherCard = document.querySelector('[data-task-uid="task-0"]');
    }''')
    if mode == 'search':
        page.get_by_role('textbox', name='Search Desk', exact=True).fill('live image')
        expect(page.locator('.nautilus-desk__card')).to_have_count(1)
        all_loaded(page)
    page.evaluate('window.liveOtherImage = liveOtherCard.querySelector("img")')
    if mode == 'draft':
        page.get_by_role('button', name='New task', exact=True).first.click()
        active = page.get_by_role('textbox', name='New task', exact=True)
    else:
        tile.locator('.rm-desk-tile__preview').click()
        expect(page.locator('.nautilus-desk__native')).to_have_attribute('data-task-uid', 'task-3')
        active = page.locator('textarea[data-block-uid="task-3"]')
    active.focus()
    active.dispatch_event('compositionstart')
    if mode != 'draft':
        active.fill('Uncommitted composition buffer')
    active.evaluate('el => el.setSelectionRange(2, 8)')
    page.evaluate('''() => {
      const input = document.activeElement, body = document.querySelector('.nautilus-desk__focus-body');
      body.scrollTop = 40;
      window.liveEditor = {input, value:input.value, start:input.selectionStart, end:input.selectionEnd,
        layer:document.querySelector('.nautilus-desk__focus-layer'), scroll:body.scrollTop,
        native:document.querySelector('.nautilus-desk__native'), renders:deskHarness.api.stats.renders.length,
        unmounts:deskHarness.api.stats.unmounts};
    }''')

    def assert_editor():
        proof = page.evaluate('''() => {
          const p = liveEditor, s = deskHarness.api.stats;
          return {sameInput:document.activeElement === p.input && p.input.isConnected,
            sameLayer:document.querySelector('.nautilus-desk__focus-layer') === p.layer,
            sameNative:document.querySelector('.nautilus-desk__native') === p.native,
            sameValue:p.input.value === p.value, sameSelection:p.input.selectionStart === p.start && p.input.selectionEnd === p.end,
            sameScroll:document.querySelector('.nautilus-desk__focus-body').scrollTop === p.scroll,
            sameMounts:s.renders.length === p.renders && s.unmounts === p.unmounts,
            unrelatedImage:liveOtherCard.querySelector('img') === liveOtherImage,
            inert:document.querySelector('.nautilus-desk').inert,
            noWrites:s.writes.length === 0 && s.nativeWrites.length === 0 && s.forbiddenWrites === 0};
        }''')
        assert all(proof.values()), proof
        expect(page.get_by_role('dialog', name='Desk', exact=True).get_by_role('button', name='Close', exact=True)).to_have_count(1)
        return proof

    def verify(opened, text='Nested image', source='/live.png'):
        # No-image alone is insufficient: invalidation used to erase every row
        # and leave the read queue paused until the editor closed.
        expect(tile.locator('.rm-desk-tile__text')).to_have_text(
            ['Image section', text, 'Sibling note'] if opened else ['Image section', 'Sibling note'])
        expect(tile.locator('img')).to_have_count(1 if opened else 0)
        if opened:
            expect(tile.locator('img')).to_have_attribute('src', HOST + source)
            page.wait_for_function('document.querySelector(\'[data-task-uid="task-3"] img\').naturalWidth > 0')
        else:
            expect(tile.locator('.rm-desk-tile__more')).to_be_visible()
        geometry = assert_geometry(page)
        assert_editor()
        return geometry

    initial = verify(True)
    cycles = []
    for _ in range(3):
        page.evaluate('() => deskHarness.api.setOpen("live-group", false)')
        folded = verify(False)
        page.evaluate('() => deskHarness.api.setOpen("live-group", true)')
        expanded = verify(True)
        assert folded['height'] < expanded['height'] and expanded['height'] == initial['height']
        cycles.append({'folded': folded, 'expanded': expanded})

    page.evaluate('(url) => deskHarness.api.setString("live-image", "Changed image ![](" + url + ")")', HOST + '/live-changed.png')
    verify(True, 'Changed image', '/live-changed.png')
    # Race a second fold with the new root watch registration. Admission must
    # reread/retry in the background without touching the active composition.
    page.evaluate('''() => {
      deskHarness.api.holdNextWatchRegistration('task-3');
      deskHarness.api.setString('task-3', '{{[[TODO]]}} Updated live image card 30m');
    }''')
    page.wait_for_function('() => deskHarness.api.watchSnapshot().some(w => w.uid === "task-3" && w.state === "held")')
    page.evaluate('() => { deskHarness.api.setOpen("live-group", false); deskHarness.api.release(); }')
    verify(False)
    expect(tile.locator('.rm-desk-tile__title')).to_have_text('Updated live image card 30m')
    page.evaluate('() => deskHarness.api.setOpen("live-group", true)')
    verify(True, 'Changed image', '/live-changed.png')

    images.held.add('/live-held.png')
    page.evaluate('(url) => deskHarness.api.setString("live-image", "Late image ![](" + url + ")")', HOST + '/live-held.png')
    images.wait('/live-held.png')
    page.evaluate('() => deskHarness.api.setOpen("live-group", false)')
    before_late = verify(False)
    images.finish('/live-held.png', TALL_PNG)
    after_late = verify(False)
    assert before_late == after_late, 'An obsolete image decode changed the folded preview'
    page.screenshot(path=str(OUT / f'live-focus-{mode}.png'))
    return {'mode': mode, 'cycles': cycles, 'editor': assert_editor(), 'registrationRace': True,
            'lateImageIgnored': True, 'graphWrites': 0}


def descendants(page, images):
    prepare(page)
    page.evaluate('''host => {
      const a = deskHarness.api;
      a.addChild('group-a', 'task-3', 'Group A');
      a.addChild('nested-image', 'group-a', 'Nested ![](' + host + '/nested.png)');
      a.addChild('leaf-b', 'task-3', 'Second ![](' + host + '/second.png)');
    }''', HOST)
    open_desk(page)
    all_loaded(page)
    expect(card(page).locator('img')).to_have_count(2)
    card(page, 'task-0').locator('img').first.evaluate('el => window.unrelatedImage = el')

    def sources():
        return card(page).locator('img').evaluate_all('(nodes) => nodes.map(el => el.getAttribute("src"))')

    def verify(expected):
        expect(card(page).locator('img')).to_have_count(len(expected))
        page.wait_for_function('''expected => JSON.stringify([...document.querySelectorAll('[data-task-uid="task-3"] img')].map(el => el.getAttribute('src'))) === JSON.stringify(expected)''', arg=[HOST + x for x in expected])
        assert card(page, 'task-0').locator('img').first.evaluate('el => el === unrelatedImage')
        assert_geometry(page)

    page.evaluate('(url) => deskHarness.api.setString("nested-image", "Changed ![](" + url + ")")', HOST + '/changed.png')
    verify(['/changed.png', '/second.png'])
    assert page.evaluate('() => deskHarness.api.stats.notifications.at(-1)') == {'uid': 'nested-image', 'fields': ['string']}
    page.evaluate('() => { deskHarness.api.stats.notifications.length = 0; deskHarness.api.setOrder("leaf-b", 0); }')
    verify(['/second.png', '/changed.png'])
    order_events = page.evaluate('() => deskHarness.api.stats.notifications')
    assert order_events and all(e['fields'] == ['order'] for e in order_events), order_events
    page.evaluate('() => deskHarness.api.setOpen("group-a", false)')
    verify(['/second.png'])
    assert page.evaluate('() => deskHarness.api.stats.notifications.at(-1)') == {'uid': 'group-a', 'fields': ['open']}
    page.wait_for_function('() => !deskHarness.api.watchSnapshot().some(w => w.uid === "nested-image" && w.state === "active")')
    page.evaluate('() => deskHarness.api.setOpen("group-a", true)')
    verify(['/second.png', '/changed.png'])
    page.evaluate('(url) => deskHarness.api.addChild("added-image", "group-a", "New ![](" + url + ")")', HOST + '/added.png')
    verify(['/second.png', '/changed.png', '/added.png'])
    assert page.evaluate('() => deskHarness.api.stats.notifications.at(-1)') == {'uid': 'group-a', 'fields': ['children']}
    page.evaluate('() => deskHarness.api.remove("added-image")')
    verify(['/second.png', '/changed.png'])
    page.wait_for_function('() => !deskHarness.api.watchSnapshot().some(w => w.uid === "added-image" && w.state === "active")')
    assert page.evaluate('() => deskHarness.api.stats.writes.length') == 0
    return {'fields': ['string', 'order', 'open', 'children'], 'orderNotifications': order_events, 'finalImages': sources(), 'unrelatedIdentity': True}


def invalidation_fallback(page, images, mode):
    if mode == 'no-observer':
        page.evaluate('window.IntersectionObserver = undefined')
    prepare(page)
    page.evaluate('''host => { deskHarness.api.setString('task-3', '{{[[TODO]]}} needle');
      deskHarness.api.addChild('watched-child', 'task-3', 'Before ![](' + host + '/before.png)'); }''', HOST)
    open_desk(page)
    all_loaded(page)
    if mode == 'search':
        page.get_by_role('textbox', name='Search Desk', exact=True).fill('needle')
        expect(page.locator('.nautilus-desk__card')).to_have_count(1)
        settle(page)
    page.evaluate('(url) => deskHarness.api.setString("watched-child", "After ![](" + url + ")")', HOST + '/after.png')
    expect(card(page).locator('img')).to_have_attribute('src', HOST + '/after.png')
    expect(card(page).locator('img')).to_have_js_property('naturalWidth', 640)
    return {'mode': mode, 'refreshedWithoutPlanNotification': True, 'geometry': assert_geometry(page)}


def deferred_code_and_context(page, images):
    prepare(page, count=80)
    open_desk(page)
    code = card(page, 'code-literal')
    assert code.evaluate('el => el.getBoundingClientRect().top > innerHeight + 300'), 'Code card must really be outside the observer margin'
    assert page.evaluate('pattern => !deskHarness.api.watchSnapshot().some(w => w.uid === "code-literal" && w.pattern === pattern)', ROOT_PATTERN)
    literal = '`![literal](https://desk-fixture.invalid/code.png) ((source-task))`'
    expect(code.locator('.rm-desk-tile__title')).to_have_text(literal)
    code.scroll_into_view_if_needed()
    page.wait_for_function('pattern => deskHarness.api.watchSnapshot().some(w => w.uid === "code-literal" && w.pattern === pattern && w.state === "active")', arg=ROOT_PATTERN)
    settle(page)
    expect(code.locator('.rm-desk-tile__title')).to_have_text(literal)
    expect(code.locator('img')).to_have_count(0)
    expect(code.locator('.rm-desk-tile__row')).to_have_count(0)
    assert '/code.png' not in images.requests
    wrapper = card(page, 'context-wrapper')
    wrapper.scroll_into_view_if_needed()
    expect(wrapper.locator('.rm-desk-tile__row')).to_have_count(0)  # Contextual references do not borrow source descendants.
    expected = 'Review Referenced prompt 30m tomorrow 15m'
    expect(wrapper.locator('.rm-desk-tile__title')).to_have_text(expected)
    page.evaluate('() => deskHarness.api.setString("task-2", "{{[[TODO]]}} Unrelated update 25m")')
    settle(page)
    expect(wrapper.locator('.rm-desk-tile__title')).to_have_text(expected)
    return {'literalBeforeAndAfterLoading': literal, 'contextDoesNotAdoptSourceChildren': expected, 'codeRequests': 0}


def image_only_heading(page, images):
    prepare(page, count=80)
    # Keep the existing Plan rule: completely untitled blocks are not tasks.
    # Image alt text remains image accessibility metadata, never a note heading.
    page.evaluate('(url) => deskHarness.api.addChild("image-only", "plan-desk", "{{[[TODO]]}} ![Photo](" + url + ")")', HOST + '/image-only.png')
    open_desk(page)
    tile = card(page, 'image-only')
    assert tile.evaluate('el => el.getBoundingClientRect().top > innerHeight + 300')
    expect(tile.locator('.rm-desk-tile__title')).to_have_text('Loading preview…')
    tile.scroll_into_view_if_needed()
    expect(tile.locator('img')).to_have_js_property('naturalWidth', 640)
    expect(tile.locator('.rm-desk-tile__title')).to_have_text('')
    expect(tile.locator('.rm-desk-tile__title .rm-desk-tile__check')).to_have_count(1)
    expect(tile.locator('.rm-desk-tile__preview')).to_have_attribute('aria-label', 'Note')
    tile.locator('img').evaluate('el => window.unchangedImageOnly = el')
    page.evaluate('() => deskHarness.api.setString("task-2", "{{[[TODO]]}} Another title")')
    settle(page)
    expect(tile.locator('.rm-desk-tile__title .rm-desk-tile__check')).to_have_count(1)
    assert tile.locator('img').evaluate('el => el === unchangedImageOnly')
    return {'heading': 'absent', 'unrelatedSnapshotKeepsImage': True}


def folded_composition(page, images):
    prepare(page)
    open_desk(page)
    page.get_by_role('button', name='New task', exact=True).click()
    draft = page.locator('.rm-desk-draft__input')
    draft.dispatch_event('compositionstart')
    draft.fill('尚未确认的中文')
    assert page.evaluate('() => deskHarness.api.stats.writes.length') == 0
    stop_view(page, 'fold')
    assert page.evaluate('() => deskHarness.api.stats.writes.length') == 0
    page.evaluate('() => deskHarness.api.setCollapsed("plan-desk", false)')
    expect(page.locator('.nautilus-desk__focus-layer')).to_have_count(0)
    page.get_by_role('button', name='New task', exact=True).click()
    expect(draft).to_have_value('尚未确认的中文')
    assert page.evaluate('() => deskHarness.api.stats.writes.length') == 0
    draft.fill('已确认完整中文')
    page.wait_for_function('() => deskHarness.api.text("new-note-1") === "已确认完整中文"')
    creates = page.evaluate('() => deskHarness.api.stats.writes.filter(w => w.type === "create")')
    assert len(creates) == 1 and creates[0]['uid'] == 'new-note-1', creates
    return {'uncommittedBufferRetained': True, 'writesBeforeResumedInput': 0, 'createdUid': 'new-note-1'}


def composition_close(page, images):
    prepare(page)
    open_desk(page)
    page.get_by_role('button', name='New task', exact=True).click()
    draft = page.locator('.rm-desk-draft__input')
    draft.dispatch_event('compositionstart')
    draft.fill('未确认，不应写入图谱')
    stop_view(page, 'fold')
    page.evaluate('() => deskHarness.api.setCollapsed("plan-desk", false)')
    stop_view(page, 'off')
    assert page.evaluate('() => deskHarness.api.stats.writes') == [], 'Closing a parked composition must not commit it'
    return {'uncommittedWritesOnOff': 0}


def composition_pending_create(page, images):
    prepare(page)
    open_desk(page)
    page.evaluate('() => deskHarness.api.holdNextCreate()')
    page.get_by_role('button', name='New task', exact=True).click()
    draft = page.locator('.rm-desk-draft__input')
    draft.fill('Committed prefix')
    page.wait_for_function('() => deskHarness.api.pending()')
    draft.dispatch_event('compositionstart')
    draft.fill('Committed prefix 未确认')
    stop_view(page, 'fold')
    page.evaluate('() => deskHarness.api.release()')
    page.wait_for_function('() => deskHarness.api.text("new-note-1") !== undefined')
    settle(page)
    assert page.evaluate('() => deskHarness.api.text("new-note-1")') == 'Committed prefix'
    assert page.evaluate('() => deskHarness.api.stats.writes.map(w => w.type)') == ['create']
    page.evaluate('() => deskHarness.api.setCollapsed("plan-desk", false)')
    page.get_by_role('button', name='New task', exact=True).click()
    expect(draft).to_have_value('Committed prefix 未确认')
    draft.fill('Committed prefix 已确认')
    page.wait_for_function('() => deskHarness.api.text("new-note-1") === "Committed prefix 已确认"')
    assert page.evaluate('() => deskHarness.api.stats.writes.filter(w => w.type === "create").length') == 1
    return {'committedBeforeResume': 'Committed prefix', 'finalUid': 'new-note-1', 'creates': 1}


def overflow(page, images):
    prepare(page)
    page.evaluate('''host => deskHarness.api.setString('task-3', '{{[[TODO]]}} Gallery ' +
      Array.from({length: 5}, (_, i) => '![](' + host + '/gallery-' + i + '.png)').join(' '))''', HOST)
    open_desk(page)
    cells = card(page).locator('.rm-desk-tile__images-cell')
    expect(cells).to_have_count(3)
    expect(card(page).locator('.rm-desk-tile__images-more')).to_have_text('+2')
    for image in card(page).locator('img').all():
        expect(image).to_have_js_property('naturalWidth', 640)
    sizes = cells.evaluate_all('(nodes) => nodes.map(el => ({width:el.getBoundingClientRect().width, height:el.getBoundingClientRect().height}))')
    assert all(s['height'] == 80 and s['width'] > 0 for s in sizes), sizes
    assert len([p for p in images.requests if p.startswith('/gallery-')]) == 3
    return {'cells': sizes, 'overflow': '+2', 'geometry': assert_geometry(page)}


def late_editor(page, images):
    prepare(page)
    open_desk(page)
    page.evaluate('() => deskHarness.api.holdNextRender()')
    card(page).locator('.rm-desk-tile__preview').click()
    page.wait_for_function('() => deskHarness.api.pending()')
    stop_view(page, 'fold')
    page.evaluate('() => deskHarness.api.release()')
    page.wait_for_function('() => deskHarness.api.stats.unmounts === 1 && deskHarness.api.activeEditors() === 0')
    expect(page.locator('.nautilus-desk__focus-layer')).to_have_count(0)
    assert page.evaluate('() => deskHarness.api.stats.writes.length') == 0
    return {'lateNativeMountCleaned': True, 'graphWrites': 0}


def admission_reread(page, images):
    prepare(page)
    page.evaluate('''() => {
      deskHarness.api.addChild('watch-child', 'task-3', 'Before registration');
      deskHarness.api.holdNextWatchRegistration('watch-child');
    }''')
    open_desk(page)
    page.wait_for_function('deskHarness.api.watchSnapshot().some(w=>w.uid==="watch-child" && w.state==="held")')
    page.evaluate('()=>deskHarness.api.setString("watch-child","Changed inside registration gap")')
    page.evaluate('()=>deskHarness.api.release()')
    expect(card(page).locator('.rm-desk-tile__row')).to_contain_text('Changed inside registration gap')
    assert page.evaluate('()=>deskHarness.api.stats.writes.length') == 0
    return {'rereadAfterRegistration': True, 'graphWrites': 0}


def page_title_watch(page, images):
    prepare(page)
    page.evaluate('''()=>{deskHarness.api.addPage('page-preview','Original page');
      deskHarness.api.setString('task-3','{{TODO}} See ((page-preview))');}''')
    open_desk(page)
    expect(card(page).locator('.rm-desk-tile__title')).to_contain_text('Original page')
    page.evaluate('()=>deskHarness.api.setTitle("page-preview","Updated page")')
    expect(card(page).locator('.rm-desk-tile__title')).to_contain_text('Updated page')
    assert page.evaluate('()=>deskHarness.api.watchSnapshot().some(w=>w.uid==="page-preview" && w.state==="active" && w.pattern.includes(":node/title"))')
    return {'qualifiedPageTitleWatch': True}


def rejected_preview_retry(page, images):
    prepare(page)
    page.evaluate('''()=>{window.savedPreviewWatch=roamAlphaAPI.data.addPullWatch;
      roamAlphaAPI.data.addPullWatch=(pattern,...args)=>pattern.includes(':block/open')
        ? Promise.reject(Error('Injected watch rejection')) : savedPreviewWatch(pattern,...args);}''')
    open_desk(page)
    expect(card(page)).to_have_attribute('data-preview-state','error')
    expect(card(page)).to_contain_text('Preview unavailable')
    page.evaluate('()=>{roamAlphaAPI.data.addPullWatch=savedPreviewWatch;}')
    page.get_by_role('button',name='Refresh',exact=True).click()
    expect(card(page)).to_have_attribute('data-preview-state','ready')
    return {'visibleFailureAndExplicitRetry': True}


def image_granularity_search_reentry(page, images):
    """A detached search result must retire its old single image before reuse."""
    prepare(page)
    page.evaluate('''host => {
      deskHarness.api.setString('task-3', '{{[[TODO]]}} Gallery search note');
      deskHarness.api.addChild('search-image', 'task-3', '![](' + host + '/search-a.png)');
    }''', HOST)
    open_desk(page)
    all_loaded(page)
    search = page.get_by_role('textbox', name='Search Desk', exact=True)
    search.fill('gallery search')
    expect(card(page)).to_be_visible()
    all_loaded(page)
    wait_decoded(page, 1)
    card(page).evaluate('tile => window.searchTile = tile')
    replacements = []
    for name in ['b', 'c']:
        page.evaluate('window.searchOldImage = searchTile.querySelector("img")')
        search.fill('gallery search absent')
        expect(card(page)).to_have_count(0)
        assert page.evaluate('!searchTile.isConnected')
        page.evaluate('''url => {
          deskHarness.api.setString('search-image', '![](' + url + ')');
        }''', HOST + '/search-' + name + '.png')
        page.wait_for_function('''suffix => searchTile.dataset.previewState === 'ready'
          && [...searchTile.querySelectorAll('img')].some(img => img.src.endsWith(suffix))''', arg='/search-' + name + '.png')
        proof = page.evaluate('''() => ({
          detached: !searchTile.isConnected,
          sources: [...searchTile.querySelectorAll('img')].map(img => new URL(img.src).pathname),
          oldRemoved: !searchTile.contains(searchOldImage),
          writes: deskHarness.api.stats.writes.length
        })''')
        expected = {'detached': True, 'sources': ['/search-' + name + '.png'], 'oldRemoved': True, 'writes': 0}
        assert proof == expected, {'expected': expected, 'actual': proof}
        search.fill('gallery search')
        expect(card(page)).to_be_visible()
        wait_decoded(page, 1)
        assert page.evaluate('document.querySelector(\'[data-task-uid="task-3"]\') === searchTile')
        replacements.append(proof)
    return {'sameSearchCard': True, 'singleImageReplacements': replacements, 'graphWrites': 0}


def image_granularity_hidden_fourth(page, images):
    """Changing only a hidden image must not recreate the three visible ones."""
    prepare(page)
    page.evaluate('''host => {
      const urls = ['a', 'b', 'c', 'd'].map(name => host + '/gallery-' + name + '.png');
      deskHarness.api.setString('task-3', '{{[[TODO]]}} Gallery ' + urls.map(url => '![](' + url + ')').join(' '));
    }''', HOST)
    open_desk(page)
    all_loaded(page)
    page.wait_for_function('''() => {
      const imgs = [...document.querySelectorAll('[data-task-uid="task-3"] img')];
      return imgs.length === 3 && imgs.every(img => img.naturalWidth === 640)
        && document.querySelector('[data-task-uid="task-3"] .rm-desk-tile__images-more')?.textContent === '+1';
    }''')
    page.evaluate('''() => {
      const imgs = [...document.querySelectorAll('[data-task-uid="task-3"] img')];
      window.galleryProof = {imgs, undecoded: 0, sampling: true};
      const sample = () => {
        if (!galleryProof.sampling) return;
        if (galleryProof.imgs.some(img => !img.isConnected || img.naturalWidth === 0)) galleryProof.undecoded++;
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    }''')
    page.evaluate('''host => {
      window.galleryReads = deskHarness.api.stats.reads.length;
      const urls = ['a', 'b', 'c', 'e'].map(name => host + '/gallery-' + name + '.png');
      deskHarness.api.setString('task-3', '{{[[TODO]]}} Gallery ' + urls.map(url => '![](' + url + ')').join(' '));
    }''', HOST)
    page.wait_for_function('''() => deskHarness.api.stats.reads.length > galleryReads
      && document.querySelector('[data-task-uid="task-3"]').dataset.previewState === "ready"''')
    settle(page)
    proof = page.evaluate('''() => {
      galleryProof.sampling = false;
      const imgs = [...document.querySelectorAll('[data-task-uid="task-3"] img')];
      const count = path => receivedImages.filter(item => item === path).length;
      return {
        sameNodes: galleryProof.imgs.length === 3 && galleryProof.imgs.every((img, index) => imgs[index] === img && img.isConnected),
        connected: galleryProof.imgs.map(img => img.isConnected),
        srcs: imgs.map(img => new URL(img.src).pathname),
        undecoded: galleryProof.undecoded,
        requests: {
          '/gallery-a.png': count('/gallery-a.png'),
          '/gallery-b.png': count('/gallery-b.png'),
          '/gallery-c.png': count('/gallery-c.png'),
          '/gallery-d.png': count('/gallery-d.png'),
          '/gallery-e.png': count('/gallery-e.png')
        },
        badge: document.querySelector('[data-task-uid="task-3"] .rm-desk-tile__images-more')?.textContent || null,
        writes: deskHarness.api.stats.writes.length
      };
    }''')
    expected = {
        'sameNodes': True,
        'connected': [True, True, True],
        'srcs': ['/gallery-a.png', '/gallery-b.png', '/gallery-c.png'],
        'undecoded': 0,
        'requests': {
            '/gallery-a.png': 1, '/gallery-b.png': 1, '/gallery-c.png': 1,
            '/gallery-d.png': 0, '/gallery-e.png': 0,
        },
        'badge': '+1',
        'writes': 0,
    }
    assert proof == expected, {'expected': expected, 'actual': proof}
    return {'sameVisibleNodes': True, 'hiddenReplacementRequests': 0, 'graphWrites': 0}


def task_markup(names, text='Gallery', alts=None):
    parts = []
    for index, name in enumerate(names):
        alt = '' if alts is None else alts[index]
        parts.append(f'![{alt}]({HOST}/gallery-{name}.png)')
    return '{{[[TODO]]}} ' + text + ' ' + ' '.join(parts)


def commit_task(page, string, uid='task-3', card='task-3'):
    page.evaluate('''({uid, string}) => {
      window.previewReads = deskHarness.api.stats.reads.length;
      deskHarness.api.setString(uid, string);
    }''', {'uid': uid, 'string': string})
    page.wait_for_function('''(card) => deskHarness.api.stats.reads.length > previewReads
      && document.querySelector(`[data-task-uid="${card}"]`).dataset.previewState === "ready"''', arg=card)
    settle(page)


def wait_decoded(page, count, uid='task-3'):
    page.wait_for_function('''({uid, count}) => {
      const imgs = [...document.querySelectorAll(`[data-task-uid="${uid}"] img`)];
      return imgs.length === count && imgs.every(img => img.naturalWidth === 640);
    }''', arg={'uid': uid, 'count': count})


def stash_images(page, uid='task-3'):
    page.evaluate('''(uid) => { window.keptImages = [...document.querySelectorAll(`[data-task-uid="${uid}"] img`)]; }''', uid)


def image_view(page, uid='task-3'):
    return page.evaluate('''(uid) => {
      const imgs = [...document.querySelectorAll(`[data-task-uid="${uid}"] img`)];
      const badge = document.querySelector(`[data-task-uid="${uid}"] .rm-desk-tile__images-more`);
      const requests = receivedImages.reduce((acc, path) => { acc[path] = (acc[path] || 0) + 1; return acc; }, {});
      return {
        connected: window.keptImages.map(img => img.isConnected),
        order: window.keptImages.map(img => imgs.indexOf(img)),
        srcs: imgs.map(img => new URL(img.src).pathname),
        alts: imgs.map(img => img.alt),
        widths: imgs.map(img => img.naturalWidth),
        heights: imgs.map(img => img.naturalHeight),
        badge: badge ? badge.textContent : null,
        badgeSrc: badge?.parentElement?.querySelector('img') ? new URL(badge.parentElement.querySelector('img').src).pathname : null,
        requests, writes: deskHarness.api.stats.writes.length
      };
    }''', uid)


def image_granularity_one_visible(page, images):
    prepare(page)
    page.evaluate('(s) => deskHarness.api.setString("task-3", s)', task_markup(['a', 'b', 'c'], alts=['A', 'B', 'C']))
    open_desk(page); all_loaded(page); wait_decoded(page, 3); stash_images(page)
    commit_task(page, task_markup(['a', 'e', 'c'], alts=['A', 'E', 'C']))
    wait_decoded(page, 3)
    proof = image_view(page)
    assert proof['connected'] == [True, False, True], proof
    assert proof['order'] == [0, -1, 2], proof
    assert proof['srcs'] == ['/gallery-a.png', '/gallery-e.png', '/gallery-c.png'], proof
    assert proof['alts'] == ['A', 'E', 'C'], proof
    assert proof['widths'] == [640, 640, 640], proof
    assert proof['requests'] == {'/gallery-a.png': 1, '/gallery-b.png': 1, '/gallery-c.png': 1, '/gallery-e.png': 1}, proof
    assert proof['writes'] == 0, proof
    return {'replacedOnlyMiddleImage': True, 'graphWrites': 0}


def image_granularity_reorder_badge(page, images):
    prepare(page)
    page.evaluate('(s) => deskHarness.api.setString("task-3", s)', task_markup(['a', 'b', 'c', 'd'], alts=['A', 'B', 'C', 'D']))
    open_desk(page); all_loaded(page); wait_decoded(page, 3); stash_images(page)
    commit_task(page, task_markup(['c', 'a', 'b', 'd'], alts=['C', 'A', 'B', 'D']))
    proof = image_view(page)
    assert proof['connected'] == [True, True, True], proof
    assert proof['order'] == [1, 2, 0], proof
    assert proof['srcs'] == ['/gallery-c.png', '/gallery-a.png', '/gallery-b.png'], proof
    assert proof['alts'] == ['C', 'A', 'B'], proof
    assert proof['widths'] == [640, 640, 640], proof
    assert proof['badge'] == '+1' and proof['badgeSrc'] == '/gallery-b.png', proof
    assert proof['requests'] == {'/gallery-a.png': 1, '/gallery-b.png': 1, '/gallery-c.png': 1}, proof
    assert proof['writes'] == 0, proof
    return {'reorderedWithoutReload': True, 'badgeOwner': '/gallery-b.png', 'graphWrites': 0}


def image_granularity_hidden_count(page, images):
    prepare(page)
    page.evaluate('(s) => deskHarness.api.setString("task-3", s)', task_markup(['a', 'b', 'c', 'd']))
    open_desk(page); all_loaded(page); wait_decoded(page, 3); stash_images(page)
    expect(card(page).locator('.rm-desk-tile__images-more')).to_have_text('+1')
    commit_task(page, task_markup(['a', 'b', 'c', 'd', 'e']))
    added = image_view(page)
    assert added['connected'] == [True, True, True] and added['order'] == [0, 1, 2], added
    assert added['widths'] == [640, 640, 640] and added['badge'] == '+2', added
    assert added['requests'] == {'/gallery-a.png': 1, '/gallery-b.png': 1, '/gallery-c.png': 1}, added
    commit_task(page, task_markup(['a', 'b', 'c']))
    removed = image_view(page)
    assert removed['connected'] == [True, True, True] and removed['order'] == [0, 1, 2], removed
    assert removed['srcs'] == ['/gallery-a.png', '/gallery-b.png', '/gallery-c.png'], removed
    assert removed['badge'] is None and removed['widths'] == [640, 640, 640], removed
    assert removed['requests'] == {'/gallery-a.png': 1, '/gallery-b.png': 1, '/gallery-c.png': 1}, removed
    assert removed['writes'] == 0, removed
    return {'badge': ['+1', '+2', None], 'graphWrites': 0}


def image_granularity_text_alt(page, images):
    prepare(page)
    page.evaluate('''(s) => {
      deskHarness.api.setString('task-3', s);
      deskHarness.api.addChild('gran-note', 'task-3', 'Initial note');
    }''', task_markup(['a', 'b', 'c'], text='Caption', alts=['A', 'B', 'C']))
    open_desk(page); all_loaded(page); wait_decoded(page, 3); stash_images(page)
    commit_task(page, task_markup(['a', 'b', 'c'], text='Caption revised', alts=['A', 'B', 'C']))
    expect(card(page).locator('.rm-desk-tile__title')).to_have_text('Caption revised')
    commit_task(page, 'Note revised', 'gran-note')
    expect(card(page).locator('.rm-desk-tile__text')).to_have_text(['Note revised'])
    commit_task(page, task_markup(['a', 'b', 'c'], text='Caption revised', alts=['A', 'Updated', 'C']))
    proof = image_view(page)
    assert proof['connected'] == [True, True, True] and proof['order'] == [0, 1, 2], proof
    assert proof['alts'] == ['A', 'Updated', 'C'], proof
    assert proof['widths'] == [640, 640, 640], proof
    assert proof['requests'] == {'/gallery-a.png': 1, '/gallery-b.png': 1, '/gallery-c.png': 1}, proof
    assert proof['writes'] == 0, proof
    return {'sameNodesAfterTextAndAlt': True, 'graphWrites': 0}


def image_granularity_duplicate_product(page, images):
    prepare(page)
    page.evaluate('(s) => deskHarness.api.setString("task-3", s)', task_markup(['a', 'b', 'c', 'a']))
    open_desk(page); all_loaded(page); wait_decoded(page, 3); stash_images(page)
    initial = image_view(page)
    assert initial['srcs'] == ['/gallery-a.png', '/gallery-b.png', '/gallery-c.png'], initial
    # The existing model deduplicates a,b,c,a before this renderer sees it.
    assert initial['badge'] is None, initial
    assert initial['requests'] == {'/gallery-a.png': 1, '/gallery-b.png': 1, '/gallery-c.png': 1}, initial
    commit_task(page, task_markup(['a', 'b', 'c', 'd']))
    proof = image_view(page)
    assert proof['connected'] == [True, True, True] and proof['order'] == [0, 1, 2], proof
    assert proof['badge'] == '+1' and proof['widths'] == [640, 640, 640], proof
    assert proof['requests'] == {'/gallery-a.png': 1, '/gallery-b.png': 1, '/gallery-c.png': 1}, proof
    assert proof['writes'] == 0, proof
    return {'duplicateCollapsedToOneRequest': True, 'hiddenUniqueDoesNotReplaceVisible': True, 'graphWrites': 0}


def image_granularity_duplicate_renderer(page, images):
    prepare(page)
    page.evaluate('''host => {
      const native = deskHarness.nativeElements(document);
      const parent = document.createElement('div'); parent.id = 'direct-preview';
      const lines = document.createElement('div'); document.body.append(parent, lines);
      const item = (name, alt) => ({src: host + '/direct-' + name + '.png', alt});
      native.preview(parent, lines, {images: [item('a', 'first'), item('a', 'second'), item('b', 'third')], rows: []}, () => {});
      window.directPreview = {native, parent, lines, item};
    }''', HOST)
    page.wait_for_function('''() => {
      const imgs = [...document.querySelectorAll('#direct-preview img')];
      return imgs.length === 3 && imgs.every(img => img.naturalWidth === 640);
    }''')
    page.evaluate('''() => {
      const imgs = [...document.querySelectorAll('#direct-preview img')];
      window.directNodes = {a1: imgs[0], a2: imgs[1], b: imgs[2]};
      window.directRequests = receivedImages.length;
      const desc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
      window.srcWrites = 0; window.srcDesc = desc;
      Object.defineProperty(HTMLImageElement.prototype, 'src', {
        configurable: true, enumerable: desc.enumerable,
        get() { return desc.get.call(this); },
        set(value) { window.srcWrites += 1; return desc.set.call(this, value); }
      });
    }''')
    page.evaluate('''() => {
      const {native, parent, lines, item} = directPreview;
      native.preview(parent, lines, {images: [item('b', 'third-new'), item('a', 'first-new'), item('a', 'second-new')], rows: []}, () => {});
    }''')
    proof = page.evaluate('''() => {
      const imgs = [...document.querySelectorAll('#direct-preview img')];
      return {
        order: [imgs[0] === directNodes.b, imgs[1] === directNodes.a1, imgs[2] === directNodes.a2],
        relative: imgs.indexOf(directNodes.a1) < imgs.indexOf(directNodes.a2),
        alts: imgs.map(img => img.alt), widths: imgs.map(img => img.naturalWidth),
        srcs: imgs.map(img => new URL(img.src).pathname), srcWrites: window.srcWrites,
        extra: receivedImages.slice(directRequests), writes: deskHarness.api.stats.writes.length
      };
    }''')
    page.evaluate('() => Object.defineProperty(HTMLImageElement.prototype, "src", srcDesc)')
    assert proof['order'] == [True, True, True], proof
    assert proof['relative'] is True and proof['alts'] == ['third-new', 'first-new', 'second-new'], proof
    assert proof['widths'] == [640, 640, 640] and proof['srcWrites'] == 0, proof
    assert proof['srcs'] == ['/direct-b.png', '/direct-a.png', '/direct-a.png'], proof
    assert proof['extra'] == [] and proof['writes'] == 0, proof
    return {'duplicateNodesReorderedWithoutSrcWrite': True, 'graphWrites': 0}


def image_granularity_failed_persists(page, images):
    images.failed.add('/gallery-b.png')
    prepare(page)
    page.evaluate('''(s) => {
      deskHarness.api.setString('task-3', s);
      deskHarness.api.addChild('gran-note', 'task-3', 'Initial note');
    }''', task_markup(['a', 'b', 'c', 'd'], alts=['A', 'B', 'C', 'D']))
    open_desk(page); all_loaded(page); images.wait('/gallery-b.png'); wait_decoded(page, 2); stash_images(page)
    commit_task(page, 'Revised note', 'gran-note')
    expect(card(page).locator('.rm-desk-tile__text')).to_have_text(['Revised note'])
    edited = image_view(page)
    assert edited['connected'] == [True, True] and edited['order'] == [0, 1], edited
    assert edited['srcs'] == ['/gallery-a.png', '/gallery-c.png'], edited
    assert images.requests.count('/gallery-b.png') == 1, images.requests
    commit_task(page, task_markup(['a', 'b', 'c', 'e'], alts=['A', 'B', 'C', 'E']))
    hidden = image_view(page)
    assert hidden['connected'] == [True, True] and hidden['order'] == [0, 1], hidden
    assert hidden['srcs'] == ['/gallery-a.png', '/gallery-c.png'], hidden
    assert images.requests.count('/gallery-b.png') == 1 and images.requests.count('/gallery-e.png') == 0, images.requests
    commit_task(page, task_markup(['a', 'f', 'c', 'e'], alts=['A', 'F', 'C', 'E']))
    images.wait('/gallery-f.png'); wait_decoded(page, 3)
    replaced = image_view(page)
    assert replaced['connected'] == [True, True] and replaced['order'] == [0, 2], replaced
    assert replaced['srcs'] == ['/gallery-a.png', '/gallery-f.png', '/gallery-c.png'], replaced
    assert images.requests.count('/gallery-b.png') == 1 and images.requests.count('/gallery-f.png') == 1, images.requests
    commit_task(page, task_markup(['a', 'c', 'e', 'b'], alts=['A', 'C', 'E', 'B']))
    images.wait('/gallery-e.png'); wait_decoded(page, 3)
    parked = image_view(page)
    assert parked['connected'] == [True, True] and parked['srcs'] == ['/gallery-a.png', '/gallery-c.png', '/gallery-e.png'], parked
    assert images.requests.count('/gallery-b.png') == 1, images.requests
    commit_task(page, task_markup(['a', 'b', 'c'], alts=['A', 'B', 'C']))
    page.wait_for_function('() => receivedImages.filter(path => path === "/gallery-b.png").length === 2')
    wait_decoded(page, 2)
    again = image_view(page)
    assert again['connected'] == [True, True] and again['order'] == [0, 1], again
    assert again['srcs'] == ['/gallery-a.png', '/gallery-c.png'], again
    assert images.requests.count('/gallery-a.png') == images.requests.count('/gallery-c.png') == 1, images.requests
    assert images.requests.count('/gallery-b.png') == 2, images.requests
    assert again['writes'] == 0, again
    return {'failedOccurrenceDoesNotRetryForTextOrHiddenChange': True, 'newLifetimeMayRequest': True, 'graphWrites': 0}


def image_granularity_slow_retain(page, images):
    images.held.add('/gallery-b.png')
    prepare(page)
    page.evaluate('''(s) => {
      deskHarness.api.setString('task-3', s);
      deskHarness.api.addChild('gran-note', 'task-3', 'Initial note');
    }''', task_markup(['a', 'b', 'c'], alts=['A', 'B', 'C']))
    open_desk(page); all_loaded(page); images.wait('/gallery-b.png')
    page.wait_for_function('''() => {
      const imgs = [...document.querySelectorAll('[data-task-uid="task-3"] img')];
      return imgs.length === 3 && [imgs[0].naturalWidth, imgs[1].naturalWidth, imgs[2].naturalWidth].join() === '640,0,640';
    }''')
    stash_images(page)
    commit_task(page, 'Revised note', 'gran-note')
    expect(card(page).locator('.rm-desk-tile__text')).to_have_text(['Revised note'])
    commit_task(page, task_markup(['c', 'a', 'b'], alts=['C', 'A', 'B']))
    moved = image_view(page)
    assert moved['connected'] == [True, True, True] and moved['order'] == [1, 2, 0], moved
    assert moved['srcs'] == ['/gallery-c.png', '/gallery-a.png', '/gallery-b.png'], moved
    assert moved['widths'] == [640, 640, 0], moved
    assert images.requests.count('/gallery-b.png') == 1, images.requests
    commit_task(page, task_markup(['c', 'e', 'b'], alts=['C', 'E', 'B']))
    page.wait_for_function('''() => {
      const imgs = [...document.querySelectorAll('[data-task-uid="task-3"] img')];
      return imgs.length === 3 && new URL(imgs[1].src).pathname === '/gallery-e.png' && imgs[1].naturalWidth === 640;
    }''')
    page.evaluate('window.replacementImage = document.querySelectorAll(\'[data-task-uid="task-3"] img\')[1]')
    images.finish('/gallery-b.png', TALL_PNG)
    page.wait_for_function('() => keptImages[1].naturalWidth === 320 && keptImages[1].naturalHeight === 640')
    proof = page.evaluate('''() => {
      const imgs = [...document.querySelectorAll('[data-task-uid="task-3"] img')];
      return {
        replacementSame: imgs[1] === replacementImage && replacementImage.isConnected,
        replacement: {src: new URL(replacementImage.src).pathname, width: replacementImage.naturalWidth, height: replacementImage.naturalHeight},
        heldDecoded: keptImages[1].isConnected && imgs[2] === keptImages[1],
        keptC: imgs[0] === keptImages[2],
        writes: deskHarness.api.stats.writes.length,
        bRequests: receivedImages.filter(path => path === '/gallery-b.png').length
      };
    }''')
    assert proof['replacementSame'] and proof['replacement'] == {'src': '/gallery-e.png', 'width': 640, 'height': 360}, proof
    assert proof['heldDecoded'] and proof['keptC'] and proof['bRequests'] == 1 and proof['writes'] == 0, proof
    return {'heldNodeDecodedAfterReorder': True, 'replacementUnchanged': True, 'graphWrites': 0}


def image_granularity_retire_callback(page, images):
    images.held.add('/gallery-c.png')
    prepare(page)
    page.evaluate('(s) => deskHarness.api.setString("task-3", s)', task_markup(['a', 'b', 'c', 'd']))
    open_desk(page); all_loaded(page); images.wait('/gallery-c.png')
    page.wait_for_function('''() => {
      const imgs = [...document.querySelectorAll('[data-task-uid="task-3"] img')];
      return imgs.length === 3 && [imgs[0].naturalWidth, imgs[1].naturalWidth, imgs[2].naturalWidth].join() === '640,640,0';
    }''')
    page.evaluate('''() => {
      const imgs = [...document.querySelectorAll('[data-task-uid="task-3"] img')];
      window.retiredImage = imgs[2]; window.keptImages = imgs.slice(0, 2);
    }''')
    commit_task(page, task_markup(['a', 'b', 'd', 'c']))
    images.wait('/gallery-d.png'); wait_decoded(page, 3)
    page.evaluate('''() => {
      window.liveAfterRetire = [...document.querySelectorAll('[data-task-uid="task-3"] img')];
      window.retireMutations = [];
      window.retireObserver = new MutationObserver(records => {
        for (const record of records) if (record.type === 'attributes') retireMutations.push(record.attributeName);
      });
      retireObserver.observe(document.querySelector('.nautilus-desk__grid'), {subtree: true, attributes: true});
    }''')
    images.finish('/gallery-c.png', TALL_PNG)
    page.wait_for_function('() => retiredImage.naturalWidth === 320')
    page.evaluate('() => retiredImage.dispatchEvent(new Event("error"))')
    settle(page)
    desk_proof = page.evaluate('''() => ({
      mutations: retireMutations.slice(),
      same: liveAfterRetire.every((img, index) => document.querySelectorAll('[data-task-uid="task-3"] img')[index] === img && img.isConnected),
      srcs: [...document.querySelectorAll('[data-task-uid="task-3"] img')].map(img => new URL(img.src).pathname),
      retiredConnected: retiredImage.isConnected,
      writes: deskHarness.api.stats.writes.length,
      cRequests: receivedImages.filter(path => path === '/gallery-c.png').length
    })''')
    page.evaluate('() => retireObserver.disconnect()')
    assert desk_proof['same'] and desk_proof['mutations'] == [] and desk_proof['retiredConnected'] is False, desk_proof
    assert desk_proof['srcs'] == ['/gallery-a.png', '/gallery-b.png', '/gallery-d.png'], desk_proof
    assert desk_proof['cRequests'] == 1 and desk_proof['writes'] == 0, desk_proof
    page.evaluate('''host => {
      const native = deskHarness.nativeElements(document);
      const oldParent = document.createElement('div'); oldParent.id = 'old-card';
      const newParent = document.createElement('div'); newParent.id = 'new-card';
      const oldLines = document.createElement('div'), newLines = document.createElement('div');
      document.body.append(oldParent, newParent, oldLines, newLines);
      const counts = {oldNotifies: 0, newNotifies: 0};
      const model = name => ({images: [{src: host + '/retire-' + name + '.png', alt: name}], rows: []});
      native.preview(oldParent, oldLines, model('old'), () => { counts.oldNotifies += 1; });
      const oldImage = oldParent.querySelector('img');
      native.clearPreview(oldParent, oldLines);
      native.preview(newParent, newLines, model('new'), () => { counts.newNotifies += 1; });
      window.retireDirect = {counts, oldImage, newImage: newParent.querySelector('img')};
    }''', HOST)
    page.wait_for_function('''() => {
      const img = document.querySelector('#new-card img');
      return img && img.naturalWidth === 640 && retireDirect.counts.oldNotifies === 0;
    }''')
    page.evaluate('''() => {
      retireDirect.oldImage.dispatchEvent(new Event('error'));
      retireDirect.oldImage.dispatchEvent(new Event('load'));
    }''')
    settle(page)
    direct = page.evaluate('''() => ({
      oldNotifies: retireDirect.counts.oldNotifies, newNotifies: retireDirect.counts.newNotifies,
      oldConnected: retireDirect.oldImage.isConnected,
      newSame: document.querySelector('#new-card img') === retireDirect.newImage && retireDirect.newImage.isConnected,
      newSrc: new URL(retireDirect.newImage.src).pathname, newAlt: retireDirect.newImage.alt,
      oldEmpty: document.querySelector('#old-card').childElementCount,
      writes: deskHarness.api.stats.writes.length
    })''')
    assert direct['oldNotifies'] == 0 and direct['oldConnected'] is False and direct['oldEmpty'] == 0, direct
    assert direct['newSame'] and direct['newSrc'] == '/retire-new.png' and direct['newAlt'] == 'new', direct
    assert direct['newNotifies'] == 1 and direct['writes'] == 0, direct
    return {'retiredLoadDoesNotChangeVisibleCard': True, 'clearPreviewDropsCallback': True, 'graphWrites': 0}


def run():
    fixture.bundle()
    results = []
    selected = os.environ.get('DESK_PREVIEW_CASE', '')
    cases = [(f'watch-{mode}', lambda p, i, mode=mode: watch_teardown(p, i, mode)) for mode in ['fold', 'off', 'destroy']]
    cases += [('watch-null-result', lambda p, i: watch_teardown(p, i, 'destroy', 'null')),
              ('watch-rejected-result', lambda p, i: watch_teardown(p, i, 'destroy', 'reject')),
              ('watch-reopen-before-settlement', watch_reopen),
              ('watch-admission-reread', admission_reread), ('watch-page-title', page_title_watch),
              ('watch-rejection-retry', rejected_preview_retry)]
    cases += [(f'late-image-{mode}', lambda p, i, mode=mode: late_image(p, i, mode)) for mode in ['fold', 'off', 'destroy']]
    cases += [(f'live-focus-{mode}', lambda p, i, mode=mode: live_focus_preview(p, i, mode))
              for mode in ['task', 'draft', 'no-observer', 'search']]
    cases += [(f'typing-{mode}', lambda p, i, mode=mode: typing_preview_stability(p, i, mode))
              for mode in ['focus-child', 'focus-root', 'sidebar-child', 'sidebar-root']]
    cases += [('retained-image-settlement', retained_image_settlement),
              ('failed-image-text-stability', failed_image_text_stability)]
    cases += [('replacement-removal-failure', replacement), ('descendant-fields', descendants),
              ('fallback-no-observer', lambda p, i: invalidation_fallback(p, i, 'no-observer')),
              ('fallback-search', lambda p, i: invalidation_fallback(p, i, 'search')),
              ('deferred-code-and-context', deferred_code_and_context), ('image-only-heading', image_only_heading),
              ('folded-composition', folded_composition), ('composition-close', composition_close),
              ('composition-pending-create', composition_pending_create),
              ('overflow-geometry', overflow), ('late-native-editor', late_editor),
              ('image-granularity-search-reentry', image_granularity_search_reentry),
              ('image-granularity-hidden-fourth', image_granularity_hidden_fourth),
              ('image-granularity-one-visible', image_granularity_one_visible),
              ('image-granularity-reorder-badge', image_granularity_reorder_badge),
              ('image-granularity-hidden-count', image_granularity_hidden_count),
              ('image-granularity-text-alt', image_granularity_text_alt),
              ('image-granularity-duplicate-product', image_granularity_duplicate_product),
              ('image-granularity-duplicate-renderer', image_granularity_duplicate_renderer),
              ('image-granularity-failed-persists', image_granularity_failed_persists),
              ('image-granularity-slow-retain', image_granularity_slow_retain),
              ('image-granularity-retire-callback', image_granularity_retire_callback)]
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            for name, test in cases:
                if selected and selected not in name:
                    continue
                context = browser.new_context(viewport={'width': 1280, 'height': 1000})
                page = context.new_page()
                page.set_default_timeout(4000)
                errors = []
                page.on('pageerror', lambda error: errors.append(str(error)))
                try:
                    page.goto((OUT / 'index.html').as_uri())
                    page.wait_for_function('() => window.deskHarness?.mount')
                    page.evaluate('() => document.fonts.ready.then(() => true)')
                    images = Images(page)
                    evidence = test(page, images)
                    assert not errors, errors
                    results.append({'case': name, 'status': 'passed', 'evidence': evidence})
                    print('PASS:', name, json.dumps(evidence, ensure_ascii=False))
                except Exception as error:
                    results.append({'case': name, 'status': 'failed', 'error': str(error), 'traceback': traceback.format_exc(), 'pageerrors': errors})
                    print('FAIL:', name, str(error))
                    page.screenshot(path=str(OUT / (name + '-failed.png')), full_page=True)
                finally:
                    context.close()
        finally:
            browser.close()
    assert results, 'No test cases selected'
    failed = [r for r in results if r['status'] != 'passed']
    (OUT / 'results.json').write_text(json.dumps({'status': 'failed' if failed else 'passed', 'profile': 'cached-native' if os.environ.get('ROAM_NATIVE_CSS') else 'offline', 'cases': results}, indent=2, ensure_ascii=False))
    print(f'{len(results) - len(failed)}/{len(results)} preview lifecycle cases passed; artifacts: {OUT}')
    if failed:
        raise SystemExit(1)


if __name__ == '__main__':
    run()
