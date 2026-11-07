const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let loaded;
const extension = () => loaded ||= import(`data:text/javascript;base64,${Buffer.from(fs.readFileSync(path.join(__dirname, '../extension.js'))).toString('base64')}#strict-reference-import`);

const ROOT = '[[Nautilus Log]] {{[[roam/render]]:((roam-render-Nautilus-Log-cljs))}}';
const SOURCE = 'source-1';
const WRAPPER = 'refwrap-1';
const canonical = `((${SOURCE}))`;
const legacyCanonical = `{{[[TODO]]}} ${canonical}`;
const embedCanonical = `{{embed-path: ((${SOURCE})) closed}}`;
const clone = value => JSON.parse(JSON.stringify(value));
const transfer = ({ uid = SOURCE, uri = `https://roamresearch.com/#/app/desk-fixture/page/${SOURCE}`, onlyParents = uid, list = uid, files = 0, html = '', types } = {}) => ({
  types: types || ['roam/block-uid-list-only-parents', 'roam/block-uid-list', 'roam/roam-uri-list'],
  files: { length: files },
  getData: type => ({
    'roam/block-uid-list-only-parents': onlyParents,
    'roam/block-uid-list': list,
    'roam/roam-uri-list': uri,
    'text/html': html,
    'text/uri-list': uri,
  })[type] || '',
});

const child = (uid, string, order, parentUid = 'plan') => ({
  'block/uid': uid, 'block/string': string, 'block/order': order,
  'block/_children': [{ 'block/uid': parentUid }],
});

// Model public pull selection, not a mock that returns unrequested attributes.
// This intentionally supports only the explicit attribute/map patterns used here.
const projectPull = (pattern, entity) => {
  const tokens = pattern.match(/[\[\]{}]|:[\w/-]+/g);
  const selection = () => {
    assert.equal(tokens.shift(), '[');
    const fields = {};
    while (tokens[0] !== ']') {
      const token = tokens.shift();
      assert.ok(token, 'unterminated pull pattern');
      if (token === '{') {
        const key = tokens.shift().slice(1);
        fields[key] = selection();
        assert.equal(tokens.shift(), '}');
      } else fields[token.slice(1)] = null;
    }
    tokens.shift();
    return fields;
  };
  const project = (value, fields) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    return Object.fromEntries(Object.entries(fields).filter(([key]) => Object.hasOwn(value, key)).map(([key, nested]) => [key,
      !nested ? value[key] : Array.isArray(value[key]) ? value[key].map(row => project(row, nested)) : project(value[key], nested),
    ]));
  };
  return project(entity, selection());
};

