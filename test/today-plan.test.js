const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const COMPONENT = '{{[[roam/render]]:((roam-render-Nautilus-Log-cljs)) 22 15 5 "" 21}}';
const LEGACY = '{{[[roam/render]]:((roam-render-Nautilus-cljs)) 22 15 5 "" 21}}';
const FLOW = '{{[[roam/render]]:((roam-render-Nautilus-Flow-cljs)) 22 15 5 "" 21}}';

function roamTitle(date) {
  const month = date.toLocaleString('en-US', { month: 'long' });
  const day = date.getDate();
  const ordinal = day % 10 === 1 && day % 100 !== 11
    ? 'st'
    : day % 10 === 2 && day % 100 !== 12
      ? 'nd'
      : day % 10 === 3 && day % 100 !== 13 ? 'rd' : 'th';
  return `${month} ${day}${ordinal}, ${date.getFullYear()}`;
}

async function loadExtension() {
  const bundle = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}#today-plan-${Date.now()}-${Math.random()}`);
}

function createGraph({ title = 'September 9th, 2026' } = {}) {
  const pages = new Map();
  const blocks = new Map();
  const trace = [];
  let generated = 0;
  let createBlockImpl = null;
  let openBlockImpl = null;
  const uids = [];

  const pageUidOf = (block) => {
    let current = block;
    const seen = new Set();
    while (current?.parentUid && !seen.has(current.uid)) {
      seen.add(current.uid);
      if ([...pages.values()].includes(current.parentUid)) return current.parentUid;
      current = blocks.get(current.parentUid);
    }
    return null;
  };

  const children = (parentUid) => [...blocks.values()]
    .filter((block) => block.parentUid === parentUid)
    .sort((left, right) => Number(left.order) - Number(right.order));

  const defaultCreateBlock = async ({ location, block }) => {
    const parentUid = location['parent-uid'];
    blocks.set(block.uid, {
      uid: block.uid,
      string: block.string,
      open: block.open,
      parentUid,
      order: location.order === 'last' ? children(parentUid).length : location.order,
    });
    trace.push(['createBlock', parentUid, block.string, block.uid, location.order]);
  };
  createBlockImpl = defaultCreateBlock;

  const roam = {
    graph: { name: 'test-graph' },
    util: {
      generateUID: () => {
        const uid = uids.shift() || `plan-${++generated}`;
        return uid;
      },
      dateToPageTitle: (date) => roamTitle(date instanceof Date ? date : new Date(date)),
      dateToPageUid: (date) => `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}-${date.getFullYear()}`,
    },
    q: (query, ...args) => {
      if (query.includes('?clock-uid ?clock-string')) {
        trace.push(['query:entries']);
        return [];
      }
      if (query.includes('?page-uid ?uid ?string ?order ?parent-uid')) {
        trace.push(['query:plan', args[0]]);
        const pageUid = pages.get(args[0]);
        if (!pageUid) return [];
        return [...blocks.values()]
          .filter((block) => pageUidOf(block) === pageUid)
          .map((block) => [pageUid, block.uid, block.string, block.order, block.parentUid]);
      }
      if (query.includes('[?e :node/title ?page-title]') && query.includes('[?e :block/uid ?uid]')) {
        trace.push(['query:pageUid', args[0]]);
        const uid = pages.get(args[0]);
        return uid ? [[uid]] : [];
      }
      return [];
    },
    data: {
      pull: (_pattern, lookup) => {
        const uid = lookup?.[1];
        trace.push(['pull', uid]);
        if (blocks.has(uid)) return { ':block/uid': uid, ':block/string': blocks.get(uid).string };
        if ([...pages.values()].includes(uid)) return { ':block/uid': uid };
        return null;
      },
      page: {
        create: async ({ page }) => {
          trace.push(['createPage', page.title, page.uid]);
          pages.set(page.title, page.uid);
        },
      },
      block: {
        create: async (payload) => createBlockImpl(payload),
        delete: async ({ block }) => {
          trace.push(['deleteBlock', block.uid]);
          blocks.delete(block.uid);
        },
      },
    },
    ui: {
      mainWindow: {
        openBlock: async ({ block }) => {
          trace.push(['openBlock', block.uid]);
          if (openBlockImpl) await openBlockImpl(block);
        },
      },
      rightSidebar: {
        addWindow: async ({ window }) => {
          trace.push(['addWindow', window?.['block-uid']]);
        },
      },
    },
  };

  return {
    roam,
    pages,
    blocks,
    trace,
    title,
    addPage(pageTitle, uid) {
      pages.set(pageTitle, uid);
    },
    addBlock(block) {
      blocks.set(block.uid, block);
    },
    queueUids(...values) {
      uids.push(...values);
    },
    setCreateBlock(impl) {
      createBlockImpl = impl || defaultCreateBlock;
    },
    defaultCreateBlock,
    setOpenBlock(impl) {
      openBlockImpl = impl;
    },
    counts() {
      return {
        createPage: trace.filter((row) => row[0] === 'createPage').length,
        createBlock: trace.filter((row) => row[0] === 'createBlock').length,
        deleteBlock: trace.filter((row) => row[0] === 'deleteBlock').length,
        openBlock: trace.filter((row) => row[0] === 'openBlock').length,
        planQueries: trace.filter((row) => row[0] === 'query:plan').length,
        pageQueries: trace.filter((row) => row[0] === 'query:pageUid').length,
        entries: trace.filter((row) => row[0] === 'query:entries').length,
      };
    },
  };
}

