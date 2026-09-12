const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { exclusiveLocks, installTestHostLocks } = require('./test-host-locks.cjs');

function graphMock({
  trace = [],
  taskAString = '{{[[TODO]]}} Alpha 30m',
  taskBString = '{{[[TODO]]}} Beta 45m',
} = {}) {
  let generated = 0;
  const blocks = new Map([
    ['plan', { uid: 'plan', string: '[[Nautilus Log]] {{[[roam/render]]:((roam-render-Nautilus-Log-cljs))}}', parentUid: 'page', order: 0 }],
    ['task-a', { uid: 'task-a', string: taskAString, parentUid: 'plan', order: 0 }],
    ['task-b', { uid: 'task-b', string: taskBString, parentUid: 'plan', order: 1 }],
    ['event', { uid: 'event', string: '11:00-12:00 Fixed event', parentUid: 'plan', order: 2 }],
  ]);

  const children = (uid) => [...blocks.values()]
    .filter((block) => block.parentUid === uid)
    .sort((left, right) => Number(left.order) - Number(right.order));

  function q(query, ...args) {
    if (query.includes('?page-uid ?uid ?string ?order ?parent-uid')) {
      trace.push('query:plan');
      return [...blocks.values()]
        .filter((block) => ['plan', 'task-a', 'task-b', 'event'].includes(block.uid))
        .map((block) => [['page', block.uid, block.string, block.order, block.parentUid]])
        .flat();
    }
    if (query.includes('?clock-uid ?clock-string') && query.includes('[?task-uid ...]')) {
      trace.push('query:scoped-entries');
      const requested = new Set(args[0] || []);
      const rows = [];
      for (const clock of blocks.values()) {
        if (!/^CLOCK:/.test(clock.string)) continue;
        const drawer = blocks.get(clock.parentUid);
        const task = blocks.get(drawer.parentUid);
        if (!requested.has(task.uid)) continue;
        rows.push([clock.uid, clock.string, drawer.string, task.uid, task.string, 'August 22nd, 2026']);
      }
      return rows;
    }
    if (query.includes('?clock-uid ?clock-string')) {
      const runningOnly = query.includes('?running-pattern');
      trace.push(runningOnly ? 'query:running-entries' : 'query:entries');
      const rows = [];
      for (const clock of blocks.values()) {
        if (!/^CLOCK:/.test(clock.string)) continue;
        const drawer = blocks.get(clock.parentUid);
        const task = blocks.get(drawer.parentUid);
        if (runningOnly && !args[1].test(clock.string)) continue;
        rows.push([clock.uid, clock.string, drawer.string, task.uid, task.string, 'August 22nd, 2026']);
      }
      return rows;
    }
    if (query.includes(':find ?uid ?string ?order')) {
      trace.push(`query:children:${args[0] || ''}`);
      const parent = args[0];
      return children(parent).map((block) => [block.uid, block.string, block.order]);
    }
    if (query.includes(':find ?s')) {
      const uid = args[0];
      return blocks.has(uid) ? [[blocks.get(uid).string]] : [];
    }
    return [];
  }

  const roam = {
    graph: { name: 'timing-test-graph' },
    util: {
      generateUID: () => `clock-${++generated}`,
      dateToPageTitle: () => 'August 22nd, 2026',
    },
    q,
    data: {
      pull: (pattern, lookup) => {
        trace.push(`pull:${lookup?.[1] || ''}`);
        const block = blocks.get(lookup?.[1]);
        if (!block) return null;
        const entity = { ':block/string': block.string };
        if (pattern.includes(':block/page')) {
          entity[':block/page'] = { ':node/title': 'August 22nd, 2026' };
        }
        if (pattern.includes(':block/children')) {
          entity[':block/children'] = children(block.uid).map((child) => ({
            ':block/uid': child.uid,
            ':block/string': child.string,
            ':block/order': child.order,
            ':block/children': children(child.uid).map((grandchild) => ({
              ':block/uid': grandchild.uid,
              ':block/string': grandchild.string,
              ':block/order': grandchild.order,
            })),
          }));
        }
        return entity;
      },
    },
    createBlock: async ({ location, block }) => {
      blocks.set(block.uid, {
        ...block,
        parentUid: location['parent-uid'],
        order: location.order === 'last' ? children(location['parent-uid']).length : location.order,
      });
    },
    updateBlock: async ({ block }) => {
      blocks.set(block.uid, { ...blocks.get(block.uid), ...block });
    },
    deleteBlock: async ({ block }) => {
      blocks.delete(block.uid);
    },
  };

  return { roam, blocks, trace };
}

test('Recent expires on the time lane without querying CLOCK history', async (t) => {
  const bundle = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
  const extension = await import(`data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}#recent-expiry`);
  const { roam, blocks, trace } = graphMock();
  blocks.set('drawer-a', { uid: 'drawer-a', parentUid: 'task-a', order: 0, string: 'LOGBOOK::' });
  blocks.set('old-clock', { uid: 'old-clock', parentUid: 'drawer-a', order: 0,
    string: 'CLOCK: [2026-08-22 Sat 09:00]--[2026-08-22 Sat 09:16] => 0:16' });
  let instant = new Date(2026, 7, 22, 10), wall = 1000, tick;
  global.window = { roamAlphaAPI: roam, setTimeout, clearTimeout,
    setInterval: fn => { tick = fn; return 1; }, clearInterval() {} };
  installTestHostLocks(window);
  const settings = new Map([['recent-retention-minutes', 45], ['timing-line-sidebar', false]]);
  const runtime = extension.createTimingRuntime({
    extensionAPI: { settings: { get: k => settings.get(k), set: async (k,v) => settings.set(k,v) } },
    now: () => instant, wallNow: () => wall,
  });
  t.after(() => { runtime.destroy(); delete global.window; });
  await runtime.initialize();
  assert.equal(runtime.getSnapshot().activeWork.recent.length, 1);
  const reads = trace.length;
  instant = new Date(2026, 7, 22, 10, 1); wall += 60000; tick();
  assert.equal(runtime.getSnapshot().activeWork.recent.length, 0);
  assert.equal(runtime.getSnapshot().activeWork.count, 0);
  assert.equal(trace.length, reads);
});

test('execution capacity ignores former progress tokens and keeps the full estimate', async (t) => {
  const bundle = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}#progress-${Date.now()}`;
  const extension = await import(moduleUrl);
  const { roam } = graphMock({
    taskAString: '{{[[TODO]]}} Alpha 60m d50%',
    taskBString: '{{[[DONE]]}} Beta 45m',
  });
  const settings = new Map([
    ['todo-duration', 15],
    ['workday-start', 5],
    ['workday-end', 21],
    ['timing-line-sidebar', false],
    ['recent-retention-minutes', 45],
  ]);
  global.window = {
    roamAlphaAPI: roam,
    setInterval: () => 99,
    clearInterval: () => {},
    setTimeout,
    clearTimeout,
  };
  installTestHostLocks(global.window);
  const extensionAPI = {
    settings: {
      get: (key) => settings.get(key),
      set: async (key, value) => settings.set(key, value),
    },
  };

  const runtime = extension.createTimingRuntime({
    extensionAPI,
    now: () => new Date(2026, 7, 22, 10, 0),
  });
  await runtime.initialize();
  t.after(() => {
    runtime.destroy();
    delete global.window;
  });

  assert.equal(runtime.getSnapshot().planSnapshot.execution.demandMinutes, 60);
  assert.equal(runtime.getSnapshot().planSnapshot.execution.scheduledTasks[0].duration, 60);
  assert.equal(runtime.getSnapshot().planSnapshot.tasks[0].title, 'Alpha d50%');
});