async function fixture({ createMode = 'normal', onCreate, onReserve, source = {}, sourceRaw, rows: inputRows, planRaw: suppliedPlan, providerShape = 'modern', project = false, realUid = false } = {}) {
  const { createDeskActions } = await extension();
  const rows = inputRows || [
    { uid: 'event-row', string: '09:00-10:00 Meeting', order: 0 },
    { uid: 'done-row', string: '{{[[DONE]]}} Finished', order: 1 },
    { uid: 'target-a', string: '{{[[TODO]]}} Existing task', order: 2 },
    { uid: 'target-b', string: '{{[[TODO]]}} Later task', order: 3 },
  ];
  const sourceNode = {
    uid: SOURCE, string: '{{[[TODO]]}} Source task 20m', parentUid: 'outside-parent', pageUid: 'outside-page',
    children: [{ uid: 'source-child', order: 0 }], ...source,
  };
  const entities = new Map([
    [SOURCE, sourceNode],
    ['outside-parent', { uid: 'outside-parent', string: 'Outside parent', parentUid: 'outside-page', pageUid: 'outside-page', children: [] }],
    ['outside-page', { uid: 'outside-page', title: 'Outside page', children: [] }],
    ['plan-page', { uid: 'plan-page', title: 'Plan page', children: [] }],
  ]);
  const writes = [];
  let activeCreateMode = createMode;
  let currentUser = 'user-1';
  let currentProvider;
  const planEntity = () => suppliedPlan ? clone(suppliedPlan) : {
    'block/uid': 'plan', 'block/string': ROOT,
    'block/_children': [{ 'block/uid': 'plan-page' }], 'block/page': { 'block/uid': 'plan-page' },
    'block/children': rows.map(row => child(row.uid, row.string, row.order)),
  };
  const sourceEntity = node => node.title !== undefined ? {
    'block/uid': node.uid, 'node/title': node.title, 'block/children': [],
  } : {
    'block/uid': node.uid, 'block/string': node.string,
    'block/_children': node.parentUid === undefined ? undefined : [{ 'block/uid': node.parentUid }],
    'block/page': node.pageUid === undefined ? undefined : { 'block/uid': node.pageUid },
    ...(node.edited === undefined ? {} : { 'edit/time': node.edited }),
    'block/children': node.children === undefined ? undefined : Array.isArray(node.children)
      ? node.children.map(row => ({ 'block/uid': row.uid, 'block/order': row.order, 'block/_children': [{ 'block/uid': node.uid }] })) : node.children,
  };
  const pull = (pattern, lookup) => {
    const uid = lookup?.[1];
    const node = entities.get(uid);
    const entity = uid === 'plan' ? planEntity() : node ? { ...sourceEntity(node), ...(uid === SOURCE ? sourceRaw : {}) } : null;
    return project ? projectPull(pattern, entity) : entity;
  };
  const create = async ({ location, block }) => {
    writes.push({ uid: block.uid, parentUid: location['parent-uid'], order: location.order, string: block.string });
    onCreate?.({ uid: block.uid, parentUid: location['parent-uid'], order: location.order });
    if (activeCreateMode === 'no-op') return;
    rows.splice(location.order, 0, { uid: block.uid, string: block.string, order: location.order });
    rows.forEach((row, index) => { row.order = index; });
    entities.set(block.uid, { uid: block.uid, string: block.string, parentUid: location['parent-uid'], pageUid: 'plan-page', children: [] });
    if (activeCreateMode === 'legacy-result') {
      rows.find(row => row.uid === block.uid).string = legacyCanonical;
      entities.get(block.uid).string = legacyCanonical;
    }
    if (activeCreateMode === 'source-edited') sourceNode.string = '{{[[TODO]]}} Externally edited source';
    if (activeCreateMode === 'source-moved') sourceNode.parentUid = 'different-parent';
    if (activeCreateMode === 'source-deleted') entities.delete(SOURCE);
    if (activeCreateMode === 'order-shift') {
      const wrapper = rows.splice(rows.findIndex(row => row.uid === block.uid), 1)[0];
      rows.push(wrapper);
      rows.forEach((row, order) => { row.order = order; });
    }
    if (activeCreateMode === 'lost-response') throw new Error('response lost');
  };
  currentProvider = {
    graph: { name: 'desk-fixture', type: 'hosted' }, user: { uid: () => currentUser },
    data: providerShape === 'legacy' ? {} : { pull, block: providerShape === 'no-create' ? {} : { create } },
  };
  const context = () => ({ provider: currentProvider, graphName: 'desk-fixture', graphType: 'hosted', userUid: currentUser });
  const actions = createDeskActions({
    referenceApi: () => currentProvider,
    getContext: context,
    stableReferenceUid: realUid ? undefined : async () => { onReserve?.(); return WRAPPER; },
    runExclusive: action => action(),
  });
  const call = (overrides = {}) => actions.importReferenceDrop({
    planUid: 'plan', transfer: transfer(), expectedSourceUid: SOURCE, originContext: context(),
    insertion: { kind: 'before', targetUid: 'target-a' }, ...overrides,
  });
  return { actions, rows, sourceNode, entities, writes, call, context, provider: () => currentProvider, setCreateMode: mode => { activeCreateMode = mode; }, setUser: user => { currentUser = user; }, setProvider: provider => { currentProvider = provider; } };
}

const addStrictWrapper = (f, string = canonical) => {
  f.rows.unshift({ uid: WRAPPER, string, order: 0 });
  f.rows.forEach((row, order) => { row.order = order; });
  f.entities.set(WRAPPER, { uid: WRAPPER, string, parentUid: 'plan', pageUid: 'plan-page', children: [] });
};
const removeStrictWrapper = (f) => {
  const index = f.rows.findIndex(row => row.uid === WRAPPER);
  assert.notEqual(index, -1, 'strict wrapper is present');
  f.rows.splice(index, 1);
  f.rows.forEach((row, order) => { row.order = order; });
  f.entities.delete(WRAPPER);
};

test('external import preserves its source and creates the native embed-path wrapper', async t => {
  for (const string of ['Ordinary note with **formatting** and a child', '{{[[TODO]]}} Existing task 20m', '{{TODO}} Compact task marker']) {
    await t.test(string, async () => {
      const f = await fixture({ source: { string }, project: true });
      const sourceBefore = clone(f.sourceNode);
      assert.equal((await f.call()).status, 'added');
      assert.deepEqual(f.writes, [{ uid: WRAPPER, parentUid: 'plan', order: 0, string: embedCanonical }]);
      assert.equal(f.rows.find(row => row.uid === WRAPPER).string, embedCanonical);
      assert.deepEqual(f.sourceNode, sourceBefore, 'source text, state, parent and children must remain untouched');
    });
  }
});

test('completed sources are not reopened or silently imported into unfinished Desk', async t => {
  for (const string of ['{{[[DONE]]}} Completed original', '{{DONE}} Compact completed marker']) await t.test(string, async () => {
    const f = await fixture({ source: { string }, project: true });
    const sourceBefore = clone(f.sourceNode), rowsBefore = clone(f.rows);
    await assert.rejects(f.call(), error => error.code === 'source-completed');
    assert.deepEqual(f.rows, rowsBefore);
    assert.deepEqual(f.sourceNode, sourceBefore);
    assert.equal(f.writes.length, 0);
  });
});

test('legacy TODO references remain read-only duplicates rather than being rewritten or duplicated', async () => {
  for (const sourceText of ['Plain source note', '{{[[TODO]]}} Source task', '{{[[DONE]]}} Source completed later']) {
    const f = await fixture({ source: { string: sourceText }, rows: [{ uid: 'legacy-ref', string: legacyCanonical, order: 0 }], project: true });
    const before = clone(f.rows);
    const result = await f.call({ insertion: { kind: 'background' } });
    assert.equal(result.status, 'existing-reference');
    assert.equal(result.wrapperUid, 'legacy-ref');
    assert.deepEqual(f.rows, before);
    assert.equal(f.writes.length, 0);
  }
});

