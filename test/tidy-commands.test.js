const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { installTestHostLocks } = require('./test-host-locks.cjs');

async function loadExtension() {
  const bundle = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}#tidy-commands-${Date.now()}-${Math.random()}`);
}

test('Tidy command is shortcut-ready, resolves one target, and cleans up', async () => {
  const extension = await loadExtension();
  const palette = new Map();
  const calls = [];
  const extensionAPI = {
    ui: {
      commandPalette: {
        addCommand: (command) => palette.set(command.label, command),
        removeCommand: ({ label }) => palette.delete(label),
      },
    },
  };
  const commands = extension.createTidyCommands({
    extensionAPI,
    resolveTarget: () => ({
      planUid: 'plan-a',
      settledUids: ['done-a', 'past-event'],
      language: 'en',
    }),
    tidy: async (options) => calls.push(options),
  });

  assert.equal(commands.initialize(), true);
  assert.equal(commands.initialize(), false);
  assert.deepEqual([...palette.keys()], ['Nautilus Log: Tidy Primary Plan']);
  const command = palette.get('Nautilus Log: Tidy Primary Plan');
  assert.equal('defaultHotkey' in command, false);

  await command.callback();
  assert.deepEqual(calls, [{
    planUid: 'plan-a',
    settledUids: ['done-a', 'past-event'],
    language: 'en',
  }]);

  commands.destroy();
  assert.equal(palette.size, 0);
});

test('Tidy command registration is optional in command-palette-free shells', async () => {
  const extension = await loadExtension();
  const commands = extension.createTidyCommands({
    extensionAPI: {},
    tidy: async () => ({ ok: true }),
  });

  assert.equal(commands.initialize(), false);
  assert.doesNotThrow(() => commands.destroy());
});

test('Tidy command projection includes completed tasks and elapsed or completed events', async () => {
  const extension = await loadExtension();
  const settled = extension.settledUidsForTidy({
    reviewCandidates: [
      { uid: 'todo-a', status: 'TODO' },
      { uid: 'done-a', status: 'DONE' },
      { uid: 'done-source', status: 'DONE', statusOrigin: 'source' },
    ],
    fixedEvents: [
      { uid: 'past-event', end: 600, done: false },
      { uid: 'future-event', end: 900, done: false },
      { uid: 'done-event', end: 900, done: true },
    ],
  }, 720);

  assert.deepEqual(settled, ['done-a', 'done-source', 'past-event', 'done-event']);
});

const PLAN_STRING = '[[Nautilus Log]] {{[[roam/render]]:((roam-render-Nautilus-Log-cljs))}}';
const PAGE_TITLE = 'August 22nd, 2026';

