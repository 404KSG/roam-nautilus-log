const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ORIGINAL_ORDER = ['active-a', 'done-a', 'divider', 'past-event', 'active-b'];
const TIDY_ORDER = ['done-a', 'past-event', 'active-a', 'divider', 'active-b'];

async function loadExtension(label) {
  const bundle = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}#${label}-${Date.now()}`);
}

function defaultRows(expandedUids = []) {
  return [
    { uid: 'active-a', string: '{{[[TODO]]}} A', order: 0 },
    { uid: 'done-a', string: '{{[[DONE]]}} Done A', order: 1 },
    { uid: 'divider', string: '---', order: 2 },
    { uid: 'past-event', string: '05:00-06:00 Event', order: 3 },
    { uid: 'active-b', string: '{{[[TODO]]}} B', order: 4 },
  ].map((row) => ({ ...row, open: expandedUids.includes(row.uid) }));
}

function tidyHarness(extension, options = {}) {
  const {
    collapseOnMove = false,
    expandedUids = [],
  } = options;
  let runningTaskUid = options.runningTaskUid || null;
  const runExclusive = Object.prototype.hasOwnProperty.call(options, 'runExclusive')
    ? options.runExclusive
    : (operation) => operation();
  let rows = defaultRows(expandedUids);
  const notices = [];
  const writes = [];
  const hooks = {};
  const actions = [];
  const openWrites = [];
  const read = () => rows.map((row, order) => ({ ...row, order }));
  const move = async ({ uid, order }) => {
    await hooks.beforeMove?.(uid);
    writes.push(uid);
    const from = rows.findIndex((row) => row.uid === uid);
    rows.splice(order, 0, rows.splice(from, 1)[0]);
    if (collapseOnMove) rows = rows.map((row) => ({ ...row, open: false }));
    await hooks.afterMove?.(uid);
  };
  const setOpen = async (uid, open) => {
    await hooks.beforeSetOpen?.(uid, open);
    openWrites.push({ uid, open });
    rows = rows.map((row) => (row.uid === uid ? { ...row, open } : row));
    await hooks.afterSetOpen?.(uid, open);
  };
  const createOptions = {
    read,
    move,
    setOpen,
    runningTaskUid: () => runningTaskUid,
    notify: (message, intent) => {
      notices.push({ message, intent });
      return hooks.afterNotify?.({ message, intent });
    },
    notifyAction: (options) => {
      actions.push(options);
      return hooks.afterNotifyAction?.(options);
    },
  };
  if (runExclusive !== undefined) createOptions.runExclusive = runExclusive;
  const tidy = extension.createPlanTidy(createOptions);
  return {
    tidy,
    read,
    move,
    notices,
    actions,
    openWrites,
    writes,
    hooks,
    setRunning(uid) {
      runningTaskUid = uid;
    },
    mutate(mutator) {
      rows = mutator(rows);
    },
  };
}

function multiPlanHarness(extension) {
  const plans = {
    'plan-a': defaultRows(),
    'plan-b': defaultRows(),
  };
  const notices = [];
  const actions = [];
  const writes = [];
  const hooks = {};
  const read = (planUid) => {
    const rows = plans[planUid];
    if (!Array.isArray(rows)) throw new Error(`missing plan ${planUid}`);
    return rows.map((row, order) => ({ ...row, order }));
  };
  const move = async ({ uid, parentUid, order }) => {
    await hooks.beforeMove?.(uid, parentUid);
    writes.push({ uid, parentUid });
    const rows = plans[parentUid];
    const from = rows.findIndex((row) => row.uid === uid);
    rows.splice(order, 0, rows.splice(from, 1)[0]);
    await hooks.afterMove?.(uid, parentUid);
  };
  const setOpen = async () => {};
  const tidy = extension.createPlanTidy({
    read,
    move,
    setOpen,
    runningTaskUid: () => null,
    notify: (message, intent) => notices.push({ message, intent }),
    notifyAction: (options) => actions.push(options),
    runExclusive: (operation) => operation(),
  });
  return { tidy, read, writes, hooks, notices, actions };
}

function assertNoUndo(result, harness, label) {
  assert.equal(result.ok, false, label);
  assert.equal(result.reason, 'failed', label);
  assert.equal(result.token, undefined, label);
  assert.equal(harness.actions.length, 0, label);
}

function assertNotChangedLie(result, label) {
  assert.notEqual(result.reason, 'changed', label);
}

