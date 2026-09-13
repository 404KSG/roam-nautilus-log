const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { installTestHostLocks } = require('./test-host-locks.cjs');

const PLAN = '{{[[roam/render]]:((roam-render-Nautilus-Log-cljs))}}';
const PLAN_B = '{{[[roam/render]]:((roam-render-Nautilus-Flow-cljs))}}';
const PAGE_TITLE = 'August 22nd, 2026';
const DATE = new Date(2026, 7, 22, 10, 0);
const DAILY_TREE_MARKER = '?page-uid ?uid ?string ?order ?parent-uid';
const PAGE_UID_MARKER = '[?e :node/title ?page-title]';
const REVERSE_PATTERN = '[:block/uid {:block/_page [:block/uid :block/string :block/order {:block/_children [:block/uid]}]}]';

async function loadExtension() {
  const bundle = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}#daily-pull-${Date.now()}-${Math.random()}`);
}

function keyNames(style) {
  if (style === 'plain') {
    return {
      uid: 'block/uid',
      string: 'block/string',
      order: 'block/order',
      pageRev: 'block/_page',
      childRev: 'block/_children',
    };
  }
  return {
    uid: ':block/uid',
    string: ':block/string',
    order: ':block/order',
    pageRev: ':block/_page',
    childRev: ':block/_children',
  };
}

function projectReversePage(pageUid, nodes, { style = 'colon', omitPageRev = false, omitChildRev = false } = {}) {
  const keys = keyNames(style);
  const entity = { [keys.uid]: pageUid };
  if (!omitPageRev) {
    entity[keys.pageRev] = nodes.map((node) => {
      const block = { [keys.uid]: node.uid };
      if (node.string !== undefined) block[keys.string] = node.string;
      if (node.order !== undefined) block[keys.order] = node.order;
      if (!omitChildRev && node.omitChildRev !== true) {
        const parents = node.parents === undefined ? [] : node.parents;
        block[keys.childRev] = parents.map((parentUid) => ({ [keys.uid]: parentUid }));
      }
      return block;
    });
  }
  return entity;
}

