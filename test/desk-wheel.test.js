const test = require('node:test');
const assert = require('node:assert/strict');
const { deskWheelDelta, createDeskWheel } = require('../src/desk-wheel');

function fixture() {
  const steps = [], offsets = [], timers = new Map();
  let serial = 0;
  const wheel = createDeskWheel({ step: value => { steps.push(value); return true; }, progress: value => offsets.push(value),
    setTimer: (fn, delay) => { timers.set(++serial, { fn, delay }); return serial; }, clearTimer: id => timers.delete(id) });
  const send = (event = {}) => wheel.handle({ timeStamp: 1, deltaX: 0, deltaY: 0, ...event }, { line: 24, page: 600 });
  return { wheel, steps, offsets, timers, send };
}

test('Shift-wheel converts only unconverted Y and normalizes line/page modes', () => {
  assert.deepEqual(deskWheelDelta({ shiftKey: true, deltaY: 20, deltaX: 0 }), { x: 20, y: 0 });
  assert.deepEqual(deskWheelDelta({ shiftKey: true, deltaY: 0, deltaX: 20 }), { x: 20, y: 0 });
  assert.deepEqual(deskWheelDelta({ deltaY: 20, deltaX: 0 }), { x: 0, y: 20 });
  assert.deepEqual(deskWheelDelta({ shiftKey: true, deltaY: 3, deltaX: 0, deltaMode: 1 }, { line: 24 }), { x: 72, y: 0 });
  assert.deepEqual(deskWheelDelta({ deltaX: -1, deltaY: 0, deltaMode: 2 }, { page: 480 }), { x: -480, y: 0 });
});

test('partial motion follows the wheel, commits once, and ignores inertia', () => {
  const f = fixture();
  assert.equal(f.send({ shiftKey: true, deltaY: 20 }), true);
  assert.equal(f.offsets.at(-1), 20); assert.deepEqual(f.steps, []);
  f.send({ shiftKey: true, deltaY: 60, timeStamp: 20 });
  f.send({ shiftKey: true, deltaY: 120, timeStamp: 40, momentum: true });
  f.send({ shiftKey: true, deltaY: 120, timeStamp: 50, momentum: true });
  assert.deepEqual(f.steps, [-1]);
  f.send({ deltaX: -100, timeStamp: 60, momentum: false });
  assert.deepEqual(f.steps, [-1, 1]);
});

test('unmarked wheel tails latch; idle or an intentional reversal starts a new gesture', () => {
  const f = fixture();
  for (let i = 0; i < 4; i++) f.send({ deltaX: 100, timeStamp: 10 + i });
  assert.deepEqual(f.steps, [-1]);
  f.send({ deltaX: -100, timeStamp: 30 });
  f.send({ deltaX: -100, timeStamp: 400 });
  assert.deepEqual(f.steps, [-1, 1, 1]);
});

test('momentum alone never commits a partial gesture', () => {
  const f = fixture();
  f.send({ deltaX: 20, momentum: false });
  f.send({ deltaX: 200, momentum: true, timeStamp: 10 });
  assert.deepEqual(f.steps, []); assert.equal(f.offsets.at(-1), null);
});

test('vertical wheel, pinch/other handlers stay unowned; Shift begins a new horizontal intent', () => {
  const f = fixture();
  assert.equal(f.send({ deltaY: 100 }), false);
  assert.equal(f.send({ shiftKey: true, deltaY: 100, timeStamp: 20 }), true);
  assert.deepEqual(f.steps, [-1]);
  for (const guard of ['ctrlKey', 'metaKey', 'defaultPrevented', 'isComposing']) {
    assert.equal(f.send({ deltaX: 100, [guard]: true }), false);
  }
  assert.deepEqual(f.steps, [-1]);
});

test('a cancelled old timer cannot reset the newer gesture', () => {
  const f = fixture();
  f.send({ deltaX: 10 });
  const old = [...f.timers.values()][0].fn;
  f.send({ deltaX: 10, timeStamp: 20 });
  const length = f.offsets.length;
  old();
  assert.equal(f.offsets.length, length);
  assert.equal(f.offsets.at(-1), 20);
});

test('one idle reset timer is replaced and destroyed without late motion', () => {
  const f = fixture();
  f.send({ deltaX: 10 }); f.send({ deltaX: 10, timeStamp: 20 });
  assert.equal(f.timers.size, 1);
  const timer = [...f.timers.values()][0]; assert.equal(timer.delay, 320);
  f.timers.delete([...f.timers.keys()][0]); timer.fn(); assert.equal(f.offsets.at(-1), null);
  f.send({ deltaX: 10, timeStamp: 400 });
  const late = [...f.timers.values()].at(-1).fn;
  f.wheel.destroy(); const length = f.offsets.length;
  assert.equal(f.timers.size, 0);
  late(); assert.equal(f.offsets.length, length);
  assert.equal(f.send({ deltaX: 100 }), false);
});
