const test = require('node:test');
const assert = require('node:assert/strict');
const { partitionChartEvents, historicalDoneSlice, calculateCapacity } = require('../src/log-core');
const { projectPlan, resolveTaskInstance } = require('../src/timing-core');

test('chart history keeps untimed DONE separate from both scheduling and timed history', () => {
  const rows = [
    { uid: 'pending', todo: true, done: false, duration: 20 },
    { uid: 'untimed-a', todo: true, done: true, duration: 30, start: null, end: null },
    { uid: 'timed', todo: true, done: true, start: 420, end: 450 },
    { uid: 'event', meeting: true, done: false, start: 600, end: 630 },
    { uid: 'fixed-done', meeting: true, done: true, start: 660, end: 690 },
    { uid: 'untimed-b', todo: true, done: true, 'status-origin': 'source', duration: 60 },
  ];
  rows.forEach(Object.freeze); Object.freeze(rows);
  const result = partitionChartEvents(rows);
  assert.deepEqual(result.pendingEvents, [rows[0], rows[3]]);
  assert.deepEqual(result.timedDoneEvents, [rows[2], rows[4]]);
  assert.deepEqual(result.untimedDoneEvents, [rows[1], rows[5]]);
  assert.deepEqual(result.completedUids, ['untimed-a', 'timed', 'fixed-done', 'untimed-b']);
  assert.equal(result.untimedDoneEvents[0], rows[1]);
  assert.equal(historicalDoneSlice({ done: true, duration: 30 }), null);
  const input = { startMinutes: 300, endMinutes: 1260, nowMinutes: 480,
    pendingTasks: result.pendingEvents.filter(row => row.todo),
    fixedEvents: result.pendingEvents.filter(row => row.meeting) };
  assert.deepEqual(calculateCapacity(input), calculateCapacity({ ...input, pendingTasks: [rows[0]] }));
});

test('chart history does not turn missing, invalid, or zero-length ranges into timestamped records', () => {
  const invalid = [[null, null], [undefined, undefined], [NaN, 600], [500, Infinity],
    ['500', '600'], [600, 600], [650, 600]];
  const rows = invalid.map(([start, end], i) => ({ uid: `unknown-${i}`, done: true, start, end }));
  const midnight = { uid: 'midnight', done: true, start: 0, end: 20 };
  const result = partitionChartEvents([...rows, midnight]);
  assert.deepEqual(result.untimedDoneEvents, rows);
  assert.deepEqual(result.timedDoneEvents, [midnight]);
  assert.deepEqual(result.pendingEvents, []);
  assert.deepEqual(partitionChartEvents(), {
    pendingEvents: [], timedDoneEvents: [], untimedDoneEvents: [], completedUids: [],
  });
});

test('reference DONE can remain visible in chart history without entering Desk or borrowing source time', () => {
  const input = { uid: 'local-wrapper', localString: '((source-done))', references: [],
    readString: uid => uid === 'source-done' ? '{{[[DONE]]}} Archived reference 25m d9' : '' };
  const instance = resolveTaskInstance(input);
  assert.equal(instance.status, 'DONE');
  assert.equal(instance.statusOrigin, 'source');
  assert.doesNotMatch(instance.effectiveString, /\bd9\b/);
  const desk = projectPlan([
    { uid: input.uid, parentUid: 'plan', string: input.localString, order: 0, taskInstance: instance },
    { uid: 'pending', parentUid: 'plan', string: '{{[[TODO]]}} Keep working 20m', order: 1 },
  ], 'plan');
  assert.deepEqual(desk.map(row => row.uid), ['pending']);
  const history = partitionChartEvents([{ uid: input.uid, todo: true, done: true,
    'status-origin': instance.statusOrigin, start: null, end: null }]);
  assert.equal(history.untimedDoneEvents[0].uid, 'local-wrapper');
  assert.deepEqual(history.completedUids, ['local-wrapper']);
});
