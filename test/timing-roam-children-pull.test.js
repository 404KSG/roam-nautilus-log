const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createManagedGraph } = require('./managed-template-graph.cjs');
const { installTestHostLocks } = require('./test-host-locks.cjs');

const PLAN = '[[Nautilus Log]] {{[[roam/render]]:((roam-render-Nautilus-Log-cljs))}}';
const PAGE_TITLE = 'August 22nd, 2026';
const DATE = new Date(2026, 7, 22, 10, 0);
const CHILDREN_QUERY_MARKER = '?uid ?string ?order ?open';
const DAILY_TREE_MARKER = '?page-uid ?uid ?string ?order ?parent-uid';
const EVIDENCE_DIR = '/tmp/nautilus-children-pull-eea7b74e';

const CHILDREN_PULL_WALL_MS = 120000;
const childrenPullWallTimer = setTimeout(() => {
  console.error('[nautilus-log] children-pull tests exceeded 120s wall timeout');
  process.exit(1);
}, CHILDREN_PULL_WALL_MS);
childrenPullWallTimer.unref();

async function loadExtension() {
  const bundle = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}#children-pull-${Date.now()}-${Math.random()}`);
}

function keyNames(style) {
  if (style === 'plain') {
    return {
      uid: 'block/uid',
      string: 'block/string',
      order: 'block/order',
      open: 'block/open',
      children: 'block/children',
    };
  }
  return {
    uid: ':block/uid',
    string: ':block/string',
    order: ':block/order',
    open: ':block/open',
    children: ':block/children',
  };
}

function isChildrenPullPattern(pattern) {
  return typeof pattern === 'string'
    && pattern.includes(':block/children')
    && pattern.includes(':block/open')
    && !pattern.includes(':block/_children')
    && !pattern.includes(':block/_page');
}

function projectChildrenEntity(parentUid, children, {
  style = 'colon',
  omitChildrenKey = false,
  entityUid = parentUid,
} = {}) {
  const keys = keyNames(style);
  const entity = { [keys.uid]: entityUid };
  if (!omitChildrenKey) {
    entity[keys.children] = children.map((child) => {
      const node = {};
      if (child.uid !== undefined) node[keys.uid] = child.uid;
      if (child.string !== undefined) node[keys.string] = child.string;
      if (child.order !== undefined) node[keys.order] = child.order;
      if (child.open !== undefined) node[keys.open] = child.open;
      return node;
    });
  }
  return entity;
}

function datalogChildren(children) {
  return children
    .filter((child) => child.uid !== undefined && child.string !== undefined && child.order !== undefined)
    .map((child) => [
      child.uid,
      child.string,
      child.order,
      child.open === undefined ? false : child.open,
    ]);
}

function expectedProjection(children) {
  return datalogChildren(children)
    .map(([uid, string, order, open]) => ({
      uid,
      string,
      order,
      open: open === true,
    }))
    .filter((child) => child.uid && typeof child.string === 'string')
    .sort((left, right) => left.order - right.order);
}

function normalChildren(count = 24) {
  return Array.from({ length: count }, (_, index) => ({
    uid: `c${index}`,
    string: index % 5 === 0 ? `{{[[TODO]]}} Item ${index}` : `note-${index}`,
    order: index,
    ...(index % 3 === 0 ? {} : { open: index % 2 === 0 }),
  }));
}

