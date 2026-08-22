const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeScheduleSettings,
  resolveRendererSettings,
  hourlyGridSegments,
  pastTimelineSegments,
  pastUnplannedSegments,
  pastItemStatus,
  spiralCellInnerHour,
  overlappingFixedEventUids,
  isCurrentPlannedTask,
  uiCopy,
  capacityMetrics,
  scheduleTasks,
  completedTaskClockSummary,
  historicalDoneSlice,
  calculateCapacity,
  burningCapacityBucket,
  formatDuration,
  formatCapacitySummary,
  truncateTextToWidth,
  placeLabelTracks,
  placeExternalLabels,
  isCompactChartWidth,
} = require('../src/log-core');

test('the chart background uses one grid sector per hour', () => {
  assert.deepEqual(hourlyGridSegments({ startMinutes: 300, endMinutes: 420 }), [
    { start: 300, end: 360, label: '5' },
    { start: 360, end: 420, label: '6' },
  ]);
});

test('past timeline segments include the exact partial current hour', () => {
  assert.deepEqual(
    pastTimelineSegments({ startMinutes: 300, endMinutes: 600, nowMinutes: 557 }),
    [
      { start: 300, end: 360 },
      { start: 360, end: 420 },
      { start: 420, end: 480 },
      { start: 480, end: 540 },
      { start: 540, end: 557 },
    ],
  );
});

test('past timeline segments respect workday bounds', () => {
  assert.deepEqual(pastTimelineSegments({ startMinutes: 300, endMinutes: 420, nowMinutes: 299 }), []);
  assert.deepEqual(
    pastTimelineSegments({ startMinutes: 300, endMinutes: 420, nowMinutes: 999 }),
    [{ start: 300, end: 360 }, { start: 360, end: 420 }],
  );
  assert.deepEqual(pastTimelineSegments({ startMinutes: 420, endMinutes: 300, nowMinutes: 360 }), []);
});

test('past unplanned segments subtract real work and ignore generated free-time placeholders', () => {
  assert.deepEqual(
    pastUnplannedSegments({
      startMinutes: 300,
      endMinutes: 600,
      nowMinutes: 500,
      occupiedEvents: [
        { uid: 'meeting', meeting: true, start: 330, end: 380 },
        { uid: 'overlap', todo: true, start: 370, end: 390 },
        { freetime: true, start: 390, end: 420 },
        { uid: 'done', todo: true, done: true, start: 420, end: 450 },
        { uid: 'current', todo: true, start: 470, end: 520 },
      ],
    }),
    [
      { start: 300, end: 330 },
      { start: 390, end: 420 },
      { start: 450, end: 470 },
    ],
  );
});

test('past unplanned segments follow spiral hour-cell boundaries', () => {
  assert.deepEqual(
    pastUnplannedSegments({
      startMinutes: 300,
      endMinutes: 600,
      nowMinutes: 500,
      occupiedEvents: [],
    }),
    [
      { start: 300, end: 360 },
      { start: 360, end: 420 },
      { start: 420, end: 480 },
      { start: 480, end: 500 },
    ],
  );
  assert.deepEqual(
    pastUnplannedSegments({ startMinutes: 300, endMinutes: 600, nowMinutes: 299 }),
    [],
  );
});

test('past item status keeps only completed work and elapsed events', () => {
  const common = { start: 510, end: 570 };
  assert.equal(
    pastItemStatus({ event: { ...common, todo: true, done: true }, nowMinutes: 570, dailyPage: true }),
    'completed',
  );
  assert.equal(
    pastItemStatus({ event: { ...common, todo: true }, nowMinutes: 570, dailyPage: true }),
    null,
  );
  assert.equal(
    pastItemStatus({ event: { ...common, meeting: true }, nowMinutes: 570, dailyPage: true }),
    'event',
  );
  assert.equal(
    pastItemStatus({ event: { ...common, todo: true }, nowMinutes: 569, dailyPage: true }),
    null,
  );
  assert.equal(
    pastItemStatus({ event: { ...common, todo: true }, nowMinutes: 600, dailyPage: false }),
    null,
  );
});

