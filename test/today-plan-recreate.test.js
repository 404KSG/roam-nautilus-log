const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { webcrypto } = require('node:crypto');
const {
  createManagedGraph,
  exclusiveLocks,
  CORE,
  ROOT,
  COMPONENT,
} = require('./managed-template-graph.cjs');

function attachPullWatches(graph) {
  const watches = [];
  graph.roam.data.addPullWatch = (pattern, lookup, callback) => {
    watches.push({ pattern, lookup, callback });
  };
  graph.roam.data.removePullWatch = (pattern, lookup, callback) => {
    const index = watches.findIndex((watch) => (
      watch.pattern === pattern && watch.lookup === lookup && watch.callback === callback
    ));
    if (index >= 0) watches.splice(index, 1);
  };
  graph.fireUid = (uid, { suppress = false } = {}) => {
    if (suppress) return 0;
    let fired = 0;
    for (const watch of watches) {
      if (!String(watch.lookup || '').includes(uid)) continue;
      let entity = null;
      try { entity = graph.roam.data.pull(watch.pattern, [':block/uid', uid]); }
      catch (_error) { entity = null; }
      watch.callback(null, entity);
      fired += 1;
    }
    return fired;
  };
  graph.watches = watches;
  return graph;
}

function deleteSubtree(graph, uid) {
  for (const child of [...graph.children(uid)]) deleteSubtree(graph, child.uid);
  graph.blocks.delete(uid);
}

function writeCount(graph) {
  return graph.trace.filter((entry) => entry[0] === 'request').length;
}

const flush = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(getValue, predicate, ms = 800) {
  const started = Date.now();
  let value = getValue();
  while (Date.now() - started < ms) {
    if (predicate(value)) return value;
    await flush(10);
    value = getValue();
  }
  return value;
}

async function loadApi() {
  const bundle = fs.readFileSync('extension.js', 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}#recreate-${Date.now()}`);
}

async function mount(t, { tracking = true } = {}) {
  const api = await loadApi();
  const graph = attachPullWatches(createManagedGraph());
  graph.values.set('actual-time-tracking', tracking);
  let date = new Date(2026, 8, 9, 14, 0);
  const host = {
    roamAlphaAPI: graph.roam,
    crypto: webcrypto,
    navigator: { locks: exclusiveLocks() },
    setTimeout,
    clearTimeout,
    setInterval: () => 1,
    clearInterval() {},
    addEventListener() {},
    removeEventListener() {},
    document: { addEventListener() {}, removeEventListener() {}, visibilityState: 'visible' },
  };
  global.window = host;
  global.document = host.document;
  const bridge = api.createPlanWatchBridge({ roam: graph.roam });
  let runtime = null;
  const session = api.createTodayPlanSession({
    extensionAPI: { settings: graph.settings },
    now: () => date,
    freezeTemplate: () => api.freezeCanonicalTemplate(CORE),
    inspectTemplate: () => api.inspectCanonicalTemplate(CORE),
    readTemplateTree: api.readBlockTree,
    buildComponentString: () => COMPONENT,
    trackingEnabled: () => tracking,
    readTrackingSnapshot: () => runtime?.getSnapshot?.() || null,
    requestTrackingRefresh: (options) => runtime?.requestRefresh?.(options),
    subscribeTracking: (listener) => (
      typeof runtime?.subscribe === 'function' ? runtime.subscribe(listener) : () => {}
    ),
  });
  if (tracking) {
    runtime = api.createTimingRuntime({
      extensionAPI: { settings: graph.settings },
      now: () => date,
      readPlan: bridge.read,
      watchPlan: bridge.subscribe,
    });
    await runtime.initialize();
  }
  session.initialize();
  await waitFor(() => session.getState(), (state) => state.status !== 'checking');
  t.after(() => {
    session.destroy();
    runtime?.destroy();
    bridge.destroy();
    delete global.window;
    delete global.document;
  });
  return { api, graph, session, runtime, bridge, setNow: (next) => { date = next; } };
}

