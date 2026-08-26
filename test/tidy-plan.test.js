const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function loadExtension(label) {
  const bundle = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}#${label}-${Date.now()}`);
}

function tidyHarness(extension, {
  runningTaskUid = null,
  collapseOnMove = false,
  expandedUids = [],
} = {}) {
  let rows = [
    { uid: 'active-a', string: '{{[[TODO]]}} A', order: 0 },
    { uid: 'done-a', string: '{{[[DONE]]}} Done A', order: 1 },
    { uid: 'divider', string: '---', order: 2 },
    { uid: 'past-event', string: '05:00-06:00 Event', order: 3 },
    { uid: 'active-b', string: '{{[[TODO]]}} B', order: 4 },
  ].map((row) => ({ ...row, open: expandedUids.includes(row.uid) }));
  const notices = [];
  const actions = [];
  const openWrites = [];
  const read = () => rows.map((row, order) => ({ ...row, order }));
  const move = async ({ uid, order }) => {
    const from = rows.findIndex((row) => row.uid === uid);
    rows.splice(order, 0, rows.splice(from, 1)[0]);
    if (collapseOnMove) rows = rows.map((row) => ({ ...row, open: false }));
  };
  const setOpen = async (uid, open) => {
    openWrites.push({ uid, open });
    rows = rows.map((row) => (row.uid === uid ? { ...row, open } : row));
  };
  const tidy = extension.createPlanTidy({
    read,
    move,
    setOpen,
    runningTaskUid: () => runningTaskUid,
    notify: (message, intent) => notices.push({ message, intent }),
    notifyAction: (options) => actions.push(options),
  });
  return { tidy, read, move, notices, actions, openWrites };
}

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
  assert.deepEqual(harness.read().map((row) => row.uid), [
    'done-a',
    'past-event',
    'active-a',
    'divider',
    'active-b',
  ]);
  assert.equal(harness.read().find((row) => row.uid === 'done-a').open, false);
  assert.equal(harness.read().find((row) => row.uid === 'active-a').open, true);
  assert.equal(harness.actions.length, 1);
  assert.match(harness.actions[0].message, /Tidied 2 items/);

  await harness.actions[0].onAction();
  assert.deepEqual(harness.read().map((row) => row.uid), [
    'active-a',
    'done-a',
    'divider',
    'past-event',
    'active-b',
  ]);
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
