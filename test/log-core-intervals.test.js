const test = require('node:test');
const assert = require('node:assert/strict');
const { scheduleTasks, overlappingFixedEventUids } = require('../src/log-core');

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function random(seed) {
  return () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
}

// Independent integer-minute occupancy oracle. It searches free cells, not
// normalized intervals or the production scheduler's advancing interval index.
function gridSchedule({ startMinutes: start, endMinutes: end, nowMinutes: now, tasks, fixedEvents }) {
  const first = Math.max(start, Math.min(end, now));
  const occupied = Array.from({ length: end - start }, (_, offset) => {
    const minute = start + offset;
    return minute >= first && fixedEvents.some(event => event.meeting === true
      && event.end > event.start && event.start <= minute && minute < event.end);
  });
  const fixed = [];
  for (let minute = start; minute < end;) {
    if (!occupied[minute - start]) { minute += 1; continue; }
    const from = minute;
    while (minute < end && occupied[minute - start]) minute += 1;
    fixed.push({ meeting: true, fixed: true, start: from, end: minute, duration: minute - from });
  }
  let cursor = first;
  const scheduledTasks = [], overflowTasks = [];
  for (const task of tasks) {
    const duration = Math.round(task.duration);
    if (task.done || duration <= 0) continue;
    let position = null;
    for (let candidate = cursor; candidate + duration <= end; candidate += 1) {
      if (!occupied.slice(candidate - start, candidate - start + duration).some(Boolean)) {
        position = candidate;
        break;
      }
    }
    if (position === null) {
      overflowTasks.push({ ...task, duration });
      cursor = end;
    } else {
      scheduledTasks.push({ ...task, duration, start: position, end: position + duration });
      cursor = position + duration;
    }
  }
  return {
    scheduledTasks, overflowTasks,
    fixedMinutes: occupied.filter(Boolean).length,
    intervals: fixed.concat(scheduledTasks).sort((left, right) => left.start - right.start),
  };
}

// Deliberately pairwise: an independent, small-fixture specification oracle for
// the optimized sorted scan. Returning original order preserves duplicate UIDs.
function pairwiseConflicts(events) {
  const eligible = events.filter(event => event && event.uid && event.meeting === true
    && Number.isFinite(event.start) && Number.isFinite(event.end) && event.end > event.start);
  const conflicts = new Set();
  for (let left = 0; left < eligible.length; left += 1) {
    for (let right = left + 1; right < eligible.length; right += 1) {
      if (Math.max(eligible[left].start, eligible[right].start)
          < Math.min(eligible[left].end, eligible[right].end)) {
        conflicts.add(eligible[left].uid);
        conflicts.add(eligible[right].uid);
      }
    }
  }
  return eligible.filter(event => conflicts.has(event.uid)).map(event => event.uid);
}

test('task placement preserves whole tasks and queue order across consecutive fixed gaps', () => {
  const input = freeze({ startMinutes: 0, endMinutes: 16, nowMinutes: 0,
    tasks: [{ uid: 'a', duration: 3 }, { uid: 'b', duration: 3 }, { uid: 'c', duration: 3 }, { uid: 'tail', duration: 1 }],
    fixedEvents: [{ uid: 'late', meeting: true, start: 7, end: 9, done: true },
      { uid: 'early', meeting: true, start: 2, end: 4 }] });
  const result = scheduleTasks(input);
  assert.deepEqual(result.scheduledTasks.map(row => [row.uid, row.start, row.end]),
    [['a', 4, 7], ['b', 9, 12], ['c', 12, 15], ['tail', 15, 16]]);
  assert.equal(result.fixedMinutes, 4);
  const blocked = scheduleTasks({ ...input, endMinutes: 11 });
  assert.deepEqual(blocked.scheduledTasks.map(row => row.uid), ['a']);
  assert.deepEqual(blocked.overflowTasks.map(row => row.uid), ['b', 'c', 'tail']);
});

test('a fixed interval ending exactly at the cursor is consumed without delaying the next task', () => {
  const result = scheduleTasks(freeze({ startMinutes: 0, endMinutes: 10, nowMinutes: 0,
    tasks: [{ uid: 'first', duration: 2 }, { uid: 'next', duration: 1 }],
    fixedEvents: [{ meeting: true, start: 0, end: 2 }, { meeting: true, start: 4, end: 6 }] }));
  assert.deepEqual(result.scheduledTasks.map(row => [row.uid, row.start, row.end]), [['first', 2, 4], ['next', 6, 7]]);
});

