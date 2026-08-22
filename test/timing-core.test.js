const test = require('node:test');
const assert = require('node:assert/strict');

const timing = require('../src/timing-core');

test('CLOCK records round-trip in compatible Org format', () => {
  const start = new Date(2026, 7, 22, 10, 4, 0, 0);
  const end = new Date(2026, 7, 22, 10, 23, 0, 0);
  const running = timing.formatClockLine(start);
  const closed = timing.formatClockLine(start, end);

  assert.match(running, /^CLOCK: \[2026-08-22 Sat 10:04\]$/);
  assert.match(closed, /--\[2026-08-22 Sat 10:23\] => 0:19$/);
  assert.equal(timing.parseClockLine(running).running, true);
  assert.equal(timing.parseClockLine(closed).minutes, 19);
});

test('the first component in Daily Note tree order owns the Primary Plan', () => {
  const rows = [
    { uid: 'later-root', parentUid: 'page', order: 1, string: 'section' },
    { uid: 'later-plan', parentUid: 'later-root', order: 0, string: '[[Nautilus Log]] {{[[roam/render]]:later}}' },
    { uid: 'first-root', parentUid: 'page', order: 0, string: 'section' },
    { uid: 'first-plan', parentUid: 'first-root', order: 2, string: '[[Nautilus Log]] {{[[roam/render]]:first}}' },
    { uid: 'first-task', parentUid: 'first-plan', order: 0, string: '{{[[TODO]]}} Write 30m' },
  ];

  assert.equal(timing.selectPrimaryPlan(rows, 'page').uid, 'first-plan');
});

test('Plan is a flat ordered projection of unfinished direct children', () => {
  const rows = [
    { uid: 'event', parentUid: 'plan', order: 0, string: '10:00-11:00 Meeting' },
    { uid: 'second', parentUid: 'plan', order: 2, string: '{{[[TODO]]}} Second 15m' },
    { uid: 'done', parentUid: 'plan', order: 1, string: '{{[[DONE]]}} Finished 20m' },
    { uid: 'first', parentUid: 'plan', order: 1, string: '{{[[TODO]]}} First 30m' },
    { uid: 'nested', parentUid: 'first', order: 0, string: '{{[[TODO]]}} Nested 45m' },
  ];

  assert.deepEqual(
    timing.projectPlan(rows, 'plan').map(({ uid, plannedMinutes }) => [uid, plannedMinutes]),
    [['first', 30], ['second', 15]],
  );
});

test('Active Work keeps one focused task and distinct tasks closed in the last 45 minutes', () => {
  const now = new Date(2026, 7, 22, 11, 0);
  const entries = [
    { taskUid: 'focus', title: 'Focus', start: new Date(2026, 7, 22, 10, 50), end: null, running: true },
    { taskUid: 'recent', title: 'Recent old', start: new Date(2026, 7, 22, 10, 0), end: new Date(2026, 7, 22, 10, 20), running: false },
    { taskUid: 'recent', title: 'Recent new', start: new Date(2026, 7, 22, 10, 30), end: new Date(2026, 7, 22, 10, 45), running: false },
    { taskUid: 'expired', title: 'Expired', start: new Date(2026, 7, 22, 9, 0), end: new Date(2026, 7, 22, 10, 14), running: false },
  ];

  const active = timing.buildActiveWork(entries, now, 45);
  assert.equal(active.focused.taskUid, 'focus');
  assert.deepEqual(active.recent.map(({ taskUid }) => taskUid), ['recent']);
  assert.equal(active.count, 2);
});

test('Recent retention accepts a custom numeric window and zero disables Recent', () => {
  const now = new Date(2026, 7, 22, 11, 0);
  const entries = [
    { taskUid: 'recent', title: 'Recent', start: new Date(2026, 7, 22, 10, 40), end: new Date(2026, 7, 22, 10, 50), running: false },
  ];

  assert.deepEqual(timing.buildActiveWork(entries, now, 15).recent.map(({ taskUid }) => taskUid), ['recent']);
  assert.deepEqual(timing.buildActiveWork(entries, now, 5).recent, []);
  assert.deepEqual(timing.buildActiveWork(entries, now, 0).recent, []);
  assert.equal(timing.buildActiveWork(entries, now, 0).windowMinutes, 0);
});