test('Plan Tidy second-move failure reports partial change, keeps evidence, and does not mint Undo', async () => {
  const extension = await loadExtension('tidy-second-move');
  const harness = tidyHarness(extension);
  harness.hooks.beforeMove = async () => {
    if (harness.writes.length === 1) throw new Error('injected second move failure');
  };
  const before = harness.read().map((row) => row.uid);
  const result = await harness.tidy.run({
    planUid: 'plan',
    settledUids: ['done-a', 'past-event'],
    language: 'en',
  });
  assertNoUndo(result, harness, 'second-move');
  assert.equal(result.partial, true);
  assert.equal(result.changed, true);
  assert.equal(harness.writes.length, 1);
  assert.equal(harness.writes[0], 'done-a');
  assert.deepEqual(harness.read().map((row) => row.uid), [
    'done-a',
    'active-a',
    'divider',
    'past-event',
    'active-b',
  ]);
  assert.notDeepEqual(harness.read().map((row) => row.uid), before);
  assert.match(result.error?.message || '', /injected second move failure/);
  assert.equal(harness.notices.at(-1)?.intent, 'danger');
});

test('Plan Tidy stops before the next write when the outline changes concurrently', async () => {
  const extension = await loadExtension('tidy-concurrent-edit');
  const harness = tidyHarness(extension);
  harness.hooks.afterMove = () => {
    if (harness.writes.length !== 1) return;
    harness.mutate((rows) => {
      const next = rows.slice();
      const from = next.findIndex((row) => row.uid === 'active-b');
      next.splice(1, 0, next.splice(from, 1)[0]);
      return next;
    });
  };
  const result = await harness.tidy.run({
    planUid: 'plan',
    settledUids: ['done-a', 'past-event'],
    language: 'en',
  });
  assertNoUndo(result, harness, 'concurrent-edit');
  assert.equal(result.partial, true);
  assert.equal(result.changed, true);
  assert.equal(harness.writes.length, 1);
  assert.deepEqual(harness.read().map((row) => row.uid), [
    'done-a',
    'active-b',
    'active-a',
    'divider',
    'past-event',
  ]);
  assert.match(result.error?.message || '', /Plan changed during Tidy/);
});

test('Plan Tidy disable/destroy does not continue issuing moves and reports partial', async () => {
  const extension = await loadExtension('tidy-disable');
  const harness = tidyHarness(extension);
  harness.hooks.afterMove = () => {
    harness.tidy.destroy();
  };
  const result = await harness.tidy.run({
    planUid: 'plan',
    settledUids: ['done-a', 'past-event'],
    language: 'en',
  });
  assertNoUndo(result, harness, 'destroy');
  assert.equal(result.partial, true);
  assert.equal(result.changed, true);
  assert.equal(harness.writes.length, 1);
  const followUp = await harness.tidy.run({
    planUid: 'plan',
    settledUids: ['done-a', 'past-event'],
    language: 'en',
  });
  assert.equal(followUp.ok, false);
  assert.equal(followUp.changed, false);
  assert.equal(followUp.partial, false);
  assert.equal(harness.writes.length, 1);
});

test('Plan Tidy serializes overlapping runs so the second start waits for the first', async () => {
  const extension = await loadExtension('tidy-serial');
  const harness = tidyHarness(extension);
  let releaseFirstMove;
  const firstMoveGate = new Promise((resolve) => {
    releaseFirstMove = resolve;
  });
  let moveStarts = 0;
  harness.hooks.beforeMove = async () => {
    moveStarts += 1;
    if (moveStarts === 1) await firstMoveGate;
  };
  const first = harness.tidy.run({
    planUid: 'plan',
    settledUids: ['done-a', 'past-event'],
    language: 'en',
  });
  while (moveStarts === 0) await new Promise((resolve) => setImmediate(resolve));
  const second = harness.tidy.run({
    planUid: 'plan',
    settledUids: ['done-a', 'past-event'],
    language: 'en',
  });
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
  assert.equal(harness.writes.length, 2);
  assert.deepEqual(harness.read().map((row) => row.uid), TIDY_ORDER);

  const undone = await harness.tidy.undo({
    planUid: 'plan',
    token: firstResult.token,
    language: 'en',
  });
  assert.equal(undone.ok, true);
  assert.deepEqual(harness.read().map((row) => row.uid), ORIGINAL_ORDER);
});

