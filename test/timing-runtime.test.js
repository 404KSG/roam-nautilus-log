const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function graphMock() {
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
      return [...blocks.values()]
        .filter((block) => ['plan', 'task-a', 'task-b'].includes(block.uid))
        .map((block) => [['page', block.uid, block.string, block.order, block.parentUid]])
        .flat();
    }
    if (query.includes('?clock-uid ?clock-string')) {
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
  };

  return { roam, blocks };
}

test('runtime serializes close-before-switch and close-before-complete', async (t) => {
  const bundle = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}#timing-${Date.now()}`;
  const extension = await import(moduleUrl);
  const { roam, blocks } = graphMock();
  const settings = new Map([
    ['todo-duration', 15],
    ['pomodoro-minutes', 45],
    ['timing-line-sidebar', true],
  ]);
  const sidebarWindows = [];
  let current = new Date(2026, 7, 22, 10, 0);
  global.window = {
    roamAlphaAPI: {
      ...roam,
      ui: {
        rightSidebar: {
          open: async () => {},
          getWindows: async () => sidebarWindows.slice(),
          addWindow: async ({ window }) => sidebarWindows.push(window),
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

  await runtime.startTask('task-a');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(sidebarWindows, [{ type: 'block', 'block-uid': 'task-a', order: 0 }]);
  const firstClock = [...blocks.values()].find((block) => block.parentUid.startsWith('clock-') && /^CLOCK:/.test(block.string));
  assert.match(firstClock.string, /^CLOCK: \[2026-08-22 Sat 10:00\]$/);

  await runtime.startTask('task-a');
  assert.match(blocks.get(firstClock.uid).string, /^CLOCK: \[2026-08-22 Sat 10:00\]$/);

  current = new Date(2026, 7, 22, 10, 10);
  await runtime.startTask('task-b');
  assert.match(firstClock.uid && blocks.get(firstClock.uid).string, /--\[2026-08-22 Sat 10:10\] => 0:10$/);
  const running = [...blocks.values()].filter((block) => /^CLOCK:/.test(block.string) && !block.string.includes('--'));
  assert.equal(running.length, 1);

  current = new Date(2026, 7, 22, 10, 20);
  await runtime.completeTask('task-b');
  assert.match(blocks.get('task-b').string, /DONE/);
  assert.equal([...blocks.values()].filter((block) => /^CLOCK:/.test(block.string) && !block.string.includes('--')).length, 0);
  assert.equal(settings.get('actual-time-pomodoro-state'), null);
  assert.deepEqual(runtime.getSnapshot().activeWork.items.map(({ taskUid }) => taskUid), ['task-a']);

  runtime.destroy();
});