test('execution capacity resolves direct block-reference tasks exactly like the chart', async (t) => {
  const bundle = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}#references-${Date.now()}`;
  const extension = await import(moduleUrl);
  const { roam, blocks } = graphMock({
    taskAString: '((source-a))',
    taskBString: '{{[[TODO]]}} Beta 45m',
  });
  blocks.set('source-a', {
    uid: 'source-a',
    string: '{{[[TODO]]}} Referenced task 2h',
    parentUid: 'outside-plan',
    order: 0,
  });
  const settings = new Map([
    ['todo-duration', 15],
    ['workday-start', 5],
    ['workday-end', 21],
    ['timing-line-sidebar', false],
    ['recent-retention-minutes', 45],
  ]);
  global.window = {
    roamAlphaAPI: roam,
    setInterval: () => 99,
    clearInterval: () => {},
    setTimeout,
    clearTimeout,
  };
  installTestHostLocks(global.window);
  const extensionAPI = {
    settings: {
      get: (key) => settings.get(key),
      set: async (key, value) => settings.set(key, value),
    },
  };

  const runtime = extension.createTimingRuntime({
    extensionAPI,
    now: () => new Date(2026, 7, 22, 10, 0),
  });
  await runtime.initialize();
  t.after(() => {
    runtime.destroy();
    delete global.window;
  });

  assert.deepEqual(
    runtime.getSnapshot().planSnapshot.tasks.map(({ uid, title, plannedMinutes }) => ({ uid, title, plannedMinutes })),
    [
      { uid: 'task-a', title: 'Referenced task', plannedMinutes: 120 },
      { uid: 'task-b', title: 'Beta', plannedMinutes: 45 },
    ],
  );
  assert.equal(runtime.getSnapshot().planSnapshot.execution.demandMinutes, 165);
});

test('runtime capacity excludes inherited DONE and outer TODO reopens the source', async (t) => {
  const bundle = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}#status-precedence-${Date.now()}`;
  const extension = await import(moduleUrl);
  const { roam, blocks } = graphMock({
    taskAString: '((source-a))',
    taskBString: '{{[[TODO]]}} ((source-a)) 25m',
  });
  blocks.set('source-a', {
    uid: 'source-a',
    string: '{{[[DONE]]}} Reusable task 15m d09:11',
    parentUid: 'outside-plan',
    order: 0,
  });
  const settings = new Map([
    ['todo-duration', 15],
    ['workday-start', 5],
    ['workday-end', 21],
    ['timing-line-sidebar', false],
    ['recent-retention-minutes', 45],
  ]);
  global.window = {
    roamAlphaAPI: roam,
    setInterval: () => 99,
    clearInterval: () => {},
    setTimeout,
    clearTimeout,
  };
  installTestHostLocks(global.window);
  const extensionAPI = {
    settings: {
      get: (key) => settings.get(key),
      set: async (key, value) => settings.set(key, value),
    },
  };
  const runtime = extension.createTimingRuntime({
    extensionAPI,
    now: () => new Date(2026, 7, 22, 10, 0),
  });
  await runtime.initialize();
  t.after(() => {
    runtime.destroy();
    delete global.window;
  });

  const snapshot = runtime.getSnapshot();
  assert.deepEqual(
    snapshot.planSnapshot.tasks.map(({ uid, statusOrigin, plannedMinutes }) => ({ uid, statusOrigin, plannedMinutes })),
    [{ uid: 'task-b', statusOrigin: 'local', plannedMinutes: 25 }],
  );
  assert.deepEqual(snapshot.planSnapshot.reviewTasks.map(({ uid }) => uid), ['task-b']);
  assert.equal(snapshot.planSnapshot.execution.demandMinutes, 25);
});

test('Plan Pull Watch refreshes capacity immediately when a moved wrapper reopens a DONE source', async (t) => {
  const bundle = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}#watched-status-${Date.now()}`;
  const extension = await import(moduleUrl);
  const { roam, blocks, trace } = graphMock({
    taskAString: '((source-a))',
    taskBString: '{{[[DONE]]}} Beta 45m',
  });
  blocks.set('source-a', {
    uid: 'source-a',
    string: '{{[[DONE]]}} 给谭总汇报房租事情 15m d10:46',
    parentUid: 'outside-plan',
    order: 0,
  });
  const settings = new Map([
    ['todo-duration', 15],
    ['workday-start', 5],
    ['workday-end', 21],
    ['timing-line-sidebar', false],
    ['recent-retention-minutes', 45],
  ]);
  let planListener = null;
  let stopped = false;
  global.window = {
    roamAlphaAPI: roam,
    setInterval: () => 99,
    clearInterval: () => {},
    setTimeout,
    clearTimeout,
  };
  installTestHostLocks(global.window);
  const runtime = extension.createTimingRuntime({
    extensionAPI: {
      settings: {
        get: (key) => settings.get(key),
        set: async (key, value) => settings.set(key, value),
      },
    },
    now: () => new Date(2026, 7, 22, 10, 0),
    watchPlan: (uid, listener, options) => {
      assert.equal(uid, 'plan');
      assert.deepEqual(options, { emitInitial: false });
      planListener = listener;
      return () => { stopped = true; };
    },
  });
  await runtime.initialize();
  t.after(() => {
    runtime.destroy();
    delete global.window;
  });

  assert.equal(runtime.getSnapshot().planSnapshot.execution.demandMinutes, 0);
  const planQueriesBeforeWatch = trace.filter((entry) => entry === 'query:plan').length;
  const entryQueriesBeforeWatch = trace.filter((entry) => entry === 'query:scoped-entries').length;
  blocks.set('task-a', {
    ...blocks.get('task-a'),
    string: '{{[[TODO]]}} ((source-a))',
  });
  planListener({
    'block/uid': 'plan',
    'block/string': blocks.get('plan').string,
    'block/children': ['task-a', 'task-b', 'event'].map((uid) => ({
      'block/uid': uid,
      'block/string': blocks.get(uid).string,
      'block/order': blocks.get(uid).order,
      'block/refs': uid === 'task-a'
        ? [{ 'block/uid': 'source-a', 'block/string': blocks.get('source-a').string }]
        : [],
    })),
  });
  await new Promise((resolve) => setTimeout(resolve, 5));

  assert.equal(runtime.getSnapshot().planSnapshot.execution.demandMinutes, 15);
  assert.equal(runtime.getSnapshot().planSnapshot.tasks[0].statusOrigin, 'local');
  assert.equal(trace.filter((entry) => entry === 'query:plan').length, planQueriesBeforeWatch);
  assert.equal(trace.filter((entry) => entry === 'query:scoped-entries').length, entryQueriesBeforeWatch);
  runtime.destroy();
  assert.equal(stopped, true);
});

test('authoritative recovery reuses the Primary Plan Pull and reads CLOCK only from relevant tasks', async (t) => {
  const bundle = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}#scoped-recovery-${Date.now()}`;
  const extension = await import(moduleUrl);
  const { roam, blocks, trace } = graphMock();
  blocks.set('drawer-a', { uid: 'drawer-a', string: 'LOGBOOK::', parentUid: 'task-a', order: 0 });
  blocks.set('clock-a', {
    uid: 'clock-a',
    string: 'CLOCK: [2026-08-22 Sat 09:00]--[2026-08-22 Sat 09:20] => 0:20',
    parentUid: 'drawer-a',
    order: 0,
  });
  const settings = new Map([
    ['todo-duration', 15],
    ['workday-start', 5],
    ['workday-end', 21],
    ['timing-line-sidebar', false],
    ['recent-retention-minutes', 45],
  ]);
  global.window = {
    roamAlphaAPI: roam,
    setInterval: () => 99,
    clearInterval: () => {},
    setTimeout,
    clearTimeout,
  };
  installTestHostLocks(global.window);
  const runtime = extension.createTimingRuntime({
    extensionAPI: {
      settings: {
        get: (key) => settings.get(key),
        set: async (key, value) => settings.set(key, value),
      },
    },
    now: () => new Date(2026, 7, 22, 10, 0),
    readPlan: () => ({
      'block/uid': 'plan',
      'block/string': blocks.get('plan').string,
      'block/children': ['task-a', 'task-b', 'event'].map((uid) => ({
        'block/uid': uid,
        'block/string': blocks.get(uid).string,
        'block/order': blocks.get(uid).order,
        'block/refs': [],
      })),
    }),
  });
  await runtime.initialize();
  t.after(() => {
    runtime.destroy();
    delete global.window;
  });

  trace.length = 0;
  await runtime.requestRefresh({ immediate: true });

  assert.equal(runtime.getSnapshot().entries.length, 1);
  assert.equal(runtime.getSnapshot().entries[0].clockUid, 'clock-a');
  assert.equal(trace.includes('query:plan'), false);
  assert.equal(trace.includes('query:scoped-entries'), false);
  assert.equal(trace.includes('pull:task-a'), true);
  assert.equal(trace.includes('pull:task-b'), true);
});

