const test = require('node:test');
const assert = require('node:assert/strict');
const taskCore = require('../src/timing-core');
const logCore = require('../src/log-core');

const SOURCE = '{{[[DONE]]}} Completed reference d23:54';
const resolve = (localString = '((source-task))', extra = {}) => taskCore.resolveTaskInstance({
  uid: 'local-wrapper', localString, readString: uid => uid === 'source-task' ? SOURCE : '',
  fallbackMinutes: 15, includeCompletionEvidence: true, ...extra,
});

test('pure-reference chart evidence retains the source completion stamp without changing local identity or text', () => {
  const task = resolve();
  assert.equal(task.status, 'DONE');
  assert.equal(task.statusOwnerUid, 'source-task');
  assert.equal(task.uid, 'local-wrapper');
  assert.equal(task.doneAt, null, 'the execution/local task contract must not borrow a source timestamp');
  assert.doesNotMatch(task.effectiveString, /d23:54/);
  assert.deepEqual(task.completionEvidence, {
    localMinutes: null,
    reference: { sourceUid: 'source-task', sourceString: SOURCE, minutes: 1434 },
  });
});

test('source completion dates must be explicit Daily Note identities, with bounded overnight carryover', () => {
  const input = { sourceUid: 'source-task', sourceMinutes: 1434, sourcePageUid: '10-31-2026', displayDate: 'October 31st, 2026', logicalEndMinutes: 1200 };
  assert.deepEqual(logCore.resolveReferenceCompletionTime(input), {
    state: 'resolved', sourceUid: 'source-task', sourceMinutes: 1434, sourceDate: '2026-10-31', minutes: 1434,
  });
  for (const sourcePageUid of ['project-page', '', '02-30-2026', '10-30-2026']) {
    const r = logCore.resolveReferenceCompletionTime({ ...input, sourcePageUid, editTime: Date.now(), createdAt: Date.now() });
    assert.equal(r.state, 'unverified');
    assert.equal(r.minutes, undefined);
    assert.equal(r.sourceMinutes, 1434);
  }
  const overnight = logCore.resolveReferenceCompletionTime({ ...input, sourcePageUid: '11-01-2026', sourceMinutes: 75, logicalEndMinutes: 1560 });
  assert.equal(overnight.state, 'resolved');
  assert.equal(overnight.minutes, 1515);
  assert.equal(logCore.resolveReferenceCompletionTime({ ...input, sourcePageUid: '11-01-2026', sourceMinutes: 180, logicalEndMinutes: 1560 }).state, 'unverified');
  assert.equal(logCore.resolveReferenceCompletionTime({ ...input, displayDate: 'Project plan' }).state, 'unverified');
  assert.equal(logCore.resolveReferenceCompletionTime({ ...input, sourceMinutes: null }).state, 'unverified');
});

test('unverified source dates retain their label without filling an invented morning slot', () => {
  const item = Object.freeze({ uid: 'local-wrapper', description: 'Time needs confirmation', todo: true, done: true,
    duration: 15, 'completion-time-unverified': true, start: 510, end: 525, 'estimated-allocation': true });
  const projected = logCore.projectCompletedEstimates({ items: [item], startMinutes: 360, endMinutes: 1200 });
  assert.equal(projected.items[0].start, undefined);
  assert.equal(projected.items[0].end, undefined);
  assert.deepEqual(projected.estimatedUids, []);
  const r = logCore.chartScene({ items: [item], events: [item], startMinutes: 360, endMinutes: 1200 }).records[0];
  assert.equal(r.kind, 'unverified-completion');
  assert.equal(r.event['time-claim'], 'none');
  assert.equal(r.anchor, undefined);
  assert.equal(r.boundaryAnchor, undefined);
  assert.equal(r.markerPath, undefined);
  assert.equal(r.label.connector, '');
  assert.deepEqual([item.start,item.end], [510,525], 'display qualification never mutates source data');
  const companion = { uid: 'other-done', description: 'Genuinely untimed', todo: true, done: true, duration: 15 };
  const free = logCore.projectCompletedEstimates({ items: [item, companion], startMinutes: 510, endMinutes: 1200 });
  assert.equal(free.items[1].start, 510, 'unverified cached time must not block other estimates');
});

