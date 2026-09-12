const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function api() {
  const bundle = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}#clock-reader-${Date.now()}`);
}

function countingRead(handler) {
  const calls = [];
  const read = (uids) => {
    const requested = [...uids];
    calls.push(requested);
    return handler(requested);
  };
  return {
    calls,
    read,
    uidReads: () => calls.reduce((n, uids) => n + uids.length, 0),
  };
}

const owners = Array.from({ length: 16 }, (_, i) => `task-${String(i + 1).padStart(2, '0')}`);

test('renderer reads uncovered historical owners instead of treating today entries as all history', async () => {
  const { createRendererClockReader } = await api();
  const today = { taskUid: 'today', clockUid: 'clock-today' };
  const old = { taskUid: 'yesterday', clockUid: 'clock-old' };
  let snapshot = { entries: [today], entryTaskUids: ['today'] };
  const probe = countingRead(() => [old]);
  const reader = createRendererClockReader({
    getSnapshot: () => snapshot,
    read: probe.read,
  });
  assert.deepEqual(reader.read(['today', 'yesterday']), [today, old]);
  assert.deepEqual(probe.calls, [['yesterday']]);
  assert.deepEqual(reader.read(['yesterday']), [old]);
  assert.equal(probe.calls.length, 1);
  snapshot = { entries: [], entryTaskUids: ['today'] };
  assert.deepEqual(reader.read(['today']), [], 'a covered empty owner is real absence');
  assert.deepEqual(reader.read(['yesterday']), [old], 'uncovered owners keep a still-valid cache');
  assert.equal(probe.calls.length, 1);
});

test('ATT snapshot entries cannot impersonate uncovered historical owners', async () => {
  const { createRendererClockReader } = await api();
  const sneaky = { taskUid: 'yesterday', clockUid: 'from-today-snapshot' };
  const scoped = { taskUid: 'yesterday', clockUid: 'from-scoped-read' };
  const snapshot = {
    entries: [{ taskUid: 'today', clockUid: 'clock-today' }, sneaky],
    entryTaskUids: ['today'],
  };
  const probe = countingRead(() => [scoped]);
  const reader = createRendererClockReader({ getSnapshot: () => snapshot, read: probe.read });
  assert.deepEqual(reader.read(['yesterday']), [scoped]);
  assert.deepEqual(probe.calls, [['yesterday']]);
});

test('growing owner sets and overlapping charts read each owner once', async () => {
  const { createRendererClockReader } = await api();
  const growing = countingRead((uids) => uids.map((taskUid) => ({ taskUid, clockUid: taskUid })));
  const growingReader = createRendererClockReader({ read: growing.read });
  for (let n = 1; n <= 12; n += 1) growingReader.read(owners.slice(0, n));
  assert.equal(growing.uidReads(), 12);

  const overlap = countingRead((uids) => uids.map((taskUid) => ({ taskUid, clockUid: taskUid })));
  const overlapReader = createRendererClockReader({ read: overlap.read });
  overlapReader.read(owners.slice(0, 10));
  overlapReader.read(owners.slice(5, 15));
  assert.equal(overlap.uidReads(), 15);
  assert.deepEqual(overlap.calls, [owners.slice(0, 10), owners.slice(10, 15)]);
});

test('renderer cache is bounded, expires, and never crosses a graph/API identity', async () => {
  const { createRendererClockReader } = await api();
  let now = 0;
  let scope = ['api-a', 'graph-a'];
  let calls = 0;
  const reader = createRendererClockReader({
    now: () => now,
    getScope: () => scope,
    maxOwners: 2,
    ttlMs: 10,
    read: (uids) => {
      calls += 1;
      return uids.map((taskUid) => ({ taskUid, clockUid: taskUid }));
    },
  });
  reader.read(['a']);
  reader.read(['b']);
  reader.read(['c']);
  assert.equal(reader.size(), 2);
  reader.read(['a']);
  assert.equal(calls, 4);
  now = 20;
  reader.read(['a']);
  assert.equal(calls, 5);
  scope = ['api-a', 'graph-b'];
  reader.read(['a']);
  assert.equal(calls, 6);
  scope = ['api-b', 'graph-b'];
  reader.read(['a']);
  assert.equal(calls, 7);
  reader.clear();
  assert.equal(reader.size(), 0);
});

test('snapshot identity churn does not drop a still-valid per-owner cache', async () => {
  const { createRendererClockReader } = await api();
  const today = { taskUid: 'today', clockUid: 'clock-today' };
  const old = { taskUid: 'yesterday', clockUid: 'clock-old' };
  let snapshot = { entries: [today], entryTaskUids: ['today'] };
  const probe = countingRead(() => [old]);
  const reader = createRendererClockReader({ getSnapshot: () => snapshot, read: probe.read });
  assert.deepEqual(reader.read(['yesterday']), [old]);
  snapshot = { entries: [{ ...today }], entryTaskUids: ['today'] };
  assert.deepEqual(reader.read(['yesterday']), [old]);
  assert.equal(probe.calls.length, 1);
});

test('partial mutation snapshots cannot certify complete history', async () => {
  const { createRendererClockReader } = await api();
  const partial = { taskUid: 'hist', clockUid: 'partial' };
  const full = { taskUid: 'hist', clockUid: 'full-history' };
  const snapshot = { entries: [partial], entryTaskUids: [] };
  const probe = countingRead(() => [full]);
  const reader = createRendererClockReader({ getSnapshot: () => snapshot, read: probe.read });
  assert.deepEqual(reader.read(['hist']), [full]);
  assert.deepEqual(probe.calls, [['hist']]);
});