test('only a scoped CLOCK read certifies owners; mutation projections do not', async (t) => {
  const bundle = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
  const extension = await import(`data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}#entry-task-uids-${Date.now()}`);
  const { roam, blocks } = graphMock();
  blocks.set('drawer-a', { uid: 'drawer-a', string: 'LOGBOOK::', parentUid: 'task-a', order: 0 });
  blocks.set('clock-a', {
    uid: 'clock-a',
    string: 'CLOCK: [2026-08-22 Sat 09:00]--[2026-08-22 Sat 09:20] => 0:20',
    parentUid: 'drawer-a',
    order: 0,
  });
  const settings = new Map([
    ['todo-duration', 15],
    ['workday-start', 5],
    ['workday-end', 21],
    ['timing-line-sidebar', false],
    ['recent-retention-minutes', 45],
  ]);
  global.window = {
    roamAlphaAPI: roam,
    setInterval: () => 99,
    clearInterval: () => {},
    setTimeout,
    clearTimeout,
  };
  installTestHostLocks(global.window);
  const runtime = extension.createTimingRuntime({
    extensionAPI: {
      settings: {
        get: (key) => settings.get(key),
        set: async (key, value) => settings.set(key, value),
      },
    },
    now: () => new Date(2026, 7, 22, 10, 0),
    readPlan: () => ({
      'block/uid': 'plan',
      'block/string': blocks.get('plan').string,
      'block/children': ['task-a', 'task-b', 'event'].map((uid) => ({
        'block/uid': uid,
        'block/string': blocks.get(uid).string,
        'block/order': blocks.get(uid).order,
        'block/refs': [],
      })),
    }),
  });
  await runtime.initialize();
  t.after(() => {
    runtime.destroy();
    delete global.window;
  });

  assert.deepEqual(runtime.getSnapshot().entryTaskUids, [],
    'initialize supplies a full-graph projection and must not mark owners covered');
  await runtime.requestRefresh({ immediate: true });
  const ready = runtime.getSnapshot();
  assert.ok(ready.entryTaskUids.includes('task-a'));
  assert.ok(ready.entryTaskUids.includes('task-b'));
  const certified = [...ready.entryTaskUids];

  runtime.refresh({ planSnapshot: ready.planSnapshot, entries: ready.entries });
  assert.deepEqual(runtime.getSnapshot().entryTaskUids, certified);

  runtime.refresh({ planSnapshot: ready.planSnapshot, entries: [...ready.entries] });
  assert.deepEqual(runtime.getSnapshot().entryTaskUids, [],
    'a new mutation entries array cannot certify complete owner history');
  assert.equal(runtime.getSnapshot().entries.length, ready.entries.length);
});

test('one-second Timing ticks stay graph-free and recovery waits for a real idle period', async (t) => {
  const bundle = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}#tick-lanes-${Date.now()}`;
  const extension = await import(moduleUrl);
  const { roam, blocks, trace } = graphMock();
  const settings = new Map([
    ['todo-duration', 15],
    ['workday-start', 5],
    ['workday-end', 21],
    ['timing-line-sidebar', false],
    ['recent-retention-minutes', 45],
  ]);
  let tick = null;
  let idleCallback = null;
  let idleOptions = 'not-called';
  let wallTime = 0;
  global.window = {
    roamAlphaAPI: roam,
    setInterval: (callback) => {
      tick = callback;
      return 99;
    },
    clearInterval: () => {},
    setTimeout,
    clearTimeout,
    requestIdleCallback: (callback, options) => {
      idleCallback = callback;
      idleOptions = options;
      return 101;
    },
    cancelIdleCallback: () => {},
  };
  installTestHostLocks(global.window);
  const runtime = extension.createTimingRuntime({
    extensionAPI: {
      settings: {
        get: (key) => settings.get(key),
        set: async (key, value) => settings.set(key, value),
      },
    },
    now: () => new Date(2026, 7, 22, 10, 0),
    wallNow: () => wallTime,
    readPlan: () => ({
      'block/uid': 'plan',
      'block/string': blocks.get('plan').string,
      'block/children': ['task-a', 'task-b', 'event'].map((uid) => ({
        'block/uid': uid,
        'block/string': blocks.get(uid).string,
        'block/order': blocks.get(uid).order,
        'block/refs': [],
      })),
    }),
  });
  await runtime.initialize();
  t.after(() => {
    runtime.destroy();
    delete global.window;
  });

  trace.length = 0;
  wallTime = 15_001;
  tick();
  assert.deepEqual(trace, []);
  assert.equal(idleCallback, null);

  wallTime = 300_000;
  tick();
  assert.deepEqual(trace, []);
  assert.equal(typeof idleCallback, 'function');
  assert.equal(idleOptions, undefined);

  idleCallback();
  await Promise.resolve();
  assert.equal(trace.includes('query:plan'), false);
  assert.equal(trace.includes('query:scoped-entries'), false);
  assert.equal(trace.includes('pull:task-a'), true);
});

test('referenced and plain daily instances can CLOCK and complete without mutating their source', async (t) => {
  const bundle = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}#daily-instance-${Date.now()}`;
  const extension = await import(moduleUrl);
  const { roam, blocks } = graphMock({
    taskAString: '{{[[TODO]]}} ((source-a)) 25m',
    taskBString: 'Plain task 20m',
  });
  const originalSource = '{{[[DONE]]}} Referenced task 15m d09:11';
  blocks.set('source-a', {
    uid: 'source-a',
    string: originalSource,
    parentUid: 'outside-plan',
    order: 0,
  });
  const settings = new Map([
    ['todo-duration', 15],
    ['workday-start', 5],
    ['workday-end', 21],
    ['timing-line-sidebar', false],
    ['recent-retention-minutes', 45],
  ]);
  let current = new Date(2026, 7, 22, 10, 0);
  global.window = {
    roamAlphaAPI: roam,
    setInterval: () => 99,
    clearInterval: () => {},
    setTimeout,
    clearTimeout,
  };
  installTestHostLocks(global.window);
  const extensionAPI = {
    settings: {
      get: (key) => settings.get(key),
      set: async (key, value) => settings.set(key, value),
    },
  };
  const runtime = extension.createTimingRuntime({ extensionAPI, now: () => new Date(current) });
  await runtime.initialize();
  t.after(() => {
    runtime.destroy();
    delete global.window;
  });

  assert.deepEqual(
    runtime.getSnapshot().planSnapshot.tasks.map(({ uid, title, plannedMinutes }) => ({ uid, title, plannedMinutes })),
    [
      { uid: 'task-a', title: 'Referenced task', plannedMinutes: 25 },
      { uid: 'task-b', title: 'Plain task', plannedMinutes: 20 },
    ],
  );

  await runtime.startTask('task-a');
  current = new Date(2026, 7, 22, 10, 5);
  await runtime.completeTask('task-a');
  assert.match(blocks.get('task-a').string, /^\{\{\[\[DONE\]\]\}\} \(\(source-a\)\) 25m/);
  assert.equal(blocks.get('source-a').string, originalSource);

  await runtime.startTask('task-b');
  current = new Date(2026, 7, 22, 10, 10);
  await runtime.completeTask('task-b');
  assert.match(blocks.get('task-b').string, /^\{\{\[\[DONE\]\]\}\} Plain task 20m/);
});