test('Plan Tidy fail-closes without a graph write host and does not write', async () => {
  const extension = await loadExtension('tidy-no-guard-host');
  const harness = tidyHarness(extension, { runExclusive: undefined });
  const before = harness.read().map((row) => row.uid);
  const result = await harness.tidy.run({
    planUid: 'plan',
    settledUids: ['done-a', 'past-event'],
    language: 'en',
  });
  assert.equal(result.ok, false);
  assert.equal(result.changed, false);
  assert.equal(result.partial, false);
  assert.equal(harness.writes.length, 0);
  assert.deepEqual(harness.read().map((row) => row.uid), before);
  assert.equal(harness.actions.length, 0);
});

test('Plan Tidy moves only settled wrappers, preserves active order, and supports one safe Undo', async () => {
  const extension = await loadExtension('tidy-runtime');
  const harness = tidyHarness(extension, { expandedUids: ['done-a', 'active-a'] });
  const result = await harness.tidy.run({
    planUid: 'plan',
    settledUids: ['done-a', 'past-event'],
    language: 'en',
  });

  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.deepEqual(harness.read().map((row) => row.uid), TIDY_ORDER);
  assert.equal(harness.read().find((row) => row.uid === 'done-a').open, false);
  assert.equal(harness.read().find((row) => row.uid === 'active-a').open, true);
  assert.equal(harness.actions.length, 1);
  assert.match(harness.actions[0].message, /Tidied 2 items/);

  await harness.actions[0].onAction();
  assert.deepEqual(harness.read().map((row) => row.uid), ORIGINAL_ORDER);
  assert.equal(harness.read().find((row) => row.uid === 'done-a').open, true);
  assert.equal(harness.read().find((row) => row.uid === 'active-a').open, true);
  assert.deepEqual(harness.notices.at(-1), { message: 'Tidy undone.', intent: 'success' });
});

test('Plan Tidy never moves the currently running task and is idempotent', async () => {
  const extension = await loadExtension('tidy-running');
  const harness = tidyHarness(extension, {
    runningTaskUid: 'done-a',
    expandedUids: ['done-a'],
  });
  const first = await harness.tidy.tidy({
    planUid: 'plan',
    settledUids: ['done-a', 'past-event'],
  });
  assert.equal(first.changed, true);
  assert.equal(Boolean(first.token), true);
  assert.deepEqual(harness.read().map((row) => row.uid), [
    'past-event',
    'active-a',
    'done-a',
    'divider',
    'active-b',
  ]);
  assert.equal(harness.read().find((row) => row.uid === 'done-a').open, true);

  const second = await harness.tidy.tidy({
    planUid: 'plan',
    settledUids: ['done-a', 'past-event'],
  });
  assert.deepEqual(second, { ok: true, changed: false, count: 0 });
  const undone = await harness.tidy.undo({
    planUid: 'plan',
    token: first.token,
  });
  assert.equal(undone.ok, true);
  assert.deepEqual(harness.read().map((row) => row.uid), ORIGINAL_ORDER);
});

test('Plan Tidy refuses Undo after an intervening outline change', async () => {
  const extension = await loadExtension('tidy-concurrent-change');
  const harness = tidyHarness(extension);
  await harness.tidy.run({
    planUid: 'plan',
    settledUids: ['done-a', 'past-event'],
    language: 'en',
  });
  await harness.move({ uid: 'active-b', order: 2 });
  const changedOrder = harness.read().map((row) => row.uid);
  const outcome = await harness.actions[0].onAction();
  assert.equal(outcome.ok, false);
  assert.equal(outcome.reason, 'changed');
  assert.deepEqual(harness.read().map((row) => row.uid), changedOrder);
  assert.equal(harness.notices.at(-1).intent, 'warning');
});

test('Plan Tidy restores the user\'s expanded direct blocks after Roam rerenders moves', async () => {
  const extension = await loadExtension('tidy-open-state');
  const harness = tidyHarness(extension, {
    collapseOnMove: true,
    expandedUids: ['done-a', 'active-a'],
  });

  await harness.tidy.tidy({
    planUid: 'plan',
    settledUids: ['done-a', 'past-event'],
  });

  const openByUid = Object.fromEntries(harness.read().map((row) => [row.uid, row.open]));
  assert.equal(openByUid['done-a'], false);
  assert.equal(openByUid['active-a'], true);
  assert.equal(openByUid['active-b'], false);
});