test('chart completion selection never lets source time override local evidence or uncertain CLOCK coverage', () => {
  const reference = { state: 'resolved', sourceUid: 'source-task', sourceMinutes: 1434, sourceDate: '2026-10-31', minutes: 1434 };
  const select = extra => logCore.selectChartCompletionTime({ reference, clockReadKnown: true, ...extra });
  assert.deepEqual(select({}), { origin: 'reference', minutes: 1434, reference });
  assert.deepEqual(select({ localDoneAt: 0 }), { origin: 'local', minutes: 0 });
  assert.deepEqual(select({ localDoneAt: 1300, actualMinutes: 30 }), { origin: 'local', minutes: 1300 });
  assert.deepEqual(select({ actualMinutes: 30 }), { origin: 'clock', minutes: null });
  assert.deepEqual(select({ hasLocalClock: true }), { origin: 'clock', minutes: null });
  assert.equal(select({ clockReadKnown: false }).origin, 'unverified');
  assert.equal(select({ reference: { ...reference, state: 'unverified', reason: 'different-day' } }).origin, 'unverified');
  assert.deepEqual(select({ reference: null, clockReadKnown: false }), { origin: 'none', minutes: null });
});

test('only pure chains inherit the timestamp of the nearest explicit DONE owner', () => {
  const strings = new Map([
    ['middle-source', '((source-task))'],
    ['source-task', SOURCE],
  ]);
  const readString = uid => strings.get(uid) || '';
  const chained = resolve('((middle-source))', { readString });
  assert.equal(chained.completionEvidence.reference.sourceUid, 'source-task');
  assert.equal(chained.completionEvidence.reference.minutes, 1434);
  strings.set('middle-source', 'Review ((source-task))');
  assert.equal(resolve('((middle-source))', { readString }).completionEvidence.reference, null);
  strings.set('middle-source', '{{[[DONE]]}} Local completion ((source-task)) d22:00');
  const owned = resolve('((middle-source))', { readString });
  assert.equal(owned.completionEvidence.reference.sourceUid, 'middle-source');
  assert.equal(owned.completionEvidence.reference.minutes, 1320);
  strings.set('middle-source', '{{[[TODO]]}} Reopened ((source-task))');
  assert.equal(resolve('((middle-source))', { readString }).completionEvidence, undefined);
});

test('local overrides, missing stamps, malformed stamps, midnight and opt-in remain distinct', () => {
  assert.equal(resolve('{{[[TODO]]}} ((source-task))').completionEvidence, undefined);
  assert.equal(resolve('Review ((source-task))').completionEvidence.reference, null);
  assert.equal(resolve('((source-task)) 30m').completionEvidence.reference, null);
  const local = resolve('((source-task)) d00:00');
  assert.deepEqual(local.completionEvidence, { localMinutes: 0, reference: null });
  assert.equal(local.doneAt, null);
  assert.equal(resolve('((source-task))', { includeCompletionEvidence: false }).completionEvidence, undefined);
  assert.equal(resolve('((source-task))', { readString: () => '{{[[DONE]]}} No timestamp' }).completionEvidence.reference, null);
  assert.equal(resolve('((source-task))', { readString: () => '{{[[DONE]]}} Invalid stamp d25:00' }).completionEvidence.reference.minutes, null);
  assert.equal(resolve('((source-task))', { readString: () => '{{[[DONE]]}} Midnight d00:00' }).completionEvidence.reference.minutes, 0);
  const held = logCore.selectChartCompletionTime({ clockReadKnown: true, reference: { sourceUid: 'source-task', sourceString: SOURCE, minutes: 1434 } });
  assert.equal(held.origin, 'unverified');
  assert.equal(held.reference.sourceMinutes, 1434);
  assert.equal(held.reference.sourceString, undefined);
});