test('late bare/legacy receipts resolve before completed-source eligibility, then removal permits bare re-entry', async t => {
  for (const string of [canonical, legacyCanonical]) await t.test(string, async () => {
    const f = await fixture({ createMode: 'no-op', project: true });
    await assert.rejects(f.call());
    addStrictWrapper(f, string);
    f.sourceNode.string = '{{[[DONE]]}} Source completed while create was pending';
    assert.equal((await f.call()).status, 'existing-reference');
    assert.equal(f.writes.length, 1);
    removeStrictWrapper(f);
    f.sourceNode.string = '{{[[TODO]]}} Source reopened by user';
    f.setCreateMode('normal');
    assert.equal((await f.call()).status, 'added');
    assert.equal(f.writes.length, 2);
    assert.equal(f.rows.find(row => row.uid === WRAPPER).string, embedCanonical);
  });
});

test('a legacy result cannot confirm a requested native embed create, even when its known identity resolves', async () => {
  const f = await fixture({ createMode: 'legacy-result', project: true });
  await assert.rejects(f.call(), /confirm/i);
  assert.equal(f.rows.find(row => row.uid === WRAPPER).string, legacyCanonical);
  removeStrictWrapper(f);
  f.setCreateMode('normal');
  assert.equal((await f.call()).status, 'added');
  assert.equal(f.writes.length, 2);
  assert.equal(f.rows.find(row => row.uid === WRAPPER).string, embedCanonical);
});

test('strict modern seam: import requires data.pull and data.block.create before a write', async () => {
  for (const providerShape of ['legacy', 'no-create']) {
    const f = await fixture({ providerShape });
    await assert.rejects(f.call(), /modern|unavailable|required/i);
    assert.equal(f.writes.length, 0);
  }
});

test('strict exact outline: omitted-middle, noncontiguous, missing-string, malformed-parent, and root mismatch fail before create', async () => {
  const malformed = [
    { 'block/uid': 'plan', 'block/string': ROOT, 'block/children': [child('target-a', '{{[[TODO]]}} A', 0), child('target-b', '{{[[TODO]]}} B', 2)] },
    { 'block/uid': 'plan', 'block/string': ROOT, 'block/children': [child('target-a', '{{[[TODO]]}} A', 0), { 'block/uid': 'target-b', 'block/order': 1, 'block/_children': [{ 'block/uid': 'plan' }] }] },
    { 'block/uid': 'plan', 'block/string': ROOT, 'block/children': [child('target-a', '{{[[TODO]]}} A', 0), child('target-b', '{{[[TODO]]}} B', 1, 'other-parent')] },
    { 'block/uid': 'not-plan', 'block/string': ROOT, 'block/children': [] },
    { 'block/uid': 'plan', 'block/string': '{{[[TODO]]}} not a renderer', 'block/children': [] },
  ];
  for (const planRaw of malformed) {
    const f = await fixture({ planRaw });
    await assert.rejects(f.call());
    assert.equal(f.writes.length, 0);
  }
});

test('strict source classifier rejects renderer/query/embed spellings and malformed source identity before create', async () => {
  const sources = [
    { string: '{{[[embed]]: ((target-2))}} Keep context' },
    { string: '{{embed: ((target-2))}} Keep context' },
    { string: '{{[[query]]: {and: []}}} Keep context' },
    { string: '{{query: {and: []}}} Keep context' },
    { string: '{{[[roam/render]]: ((x))}} Keep context' },
    { string: '{{roam/render: ((x))}} Keep context' },
    { string: '{{[[table]]}} Keep context' },
    { parentUid: [] }, { parentUid: 'outside-parent', children: 'bad' }, { pageUid: null },
    { string: '' }, { string: '09:00-10:00 Event' },
  ];
  for (const source of sources) {
    const f = await fixture({ source });
    await assert.rejects(f.call());
    assert.equal(f.writes.length, 0);
  }
});

test('source ancestry blocks recursive plan embeds while allowing same-page siblings', async () => {
  const cyclic = await fixture();
  cyclic.sourceNode.parentUid = 'inside-parent';
  cyclic.sourceNode.pageUid = 'plan-page';
  cyclic.entities.set('inside-parent', { uid: 'inside-parent', string: 'Inside', parentUid: 'plan', pageUid: 'plan-page', children: [] });
  await assert.rejects(cyclic.call(), error => error.code === 'embed-cycle');
  assert.equal(cyclic.writes.length, 0);

  const sibling = await fixture();
  assert.equal((await sibling.call()).status, 'added');
  assert.equal(sibling.writes.length, 1);
});