test('Plan Tidy treats collapse-only cleanup as a change and writes only expanded settled rows', async () => {
  const extension = await loadExtension('tidy-collapse-only');
  const harness = tidyHarness(extension, { expandedUids: ['done-a', 'active-a'] });
  await harness.move({ uid: 'done-a', order: 0 });
  await harness.move({ uid: 'past-event', order: 1 });

  const result = await harness.tidy.run({
    planUid: 'plan',
    settledUids: ['done-a', 'past-event'],
    language: 'en',
  });

  assert.equal(result.changed, true);
  assert.equal(result.count, 1);
  assert.deepEqual(harness.openWrites, [{ uid: 'done-a', open: false }]);
  assert.equal(harness.read().find((row) => row.uid === 'active-a').open, true);
  assert.match(harness.actions[0].message, /Tidied 1 item/);

  await harness.actions[0].onAction();
  assert.deepEqual(harness.openWrites, [
    { uid: 'done-a', open: false },
    { uid: 'done-a', open: true },
  ]);
});

test('Plan Tidy no-op second run keeps a still-safe first Undo token', async () => {
  const extension = await loadExtension('tidy-noop-keep-token');
  const harness = tidyHarness(extension, { expandedUids: ['done-a'] });
  const first = await harness.tidy.run({
    planUid: 'plan',
    settledUids: ['done-a', 'past-event'],
    language: 'en',
  });
  assert.equal(first.ok, true);
  assert.equal(Boolean(first.token), true);
  const second = await harness.tidy.run({
    planUid: 'plan',
    settledUids: ['done-a', 'past-event'],
    language: 'en',
  });
  assert.equal(second.ok, true);
  assert.equal(second.changed, false);
  const undone = await harness.tidy.undo({
    planUid: 'plan',
    token: first.token,
    language: 'en',
  });
  assert.equal(undone.ok, true);
  assert.deepEqual(harness.read().map((row) => row.uid), ORIGINAL_ORDER);
  assert.equal(harness.read().find((row) => row.uid === 'done-a').open, true);
});

test('Plan Tidy no-op after a user outline change safely expires the previous token', async () => {
  const extension = await loadExtension('tidy-noop-expire-token');
  const harness = tidyHarness(extension);
  const first = await harness.tidy.run({
    planUid: 'plan',
    settledUids: ['done-a', 'past-event'],
    language: 'en',
  });
  assert.equal(Boolean(first.token), true);
  harness.mutate((rows) => rows.filter((row) => row.uid !== 'active-b'));
  const second = await harness.tidy.tidy({
    planUid: 'plan',
    settledUids: ['done-a', 'past-event'],
  });
  assert.deepEqual(second, { ok: true, changed: false, count: 0 });
  const undone = await harness.tidy.undo({
    planUid: 'plan',
    token: first.token,
    language: 'en',
  });
  assert.equal(undone.ok, false);
  assert.ok(undone.reason === 'expired' || undone.reason === 'changed');
  assert.deepEqual(harness.read().map((row) => row.uid), [
    'done-a',
    'past-event',
    'active-a',
    'divider',
  ]);
});

test('Plan Tidy Undo second-move failure invalidates the token and a retry is not changed', async () => {
  const extension = await loadExtension('tidy-undo-second-move');
  const harness = tidyHarness(extension);
  const first = await harness.tidy.run({
    planUid: 'plan',
    settledUids: ['done-a', 'past-event'],
    language: 'en',
  });
  assert.equal(first.ok, true);
  const token = first.token;
  let undoMoves = 0;
  harness.hooks.beforeMove = async () => {
    undoMoves += 1;
    if (undoMoves === 2) throw new Error('injected undo second move failure');
  };
  const undone = await harness.actions[0].onAction();
  assert.equal(undone.ok, false);
  assert.equal(undone.reason, 'failed');
  assertNotChangedLie(undone, 'undo-second-move');
  assert.equal(undone.partial, true);
  assert.equal(undone.changed, true);
  assert.equal(undoMoves, 2);
  assert.notDeepEqual(harness.read().map((row) => row.uid), TIDY_ORDER);
  assert.notDeepEqual(harness.read().map((row) => row.uid), ORIGINAL_ORDER);
  assert.doesNotMatch(harness.notices.map((row) => row.message).join('\n'), /Undo was not applied|没有执行撤销/);
  const retry = await harness.tidy.undo({ planUid: 'plan', token, language: 'en' });
  assert.equal(retry.ok, false);
  assert.equal(retry.reason, 'expired');
  assertNotChangedLie(retry, 'undo-second-move-retry');
});