test('completing a bare source-owned TODO closes the wrapper CLOCK and completes the source owner', async (t) => {
  const bundle = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}#source-owned-completion-${Date.now()}`;
  const extension = await import(moduleUrl);
  const { roam, blocks } = graphMock({
    taskAString: '((source-a))',
    taskBString: '{{[[DONE]]}} Beta 45m',
  });
  blocks.set('source-a', {
    uid: 'source-a',
    string: '{{[[TODO]]}} Reusable task 25m',
    parentUid: 'outside-plan',
    order: 0,
  });
  const settings = new Map([
    ['todo-duration', 15],
    ['workday-start', 5],
    ['workday-end', 21],
    ['timing-line-sidebar', false],
    ['recent-retention-minutes', 45],
  ]);
  let current = new Date(2026, 7, 22, 10, 0);
  global.window = {
    roamAlphaAPI: roam,
    setInterval: () => 99,
    clearInterval: () => {},
    setTimeout,
    clearTimeout,
  };
  installTestHostLocks(global.window);
  const runtime = extension.createTimingRuntime({
    extensionAPI: {
      settings: {
        get: (key) => settings.get(key),
        set: async (key, value) => settings.set(key, value),
      },
    },
    now: () => new Date(current),
  });
  await runtime.initialize();
  t.after(() => {
    runtime.destroy();
    delete global.window;
  });

  assert.equal(runtime.getSnapshot().planSnapshot.tasks[0].statusOwnerUid, 'source-a');
  await runtime.startTask('task-a');
  current = new Date(2026, 7, 22, 10, 5);
  await runtime.completeTask('task-a');

  assert.equal(blocks.get('task-a').string, '((source-a))');
  assert.match(blocks.get('source-a').string, /^\{\{\[\[DONE\]\]\}\} Reusable task 25m/);
  assert.equal(
    [...blocks.values()].filter((block) => /^CLOCK:/.test(block.string) && !block.string.includes('--')).length,
    0,
  );
  assert.deepEqual(
    runtime.getSnapshot().dailyReview.rows.map(({ uid, state, actualMinutes }) => [uid, state, actualMinutes]),
    [
      ['task-a', 'compared', 5],
      ['task-b', 'not-tracked', 0],
    ],
  );
});

test('a manual source TODO to DONE transition closes the active daily wrapper CLOCK and keeps today Review', async (t) => {
  const bundle = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}#manual-source-completion-${Date.now()}`;
  const extension = await import(moduleUrl);
  const { roam, blocks } = graphMock({
    taskAString: '((source-a))',
    taskBString: '{{[[DONE]]}} Beta 45m',
  });
  blocks.set('source-a', {
    uid: 'source-a',
    string: '{{[[TODO]]}} Reusable task 25m',
    parentUid: 'outside-plan',
    order: 0,
  });
  const settings = new Map([
    ['todo-duration', 15],
    ['workday-start', 5],
    ['workday-end', 21],
    ['timing-line-sidebar', false],
    ['recent-retention-minutes', 45],
  ]);
  let planListener = null;
  let current = new Date(2026, 7, 22, 10, 0);
  global.window = {
    roamAlphaAPI: roam,
    setInterval: () => 99,
    clearInterval: () => {},
    setTimeout,
    clearTimeout,
  };
  installTestHostLocks(global.window);
  const runtime = extension.createTimingRuntime({
    extensionAPI: {
      settings: {
        get: (key) => settings.get(key),
        set: async (key, value) => settings.set(key, value),
      },
    },
    now: () => new Date(current),
    watchPlan: (_uid, listener) => {
      planListener = listener;
      return () => {};
    },
  });
  await runtime.initialize();
  t.after(() => {
    runtime.destroy();
    delete global.window;
  });

  await runtime.startTask('task-a');
  current = new Date(2026, 7, 22, 10, 7);
  blocks.set('source-a', {
    ...blocks.get('source-a'),
    string: '{{[[DONE]]}} Reusable task 25m',
  });
  planListener();
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(
    [...blocks.values()].filter((block) => /^CLOCK:/.test(block.string) && !block.string.includes('--')).length,
    0,
  );
  assert.deepEqual(runtime.getSnapshot().planSnapshot.tasks, []);
  assert.deepEqual(
    runtime.getSnapshot().dailyReview.rows.map(({ uid, state, actualMinutes }) => [uid, state, actualMinutes]),
    [
      ['task-a', 'compared', 7],
      ['task-b', 'not-tracked', 0],
    ],
  );
});