test('modern adapter creates and readbacks an exact wrapper for before, after, and background positions with hidden rows', async () => {
  const before = await fixture();
  const sourceBefore = clone(before.sourceNode);
  assert.equal((await before.call()).order, 0);
  assert.deepEqual(before.writes, [{ uid: WRAPPER, parentUid: 'plan', order: 0, string: embedCanonical }]);
  assert.deepEqual(before.sourceNode, sourceBefore);

  const after = await fixture();
  const result = await after.call({ insertion: { kind: 'after', targetUid: 'target-a' } });
  assert.equal(result.order, 3);
  assert.equal(after.rows[3].uid, WRAPPER);

  const background = await fixture();
  const backgroundResult = await background.call({ insertion: { kind: 'background' } });
  assert.equal(backgroundResult.order, 4);
  assert.equal(background.rows[4].uid, WRAPPER);
});

test('empty outline and source/reference duplicates do not broaden or duplicate creates', async () => {
  const empty = await fixture({ rows: [] });
  assert.equal((await empty.call({ insertion: { kind: 'background' } })).order, 0);
  const sourceInPlan = await fixture({ rows: [{ uid: SOURCE, string: '{{[[TODO]]}} Source task', order: 0 }] });
  assert.equal((await sourceInPlan.call()).status, 'existing-source');
  assert.equal(sourceInPlan.writes.length, 0);
  const existingReference = await fixture({ rows: [{ uid: 'existing-ref', string: canonical, order: 0 }] });
  assert.equal((await existingReference.call({ insertion: { kind: 'background' } })).status, 'existing-reference');
  assert.equal(existingReference.writes.length, 0);
});

test('context changes, abort-before-write, no-op results, and source edits/moves/deletion fail closed', async () => {
  const abort = await fixture();
  await assert.rejects(abort.call({ signal: { aborted: true } }));
  assert.equal(abort.writes.length, 0);
  for (const createMode of ['no-op', 'source-edited', 'source-moved', 'source-deleted']) {
    const f = await fixture({ createMode });
    await assert.rejects(f.call());
    assert.equal(f.writes.length, 1);
  }
  const userChanged = await fixture();
  const original = userChanged.context();
  userChanged.setUser('user-2');
  await assert.rejects(userChanged.call({ originContext: original }), /graph|user|context/i);
  assert.equal(userChanged.writes.length, 0);
  const providerChanged = await fixture();
  const providerOrigin = providerChanged.context();
  providerChanged.setProvider({ graph: { name: 'desk-fixture', type: 'hosted' }, user: { uid: () => 'user-1' }, data: { pull: () => null, block: { create: async () => {} } } });
  await assert.rejects(providerChanged.call({ originContext: providerOrigin }), /provider|graph|context/i);
  assert.equal(providerChanged.writes.length, 0);
});

test('public pull projection supplies every field required for successful nonempty-plan imports', async () => {
  const f = await fixture({ project: true });
  assert.equal((await f.call()).status, 'added');
  assert.equal(f.writes.length, 1);
});

test('unordered cardinality-many children are sorted by validated order, never by pull enumeration', async () => {
  const rows = [
    child('target-b', '{{[[TODO]]}} B', 1),
    child('target-a', '{{[[TODO]]}} A', 0),
  ];
  const f = await fixture({ planRaw: { 'block/uid': 'plan', 'block/string': ROOT, 'block/children': rows } });
  // Duplicate detection is read-only: do not mutate a fixed raw outline fixture.
  rows[0]['block/string'] = canonical;
  assert.equal((await f.call()).status, 'existing-reference');
  assert.equal(f.writes.length, 0);
});

test('malformed source metadata is rejected with zero writes, not silently normalized', async t => {
  const parent = { 'block/uid': 'outside-parent' };
  const c = (uid, order) => ({ 'block/uid': uid, 'block/order': order, 'block/_children': [{ 'block/uid': SOURCE }] });
  const cases = {
    'duplicate parent': { 'block/_children': [parent, parent] },
    'multiple parents': { 'block/_children': [parent, { 'block/uid': 'other-parent' }] },
    'duplicate child UID': { 'block/children': [c('child-a', 0), c('child-a', 1)] },
    'duplicate child order': { 'block/children': [c('child-a', 0), c('child-b', 0)] },
    'missing middle child': { 'block/children': [c('child-a', 0), c('child-b', 2)] },
    'missing first child': { 'block/children': [c('child-a', 1)] },
    'non-array children': { 'block/children': { uid: 'child-a', order: 0 } },
    'malformed child UID': { 'block/children': [c(' ', 0)] },
    'missing child order': { 'block/children': [c('child-a', undefined)] },
    'negative child order': { 'block/children': [c('child-a', -1)] },
    'fractional child order': { 'block/children': [c('child-a', 0.5)] },
    'wrong child parent': { 'block/children': [{ ...c('child-a', 0), 'block/_children': [parent] }] },
  };
  for (const [name, sourceRaw] of Object.entries(cases)) await t.test(name, async () => {
    const f = await fixture({ sourceRaw });
    await assert.rejects(f.call());
    assert.equal(f.writes.length, 0);
  });
});

test('malformed reserved UID occupancy is not mistaken for an absent block', async () => {
  const f = await fixture();
  f.entities.set(WRAPPER, { uid: WRAPPER, string: 'Externally owned block', pageUid: 'other-page', children: [] });
  const before = clone(f.entities.get(WRAPPER));
  await assert.rejects(f.call());
  assert.equal(f.writes.length, 0);
  assert.deepEqual(f.entities.get(WRAPPER), before);
});