function installHost(roam, { locks = exclusiveLocks() } = {}) {
  const timers = [];
  const storage = new Map();
  global.window = {
    roamAlphaAPI: roam,
    setTimeout: (fn, ms) => {
      const id = timers.push({ fn, ms }) ;
      return id;
    },
    clearTimeout: (id) => {
      timers[id - 1] = null;
    },
    navigator: locks ? { locks } : {},
    localStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => { storage.set(key, String(value)); },
      removeItem: (key) => { storage.delete(key); },
    },
    document: {
      visibilityState: 'visible',
      addEventListener() {},
      removeEventListener() {},
    },
  };
  global.navigator = global.window.navigator;
  global.localStorage = global.window.localStorage;
  return { timers, storage };
}

function sessionOptions(overrides = {}) {
  const toasts = [];
  const inspectCalls = [];
  return {
    toasts,
    inspectCalls,
    options: {
      extensionAPI: {
        settings: { get: (key) => (key === 'language' ? 'en' : undefined) },
      },
      now: () => new Date(2026, 8, 9, 10, 0, 0),
      buildComponentString: async () => `[[Nautilus Log]] ${COMPONENT}`,
      inspectTemplate: () => {
        inspectCalls.push('inspect');
        return { kind: 'standard' };
      },
      trackingEnabled: () => false,
      readTrackingSnapshot: () => null,
      notify: (message, intent) => toasts.push([message, intent]),
      ...overrides,
    },
  };
}

function exclusiveLocks() {
  let chain = Promise.resolve();
  const names = [];
  return {
    names,
    request(name, _opts, callback) {
      names.push(name);
      const run = chain.then(() => callback());
      chain = run.then(() => undefined, () => undefined);
      return run;
    },
  };
}

test('missing page creates the Daily Note; empty page reuses uid', async (t) => {
  const extension = await loadExtension();
  const graph = createGraph();
  installHost(graph.roam);
  t.after(() => { delete global.window; delete global.navigator; delete global.localStorage; });
  const { options } = sessionOptions();
  const session = extension.createTodayPlanSession(options);
  session.initialize();
  const created = await session.ensureToday({ locateMode: 'main' });
  assert.equal(created.status, 'ready-present');
  assert.equal(graph.counts().createPage, 1);
  assert.equal(graph.counts().createBlock, 1);
  assert.equal(graph.trace.find((row) => row[0] === 'createBlock')[4], 'last');
  assert.match(graph.trace.find((row) => row[0] === 'createBlock')[2], /roam-render-Nautilus-Log-cljs/);

  const empty = createGraph();
  empty.addPage('September 9th, 2026', 'empty-day');
  installHost(empty.roam);
  const emptySession = extension.createTodayPlanSession(sessionOptions().options);
  emptySession.initialize();
  await emptySession.ensureToday();
  assert.equal(empty.counts().createPage, 0);
  assert.equal(empty.counts().createBlock, 1);
  assert.equal(empty.trace.find((row) => row[0] === 'createBlock')[1], 'empty-day');

  const occupied = createGraph();
  occupied.addPage('September 9th, 2026', 'busy-day');
  occupied.addBlock({
    uid: 'note',
    string: 'journal',
    parentUid: 'busy-day',
    order: 0,
  });
  installHost(occupied.roam);
  const occupiedSession = extension.createTodayPlanSession(sessionOptions().options);
  occupiedSession.initialize();
  await occupiedSession.ensureToday();
  assert.equal(occupied.counts().createPage, 0);
  assert.equal(occupied.counts().createBlock, 1);
  emptySession.destroy();
  occupiedSession.destroy();
  session.destroy();
});

