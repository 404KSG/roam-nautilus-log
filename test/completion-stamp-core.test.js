const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const core = require('../src/completion-stamp-core');
const digest = text => createHash('sha256').update(text).digest('hex');
const scope = { graph: 'graph', graphType: 'hosted', userUid: 'user' };
const receipt = (uid = 'task00001', extra = {}) => ({ v: 1, alg: 'sha256', ...scope, uid,
  token: 'd09:05', bodyHash: digest('{{STATE}} Task'), at: 1, ...extra });

test('completion uses one 24-hour tail while preserving foreign, malformed and code-literal time fields', () => {
  assert.equal(core.tokenFor(new Date(2026, 10, 1, 9, 5)), 'd09:05');
  assert.equal(core.tokenFor(new Date(2026, 10, 1, 0, 0)), 'd00:00');
  assert.deepEqual(core.completionMutation('{{[[TODO]]}} Task 30m', 'd09:05'), { kind: 'stamp', string: '{{[[DONE]]}} Task 30m d09:05' });
  for (const text of ['Manual d09:05', 'Legacy d9:5', '`d09:05`', 'Invalid d25:00', 'Invalid d10:31pm', 'Duplicate d09:05 d09:06', 'Trailing whitespace ']) {
    const before = `{{[[TODO]]}} ${text}`;
    assert.deepEqual(core.completionMutation(before, 'd10:00'), { kind: 'preserve', string: before.replace('TODO', 'DONE') }, text);
  }
  assert.throws(() => core.completionMutation('{{[[TODO]]}} Task', 'd25:00'), /Invalid/);
});

test('reference IDs, URLs, words and legacy progress do not masquerade as a completion field', () => {
  for (const body of ['read123', '((abcd12345))', '((aa-d12-ab))', 'https://example.invalid/d12/path', 'Progress d50%', 'Progress d10%']) {
    assert.equal(core.completionMutation(`{{[[TODO]]}} ${body}`, 'd09:05').kind, 'stamp', body);
  }
});

test('native transitions require one actual marker and exactly unchanged body text', () => {
  assert.equal(core.nativeTransition('{{TODO}} Task', '{{[[DONE]]}} Task'), 'complete');
  assert.equal(core.nativeTransition('{{[[DONE]]}} Task', '{{TODO}} Task'), 'reopen');
  assert.equal(core.nativeTransition('{{[[TODO]]}} Task', '{{[[DONE]]}} Edited task'), null);
  assert.equal(core.nativeTransition('{{[[TODO]]}} Task', '{{[[DONE]]}} Task d09:05'), null);
  assert.equal(core.nativeTransition('{{TODO}} A {{TODO}} B', '{{DONE}} A {{TODO}} B'), null);
  assert.equal(core.nativeTransition('Task', '{{[[DONE]]}} Task'), null);
  assert.equal(core.nativeTransition('{{TODO}} Task', '{{TODO}} Task'), null);
});

test('receipt hashes normalize marker syntax but preserve task body and whitespace', () => {
  const body = core.normalizedReceiptBody('{{[[DONE]]}} Task d09:05');
  assert.equal(body, '{{STATE}} Task');
  assert.equal(core.normalizedReceiptBody('{{TODO}} Task d09:05'), body);
  assert.equal(core.normalizedReceiptBody('{{[[DONE]]}} A  d09:05'), '{{STATE}} A ');
  assert.equal(core.receiptMatches(receipt(), scope, 'task00001', '{{[[DONE]]}} Task d09:05', digest(body)), true);
  for (const changed of ['{{[[DONE]]}} Edited task d09:05', '{{[[DONE]]}} Task  d09:05', '{{[[DONE]]}} Task d09:06']) {
    assert.equal(core.receiptMatches(receipt(), scope, 'task00001', changed, digest(core.normalizedReceiptBody(changed))), false);
  }
});

test('receipt parsing rejects the whole store rather than dropping corrupt authority', () => {
  const good = receipt();
  for (const bad of ['{bad', false, 0, { v: 2, items: [] }, { v: 1, items: [good, { uid: 'broken' }] },
    { v: 1, items: [good, { ...good }] }, { v: 1, items: [good], extra: 'unexpected' },
    { v: 1, items: [{ ...good, taskText: 'must never persist' }] },
    ...[{ graph: '' }, { graph: 'a\u0000b' }, { userUid: '' }, { token: 'd25:00' }, { bodyHash: 'not-a-hash' },
      { at: NaN }, { at: -1 }, { at: 1.5 }, { uid: 'bad uid' }].map(extra => ({ v: 1, items: [{ ...good, ...extra }] })),
    { v: 1, items: Array.from({ length: 65 }, (_, i) => receipt(`task${String(i).padStart(5, '0')}`)) },
    { v: 1, items: [good], huge: 'x'.repeat(core.MAX_RECEIPT_BYTES) },
    'x'.repeat(core.MAX_RECEIPT_BYTES + 1)]) assert.equal(core.parseReceipts(bad).ok, false, JSON.stringify(bad).slice(0, 120));
  assert.equal(core.parseReceipts({ v: 1, items: [good] }).ok, true);
  assert.equal(core.parseReceipts(JSON.stringify({ v: 1, items: [good] })).ok, true);
});

test('bounded receipts retain newest operations even with identical/backward clocks and keep scopes separate', () => {
  let receipts = { v: 1, items: [] };
  for (let i = 0; i < 70; i++) receipts = core.withReceipt(receipts, receipt(`task${String(i).padStart(5, '0')}`, { at: 100 - i }));
  assert.equal(receipts.items.length, 64);
  assert.equal(receipts.items[0].uid, 'task00069');
  assert.equal(core.receiptFor(receipts, 'task00000', scope), null);
  receipts = core.withReceipt(receipts, receipt('task00069', { userUid: 'other' }));
  assert.equal(core.receiptFor(receipts, 'task00069', scope).userUid, 'user');
  assert.equal(core.receiptFor(receipts, 'task00069', { ...scope, userUid: 'other' }).userUid, 'other');
  receipts = core.withoutReceipt(receipts, 'task00069', scope);
  assert.equal(core.receiptFor(receipts, 'task00069', scope), null);
  assert.ok(core.receiptFor(receipts, 'task00069', { ...scope, userUid: 'other' }));
});

test('native IDs retain hyphens and underscores and reject missing frame boundaries', () => {
  assert.equal(core.nativeUid('block-input-main-window-abc-def12'), 'abc-def12');
  assert.equal(core.nativeUid('block-input-sidebar-123-abc_def12'), 'abc_def12');
  for (const value of ['block-input-abcdefghij', 'block-input-abc-def1', 'not-block-input-main-abc-def12', '', 'block-input--abc-def12']) {
    assert.equal(core.nativeUid(value), null, value);
  }
});