test('unsupported payload matrix fails before create', async t => {
  const cases = {
    'multiple parent UIDs': { onlyParents: `${SOURCE}\nsource-2` },
    'multiple full-list UIDs': { list: `${SOURCE}\nsource-2` },
    'disagreeing UID fields': { list: 'source-2' },
    'malformed nonempty secondary field': { list: 'x'.repeat(32769) },
    'files': { files: 1 },
    'cross graph': { uri: `https://roamresearch.com/#/app/other-graph/page/${SOURCE}` },
    'cross graph type': { uri: `roam:///#/offline/desk-fixture/page/${SOURCE}` },
    'URL only': { onlyParents: '', list: '', uri: 'https://example.invalid/', types: ['text/uri-list'] },
    'HTML only': { onlyParents: '', list: '', uri: '', html: '<div>source</div>', types: ['text/html'] },
    'malformed URI': { uri: 'not a native URL' },
    'mismatched URI': { uri: 'https://roamresearch.com/#/app/desk-fixture/page/source-2' },
    'extra URI from another block': { uri: `https://roamresearch.com/#/app/desk-fixture/page/${SOURCE}\nhttps://roamresearch.com/#/app/desk-fixture/page/source-2` },
  };
  for (const [name, payload] of Object.entries(cases)) await t.test(name, async () => {
    const f = await fixture();
    await assert.rejects(f.call({ transfer: transfer(payload) }));
    assert.equal(f.writes.length, 0);
  });
});

test('real SHA-256 UID is stable across fresh action owners and independent of user identity', async () => {
  const first = await fixture({ realUid: true, project: true });
  const second = await fixture({ realUid: true, project: true });
  second.setUser('another-user');
  const a = await first.call();
  const b = await second.call();
  assert.match(a.wrapperUid, /^[A-Za-z0-9_-]{9}$/);
  assert.equal(a.wrapperUid, b.wrapperUid);
  assert.equal(a.wrapperUid, require('node:crypto').createHash('sha256')
    .update(`nautilus-reference-v1\u0000hosted\u0000desk-fixture\u0000plan\u0000${SOURCE}`).digest('base64url').slice(0, 9));
});

test('an occupied deterministic UID is never overwritten or replaced with a fallback UID', async () => {
  const f = await fixture();
  f.entities.set(WRAPPER, { uid: WRAPPER, string: 'Existing unrelated content', parentUid: 'other-parent', pageUid: 'other-page', children: [] });
  const before = clone(f.entities.get(WRAPPER));
  await assert.rejects(f.call(), /collision/i);
  await assert.rejects(f.call(), /collision/i);
  assert.equal(f.writes.length, 0);
  assert.deepEqual(f.entities.get(WRAPPER), before);
});

test('missing graph type or user identity is rejected at admission', async () => {
  for (const field of ['graphType', 'userUid']) {
    const f = await fixture();
    await assert.rejects(f.call({ originContext: { ...f.context(), [field]: '' } }));
    assert.equal(f.writes.length, 0);
  }
});

test('lost create response is confirmed by readback; repeat and reload reuse the same wrapper without a second create', async () => {
  const f = await fixture({ createMode: 'lost-response' });
  const sourceBefore = clone(f.sourceNode);
  assert.equal((await f.call()).status, 'added');
  assert.equal((await f.call()).wrapperUid, WRAPPER);
  f.actions.destroy();
  const { createDeskActions } = await extension();
  const reloaded = createDeskActions({ referenceApi: f.provider, getContext: f.context, stableReferenceUid: async () => WRAPPER, runExclusive: action => action() });
  const result = await reloaded.importReferenceDrop({ planUid: 'plan', transfer: transfer(), expectedSourceUid: SOURCE, originContext: f.context(), insertion: { kind: 'background' } });
  assert.equal(result.wrapperUid, WRAPPER);
  assert.equal(result.status, 'existing-reference');
  assert.equal(f.writes.length, 1);
  assert.deepEqual(f.sourceNode, sourceBefore);
});

test('confirmed reference re-entry reuses its deterministic UID after removal, even when the source later changes', async () => {
  const f = await fixture();
  assert.equal((await f.call()).status, 'added');
  f.sourceNode.string = '{{[[TODO]]}} Edited source task 30m';
  assert.equal((await f.call()).status, 'existing-reference');
  assert.equal(f.writes.length, 1);
  removeStrictWrapper(f);
  const readded = await f.call();
  assert.equal(readded.status, 'added');
  assert.equal(readded.wrapperUid, WRAPPER);
  assert.equal(f.writes.length, 2);
});

test('unconfirmed no-op retries only verify the reserved UID; late strict adoption releases it for removal and re-entry', async () => {
  const f = await fixture({ createMode: 'no-op' });
  await assert.rejects(f.call());
  await assert.rejects(f.call());
  assert.equal(f.writes.length, 1);
  addStrictWrapper(f);
  assert.equal((await f.call()).status, 'existing-reference');
  assert.equal(f.writes.length, 1);
  removeStrictWrapper(f);
  f.setCreateMode('normal');
  const readded = await f.call();
  assert.equal(readded.status, 'added');
  assert.equal(readded.wrapperUid, WRAPPER);
  assert.equal(f.writes.length, 2);
});

