const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, hash, deferred, flush } = require('./completion-stamp-test-utils.cjs');
const core = require('../src/completion-stamp-core');

test('direct completion writes marker and one owned stamp atomically; the clock-held path does not acquire a second lock', async t => {
  const f = await fixture(t);
  const result = await f.complete({ locked: true });
  assert.equal(result.stamped, true);
  assert.deepEqual(f.updates, [{ uid: 'task00001', string: '{{[[DONE]]}} Task 30m d10:31' }]);
  assert.deepEqual(f.lockCalls, []);
  const saved = f.values.get('completion-stamp-receipts');
  assert.equal(saved.items[0].bodyHash, await hash(core.normalizedReceiptBody(f.blocks.get('task00001'))));
  assert.ok(!JSON.stringify(saved).includes('Task 30m'));
  await assert.rejects(f.complete(), /already complete/);
  assert.equal(f.updates.length, 1);
});

test('owned native stamps survive writer reload, remove once on reopen, and use the new completion instant', async t => {
  const f = await fixture(t);
  await f.native();
  const reloaded = f.api.createCompletionStampWriter({ extensionAPI: { settings: f.settings }, host: f.host,
    getContext: f.context, guard: { assertActive() {}, run: fn => fn(), destroy() {} }, hash,
    readBlock: uid => f.blocks.get(uid), updateBlock: async (uid, string) => { f.updates.push({ uid, string }); f.blocks.set(uid, string); } });
  t.after(() => reloaded.destroy());
  const before = f.blocks.get('task00001');
  f.blocks.set('task00001', before.replace('DONE', 'TODO'));
  assert.equal((await reloaded.stampNative({ uid: 'task00001', before, instant: f.instant })).removed, true);
  assert.equal(f.blocks.get('task00001'), '{{[[TODO]]}} Task 30m');
  assert.equal(f.values.get('completion-stamp-receipts').items.length, 0);
  await reloaded.finishDirect({ uid: 'task00001', instant: new Date(2026, 10, 1, 11, 7), locked: true });
  assert.equal(f.blocks.get('task00001'), '{{[[DONE]]}} Task 30m d11:07');
});

test('foreign/manual timestamps and edited receipt bodies are preserved without extra fields', async t => {
  const f = await fixture(t);
  f.blocks.set('task00001', '{{[[TODO]]}} Task d09:05');
  assert.equal((await f.complete()).stamped, false);
  assert.equal(f.blocks.get('task00001'), '{{[[DONE]]}} Task d09:05');
  assert.equal(f.saves.length, 0);
  assert.equal((await f.reopen()).reason, 'foreign-reopen');
  assert.equal(f.blocks.get('task00001'), '{{[[TODO]]}} Task d09:05');
  f.blocks.set('task00001', '{{[[TODO]]}} Task 30m');
  await f.complete();
  f.blocks.set('task00001', '{{[[DONE]]}} Edited after completion d10:31');
  assert.equal((await f.reopen()).reason, 'foreign-reopen');
  assert.equal(f.blocks.get('task00001'), '{{[[TODO]]}} Edited after completion d10:31');
  assert.ok(f.notices.some(n => /ownership/.test(n)));
});

test('foreign scope receipts cannot authorize deletion, and corrupt stores remain intact and visible', async t => {
  const f = await fixture(t);
  await f.complete();
  const receipt = f.values.get('completion-stamp-receipts');
  for (const foreign of [{ graph: 'other' }, { userUid: 'other' }, { graphType: 'offline' }]) {
    f.values.set('completion-stamp-receipts', { v: 1, items: [{ ...receipt.items[0], ...foreign }] });
    f.blocks.set('task00001', '{{[[DONE]]}} Task 30m d10:31');
    assert.equal((await f.reopen()).reason, 'foreign-reopen');
    assert.ok(f.blocks.get('task00001').endsWith(' d10:31'));
  }
  const corrupt = { v: 1, items: [receipt.items[0], { uid: 'broken' }] };
  f.values.set('completion-stamp-receipts', corrupt);
  f.blocks.set('task00001', '{{[[DONE]]}} Task 30m d10:31');
  assert.equal((await f.reopen()).reason, 'receipt-unreadable');
  assert.deepEqual(f.values.get('completion-stamp-receipts'), corrupt);
  assert.ok(f.notices.some(n => /unreadable/.test(n)));
});

test('missing identity and a known competing writer leave direct completion functional without a suffix', async t => {
  const f = await fixture(t);
  f.changeContext({ userUid: '' });
  assert.equal((await f.complete()).reason, 'missing-user');
  assert.equal(f.blocks.get('task00001'), '{{[[DONE]]}} Task 30m');
  f.changeContext({ userUid: 'fixture-user' });
  f.blocks.set('task00001', '{{[[TODO]]}} Task 30m');
  f.host.roamjs = { loaded: new Set(['todo-trigger']) };
  assert.equal((await f.complete()).reason, 'todo-trigger');
  assert.equal(f.blocks.get('task00001'), '{{[[DONE]]}} Task 30m');
  assert.equal(f.saves.length, 0);
});

