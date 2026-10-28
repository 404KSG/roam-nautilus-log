const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let loaded;
const extension = () => loaded ||= import(`data:text/javascript;base64,${Buffer.from(fs.readFileSync(path.join(__dirname, '../extension.js'))).toString('base64')}#strict-reference-import`);

const ROOT = '[[Nautilus Log]] {{[[roam/render]]:((roam-render-Nautilus-Log-cljs))}}';
const SOURCE = 'source-1';
const WRAPPER = 'refwrap-1';
const canonical = `{{[[TODO]]}} ((${SOURCE}))`;
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

async function fixture({ createMode = 'normal', source = {}, sourceRaw, rows: inputRows, planRaw: suppliedPlan, providerShape = 'modern', project = false, realUid = false } = {}) {
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
  const entities = new Map([[SOURCE, sourceNode]]);
  const writes = [];
  let currentUser = 'user-1';
  let currentProvider;
  const planEntity = () => suppliedPlan ? clone(suppliedPlan) : {
    'block/uid': 'plan', 'block/string': ROOT,
    'block/children': rows.map(row => child(row.uid, row.string, row.order)),
  };
  const sourceEntity = node => ({
    'block/uid': node.uid, 'block/string': node.string,
    'block/_children': node.parentUid === undefined ? undefined : [{ 'block/uid': node.parentUid }],
    'block/page': node.pageUid === undefined ? undefined : { 'block/uid': node.pageUid },
    'block/children': node.children === undefined ? undefined : Array.isArray(node.children)
      ? node.children.map(row => ({ 'block/uid': row.uid, 'block/order': row.order, 'block/_children': [{ 'block/uid': node.uid }] })) : node.children,
  });
  const pull = (pattern, lookup) => {
    const uid = lookup?.[1];
    const node = entities.get(uid);
    const entity = uid === 'plan' ? planEntity() : node ? { ...sourceEntity(node), ...(uid === SOURCE ? sourceRaw : {}) } : null;
    return project ? projectPull(pattern, entity) : entity;
  };
  const create = async ({ location, block }) => {
    writes.push({ uid: block.uid, parentUid: location['parent-uid'], order: location.order, string: block.string });
    if (createMode === 'no-op') return;
    rows.splice(location.order, 0, { uid: block.uid, string: block.string, order: location.order });
    rows.forEach((row, index) => { row.order = index; });
    entities.set(block.uid, { uid: block.uid, string: block.string, parentUid: location['parent-uid'], pageUid: 'plan-page', children: [] });
    if (createMode === 'source-edited') sourceNode.string = '{{[[TODO]]}} Externally edited source';
    if (createMode === 'source-moved') sourceNode.parentUid = 'different-parent';
    if (createMode === 'source-deleted') entities.delete(SOURCE);
    if (createMode === 'lost-response') throw new Error('response lost');
  };
  currentProvider = {
    graph: { name: 'desk-fixture', type: 'hosted' }, user: { uid: () => currentUser },
    data: providerShape === 'legacy' ? {} : { pull, block: providerShape === 'no-create' ? {} : { create } },
  };
  const context = () => ({ provider: currentProvider, graphName: 'desk-fixture', graphType: 'hosted', userUid: currentUser });
  const actions = createDeskActions({
    referenceApi: () => currentProvider,
    getContext: context,
    stableReferenceUid: realUid ? undefined : async () => WRAPPER,
    runExclusive: action => action(),
  });
  const call = (overrides = {}) => actions.importReferenceDrop({
    planUid: 'plan', transfer: transfer(), expectedSourceUid: SOURCE, originContext: context(),
    insertion: { kind: 'before', targetUid: 'target-a' }, ...overrides,
  });
  return { actions, rows, sourceNode, entities, writes, call, context, provider: () => currentProvider, setUser: user => { currentUser = user; }, setProvider: provider => { currentProvider = provider; } };
}

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

test('modern adapter creates and readbacks an exact wrapper for before, after, and background positions with hidden rows', async () => {
  const before = await fixture();
  const sourceBefore = clone(before.sourceNode);
  assert.equal((await before.call()).order, 0);
  assert.deepEqual(before.writes, [{ uid: WRAPPER, parentUid: 'plan', order: 0, string: canonical }]);
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

test('unconfirmed no-op retries only verify the reserved UID; a late result is adopted without another create', async () => {
  const f = await fixture({ createMode: 'no-op' });
  await assert.rejects(f.call());
  await assert.rejects(f.call());
  assert.equal(f.writes.length, 1);
  f.rows.unshift({ uid: WRAPPER, string: canonical, order: 0 });
  f.rows.forEach((row, order) => { row.order = order; });
  f.entities.set(WRAPPER, { uid: WRAPPER, string: canonical, parentUid: 'plan', pageUid: 'plan-page', children: [] });
  assert.equal((await f.call()).status, 'existing-reference');
  assert.equal(f.writes.length, 1);
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
