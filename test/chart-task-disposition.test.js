const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../src/log-core');
const todo = (uid, duration = 45) => ({ uid, description: uid, todo: true, done: false, duration, 'planned-duration': duration });
const items = [todo('write'), todo('ship'), { uid: 'done', description: 'Completed', todo: true, done: true, duration: 30 },
  { uid: 'event', description: 'Appointment', meeting: true, start: 540, end: 570 }];
const events = [{ ...items[0], start: 600, end: 645 }, { ...items[1], start: 645, end: 690 }, items[3]];

test('past unfinished tasks never receive a historical interval and retain original UID/order/estimates', () => {
  const s = core.chartScene({ items, events, relation: 'past', startMinutes: 360, endMinutes: 1200, containerWidth: 720 });
  assert.deepEqual(s.records.map(r => r.uid), ['done', 'event']);
  assert.equal(s.pendingQueue.kind, 'unfinished');
  assert.deepEqual(s.pendingQueue.items.map(r => [r.uid, r.duration]), [['write', 45], ['ship', 45]]);
  assert.equal(s.pendingQueue.minutes, 90);
  assert.ok(s.pendingQueue.items.every(r => r.start === undefined && r.end === undefined));
  assert.equal(s.records.find(r => r.uid === 'done').event['time-claim'], 'estimated-allocation');
  assert.equal(items[0].done, false);
});

test('today, future and undated views queue only tasks without a fitting slot', () => {
  for (const relation of ['today', 'future', 'other']) {
    const s = core.chartScene({ items, events: [events[0], events[2]], relation, startMinutes: 360, endMinutes: 1200 });
    assert.equal(s.records.find(r => r.uid === 'write').kind, 'timed');
    assert.ok(!s.records.some(r => r.uid === 'ship'));
    assert.equal(s.pendingQueue.kind, 'unscheduled');
    assert.deepEqual(s.pendingQueue.items.map(r => r.uid), ['ship']);
    assert.equal(s.pendingQueue.minutes, 45);
  }
});

test('completed estimate overflow and off-hours events never enter an unfinished queue', () => {
  const source = [{ ...items[2], duration: 3000 }, { uid: 'early', description: 'Early', meeting: true, start: 60, end: 90 }];
  const s = core.chartScene({ items: source, events: [], relation: 'past', startMinutes: 360, endMinutes: 1200 });
  assert.equal(s.pendingQueue, null);
  assert.deepEqual(s.records.map(r => r.kind), ['completed-estimate-overflow', 'outside-window']);
});

test('frame stays stable for unchanged diagram membership, not for a semantic move into the queue', () => {
  const a = core.chartScene({ items, events, relation: 'today', startMinutes: 360, endMinutes: 1200 });
  const b = core.chartScene({ items, events: events.map(r => r.todo ? { ...r, start: r.start + 1, end: r.end + 1 } : r), relation: 'today', startMinutes: 360, endMinutes: 1200 });
  assert.deepEqual(a.frame, b.frame);
  assert.equal(a.pendingQueue, null);
  const late = core.chartScene({ items, events: [], relation: 'today', startMinutes: 360, endMinutes: 1200 });
  assert.deepEqual(late.pendingQueue.items.map(r => r.uid), ['write', 'ship']);
  assert.deepEqual(new Set([...late.records.map(r => r.uid), ...late.pendingQueue.items.map(r => r.uid)]), new Set(items.map(r => r.uid)));
});

test('an overflow transition may happen before END and must not freeze old placement', () => {
  const item = todo('late', 45);
  const input = { startMinutes: 360, endMinutes: 1200, tasks: [item] };
  const a = core.scheduleTasks({ ...input, nowMinutes: 1155 });
  const b = core.scheduleTasks({ ...input, nowMinutes: 1156 });
  assert.equal(core.chartScene({ ...input, items: [item], events: a.scheduledTasks, relation: 'today' }).pendingQueue, null);
  assert.equal(core.chartScene({ ...input, items: [item], events: b.scheduledTasks, relation: 'today' }).pendingQueue.items[0].uid, 'late');
});

test('queued tasks keep explicit zero and default missing estimates to 15', () => {
  const q = core.chartScene({ items: [{ uid: 'default', description: 'Default', todo: true }, todo('zero', 0)], events: [], relation: 'past' }).pendingQueue;
  assert.deepEqual(q.items.map(r => r.duration), [15, 0]);
  assert.equal(q.minutes, 15);
});

test('past scheduling cursor is END, while an active overnight carryover remains today', () => {
  const past = core.timelineDayState({ displayDate: new Date(2026, 9, 29), currentDate: new Date(2026, 9, 30, 8), startMinutes: 360, endMinutes: 1200, nowMinutes: 480 });
  assert.equal(past.relation, 'past'); assert.equal(past.scheduleFromMinutes, 1200);
  const carry = core.timelineDayState({ displayDate: new Date(2026, 9, 29), currentDate: new Date(2026, 9, 30, 1), startMinutes: 1260, endMinutes: 1560, nowMinutes: 60 });
  assert.equal(carry.relation, 'today'); assert.equal(carry.scheduleFromMinutes, 1500);
  const ended = core.timelineDayState({ displayDate: new Date(2026, 9, 29), currentDate: new Date(2026, 9, 30, 2), startMinutes: 1260, endMinutes: 1560, nowMinutes: 120 });
  assert.equal(ended.relation, 'past'); assert.equal(ended.scheduleFromMinutes, 1560);
});