test('paired clock hours occupy separate spiral cells', () => {
  assert.equal(spiralCellInnerHour({ startMinute: 300, endMinutes: 1440 }), 17);
  assert.equal(spiralCellInnerHour({ startMinute: 330, endMinutes: 1440 }), 17);
  assert.equal(spiralCellInnerHour({ startMinute: 1020, endMinutes: 1440 }), null);
  assert.equal(spiralCellInnerHour({ startMinute: 540, endMinutes: 1260 }), null);
  assert.equal(spiralCellInnerHour({ startMinute: 300, endMinutes: 1020 }), null);
});

test('fixed event conflicts use half-open overlap boundaries', () => {
  assert.deepEqual(
    overlappingFixedEventUids({
      events: [
        { uid: 'a', meeting: true, start: 540, end: 600 },
        { uid: 'b', meeting: true, start: 590, end: 630 },
        { uid: 'touching', meeting: true, start: 630, end: 660 },
        { uid: 'task', meeting: false, start: 550, end: 620 },
        { uid: 'done', meeting: true, done: true, start: 550, end: 620 },
      ],
    }),
    ['a', 'b'],
  );
  assert.deepEqual(overlappingFixedEventUids({ events: [] }), []);
});

test('current planned task uses daily-page and half-open time boundaries', () => {
  const event = { uid: 'task', todo: true, start: 570, end: 630 };
  assert.equal(isCurrentPlannedTask({ event, nowMinutes: 570, dailyPage: true }), true);
  assert.equal(isCurrentPlannedTask({ event, nowMinutes: 629, dailyPage: true }), true);
  assert.equal(isCurrentPlannedTask({ event, nowMinutes: 630, dailyPage: true }), false);
  assert.equal(isCurrentPlannedTask({ event, nowMinutes: 600, dailyPage: false }), false);
  assert.equal(isCurrentPlannedTask({ event: { ...event, done: true }, nowMinutes: 600, dailyPage: true }), false);
  assert.equal(isCurrentPlannedTask({ event: { ...event, todo: false }, nowMinutes: 600, dailyPage: true }), false);
});

test('English UI settings localize all extension-owned status labels', () => {
  const copy = uiCopy('en');
  assert.equal(copy.capacity.burningAvailable, 'Flexible time is elapsing');
  assert.equal(copy.capacity.burningEvents, 'Event time is elapsing');
  assert.equal(uiCopy('zh').capacity.burningAvailable, '可安排时间正在流逝');
  assert.equal(uiCopy('zh').capacity.burningEvents, '事件时间正在流逝');
  assert.deepEqual(copy.legend, { urgent: 'Urgent', event: 'Event', task: 'Task' });
  assert.deepEqual(copy.controls, {
    hideDone: 'Hide completed items',
    showDone: 'Show completed items',
    playback: 'Play back the day',
    collapse: 'Collapse Nautilus Log',
    expand: 'Expand Nautilus Log',
  });
  assert.deepEqual(copy.panels, {
    overview: 'Overview',
    overflow: 'Unscheduled today',
    warnings: 'Schedule warnings',
    schedule: 'Schedule',
    item: 'item',
    items: 'items',
  });
  assert.deepEqual(
    capacityMetrics({
      language: 'en',
      capacity: { availableMinutes: 0, fixedMinutes: 90, demandMinutes: 30, overloadMinutes: 30, slackMinutes: 0, unplacedMinutes: 30 },
    }),
    [
      { key: 'demand', label: 'Planned', value: '30m', percent: '—', percentTone: 'neutral', tone: 'neutral' },
      { key: 'overload', label: 'Overload', value: '30m', tone: 'warning' },
      { key: 'available', label: 'Available', value: '0m', tone: 'neutral' },
      { key: 'events', label: 'Events', value: '1h30m', tone: 'event' },
    ],
  );
  assert.equal(uiCopy('zh').capacity.demand, '已计划');
});