test('query throw never writes', async (t) => {
  const extension = await loadExtension();
  const graph = createGraph();
  graph.roam.q = () => { throw new Error('query unavailable'); };
  installHost(graph.roam);
  t.after(() => { delete global.window; delete global.navigator; delete global.localStorage; });
  const { options, toasts } = sessionOptions();
  const session = extension.createTodayPlanSession(options);
  session.initialize();
  const result = await session.ensureToday();
  assert.equal(result.status, 'read-failed');
  assert.equal(graph.counts().createPage, 0);
  assert.equal(graph.counts().createBlock, 0);
  assert.equal(toasts.length > 0, true);
  session.destroy();
});

test('existing current and legacy renderers locate without creating', async (t) => {
  const extension = await loadExtension();
  t.after(() => { delete global.window; delete global.navigator; delete global.localStorage; });
  for (const [uid, string] of [
    ['current', `[[Nautilus Log]] ${COMPONENT}`],
    ['legacy', LEGACY],
    ['flow', FLOW],
  ]) {
    const graph = createGraph();
    graph.addPage('September 9th, 2026', 'day');
    graph.addBlock({ uid, string, parentUid: 'day', order: 0 });
    installHost(graph.roam);
    const session = extension.createTodayPlanSession(sessionOptions().options);
    session.initialize();
    const result = await session.ensureToday();
    assert.equal(result.status, 'ready-present');
    assert.equal(result.planUid, uid);
    assert.equal(graph.counts().createBlock, 0);
    assert.equal(graph.counts().createPage, 0);
    assert.equal(graph.counts().openBlock, 1);
    session.destroy();
  }
});

test('standard template writes one last-child generateTemplateString value', async (t) => {
  const extension = await loadExtension();
  const graph = createGraph();
  graph.addPage('September 9th, 2026', 'day');
  installHost(graph.roam);
  t.after(() => { delete global.window; delete global.navigator; delete global.localStorage; });
  const built = [];
  const { options } = sessionOptions({
    buildComponentString: async () => {
      const value = '[[log]] {{[[roam/render]]:((roam-render-Nautilus-Log-cljs)) 28 30 9 "" 2}}';
      built.push(value);
      return value;
    },
  });
  const session = extension.createTodayPlanSession(options);
  const result = await session.ensureToday();
  assert.equal(result.outcome, 'created');
  assert.equal(graph.counts().createBlock, 1);
  assert.equal(graph.trace.find((row) => row[0] === 'createBlock')[2], built[0]);
  session.destroy();
});

test('custom template is blocked with zero writes', async (t) => {
  const extension = await loadExtension();
  const graph = createGraph();
  graph.addPage('September 9th, 2026', 'day');
  installHost(graph.roam);
  t.after(() => { delete global.window; delete global.navigator; delete global.localStorage; });
  const { options, toasts } = sessionOptions({
    inspectTemplate: () => ({ kind: 'custom' }),
  });
  const session = extension.createTodayPlanSession(options);
  const result = await session.ensureToday();
  assert.equal(result.status, 'ready-blocked');
  assert.equal(result.outcome, 'blocked');
  assert.equal(graph.counts().createBlock, 0);
  assert.equal(graph.counts().createPage, 0);
  assert.match(toasts[0][0], /;;/);
  session.destroy();
});

test('double ensureToday coalesces to one write', async (t) => {
  const extension = await loadExtension();
  const graph = createGraph();
  installHost(graph.roam);
  t.after(() => { delete global.window; delete global.navigator; delete global.localStorage; });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const original = graph.defaultCreateBlock;
  graph.setCreateBlock(async (payload) => {
    await gate;
    return original(payload);
  });
  const { options } = sessionOptions();
  const session = extension.createTodayPlanSession(options);
  const first = session.ensureToday();
  const second = session.ensureToday();
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.status, 'ready-present');
  assert.equal(b.status, 'ready-present');
  assert.equal(graph.counts().createBlock, 1);
  session.destroy();
});

test('createBlock throw after disk write locates without retry or delete', async (t) => {
  const extension = await loadExtension();
  const graph = createGraph();
  graph.addPage('September 9th, 2026', 'day');
  installHost(graph.roam);
  t.after(() => { delete global.window; delete global.navigator; delete global.localStorage; });
  graph.setCreateBlock(async (payload) => {
    await graph.defaultCreateBlock(payload);
    throw new Error('mutation failed');
  });
  const session = extension.createTodayPlanSession(sessionOptions().options);
  const result = await session.ensureToday();
  assert.equal(result.status, 'ready-present');
  assert.equal(graph.counts().createBlock, 1);
  assert.equal(graph.counts().deleteBlock, 0);
  session.destroy();
});