function assertFullTree(api, graph) {
  const tree = api.readBlockTree(ROOT);
  assert.equal(tree.string, COMPONENT);
  assert.equal(graph.blocks.get(ROOT).parentUid, 'day');
  assert.equal(tree.children.length, 5);
  assert.deepEqual(tree.children.map((child) => child.string).slice(0, 4), [
    '09:00-09:30 Stand-up',
    '{{[[TODO]]}} Write 30m ((external-note))',
    '{{[[DONE]]}} Prepared 15m',
    '---',
  ]);
  assert.match(tree.children[4].string, /^\(\(([^()\s]+)\)\) and \(\(external-note\)\)$/);
  const event = tree.children[0];
  const task = tree.children[1];
  const step = task.children[0];
  assert.equal(step.string, `**First step** ((${event.uid}))`);
  assert.equal(tree.children[4].string, `((${step.uid})) and ((external-note))`);
  assert.deepEqual(step.properties, {
    open: false,
    heading: 0,
    'text-align': 'right',
    'children-view-type': 'document',
  });
  assert.equal(graph.blocks.get('source-step').string, '**First step** ((source-event))');
  assert.equal(graph.blocks.get('external-note').string, '{{[[TODO]]}} External owner 20m');
  assert.equal(graph.blocks.get('weekly-tag').string, '#[[2026-W37]]');
}

test('whole-root deletion with a watch notification becomes confirmed absence without writing', async (t) => {
  const { graph, session, runtime } = await mount(t);
  const created = await session.ensureToday({ locateMode: 'none' });
  assert.equal(created.status, 'ready-present');
  assert.equal(graph.blocks.has(ROOT), true);
  const writesBefore = writeCount(graph);

  deleteSubtree(graph, ROOT);
  const fired = graph.fireUid(ROOT);
  assert.ok(fired >= 1, 'the shared root watch must observe the deletion');
  await flush(40);
  const state = await waitFor(() => session.getState(), (next) => next.status === 'ready-absent');

  assert.equal(state.status, 'ready-absent');
  assert.equal(state.planUid, null);
  assert.equal(runtime.getSnapshot().planSnapshot?.plan || null, null);
  assert.equal(graph.blocks.has(ROOT), false);
  assert.equal(writeCount(graph), writesBefore);
});

test('one click after a watched whole-root deletion writes exactly one replacement tree', async (t) => {
  const { api, graph, session } = await mount(t);
  assert.equal((await session.ensureToday({ locateMode: 'none' })).status, 'ready-present');
  deleteSubtree(graph, ROOT);
  assert.ok(graph.fireUid(ROOT) >= 1);
  await waitFor(() => session.getState(), (state) => state.status === 'ready-absent');
  const writesBefore = writeCount(graph);

  const created = await session.ensureToday({ locateMode: 'none' });
  assert.equal(created.status, 'ready-present');
  assert.equal(created.outcome, 'created');
  assertFullTree(api, graph);
  const writesAfterCreate = writeCount(graph);
  assert.equal(writesAfterCreate - writesBefore, 7);

  const again = await session.ensureToday({ locateMode: 'none' });
  assert.equal(again.status, 'ready-present');
  assert.equal(again.outcome, 'located');
  assert.equal(writeCount(graph), writesAfterCreate);
});

test('explicit activation after a silent whole-root deletion recreates on the same click', async (t) => {
  const { api, graph, session } = await mount(t);
  assert.equal((await session.ensureToday({ locateMode: 'none' })).status, 'ready-present');
  deleteSubtree(graph, ROOT);
  assert.equal(graph.fireUid(ROOT, { suppress: true }), 0);
  await flush(40);
  assert.equal(session.getState().status, 'ready-present');
  const writesBefore = writeCount(graph);

  const result = await session.activateToday({ locateMode: 'none' });
  assert.equal(result.status, 'ready-present');
  assert.equal(result.outcome, 'created');
  assertFullTree(api, graph);
  assert.equal(writeCount(graph) - writesBefore, 7);
});