test('Plan Tidy Undo open-write failure invalidates the token and a retry is not changed', async () => {
  const extension = await loadExtension('tidy-undo-open-fail');
  const harness = tidyHarness(extension, { expandedUids: ['done-a'] });
  const first = await harness.tidy.run({
    planUid: 'plan',
    settledUids: ['done-a', 'past-event'],
    language: 'en',
  });
  assert.equal(first.ok, true);
  const token = first.token;
  harness.hooks.beforeSetOpen = async () => {
    throw new Error('injected undo open failure');
  };
  const undone = await harness.actions[0].onAction();
  assert.equal(undone.ok, false);
  assert.equal(undone.reason, 'failed');
  assertNotChangedLie(undone, 'undo-open-fail');
  assert.equal(undone.partial, true);
  assert.doesNotMatch(harness.notices.map((row) => row.message).join('\n'), /Undo was not applied|没有执行撤销/);
  const retry = await harness.tidy.undo({ planUid: 'plan', token, language: 'en' });
  assert.equal(retry.ok, false);
  assert.equal(retry.reason, 'expired');
  assertNotChangedLie(retry, 'undo-open-fail-retry');
});

test('Plan Tidy open-phase parent move-out does not mint Undo', async () => {
  const extension = await loadExtension('tidy-open-move-out');
  const harness = tidyHarness(extension, { expandedUids: ['done-a', 'past-event'] });
  harness.hooks.afterSetOpen = async (uid) => {
    if (uid !== 'done-a') return;
    harness.mutate((rows) => rows.filter((row) => row.uid !== 'past-event'));
  };
  const result = await harness.tidy.run({
    planUid: 'plan',
    settledUids: ['done-a', 'past-event'],
    language: 'en',
  });
  assertNoUndo(result, harness, 'open-move-out');
  assert.equal(harness.openWrites.some((row) => row.uid === 'past-event'), false);
});

test('Plan Tidy open-phase reorder does not mint Undo', async () => {
  const extension = await loadExtension('tidy-open-reorder');
  const harness = tidyHarness(extension, { expandedUids: ['done-a', 'past-event'] });
  harness.hooks.afterSetOpen = async (uid) => {
    if (uid !== 'done-a') return;
    harness.mutate((rows) => {
      const next = rows.slice();
      const from = next.findIndex((row) => row.uid === 'active-b');
      const divider = next.findIndex((row) => row.uid === 'divider');
      if (from < 0 || divider < 0) return rows;
      next.splice(divider, 0, next.splice(from, 1)[0]);
      return next;
    });
  };
  const result = await harness.tidy.run({
    planUid: 'plan',
    settledUids: ['done-a', 'past-event'],
    language: 'en',
  });
  assertNoUndo(result, harness, 'open-reorder');
});

test('Plan Tidy open-phase already-desired open skips the write', async () => {
  const extension = await loadExtension('tidy-open-already-desired');
  const harness = tidyHarness(extension, { expandedUids: ['done-a', 'past-event'] });
  harness.hooks.afterSetOpen = async (uid) => {
    if (uid !== 'done-a') return;
    harness.mutate((rows) => rows.map((row) => (
      row.uid === 'past-event' ? { ...row, open: false } : row
    )));
  };
  const result = await harness.tidy.run({
    planUid: 'plan',
    settledUids: ['done-a', 'past-event'],
    language: 'en',
  });
  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(harness.openWrites.some((row) => row.uid === 'past-event'), false);
  assert.equal(harness.read().find((row) => row.uid === 'past-event').open, false);
});

test('Plan Tidy applyTarget open restore re-reads before writing and does not mint Undo after reorder', async () => {
  const extension = await loadExtension('tidy-restore-reorder');
  const harness = tidyHarness(extension, {
    collapseOnMove: true,
    expandedUids: ['done-a', 'active-a'],
  });
  harness.hooks.afterSetOpen = async (uid, open) => {
    if (uid !== 'done-a' || open !== true) return;
    harness.mutate((rows) => {
      const next = rows.slice();
      const from = next.findIndex((row) => row.uid === 'active-b');
      next.splice(2, 0, next.splice(from, 1)[0]);
      return next;
    });
  };
  const result = await harness.tidy.run({
    planUid: 'plan',
    settledUids: ['done-a', 'past-event'],
    language: 'en',
  });
  assertNoUndo(result, harness, 'restore-reorder');
});