function commandPathHarness(extension, { rows, runningUid = null, useNativeLocks = true } = {}) {
  const blocks = new Map();
  blocks.set('plan', { uid: 'plan', string: PLAN_STRING, parentUid: 'page', order: 0, open: true });
  (rows || [
    { uid: 'active-a', string: '{{[[TODO]]}} Alpha 15m', open: true },
    { uid: 'done-a', string: '{{[[DONE]]}} Done A 15m', open: false },
    { uid: 'divider', string: '---', open: false },
    { uid: 'past-event', string: '{{[[DONE]]}} 05:00-06:00 Event', open: false },
    { uid: 'active-b', string: '{{[[TODO]]}} Beta 15m', open: true },
  ]).forEach((row, order) => {
    blocks.set(row.uid, {
      uid: row.uid,
      string: row.string,
      parentUid: 'page' === row.parentUid ? 'page' : 'plan',
      order,
      open: row.open === true,
    });
  });
  const childrenOf = (parentUid) => [...blocks.values()]
    .filter((block) => block.parentUid === parentUid)
    .sort((left, right) => Number(left.order) - Number(right.order));
  const traces = [];
  const hooks = {};
  const notices = [];
  const actions = [];
  const q = (query, ...args) => {
    if (query.includes('?page-uid ?uid ?string ?order ?parent-uid')) {
      traces.push('query:plan');
      return [...blocks.values()].map((block) => [
        'page',
        block.uid,
        block.string,
        block.order,
        block.parentUid,
      ]);
    }
    if (query.includes('?uid ?string ?order ?open')) {
      traces.push(`query:children:${args[0]}`);
      return childrenOf(args[0]).map((block) => [
        block.uid,
        block.string,
        block.order,
        block.open === true,
      ]);
    }
    if (query.includes(':find ?s')) {
      traces.push(`query:string:${args[0]}`);
      const block = blocks.get(args[0]);
      return block ? [[block.string]] : [];
    }
    traces.push('query:other');
    return [];
  };
  const roam = {
    graph: { name: 'tidy-command-path' },
    util: { dateToPageTitle: () => PAGE_TITLE },
    q,
    data: {
      q,
      pull: (pattern, lookup) => {
        const lookupKey = lookup?.[0];
        const lookupVal = lookup?.[1];
        traces.push(`pull:${lookupKey || ''}:${lookupVal || ''}`);
        if (typeof pattern === 'string' && (pattern.includes(':block/_page') || pattern.includes('block/_page'))) {
          traces.push('pull:daily-tree');
          if (lookupVal !== PAGE_TITLE) return null;
          return {
            ':block/uid': 'page',
            ':block/_page': [...blocks.values()].map((block) => ({
              ':block/uid': block.uid,
              ':block/string': block.string,
              ':block/order': block.order,
              ':block/_children': block.parentUid ? [{ ':block/uid': block.parentUid }] : [],
            })),
          };
        }
        const block = blocks.get(lookupVal);
        return block ? { ':block/string': block.string, ':block/uid': block.uid } : null;
      },
      block: {
        move: async ({ location, block }) => {
          await hooks.beforeMove?.(block.uid);
          traces.push(`move:${block.uid}:${location.order}`);
          const siblings = childrenOf(location['parent-uid']);
          const from = siblings.findIndex((row) => row.uid === block.uid);
          if (from < 0) throw new Error(`missing ${block.uid}`);
          const [row] = siblings.splice(from, 1);
          siblings.splice(location.order, 0, row);
          siblings.forEach((child, index) => {
            child.order = index;
            child.parentUid = location['parent-uid'];
          });
          await hooks.afterMove?.(block.uid);
        },
        update: async ({ block }) => {
          await hooks.beforeSetOpen?.(block.uid, block.open);
          traces.push(`setOpen:${block.uid}:${block.open}`);
          const current = blocks.get(block.uid);
          if (!current) throw new Error(`missing ${block.uid}`);
          if (block.open !== undefined) current.open = block.open === true;
          await hooks.afterSetOpen?.(block.uid, block.open);
        },
      },
    },
  };
  roam.moveBlock = (args) => roam.data.block.move(args);
  roam.updateBlock = (args) => roam.data.block.update(args);
  const settingsReads = [];
  const palette = new Map();
  const previousWindow = global.window;
  const host = { roamAlphaAPI: roam };
  if (useNativeLocks) installTestHostLocks(host);
  global.window = host;
  let runningTaskUid = runningUid;
  const tidyOptions = {
    runningTaskUid: () => runningTaskUid,
    notify: (message, intent) => notices.push({ message, intent }),
    notifyAction: (options) => actions.push(options),
  };
  if (!useNativeLocks) tidyOptions.runExclusive = undefined;
  const planTidy = extension.createPlanTidy(tidyOptions);
  const commands = extension.createTidyCommands({
    extensionAPI: {
      settings: {
        get(key) {
          settingsReads.push(key);
          if (key === 'todo-duration') return 15;
          if (key === 'language') return 'en';
          return null;
        },
      },
      ui: {
        commandPalette: {
          addCommand: (command) => palette.set(command.label, command),
          removeCommand: ({ label }) => palette.delete(label),
        },
      },
    },
    tidy: planTidy.run,
  });
  commands.initialize();
  return {
    command: palette.get('Nautilus Log: Tidy Primary Plan'),
    traces,
    settingsReads,
    notices,
    actions,
    hooks,
    planTidy,
    commands,
    childrenOf,
    setRunning(uid) { runningTaskUid = uid; },
    mutate(mutator) {
      const current = childrenOf('plan');
      const next = mutator(current.map((row) => ({ ...row })));
      for (const row of current) {
        if (!next.some((item) => item.uid === row.uid)) blocks.delete(row.uid);
      }
      next.forEach((row, order) => {
        blocks.set(row.uid, { ...row, parentUid: 'plan', order });
      });
    },
    restore() {
      try { commands.destroy(); } catch (_error) { /* ignore */ }
      try { planTidy.destroy(); } catch (_error) { /* ignore */ }
      if (previousWindow === undefined) delete global.window;
      else global.window = previousWindow;
    },
  };
}

test('Tidy command palette callback uses default readPrimaryPlan and tidies settled rows', async () => {
  const extension = await loadExtension();
  const harness = commandPathHarness(extension);
  try {
    const result = await harness.command.callback();
    assert.equal(result.ok, true);
    assert.equal(result.changed, true);
    assert.deepEqual(harness.childrenOf('plan').map((row) => row.uid), [
      'done-a',
      'past-event',
      'active-a',
      'divider',
      'active-b',
    ]);
    assert.equal(harness.traces.filter((row) => row === 'query:plan').length, 0);
    assert.ok(harness.traces.includes('pull:daily-tree'));
    assert.deepEqual(harness.settingsReads, ['todo-duration', 'language']);
    assert.equal(harness.traces.filter((row) => row.startsWith('move:')).length, 2);
    assert.equal(Boolean(result.token), true);
  } finally {
    harness.restore();
  }
});

