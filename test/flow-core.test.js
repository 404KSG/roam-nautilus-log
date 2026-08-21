const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeScheduleSettings,
  scheduleTasks,
  calculateCapacity,
  formatDuration,
  formatCapacitySummary,
  truncateTextToWidth,
  placeLabelTracks,
} = require('../src/flow-core');

test('normalizes selectable start/end hours and keeps 24:00 as minute 1440', () => {
  assert.deepEqual(
    normalizeScheduleSettings({ startHour: 5, endHour: 24 }),
    { startHour: 5, endHour: 24, startMinutes: 300, endMinutes: 1440 },
  );
  assert.deepEqual(
    normalizeScheduleSettings({ startHour: 3, endHour: 17 }),
    { startHour: 5, endHour: 24, startMinutes: 300, endMinutes: 1440 },
  );
  assert.deepEqual(
    normalizeScheduleSettings({ startHour: '8', endHour: '18' }),
    { startHour: 8, endHour: 18, startMinutes: 480, endMinutes: 1080 },
  );
});

test('greedily schedules flexible tasks around fixed events and returns overflow', () => {
  const result = scheduleTasks({
    startMinutes: 300,
    endMinutes: 600,
    nowMinutes: 300,
    tasks: [
      { uid: 'a', description: 'First', duration: 120 },
      { uid: 'b', description: 'Second', duration: 90 },
      { uid: 'c', description: 'Third', duration: 60 },
    ],
    fixedEvents: [{ uid: 'meeting', meeting: true, start: 420, end: 480 }],
  });

  assert.deepEqual(
    result.scheduledTasks.map(({ uid, start, end }) => ({ uid, start, end })),
    [
      { uid: 'a', start: 300, end: 420 },
      { uid: 'b', start: 480, end: 570 },
    ],
  );
  assert.deepEqual(result.overflowTasks.map((task) => task.uid), ['c']);
  assert.equal(result.fixedMinutes, 60);
});

test('capacity counts only remaining today, subtracts future fixed time, and excludes DONE', () => {
  const result = calculateCapacity({
    startMinutes: 300,
    endMinutes: 1440,
    nowMinutes: 600,
    fixedEvents: [
      { meeting: true, start: 660, end: 720 },
      { meeting: true, start: 700, end: 750 },
      { meeting: true, start: 500, end: 630 },
    ],
    pendingTasks: [
      { uid: 'one', duration: 120, done: false },
      { uid: 'done', duration: 999, done: true },
      { uid: 'partial', duration: 60, progress: 50, done: false },
    ],
  });

  assert.equal(result.availableMinutes, 720); // 600..1440 minus 600..630 and merged 660..750
  assert.equal(result.demandMinutes, 150);
  assert.equal(result.overloadMinutes, 0);
  assert.equal(result.slackMinutes, 570);
  assert.equal(result.fixedMinutes, 120);
});

test('capacity reports overflow instead of silently dropping tasks', () => {
  const result = calculateCapacity({
    startMinutes: 300,
    endMinutes: 360,
    nowMinutes: 300,
    fixedEvents: [],
    pendingTasks: [
      { uid: 'a', duration: 45, done: false },
      { uid: 'b', duration: 30, done: false },
    ],
  });

  assert.equal(result.availableMinutes, 60);
  assert.equal(result.demandMinutes, 75);
  assert.equal(result.overloadMinutes, 15);
  assert.deepEqual(result.overflowTasks.map((task) => task.uid), ['b']);
});

test('formats capacity values in the compact dashboard style', () => {
  assert.equal(formatDuration(200), '3h20m');
  assert.equal(formatDuration(0), '0m');
  assert.equal(
    formatCapacitySummary({ availableMinutes: 200, demandMinutes: 245, overloadMinutes: 45, slackMinutes: 0 }),
    '可安排 3h20m · 待办需求 4h05m · 超载 45m',
  );
  assert.equal(
    formatCapacitySummary({ availableMinutes: 200, demandMinutes: 160, overloadMinutes: 0, slackMinutes: 40 }),
    '可安排 3h20m · 待办需求 2h40m · 余量 40m',
  );
});

test('truncates mixed Chinese/ASCII text by measured width and keeps the full value available', () => {
  assert.equal(truncateTextToWidth('研究 Nautilus 中文任务', 8), '研究 Na…');
  assert.equal(truncateTextToWidth('short', 20), 'short');
});

test('places colliding labels on a finite set of tracks', () => {
  const labels = [
    { uid: 'a', start: 0, end: 30 },
    { uid: 'b', start: 10, end: 40 },
    { uid: 'c', start: 20, end: 50 },
    { uid: 'd', start: 50, end: 70 },
  ];
  const placed = placeLabelTracks(labels, 3);
  assert.deepEqual(placed.map(({ uid, track }) => ({ uid, track })), [
    { uid: 'a', track: 0 },
    { uid: 'b', track: 1 },
    { uid: 'c', track: 2 },
    { uid: 'd', track: 0 },
  ]);
  assert.ok(placed.every(({ track }) => track >= 0 && track < 3));
});