test('late strict wrapper adoption also resolves when its source was moved directly into the plan', async () => {
  const f = await fixture({ createMode: 'no-op' });
  await assert.rejects(f.call());
  addStrictWrapper(f);
  f.sourceNode.parentUid = 'plan';
  f.sourceNode.pageUid = 'plan-page';
  f.rows.push({ uid: SOURCE, string: f.sourceNode.string, order: f.rows.length });
  const adopted = await f.call();
  assert.ok(['existing-source', 'existing-reference'].includes(adopted.status));
  assert.equal(adopted.sourceUid, SOURCE);
  assert.equal(f.writes.length, 1);
  removeStrictWrapper(f);
  f.rows.splice(f.rows.findIndex(row => row.uid === SOURCE), 1);
  f.rows.forEach((row, order) => { row.order = order; });
  f.sourceNode.parentUid = 'outside-parent';
  f.sourceNode.pageUid = 'outside-page';
  f.setCreateMode('normal');
  const readded = await f.call();
  assert.equal(readded.status, 'added');
  assert.equal(readded.wrapperUid, WRAPPER);
  assert.equal(f.writes.length, 2);
});

test('a direct source alone does not resolve an attempted deterministic reservation', async () => {
  const f = await fixture({ createMode: 'no-op' });
  await assert.rejects(f.call());
  f.sourceNode.parentUid = 'plan';
  f.sourceNode.pageUid = 'plan-page';
  f.rows.push({ uid: SOURCE, string: f.sourceNode.string, order: f.rows.length });
  assert.equal((await f.call()).status, 'existing-source');
  f.rows.pop();
  f.sourceNode.parentUid = 'outside-parent';
  f.sourceNode.pageUid = 'outside-page';
  await assert.rejects(f.call(), /confirm/i);
  assert.equal(f.writes.length, 1);
});

test('strict post-create adoption resolves identity but still reports source or order changes', async t => {
  for (const createMode of ['source-edited', 'source-moved', 'order-shift']) await t.test(createMode, async () => {
    const f = await fixture({ createMode });
    await assert.rejects(f.call(), /confirm/i);
    assert.equal(f.writes.length, 1);
    removeStrictWrapper(f);
    if (createMode === 'source-moved') {
      f.sourceNode.parentUid = 'outside-parent';
      f.sourceNode.pageUid = 'outside-page';
    }
    f.setCreateMode('normal');
    assert.equal((await f.call()).status, 'added');
    assert.equal(f.writes.length, 2);
  });
});

test('a different-UID duplicate does not resolve an attempted deterministic reservation', async () => {
  const f = await fixture({ createMode: 'no-op' });
  await assert.rejects(f.call());
  f.rows.unshift({ uid: 'other-ref', string: canonical, order: 0 });
  f.rows.forEach((row, order) => { row.order = order; });
  assert.equal((await f.call()).wrapperUid, 'other-ref');
  f.rows.splice(f.rows.findIndex(row => row.uid === 'other-ref'), 1);
  f.rows.forEach((row, order) => { row.order = order; });
  await assert.rejects(f.call(), /confirm/i);
  assert.equal(f.writes.length, 1);
});

test('cancellation after host invocation retains verification-only state until a late strict wrapper is observed', async () => {
  const signal = { aborted: false };
  const f = await fixture({ createMode: 'no-op', onCreate: () => { signal.aborted = true; } });
  await assert.rejects(f.call({ signal }), /cancelled/i);
  assert.equal(f.writes.length, 1);
  signal.aborted = false;
  addStrictWrapper(f);
  assert.equal((await f.call()).status, 'existing-reference');
  removeStrictWrapper(f);
  f.setCreateMode('normal');
  assert.equal((await f.call()).status, 'added');
  assert.equal(f.writes.length, 2);
});

test('two importer instances in the shared exclusive lane serialize to one deterministic create', async () => {
  const f = await fixture();
  const { createDeskActions } = await extension();
  let tail = Promise.resolve();
  const lane = action => { const next = tail.then(action); tail = next.catch(() => {}); return next; };
  const first = createDeskActions({ referenceApi: f.provider, getContext: f.context, stableReferenceUid: async () => WRAPPER, runExclusive: lane });
  const second = createDeskActions({ referenceApi: f.provider, getContext: f.context, stableReferenceUid: async () => WRAPPER, runExclusive: lane });
  const request = insertion => ({ planUid: 'plan', transfer: transfer(), expectedSourceUid: SOURCE, originContext: f.context(), insertion });
  const [a, b] = await Promise.all([
    first.importReferenceDrop(request({ kind: 'before', targetUid: 'target-a' })),
    second.importReferenceDrop(request({ kind: 'after', targetUid: 'target-b' })),
  ]);
  assert.equal(a.status, 'added');
  assert.equal(b.status, 'existing-reference');
  assert.equal(f.writes.length, 1);
});

function nestedSource(f, uid, string, extra = {}) {
  const node = { uid, string, parentUid: 'outside-parent', pageUid: 'outside-page', children: [], ...extra };
  f.entities.set(uid, node);
  return node;
}

