const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeScheduleSettings,
  resolveRendererSettings,
  hourlyGridSegments,
  uiCopy,
  capacityMetrics,
  scheduleTasks,
  historicalDoneSlice,
  calculateCapacity,
  formatDuration,
  formatCapacitySummary,
  truncateTextToWidth,
  placeLabelTracks,
} = require('../src/flow-core');

test('the chart background uses one grid sector per hour', () => {
  assert.deepEqual(hourlyGridSegments({ startMinutes: 300, endMinutes: 420 }), [
    { start: 300, end: 360, label: '5' },
    { start: 360, end: 420, label: '6' },
  ]);
});

test('English UI settings localize all extension-owned status labels', () => {
  const copy = uiCopy('en');
  assert.deepEqual(copy.legend, { urgent: 'Urgent', event: 'Event', task: 'Task' });
  assert.deepEqual(copy.controls, {
    hideDone: 'Hide completed items',
    showDone: 'Show completed items',
    playback: 'Play back the day',
    collapse: 'Collapse Nautilus Flow',
    expand: 'Expand Nautilus Flow',
  });
  assert.deepEqual(copy.panels, {
    overflow: 'Unscheduled today',
    warnings: 'Schedule warnings',
    item: 'item',
    items: 'items',
  });
  assert.deepEqual(
    capacityMetrics({
      language: 'en',
      capacity: { availableMinutes: 0, demandMinutes: 30, overloadMinutes: 30, slackMinutes: 0, unplacedMinutes: 30 },
    }),
    [
      { key: 'available', label: 'Available', value: '0m', tone: 'neutral' },
      { key: 'demand', label: 'Demand', value: '30m', tone: 'neutral' },
      { key: 'overload', label: 'Overload', value: '30m', tone: 'warning' },
    ],
  );
});

test('runtime extension settings override stale or nested render arguments', () => {
  assert.deepEqual(
    resolveRendererSettings({
      args: [[22, 15, 5, '#T0', 24]],
      runtime: {
        'desc-length': '20',
        'todo-duration': '30',
        'workday-start': '6',
        'color-1-trigger': '#Top',
        'workday-end': '21',
        language: 'en',
      },
    }),
    {
      'legend-len-limit': 20,
      'default-duration': 30,
      'workday-start': 360,
      'workday-end': 1260,
      'workday-start-hour': 6,
      'workday-end-hour': 21,
      'custom-color-1-tag': '#Top',
      language: 'en',
    },
  );
});

test('legacy render arguments remain a fallback when runtime settings are absent', () => {
  assert.equal(resolveRendererSettings({ args: [22, 15, 5, '#T0', 21] })['workday-end'], 1260);
});

test('historical DONE slices use explicit completion time minus the original estimate', () => {
  const result = historicalDoneSlice({
    done: true,
    doneAt: 21 * 60 + 50,
    duration: 60,
    // This value must never become the historical start.
    previousDoneAt: 18 * 60,
  });

  assert.deepEqual(result, { start: 20 * 60 + 50, end: 21 * 60 + 50, duration: 60 });
});

test('historical DONE slices use the default estimate when no duration is present', () => {
  assert.deepEqual(
    historicalDoneSlice({ done: true, doneAt: 1310, defaultDuration: 15 }),
    { start: 1295, end: 1310, duration: 15 },
  );
});

test('DONE without an explicit completion time does not manufacture a historical interval', () => {
  assert.equal(historicalDoneSlice({ done: true, duration: 60 }), null);
  assert.equal(historicalDoneSlice({ done: false, doneAt: 1310, duration: 60 }), null);
});

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
  assert.equal(result.unplacedMinutes, 30);
  assert.deepEqual(result.overflowTasks.map((task) => task.uid), ['b']);
});

test('reports fragmented free time when an atomic task cannot fit any continuous slot', () => {
  const result = calculateCapacity({
    startMinutes: 300,
    endMinutes: 420,
    nowMinutes: 300,
    fixedEvents: [
      { meeting: true, start: 330, end: 360 },
      { meeting: true, start: 390, end: 420 },
    ],
    pendingTasks: [{ uid: 'atomic', duration: 45, done: false }],
  });

  assert.equal(result.availableMinutes, 60);
  assert.equal(result.demandMinutes, 45);
  assert.equal(result.overloadMinutes, 0);
  assert.equal(result.unplacedMinutes, 45);
  assert.equal(
    formatCapacitySummary(result),
    '可安排 1h00m · 待办需求 45m · 空档不足 45m',
  );
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

test('accepts the object-shaped truncation contract used by the Roam renderer', () => {
  assert.equal(
    truncateTextToWidth({ text: '研究 Nautilus 中文任务', maxWidth: 8 }),
    '研究 Na…',
  );
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

test('accepts the object-shaped label contract used by the Roam renderer', () => {
  const placed = placeLabelTracks({
    labels: [
      { uid: 'a', start: 0, end: 30 },
      { uid: 'b', start: 10, end: 40 },
    ],
    maxTracks: 2,
  });
  assert.deepEqual(placed.map(({ uid, track }) => ({ uid, track })), [
    { uid: 'a', track: 0 },
    { uid: 'b', track: 1 },
  ]);
});