test('Plan Tidy write-after confirmation failure does not mint Undo', async () => {
  const extension = await loadExtension('tidy-confirm-fail');
  const harness = tidyHarness(extension, { expandedUids: ['done-a'] });
  await harness.move({ uid: 'done-a', order: 0 });
  await harness.move({ uid: 'past-event', order: 1 });
  harness.hooks.afterSetOpen = async () => {
    harness.mutate((rows) => {
      const next = rows.slice();
      const from = next.findIndex((row) => row.uid === 'active-b');
      next.splice(2, 0, next.splice(from, 1)[0]);
      return next;
    });
  };
  const result = await harness.tidy.run({
    planUid: 'plan',
    settledUids: ['done-a'],
    language: 'en',
  });
  assertNoUndo(result, harness, 'confirm-fail');
  assert.match(result.error?.message || '', /could not confirm/i);
});

test('Plan Tidy destroy during open does not continue writing or mint Undo', async () => {
  const extension = await loadExtension('tidy-destroy-open');
  const harness = tidyHarness(extension, { expandedUids: ['done-a', 'past-event'] });
  harness.hooks.afterSetOpen = () => {
    harness.tidy.destroy();
  };
  const result = await harness.tidy.run({
    planUid: 'plan',
    settledUids: ['done-a', 'past-event'],
    language: 'en',
  });
  assertNoUndo(result, harness, 'destroy-open');
  assert.equal(harness.openWrites.length, 1);
});

test('Plan Tidy first-write rejection does not claim a confirmed graph change', async () => {
  const extension = await loadExtension('tidy-first-write-reject');
  const harness = tidyHarness(extension);
  harness.hooks.beforeMove = async () => {
    throw new Error('injected first move failure');
  };
  const before = harness.read().map((row) => row.uid);
  const result = await harness.tidy.run({
    planUid: 'plan',
    settledUids: ['done-a', 'past-event'],
    language: 'en',
  });
  assertNoUndo(result, harness, 'first-write-reject');
  assert.equal(harness.writes.length, 0);
  assert.deepEqual(harness.read().map((row) => row.uid), before);
  assert.notEqual(result.changed, true);
  assert.notEqual(result.changed, false);
  assert.equal(result.changed, null);
  assert.equal(result.partial, true);
  assert.equal(result.confirmed, 0);
  assert.ok(result.attempted > 0);
});

test('Plan Tidy failure clears only the current plan token', async () => {
  const extension = await loadExtension('tidy-token-isolation');
  const harness = multiPlanHarness(extension);
  const firstA = await harness.tidy.run({
    planUid: 'plan-a',
    settledUids: ['done-a', 'past-event'],
    language: 'en',
  });
  assert.equal(firstA.ok, true);
  const tokenA = firstA.token;
  harness.hooks.beforeMove = async (_uid, parentUid) => {
    if (parentUid === 'plan-b' && harness.writes.filter((row) => row.parentUid === 'plan-b').length === 1) {
      throw new Error('injected plan-b failure');
    }
  };
  const failedB = await harness.tidy.run({
    planUid: 'plan-b',
    settledUids: ['done-a', 'past-event'],
    language: 'en',
  });
  assert.equal(failedB.ok, false);
  const undoA = await harness.tidy.undo({
    planUid: 'plan-a',
    token: tokenA,
    language: 'en',
  });
  assert.equal(undoA.ok, true);
  assert.deepEqual(harness.read('plan-a').map((row) => row.uid), ORIGINAL_ORDER);
});