test('reference-block imports retain the dragged UID while resolving bounded reusable content', async t => {
  const cases = [
    ['pure', '((nested-01))', '{{[[TODO]]}} Nested source 20m'],
    ['two-hop', '((nested-02))', '{{[[TODO]]}} Nested source 20m'],
    ['local TODO', '{{[[TODO]]}} ((nested-01)) 30m', '{{[[TODO]]}} Nested source 20m'],
    ['local TODO over DONE', '{{[[TODO]]}} ((nested-01)) 30m', '{{[[DONE]]}} Nested source 20m'],
    ['contextual', 'Review ((nested-01)) 10m', '{{[[TODO]]}} Nested source 20m'],
    ['known empty reference with local prose', 'Review ((nested-01)) 10m', ''],
  ];
  for (const [name, string, nested] of cases) await t.test(name, async () => {
    const f = await fixture({ source: { string }, project: true });
    nestedSource(f, 'nested-01', nested); nestedSource(f, 'nested-02', '((nested-01))');
    const before = [SOURCE, 'nested-01', 'nested-02'].map(uid => clone(f.entities.get(uid)));
    const result = await f.call();
    assert.equal(result.status, 'added');
    assert.equal(result.sourceUid, SOURCE);
    assert.equal(f.writes.length, 1);
    assert.equal(f.writes[0].string, embedCanonical, 'embed the dragged reference block, not its ultimate source');
    assert.deepEqual([SOURCE, 'nested-01', 'nested-02'].map(uid => f.entities.get(uid)), before);
  });
});

test('inherited and explicit DONE reference blocks are rejected without writing a task marker', async t => {
  for (const [string, nested] of [['((nested-01))', '{{[[DONE]]}} Completed source'], ['{{[[DONE]]}} ((nested-01))', '{{[[TODO]]}} Open source']]) {
    await t.test(string, async () => {
      const f = await fixture({ source: { string }, project: true }); nestedSource(f, 'nested-01', nested);
      await assert.rejects(f.call(), error => error.code === 'source-completed');
      assert.equal(f.writes.length, 0); assert.equal(f.sourceNode.string, string);
    });
  }
});

test('missing, cyclic, unsupported and event reference dependencies fail before creating', async t => {
  const cases = [
    ['missing', 'Task ((missing-01))', f => {}, 'reference-unavailable'],
    ['self-cycle', 'Task ((source-1))', f => {}, 'reference-cycle'],
    ['nested-cycle', 'Task ((nested-01))', f => nestedSource(f, 'nested-01', '((source-1))'), 'reference-cycle'],
    ['unsupported', '((nested-01))', f => nestedSource(f, 'nested-01', '{{[[query]]: {and: [[TODO]]}}}'), 'invalid-source'],
    ['event', '((nested-01))', f => nestedSource(f, 'nested-01', '09:00-10:00 Fixed event'), 'not-a-task'],
  ];
  for (const [name, string, setup, code] of cases) await t.test(name, async () => {
    const f = await fixture({ source: { string }, project: true }); setup(f);
    await assert.rejects(f.call(), error => error.code === code);
    assert.equal(f.writes.length, 0);
  });
});

test('reference depth, unique-node, expansion and text budgets are enforced before writes', async t => {
  for (const length of [8, 9]) await t.test(`${length} levels including dragged source`, async () => {
    const f = await fixture({ source: { string: '((depth-01))' }, project: true });
    for (let i = 1; i < length; i++) nestedSource(f, `depth-${String(i).padStart(2, '0')}`, i === length - 1 ? '{{[[TODO]]}} Leaf task 20m' : `((${`depth-${String(i + 1).padStart(2, '0')}`}))`);
    if (length === 8) { assert.equal((await f.call()).status, 'added'); assert.equal(f.writes.length, 1); }
    else { await assert.rejects(f.call(), error => error.code === 'reference-limit'); assert.equal(f.writes.length, 0); }
  });
  await t.test('129 distinct blocks', async () => {
    const f = await fixture({ source: { string: Array.from({ length: 128 }, (_, i) => `((node-${String(i).padStart(3, '0')}))`).join(' ') }, project: true });
    for (let i = 0; i < 128; i++) nestedSource(f, `node-${String(i).padStart(3, '0')}`, 'Task');
    await assert.rejects(f.call(), error => error.code === 'reference-limit'); assert.equal(f.writes.length, 0);
  });
  await t.test('bounded expansion despite reused UIDs', async () => {
    const f = await fixture({ source: { string: Array(32).fill('((nested-01))').join(' ') }, project: true });
    nestedSource(f, 'nested-01', Array(32).fill('((nested-02))').join(' ')); nestedSource(f, 'nested-02', 'Task');
    await assert.rejects(f.call(), error => error.code === 'reference-limit'); assert.equal(f.writes.length, 0);
  });
  await t.test('bounded referenced text', async () => {
    const f = await fixture({ source: { string: '((nested-01))' }, project: true }); nestedSource(f, 'nested-01', 'x'.repeat(2 * 1024 * 1024));
    await assert.rejects(f.call(), error => error.code === 'reference-limit'); assert.equal(f.writes.length, 0);
  });
  await t.test('bounded expanded text despite a small distinct snapshot', async () => {
    const f = await fixture({ source: { string: Array(4).fill('((nested-01))').join(' ') }, project: true });
    nestedSource(f, 'nested-01', 'x'.repeat(600000));
    await assert.rejects(f.call(), error => error.code === 'reference-limit'); assert.equal(f.writes.length, 0);
  });
  await t.test('bounded child membership', async () => {
    const f = await fixture({ source: { children: Array.from({ length: 2049 }, (_, order) => ({ uid: `child-${order}`, order })) }, project: true });
    await assert.rejects(f.call(), error => error.code === 'reference-limit'); assert.equal(f.writes.length, 0);
  });
  await t.test('cached dependency height still counts on a deeper route', async () => {
    const f = await fixture({ source: { string: '((shared-node)) ((branch-01))' }, project: true });
    nestedSource(f, 'shared-node', '((shared-leaf))'); nestedSource(f, 'shared-leaf', 'Leaf task');
    for (let i = 1; i <= 6; i++) nestedSource(f, `branch-${String(i).padStart(2, '0')}`, i === 6 ? '((shared-node))' : `((branch-${String(i + 1).padStart(2, '0')}))`);
    await assert.rejects(f.call(), error => error.code === 'reference-limit'); assert.equal(f.writes.length, 0);
  });
});