test('interval scheduling retains rounding, zero/DONE skipping and ignored retired floors', () => {
  const result = scheduleTasks(freeze({ startMinutes: 1260, endMinutes: 1265, nowMinutes: 1200,
    tasks: [{ uid: 'zero', duration: 0.4 }, { uid: 'done', duration: 4, done: true },
      { uid: 'a', duration: 1.6, earliestStart: 9999 }, { uid: 'b', duration: '1' },
      { uid: 'invalid', duration: 'bad' }, { uid: 'negative', duration: -1 }], fixedEvents: [] }));
  assert.deepEqual(result.scheduledTasks.map(row => [row.uid, row.duration, row.start, row.end]),
    [['a', 2, 1260, 1262], ['b', 1, 1262, 1263]]);
  assert.deepEqual(result.overflowTasks, []);
});

test('invalid windows retain the existing unfiltered overflow contract', () => {
  const tasks = freeze([{ uid: 'zero', duration: 0 }, { uid: 'done', duration: 5, done: true }]);
  for (const endMinutes of [10, 9, NaN]) {
    const result = scheduleTasks({ startMinutes: 10, endMinutes, tasks, fixedEvents: [] });
    assert.deepEqual(result, { scheduledTasks: [], overflowTasks: tasks, fixedMinutes: 0, intervals: [] });
    assert.notEqual(result.overflowTasks, tasks);
  }
});

test('interval scheduling agrees with a minute-grid oracle over 1000 deterministic day and overnight cases', () => {
  const next = random(0x149fc3a);
  for (let index = 0; index < 1000; index += 1) {
    const start = index % 3 === 0 ? 1380 : 300;
    const end = start + 1 + Math.floor(next() * 120);
    const input = freeze({ startMinutes: start, endMinutes: end,
      nowMinutes: start - 10 + Math.floor(next() * (end - start + 20)),
      tasks: Array.from({ length: Math.floor(next() * 40) }, (_, order) => ({
        uid: `task-${order}`, duration: Math.floor(next() * 25), done: next() < 0.15,
        earliestStart: end + 30, metadata: { order },
      })),
      fixedEvents: Array.from({ length: Math.floor(next() * 25) }, (_, order) => {
        const from = start - 10 + Math.floor(next() * (end - start + 20));
        return { uid: `event-${order}`, meeting: next() > 0.15, done: next() < 0.5,
          start: from, end: from + Math.floor(next() * 35) };
      }),
    });
    assert.deepEqual(scheduleTasks(input), gridSchedule(input), `minute-grid case ${index}`);
  }
});

test('conflict detection preserves input order, containment, equal starts and duplicate UID entries', () => {
  const events = freeze([
    { uid: 'later', meeting: true, start: 8, end: 12 },
    { uid: 'inner', meeting: true, start: 2, end: 3 },
    { uid: 'outer', meeting: true, start: 0, end: 10, done: true },
    { uid: 'touch', meeting: true, start: 12, end: 15 },
    { uid: 'separate', meeting: true, start: 20, end: 21 },
    { uid: 'equal-start', meeting: true, start: 0, end: 1 },
    { uid: 'inner', meeting: true, start: 40, end: 41 },
  ]);
  assert.deepEqual(overlappingFixedEventUids({ events }), ['later', 'inner', 'outer', 'equal-start', 'inner']);
});

test('conflict chains include intermediate owners without making touching or malformed intervals conflicts', () => {
  const events = freeze([
    { uid: 'last', meeting: true, start: 3, end: 5 },
    { uid: 'middle', meeting: true, start: 1, end: 3 },
    { uid: 'first', meeting: true, start: 0, end: 2 },
    { uid: 'link', meeting: true, start: 2, end: 4 },
    { uid: 'touch', meeting: true, start: 5, end: 6 },
    { uid: 'not-fixed', meeting: false, start: 0, end: 20 },
    { uid: 'empty', meeting: true, start: 1, end: 1 },
    { uid: 'bad', meeting: true, start: NaN, end: 20 },
    { uid: '', meeting: true, start: 0, end: 20 }, null,
  ]);
  assert.deepEqual(overlappingFixedEventUids({ events }), ['last', 'middle', 'first', 'link']);
});

test('conflict detection agrees with a pairwise oracle over 1500 deterministic unsorted cases', () => {
  const next = random(0x257be4);
  for (let index = 0; index < 1500; index += 1) {
    const events = freeze(Array.from({ length: Math.floor(next() * 70) }, (_, order) => {
      const start = Math.floor(next() * 180) - 20;
      return { uid: order % 7 === 0 ? 'repeated' : `event-${order}`, meeting: next() > 0.2,
        done: next() < 0.5, start, end: start + Math.floor(next() * 50) - 5 };
    }));
    assert.deepEqual(overlappingFixedEventUids({ events }), pairwiseConflicts(events), `pairwise case ${index}`);
  }
});