test('runtime serializes close-before-switch and close-before-complete', async (t) => {
  const bundle = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}#timing-${Date.now()}`;
  const extension = await import(moduleUrl);
  const trace = [];
  const { roam, blocks } = graphMock({ trace });
  const settings = new Map([
    ['todo-duration', 15],
    ['pomodoro-minutes', 45],
    ['timing-line-sidebar', true],
    ['recent-retention-minutes', 45],
    ['forgotten-timer-minutes', 120],
  ]);
  const sidebarWindows = [];
  let resolveSidebarOpen = null;
  let failNextSidebarAdd = false;
  let current = new Date(2026, 7, 22, 10, 0);
  global.window = {
    roamAlphaAPI: {
      ...roam,
      ui: {
        rightSidebar: {
          open: () => {
            trace.push('sidebar:open');
            return new Promise((resolve) => { resolveSidebarOpen = resolve; });
          },
          getWindows: () => {
            trace.push('sidebar:getWindows');
            return sidebarWindows.slice();
          },
          addWindow: async ({ window }) => {
            trace.push(`sidebar:addWindow:${window?.['block-uid'] || ''}`);
            if (failNextSidebarAdd) {
              failNextSidebarAdd = false;
              throw new Error('sidebar still opening');
            }
            sidebarWindows.push(window);
          },
          setWindowOrder: async () => {},
          expandWindow: async () => {},
        },
      },
    },
    setInterval: () => 99,
    clearInterval: () => {},
    setTimeout,
    clearTimeout,
  };
  installTestHostLocks(global.window);
  t.after(() => { delete global.window; });

  const extensionAPI = {
    settings: {
      get: (key) => settings.get(key),
      set: async (key, value) => settings.set(key, value),
    },
  };
  const runtime = extension.createTimingRuntime({ extensionAPI, now: () => new Date(current) });
  await runtime.initialize();
  assert.deepEqual(runtime.getSnapshot().planSnapshot.tasks.map(({ uid }) => uid), ['task-a', 'task-b']);
  assert.equal(runtime.getSnapshot().planSnapshot.execution.availableMinutes, 600);
  assert.deepEqual(
    runtime.getSnapshot().planSnapshot.execution.scheduledTasks.map(({ uid, start, end }) => ({ uid, start, end })),
    [
      { uid: 'task-a', start: 600, end: 630 },
      { uid: 'task-b', start: 720, end: 765 },
    ],
  );
  assert.deepEqual(
    runtime.getSnapshot().dailyReview.rows.map(({ uid, state }) => [uid, state]),
    [['task-a', 'not-started'], ['task-b', 'not-started']],
  );
  trace.length = 0;
  runtime.refresh();
  assert.equal(trace.filter((entry) => entry === 'query:entries').length, 0);
  assert.equal(
    trace.filter((entry) => entry === 'query:scoped-entries').length,
    0,
    'a cached render refresh must not reread CLOCK history',
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(trace.includes('sidebar:getWindows'), true, 'startup should warm the sidebar cache read-only');
  assert.equal(trace.includes('sidebar:open'), false, 'cache warmup must not open the sidebar');

  trace.length = 0;
  const firstStart = runtime.startTask('task-a');
  assert.deepEqual(trace.slice(0, 2), ['sidebar:open', 'sidebar:getWindows']);
  const addedInClockInClickStack = trace.includes('sidebar:addWindow:task-a');
  assert.equal(trace.includes('pull:task-a'), false);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const addedBeforeSidebarOpenSettled = trace.includes('sidebar:addWindow:task-a');
  resolveSidebarOpen?.();
  await firstStart;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(
    addedBeforeSidebarOpenSettled,
    true,
    'Clock In must issue native addWindow without waiting for the sidebar open animation',
  );
  assert.equal(
    addedInClockInClickStack,
    true,
    'a synchronous native window snapshot must keep addWindow in the Clock In click stack',
  );
  assert.ok(
    trace.indexOf('sidebar:addWindow:task-a') < trace.indexOf('pull:task-a'),
    'the native sidebar must become visible before synchronous graph validation starts',
  );
  assert.equal(
    trace.filter((entry) => entry === 'query:plan').length,
    0,
    'Clock In should reuse the cached Primary Plan instead of rereading the whole Daily Note',
  );
  assert.equal(
    trace.filter((entry) => entry === 'query:entries').length,
    0,
    'Clock In should mutate the cached CLOCK set and confirm only the created block',
  );
  assert.deepEqual(sidebarWindows, [{ type: 'block', 'block-uid': 'task-a', order: 0 }]);
  const firstClock = [...blocks.values()].find((block) => block.parentUid.startsWith('clock-') && /^CLOCK:/.test(block.string));
  assert.match(firstClock.string, /^CLOCK: \[2026-08-22 Sat 10:00\]$/);

  await runtime.startTask('task-a');
  assert.match(blocks.get(firstClock.uid).string, /^CLOCK: \[2026-08-22 Sat 10:00\]$/);

  current = new Date(2026, 7, 22, 10, 10);
  trace.length = 0;
  await runtime.startTask('task-b');
  assert.equal(
    trace.filter((entry) => entry === 'query:entries').length,
    0,
    'a focus switch should not scan unrelated LOGBOOK history',
  );
  assert.match(firstClock.uid && blocks.get(firstClock.uid).string, /--\[2026-08-22 Sat 10:10\] => 0:10$/);
  const running = [...blocks.values()].filter((block) => /^CLOCK:/.test(block.string) && !block.string.includes('--'));
  assert.equal(running.length, 1);

  current = new Date(2026, 7, 22, 10, 20);
  await runtime.completeTask('task-b');
  assert.match(blocks.get('task-b').string, /DONE/);
  assert.equal([...blocks.values()].filter((block) => /^CLOCK:/.test(block.string) && !block.string.includes('--')).length, 0);
  assert.equal(settings.get('actual-time-pomodoro-state'), null);
  assert.deepEqual(runtime.getSnapshot().activeWork.items.map(({ taskUid }) => taskUid), ['task-a']);
  assert.deepEqual(runtime.getSnapshot().dailyReview.summary, {
    totalCount: 2,
    completedCount: 1,
    comparedCount: 1,
    plannedMinutes: 45,
    actualMinutes: 10,
    varianceMinutes: -35,
  });

  current = new Date(2026, 7, 22, 10, 25);
  await runtime.startTask('task-a');
  const discarded = [...blocks.values()].find((block) => /^CLOCK:/.test(block.string) && !block.string.includes('--'));
  assert.ok(discarded);
  await runtime.deleteCurrentClock('task-a');
  assert.equal(blocks.has(discarded.uid), false);
  assert.match(blocks.get('task-a').string, /TODO/);
  assert.equal([...blocks.values()].filter((block) => /^CLOCK:/.test(block.string) && !block.string.includes('--')).length, 0);
  assert.equal(runtime.getSnapshot().activeWork.focused, null);

  failNextSidebarAdd = true;
  const compatibilityOpen = runtime.openTask('task-x', { sidebar: true });
  await new Promise((resolve) => setTimeout(resolve, 0));
  resolveSidebarOpen?.();
  await compatibilityOpen;
  assert.equal(
    sidebarWindows.filter((window) => window['block-uid'] === 'task-x').length,
    1,
    'a host that rejects addWindow while opening should recover without a duplicate',
  );

  runtime.destroy();
});

test('completing another task leaves the focused CLOCK and Pomodoro running', async (t) => {
  const bundle = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}#non-focused-completion-${Date.now()}`;
  const extension = await import(moduleUrl);
  const { roam, blocks } = graphMock();
  const settings = new Map([
    ['todo-duration', 15],
    ['workday-start', 5],
    ['workday-end', 21],
    ['pomodoro-minutes', 45],
    ['timing-line-sidebar', false],
    ['recent-retention-minutes', 45],
  ]);
  let current = new Date(2026, 7, 22, 10, 0);
  global.window = {
    roamAlphaAPI: roam,
    setInterval: () => 99,
    clearInterval: () => {},
    setTimeout,
    clearTimeout,
  };
  installTestHostLocks(global.window);
  const extensionAPI = {
    settings: {
      get: (key) => settings.get(key),
      set: async (key, value) => settings.set(key, value),
    },
  };
  const runtime = extension.createTimingRuntime({ extensionAPI, now: () => current });
  await runtime.initialize();
  t.after(() => {
    runtime.destroy();
    delete global.window;
  });

  await runtime.startTask('task-a');
  const focusedClock = [...blocks.values()].find((block) => (
    /^CLOCK:/.test(block.string) && blocks.get(block.parentUid)?.parentUid === 'task-a'
  ));
  assert.ok(focusedClock);
  const pomodoro = settings.get('actual-time-pomodoro-state');
  assert.deepEqual(pomodoro, { startedAt: current.getTime() });

  current = new Date(2026, 7, 22, 10, 5);
  await runtime.completeTask('task-b');

  assert.match(blocks.get('task-b').string, /DONE/);
  assert.match(blocks.get(focusedClock.uid).string, /^CLOCK: \[2026-08-22 Sat 10:00\]$/);
  assert.equal(runtime.getSnapshot().activeWork.focused?.taskUid, 'task-a');
  assert.deepEqual(runtime.getSnapshot().pomodoro, pomodoro);
  assert.deepEqual(settings.get('actual-time-pomodoro-state'), pomodoro);
});

test('Primary Plan location opens one deduplicated right-sidebar window without rereading the graph', async (t) => {
  const bundle = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}#locate-sidebar-${Date.now()}`;
  const extension = await import(moduleUrl);
  const trace = [];
  const { roam } = graphMock({ trace });
  const sidebarWindows = [];
  const settings = new Map([
    ['todo-duration', 15],
    ['workday-start', 5],
    ['workday-end', 21],
    ['timing-line-sidebar', false],
    ['recent-retention-minutes', 45],
  ]);
  global.window = {
    roamAlphaAPI: {
      ...roam,
      ui: {
        rightSidebar: {
          open: () => trace.push('sidebar:open'),
          getWindows: () => sidebarWindows.slice(),
          addWindow: async ({ window }) => {
            trace.push(`sidebar:addWindow:${window?.['block-uid'] || ''}`);
            sidebarWindows.push(window);
          },
          setWindowOrder: async ({ window }) => trace.push(`sidebar:front:${window?.['block-uid'] || ''}`),
          expandWindow: async ({ window }) => trace.push(`sidebar:expand:${window?.['block-uid'] || ''}`),
        },
      },
    },
    setInterval: () => 99,
    clearInterval: () => {},
    setTimeout,
    clearTimeout,
  };
  installTestHostLocks(global.window);
  t.after(() => { delete global.window; });

  const extensionAPI = {
    settings: {
      get: (key) => settings.get(key),
      set: async (key, value) => settings.set(key, value),
    },
  };
  const runtime = extension.createTimingRuntime({
    extensionAPI,
    now: () => new Date(2026, 7, 22, 10, 0),
  });
  await runtime.initialize();
  await new Promise((resolve) => setTimeout(resolve, 0));
  trace.length = 0;

  await runtime.locate({ sidebar: true });
  await runtime.locate({ sidebar: true });

  assert.deepEqual(sidebarWindows, [{ type: 'block', 'block-uid': 'plan', order: 0 }]);
  assert.equal(trace.filter((entry) => entry === 'sidebar:addWindow:plan').length, 1);
  assert.equal(trace.includes('sidebar:front:plan'), true);
  assert.equal(trace.includes('sidebar:expand:plan'), true);
  assert.equal(trace.includes('query:plan'), false);
  runtime.destroy();
});