test('a failed write is retried only on an explicit second action', async (t) => {
  const extension = await loadExtension();
  const graph = createGraph();
  graph.addPage('September 9th, 2026', 'day');
  installHost(graph.roam);
  t.after(() => { delete global.window; delete global.navigator; delete global.localStorage; });
  let attempts = 0;
  graph.setCreateBlock(async (payload) => {
    attempts += 1;
    if (attempts === 1) throw new Error('mutation failed');
    return graph.defaultCreateBlock(payload);
  });
  const session = extension.createTodayPlanSession(sessionOptions().options);
  const first = await session.ensureToday();
  assert.equal(first.status, 'read-failed');
  assert.equal(attempts, 1);
  const result = await session.ensureToday();
  assert.equal(result.status, 'ready-present');
  assert.equal(attempts, 2);
  assert.equal(graph.counts().createBlock, 1);
  session.destroy();
});

test('navigation throw after present is nav-failed without extra insert', async (t) => {
  const extension = await loadExtension();
  const graph = createGraph();
  graph.addPage('September 9th, 2026', 'day');
  graph.addBlock({
    uid: 'plan',
    string: COMPONENT,
    parentUid: 'day',
    order: 0,
  });
  installHost(graph.roam);
  graph.setOpenBlock(async () => { throw new Error('open failed'); });
  t.after(() => { delete global.window; delete global.navigator; delete global.localStorage; });
  const session = extension.createTodayPlanSession(sessionOptions().options);
  const result = await session.ensureToday();
  assert.equal(result.status, 'nav-failed');
  assert.equal(result.planUid, 'plan');
  assert.equal(graph.counts().createBlock, 0);
  session.destroy();
});

test('midnight now crossing retargets title and does not write', async (t) => {
  const extension = await loadExtension();
  const graph = createGraph();
  installHost(graph.roam);
  t.after(() => { delete global.window; delete global.navigator; delete global.localStorage; });
  let current = new Date(2026, 8, 9, 23, 59, 0);
  const { options } = sessionOptions({ now: () => current });
  const session = extension.createTodayPlanSession(options);
  session.initialize();
  assert.match(session.getState().pageTitle, /September 9th, 2026/);
  const writes = graph.counts().createBlock;
  current = new Date(2026, 8, 10, 0, 0, 1);
  session.discover();
  assert.match(session.getState().pageTitle, /September 10th, 2026/);
  assert.equal(graph.counts().createBlock, writes);
  session.destroy();
});

test('tracking-off session never reads CLOCK entries', async (t) => {
  const extension = await loadExtension();
  const graph = createGraph();
  installHost(graph.roam);
  t.after(() => { delete global.window; delete global.navigator; delete global.localStorage; });
  const session = extension.createTodayPlanSession(sessionOptions({
    trackingEnabled: () => false,
  }).options);
  session.initialize();
  await session.ensureToday();
  assert.equal(graph.counts().entries, 0);
  session.destroy();
});

test('an occupied reserved date UID is never overwritten or bypassed', async (t) => {
  const extension = await loadExtension();
  const graph = createGraph();
  graph.addPage('September 9th, 2026', 'day');
  const reserved = 'nautilus-log-plan-2026-09-09';
  graph.addBlock({ uid: reserved, string: 'user block', parentUid: 'day', order: 0 });
  installHost(graph.roam);
  t.after(() => { delete global.window; delete global.navigator; delete global.localStorage; });
  const session = extension.createTodayPlanSession(sessionOptions().options);
  await session.ensureToday();
  assert.equal(graph.blocks.get(reserved).string, 'user block');
  assert.equal(graph.counts().createBlock, 0);
  session.destroy();
});

test('independent sessions serialize through a graph-scoped lock and each receive the plan', async (t) => {
  const extension = await loadExtension();
  const graph = createGraph();
  const locks = exclusiveLocks();
  installHost(graph.roam, { locks });
  t.after(() => { delete global.window; delete global.navigator; delete global.localStorage; });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const original = graph.defaultCreateBlock;
  graph.setCreateBlock(async (payload) => {
    await gate;
    return original(payload);
  });
  const a = extension.createTodayPlanSession(sessionOptions().options);
  const b = extension.createTodayPlanSession(sessionOptions().options);
  const first = a.ensureToday();
  const second = b.ensureToday();
  release();
  await Promise.all([first, second]);
  assert.equal(graph.counts().createBlock, 1);
  assert.equal(locks.names.length, 2);
  assert.equal(locks.names[0], 'nautilus-log:today-plan:test-graph:September 9th, 2026');
  assert.equal(a.getState().status, 'ready-present');
  assert.equal(b.getState().status, 'ready-present');
  a.destroy();
  b.destroy();
});