function dailyQueryCount(graph) {
  return graph.trace.filter((entry) => (
    entry[0] === 'query' && String(entry[1]).includes('?page-uid ?uid ?string ?order ?parent-uid')
  )).length;
}

test('children-only deletion and all-DONE remain an existing plan and do not refill', async (t) => {
  const { graph, session } = await mount(t);
  assert.equal((await session.ensureToday({ locateMode: 'none' })).status, 'ready-present');
  const writesBefore = writeCount(graph);
  for (const child of [...graph.children(ROOT)]) deleteSubtree(graph, child.uid);
  assert.ok(graph.fireUid(ROOT) >= 1);
  await flush(40);
  assert.equal(session.getState().status, 'ready-present');
  assert.equal(graph.blocks.has(ROOT), true);
  assert.equal(graph.children(ROOT).length, 0);
  const located = await session.activateToday({ locateMode: 'none' });
  assert.equal(located.status, 'ready-present');
  assert.notEqual(located.outcome, 'created');
  assert.equal(writeCount(graph), writesBefore);

  graph.blocks.get(ROOT).string = COMPONENT;
  graph.add({
    uid: 'done-only',
    string: '{{[[DONE]]}} Finished 10m',
    parentUid: ROOT,
    order: 0,
  });
  assert.ok(graph.fireUid(ROOT) >= 1);
  await flush(40);
  assert.equal(session.getState().status, 'ready-present');
  const again = await session.activateToday({ locateMode: 'none' });
  assert.equal(again.status, 'ready-present');
  assert.equal(writeCount(graph), writesBefore);
});

test('a missing pull is absence, but a throwing pull does not authorize creation', async (t) => {
  const { graph, session, bridge } = await mount(t);
  assert.equal((await session.ensureToday({ locateMode: 'none' })).status, 'ready-present');
  const writesBefore = writeCount(graph);
  const originalPull = graph.roam.data.pull.bind(graph.roam.data);
  graph.roam.data.pull = (pattern, lookup) => {
    if (lookup?.[1] === ROOT) throw new Error('Plan snapshot pull unavailable');
    return originalPull(pattern, lookup);
  };
  const pulled = bridge.read(ROOT);
  assert.equal(pulled.unavailable, true);
  assert.equal(pulled['block/uid'], '');
  assert.ok(graph.fireUid(ROOT) >= 1);
  await flush(40);
  assert.notEqual(session.getState().status, 'ready-absent');
  const blocked = await session.activateToday({ locateMode: 'none' });
  assert.notEqual(blocked.outcome, 'created');
  assert.equal(writeCount(graph), writesBefore);
  assert.equal(graph.blocks.has(ROOT), true);
});

test('removed renderer signature refuses to create another daily tree', async (t) => {
  const { graph, session } = await mount(t);
  assert.equal((await session.ensureToday({ locateMode: 'none' })).status, 'ready-present');
  graph.blocks.get(ROOT).string = 'ordinary block';
  assert.ok(graph.fireUid(ROOT) >= 1);
  await flush(40);
  const writesBefore = writeCount(graph);
  const result = await session.activateToday({ locateMode: 'none' });
  assert.notEqual(result.outcome, 'created');
  assert.equal(writeCount(graph), writesBefore);
  assert.equal(graph.children('day').filter((block) => block.uid !== 'weekly-tag').length, 1);
});

test('a reserved UID occupying another page fails closed after authoritative rediscovery', async (t) => {
  const { graph, session } = await mount(t);
  assert.equal((await session.ensureToday({ locateMode: 'none' })).status, 'ready-present');
  deleteSubtree(graph, ROOT);
  graph.add({ uid: ROOT, string: 'foreign occupant', parentUid: 'notes-page', order: 1 });
  await session.discover({ authoritative: true });
  const writesBefore = writeCount(graph);
  const collision = await session.activateToday({ locateMode: 'none' });
  assert.equal(collision.error, 'uidCollision');
  assert.equal(writeCount(graph), writesBefore);
  assert.equal(graph.children('day').some((block) => block.string.includes('roam/render')), false);
});