test('chart task location scrolls in its current surface and falls back to official block navigation', async (t) => {
  const bundle = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}#chart-locate-${Date.now()}`;
  const extension = await import(moduleUrl);
  const trace = [];
  const containerClasses = new Set();
  const rowClasses = new Set();
  const row = {
    classList: {
      add: (name) => {
        trace.push(['row:add', name]);
        rowClasses.add(name);
      },
      remove: (name) => {
        trace.push(['row:remove', name]);
        rowClasses.delete(name);
      },
    },
  };
  const target = {
    classList: {
      add: (name) => containerClasses.add(name),
      remove: (name) => containerClasses.delete(name),
    },
    querySelector: (selector) => (selector === ':scope > .rm-block-main' ? row : null),
    getClientRects: () => [{ width: 1, height: 1 }],
    scrollIntoView: (options) => trace.push(['scroll', options]),
  };
  let visibleTarget = target;
  const selectors = [];
  const surface = {
    querySelectorAll: (selector) => {
      selectors.push(selector);
      return selector === '[data-block-uid="task-a"]' && visibleTarget ? [visibleTarget] : [];
    },
  };
  const origin = {
    closest: () => surface,
  };
  global.window = {
    roamAlphaAPI: {
      ui: {
        mainWindow: {
          openBlock: async ({ block }) => trace.push(['open', block.uid]),
        },
      },
    },
    matchMedia: () => ({ matches: false }),
    setTimeout: (callback) => {
      trace.push(['timer']);
      callback();
      return 1;
    },
  };
  installTestHostLocks(global.window);
  global.document = surface;
  t.after(() => {
    delete global.window;
    delete global.document;
  });

  const scrolled = await extension.locateTaskInCurrentSurface('task-a', { origin });
  assert.deepEqual(scrolled, { ok: true, mode: 'scroll' });
  assert.equal(selectors[0], '[data-block-uid="task-a"]');
  assert.deepEqual(trace[0], ['scroll', { block: 'center', behavior: 'smooth' }]);
  assert.equal(trace.some(([action]) => action === 'open'), false);
  assert.equal(trace.some(([action]) => action === 'row:add'), true);
  assert.equal(containerClasses.has('nautilus-log-timing__located'), false, 'the parent subtree should not be highlighted');
  assert.equal(rowClasses.has('nautilus-log-timing__located'), false, 'temporary highlight should clean itself up');

  visibleTarget = null;
  const opened = await extension.locateTaskInCurrentSurface('task-a', { origin });
  assert.deepEqual(opened, { ok: true, mode: 'open' });
  assert.deepEqual(trace.find(([action]) => action === 'open'), ['open', 'task-a']);
});

test('Clock Out uses the confirmed Timing snapshot and cancels a competing idle refresh', async (t) => {
  const bundle = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}#clock-out-fast-${Date.now()}`;
  const extension = await import(moduleUrl);
  const trace = [];
  const { roam, blocks } = graphMock({ trace });
  const settings = new Map([
    ['todo-duration', 15],
    ['pomodoro-minutes', 45],
    ['timing-line-sidebar', false],
    ['recent-retention-minutes', 45],
    ['forgotten-timer-minutes', 120],
  ]);
  const idleCallbacks = new Map();
  const cancelledIdle = [];
  let idleId = 0;
  let current = new Date(2026, 7, 22, 10, 0);
  global.window = {
    roamAlphaAPI: roam,
    setInterval: () => 99,
    clearInterval: () => {},
    setTimeout,
    clearTimeout,
    requestIdleCallback: (callback) => {
      const id = ++idleId;
      idleCallbacks.set(id, callback);
      return id;
    },
    cancelIdleCallback: (id) => {
      cancelledIdle.push(id);
      idleCallbacks.delete(id);
    },
  };
  installTestHostLocks(global.window);
  t.after(() => { delete global.window; });

  const extensionAPI = {
    settings: {
      get: (key) => settings.get(key),
      set: async (key, value) => settings.set(key, value),
    },
  };
  const runtime = extension.createTimingRuntime({ extensionAPI, now: () => new Date(current) });
  await runtime.initialize();
  await runtime.startTask('task-a');
  const clock = [...blocks.values()].find((block) => /^CLOCK:/.test(block.string));
  assert.ok(clock);

  trace.length = 0;
  const staleRefresh = runtime.requestRefresh();
  current = new Date(2026, 7, 22, 10, 5);
  await runtime.stopTask();
  const cancelledBeforeDestroy = cancelledIdle.slice();
  const entriesQueries = trace.filter((entry) => entry === 'query:entries').length;
  const planQueries = trace.filter((entry) => entry === 'query:plan').length;
  const closedClockString = blocks.get(clock.uid).string;
  const finalSnapshot = runtime.getSnapshot();
  runtime.destroy();
  await staleRefresh;

  assert.deepEqual(cancelledBeforeDestroy, [1], 'a user mutation should cancel a queued idle graph refresh');
  assert.equal(
    entriesQueries,
    0,
    'Clock Out should verify its confirmed CLOCK UID directly instead of rescanning every LOGBOOK',
  );
  assert.equal(
    planQueries,
    0,
    'Clock Out should keep the cached Primary Plan instead of rereading the Daily Note tree',
  );
  assert.match(closedClockString, /--\[2026-08-22 Sat 10:05\] => 0:05$/);
  assert.equal(finalSnapshot.activeWork.focused, null);
  assert.deepEqual(finalSnapshot.activeWork.recent.map(({ taskUid }) => taskUid), ['task-a']);
});

test('standalone POMO persists without graph writes and CLOCK takes priority', async (t) => {
  const bundle = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}#standalone-pomo-${Date.now()}`;
  const extension = await import(moduleUrl);
  const trace = [];
  const { roam, blocks } = graphMock({ trace });
  const settings = new Map([
    ['todo-duration', 15],
    ['pomodoro-minutes', 45],
    ['timing-line-sidebar', false],
    ['recent-retention-minutes', 45],
  ]);
  global.window = {
    roamAlphaAPI: roam,
    setInterval: () => 99,
    clearInterval: () => {},
    setTimeout,
    clearTimeout,
  };
  installTestHostLocks(global.window);
  const extensionAPI = {
    settings: {
      get: (key) => settings.get(key),
      set: async (key, value) => settings.set(key, value),
    },
  };
  const runtime = extension.createTimingRuntime({
    extensionAPI,
    now: () => new Date(2026, 7, 22, 10, 0),
  });
  await runtime.initialize();
  t.after(() => {
    runtime.destroy();
    delete global.window;
  });

  trace.length = 0;
  const graphSizeBeforePomo = blocks.size;
  const started = await runtime.startStandalonePomodoro();
  assert.deepEqual(started.standalonePomodoro, { startedAt: new Date(2026, 7, 22, 10, 0).getTime() });
  assert.deepEqual(settings.get('standalone-pomodoro-state'), started.standalonePomodoro);
  assert.equal(blocks.size, graphSizeBeforePomo, 'POMO must not write graph blocks');
  assert.equal(trace.some((entry) => entry.startsWith('query:')), false, 'POMO must not query the graph');

  await runtime.startStandalonePomodoro();
  assert.deepEqual(runtime.getSnapshot().standalonePomodoro, started.standalonePomodoro);

  await runtime.startTask('task-a');
  assert.equal(runtime.getSnapshot().standalonePomodoro, null);
  assert.equal(settings.get('standalone-pomodoro-state'), null);
  assert.equal(runtime.getSnapshot().activeWork.focused.taskUid, 'task-a');
  await runtime.startStandalonePomodoro();
  assert.equal(runtime.getSnapshot().status, 'ready', 'a rejected POMO start must not leave actions disabled');
  assert.equal(runtime.getSnapshot().standalonePomodoro, null);

  await runtime.stopTask();
  const restarted = await runtime.startStandalonePomodoro();
  assert.ok(restarted.standalonePomodoro);
  await runtime.stopStandalonePomodoro();
  assert.equal(runtime.getSnapshot().standalonePomodoro, null);
  assert.equal(settings.get('standalone-pomodoro-state'), null);
});