test('Tidy command path no-op does not read children once per settled row', async () => {
  const extension = await loadExtension();
  const harness = commandPathHarness(extension, {
    rows: [
      { uid: 'done-a', string: '{{[[DONE]]}} Done A 15m', open: false },
      { uid: 'past-event', string: '{{[[DONE]]}} 05:00-06:00 Event', open: false },
      { uid: 'active-a', string: '{{[[TODO]]}} Alpha 15m', open: true },
      { uid: 'divider', string: '---', open: false },
      { uid: 'active-b', string: '{{[[TODO]]}} Beta 15m', open: true },
    ],
  });
  try {
    const result = await harness.command.callback();
    assert.equal(result.ok, true);
    assert.equal(result.changed, false);
    const childReads = harness.traces.filter((row) => row.startsWith('query:children:')).length;
    assert.ok(childReads <= 2, `command-path no-op child reads ${childReads}`);
    assert.equal(harness.traces.filter((row) => row.startsWith('move:')).length, 0);
  } finally {
    harness.restore();
  }
});

test('Tidy command path serializes a second shortcut and keeps the first Undo token', async () => {
  const extension = await loadExtension();
  const harness = commandPathHarness(extension);
  try {
    const first = await harness.command.callback();
    assert.equal(first.changed, true);
    const childReadsAfterFirst = harness.traces.filter((row) => row.startsWith('query:children:')).length;
    const second = await harness.command.callback();
    assert.equal(second.ok, true);
    assert.equal(second.changed, false);
    const undone = await harness.planTidy.undo({
      planUid: 'plan',
      token: first.token,
      language: 'en',
    });
    assert.equal(undone.ok, true);
    assert.deepEqual(harness.childrenOf('plan').map((row) => row.uid), [
      'active-a',
      'done-a',
      'divider',
      'past-event',
      'active-b',
    ]);
    assert.ok(childReadsAfterFirst >= 1);
  } finally {
    harness.restore();
  }
});

test('Tidy command path stops on concurrent reorder and does not mint Undo', async () => {
  const extension = await loadExtension();
  const harness = commandPathHarness(extension);
  try {
    harness.hooks.afterMove = async (uid) => {
      if (uid !== 'done-a') return;
      harness.mutate((rows) => {
        const next = rows.slice();
        const from = next.findIndex((row) => row.uid === 'active-b');
        next.splice(1, 0, next.splice(from, 1)[0]);
        return next;
      });
    };
    const result = await harness.command.callback();
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'failed');
    assert.equal(result.token, undefined);
    assert.equal(harness.actions.length, 0);
    assert.match(result.error?.message || '', /Plan changed during Tidy/);
  } finally {
    harness.restore();
  }
});

test('Tidy command path destroy after first move does not continue writing', async () => {
  const extension = await loadExtension();
  const harness = commandPathHarness(extension);
  try {
    harness.hooks.afterMove = async () => {
      harness.planTidy.destroy();
    };
    const result = await harness.command.callback();
    assert.equal(result.ok, false);
    assert.equal(harness.traces.filter((row) => row.startsWith('move:')).length, 1);
    const follow = await harness.command.callback();
    assert.equal(follow.ok, false);
    assert.equal(harness.traces.filter((row) => row.startsWith('move:')).length, 1);
  } finally {
    harness.restore();
  }
});

test('Tidy command path second-move failure does not mint Undo', async () => {
  const extension = await loadExtension();
  const harness = commandPathHarness(extension);
  try {
    let moves = 0;
    harness.hooks.beforeMove = async () => {
      moves += 1;
      if (moves === 2) throw new Error('injected second move failure');
    };
    const result = await harness.command.callback();
    assert.equal(result.ok, false);
    assert.equal(result.partial, true);
    assert.equal(result.token, undefined);
    assert.equal(harness.actions.length, 0);
  } finally {
    harness.restore();
  }
});

test('Tidy command path Undo partial failure expires the token', async () => {
  const extension = await loadExtension();
  const harness = commandPathHarness(extension);
  try {
    const first = await harness.command.callback();
    assert.equal(first.ok, true);
    let undoMoves = 0;
    harness.hooks.beforeMove = async () => {
      undoMoves += 1;
      if (undoMoves === 2) throw new Error('injected undo second move failure');
    };
    const undone = await harness.actions[0].onAction();
    assert.equal(undone.ok, false);
    assert.equal(undone.reason, 'failed');
    assert.notEqual(undone.reason, 'changed');
    const retry = await harness.planTidy.undo({
      planUid: 'plan',
      token: first.token,
      language: 'en',
    });
    assert.equal(retry.ok, false);
    assert.equal(retry.reason, 'expired');
  } finally {
    harness.restore();
  }
});