test('a lock-delayed Todo Trigger append is reported before transition matching', async t => {
  const lock = deferred(), f = await fixture(t, { lock });
  const pending = f.native();
  f.host.roamjs = { loaded: new Set(['todo-trigger']) };
  f.blocks.set('task00001', '{{[[DONE]]}} Task 30m d09:59');
  lock.resolve();
  assert.equal((await pending).reason, 'todo-trigger');
  assert.equal(f.updates.length, 0);
  assert.ok(f.notices.some(n => /Todo Trigger/.test(n)));
});

test('graph, provider, user, disable and supersession during hashing cancel all unissued writes', async t => {
  for (const change of ['graph', 'provider', 'user', 'disable', 'supersede']) await t.test(change, async st => {
    const hashing = deferred(), entered = deferred();
    const f = await fixture(st, { hash: async text => { entered.resolve(); await hashing.promise; return hash(text); } });
    let live = true;
    const pending = f.native({ frozenContext: f.writer.freezeContext(), isCurrent: () => live });
    const outcome = pending.catch(error => error);
    await entered.promise;
    if (change === 'graph') f.changeContext({ graph: 'another' });
    if (change === 'provider') f.changeContext({ provider: {} });
    if (change === 'user') f.changeContext({ userUid: 'another-user' });
    if (change === 'disable') f.values.set('completion-stamps-enabled', false);
    if (change === 'supersede') live = false;
    hashing.resolve(); await outcome;
    assert.equal(f.updates.length, 0);
    assert.equal(f.saves.length, 0);
  });
});

test('overlapping asynchronous setting changes cannot revive a direct completion after hashing', async t => {
  const hashing = deferred(), entered = deferred();
  const f = await fixture(t, { hash: async text => { entered.resolve(); await hashing.promise; return hash(text); } });
  const old = f.writer.freezeContext(), outcome = f.complete().catch(error => error);
  await entered.promise;
  const offSettled = f.writer.beginSettingsChange(); f.values.set('completion-stamps-enabled', false);
  const onSettled = f.writer.beginSettingsChange(); f.values.set('completion-stamps-enabled', true);
  offSettled(); assert.equal(f.writer.enabled(), false);
  onSettled(); onSettled(); assert.equal(f.writer.enabled(), true);
  assert.equal(f.writer.contextCurrent(old), false);
  hashing.resolve(); assert.match((await outcome).message, /changed|cancelled/);
  assert.equal(f.updates.length, 0);
  assert.equal((await f.complete()).stamped, true, 'a new explicit action remains available');
});

test('rendered text is not an edit buffer; real uncommitted text and composition block writes', async t => {
  const f = await fixture(t);
  f.host.document = { querySelectorAll: () => [] };
  assert.equal(f.writer.isEditorSafe('task00001', '{{[[TODO]]}} Task 30m'), true);
  const editor = { id: 'block-input-main-window-task00001', value: '{{[[TODO]]}} Uncommitted', matches: () => true };
  f.host.document.querySelectorAll = () => [editor];
  await assert.rejects(f.complete(), /editing|composing/);
  assert.equal(f.updates.length, 0);
  editor.value = f.blocks.get('task00001');
  f.writer.setComposing('task00001', true, { isConnected: false });
  assert.equal(f.writer.isEditorSafe('task00001', editor.value), true, 'a detached editor cannot leave a permanent composition lock');
  f.writer.setComposing('task00001', true);
  await assert.rejects(f.complete(), /editing|composing/);
  f.writer.clearComposition();
  assert.equal((await f.complete()).stamped, true);
});

test('composition or an external edit beginning during a hash prevents stale text overwrite', async t => {
  for (const mutation of ['composition', 'external-edit']) await t.test(mutation, async st => {
    const hashing = deferred(), entered = deferred();
    const f = await fixture(st, { hash: async text => { entered.resolve(); await hashing.promise; return hash(text); } });
    const pending = f.native();
    await entered.promise;
    if (mutation === 'composition') f.writer.setComposing('task00001', true);
    else f.blocks.set('task00001', '{{[[DONE]]}} New user text');
    hashing.resolve();
    const result = await pending;
    assert.equal(result.stamped, false);
    assert.equal(f.updates.length, 0);
  });
});

test('a rejected response is confirmed only by exact readback, while no-op remains unconfirmed without retry', async t => {
  for (const applied of [true, false]) await t.test(String(applied), async st => {
    const f = await fixture(st, { update: async (uid, string, blocks) => { if (applied) blocks.set(uid, string); throw Error('response lost'); } });
    const result = await f.native();
    assert.equal(result.stamped, applied);
    assert.equal(f.updates.length, 1);
    assert.equal(f.saves.length, applied ? 1 : 0);
    if (!applied) assert.ok(f.notices.some(n => /could not be confirmed/.test(n)));
  });
});