test('standalone POMO restores its absolute start and is cleared if CLOCK is already focused', async (t) => {
  const bundle = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}#standalone-pomo-restore-${Date.now()}`;
  const extension = await import(moduleUrl);
  const { roam } = graphMock();
  const settings = new Map([
    ['todo-duration', 15],
    ['pomodoro-minutes', 45],
    ['timing-line-sidebar', false],
    ['recent-retention-minutes', 45],
  ]);
  global.window = {
    roamAlphaAPI: roam,
    setInterval: () => 99,
    clearInterval: () => {},
    setTimeout,
    clearTimeout,
  };
  installTestHostLocks(global.window);
  const extensionAPI = {
    settings: {
      get: (key) => settings.get(key),
      set: async (key, value) => settings.set(key, value),
    },
  };
  const first = extension.createTimingRuntime({
    extensionAPI,
    now: () => new Date(2026, 7, 22, 10, 0),
  });
  await first.initialize();
  const started = await first.startStandalonePomodoro();
  first.destroy();

  const restored = extension.createTimingRuntime({
    extensionAPI,
    now: () => new Date(2026, 7, 22, 10, 20),
  });
  await restored.initialize();
  t.after(() => {
    restored.destroy();
    first.destroy();
    delete global.window;
  });

  assert.deepEqual(restored.getSnapshot().standalonePomodoro, started.standalonePomodoro);
  await restored.startTask('task-a');
  assert.equal(restored.getSnapshot().standalonePomodoro, null);

  await extensionAPI.settings.set('standalone-pomodoro-state', { startedAt: started.standalonePomodoro.startedAt });
  restored.refresh({ planSnapshot: restored.getSnapshot().planSnapshot, entries: restored.getSnapshot().entries });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(restored.getSnapshot().standalonePomodoro, null);
  assert.equal(settings.get('standalone-pomodoro-state'), null);
});

async function coordinatedRuntimes(t, {BroadcastChannel, ...runtimeOptions} = {}) {
  const bundle = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
  const load = () => import(`data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}#clock-client-${Math.random()}`);
  const {roam, blocks, trace} = graphMock();
  const locks = exclusiveLocks();
  global.window = {
    roamAlphaAPI: roam, BroadcastChannel,
    setInterval: () => 99, clearInterval: () => {}, setTimeout, clearTimeout,
  };
  installTestHostLocks(global.window, locks);
  let current = new Date(2026, 7, 22, 10);
  const settings = new Map([['timing-line-sidebar', false]]);
  const options = {
    ...runtimeOptions,
    extensionAPI: {settings: {get: (key) => settings.get(key), set: async (key, value) => settings.set(key, value)}},
    now: () => new Date(current),
  };
  const first = (await load()).createTimingRuntime(options);
  const second = (await load()).createTimingRuntime(options);
  t.after(() => {first.destroy(); second.destroy(); delete global.window;});
  await Promise.all([first.initialize(), second.initialize()]);
  return {first, second, roam, blocks, trace, setNow: (date) => {current = date;}};
}

test('two independent clients switch CLOCK ownership without overlapping records', async (t) => {
  const {first, second, setNow} = await coordinatedRuntimes(t);
  await first.startTask('task-a');
  setNow(new Date(2026, 7, 22, 10, 1));
  await second.startTask('task-b');
  const state = first.refresh();
  assert.deepEqual(state.entries.filter((entry) => entry.running).map((entry) => entry.taskUid), ['task-b']);
  assert.equal(state.entries.find((entry) => entry.taskUid === 'task-a').minutes, 1);
});

test('simultaneous starts from separate module instances leave one CLOCK', async (t) => {
  const {first, second} = await coordinatedRuntimes(t);
  await Promise.all([first.startTask('task-a'), second.startTask('task-b')]);
  assert.equal(first.refresh().entries.filter((entry) => entry.running).length, 1);
});

test('two clients starting the same task do not duplicate its CLOCK', async (t) => {
  const {first, second} = await coordinatedRuntimes(t);
  await Promise.all([first.startTask('task-a'), second.startTask('task-a')]);
  assert.equal(first.refresh().entries.length, 1);
});

test('CLOCK notifications refresh another tab and channels close on unload', async (t) => {
  const channels = new Set();
  class Channel {
    constructor(name) {this.name = name; channels.add(this);}
    postMessage(data) {
      for (const peer of channels) {
        if (peer !== this && peer.name === this.name) queueMicrotask(() => peer.onmessage?.({data}));
      }
    }
    close() {channels.delete(this);}
  }
  const {first, second} = await coordinatedRuntimes(t, {BroadcastChannel: Channel});
  const changed = new Promise((resolve) => {
    const stop = second.subscribe((state) => {
      if (state.activeWork.focused?.taskUid === 'task-a') {stop(); resolve();}
    });
  });
  await first.startTask('task-a');
  await changed;
  assert.equal(second.getSnapshot().activeWork.focused.taskUid, 'task-a');
  first.destroy();
  second.destroy();
  assert.equal(channels.size, 0);
});

test('CLOCK start fails closed without native coordination and leaves the graph unchanged', async (t) => {
  const {first, blocks} = await coordinatedRuntimes(t);
  global.window.navigator = {};
  const before = blocks.size;
  await assert.rejects(first.startTask('task-a'), /cross-tab|coordination|lock/i);
  assert.equal(blocks.size, before);
});

test('destroy cancels a queued cross-tab CLOCK request before any write', async (t) => {
  const {first, blocks} = await coordinatedRuntimes(t);
  let entered;
  const waiting = new Promise((resolve) => {entered = resolve;});
  global.window.navigator = {locks: {
    request: (_name, {signal}, _operation) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('Actual Time Tracking is no longer active.')), {once: true});
      entered();
    }),
  }};
  const before = blocks.size;
  const pending = first.startTask('task-a');
  await waiting;
  first.destroy();
  await assert.rejects(pending, /no longer active/);
  assert.equal(blocks.size, before);
});

test('a changed graph cannot receive a CLOCK from an old runtime', async (t) => {
  const {first, roam, blocks} = await coordinatedRuntimes(t);
  roam.graph.name = 'another-graph';
  const before = blocks.size;
  await assert.rejects(first.startTask('task-a'), /graph.*changed/i);
  assert.equal(blocks.size, before);
});