test('tracking-on background discover uses snapshot and does not extra-query the day tree', async (t) => {
  const extension = await loadExtension();
  const graph = createGraph();
  installHost(graph.roam);
  t.after(() => { delete global.window; delete global.navigator; delete global.localStorage; });
  let snapshot = { status: 'loading', revision: 0, planSnapshot: null };
  const { options, inspectCalls } = sessionOptions({
    trackingEnabled: () => true,
    readTrackingSnapshot: () => snapshot,
  });
  const session = extension.createTodayPlanSession(options);
  session.initialize();
  assert.equal(session.getState().status, 'checking');
  const planQueries = graph.counts().planQueries;
  snapshot = { status: 'ready', revision: 1, planSnapshot: { pageTitle: 'September 9th, 2026' } };
  session.discover();
  assert.equal(session.getState().status, 'ready-absent');
  const afterInspect = inspectCalls.length;
  snapshot = { ...snapshot, now: new Date() };
  session.discover();
  session.discover();
  assert.equal(inspectCalls.length, afterInspect);
  assert.equal(graph.counts().planQueries, planQueries);
  session.destroy();
});

test('create command label is unnumbered English and CLOCK labels stay in timing-commands', async (t) => {
  const extension = await loadExtension();
  const palette = new Map();
  const extensionAPI = {
    ui: {
      commandPalette: {
        addCommand: (command) => palette.set(command.label, command),
        removeCommand: ({ label }) => palette.delete(label),
      },
    },
  };
  t.after(() => { delete global.window; });
  global.window = { roamAlphaAPI: { ui: {} } };
  const calls = [];
  const commands = extension.createTodayPlanCommands({
    extensionAPI,
    todayPlan: { ensureToday: async (opts) => { calls.push(opts); return { status: 'ready-present' }; } },
  });
  assert.equal(commands.initialize(), true);
  assert.deepEqual([...palette.keys()], ['Nautilus Log: Create or open today’s plan']);
  await palette.get('Nautilus Log: Create or open today’s plan').callback();
  assert.deepEqual(calls, [{ locateMode: 'main' }]);
  commands.destroy();
  assert.equal(palette.size, 0);
});

test('inspectCanonicalTemplate distinguishes missing, standard, and custom', async (t) => {
  const extension = await loadExtension();
  const pages = new Map([['roam/render', 'render-page']]);
  const blocks = new Map();
  const childrenOf = (parentUid) => [...blocks.values()]
    .filter((block) => block.parentUid === parentUid)
    .sort((a, b) => Number(a.order) - Number(b.order));
  const roam = {
    q: (query) => {
      const pageTitle = query.match(/:node\/title "([^"]+)"/)?.[1];
      if (pageTitle && query.includes('clojure.string/includes?')) {
        const pageUid = pages.get(pageTitle);
        const search = query.match(/clojure\.string\/includes\? \?node-string "([^"]*)"/)?.[1] || '';
        return [...blocks.values()]
          .filter((block) => {
            let current = block;
            while (current?.parentUid) {
              if ([...pages.values()].includes(current.parentUid)) return current.parentUid === pageUid;
              current = blocks.get(current.parentUid);
            }
            return false;
          })
          .filter((block) => block.string.includes(search))
          .map((block) => [block]);
      }
      const parentUid = query.match(/\[\?parent :block\/uid "([^"]+)"\]/)?.[1];
      if (parentUid && query.includes(':block/children')) {
        return childrenOf(parentUid).map((block) => [block]);
      }
      return [];
    },
  };
  global.window = { roamAlphaAPI: roam };
  t.after(() => { delete global.window; });
  assert.equal(extension.inspectCanonicalTemplate('{{[[roam/render]]:((roam-render-Nautilus-Log-cljs))').kind, 'missing');

  blocks.set('template', {
    uid: 'template',
    string: 'Nautilus Log [[roam/templates]]',
    order: 0,
    parentUid: 'render-page',
  });
  blocks.set('render', {
    uid: 'render',
    string: '[[Nautilus Log]] {{[[roam/render]]:((roam-render-Nautilus-Log-cljs)) 22 15 5 "" 21}}',
    order: 0,
    parentUid: 'template',
  });
  assert.equal(extension.inspectCanonicalTemplate('{{[[roam/render]]:((roam-render-Nautilus-Log-cljs))').kind, 'standard');

  blocks.set('sibling', {
    uid: 'sibling',
    string: '{{[[TODO]]}} copied yesterday',
    order: 1,
    parentUid: 'template',
  });
  assert.equal(extension.inspectCanonicalTemplate('{{[[roam/render]]:((roam-render-Nautilus-Log-cljs))').kind, 'custom');
  blocks.delete('sibling');
  blocks.set('desc', {
    uid: 'desc',
    string: 'child of render',
    order: 0,
    parentUid: 'render',
  });
  const inspect = () => extension.inspectCanonicalTemplate('{{[[roam/render]]:((roam-render-Nautilus-Log-cljs))');
  assert.equal(inspect().kind, 'custom');
  blocks.delete('desc');
  const originalString = blocks.get('render').string;
  for (const string of [
    `${originalString} extra content`,
    originalString.replace('21}}', '21 extra-parameter}}'),
    `${originalString} ${originalString}`,
  ]) {
    blocks.get('render').string = string;
    assert.equal(inspect().kind, 'custom');
  }
  blocks.get('render').string = originalString;
  const query = roam.q;
  for (const badRows of [null, undefined, [[null]], [[{}]]]) {
    roam.q = () => badRows;
    assert.throws(inspect, /unreadable/);
    roam.q = (q) => q.includes(':block/children') ? badRows : query(q);
    assert.throws(inspect, /unreadable/);
  }
});