test('an older queued valid projection cannot resurrect a deleted root', async (t) => {
  const { graph, session, runtime } = await mount(t);
  assert.equal((await session.ensureToday({ locateMode: 'none' })).status, 'ready-present');
  const queued = [];
  const nativeSetTimeout = window.setTimeout.bind(window);
  const nativeClearTimeout = window.clearTimeout.bind(window);
  window.setTimeout = (fn) => {
    queued.push(fn);
    return queued.length;
  };
  window.clearTimeout = (id) => {
    if (id > 0 && id <= queued.length) queued[id - 1] = null;
  };
  const child = graph.children(ROOT)[0];
  child.string = '09:00-09:30 Stand-up edited';
  assert.ok(graph.fireUid(child.uid) >= 1);
  assert.ok(queued.some(Boolean), 'child edit must queue a cheap projection');
  deleteSubtree(graph, ROOT);
  assert.ok(graph.fireUid(ROOT) >= 1);
  const pending = queued.filter(Boolean);
  window.setTimeout = nativeSetTimeout;
  window.clearTimeout = nativeClearTimeout;
  for (const fn of pending) fn();
  await flush(40);
  assert.equal(session.getState().status, 'ready-absent');
  assert.equal(runtime.getSnapshot().planSnapshot?.plan || null, null);
  assert.equal(graph.blocks.has(ROOT), false);
});

test('partial receipt stays blocked after the partial root is deleted', async (t) => {
  const { graph, session } = await mount(t);
  let created = 0;
  graph.hooks.beforeCreate = () => {
    if (++created === 3) throw new Error('Injected third request failure');
  };
  assert.equal((await session.ensureToday({ locateMode: 'none' })).status, 'partial');
  delete graph.hooks.beforeCreate;
  deleteSubtree(graph, ROOT);
  const writesBefore = writeCount(graph);
  const result = await session.activateToday({ locateMode: 'none' });
  assert.equal(result.status, 'partial');
  assert.equal(writeCount(graph), writesBefore);
  const retried = await session.ensureToday({ locateMode: 'none' });
  assert.equal(retried.status, 'partial');
  assert.equal(writeCount(graph), writesBefore);
});

test('valid child edits do not scan the Daily Note again', async (t) => {
  const { graph, session, runtime } = await mount(t);
  assert.equal((await session.ensureToday({ locateMode: 'none' })).status, 'ready-present');
  await flush(40);
  const queriesBefore = dailyQueryCount(graph);
  const child = graph.children(ROOT)[0];
  child.string = '09:00-09:30 Stand-up renamed';
  assert.ok(graph.fireUid(child.uid) >= 1);
  await flush(40);
  assert.equal(session.getState().status, 'ready-present');
  assert.equal(runtime.getSnapshot().planSnapshot?.plan?.uid, ROOT);
  assert.match(runtime.getSnapshot().planSnapshot.rows[0].string, /renamed/);
  assert.equal(dailyQueryCount(graph), queriesBefore);
});

test('clock advancement during activation preflight keeps the original date and writes nothing', async (t) => {
  const { graph, session, setNow } = await mount(t);
  assert.equal((await session.ensureToday({ locateMode: 'none' })).status, 'ready-present');
  deleteSubtree(graph, ROOT);
  assert.equal(graph.fireUid(ROOT, { suppress: true }), 0);
  let advanced = false;
  graph.hooks.query = (query) => {
    if (!advanced && String(query).includes('?page-uid ?uid ?string ?order ?parent-uid')) {
      advanced = true;
      setNow(new Date(2026, 8, 10, 0, 0, 1));
    }
  };
  const writesBefore = writeCount(graph);
  const result = await session.activateToday({ locateMode: 'none' });
  assert.equal(result.status, 'read-failed');
  assert.equal(result.error, 'dateChanged');
  assert.equal(writeCount(graph), writesBefore);
  assert.equal(graph.blocks.has(ROOT), false);
  assert.equal(graph.blocks.has('nautilus-log-plan-2026-09-10'), false);
});