test('error snapshots do not mark coverage and failed reads stay retryable', async () => {
  const { createRendererClockReader } = await api();
  const today = { taskUid: 'today', clockUid: 'clock-today' };
  const recovered = { taskUid: 'today', clockUid: 'from-graph' };
  const snapshot = { status: 'error', entries: [today], entryTaskUids: ['today'] };
  let fail = true;
  const probe = countingRead(() => {
    if (fail) throw new Error('graph unavailable');
    return [recovered];
  });
  const reader = createRendererClockReader({ getSnapshot: () => snapshot, read: probe.read });
  assert.deepEqual(reader.read(['today']), []);
  assert.equal(reader.size(), 0, 'a failed read must not be stored as a successful empty cache');
  fail = false;
  assert.deepEqual(reader.read(['today']), [recovered]);
  assert.equal(probe.calls.length, 2);
});

test('read failure keeps a previous valid cache and retries only missing owners', async () => {
  const { createRendererClockReader } = await api();
  const cached = { taskUid: 'old', clockUid: 'clock-old' };
  let failMissing = false;
  const probe = countingRead((uids) => {
    if (failMissing) throw new Error('owner read failed');
    return uids.map((taskUid) => ({ taskUid, clockUid: `clock-${taskUid}` }));
  });
  const reader = createRendererClockReader({ read: probe.read });
  assert.deepEqual(reader.read(['old']), [cached]);
  failMissing = true;
  assert.deepEqual(reader.read(['old', 'new']), [cached]);
  assert.equal(reader.size(), 1);
  failMissing = false;
  assert.deepEqual(reader.read(['old', 'new']), [cached, { taskUid: 'new', clockUid: 'clock-new' }]);
  assert.deepEqual(probe.calls, [['old'], ['new'], ['new']]);
});

test('one CLOCK owner change invalidates only that owner and keeps unrelated cache', async () => {
  const { createRendererClockReader } = await api();
  const probe = countingRead((uids) => uids.map((taskUid) => ({ taskUid, clockUid: `clock-${taskUid}` })));
  const reader = createRendererClockReader({ read: probe.read });
  reader.read(['hist-a', 'hist-b', 'hist-c']);
  assert.equal(probe.uidReads(), 3);
  reader.invalidate(['hist-b']);
  assert.equal(reader.size(), 2);
  const again = reader.read(['hist-a', 'hist-b', 'hist-c']);
  assert.deepEqual(again.map((entry) => entry.taskUid), ['hist-a', 'hist-b', 'hist-c']);
  assert.deepEqual(probe.calls.at(-1), ['hist-b']);
  assert.equal(probe.uidReads(), 4);
});

test('changedClockOwners ignores snapshot identity churn and covers removal, owner moves, and coverage', async () => {
  const { changedClockOwners } = await api();
  const start = new Date('2026-09-12T01:00:00.000Z');
  const end = new Date('2026-09-12T01:25:00.000Z');
  const hist = { clockUid: 'c-hist', taskUid: 'hist', start, end, running: false };
  const live = { clockUid: 'c-live', taskUid: 'live', start, end: null, running: true };
  const entries = [hist, live];
  assert.deepEqual(changedClockOwners(
    { entries, entryTaskUids: ['live'] },
    { entries: [...entries], entryTaskUids: ['live'] },
  ), []);
  assert.deepEqual(changedClockOwners(
    { entries, entryTaskUids: ['live'] },
    { entries, entryTaskUids: ['live'] },
  ), []);

  const stopped = { ...live, running: false, end };
  assert.deepEqual(changedClockOwners(
    { entries, entryTaskUids: ['live'] },
    { entries: [hist, stopped], entryTaskUids: ['live'] },
  ), ['live']);

  assert.deepEqual(changedClockOwners(
    { entries, entryTaskUids: ['live'] },
    { entries: [hist], entryTaskUids: ['live'] },
  ), ['live']);

  const moved = { ...live, taskUid: 'other' };
  const movedOwners = changedClockOwners(
    { entries, entryTaskUids: ['live'] },
    { entries: [hist, moved], entryTaskUids: ['other'] },
  );
  assert.equal(movedOwners.includes('live'), true);
  assert.equal(movedOwners.includes('other'), true);

  const coverageOwners = changedClockOwners(
    { entries: [live], entryTaskUids: ['live'] },
    { entries: [live], entryTaskUids: ['live', 'empty-done'] },
  );
  assert.deepEqual(coverageOwners, ['empty-done']);

  assert.deepEqual(changedClockOwners(
    { entries: [live], entryTaskUids: ['live'] },
    { status: 'error', entries: [live], entryTaskUids: ['live'] },
  ), []);
});

test('a request larger than the cache cap returns every owner then trims later reads', async () => {
  const { createRendererClockReader } = await api();
  const uids = Array.from({ length: 300 }, (_, i) => `task-${i}`);
  const first = countingRead((requested) => requested.map((taskUid) => ({ taskUid, clockUid: taskUid })));
  const reader = createRendererClockReader({ read: first.read, maxOwners: 256 });
  const result = reader.read(uids);
  assert.equal(result.length, 300);
  assert.equal(reader.size(), 256);
  assert.equal(first.uidReads(), 300);
  const second = reader.read(uids);
  assert.equal(second.length, 300);
  assert.equal(reader.size(), 256);
  assert.equal(first.uidReads(), 344);
});
