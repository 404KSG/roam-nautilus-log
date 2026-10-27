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
        page.get_by_role('button', name='Hide Desk', exact=True).click()
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
    expect(wrapper.locator('.rm-desk-tile__row')).to_have_text('Source content.')  # Wait for source fallback, not the initial label.
    expected = 'Review Referenced prompt 30m Source fixture tomorrow 15m'
    expect(wrapper.locator('.rm-desk-tile__title')).to_have_text(expected)
    page.evaluate('() => deskHarness.api.setString("task-2", "{{[[TODO]]}} Unrelated update 25m")')
    settle(page)
    expect(wrapper.locator('.rm-desk-tile__title')).to_have_text(expected)
    return {'literalBeforeAndAfterLoading': literal, 'contextAfterSourceFallback': expected, 'codeRequests': 0}


def image_only_heading(page, images):
    prepare(page, count=80)
    # Keep the existing Plan rule: completely untitled blocks are not tasks.
    # An image-only task can use its Markdown alt text as its native title.
    page.evaluate('(url) => deskHarness.api.addChild("image-only", "plan-desk", "{{[[TODO]]}} ![Photo](" + url + ")")', HOST + '/image-only.png')
    open_desk(page)
    tile = card(page, 'image-only')
    assert tile.evaluate('el => el.getBoundingClientRect().top > innerHeight + 300')
    expect(tile.locator('.rm-desk-tile__title')).to_have_text('Photo')
    tile.scroll_into_view_if_needed()
    expect(tile.locator('img')).to_have_js_property('naturalWidth', 640)
    expect(tile.locator('.rm-desk-tile__title')).to_have_text('Photo')
    tile.locator('img').evaluate('el => window.unchangedImageOnly = el')
    page.evaluate('() => deskHarness.api.setString("task-2", "{{[[TODO]]}} Another title")')
    settle(page)
    expect(tile.locator('.rm-desk-tile__title')).to_have_text('Photo')
    assert tile.locator('img').evaluate('el => el === unchangedImageOnly')
    return {'label': 'Photo', 'unrelatedSnapshotKeepsImage': True}


def folded_composition(page, images):
    prepare(page)
    open_desk(page)
    page.get_by_role('button', name='New note', exact=True).click()
    draft = page.locator('.rm-desk-draft__input')
    draft.dispatch_event('compositionstart')
    draft.fill('尚未确认的中文')
    assert page.evaluate('() => deskHarness.api.stats.writes.length') == 0
    stop_view(page, 'fold')
    assert page.evaluate('() => deskHarness.api.stats.writes.length') == 0
    page.evaluate('() => deskHarness.api.setCollapsed("plan-desk", false)')
    expect(page.locator('.nautilus-desk__focus-layer')).to_have_count(0)
    page.get_by_role('button', name='New note', exact=True).click()
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
    page.get_by_role('button', name='New note', exact=True).click()
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
    page.get_by_role('button', name='New note', exact=True).click()
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
    page.get_by_role('button', name='New note', exact=True).click()
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


def run():
    fixture.bundle()
    results = []
    selected = os.environ.get('DESK_PREVIEW_CASE', '')
    cases = [(f'watch-{mode}', lambda p, i, mode=mode: watch_teardown(p, i, mode)) for mode in ['fold', 'off', 'destroy']]
    cases += [('watch-null-result', lambda p, i: watch_teardown(p, i, 'destroy', 'null')),
              ('watch-rejected-result', lambda p, i: watch_teardown(p, i, 'destroy', 'reject')),
              ('watch-reopen-before-settlement', watch_reopen)]
    cases += [(f'late-image-{mode}', lambda p, i, mode=mode: late_image(p, i, mode)) for mode in ['fold', 'off', 'destroy']]
    cases += [('replacement-removal-failure', replacement), ('descendant-fields', descendants),
              ('fallback-no-observer', lambda p, i: invalidation_fallback(p, i, 'no-observer')),
              ('fallback-search', lambda p, i: invalidation_fallback(p, i, 'search')),
              ('deferred-code-and-context', deferred_code_and_context), ('image-only-heading', image_only_heading),
              ('folded-composition', folded_composition), ('composition-close', composition_close),
              ('composition-pending-create', composition_pending_create),
              ('overflow-geometry', overflow), ('late-native-editor', late_editor)]
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
