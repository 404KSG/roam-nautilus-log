const test = require('node:test');
const assert = require('node:assert/strict');
const { projectPull } = require('./pull-projection.cjs');
const {
  readDeskPreview, createModernDeskPreviewAdapter, buildDeskFullPreview,
} = require('../src/desk-core');
const { parseDeskPreviewText, pureDeskReferenceUid } = require('../src/desk-preview');

const image = (name = 'image') => `![${name}](https://example.test/${name}.png)`;
const rows = (...values) => values.map((string, order) => ({ uid: `row-${order}`, string, order }));

test('full Desk preview renders root plus eleven counted rows and marks the twelfth hidden', () => {
  const result = readDeskPreview('root', (uid) => uid === 'root' ? rows(...Array.from({ length: 12 }, (_, i) => `Row ${i}`)) : []);
  assert.equal(result.rows.length, 11);
  assert.equal(result.rows[0].text, 'Row 0');
  assert.equal(result.rows.at(-1).text, 'Row 10');
  assert.equal(result.more, true);
});

test('preview distinguishes absent open from explicit false and records hidden descendants', () => {
  const tree = {
    root: [
      { uid: 'open-by-default', string: 'Open by default', order: 1 },
      { uid: 'closed', string: 'Closed', order: 0, open: false },
    ],
    'open-by-default': [{ uid: 'visible-child', string: 'Visible child', order: 0 }],
    closed: [{ uid: 'hidden-child', string: 'Hidden child', order: 0 }],
  };
  const result = readDeskPreview('root', (uid) => tree[uid] || []);
  assert.deepEqual(result.rows.map((row) => [row.text, row.depth]), [['Closed', 1], ['Open by default', 1], ['Visible child', 2]]);
  assert.equal(result.more, true);
});

test('preview uses projected depth-two membership for ellipsis without reading depth-three content', () => {
  const reads = [];
  const result = readDeskPreview('root', (uid) => {
    reads.push(uid);
    return uid === 'root' ? [{ uid: 'parent', string: 'Parent', order: 0, children: [
      { uid: 'nested', string: 'Nested', order: 0, children: [{ uid: 'deep', order: 0 }] },
    ] }] : [];
  });
  assert.deepEqual(result.rows.map((row) => [row.text, row.depth]), [['Parent', 1], ['Nested', 2]]);
  assert.equal(result.more, true);
  assert.deepEqual(reads, ['root']);
});

test('preview grants only three raw image-only rows a budget exemption and prunes image leaves without dropping images', () => {
  const source = [image('one'), image('two'), image('three'), image('four'), 'Counted'];
  const result = readDeskPreview('root', (uid) => uid === 'root' ? rows(...source) : [], 1);
  assert.equal(result.rows.length, 0, 'blank image leaves are pruned after traversal');
  assert.equal(result.more, true, 'the fifth row remains after the fourth image consumes the only counted row');
  assert.deepEqual(result.images.map((entry) => entry.src), [
    'https://example.test/one.png', 'https://example.test/two.png', 'https://example.test/three.png', 'https://example.test/four.png',
  ]);
});

test('preview retains an image-only hierarchy parent for a nested retained row and deduplicates final image URLs stably', () => {
  const repeated = image('same');
  const tree = {
    root: [{ uid: 'image-parent', string: repeated, order: 0 }],
    'image-parent': [{ uid: 'text-child', string: `Child ${repeated}`, order: 0 }],
  };
  const result = readDeskPreview('root', (uid) => tree[uid] || [], 11, () => '', repeated);
  assert.deepEqual(result.rows.map((row) => [row.text, row.depth]), [['', 1], ['Child', 2]]);
  assert.deepEqual(result.images.map((entry) => entry.src), ['https://example.test/same.png']);
});