test('background and direct refreshes cannot publish ready during a pending CLOCK write', async (t) => {
  const {first, roam, trace} = await coordinatedRuntimes(t);
  let release;
  let entered;
  const gate = new Promise((resolve) => {release = resolve;});
  const writing = new Promise((resolve) => {entered = resolve;});
  t.after(() => release());
  const create = roam.createBlock;
  roam.createBlock = async (payload) => {
    if (/^CLOCK:/.test(payload.block.string)) {entered(); await gate;}
    return create(payload);
  };
  const pending = first.startTask('task-a');
  await writing;
  const readCount = trace.length;
  const requested = first.requestRefresh({immediate: true});
  try {
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(first.getSnapshot().status, 'working');
    assert.equal(first.refresh().status, 'working');
    assert.equal(trace.length, readCount, 'background work should defer graph reads while a writer is pending');
  } finally {
    release();
    await pending;
  }
  const completed = await pending;
  assert.equal(completed.status, 'ready');
  assert.equal((await requested).activeWork.focused.taskUid, 'task-a');
});

test('Clock Out preserves a newer foreign CLOCK and reschedules the cancelled refresh', async (t) => {
  const {first, second, setNow} = await coordinatedRuntimes(t);
  const idle = new Map();
  let nextId = 0;
  window.requestIdleCallback = (callback) => {const id = ++nextId; idle.set(id, callback); return id;};
  window.cancelIdleCallback = (id) => idle.delete(id);
  await first.startTask('task-a');
  setNow(new Date(2026, 7, 22, 10, 2));
  await second.startTask('task-b');
  const requested = first.requestRefresh();
  const stopped = await first.stopTask();
  assert.equal(stopped.activeWork.focused?.taskUid, 'task-b', 'do not show idle or retarget an old Stop click to another task');
  assert.ok(idle.size > 0, 'the cancelled idle read must be scheduled again');
  for (const [id, callback] of [...idle]) {idle.delete(id); callback();}
  assert.equal((await requested).activeWork.focused?.taskUid, 'task-b');
  assert.equal(second.refresh().activeWork.focused?.taskUid, 'task-b');
});

test('a stale Delete cannot remove a CLOCK closed by another tab', async (t) => {
  const {first, second, blocks, setNow} = await coordinatedRuntimes(t);
  await first.startTask('task-a');
  const originalUid = first.getSnapshot().activeWork.focused.clockUid;
  setNow(new Date(2026, 7, 22, 10, 2));
  await second.startTask('task-b');
  const history = blocks.get(originalUid).string;
  await assert.rejects(first.deleteCurrentClock('task-a'), /changed|running/i);
  assert.equal(blocks.get(originalUid)?.string, history);
  assert.equal(first.getSnapshot().activeWork.focused?.taskUid, 'task-b');
});

test('a stale Delete never retargets a new CLOCK for the same task', async (t) => {
  const {first, second, blocks, setNow} = await coordinatedRuntimes(t);
  await first.startTask('task-a');
  const originalUid = first.getSnapshot().activeWork.focused.clockUid;
  second.refresh();
  setNow(new Date(2026, 7, 22, 10, 1));
  await second.stopTask();
  await second.startTask('task-a');
  const newUid = second.getSnapshot().activeWork.focused.clockUid;
  await assert.rejects(first.deleteCurrentClock('task-a'), /changed|running/i);
  assert.ok(blocks.has(originalUid));
  assert.ok(blocks.has(newUid));
  assert.equal(first.getSnapshot().activeWork.focused?.clockUid, newUid);
});

test('completion closes a target task CLOCK even when only another tab knew it', async (t) => {
  const {first, second, setNow} = await coordinatedRuntimes(t);
  await second.startTask('task-a');
  setNow(new Date(2026, 7, 22, 10, 4));
  const completed = await first.completeTask('task-a');
  assert.equal(completed.activeWork.focused, null);
  assert.equal(second.refresh().entries.some((entry) => entry.running), false);
  assert.equal(completed.dailyReview.rows.find((row) => row.uid === 'task-a').actualMinutes, 4);
});

test('Delete revalidates the selected block after the running-CLOCK query', async (t) => {
  const {first, roam, blocks} = await coordinatedRuntimes(t);
  await first.startTask('task-a');
  const uid = first.getSnapshot().activeWork.focused.clockUid;
  const history = 'CLOCK: [2026-08-22 Sat 10:00]--[2026-08-22 Sat 10:02] => 0:02';
  const pull = roam.data.pull;
  roam.data.pull = (pattern, lookup) => {
    if (lookup[1] === uid) blocks.get(uid).string = history;
    return pull(pattern, lookup);
  };
  await assert.rejects(first.deleteCurrentClock('task-a'), /changed|historical/i);
  assert.equal(blocks.get(uid)?.string, history);
});

test('failed completion shows an already-closed CLOCK rather than restoring stale running state', async (t) => {
  const {first, roam, setNow} = await coordinatedRuntimes(t);
  await first.startTask('task-a');
  setNow(new Date(2026, 7, 22, 10, 2));
  const update = roam.updateBlock;
  roam.updateBlock = (payload) => {
    if (payload.block.uid === 'task-a') throw new Error('Completion refused');
    return update(payload);
  };
  await assert.rejects(first.completeTask('task-a'), /Completion refused/);
  const state = first.getSnapshot();
  assert.equal(state.status, 'ready');
  assert.equal(state.activeWork.focused, null);
  assert.equal(state.entries.find((entry) => entry.taskUid === 'task-a').minutes, 2);
  assert.match(state.notice, /Completion refused/);
});

test('a source-completion watch arriving during a write is reconciled after settlement', {timeout: 3000}, async (t) => {
  const watchers = [];
  const {first, roam, blocks} = await coordinatedRuntimes(t, {
    watchPlan: (_uid, callback) => {watchers.push(callback); return () => {};},
  });
  let release;
  let entered;
  const gate = new Promise((resolve) => {release = resolve;});
  const writing = new Promise((resolve) => {entered = resolve;});
  t.after(() => release());
  const create = roam.createBlock;
  roam.createBlock = async (payload) => {
    if (/^CLOCK:/.test(payload.block.string)) {entered(); await gate;}
    return create(payload);
  };
  const completed = new Promise((resolve) => {
    const stop = first.subscribe((state) => {
      if (state.status === 'ready' && state.entries.some((entry) => entry.status === 'DONE' && !entry.running)) {
        stop(); resolve(state);
      }
    });
  });
  const pending = first.startTask('task-a');
  await writing;
  blocks.get('task-a').string = '{{[[DONE]]}} Alpha 30m';
  watchers[0](null);
  release();
  await pending;
  assert.equal((await completed).activeWork.focused, null);
});

test('queued source reconciliation cannot overwrite a newer foreign CLOCK with captured entries', {timeout: 3000}, async (t) => {
  const watchers = [];
  const {first, second, blocks} = await coordinatedRuntimes(t, {
    watchPlan: (_uid, callback) => {watchers.push(callback); return () => {};},
  });
  await first.startTask('task-a');
  blocks.get('task-a').string = '{{[[DONE]]}} Alpha 30m';
  let release;
  let entered;
  const gate = new Promise((resolve) => {release = resolve;});
  const held = new Promise((resolve) => {entered = resolve;});
  t.after(() => release());
  const locks = window.navigator.locks;
  let holdNext = true;
  window.navigator = {locks: {
    request: (name, options, operation) => locks.request(name, options, async () => {
      if (holdNext) {holdNext = false; entered(); await gate;}
      return operation();
    }),
  }};
  const foreign = second.startTask('task-b');
  await held;
  const waiting = new Promise((resolve) => {
    const stop = first.subscribe((state) => {if (state.status === 'working') {stop(); resolve();}});
  });
  const reconciled = new Promise((resolve) => {
    const stop = first.subscribe((state) => {
      if (state.status === 'ready' && state.entries.some((entry) => entry.taskUid === 'task-a' && !entry.running)) {
        stop(); resolve(state);
      }
    });
  });
  watchers[0](null);
  await waiting;
  release();
  await foreign;
  assert.equal((await reconciled).activeWork.focused?.taskUid, 'task-b');
});
