const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function graphMock({ trace = [] } = {}) {
  let generated = 0;
  const blocks = new Map([
    ['plan', { uid: 'plan', string: '[[Nautilus Log]] {{[[roam/render]]:((roam-render-Nautilus-Log-cljs))}}', parentUid: 'page', order: 0 }],
    ['task-a', { uid: 'task-a', string: '{{[[TODO]]}} Alpha 30m', parentUid: 'plan', order: 0 }],
    ['task-b', { uid: 'task-b', string: '{{[[TODO]]}} Beta 45m', parentUid: 'plan', order: 1 }],
  ]);

  const children = (uid) => [...blocks.values()]
    .filter((block) => block.parentUid === uid)
    .sort((left, right) => Number(left.order) - Number(right.order));

  function q(query, ...args) {
    if (query.includes('?page-uid ?uid ?string ?order ?parent-uid')) {
      trace.push('query:plan');
      return [...blocks.values()]
        .filter((block) => ['plan', 'task-a', 'task-b'].includes(block.uid))
        .map((block) => [['page', block.uid, block.string, block.order, block.parentUid]])
        .flat();
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
  assert.deepEqual(
    runtime.getSnapshot().dailyReview.rows.map(({ uid, state }) => [uid, state]),
    [['task-a', 'not-started'], ['task-b', 'not-started']],
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
    2,
    'Clock In should reuse its confirmation snapshot instead of issuing a third CLOCK query',
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
    2,
    'a focus switch should scan all CLOCK entries only for preflight and final creation confirmation',
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