test('partial page create does not insert a component', async (t) => {
  const extension = await loadExtension();
  const graph = createGraph();
  graph.roam.data.page.create = async () => {
    graph.trace.push(['createPage', 'failed']);
    throw new Error('page create failed');
  };
  installHost(graph.roam);
  t.after(() => { delete global.window; delete global.navigator; delete global.localStorage; });
  const session = extension.createTodayPlanSession(sessionOptions().options);
  const result = await session.ensureToday();
  assert.equal(result.status, 'read-failed');
  assert.equal(graph.counts().createBlock, 0);
  assert.equal(graph.counts().deleteBlock, 0);
  session.destroy();
});

test('unload before write prevents insert', async (t) => {
  const extension = await loadExtension();
  const graph = createGraph();
  installHost(graph.roam);
  t.after(() => { delete global.window; delete global.navigator; delete global.localStorage; });
  const session = extension.createTodayPlanSession(sessionOptions().options);
  session.destroy();
  const result = await session.ensureToday();
  assert.equal(graph.counts().createBlock, 0);
  assert.equal(graph.counts().createPage, 0);
  assert.equal(result.status, 'checking');
});

test('unchanged tracking ticks do not republish or inspect templates', async (t) => {
  const extension = await loadExtension();
  const graph = createGraph();
  installHost(graph.roam);
  t.after(() => { delete global.window; delete global.navigator; delete global.localStorage; });
  const snapshot = {
    status: 'ready', revision: 1,
    planSnapshot: { pageTitle: graph.title, pageUid: 'day', plan: { uid: 'plan' } },
  };
  const { options, inspectCalls } = sessionOptions({
    trackingEnabled: () => true,
    readTrackingSnapshot: () => snapshot,
  });
  const session = extension.createTodayPlanSession(options);
  session.initialize();
  let notifications = 0;
  session.subscribe(() => { notifications += 1; });
  for (let tick = 0; tick < 60; tick += 1) session.discover();
  assert.equal(notifications, 0);
  assert.equal(inspectCalls.length, 0);
  assert.equal(graph.counts().planQueries, 0);
  session.destroy();
});

test('missing or previous-day tracking snapshots are not proof of absence', async (t) => {
  const extension = await loadExtension();
  const graph = createGraph();
  installHost(graph.roam);
  t.after(() => { delete global.window; delete global.navigator; delete global.localStorage; });
  for (const planSnapshot of [null, { pageTitle: 'September 8th, 2026', plan: null }]) {
    const { options, inspectCalls } = sessionOptions({
      trackingEnabled: () => true,
      readTrackingSnapshot: () => ({ status: 'ready', planSnapshot }),
    });
    const session = extension.createTodayPlanSession(options);
    session.initialize();
    assert.equal(session.getState().status, 'checking');
    assert.equal(inspectCalls.length, 0);
    session.destroy();
  }
});

test('no cross-tab lock support fails closed for creation but still opens existing plans', async (t) => {
  const extension = await loadExtension();
  const graph = createGraph();
  installHost(graph.roam, { locks: null });
  t.after(() => { delete global.window; delete global.navigator; delete global.localStorage; });
  const session = extension.createTodayPlanSession(sessionOptions().options);
  const failed = await session.ensureToday();
  assert.equal(failed.status, 'read-failed');
  assert.equal(graph.counts().createPage, 0);
  assert.equal(graph.counts().createBlock, 0);
  graph.addPage(graph.title, 'day');
  graph.addBlock({ uid: 'existing', string: COMPONENT, parentUid: 'day', order: 0 });
  const opened = await session.ensureToday();
  assert.equal(opened.planUid, 'existing');
  assert.equal(graph.counts().openBlock, 1);
  session.destroy();
});