test('forgotten CLOCK warning uses the current open CLOCK and can be disabled', () => {
  const entry = { running: true, start: new Date(2026, 7, 22, 8, 0) };

  assert.equal(timing.isForgottenClock(entry, new Date(2026, 7, 22, 9, 59), 120), false);
  assert.equal(timing.isForgottenClock(entry, new Date(2026, 7, 22, 10, 0), 120), true);
  assert.equal(timing.isForgottenClock(entry, new Date(2026, 7, 22, 12, 0), 0), false);
  assert.equal(timing.isForgottenClock({ ...entry, running: false }, new Date(2026, 7, 22, 12, 0), 120), false);
});

test('duration metadata prefers today Actual and otherwise falls back to Planned', () => {
  const now = new Date(2026, 7, 22, 12, 0);
  const entries = [
    { taskUid: 'actual', start: new Date(2026, 7, 22, 10, 0), end: new Date(2026, 7, 22, 10, 18), running: false },
    { taskUid: 'yesterday', start: new Date(2026, 7, 21, 10, 0), end: new Date(2026, 7, 21, 10, 40), running: false },
  ];

  assert.deepEqual(timing.durationMetadata({ taskUid: 'actual', plannedMinutes: 30, entries, now }), {
    primaryLabel: 'Actual 18m',
    detailLabel: 'Actual 18m · Planned 30m',
    actualMinutes: 18,
    plannedMinutes: 30,
  });
  assert.equal(
    timing.durationMetadata({ taskUid: 'planned', plannedMinutes: 25, entries, now }).primaryLabel,
    'Planned 25m',
  );
});

test('Pomodoro threshold survives seamless switches and resets only after Clock Out', () => {
  const initial = timing.nextPomodoroState(null, { action: 'start', nowMs: 1000 });
  const switched = timing.nextPomodoroState(initial, { action: 'switch', nowMs: 5000 });
  const stopped = timing.nextPomodoroState(switched, { action: 'stop', nowMs: 9000 });

  assert.equal(initial.startedAt, 1000);
  assert.equal(switched.startedAt, 1000);
  assert.equal(stopped, null);
});

test('execution surface structure ignores one-second ticks but detects real row changes', () => {
  const base = {
    status: 'ready',
    notice: '',
    planSnapshot: {
      plan: { uid: 'plan' },
      tasks: [{ uid: 'task-a', title: 'Alpha', plannedMinutes: 30 }],
    },
    entries: [{
      clockUid: 'clock-a',
      taskUid: 'task-a',
      title: 'Alpha',
      status: 'TODO',
      start: new Date(2026, 7, 22, 10, 0),
      end: null,
      running: true,
    }],
    activeWork: {
      focused: { taskUid: 'task-a', start: new Date(2026, 7, 22, 10, 0) },
      recent: [],
      count: 1,
    },
    pomodoro: { startedAt: new Date(2026, 7, 22, 10, 0).getTime() },
    now: new Date(2026, 7, 22, 10, 1, 0),
  };
  const tick = { ...base, now: new Date(2026, 7, 22, 10, 1, 1) };
  const changed = {
    ...tick,
    planSnapshot: {
      ...tick.planSnapshot,
      tasks: [...tick.planSnapshot.tasks, { uid: 'task-b', title: 'Beta', plannedMinutes: 15 }],
    },
  };

  assert.equal(timing.executionStructureKey(base, 'plan'), timing.executionStructureKey(tick, 'plan'));
  assert.notEqual(timing.executionStructureKey(tick, 'plan'), timing.executionStructureKey(changed, 'plan'));
  assert.notEqual(timing.executionStructureKey(tick, 'timing'), timing.executionStructureKey(tick, 'plan'));
  assert.equal(
    timing.executionStructureKey({ ...base, revision: 4 }, 'plan'),
    timing.executionStructureKey({ ...changed, revision: 4 }, 'plan'),
  );
  assert.notEqual(
    timing.executionStructureKey({ ...base, revision: 4 }, 'plan'),
    timing.executionStructureKey({ ...base, revision: 5 }, 'plan'),
  );
});
