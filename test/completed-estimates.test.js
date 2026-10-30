const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../src/log-core');
const taskCore = require('../src/timing-core');

function project(items, extra = {}) {
  return core.projectCompletedEstimates({ items, startMinutes: 360, endMinutes: 1200, defaultDuration: 15, ...extra });
}
const done = (uid, duration) => ({ uid, description: uid, todo: true, done: true,
  ...(duration === undefined ? {} : { duration, 'planned-duration': duration }) });

test('completed estimates draw default 15 and explicit 45 without CLOCK or a completion stamp', () => {
  const source = [done('default'), done('explicit', 45)];
  source.forEach(Object.freeze); Object.freeze(source);
  const result = project(source);
  assert.deepEqual(result.items.map(r => [r.start, r.end, r.duration]), [[360, 375, 15], [375, 420, 45]]);
  assert.ok(result.items.every(r => r.done && r['estimated-allocation'] && r['done-at'] === undefined && r['actual-minutes'] === undefined));
  assert.ok(source.every(r => r.start === undefined && r.end === undefined));
});

test('configured default and reference duration precedence remain authoritative', () => {
  assert.equal(project([done('default')], { defaultDuration: 20 }).items[0].duration, 20);
  const instance = taskCore.resolveTaskInstance({ uid: 'wrapper', localString: '{{[[DONE]]}} ((source)) 45m', readString: () => '{{[[DONE]]}} Source work 30m d10' });
  assert.equal(instance.plannedMinutes, 45);
  const row = project([done(instance.uid, instance.plannedMinutes)]).items[0];
  assert.equal(row.end - row.start, 45);
  assert.equal(row['done-at'], undefined);
});

test('fixed events and anchored completion intervals take priority without changing their objects', () => {
  const fixed = { uid: 'meeting', description: 'Meeting', meeting: true, done: true, start: 360, end: 390 };
  const actual = { ...done('actual', 15), start: 390, end: 420, duration: 30, 'duration-source': 'actual', 'actual-minutes': 30 };
  const source = [fixed, actual, done('estimated', 45)];
  const result = project(source);
  assert.strictEqual(result.items[0], fixed);
  assert.strictEqual(result.items[1], actual);
  assert.deepEqual([result.items[2].start, result.items[2].end, result.items[2].duration], [420, 465, 45]);
});

test('estimate placement is source-ordered, whole-task and independent of now or edit metadata', () => {
  const source = [done('long', 45), done('short', 15), { uid: 'fixed', meeting: true, start: 390, end: 420 }];
  const first = project(source, { nowMinutes: 480 });
  const later = project(source, { nowMinutes: 1199 });
  assert.deepEqual(first, later);
  assert.deepEqual(first.items.slice(0, 2).map(r => [r.start, r.end]), [[420, 465], [465, 480]]);
  const metadata = source.map(r => ({ ...r, editTime: 1793390000000, 'edit/time': 1793390000000, sourceDoneAt: 1180 }));
  assert.deepEqual(project(metadata).items.map(r => [r.start, r.end]), first.items.map(r => [r.start, r.end]));
});

test('pending scheduling, capacity and Actual are not consumed by completed estimate allocation', () => {
  const pending = { uid: 'pending', description: 'Pending', todo: true, done: false, duration: 45 };
  const source = [done('estimated', 60), pending];
  const result = project(source);
  assert.strictEqual(result.items[1], pending);
  const calculate = items => core.calculateCapacity({ startMinutes: 360, endMinutes: 1200, nowMinutes: 600,
    pendingTasks: items.filter(r => !r.done), fixedEvents: [] });
  assert.equal(calculate(source).demandMinutes, 45);
  assert.deepEqual(calculate(source), calculate(result.items));
  assert.equal(result.items[0]['actual-minutes'], undefined);
});

test('real window overflow preserves duration and status instead of inventing more time', () => {
  const result = project([done('too-long', 90), done('later', 15)], { endMinutes: 420 });
  assert.deepEqual(result.overflowUids, ['too-long', 'later']);
  assert.ok(result.items.every(r => r.done && r['estimate-unplaced-reason'] === 'capacity' && r.start === undefined && r.end === undefined));
  assert.deepEqual(result.items.map(r => r.duration), [90, 15]);
});

test('the public renderer bridge applies the fallback and never returns a completion-status node', () => {
  const scene = core.chartScene({ items: [done('default')], events: [], containerWidth: 720, startMinutes: 360, endMinutes: 1200 });
  const r = scene.records[0];
  assert.equal(r.kind, 'timed');
  assert.equal(r.event['time-claim'], 'estimated-allocation');
  assert.equal(r.event.end - r.event.start, 15);
  assert.ok(r.anchor && r.label.connector);
  assert.equal(scene.completionNode, undefined);
});

test('the public bridge retains geometry admission for null source rows', () => {
  const scene = core.chartScene({ items: [null, done('valid')], events: [], startMinutes: 360, endMinutes: 1200 });
  assert.deepEqual(scene.records.map(r => r.uid), ['valid']);
  assert.equal(scene.records[0].event.duration, 15);
});

test('reapplying the projection does not turn estimated intervals into observed blockers', () => {
  const original = project([done('one', 30), done('two', 45)]);
  assert.deepEqual(project(original.items), original);
});

test('zero duration is not silently replaced with 15 or described as capacity overload', () => {
  const result = project([done('zero', 0)]);
  assert.equal(result.items[0].duration, 0);
  assert.equal(result.items[0]['estimate-unplaced-reason'], 'zero-duration');
  assert.deepEqual(result.overflowUids, []);
});