function createDailyHost({
  pageUid = 'page',
  pageTitle = PAGE_TITLE,
  nodes = [],
  pullMode = 'reverse',
  pullStyle = 'colon',
  queryMode = 'datalog',
  extraBlocks = [],
} = {}) {
  const traces = [];
  const stringByUid = new Map();
  for (const node of nodes) {
    if (typeof node.uid === 'string' && typeof node.string === 'string') stringByUid.set(node.uid, node.string);
  }
  for (const block of extraBlocks) {
    if (typeof block.uid === 'string' && typeof block.string === 'string') stringByUid.set(block.uid, block.string);
  }

  const datalogRows = () => nodes.flatMap((node) => {
    // Simulate Datalog inner join: bound attributes must exist. Presence is
    // not a JS type filter, so NaN / Infinity / wrong-typed values still
    // appear and the production validator can fail closed.
    if (node.uid === undefined || node.string === undefined || node.order === undefined) return [];
    return (node.parents || []).map((parentUid) => [pageUid, node.uid, node.string, node.order, parentUid]);
  });

  const q = (query, ...args) => {
    if (query.includes(DAILY_TREE_MARKER)) {
      traces.push('query:plan');
      if (queryMode === 'throw') throw new Error('injected Daily Note tree query failure');
      if (queryMode === 'malformed') return [[null]];
      if (args[0] !== pageTitle) return [];
      return datalogRows();
    }
    if (query.includes(PAGE_UID_MARKER) && query.includes('[?e :block/uid ?uid]')) {
      traces.push('query:pageUid');
      return args[0] === pageTitle ? [[pageUid]] : [];
    }
    if (query.includes('?clock-uid ?clock-string')) {
      traces.push('query:entries');
      return [];
    }
    if (query.includes(':find ?s')) {
      traces.push(`query:string:${args[0]}`);
      return stringByUid.has(args[0]) ? [[stringByUid.get(args[0])]] : [];
    }
    traces.push('query:other');
    return [];
  };

  const pull = (pattern, lookup) => {
    const lookupKey = lookup?.[0];
    const lookupVal = lookup?.[1];
    traces.push(`pull:${lookupKey}:${lookupVal}`);
    if (pullMode === 'throw') throw new Error('injected reverse pull failure');
    if (pullMode === 'none') return undefined;
    if (typeof pattern === 'string' && (pattern.includes(':block/_page') || pattern.includes('block/_page'))) {
      traces.push('pull:daily-tree');
      if (pullMode === 'unsupported') throw new Error('reverse pull pattern unsupported');
      if (pullMode === 'null') return null;
      if (pullMode === 'thenable') {
        return Promise.reject(new Error('async pull is not in the production contract'));
      }
      if (pullMode === 'non-object') return 42;
      if (lookupKey !== ':node/title' && lookupKey !== 'node/title') return null;
      if (lookupVal !== pageTitle) return null;
      if (pullMode === 'missing-page-rev') return projectReversePage(pageUid, nodes, { style: pullStyle, omitPageRev: true });
      if (pullMode === 'missing-child-rev') return projectReversePage(pageUid, nodes, { style: pullStyle, omitChildRev: true });
      if (pullMode === 'page-rev-null') {
        const keys = keyNames(pullStyle);
        return { [keys.uid]: pageUid, [keys.pageRev]: null };
      }
      return projectReversePage(pageUid, nodes, { style: pullStyle });
    }
    if (lookupKey === ':block/uid' || lookupKey === 'block/uid') {
      if (!stringByUid.has(lookupVal)) return null;
      const keys = keyNames(pullStyle === 'plain' ? 'plain' : 'colon');
      return { [keys.uid]: lookupVal, [keys.string]: stringByUid.get(lookupVal) };
    }
    return null;
  };

  const roam = {
    graph: { name: 'daily-pull-host' },
    util: { dateToPageTitle: () => pageTitle },
    q,
    data: { q, pull },
  };

  return { roam, traces, pageUid, pageTitle };
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

function withPullAndFallback(nodes, visit) {
  for (const pullMode of ['reverse', 'none']) {
    const host = createDailyHost({ nodes, pullMode });
    if (pullMode === 'none') delete host.roam.data.pull;
    const restore = installHost(host.roam);
    try {
      visit(host, pullMode);
    } finally {
      restore();
    }
  }
}

function snapshotShape(snapshot) {
  return snapshot && {
    pageTitle: snapshot.pageTitle,
    pageUid: snapshot.pageUid,
    planUid: snapshot.plan?.uid || null,
    rowUids: (snapshot.rows || []).map((row) => [row.uid, row.parentUid, row.string, row.order]),
    keys: Object.keys(snapshot).sort(),
  };
}

const EMPTY_KEYS = ['fixedEvents', 'pageTitle', 'pageUid', 'plan', 'reviewCandidates', 'reviewTasks', 'rows', 'tasks'];

function basicTree() {
  return [
    { uid: 'plan', string: PLAN, order: 0, parents: ['page'] },
    { uid: 'task', string: '{{[[TODO]]}} Alpha 15m', order: 0, parents: ['plan'] },
    { uid: 'other', string: 'weekly note', order: 1, parents: ['page'] },
  ];
}

test('readPrimaryPlan is exported from the production module', async () => {
  const extension = await loadExtension();
  assert.equal(typeof extension.readPrimaryPlan, 'function');
});

test('a reverse-pull host must not run the slow Daily tree query', async () => {
  const extension = await loadExtension();
  const host = createDailyHost({ nodes: basicTree() });
  const restore = installHost(host.roam);
  try {
    const snapshot = extension.readPrimaryPlan(DATE, 15);
    assert.deepEqual(Object.keys(snapshot).sort(), EMPTY_KEYS);
    assert.equal(snapshot.plan.uid, 'plan');
    assert.equal(snapshot.pageUid, 'page');
    assert.equal(host.traces.filter((row) => row === 'query:plan').length, 0);
    assert.equal(host.traces.filter((row) => row === 'pull:daily-tree').length, 1);
    assert.ok(host.traces.includes('pull::node/title:August 22nd, 2026'));
  } finally {
    restore();
  }
});

test('empty reverse _page is a successful empty Daily Note and does not query', async () => {
  const extension = await loadExtension();
  const host = createDailyHost({ nodes: [] });
  const restore = installHost(host.roam);
  try {
    const snapshot = extension.readPrimaryPlan(DATE, 15);
    assert.equal(snapshot.plan, null);
    assert.equal(snapshot.pageUid, null);
    assert.deepEqual(snapshot.rows, []);
    assert.deepEqual(snapshot.tasks, []);
    assert.equal(host.traces.filter((row) => row === 'query:plan').length, 0);
    assert.equal(host.traces.filter((row) => row === 'pull:daily-tree').length, 1);
  } finally {
    restore();
  }
});

test('missing page (pull null) falls back to Datalog and stays empty without creating a plan', async () => {
  const extension = await loadExtension();
  const host = createDailyHost({ nodes: basicTree(), pullMode: 'null', queryMode: 'datalog' });
  host.roam.q = (query, ...args) => {
    if (query.includes(DAILY_TREE_MARKER)) {
      host.traces.push('query:plan');
      return [];
    }
    return [];
  };
  const restore = installHost(host.roam);
  try {
    const snapshot = extension.readPrimaryPlan(DATE, 15);
    assert.equal(snapshot.plan, null);
    assert.equal(snapshot.pageUid, null);
    assert.equal(host.traces.filter((row) => row === 'query:plan').length, 1);
  } finally {
    restore();
  }
});

test('tree-order chooses the earlier nested Primary over a later top-level Primary', async () => {
  const extension = await loadExtension();
  const host = createDailyHost({
    nodes: [
      { uid: 'section', string: 'Morning', order: 0, parents: ['page'] },
      { uid: 'nested-plan', string: `[[First]] ${PLAN}`, order: 1, parents: ['section'] },
      { uid: 'later-plan', string: `[[Later]] ${PLAN_B}`, order: 1, parents: ['page'] },
      { uid: 'task', string: '{{[[TODO]]}} Nested 15m', order: 0, parents: ['nested-plan'] },
    ],
  });
  const restore = installHost(host.roam);
  try {
    const snapshot = extension.readPrimaryPlan(DATE, 15);
    assert.equal(snapshot.plan.uid, 'nested-plan');
    assert.deepEqual(snapshot.tasks.map((task) => task.uid), ['task']);
    assert.equal(host.traces.filter((row) => row === 'query:plan').length, 0);
  } finally {
    restore();
  }
});

test('a later nested Primary does not beat an earlier top-level Primary', async () => {
  const extension = await loadExtension();
  const host = createDailyHost({
    nodes: [
      { uid: 'first-plan', string: PLAN, order: 0, parents: ['page'] },
      { uid: 'section', string: 'Later nest', order: 1, parents: ['page'] },
      { uid: 'nested-plan', string: PLAN_B, order: 0, parents: ['section'] },
    ],
  });
  const restore = installHost(host.roam);
  try {
    assert.equal(extension.readPrimaryPlan(DATE, 15).plan.uid, 'first-plan');
  } finally {
    restore();
  }
});

test('empty strings stay legal and refs hydrate through the original string pull', async () => {
  const extension = await loadExtension();
  const host = createDailyHost({
    nodes: [
      { uid: 'plan', string: PLAN, order: 0, parents: ['page'] },
      { uid: 'blank', string: '', order: 0, parents: ['plan'] },
      { uid: 'ref-row', string: '((source-task))', order: 1, parents: ['plan'] },
    ],
    extraBlocks: [{ uid: 'source-task', string: '{{[[TODO]]}} Source 20m' }],
  });
  const restore = installHost(host.roam);
  try {
    const snapshot = extension.readPrimaryPlan(DATE, 15);
    const blank = snapshot.rows.find((row) => row.uid === 'blank');
    assert.equal(blank.string, '');
    assert.equal(snapshot.tasks.some((task) => task.uid === 'ref-row'), true);
    assert.ok(host.traces.some((row) => row === 'pull::block/uid:source-task' || row === 'query:string:source-task'));
    assert.equal(host.traces.filter((row) => row === 'query:plan').length, 0);
  } finally {
    restore();
  }
});

test('multi-parent reverse edges expand instead of deduping by uid', async () => {
  const extension = await loadExtension();
  const host = createDailyHost({
    nodes: [
      { uid: 'plan', string: PLAN, order: 0, parents: ['page'] },
      { uid: 'shared', string: '{{[[TODO]]}} Shared 15m', order: 0, parents: ['plan', 'other-parent'] },
      { uid: 'other-parent', string: 'holder', order: 1, parents: ['page'] },
    ],
  });
  const restore = installHost(host.roam);
  try {
    const snapshot = extension.readPrimaryPlan(DATE, 15);
    const shared = snapshot.rows.filter((row) => row.uid === 'shared');
    assert.equal(shared.length, 2);
    assert.deepEqual(shared.map((row) => row.parentUid).sort(), ['other-parent', 'plan']);
    assert.equal(host.traces.filter((row) => row === 'query:plan').length, 0);
  } finally {
    restore();
  }
});

test('orphans with an explicit empty reverse parent list emit no tuple', async () => {
  const extension = await loadExtension();
  const host = createDailyHost({
    nodes: [
      { uid: 'plan', string: PLAN, order: 0, parents: ['page'] },
      { uid: 'orphan', string: 'no parent edge', order: 3, parents: [] },
    ],
  });
  const restore = installHost(host.roam);
  try {
    const snapshot = extension.readPrimaryPlan(DATE, 15);
    assert.equal(snapshot.rows.some((row) => row.uid === 'orphan'), false);
    assert.equal(snapshot.plan.uid, 'plan');
  } finally {
    restore();
  }
});

test('a cross-page parent edge is kept when the child is on the Daily page', async () => {
  const extension = await loadExtension();
  const host = createDailyHost({
    nodes: [
      { uid: 'plan', string: PLAN, order: 0, parents: ['page'] },
      { uid: 'borrowed', string: '{{[[TODO]]}} Borrowed 15m', order: 0, parents: ['foreign-parent'] },
    ],
  });
  const restore = installHost(host.roam);
  try {
    const snapshot = extension.readPrimaryPlan(DATE, 15);
    const borrowed = snapshot.rows.filter((row) => row.uid === 'borrowed');
    assert.equal(borrowed.length, 1);
    assert.equal(borrowed[0].parentUid, 'foreign-parent');
  } finally {
    restore();
  }
});

test('plain block/ keys project the same tree as namespaced keys', async () => {
  const extension = await loadExtension();
  const colon = createDailyHost({ nodes: basicTree(), pullStyle: 'colon' });
  const plain = createDailyHost({ nodes: basicTree(), pullStyle: 'plain' });
  const restoreColon = installHost(colon.roam);
  let left;
  try { left = snapshotShape(extension.readPrimaryPlan(DATE, 15)); } finally { restoreColon(); }
  const restorePlain = installHost(plain.roam);
  let right;
  try { right = snapshotShape(extension.readPrimaryPlan(DATE, 15)); } finally { restorePlain(); }
  assert.deepEqual(left, right);
  assert.equal(colon.traces.filter((row) => row === 'query:plan').length, 0);
  assert.equal(plain.traces.filter((row) => row === 'query:plan').length, 0);
});

test('missing reverse fields, null, unsupported, non-object, and thenable pulls fall back instead of looking like an empty page', async () => {
  const extension = await loadExtension();
  const modes = ['missing-page-rev', 'missing-child-rev', 'page-rev-null', 'null', 'unsupported', 'non-object', 'thenable'];
  const rejections = [];
  const onUnhandled = (error) => rejections.push(error);
  process.on('unhandledRejection', onUnhandled);
  try {
    for (const pullMode of modes) {
      const host = createDailyHost({ nodes: basicTree(), pullMode });
      const restore = installHost(host.roam);
      try {
        const snapshot = extension.readPrimaryPlan(DATE, 15);
        assert.equal(snapshot.plan.uid, 'plan', pullMode);
        assert.equal(host.traces.filter((row) => row === 'query:plan').length, 1, pullMode);
      } finally {
        restore();
      }
    }
  } finally {
    process.removeListener('unhandledRejection', onUnhandled);
  }
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(rejections.length, 0, 'thenable pull must not leak an unhandled rejection');
});

test('hosts without pull keep the original Datalog path', async () => {
  const extension = await loadExtension();
  const host = createDailyHost({ nodes: basicTree(), pullMode: 'none' });
  delete host.roam.data.pull;
  const restore = installHost(host.roam);
  try {
    const snapshot = extension.readPrimaryPlan(DATE, 15);
    assert.equal(snapshot.plan.uid, 'plan');
    assert.equal(host.traces.filter((row) => row === 'query:plan').length, 1);
    assert.equal(host.traces.filter((row) => row === 'pull:daily-tree').length, 0);
  } finally {
    restore();
  }
});

test('missing string/order attributes follow Datalog inner-join omission instead of defaulting fields', async () => {
  const extension = await loadExtension();
  const nodes = [
    { uid: 'plan', string: PLAN, order: 0, parents: ['page'] },
    { uid: 'no-string', order: 1, parents: ['page'] },
    { uid: 'no-order', string: 'has string', parents: ['page'] },
  ];
  const host = createDailyHost({ nodes });
  const restore = installHost(host.roam);
  try {
    const snapshot = extension.readPrimaryPlan(DATE, 15);
    assert.equal(snapshot.plan.uid, 'plan');
    assert.equal(snapshot.rows.some((row) => row.uid === 'no-string' || row.uid === 'no-order'), false);
    assert.equal(host.traces.filter((row) => row === 'query:plan').length, 0);
    assert.equal(host.traces.filter((row) => row === 'pull:daily-tree').length, 1);
  } finally {
    restore();
  }
});

test('present but malformed string/order values fail closed on pull and Datalog paths', async () => {
  const extension = await loadExtension();
  const cases = [
    ['NaN order', [{ uid: 'plan', string: PLAN, order: Number.NaN, parents: ['page'] }]],
    ['Infinity order', [{ uid: 'plan', string: PLAN, order: Number.POSITIVE_INFINITY, parents: ['page'] }]],
    ['string order', [{ uid: 'plan', string: PLAN, order: '0', parents: ['page'] }]],
    ['numeric string', [{ uid: 'plan', string: 42, order: 0, parents: ['page'] }]],
    ['null string', [{ uid: 'plan', string: null, order: 0, parents: ['page'] }]],
  ];
  for (const [name, nodes] of cases) {
    withPullAndFallback(nodes, (host, pullMode) => {
      assert.throws(
        () => extension.readPrimaryPlan(DATE, 15),
        /unreadable Daily Note tree/,
        `${name} ${pullMode}`,
      );
      if (pullMode === 'reverse') {
        assert.equal(host.traces.filter((row) => row === 'query:plan').length, 0, `${name} pull must not query`);
        assert.equal(host.traces.filter((row) => row === 'pull:daily-tree').length, 1, `${name} pull`);
      } else {
        assert.equal(host.traces.filter((row) => row === 'query:plan').length, 1, `${name} fallback query`);
      }
    });
  }
});

test('a malformed Primary cannot be dropped in favor of a later valid Primary', async () => {
  const extension = await loadExtension();
  const nodes = [
    { uid: 'bad-plan', string: PLAN, order: Number.NaN, parents: ['page'] },
    { uid: 'good-plan', string: PLAN_B, order: 1, parents: ['page'] },
  ];
  withPullAndFallback(nodes, (host, pullMode) => {
    assert.throws(() => extension.readPrimaryPlan(DATE, 15), /unreadable Daily Note tree/, pullMode);
  });
});

test('malformed parent uids fail closed instead of keeping remaining parent edges', async () => {
  const extension = await loadExtension();
  const nodes = [
    { uid: 'plan', string: PLAN, order: 0, parents: ['page'] },
    { uid: 'task', string: '{{[[TODO]]}} Alpha 15m', order: 0, parents: ['plan', null] },
  ];
  withPullAndFallback(nodes, (host, pullMode) => {
    assert.throws(() => extension.readPrimaryPlan(DATE, 15), /unreadable Daily Note tree/, pullMode);
  });
});

test('unreadable Daily trees do not become plan-absent and do not reach create', async () => {
  const extension = await loadExtension();
  const nodes = [{ uid: 'plan', string: PLAN, order: Number.NaN, parents: ['page'] }];
  withPullAndFallback(nodes, (host, pullMode) => {
    let snapshot = null;
    assert.throws(() => {
      snapshot = extension.readPrimaryPlan(DATE, 15);
    }, /unreadable Daily Note tree/, pullMode);
    assert.equal(snapshot, null, `${pullMode} must not return a snapshot`);
  });
  const fallbackHost = createDailyHost({ nodes, pullMode: 'null', queryMode: 'throw' });
  const restore = installHost(fallbackHost.roam);
  try {
    let snapshot = null;
    assert.throws(() => {
      snapshot = extension.readPrimaryPlan(DATE, 15);
    }, /injected Daily Note tree query failure/);
    assert.equal(snapshot, null);
  } finally {
    restore();
  }
});

test('fallback query failures stay fail-closed and do not become plan-absent', async () => {
  const extension = await loadExtension();
  const host = createDailyHost({ nodes: basicTree(), pullMode: 'null', queryMode: 'throw' });
  const restore = installHost(host.roam);
  try {
    assert.throws(() => extension.readPrimaryPlan(DATE, 15), /injected Daily Note tree query failure/);
  } finally {
    restore();
  }
});

test('malformed fallback rows stay unreadable rather than authorizing a missing plan', async () => {
  const extension = await loadExtension();
  const host = createDailyHost({ nodes: basicTree(), pullMode: 'null', queryMode: 'malformed' });
  const restore = installHost(host.roam);
  try {
    assert.throws(() => extension.readPrimaryPlan(DATE, 15), /unreadable Daily Note tree/);
  } finally {
    restore();
  }
});

test('each readPrimaryPlan call pulls live and does not reuse a prior tree', async () => {
  const extension = await loadExtension();
  const host = createDailyHost({ nodes: basicTree() });
  const restore = installHost(host.roam);
  try {
    assert.equal(extension.readPrimaryPlan(DATE, 15).plan.uid, 'plan');
    host.traces.length = 0;
    assert.equal(extension.readPrimaryPlan(DATE, 15).plan.uid, 'plan');
    assert.equal(host.traces.filter((row) => row === 'pull:daily-tree').length, 1);
    assert.equal(host.traces.filter((row) => row === 'query:plan').length, 0);
  } finally {
    restore();
  }
});

test('Tidy commandPalette uses reverse pull rather than the Daily Datalog query', async () => {
  const extension = await loadExtension();
  const nodes = [
    { uid: 'plan', string: `[[Nautilus Log]] ${PLAN}`, order: 0, parents: ['page'] },
    { uid: 'active-a', string: '{{[[TODO]]}} Alpha 15m', order: 0, parents: ['plan'] },
    { uid: 'done-a', string: '{{[[DONE]]}} Done A 15m', order: 1, parents: ['plan'] },
    { uid: 'divider', string: '---', order: 2, parents: ['plan'] },
    { uid: 'past-event', string: '{{[[DONE]]}} 05:00-06:00 Event', order: 3, parents: ['plan'] },
    { uid: 'active-b', string: '{{[[TODO]]}} Beta 15m', order: 4, parents: ['plan'] },
  ];
  const host = createDailyHost({ nodes });
  const blocks = new Map();
  for (const node of nodes) {
    blocks.set(node.uid, {
      uid: node.uid,
      string: node.string,
      parentUid: node.parents[0],
      order: node.order,
      open: node.uid.startsWith('active'),
    });
  }
  const childrenOf = (parentUid) => [...blocks.values()]
    .filter((block) => block.parentUid === parentUid)
    .sort((left, right) => Number(left.order) - Number(right.order));
  host.roam.q = (query, ...args) => {
    if (query.includes(DAILY_TREE_MARKER)) {
      host.traces.push('query:plan');
      return nodes.flatMap((node) => (node.parents || []).map((parentUid) => [
        'page', node.uid, node.string, node.order, parentUid,
      ]));
    }
    if (query.includes('?uid ?string ?order ?open')) {
      host.traces.push(`query:children:${args[0]}`);
      return childrenOf(args[0]).map((block) => [block.uid, block.string, block.order, block.open === true]);
    }
    return [];
  };
  host.roam.data.block = {
    move: async ({ location, block }) => {
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
      const current = blocks.get(block.uid);
      if (block.open !== undefined) current.open = block.open === true;
    },
  };
  host.roam.moveBlock = (args) => host.roam.data.block.move(args);
  host.roam.updateBlock = (args) => host.roam.data.block.update(args);
  const restore = installHost(host.roam);
  const palette = new Map();
  try {
    const planTidy = extension.createPlanTidy({
      runningTaskUid: () => null,
      notify() {},
      notifyAction() {},
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
    const result = await palette.get('Nautilus Log: Tidy Primary Plan').callback();
    assert.equal(result.ok, true);
    assert.equal(result.changed, true);
    assert.deepEqual(childrenOf('plan').map((row) => row.uid), [
      'done-a',
      'past-event',
      'active-a',
      'divider',
      'active-b',
    ]);
    assert.equal(host.traces.filter((row) => row === 'query:plan').length, 0);
    assert.ok(host.traces.includes('pull:daily-tree'));
    commands.destroy();
    planTidy.destroy();
  } finally {
    restore();
  }
});

test('timing runtime AND-ready uses reverse pull and keeps CLOCK queries on their own path', async () => {
  const extension = await loadExtension();
  const host = createDailyHost({ nodes: basicTree() });
  const restore = installHost(host.roam);
  try {
    const runtime = extension.createTimingRuntime({
      extensionAPI: {
        settings: {
          get(key) {
            if (key === 'todo-duration') return 15;
            if (key === 'workday-start') return 5;
            if (key === 'workday-end') return 21;
            return null;
          },
          set: async () => {},
        },
      },
      now: () => DATE,
    });
    await runtime.initialize();
    assert.equal(runtime.getSnapshot().planSnapshot.plan.uid, 'plan');
    assert.equal(host.traces.filter((row) => row === 'query:plan').length, 0);
    assert.ok(host.traces.includes('query:entries'));
    assert.ok(host.traces.includes('pull:daily-tree'));
    runtime.destroy();
  } finally {
    restore();
  }
});

test('synthetic Daily sizes compare pull+projection API cost against Datalog fallback', async () => {
  const extension = await loadExtension();
  const evidence = { sizes: [] };
  for (const size of [15, 50, 100, 400]) {
    const nodes = [{ uid: 'plan', string: PLAN, order: 0, parents: ['page'] }];
    for (let index = 0; index < size; index += 1) {
      nodes.push({
        uid: `blk-${index}`,
        string: index % 7 === 0 ? '{{[[TODO]]}} Item 15m' : `note-${index}`,
        order: index,
        parents: [index % 5 === 0 ? 'plan' : 'page'],
      });
    }
    const fastHost = createDailyHost({ nodes });
    const slowHost = createDailyHost({ nodes, pullMode: 'none' });
    delete slowHost.roam.data.pull;
    const restoreFast = installHost(fastHost.roam);
    const fastStarted = performance.now();
    let fastSnap;
    try { fastSnap = extension.readPrimaryPlan(DATE, 15); } finally { restoreFast(); }
    const fastMs = performance.now() - fastStarted;
    const restoreSlow = installHost(slowHost.roam);
    const slowStarted = performance.now();
    let slowSnap;
    try { slowSnap = extension.readPrimaryPlan(DATE, 15); } finally { restoreSlow(); }
    const slowMs = performance.now() - slowStarted;
    assert.equal(fastSnap.plan.uid, slowSnap.plan.uid);
    assert.equal(fastSnap.rows.length, slowSnap.rows.length);
    assert.equal(fastHost.traces.filter((row) => row === 'query:plan').length, 0);
    assert.equal(fastHost.traces.filter((row) => row === 'pull:daily-tree').length, 1);
    assert.equal(slowHost.traces.filter((row) => row === 'query:plan').length, 1);
    evidence.sizes.push({
      size,
      nodes: nodes.length,
      rows: fastSnap.rows.length,
      fastDailyQueries: fastHost.traces.filter((row) => row === 'query:plan').length,
      fastDailyPulls: fastHost.traces.filter((row) => row === 'pull:daily-tree').length,
      fastApiCalls: fastHost.traces.length,
      fallbackDailyQueries: slowHost.traces.filter((row) => row === 'query:plan').length,
      fallbackApiCalls: slowHost.traces.length,
      fastMs: Number(fastMs.toFixed(3)),
      fallbackMs: Number(slowMs.toFixed(3)),
    });
  }
  fs.mkdirSync('/tmp/nautilus-daily-pull-8cb0f0d2', { recursive: true });
  fs.writeFileSync('/tmp/nautilus-daily-pull-8cb0f0d2/synthetic-sizes.json', `${JSON.stringify(evidence, null, 2)}\n`);
  assert.equal(evidence.sizes.length, 4);
});