test('changes to any nested dependency across UID reservation prevent the create', async t => {
  const changes = {
    text: node => { node.string = '{{[[TODO]]}} Changed source'; },
    status: node => { node.string = '{{[[DONE]]}} Source completed'; },
    parent: node => { node.parentUid = 'changed-parent'; },
    page: node => { node.pageUid = 'changed-page'; },
    children: node => { node.children.push({ uid: 'changed-child', order: 0 }); },
    edited: node => { node.edited = 2; },
  };
  for (const [name, change] of Object.entries(changes)) await t.test(name, async () => {
    let f; f = await fixture({ source: { string: '((nested-01))' }, project: true, onReserve: () => change(f.entities.get('nested-01')) });
    nestedSource(f, 'nested-01', '{{[[TODO]]}} Nested task 20m', { edited: 1 });
    await assert.rejects(f.call(), error => ['source-changed', 'source-completed'].includes(error.code));
    assert.equal(f.writes.length, 0);
  });
});

test('nested source changes after an issued create warn without duplicating the wrapper', async () => {
  let f; f = await fixture({ source: { string: '((nested-01))' }, project: true,
    onCreate: () => { f.entities.get('nested-01').string = '{{[[TODO]]}} Changed after dispatch 20m'; } });
  nestedSource(f, 'nested-01', '{{[[TODO]]}} Nested task 20m');
  await assert.rejects(f.call(), error => error.code === 'unconfirmed');
  assert.equal(f.writes.length, 1); assert.equal(f.entities.get(WRAPPER).string, embedCanonical);
  assert.equal((await f.call()).status, 'existing-reference'); assert.equal(f.writes.length, 1);
});

test('missing dependency after create remains unconfirmed and never creates a second wrapper', async () => {
  let f; f = await fixture({ source: { string: '((nested-01))' }, project: true,
    onCreate: () => { f.entities.delete('nested-01'); } });
  nestedSource(f, 'nested-01', '{{[[TODO]]}} Nested task 20m');
  await assert.rejects(f.call(), error => error.code === 'unconfirmed');
  assert.equal(f.writes.length, 1); assert.equal(f.entities.get(WRAPPER).string, embedCanonical);
  await assert.rejects(f.call(), error => error.code === 'reference-unavailable'); assert.equal(f.writes.length, 1);
  nestedSource(f, 'nested-01', '{{[[TODO]]}} Nested task 20m');
  assert.equal((await f.call()).status, 'existing-reference'); assert.equal(f.writes.length, 1);
});

test('a lost reference-import response is confirmed only from the same wrapper and dependency snapshot', async () => {
  const f = await fixture({ source: { string: '((nested-01))' }, project: true, createMode: 'lost-response' });
  nestedSource(f, 'nested-01', '{{[[TODO]]}} Nested task 20m');
  assert.equal((await f.call()).status, 'added'); assert.equal(f.writes.length, 1);
});

test('source eligibility avoids pulling descendant text that is not part of the source evidence', async () => {
  let descendantTextReads = 0;
  const rawChild = { 'block/uid': 'source-child', 'block/order': 0, 'block/_children': [{ 'block/uid': SOURCE }] };
  Object.defineProperty(rawChild, 'block/string', { enumerable: true, get() { descendantTextReads += 1; return 'Unneeded descendant body'; } });
  const f = await fixture({ sourceRaw: { 'block/children': [rawChild] }, project: true });
  assert.equal((await f.call()).status, 'added');
  assert.equal(descendantTextReads, 0);
  assert.equal(f.writes.length, 1);
});

test('a user change during a nested public pull stops the import before writing', async () => {
  const f = await fixture({ source: { string: '((nested-01))' }, project: true }); nestedSource(f, 'nested-01', '{{[[TODO]]}} Nested task 20m');
  const api = f.provider(), pull = api.data.pull;
  api.data.pull = (pattern, lookup) => { const value = pull(pattern, lookup); if (lookup[1] === 'nested-01') f.setUser('changed-user'); return value; };
  await assert.rejects(f.call(), error => error.code === 'context-changed'); assert.equal(f.writes.length, 0);
});