test('an unresolved host promise is bounded and cannot be reissued for the same owner', async t => {
  const update = deferred(), f = await fixture(t, { writeTimeoutMs: 5, update: () => update.promise });
  const result = await f.native();
  assert.equal(result.reason, 'unconfirmed');
  f.blocks.set('task00001', '{{[[TODO]]}} Task 30m');
  await assert.rejects(f.complete(), /unresolved/);
  assert.equal(f.updates.length, 1);
  update.resolve(); await flush();
  assert.equal(f.saves.length, 0);
});

test('a context change or unload after an issued update never saves a receipt in the next context', async t => {
  for (const action of ['provider', 'destroy']) await t.test(action, async st => {
    const update = deferred(), entered = deferred();
    const f = await fixture(st, { update: async (uid, string, blocks) => { blocks.set(uid, string); entered.resolve(); await update.promise; } });
    const result = f.native(); await entered.promise;
    if (action === 'provider') f.changeContext({ provider: {} }); else f.writer.destroy();
    update.resolve();
    assert.equal((await result).stamped, false);
    assert.equal(f.saves.length, 0);
  });
});

test('failed or no-op receipt persistence does not claim removal authority', async t => {
  for (const fail of [true, false]) await t.test(String(fail), async st => {
    const f = await fixture(st, { persist: async () => { if (fail) throw Error('storage unavailable'); } });
    const result = await f.native();
    assert.equal(result.stamped, true);
    assert.equal(result.receiptSaved, false);
    assert.equal((await f.reopen()).reason, 'foreign-reopen');
    assert.ok(f.blocks.get('task00001').endsWith('d10:31'));
  });
});

test('failed receipt revocation preserves the suffix and cannot delete a later identical manual time', async t => {
  for (const mode of ['reject', 'no-op']) await t.test(mode, async st => {
    const f = await fixture(st); await f.complete();
    const stored = structuredClone(f.values.get('completion-stamp-receipts'));
    f.settings.set = async () => { if (mode === 'reject') throw Error('storage unavailable'); };
    const result = await f.reopen();
    assert.equal(f.blocks.get('task00001'), '{{[[TODO]]}} Task 30m d10:31');
    assert.notEqual(result.removed, true);
    assert.equal(f.updates.length, 1, 'receipt failure must prevent the suffix-removal write');
    assert.deepEqual(f.values.get('completion-stamp-receipts'), stored);
    // Even the original report's later identical body/token cannot be deleted
    // while withdrawing its old authority remains unconfirmed.
    f.blocks.set('task00001', '{{[[DONE]]}} Task 30m d10:31');
    await f.reopen();
    assert.equal(f.blocks.get('task00001'), '{{[[TODO]]}} Task 30m d10:31');
    assert.equal(f.updates.length, 1);
    assert.ok(f.notices.some(n => /ownership.*remov|revok/i.test(n)));
  });
});

test('once revocation succeeds an uncertain suffix removal cannot leave authority over recreated text', async t => {
  for (const mode of ['reject', 'no-op']) await t.test(mode, async st => {
    let removing = false, f;
    f = await fixture(st, { update: async (uid, string, blocks) => {
      if (!removing) { blocks.set(uid, string); return; }
      assert.equal(f.values.get('completion-stamp-receipts').items.length, 0);
      if (mode === 'reject') throw Error('host write refused');
    } });
    await f.complete(); removing = true;
    assert.equal((await f.reopen()).reason, 'unconfirmed');
    assert.equal(f.blocks.get('task00001'), '{{[[TODO]]}} Task 30m d10:31');
    assert.equal(f.values.get('completion-stamp-receipts').items.length, 0);
    f.blocks.set('task00001', '{{[[DONE]]}} Task 30m d10:31');
    assert.equal((await f.reopen()).reason, 'foreign-reopen');
    assert.equal(f.blocks.get('task00001'), '{{[[TODO]]}} Task 30m d10:31');
    assert.equal(f.updates.length, 2, 'the later manual timestamp must cause no update');
  });
});

test('an edit during receipt revocation remains intact and the old receipt stays revoked', async t => {
  const f = await fixture(t); await f.complete();
  const entered = deferred(), settled = deferred(), persist = f.settings.set;
  f.settings.set = async (key, value) => { entered.resolve(); await settled.promise; return persist(key, value); };
  const pending = f.reopen(); await entered.promise;
  f.blocks.set('task00001', '{{[[TODO]]}} New user text d10:31'); settled.resolve();
  assert.equal((await pending).reason, 'changed-before-write');
  assert.equal(f.blocks.get('task00001'), '{{[[TODO]]}} New user text d10:31');
  assert.equal(f.updates.length, 1); assert.equal(f.values.get('completion-stamp-receipts').items.length, 0);
});

test('feature-off performs no optional graph, hash, lock or receipt work', async t => {
  let hashes = 0;
  const f = await fixture(t, { enabled: false, hash: async () => { hashes++; throw Error('unused'); } });
  assert.deepEqual(await f.complete(), { handled: false });
  assert.equal((await f.native()).reason, 'cancelled');
  assert.equal(hashes, 0); assert.equal(f.updates.length, 0); assert.equal(f.saves.length, 0); assert.equal(f.lockCalls.length, 0);
});