function createChildrenHost({
  parentUid = 'plan',
  children = normalChildren(3),
  parentExists = true,
  pullMode = 'fast',
  pullStyle = 'colon',
  queryMode = 'datalog',
  extraParents = {},
} = {}) {
  const traces = [];
  const store = {
    [parentUid]: children.map((child) => ({ ...child })),
    ...Object.fromEntries(Object.entries(extraParents).map(([uid, rows]) => [uid, rows.map((row) => ({ ...row }))])),
  };

  const q = (query, ...args) => {
    if (query.includes(DAILY_TREE_MARKER)) {
      traces.push('query:plan');
      return [];
    }
    if (query.includes(CHILDREN_QUERY_MARKER)) {
      traces.push(`query:children:${args[0]}`);
      if (queryMode === 'throw') throw new Error('injected children query failure');
      if (queryMode === 'malformed') return [[null]];
      if (!parentExists && args[0] === parentUid) return [];
      return datalogChildren(store[args[0]] || []);
    }
    if (query.includes(':find ?s')) {
      traces.push(`query:string:${args[0]}`);
      return [];
    }
    traces.push('query:other');
    return [];
  };

  const pull = (pattern, lookup) => {
    const lookupKey = lookup?.[0];
    const lookupVal = lookup?.[1];
    traces.push(`pull:${lookupKey}:${lookupVal}`);
    if (pullMode === 'throw') throw new Error('injected children pull failure');
    if (pullMode === 'unsupported') throw new Error('children pull pattern unsupported');
    if (typeof pattern === 'string' && (pattern.includes(':block/_page') || pattern.includes('block/_page'))) {
      traces.push('pull:daily-tree');
      return null;
    }
    if (!isChildrenPullPattern(pattern)) {
      traces.push('pull:other');
      return null;
    }
    traces.push(`pull:children:${lookupVal}`);
    if (pullMode === 'none') return undefined;
    if (pullMode === 'null') return null;
    if (pullMode === 'thenable') {
      return Promise.reject(new Error('async pull is not in the production contract'));
    }
    if (pullMode === 'thenable-resolve') {
      return Promise.resolve(projectChildrenEntity(parentUid, store[parentUid] || [], { style: pullStyle }));
    }
    if (pullMode === 'non-object') return 42;
    if (lookupKey !== ':block/uid' && lookupKey !== 'block/uid') return null;
    if (!parentExists && lookupVal === parentUid) return null;
    const rows = store[lookupVal];
    if (!rows && lookupVal !== parentUid) return null;
    if (pullMode === 'mismatch') {
      return projectChildrenEntity(parentUid, rows || [], { style: pullStyle, entityUid: 'other-parent' });
    }
    if (pullMode === 'missing-children-key') {
      return projectChildrenEntity(lookupVal, rows || [], { style: pullStyle, omitChildrenKey: true });
    }
    if (pullMode === 'children-null') {
      const keys = keyNames(pullStyle);
      return { [keys.uid]: lookupVal, [keys.children]: null };
    }
    return projectChildrenEntity(lookupVal, rows || [], { style: pullStyle });
  };

  const roam = {
    graph: { name: 'children-pull-host' },
    util: { dateToPageTitle: () => PAGE_TITLE },
    q,
    data: { q, pull },
  };

  return { roam, traces, store, parentUid, q, pull };
}

function installHost(roam) {
  const previous = global.window;
  global.window = { roamAlphaAPI: roam, setInterval: () => 1, clearInterval() {}, setTimeout, clearTimeout };
  installTestHostLocks(global.window);
  return () => {
    if (previous === undefined) delete global.window;
    else global.window = previous;
  };
}

function childQueryCount(traces) {
  return traces.filter((row) => typeof row === 'string' && row.startsWith('query:children:')).length;
}

function childPullCount(traces) {
  return traces.filter((row) => typeof row === 'string' && row.startsWith('pull:children:')).length;
}

function managedChildQueryCount(trace) {
  return trace.filter((row) => row[0] === 'query' && String(row[1]).includes(CHILDREN_QUERY_MARKER)).length;
}

function withPullAndFallback(children, visit, extras = {}) {
  for (const pullMode of ['fast', 'none']) {
    const host = createChildrenHost({ children, pullMode, ...extras });
    if (pullMode === 'none') delete host.roam.data.pull;
    const restore = installHost(host.roam);
    try {
      visit(host, pullMode);
    } finally {
      restore();
    }
  }
}