test('graph change during activation continuation writes nothing', async (t) => {
  const { graph, session } = await mount(t);
  assert.equal((await session.ensureToday({ locateMode: 'none' })).status, 'ready-present');
  deleteSubtree(graph, ROOT);
  assert.equal(graph.fireUid(ROOT, { suppress: true }), 0);
  const writesBefore = writeCount(graph);
  const originalRoam = window.roamAlphaAPI;
  graph.hooks.query = (query) => {
    if (String(query).includes('?page-uid ?uid ?string ?order ?parent-uid')) {
      window.roamAlphaAPI = { ...originalRoam, graph: { name: 'other-graph' } };
    }
  };
  const result = await session.activateToday({ locateMode: 'none' });
  window.roamAlphaAPI = originalRoam;
  assert.equal(result.status, 'read-failed');
  assert.equal(writeCount(graph), writesBefore);
  assert.equal(graph.blocks.has(ROOT), false);
});

test('keep activation publishes a different live plan to session and runtime', async (t) => {
  const { graph, session, runtime } = await mount(t);
  assert.equal((await session.ensureToday({ locateMode: 'none' })).status, 'ready-present');
  graph.blocks.get(ROOT).parentUid = 'notes-page';
  graph.add({
    uid: 'manual-other-plan',
    string: COMPONENT,
    parentUid: 'day',
    order: 1,
  });
  const writesBefore = writeCount(graph);
  const result = await session.activateToday({ locateMode: 'none', ifPresent: 'keep' });
  assert.equal(result.status, 'ready-present');
  assert.equal(result.planUid, 'manual-other-plan');
  assert.equal(result.outcome, null);
  assert.equal(runtime.getSnapshot().planSnapshot.plan.uid, 'manual-other-plan');
  assert.equal(writeCount(graph), writesBefore);
  assert.equal(graph.blocks.has(ROOT), true);
});

test('keep activation will not certify an incomplete reserved tree from another session', async (t) => {
  const { api, graph, session } = await mount(t);
  assert.equal((await session.ensureToday({ locateMode: 'none' })).status, 'ready-present');
  deleteSubtree(graph, ROOT);
  assert.equal(graph.fireUid(ROOT, { suppress: true }), 0);
  assert.equal(session.getState().status, 'ready-present');
  let created = 0;
  graph.hooks.beforeCreate = () => {
    if (++created === 3) throw new Error('Injected third request failure');
  };
  const other = api.createTodayPlanSession({
    extensionAPI: { settings: graph.settings },
    now: () => new Date(2026, 8, 9, 14, 0),
    freezeTemplate: () => api.freezeCanonicalTemplate(CORE),
    inspectTemplate: () => api.inspectCanonicalTemplate(CORE),
    readTemplateTree: api.readBlockTree,
    buildComponentString: () => COMPONENT,
  });
  t.after(() => other.destroy());
  assert.equal((await other.ensureToday({ locateMode: 'none' })).status, 'partial');
  delete graph.hooks.beforeCreate;
  const writesBefore = writeCount(graph);
  const result = await session.activateToday({ locateMode: 'none', ifPresent: 'keep' });
  assert.equal(result.status, 'partial');
  assert.notEqual(result.status, 'ready-present');
  assert.equal(writeCount(graph), writesBefore);
});

test('plan pull distinguishes missing, unavailable, and malformed entities', async (t) => {
  const { graph, bridge } = await mount(t);
  assert.deepEqual(bridge.read('missing-uid').missing, true);
  assert.equal(bridge.read('missing-uid')['block/uid'], '');
  const original = graph.roam.data.pull.bind(graph.roam.data);
  graph.roam.data.pull = () => { throw new Error('unavailable'); };
  assert.equal(bridge.read(ROOT).unavailable, true);
  graph.roam.data.pull = () => ({});
  const malformed = bridge.read(ROOT);
  assert.equal(Boolean(malformed.missing), false);
  assert.equal(Boolean(malformed.unavailable), false);
  graph.roam.data.pull = original;
});