test('capacity metrics mark exactly the bucket that is currently burning', () => {
  const metrics = capacityMetrics({
    language: 'en',
    capacity: {
      availableMinutes: 420,
      fixedMinutes: 60,
      demandMinutes: 30,
      slackMinutes: 390,
      burningBucket: 'events',
    },
  });

  assert.equal(metrics[0].burning, undefined);
  assert.equal(metrics[1].burning, undefined);
  assert.equal(metrics[2].burning, undefined);
  assert.equal(metrics[3].burning, true);
  assert.equal(metrics[3].burningLabel, 'Event time is elapsing');
});

test('Planned reports its share of available flexible time without capping overload', () => {
  assert.deepEqual(
    capacityMetrics({
      language: 'en',
      capacity: { availableMinutes: 540, fixedMinutes: 420, demandMinutes: 105, overloadMinutes: 0, slackMinutes: 435, unplacedMinutes: 0 },
    })[0],
    { key: 'demand', label: 'Planned', value: '1h45m', percent: '19%', percentTone: 'neutral', tone: 'neutral' },
  );

  const overloadedDemand = capacityMetrics({
      language: 'en',
      capacity: { availableMinutes: 90, demandMinutes: 105 },
    })[0];
  assert.equal(overloadedDemand.percent, '117%');
  assert.equal(overloadedDemand.percentTone, 'warning');
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
  const settings = resolveRendererSettings({ args: [22, 15, 5, '#T0', 21] });
  assert.equal(settings['workday-end'], 1260);
  assert.equal(settings.language, 'en');
  assert.equal(uiCopy().capacity.available, 'Available');
  assert.equal(uiCopy('zh').capacity.available, '可安排');
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

test('completed task CLOCK summary condenses multiple closed sessions into one daily Actual total', () => {
  const dayStartMs = new Date(2026, 7, 22, 0, 0).getTime();
  const dayEndMs = new Date(2026, 7, 23, 0, 0).getTime();
  const at = (hour, minute) => new Date(2026, 7, 22, hour, minute);

  assert.deepEqual(
    completedTaskClockSummary({
      taskUid: 'task-a',
      dayStartMs,
      dayEndMs,
      entries: [
        { taskUid: 'task-a', start: at(9, 0), end: at(9, 20), running: false },
        { taskUid: 'task-a', start: at(10, 30), end: at(10, 45), running: false },
        { taskUid: 'task-a', start: at(11, 0), running: true },
        { taskUid: 'task-b', start: at(8, 0), end: at(9, 0), running: false },
      ],
    }),
    { actualMinutes: 35, sessionCount: 2, latestEndMinutes: 10 * 60 + 45 },
  );
});

test('historical DONE slices prefer Actual and use the latest CLOCK end when no done marker exists', () => {
  assert.deepEqual(
    historicalDoneSlice({
      done: true,
      doneAt: null,
      duration: 60,
      actualDuration: 35,
      lastClockEnd: 10 * 60 + 45,
    }),
    { start: 10 * 60 + 10, end: 10 * 60 + 45, duration: 35, durationSource: 'actual' },
  );
});

test('completed task Actual clips cross-midnight sessions to the displayed day', () => {
  const dayStartMs = new Date(2026, 7, 22, 0, 0).getTime();
  const dayEndMs = new Date(2026, 7, 23, 0, 0).getTime();

  assert.deepEqual(
    completedTaskClockSummary({
      taskUid: 'task-a',
      dayStartMs,
      dayEndMs,
      entries: [
        {
          taskUid: 'task-a',
          start: new Date(2026, 7, 21, 23, 50),
          end: new Date(2026, 7, 22, 0, 20),
          running: false,
        },
        {
          taskUid: 'task-a',
          start: new Date(2026, 7, 22, 23, 30),
          end: new Date(2026, 7, 23, 0, 30),
          running: false,
        },
        {
          taskUid: 'task-a',
          start: new Date(2026, 7, 21, 20, 0),
          end: new Date(2026, 7, 21, 21, 0),
          running: false,
        },
      ],
    }),
    { actualMinutes: 50, sessionCount: 2, latestEndMinutes: 24 * 60 },
  );
});

test('completed task Actual may exceed Planned without being capped', () => {
  assert.deepEqual(
    historicalDoneSlice({
      done: true,
      doneAt: 12 * 60,
      duration: 30,
      actualDuration: 80,
      lastClockEnd: 12 * 60,
    }),
    { start: 10 * 60 + 40, end: 12 * 60, duration: 80, durationSource: 'actual' },
  );
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
    { startHour: 5, endHour: 21, startMinutes: 300, endMinutes: 1260 },
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

test('capacity keeps stable full-day totals and counts overlapping fixed events once', () => {
  const activeFixedEvents = [
    { uid: 'past-and-current', meeting: true, start: 500, end: 630 },
    { uid: 'overlap-a', meeting: true, start: 660, end: 720 },
    { uid: 'overlap-b', meeting: true, start: 700, end: 750 },
    { uid: 'clipped-at-end', meeting: true, start: 1200, end: 1320 },
  ];
  const result = calculateCapacity({
    startMinutes: 300,
    endMinutes: 1260,
    nowMinutes: 600,
    fixedEvents: activeFixedEvents,
    allFixedEvents: [
      { uid: 'completed-morning', meeting: true, done: true, start: 360, end: 420 },
      ...activeFixedEvents,
    ],
    pendingTasks: [],
  });

  assert.equal(result.fixedMinutes, 180); // 600..630, merged 660..750, 1200..1260
  assert.equal(result.availableMinutes, 480); // 600..1260 minus remaining fixed time
  assert.equal(result.totalFixedMinutes, 340); // 60 + 130 + 90 + 60
  assert.equal(result.totalAvailableMinutes, 620); // full 960-minute range minus fixed union
});

test('capacity metrics expose optional current / full-day ratios', () => {
  const metrics = capacityMetrics({
    language: 'en',
    capacity: {
      availableMinutes: 451,
      totalAvailableMinutes: 540,
      fixedMinutes: 195,
      totalFixedMinutes: 420,
      demandMinutes: 105,
      overloadMinutes: 0,
      slackMinutes: 346,
    },
  });

  assert.equal(metrics[2].value, '7h31m');
  assert.equal(metrics[2].total, '9h');
  assert.equal(metrics[3].value, '3h15m');
  assert.equal(metrics[3].total, '7h');
});

test('burning bucket uses half-open event boundaries and workday bounds', () => {
  const options = {
    startMinutes: 300,
    endMinutes: 1440,
    fixedEvents: [{ uid: 'meeting', meeting: true, start: 540, end: 600 }],
  };

  assert.equal(burningCapacityBucket({ ...options, nowMinutes: 299 }), null);
  assert.equal(burningCapacityBucket({ ...options, nowMinutes: 300 }), 'available');
  assert.equal(burningCapacityBucket({ ...options, nowMinutes: 540 }), 'events');
  assert.equal(burningCapacityBucket({ ...options, nowMinutes: 599 }), 'events');
  assert.equal(burningCapacityBucket({ ...options, nowMinutes: 600 }), 'available');
  assert.equal(burningCapacityBucket({ ...options, nowMinutes: 1440 }), null);
  assert.equal(burningCapacityBucket({ ...options, nowMinutes: 1500 }), null);
});

test('burning bucket ignores completed/non-meeting events and treats overlaps as Events', () => {
  const fixedEvents = [
    { uid: 'done', meeting: true, done: true, start: 500, end: 620 },
    { uid: 'task', meeting: false, start: 520, end: 640 },
    { uid: 'first', meeting: true, start: 600, end: 660 },
    { uid: 'overlap', meeting: true, start: 640, end: 720 },
  ];

  assert.equal(burningCapacityBucket({ startMinutes: 300, endMinutes: 900, nowMinutes: 599, fixedEvents }), 'available');
  assert.equal(burningCapacityBucket({ startMinutes: 300, endMinutes: 900, nowMinutes: 600, fixedEvents }), 'events');
  assert.equal(burningCapacityBucket({ startMinutes: 300, endMinutes: 900, nowMinutes: 659, fixedEvents }), 'events');
  assert.equal(burningCapacityBucket({ startMinutes: 300, endMinutes: 900, nowMinutes: 660, fixedEvents }), 'events');
  assert.equal(burningCapacityBucket({ startMinutes: 300, endMinutes: 900, nowMinutes: 720, fixedEvents }), 'available');
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
    '可安排 1h · 事件 1h · 待办需求 45m · 空档不足 45m',
  );
});

test('formats capacity values in the compact dashboard style', () => {
  assert.equal(formatDuration(540), '9h');
  assert.equal(formatDuration(200), '3h20m');
  assert.equal(formatDuration(0), '0m');
  assert.equal(
    formatCapacitySummary({ availableMinutes: 200, demandMinutes: 245, overloadMinutes: 45, slackMinutes: 0 }),
    '可安排 3h20m · 事件 0m · 待办需求 4h05m · 超载 45m',
  );
  assert.equal(
    formatCapacitySummary({ availableMinutes: 200, demandMinutes: 160, overloadMinutes: 0, slackMinutes: 40 }),
    '可安排 3h20m · 事件 0m · 待办需求 2h40m · 余量 40m',
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

test('keeps the full task-label rectangle outside the spiral exclusion zone', () => {
  const exclusionRadius = 100;
  const gap = 24;
  const [label] = placeExternalLabels({
    centerX: 200,
    centerY: 200,
    exclusionRadius,
    gap,
    labels: [{ uid: 'long-cn', angle: 2.35, width: 180, height: 20 }],
  });
  const corners = [
    [label.x, label.y],
    [label.x + label.width, label.y],
    [label.x, label.y + label.height],
    [label.x + label.width, label.y + label.height],
  ];

  assert.ok(corners.every(([x, y]) => Math.hypot(x - 200, y - 200) >= exclusionRadius + gap));
});

test('moves colliding labels to progressively farther external tracks', () => {
  const placed = placeExternalLabels({
    centerX: 200,
    centerY: 200,
    exclusionRadius: 100,
    gap: 24,
    trackGap: 18,
    collisionPadding: 6,
    labels: [
      { uid: 'first', angle: 2, width: 150, height: 20 },
      { uid: 'second', angle: 2, width: 150, height: 20 },
    ],
  });

  assert.deepEqual(placed.map(({ track }) => track), [0, 2]);
  assert.ok(placed[1].x < placed[0].x);
  assert.ok(placed[1].y < placed[0].y);
});

test('side-rail labels stay beside the spiral and inside a compact vertical band', () => {
  const centerX = 300;
  const centerY = 210;
  const exclusionRadius = 150;
  const gap = 24;
  const maxVerticalOffset = 92;
  const placed = placeExternalLabels({
    centerX,
    centerY,
    exclusionRadius,
    gap,
    maxVerticalOffset,
    layout: 'side-rails',
    labels: [
      { uid: 'top', angle: Math.PI / 2, width: 180, height: 20 },
      { uid: 'upper-left', angle: 2.35, width: 160, height: 20 },
      { uid: 'bottom', angle: -Math.PI / 2, width: 150, height: 20 },
      { uid: 'lower-right', angle: -0.8, width: 140, height: 20 },
    ],
  });

  assert.ok(placed.every((label) => {
    const completelyLeft = label.x + label.width <= centerX - exclusionRadius - gap;
    const completelyRight = label.x >= centerX + exclusionRadius + gap;
    const labelCenterY = label.y + label.height / 2;
    return (completelyLeft || completelyRight)
      && Math.abs(labelCenterY - centerY) <= maxVerticalOffset;
  }));
  assert.ok(Math.max(...placed.map(({ y, height }) => y + height))
    - Math.min(...placed.map(({ y }) => y)) <= maxVerticalOffset * 2 + 20);
});

test('side-rail collisions use nearby vertical rows before widening the chart', () => {
  const placed = placeExternalLabels({
    centerX: 300,
    centerY: 210,
    exclusionRadius: 150,
    gap: 24,
    maxVerticalOffset: 138,
    rowGap: 32,
    collisionPadding: 6,
    layout: 'side-rails',
    labels: [
      { uid: 'first', angle: 2.35, width: 180, height: 20 },
      { uid: 'second', angle: 2.35, width: 180, height: 20 },
    ],
  });

  assert.deepEqual(placed.map(({ track }) => track), [0, 0]);
  assert.equal(placed[0].x, placed[1].x);
  assert.notEqual(placed[0].y, placed[1].y);
  assert.ok(Math.abs(placed[1].y - placed[0].y) >= 26);
});

test('side-rail labels preserve connector order instead of crossing after collision nudges', () => {
  const placed = placeExternalLabels({
    centerX: 300,
    centerY: 210,
    exclusionRadius: 150,
    gap: 24,
    maxVerticalOffset: 138,
    rowGap: 26,
    collisionPadding: 6,
    layout: 'side-rails',
    labels: [
      { uid: 'earlier', angle: 2.2, width: 180, height: 20, anchorY: 90, sortKey: 600 },
      { uid: 'later', angle: 2.15, width: 180, height: 20, anchorY: 82, sortKey: 660 },
      { uid: 'latest', angle: 2.1, width: 180, height: 20, anchorY: 74, sortKey: 720 },
    ],
  });
  const byAnchor = placed.slice().sort((first, second) => first.anchorY - second.anchorY);
  const labelCenters = byAnchor.map((label) => label.y + label.height / 2);

  assert.deepEqual(byAnchor.map(({ uid }) => uid), ['latest', 'later', 'earlier']);
  assert.ok(labelCenters[0] < labelCenters[1]);
  assert.ok(labelCenters[1] < labelCenters[2]);
  assert.ok(placed.every(({ connectorKneeX, connectorRailX }) => (
    Number.isFinite(connectorKneeX) && Number.isFinite(connectorRailX)
  )));
});

test('equal-height left-side anchors put later tasks above earlier tasks', () => {
  const placed = placeExternalLabels({
    centerX: 300,
    centerY: 210,
    exclusionRadius: 150,
    gap: 24,
    maxVerticalOffset: 138,
    rowGap: 26,
    collisionPadding: 6,
    layout: 'side-rails',
    labels: [
      { uid: 'earlier', angle: Math.PI, width: 180, height: 20, anchorY: 210, sortKey: 600 },
      { uid: 'later', angle: Math.PI, width: 180, height: 20, anchorY: 210, sortKey: 1320 },
    ],
  });

  assert.ok(placed[1].y < placed[0].y);
});

test('equal-height right-side anchors keep later tasks below earlier tasks', () => {
  const placed = placeExternalLabels({
    centerX: 300,
    centerY: 210,
    exclusionRadius: 150,
    gap: 24,
    maxVerticalOffset: 138,
    rowGap: 26,
    collisionPadding: 6,
    layout: 'side-rails',
    labels: [
      { uid: 'earlier', angle: 0, width: 180, height: 20, anchorY: 210, sortKey: 600 },
      { uid: 'later', angle: 0, width: 180, height: 20, anchorY: 210, sortKey: 960 },
    ],
  });

  assert.ok(placed[1].y > placed[0].y);
});

test('switches to the compact label list at the narrow-container boundary', () => {
  assert.equal(isCompactChartWidth(519), true);
  assert.equal(isCompactChartWidth(520), true);
  assert.equal(isCompactChartWidth(521), false);
  assert.equal(isCompactChartWidth(undefined), false);
});
