const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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
      trace.push('query:entries');
      const rows = [];
      for (const clock of blocks.values()) {
        if (!/^CLOCK:/.test(clock.string)) continue;
        const drawer = blocks.get(clock.parentUid);
        const task = blocks.get(drawer.parentUid);
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
    util: {
      generateUID: () => `clock-${++generated}`,
      dateToPageTitle: () => 'August 22nd, 2026',
    },
    q,
    data: {
      pull: (_pattern, lookup) => {
        trace.push(`pull:${lookup?.[1] || ''}`);
        const block = blocks.get(lookup?.[1]);
        return block ? { ':block/string': block.string } : null;
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

test('execution capacity applies task progress exactly once', async (t) => {
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

  assert.equal(runtime.getSnapshot().planSnapshot.execution.demandMinutes, 30);
  assert.equal(runtime.getSnapshot().planSnapshot.execution.scheduledTasks[0].duration, 30);
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
  const { roam, blocks } = graphMock({
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
  blocks.set('task-a', {
    ...blocks.get('task-a'),
    string: '{{[[TODO]]}} ((source-a))',
  });
  planListener();
  await new Promise((resolve) => setTimeout(resolve, 5));

  assert.equal(runtime.getSnapshot().planSnapshot.execution.demandMinutes, 15);
  assert.equal(runtime.getSnapshot().planSnapshot.tasks[0].statusOrigin, 'local');
  runtime.destroy();
  assert.equal(stopped, true);
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
  assert.equal(trace.filter((entry) => entry === 'query:scoped-entries').length, 1);
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