test('preview uses source descendants only for a childless TODO-or-plain reference wrapper', () => {
  const tree = {
    root: [], source: [{ uid: 'source-child', string: 'Source descendant', order: 0 }],
    local: [{ uid: 'local-child', string: 'Local descendant', order: 0 }],
  };
  const pure = readDeskPreview('root', (uid) => tree[uid] || [], 11, (uid) => uid === 'source' ? 'Source root' : null, '{{TODO}} ((source))');
  assert.deepEqual(pure.rows.map((row) => row.text), ['Source descendant']);
  const contextual = readDeskPreview('root', (uid) => tree[uid] || [], 11, (uid) => uid === 'source' ? 'Source root' : null, 'Review ((source))');
  assert.deepEqual(contextual.rows, []);
  const local = readDeskPreview('local', (uid) => tree[uid] || [], 11, () => 'Source root', '((source))');
  assert.deepEqual(local.rows.map((row) => row.text), ['Local descendant']);
});

test('parser keeps code/prose segment-local, aliases exact, and rejects multiple TODO wrappers', () => {
  assert.equal(parseDeskPreviewText('[[Alpha]] `literal` tail').text, 'Alpha `literal` tail');
  assert.equal(parseDeskPreviewText('[Jump](((source-1)))').text, 'Jump');
  assert.equal(pureDeskReferenceUid('{{TODO}} {{TODO}} ((source-1))'), null);
  assert.throws(() => parseDeskPreviewText('((source-1))', { readString: () => { throw new Error('unavailable'); } }), /unavailable/);
});

test('strict preview ordering rejects negative and gapped child orders', () => {
  for (const order of [-1, 7]) assert.throws(() => readDeskPreview('root', () => [{ uid: 'child', string: 'Child', order }]), /Preview unavailable/);
});

test('projection-aware preview uses public pull fields, supports page fallback, rejects malformed children, and keeps cycles/code inert', () => {
  const entities = new Map([
    ['root', { 'block/uid': 'root', 'block/string': '`((source))` ((source))', 'block/order': 0, 'block/children': [{ 'block/uid': 'line', 'block/string': 'Line', 'block/order': 0 }] }],
    ['line', { 'block/uid': 'line', 'block/string': 'Line', 'block/order': 0, 'block/children': [] }],
    ['root-empty', { 'block/uid': 'root-empty', 'block/string': '', 'block/order': 0, 'block/children': [] }],
    ['source', { 'block/uid': 'source', 'block/string': '((root))', 'block/order': 0, 'block/children': [] }],
    ['page-source', { 'block/uid': 'page-source', ':node/title': 'Page source', 'block/children': [{ 'block/uid': 'page-child', 'block/string': 'Page descendant', 'block/order': 0 }] }],
    ['page-child', { 'block/uid': 'page-child', 'block/string': 'Page descendant', 'block/order': 0, 'block/children': [] }],
  ]);
  const pulls = [];
  const adapter = createModernDeskPreviewAdapter({ data: { pull(pattern, lookup) {
    pulls.push({ pattern, lookup });
    return projectPull(pattern, entities.get(lookup[1]) || null, value => ({ ...entities.get(value['block/uid']), ...value }));
  } } });
  const model = buildDeskFullPreview({ uid: 'root', adapter });
  assert.equal(model.root.text, '`((source))` ((root))');
  assert.ok(pulls.every(({ pattern }) => pattern.includes(':block/uid') && pattern.includes(':block/children') && pattern.includes(':block/open')));
  entities.get('root-empty')['block/string'] = '((page-source))'; adapter.clear();
  const page = buildDeskFullPreview({ uid: 'root-empty', adapter });
  assert.deepEqual(page.rows.map((row) => row.text), ['Page descendant']);
  entities.get('root-empty')['block/string'] = '((missing-source))'; adapter.clear();
  const missing = buildDeskFullPreview({ uid: 'root-empty', adapter });
  assert.equal(missing.empty, false);
  assert.equal(missing.root.text, '(missing)');
  const malformed = createModernDeskPreviewAdapter({ data: { pull: () => ({ 'block/uid': 'bad', 'block/string': 'Bad', 'block/order': 0, 'block/children': {} }) } });
  assert.throws(() => buildDeskFullPreview({ uid: 'bad', adapter: malformed }), /Preview unavailable/);
});