test('Plan Tidy production guard lock chain uses native Web Locks on a synthetic graph adapter', async (t) => {
  const extension = await loadExtension('tidy-guard-native-locks');
  const previousWindow = global.window;
  const lockNames = [];
  const realRequest = navigator.locks.request.bind(navigator.locks);
  const host = {
    roamAlphaAPI: { graph: { name: 'synthetic-tidy-guard' } },
    navigator: {
      locks: {
        request(name, options, callback) {
          lockNames.push({ name, mode: options?.mode });
          return realRequest(name, options, callback);
        },
      },
    },
  };
  global.window = host;
  t.after(() => {
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
  });

  const harness = tidyHarness(extension, { runExclusive: undefined });
  let releaseFirstMove;
  const firstMoveGate = new Promise((resolve) => {
    releaseFirstMove = resolve;
  });
  let moveStarts = 0;
  harness.hooks.beforeMove = async () => {
    moveStarts += 1;
    if (moveStarts === 1) await firstMoveGate;
  };
  const first = harness.tidy.run({
    planUid: 'plan',
    settledUids: ['done-a', 'past-event'],
    language: 'en',
  });
  while (moveStarts === 0) await new Promise((resolve) => setImmediate(resolve));
  const second = harness.tidy.run({
    planUid: 'plan',
    settledUids: ['done-a', 'past-event'],
    language: 'en',
  });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(moveStarts, 1);
  releaseFirstMove();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult.ok, true);
  assert.equal(firstResult.changed, true);
  assert.equal(secondResult.ok, true);
  assert.equal(secondResult.changed, false);
  assert.ok(lockNames.length >= 2);
  assert.equal(lockNames[0].mode, 'exclusive');
  assert.equal(
    lockNames[0].name,
    `nautilus-log:outline:${encodeURIComponent('synthetic-tidy-guard')}`,
  );
  assert.deepEqual(harness.read().map((row) => row.uid), TIDY_ORDER);
  const undone = await harness.tidy.undo({
    planUid: 'plan',
    token: firstResult.token,
    language: 'en',
  });
  assert.equal(undone.ok, true);
  assert.deepEqual(harness.read().map((row) => row.uid), ORIGINAL_ORDER);
});

test('Plan Tidy Undo fails when a resolved open write does not actually expand collapsed rows', async () => {
  const extension = await loadExtension('tidy-undo-open-not-sticky');
  const harness = tidyHarness(extension, { expandedUids: ['done-a'] });
  const first = await harness.tidy.run({
    planUid: 'plan',
    settledUids: ['done-a', 'past-event'],
    language: 'en',
  });
  assert.equal(first.ok, true);
  const token = first.token;
  harness.hooks.afterSetOpen = async (uid, open) => {
    if (open !== true) return;
    harness.mutate((rows) => rows.map((row) => (
      row.uid === uid ? { ...row, open: false } : row
    )));
  };
  const undone = await harness.actions[0].onAction();
  assert.equal(undone.ok, false);
  assert.equal(undone.reason, 'failed');
  assertNotChangedLie(undone, 'undo-open-not-sticky');
  assert.equal(harness.read().find((row) => row.uid === 'done-a').open, false);
  const retry = await harness.tidy.undo({ planUid: 'plan', token, language: 'en' });
  assert.equal(retry.ok, false);
  assert.equal(retry.reason, 'expired');
});

test('Plan Tidy Undo still skips expanding the running collapsed uid', async () => {
  const extension = await loadExtension('tidy-undo-running-open');
  const harness = tidyHarness(extension, { expandedUids: ['done-a'] });
  const first = await harness.tidy.run({
    planUid: 'plan',
    settledUids: ['done-a', 'past-event'],
    language: 'en',
  });
  assert.equal(first.ok, true);
  assert.equal(harness.read().find((row) => row.uid === 'done-a').open, false);
  harness.setRunning('done-a');
  const undone = await harness.tidy.undo({
    planUid: 'plan',
    token: first.token,
    language: 'en',
  });
  assert.equal(undone.ok, true);
  assert.deepEqual(harness.read().map((row) => row.uid), ORIGINAL_ORDER);
  assert.equal(harness.read().find((row) => row.uid === 'done-a').open, false);
  assert.equal(harness.openWrites.some((row) => row.uid === 'done-a' && row.open === true), false);
});

test('Plan Tidy notifyAction throw after completed writes does not report changed:false', async () => {
  const extension = await loadExtension('tidy-notify-action-throw');
  const harness = tidyHarness(extension, { expandedUids: ['done-a'] });
  harness.hooks.afterNotifyAction = () => {
    throw new Error('injected notifyAction failure');
  };
  const result = await harness.tidy.run({
    planUid: 'plan',
    settledUids: ['done-a', 'past-event'],
    language: 'en',
  });
  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(Boolean(result.token), true);
  assert.deepEqual(harness.read().map((row) => row.uid), TIDY_ORDER);
  assert.equal(harness.read().find((row) => row.uid === 'done-a').open, false);
  assert.notEqual(result.changed, false);
});