test('unload during async component preparation prevents the first graph mutation', async (t) => {
  const extension = await loadExtension();
  const graph = createGraph();
  graph.addPage(graph.title, 'day');
  installHost(graph.roam);
  t.after(() => { delete global.window; delete global.navigator; delete global.localStorage; });
  let start;
  let release;
  const started = new Promise((resolve) => { start = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  const session = extension.createTodayPlanSession(sessionOptions({
    buildComponentString: async () => { start(); await gate; return COMPONENT; },
  }).options);
  const pending = session.ensureToday();
  await started;
  session.destroy();
  release();
  await pending;
  assert.equal(graph.counts().createBlock, 0);
});

test('midnight during page creation never inserts into the stale target', async (t) => {
  const extension = await loadExtension();
  const graph = createGraph();
  installHost(graph.roam);
  t.after(() => { delete global.window; delete global.navigator; delete global.localStorage; });
  let current = new Date(2026, 8, 9, 23, 59, 59);
  const original = graph.roam.data.page.create;
  graph.roam.data.page.create = async (payload) => {
    await original(payload);
    current = new Date(2026, 8, 10, 0, 0, 1);
  };
  const session = extension.createTodayPlanSession(sessionOptions({ now: () => current }).options);
  await session.ensureToday();
  assert.equal(graph.counts().createPage, 1);
  assert.equal(graph.counts().createBlock, 0);
  assert.equal(graph.trace.find((row) => row[0] === 'createPage')[2], '09-09-2026');
  session.destroy();
});

test('lagging plan query after a successful write never causes another insert', async (t) => {
  const extension = await loadExtension();
  const graph = createGraph();
  graph.addPage(graph.title, 'day');
  installHost(graph.roam);
  t.after(() => { delete global.window; delete global.navigator; delete global.localStorage; });
  let hidePlan = false;
  const query = graph.roam.q;
  graph.roam.q = (q, ...args) => hidePlan && q.includes('?page-uid ?uid ?string ?order ?parent-uid')
    ? [] : query(q, ...args);
  graph.setCreateBlock(async (payload) => { await graph.defaultCreateBlock(payload); hidePlan = true; });
  const session = extension.createTodayPlanSession(sessionOptions().options);
  await session.ensureToday();
  await session.ensureToday();
  assert.equal(graph.counts().createBlock, 1);
  const reloaded = extension.createTodayPlanSession(sessionOptions().options);
  await reloaded.ensureToday();
  assert.equal(graph.counts().createBlock, 1, 'a fresh session must not bypass the reserved UID');
  reloaded.destroy();
  hidePlan = false;
  const confirmed = await session.ensureToday();
  assert.equal(confirmed.status, 'ready-present');
  assert.equal(graph.counts().createBlock, 1);
  session.destroy();
});

test('two graph contexts never share an in-flight action', async (t) => {
  const extension = await loadExtension();
  const a = createGraph();
  a.roam.graph.name = 'graph-a';
  a.addPage(a.title, 'day-a');
  installHost(a.roam);
  let start;
  let release;
  const started = new Promise((resolve) => { start = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  const sessionA = extension.createTodayPlanSession(sessionOptions({
    buildComponentString: async () => { start(); await gate; return COMPONENT; },
  }).options);
  const first = sessionA.ensureToday();
  await started;
  const b = createGraph();
  b.roam.graph.name = 'graph-b';
  b.addPage(b.title, 'day-b');
  const locks = exclusiveLocks();
  installHost(b.roam, { locks });
  t.after(() => { delete global.window; delete global.navigator; delete global.localStorage; });
  const sessionB = extension.createTodayPlanSession(sessionOptions().options);
  const second = sessionB.ensureToday();
  release();
  await Promise.all([first, second]);
  assert.equal(a.counts().createBlock, 0, 'the old graph context was abandoned');
  assert.equal(b.counts().createBlock, 1);
  assert.equal(b.trace.find((row) => row[0] === 'createBlock')[1], 'day-b');
  assert.match(locks.names[0], /graph-b/);
  assert.equal(sessionB.getState().status, 'ready-present');
  sessionA.destroy();
  sessionB.destroy();
});

test('separate module instances use the native lock rather than a shared JS map', async (t) => {
  const a = await loadExtension();
  const b = await loadExtension();
  const graph = createGraph();
  const locks = exclusiveLocks();
  installHost(graph.roam, { locks });
  t.after(() => { delete global.window; delete global.navigator; delete global.localStorage; });
  const sessionA = a.createTodayPlanSession(sessionOptions().options);
  const sessionB = b.createTodayPlanSession(sessionOptions().options);
  await Promise.all([sessionA.ensureToday(), sessionB.ensureToday()]);
  assert.equal(locks.names.length, 2);
  assert.equal(graph.counts().createBlock, 1);
  assert.equal(sessionA.getState().planUid, sessionB.getState().planUid);
  sessionA.destroy();
  sessionB.destroy();
});

test('midnight during a committed insert confirms the frozen date without writing again', async (t) => {
  const extension = await loadExtension();
  const graph = createGraph();
  graph.addPage(graph.title, 'day');
  installHost(graph.roam);
  t.after(() => { delete global.window; delete global.navigator; delete global.localStorage; });
  let current = new Date(2026, 8, 9, 23, 59, 59);
  graph.setCreateBlock(async (payload) => {
    await graph.defaultCreateBlock(payload);
    current = new Date(2026, 8, 10, 0, 0, 1);
  });
  const session = extension.createTodayPlanSession(sessionOptions({ now: () => current }).options);
  const result = await session.ensureToday();
  assert.equal(graph.counts().createBlock, 1);
  assert.equal(graph.counts().createPage, 0);
  assert.equal(graph.counts().openBlock, 0);
  assert.equal(result.error, 'dateChangedAfterCreate');
  assert.equal(result.pageTitle, 'September 10th, 2026');
  session.destroy();
});

test('unknown graph scope and occupied Daily Note UID both fail closed', async (t) => {
  const extension = await loadExtension();
  t.after(() => { delete global.window; delete global.navigator; delete global.localStorage; });
  for (const scenario of ['unknown-scope', 'occupied-day-uid']) {
    const graph = createGraph();
    if (scenario === 'unknown-scope') delete graph.roam.graph;
    else {
      graph.addPage('Notes', 'notes');
      graph.addBlock({ uid: '09-09-2026', string: 'user block', parentUid: 'notes', order: 0 });
    }
    installHost(graph.roam);
    const session = extension.createTodayPlanSession(sessionOptions().options);
    const result = await session.ensureToday();
    assert.equal(result.status, 'read-failed');
    assert.equal(graph.counts().createPage, 0);
    assert.equal(graph.counts().createBlock, 0);
    session.destroy();
  }
});

test('unavailable APIs are distinct from read failure and do not leave a new empty page', async (t) => {
  const extension = await loadExtension();
  t.after(() => { delete global.window; delete global.navigator; delete global.localStorage; });
  for (const missing of ['query', 'block-create']) {
    const graph = createGraph();
    if (missing === 'query') delete graph.roam.q;
    else delete graph.roam.data.block.create;
    installHost(graph.roam);
    const session = extension.createTodayPlanSession(sessionOptions().options);
    const result = await session.ensureToday();
    assert.equal(result.error, 'apiUnavailable');
    assert.equal(graph.counts().createPage, 0);
    assert.equal(graph.counts().createBlock, 0);
    session.destroy();
  }
});

test('malformed page and plan query rows never authorize a write', async (t) => {
  const extension = await loadExtension();
  t.after(() => { delete global.window; delete global.navigator; delete global.localStorage; });
  for (const badQuery of ['?page-uid ?uid ?string ?order ?parent-uid', '[:find ?uid :in $ ?page-title']) {
    const graph = createGraph();
    const original = graph.roam.q;
    graph.roam.q = (q, ...args) => q.includes(badQuery) ? [[null]] : original(q, ...args);
    installHost(graph.roam);
    const session = extension.createTodayPlanSession(sessionOptions().options);
    const result = await session.ensureToday();
    assert.equal(result.status, 'read-failed');
    assert.equal(graph.counts().createPage, 0);
    assert.equal(graph.counts().createBlock, 0);
    session.destroy();
  }
});

test('UID lookup errors cannot be treated as a free UID', async (t) => {
  const extension = await loadExtension();
  const graph = createGraph();
  graph.addPage(graph.title, 'day');
  graph.roam.data.pull = () => { throw new Error('pull unavailable'); };
  installHost(graph.roam);
  t.after(() => { delete global.window; delete global.navigator; delete global.localStorage; });
  const session = extension.createTodayPlanSession(sessionOptions().options);
  await session.ensureToday();
  assert.equal(graph.counts().createBlock, 0);
  session.destroy();
});