async function withUnhandledRejectionGuard(visit) {
  const seen = [];
  const onUnhandled = (reason) => { seen.push(reason); };
  process.on('unhandledRejection', onUnhandled);
  try {
    await visit();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(seen.length, 0, `unhandled rejections: ${seen.map((row) => row?.message || row).join('; ')}`);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
}

function meeting(overrides = {}) {
  return {
    key: 'primary:meeting-1',
    calendarId: 'primary',
    eventId: 'meeting-1',
    status: 'confirmed',
    parentString: '09:30–10:00 Weekly meeting · Google Calendar',
    sourceString: 'Google Calendar · Work · [Open](https://calendar.google.com/event)',
    details: {
      location: 'Meeting Room 3',
      description: 'Review Q3 launch plan.',
    },
    ...overrides,
  };
}

function calendarGraph() {
  let generated = 0;
  let state = { version: 1, events: {} };
  let journal = null;
  const hooks = {};
  const writes = [];
  const blocks = new Map([
    ['plan-today', { uid: 'plan-today', parentUid: 'page', order: 0, string: PLAN, open: true }],
    ['plan-tomorrow', { uid: 'plan-tomorrow', parentUid: 'page-2', order: 0, string: PLAN, open: true }],
  ]);
  const childrenOf = (uid) => [...blocks.values()]
    .filter((block) => block.parentUid === uid)
    .sort((left, right) => Number(left.order) - Number(right.order));
  return {
    blocks,
    hooks,
    writes,
    childrenOf,
    create: async ({ parentUid, order = 'last', string, uid: requestedUid }) => {
      const uid = requestedUid || `calendar-${++generated}`;
      writes.push(['create', uid]);
      await hooks.beforeCreate?.({ uid, parentUid, string });
      if (blocks.has(uid)) throw new Error('Duplicate UID');
      if (!blocks.has(parentUid)) throw new Error('Missing parent');
      blocks.set(uid, {
        uid,
        parentUid,
        order: order === 'last' ? childrenOf(parentUid).length : order,
        string,
        open: false,
      });
      await hooks.afterCreate?.({ uid, parentUid, string });
      return uid;
    },
    update: async (uid, string) => {
      writes.push(['update', uid]);
      if (!blocks.has(uid)) throw new Error('Missing UID');
      blocks.set(uid, { ...blocks.get(uid), string });
    },
    remove: async (uid) => {
      writes.push(['remove', uid]);
      const stack = [uid];
      while (stack.length) {
        const current = stack.pop();
        for (const child of childrenOf(current)) stack.push(child.uid);
        blocks.delete(current);
      }
    },
    move: async ({ uid, parentUid, order }) => {
      writes.push(['move', uid]);
      await hooks.afterMove?.(uid);
      blocks.set(uid, { ...blocks.get(uid), parentUid, order });
    },
    read: (uid) => blocks.get(uid)?.string ?? null,
    loadState: () => structuredClone(state),
    saveState: async (next) => { state = structuredClone(next); },
    loadJournal: () => structuredClone(journal),
    saveJournal: async (next) => { journal = structuredClone(next); },
    state: () => structuredClone(state),
    journal: () => structuredClone(journal),
  };
}

function installCalendarChildrenHost(graph, { pullMode = 'fast' } = {}) {
  const traces = [];
  const q = (query, ...args) => {
    if (query.includes(CHILDREN_QUERY_MARKER)) {
      traces.push(`query:children:${args[0]}`);
      return graph.childrenOf(args[0]).map((block) => [
        block.uid,
        block.string,
        block.order,
        block.open === true,
      ]);
    }
    if (query.includes(':find ?s')) {
      const block = graph.blocks.get(args[0]);
      return block ? [[block.string]] : [];
    }
    traces.push('query:other');
    return [];
  };
  const pull = (pattern, lookup) => {
    const lookupVal = lookup?.[1];
    traces.push(`pull:${lookup?.[0]}:${lookupVal}`);
    if (pullMode === 'none') return undefined;
    if (isChildrenPullPattern(pattern)) {
      traces.push(`pull:children:${lookupVal}`);
      const block = graph.blocks.get(lookupVal);
      if (!block) return null;
      return {
        ':block/uid': block.uid,
        ':block/children': graph.childrenOf(block.uid).map((child) => ({
          ':block/uid': child.uid,
          ':block/string': child.string,
          ':block/order': child.order,
          ':block/open': child.open === true,
        })),
      };
    }
    const block = graph.blocks.get(lookupVal);
    return block ? { ':block/uid': block.uid, ':block/string': block.string } : null;
  };
  const roam = {
    graph: { name: 'calendar-children-host' },
    q,
    data: { q, pull },
  };
  if (pullMode === 'none') delete roam.data.pull;
  const restore = installHost(roam);
  return { traces, restore, roam };
}

function tidyCommandHarness(extension, { rows } = {}) {
  const blocks = new Map();
  blocks.set('plan', { uid: 'plan', string: PLAN, parentUid: 'page', order: 0, open: true });
  blocks.set('page', { uid: 'page', string: PAGE_TITLE, parentUid: null, order: 0, open: true });
  (rows || [
    { uid: 'active-a', string: '{{[[TODO]]}} Alpha 15m', open: true },
    { uid: 'done-a', string: '{{[[DONE]]}} Done A 15m', open: true },
    { uid: 'divider', string: '---', open: false },
    { uid: 'past-event', string: '{{[[DONE]]}} 05:00-06:00 Event', open: false },
    { uid: 'active-b', string: '{{[[TODO]]}} Beta 15m', open: true },
  ]).forEach((row, order) => {
    blocks.set(row.uid, {
      uid: row.uid,
      string: row.string,
      parentUid: 'plan',
      order,
      open: row.open === true,
    });
  });
  const childrenOf = (parentUid) => [...blocks.values()]
    .filter((block) => block.parentUid === parentUid)
    .sort((left, right) => Number(left.order) - Number(right.order));
  const traces = [];
  const notices = [];
  const actions = [];
  const q = (query, ...args) => {
    if (query.includes(DAILY_TREE_MARKER)) {
      traces.push('query:plan');
      return [...blocks.values()]
        .filter((block) => block.uid !== 'page')
        .map((block) => ['page', block.uid, block.string, block.order, block.parentUid]);
    }
    if (query.includes(CHILDREN_QUERY_MARKER)) {
      traces.push(`query:children:${args[0]}`);
      return childrenOf(args[0]).map((block) => [block.uid, block.string, block.order, block.open === true]);
    }
    traces.push('query:other');
    return [];
  };
  const roam = {
    graph: { name: 'children-tidy-host' },
    util: { dateToPageTitle: () => PAGE_TITLE },
    q,
    data: {
      q,
      pull: (pattern, lookup) => {
        const lookupVal = lookup?.[1];
        traces.push(`pull:${lookup?.[0] || ''}:${lookupVal || ''}`);
        if (typeof pattern === 'string' && (pattern.includes(':block/_page') || pattern.includes('block/_page'))) {
          traces.push('pull:daily-tree');
          if (lookupVal !== PAGE_TITLE) return null;
          return {
            ':block/uid': 'page',
            ':block/_page': [...blocks.values()].filter((block) => block.uid !== 'page').map((block) => ({
              ':block/uid': block.uid,
              ':block/string': block.string,
              ':block/order': block.order,
              ':block/_children': block.parentUid ? [{ ':block/uid': block.parentUid }] : [],
            })),
          };
        }
        if (isChildrenPullPattern(pattern)) {
          traces.push(`pull:children:${lookupVal || ''}`);
          const block = blocks.get(lookupVal);
          if (!block) return null;
          return {
            ':block/uid': block.uid,
            ':block/children': childrenOf(block.uid).map((child) => ({
              ':block/uid': child.uid,
              ':block/string': child.string,
              ':block/order': child.order,
              ':block/open': child.open === true,
            })),
          };
        }
        const block = blocks.get(lookupVal);
        return block ? { ':block/uid': block.uid, ':block/string': block.string } : null;
      },
      block: {
        move: async ({ location, block }) => {
          traces.push(`move:${block.uid}:${location.order}`);
          const siblings = childrenOf(location['parent-uid']);
          const from = siblings.findIndex((row) => row.uid === block.uid);
          const [row] = siblings.splice(from, 1);
          siblings.splice(location.order, 0, row);
          siblings.forEach((child, index) => {
            child.order = index;
            child.parentUid = location['parent-uid'];
          });
        },
        update: async ({ block }) => {
          traces.push(`setOpen:${block.uid}:${block.open}`);
          const current = blocks.get(block.uid);
          if (block.open !== undefined) current.open = block.open === true;
        },
      },
    },
  };
  roam.moveBlock = (args) => roam.data.block.move(args);
  roam.updateBlock = (args) => roam.data.block.update(args);
  const palette = new Map();
  const restore = installHost(roam);
  const planTidy = extension.createPlanTidy({
    runningTaskUid: () => null,
    notify: (message, intent) => notices.push({ message, intent }),
    notifyAction: (options) => actions.push(options),
  });
  const commands = extension.createTidyCommands({
    extensionAPI: {
      settings: {
        get(key) {
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
    notices,
    actions,
    planTidy,
    commands,
    childrenOf,
    restore() {
      try { commands.destroy(); } catch (_error) { /* ignore */ }
      try { planTidy.destroy(); } catch (_error) { /* ignore */ }
      restore();
    },
  };
}

test('readChildren is exported from the production module', async () => {
  const extension = await loadExtension();
  assert.equal(typeof extension.readChildren, 'function');
});

test('a children-pull host with 24 children must not run the slow children query', async () => {
  const extension = await loadExtension();
  const children = normalChildren(24);
  const host = createChildrenHost({ children });
  const restore = installHost(host.roam);
  try {
    const rows = extension.readChildren('plan');
    assert.deepEqual(rows.map((row) => row.uid), children.map((child) => child.uid));
    assert.equal(rows[0].open, false);
    assert.equal(rows[1].open, false);
    assert.equal(rows[2].open, true);
    assert.equal(childQueryCount(host.traces), 0);
    assert.equal(childPullCount(host.traces), 1);
    assert.equal(host.traces.includes('query:plan'), false);
    assert.equal(host.traces.includes('pull:daily-tree'), false);
  } finally {
    restore();
  }
});

test('an explicit empty children array succeeds as [] without querying', async () => {
  const extension = await loadExtension();
  const host = createChildrenHost({ children: [] });
  const restore = installHost(host.roam);
  try {
    assert.deepEqual(extension.readChildren('plan'), []);
    assert.equal(childQueryCount(host.traces), 0);
    assert.equal(childPullCount(host.traces), 1);
  } finally {
    restore();
  }
});

test('a missing parent falls back to the children query and returns []', async () => {
  const extension = await loadExtension();
  const host = createChildrenHost({ children: [], parentExists: false, pullMode: 'null' });
  const restore = installHost(host.roam);
  try {
    assert.deepEqual(extension.readChildren('plan'), []);
    assert.equal(childQueryCount(host.traces), 1);
    assert.equal(childPullCount(host.traces), 1);
  } finally {
    restore();
  }
});

test('missing :block/open defaults to false on both key styles', async () => {
  const extension = await loadExtension();
  const children = [
    { uid: 'a', string: 'Alpha', order: 1 },
    { uid: 'b', string: 'Beta', order: 0, open: true },
  ];
  for (const pullStyle of ['colon', 'plain']) {
    const host = createChildrenHost({ children, pullStyle });
    const restore = installHost(host.roam);
    try {
      assert.deepEqual(extension.readChildren('plan'), [
        { uid: 'b', string: 'Beta', order: 0, open: true },
        { uid: 'a', string: 'Alpha', order: 1, open: false },
      ]);
      assert.equal(childQueryCount(host.traces), 0, pullStyle);
      assert.equal(childPullCount(host.traces), 1, pullStyle);
    } finally {
      restore();
    }
  }
});

test('missing uid/string/order follow the inner-join omit, not a silent empty page', async () => {
  const extension = await loadExtension();
  const children = [
    { uid: 'keep', string: 'Keep', order: 0, open: true },
    { uid: 'no-string', order: 1, open: true },
    { uid: 'no-order', string: 'No order', open: true },
    { string: 'No uid', order: 3, open: true },
  ];
  withPullAndFallback(children, (host, pullMode) => {
    const rows = extension.readChildren('plan');
    assert.deepEqual(rows, [{ uid: 'keep', string: 'Keep', order: 0, open: true }], pullMode);
    if (pullMode === 'fast') {
      assert.equal(childQueryCount(host.traces), 0);
      assert.equal(childPullCount(host.traces), 1);
    } else {
      assert.equal(childQueryCount(host.traces), 1);
    }
  });
});

test('present malformed uid/string/order stay on the original map-filter contract', async () => {
  const extension = await loadExtension();
  const children = [
    { uid: 'keep', string: 'Keep', order: 2, open: true },
    { uid: 'nan-order', string: 'NaN order', order: Number.NaN, open: true },
    { uid: 'num-string', string: 42, order: 0, open: true },
    { uid: '', string: 'empty uid', order: 1, open: true },
    { uid: 'null-string', string: null, order: 3, open: true },
  ];
  const fastHost = createChildrenHost({ children });
  const slowHost = createChildrenHost({ children, pullMode: 'none' });
  delete slowHost.roam.data.pull;
  const restoreFast = installHost(fastHost.roam);
  let fastRows;
  try { fastRows = extension.readChildren('plan'); } finally { restoreFast(); }
  const restoreSlow = installHost(slowHost.roam);
  let slowRows;
  try { slowRows = extension.readChildren('plan'); } finally { restoreSlow(); }
  assert.deepEqual(fastRows, slowRows);
  assert.equal(fastRows.some((row) => row.uid === 'nan-order' && Number.isNaN(row.order)), true);
  assert.equal(fastRows.some((row) => row.uid === 'num-string'), false);
  assert.equal(fastRows.some((row) => row.uid === 'null-string'), false);
  assert.equal(fastRows.some((row) => row.string === 'empty uid'), false);
  assert.equal(childQueryCount(fastHost.traces), 0);
  assert.equal(childQueryCount(slowHost.traces), 1);
});

test('duplicate child UIDs are preserved so downstream safety can see them', async () => {
  const extension = await loadExtension();
  const children = [
    { uid: 'dup', string: 'First', order: 1, open: false },
    { uid: 'dup', string: 'Second', order: 0, open: true },
  ];
  const host = createChildrenHost({ children });
  const restore = installHost(host.roam);
  try {
    const rows = extension.readChildren('plan');
    assert.deepEqual(rows.map((row) => row.string), ['Second', 'First']);
    assert.equal(rows.length, 2);
    assert.equal(childQueryCount(host.traces), 0);
    const tidy = extension.createPlanTidy({
      read: extension.readChildren,
      move: async () => {},
      setOpen: async () => {},
      notify() {},
      notifyAction() {},
      runExclusive: (operation) => operation(),
    });
    const result = await tidy.run({ planUid: 'plan', settledUids: [], language: 'en' });
    assert.equal(result.ok, false);
    assert.match(result.error?.message || '', /unreadable/i);
    tidy.destroy();
  } finally {
    restore();
  }
});

test('a parent entity uid mismatch falls back instead of projecting foreign children', async () => {
  const extension = await loadExtension();
  const host = createChildrenHost({
    children: [{ uid: 'foreign', string: 'Foreign', order: 0, open: true }],
    pullMode: 'mismatch',
  });
  const restore = installHost(host.roam);
  try {
    const rows = extension.readChildren('plan');
    assert.deepEqual(rows, [{ uid: 'foreign', string: 'Foreign', order: 0, open: true }]);
    assert.equal(childQueryCount(host.traces), 1);
    assert.equal(childPullCount(host.traces), 1);
  } finally {
    restore();
  }
});

test('a missing children key falls back rather than succeeding as empty', async () => {
  const extension = await loadExtension();
  const children = [{ uid: 'keep', string: 'Keep', order: 0, open: true }];
  const host = createChildrenHost({ children, pullMode: 'missing-children-key' });
  const restore = installHost(host.roam);
  try {
    assert.deepEqual(extension.readChildren('plan'), expectedProjection(children));
    assert.equal(childQueryCount(host.traces), 1);
  } finally {
    restore();
  }
});

test('thenable pull rejects without unhandled rejection and falls back', async () => {
  const extension = await loadExtension();
  await withUnhandledRejectionGuard(async () => {
    const host = createChildrenHost({
      children: [{ uid: 'keep', string: 'Keep', order: 0, open: true }],
      pullMode: 'thenable',
    });
    const restore = installHost(host.roam);
    try {
      assert.deepEqual(extension.readChildren('plan'), [{ uid: 'keep', string: 'Keep', order: 0, open: true }]);
      assert.equal(childQueryCount(host.traces), 1);
      assert.equal(childPullCount(host.traces), 1);
    } finally {
      restore();
    }
  });
});

test('resolved thenable pull also falls back without unhandled rejection', async () => {
  const extension = await loadExtension();
  await withUnhandledRejectionGuard(async () => {
    const host = createChildrenHost({
      children: [{ uid: 'keep', string: 'Keep', order: 0, open: true }],
      pullMode: 'thenable-resolve',
    });
    const restore = installHost(host.roam);
    try {
      assert.deepEqual(extension.readChildren('plan'), [{ uid: 'keep', string: 'Keep', order: 0, open: true }]);
      assert.equal(childQueryCount(host.traces), 1);
    } finally {
      restore();
    }
  });
});

test('unsupported pull exceptions fall back to the children query', async () => {
  const extension = await loadExtension();
  const host = createChildrenHost({
    children: [{ uid: 'keep', string: 'Keep', order: 0, open: true }],
    pullMode: 'unsupported',
  });
  const restore = installHost(host.roam);
  try {
    assert.deepEqual(extension.readChildren('plan'), [{ uid: 'keep', string: 'Keep', order: 0, open: true }]);
    assert.equal(childQueryCount(host.traces), 1);
  } finally {
    restore();
  }
});

test('fallback query failures still propagate', async () => {
  const extension = await loadExtension();
  const host = createChildrenHost({
    children: [{ uid: 'keep', string: 'Keep', order: 0, open: true }],
    pullMode: 'null',
    queryMode: 'throw',
  });
  const restore = installHost(host.roam);
  try {
    assert.throws(() => extension.readChildren('plan'), /injected children query failure/);
    assert.equal(childQueryCount(host.traces), 1);
  } finally {
    restore();
  }
});

test('null, non-object, and missing pull function fall back instead of returning empty', async () => {
  const extension = await loadExtension();
  const children = [{ uid: 'keep', string: 'Keep', order: 0, open: true }];
  for (const pullMode of ['null', 'non-object', 'none']) {
    const host = createChildrenHost({ children, pullMode });
    if (pullMode === 'none') delete host.roam.data.pull;
    const restore = installHost(host.roam);
    try {
      assert.deepEqual(extension.readChildren('plan'), expectedProjection(children), pullMode);
      assert.equal(childQueryCount(host.traces), 1, pullMode);
    } finally {
      restore();
    }
  }
});

test('legacy roam.pull is used when data.pull is absent', async () => {
  const extension = await loadExtension();
  const host = createChildrenHost({
    children: [{ uid: 'keep', string: 'Keep', order: 0, open: true }],
  });
  host.roam.pull = host.roam.data.pull;
  delete host.roam.data.pull;
  const restore = installHost(host.roam);
  try {
    assert.deepEqual(extension.readChildren('plan'), [{ uid: 'keep', string: 'Keep', order: 0, open: true }]);
    assert.equal(childQueryCount(host.traces), 0);
    assert.equal(childPullCount(host.traces), 1);
  } finally {
    restore();
  }
});

test('each readChildren call pulls live and does not reuse prior rows after writes', async () => {
  const extension = await loadExtension();
  const host = createChildrenHost({
    children: [{ uid: 'a', string: 'A', order: 0, open: true }],
  });
  const restore = installHost(host.roam);
  try {
    assert.deepEqual(extension.readChildren('plan').map((row) => row.uid), ['a']);
    host.store.plan.push({ uid: 'b', string: 'B', order: 1, open: false });
    host.traces.length = 0;
    const second = extension.readChildren('plan');
    assert.deepEqual(second.map((row) => row.uid), ['a', 'b']);
    assert.equal(childQueryCount(host.traces), 0);
    assert.equal(childPullCount(host.traces), 1);
    await Promise.resolve();
    host.store.plan[0].string = 'A-after-await';
    const third = extension.readChildren('plan');
    assert.equal(third[0].string, 'A-after-await');
  } finally {
    restore();
  }
});

test('falsy uid short-circuits without querying or pulling', async () => {
  const extension = await loadExtension();
  const host = createChildrenHost({ children: normalChildren(1) });
  const restore = installHost(host.roam);
  try {
    assert.deepEqual(extension.readChildren(''), []);
    assert.deepEqual(extension.readChildren(null), []);
    assert.equal(host.traces.length, 0);
  } finally {
    restore();
  }
});

test('managed graph fixture serves children pull with zero children queries', async () => {
  const extension = await loadExtension();
  const graph = createManagedGraph();
  const restore = installHost(graph.roam);
  try {
    const rows = extension.readChildren('source-root');
    assert.ok(rows.length >= 3);
    assert.equal(rows.every((row) => row.uid && typeof row.string === 'string'), true);
    assert.equal(managedChildQueryCount(graph.trace), 0);
    assert.ok(graph.trace.some((row) => row[0] === 'pull' && row[2] === 'source-root'));
  } finally {
    restore();
  }
});

test('managed graph fixture fallback runs exactly one children query', async () => {
  const extension = await loadExtension();
  const graph = createManagedGraph();
  delete graph.roam.data.pull;
  const restore = installHost(graph.roam);
  try {
    const rows = extension.readChildren('source-root');
    assert.ok(rows.length >= 3);
    assert.equal(managedChildQueryCount(graph.trace), 1);
  } finally {
    restore();
  }
});

test('commandPalette default readPrimaryPlan and readChildren fast path tidies, confirms, and Undoes', async () => {
  const extension = await loadExtension();
  const harness = tidyCommandHarness(extension);
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
    assert.equal(harness.childrenOf('plan').find((row) => row.uid === 'done-a').open, false);
    assert.equal(harness.traces.filter((row) => row === 'query:plan').length, 0);
    assert.equal(childQueryCount(harness.traces), 0);
    assert.ok(harness.traces.includes('pull:daily-tree'));
    assert.ok(childPullCount(harness.traces) >= 1);
    assert.equal(harness.traces.filter((row) => row.startsWith('move:')).length >= 1, true);
    assert.equal(harness.traces.some((row) => row.startsWith('setOpen:done-a:')), true);
    const undone = await harness.planTidy.undo({
      planUid: 'plan',
      token: result.token,
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
    assert.equal(childQueryCount(harness.traces), 0);
  } finally {
    harness.restore();
  }
});

test('Calendar reconciler default readChildren fast path keeps journal, ownership, and failure recovery', async () => {
  const extension = await loadExtension();
  const graph = calendarGraph();
  const host = installCalendarChildrenHost(graph);
  try {
    const { childrenOf, ...adapters } = graph;
    void childrenOf;
    let calls = 0;
    graph.hooks.beforeCreate = () => {
      calls += 1;
      if (calls === 2) throw new Error('injected source failure');
    };
    const first = extension.createCalendarReconciler(adapters);
    await assert.rejects(first.sync({ planUid: 'plan-today', events: [meeting()] }));
    assert.ok(graph.journal());
    const parent = graph.childrenOf('plan-today')[0].uid;
    delete graph.hooks.beforeCreate;
    host.traces.length = 0;
    const recovered = extension.createCalendarReconciler(adapters);
    await recovered.sync({ planUid: 'plan-today', events: [meeting()] });
    assert.deepEqual(graph.childrenOf('plan-today').map((row) => row.uid), [parent]);
    assert.equal(graph.journal(), null);
    assert.equal(childQueryCount(host.traces), 0);
    assert.ok(childPullCount(host.traces) >= 1);

    let stale = { version: 2, events: {} };
    const writes = graph.writes.length;
    host.traces.length = 0;
    const other = extension.createCalendarReconciler({
      ...adapters,
      loadState: () => stale,
      saveState: async (next) => { stale = structuredClone(next); },
      loadJournal: () => null,
      saveJournal: async () => {},
    });
    await assert.rejects(
      other.sync({ planUid: 'plan-today', events: [meeting()] }),
      /occupied|precondition/i,
    );
    assert.equal(graph.childrenOf('plan-today').length, 1);
    assert.equal(graph.writes.length, writes);
    assert.equal(childQueryCount(host.traces), 0);
  } finally {
    host.restore();
  }
});

test('synthetic children sizes compare pull+projection API cost against Datalog fallback', async () => {
  const extension = await loadExtension();
  const evidence = { sizes: [] };
  for (const size of [15, 50, 100, 400]) {
    const children = normalChildren(size);
    const fastHost = createChildrenHost({ children });
    const slowHost = createChildrenHost({ children, pullMode: 'none' });
    delete slowHost.roam.data.pull;
    const restoreFast = installHost(fastHost.roam);
    const fastStarted = performance.now();
    let fastRows;
    try { fastRows = extension.readChildren('plan'); } finally { restoreFast(); }
    const fastMs = performance.now() - fastStarted;
    const restoreSlow = installHost(slowHost.roam);
    const slowStarted = performance.now();
    let slowRows;
    try { slowRows = extension.readChildren('plan'); } finally { restoreSlow(); }
    const slowMs = performance.now() - slowStarted;
    assert.deepEqual(fastRows, slowRows);
    assert.equal(childQueryCount(fastHost.traces), 0);
    assert.equal(childPullCount(fastHost.traces), 1);
    assert.equal(childQueryCount(slowHost.traces), 1);
    evidence.sizes.push({
      size,
      rows: fastRows.length,
      fastChildQueries: childQueryCount(fastHost.traces),
      fastChildPulls: childPullCount(fastHost.traces),
      fastApiCalls: fastHost.traces.length,
      fallbackChildQueries: childQueryCount(slowHost.traces),
      fallbackApiCalls: slowHost.traces.length,
      fastMs: Number(fastMs.toFixed(3)),
      fallbackMs: Number(slowMs.toFixed(3)),
      note: 'Node API+projection cost only; not a live Roam measurement',
    });
  }
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(`${EVIDENCE_DIR}/synthetic-sizes.json`, `${JSON.stringify(evidence, null, 2)}\n`);
  assert.equal(evidence.sizes.length, 4);
});