test('Tidy command path never moves the running CLOCK owner', async () => {
  const extension = await loadExtension();
  const harness = commandPathHarness(extension, { runningUid: 'done-a' });
  try {
    const result = await harness.command.callback();
    assert.equal(result.ok, true);
    assert.deepEqual(harness.childrenOf('plan').map((row) => row.uid), [
      'past-event',
      'active-a',
      'done-a',
      'divider',
      'active-b',
    ]);
    assert.equal(harness.traces.some((row) => row.startsWith('move:done-a:')), false);
  } finally {
    harness.restore();
  }
});

test('Tidy command awaits a thenable resolveTarget before tidy', async () => {
  const extension = await loadExtension();
  const tidyCalls = [];
  let releaseTarget;
  const gate = new Promise((resolve) => {
    releaseTarget = resolve;
  });
  let tidyStarted = 0;
  const commands = extension.createTidyCommands({
    extensionAPI: {},
    resolveTarget: () => gate.then(() => ({
      planUid: 'plan-a',
      settledUids: ['done-a'],
      language: 'en',
    })),
    tidy: async (options) => {
      tidyStarted += 1;
      tidyCalls.push(options);
      return { ok: true, changed: false };
    },
  });
  const pending = commands.run();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(tidyStarted, 0);
  releaseTarget();
  const result = await pending;
  assert.equal(tidyStarted, 1);
  assert.deepEqual(tidyCalls, [{
    planUid: 'plan-a',
    settledUids: ['done-a'],
    language: 'en',
  }]);
  assert.equal(result.ok, true);
});

test('Tidy command reports failed when resolveTarget throws and does not call tidy', async () => {
  const extension = await loadExtension();
  const tidyCalls = [];
  const notices = [];
  const commands = extension.createTidyCommands({
    extensionAPI: {},
    resolveTarget: () => {
      throw new Error('injected resolveTarget throw');
    },
    tidy: async (options) => {
      tidyCalls.push(options);
      return { ok: true };
    },
    notify: (message) => notices.push(message),
  });
  const result = await commands.run();
  assert.equal(result.ok, false);
  assert.equal(result.changed, false);
  assert.equal(result.reason, 'failed');
  assert.equal(tidyCalls.length, 0);
  assert.match(notices[0] || '', /injected resolveTarget throw/);
});

test('Tidy command path overlapping shortcuts wait and the second no-op keeps the first Undo token', async () => {
  const extension = await loadExtension();
  const harness = commandPathHarness(extension);
  try {
    let releaseFirstMove;
    const firstMoveGate = new Promise((resolve) => {
      releaseFirstMove = resolve;
    });
    let moveStarts = 0;
    harness.hooks.beforeMove = async () => {
      moveStarts += 1;
      if (moveStarts === 1) await firstMoveGate;
    };
    const first = harness.command.callback();
    while (moveStarts === 0) await new Promise((resolve) => setImmediate(resolve));
    const second = harness.command.callback();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(moveStarts, 1);
    releaseFirstMove();
    const [firstResult, secondResult] = await Promise.all([first, second]);
    assert.equal(firstResult.ok, true);
    assert.equal(firstResult.changed, true);
    assert.equal(Boolean(firstResult.token), true);
    assert.equal(secondResult.ok, true);
    assert.equal(secondResult.changed, false);
    const undone = await harness.planTidy.undo({
      planUid: 'plan',
      token: firstResult.token,
      language: 'en',
    });
    assert.equal(undone.ok, true);
    assert.deepEqual(harness.childrenOf('plan').map((row) => row.uid), [
      'active-a',
      'done-a',
      'divider',
      'past-event',
      'active-b',
    ]);
  } finally {
    harness.restore();
  }
});

test('Tidy command path fail-closes without Web Locks and does not write', async () => {
  const extension = await loadExtension();
  const harness = commandPathHarness(extension, { useNativeLocks: false });
  try {
    const before = harness.childrenOf('plan').map((row) => row.uid);
    const result = await harness.command.callback();
    assert.equal(result.ok, false);
    assert.equal(result.changed, false);
    assert.equal(harness.traces.filter((row) => row.startsWith('move:')).length, 0);
    assert.deepEqual(harness.childrenOf('plan').map((row) => row.uid), before);
  } finally {
    harness.restore();
  }
});
