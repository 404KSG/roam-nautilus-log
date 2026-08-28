const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeScheduleSettings,
  resolveRendererSettings,
  hourlyGridSegments,
  pastTimelineSegments,
  pastUnplannedSegments,
  availableSlotGroups,
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
  radialTooltipGeometry,
  placeFloatingTooltip,
  stableTidyOrder,
  childOrderMoves,
  isCompactChartWidth,
  parseDurationToken,
  parseTimeRangeToken,
  alignIntervalToWindow,
  timelineDayState,
} = require('../src/log-core');

test('Tidy performs a stable settled-first partition without reprioritizing active work', () => {
  const items = [
    { uid: 'active-a', kind: 'task' },
    { uid: 'done-a', kind: 'task' },
    { uid: 'divider', kind: 'structure' },
    { uid: 'past-event', kind: 'event' },
    { uid: 'active-b', kind: 'task' },
    { uid: 'future-event', kind: 'event' },
  ];
  const result = stableTidyOrder({ items, settledUids: ['done-a', 'past-event'] });

  assert.deepEqual(result.map((item) => item.uid), [
    'done-a',
    'past-event',
    'active-a',
    'divider',
    'active-b',
    'future-event',
  ]);
  assert.deepEqual(
    result.filter((item) => !['done-a', 'past-event'].includes(item.uid)).map((item) => item.uid),
    ['active-a', 'divider', 'active-b', 'future-event'],
  );
  assert.deepEqual(
    stableTidyOrder({ items: result, settledUids: ['done-a', 'past-event'] }),
    result,
    'running Tidy twice should be idempotent',
  );
});

test('Tidy move planning rewrites only out-of-place siblings and reaches the target order', () => {
  const current = ['done-a', 'active-a', 'done-b', 'active-b'];
  const target = ['done-a', 'done-b', 'active-a', 'active-b'];
  const moves = childOrderMoves({ currentUids: current, targetUids: target });
  assert.deepEqual(moves, [{ uid: 'done-b', order: 1 }]);

  const simulated = current.slice();
  for (const move of moves) {
    const from = simulated.indexOf(move.uid);
    simulated.splice(move.order, 0, simulated.splice(from, 1)[0]);
  }
  assert.deepEqual(simulated, target);
});

test('Tidy keeps the flexible schedule fingerprint unchanged', () => {
  const items = [
    { uid: 'task-a', todo: true, duration: 30 },
    { uid: 'done-task', todo: true, duration: 20, done: true },
    { uid: 'past-event', meeting: true, start: 360, end: 420 },
    { uid: 'task-b', todo: true, duration: 45 },
    { uid: 'future-event', meeting: true, start: 720, end: 750 },
  ];
  const tidied = stableTidyOrder({ items, settledUids: ['done-task', 'past-event'] });
  const schedule = (rows) => scheduleTasks({
    startMinutes: 300,
    endMinutes: 1260,
    nowMinutes: 600,
    tasks: rows.filter((item) => item.todo && !item.done),
    fixedEvents: rows.filter((item) => item.meeting),
  }).scheduledTasks.map(({ uid, start, end }) => ({ uid, start, end }));

  assert.deepEqual(schedule(tidied), schedule(items));
});

test('shared syntax accepts every documented task duration form', () => {
  const cases = [
    ['Write 30m', 30, 'Write'],
    ['Write 30min', 30, 'Write'],
    ['Write 1h', 60, 'Write'],
    ['Write 1h30m', 90, 'Write'],
  ];

  for (const [text, minutes, cleanedText] of cases) {
    assert.deepEqual(parseDurationToken({ text, fallback: 15 }), {
      minutes,
      token: text.slice(6),
      cleanedText,
    });
  }
  assert.deepEqual(parseDurationToken({ text: 'Write', fallback: 15 }), {
    minutes: 15,
    token: '',
    cleanedText: 'Write',
  });
});

test('shared time-range syntax keeps overnight events continuous', () => {
  assert.deepEqual(parseTimeRangeToken({ text: '23:00-01:00 Late' }), {
    start: 1380,
    end: 1500,
    token: '23:00-01:00',
    cleanedText: 'Late',
    warningCode: '',
  });
  assert.deepEqual(parseTimeRangeToken({ text: '09:00-09:00 Invalid' }), {
    start: 540,
    end: 540,
    token: '09:00-09:00',
    cleanedText: 'Invalid',
    warningCode: 'sameTime',
  });
});

test('early clock events align to the next-day portion of an overnight window', () => {
  assert.deepEqual(
    alignIntervalToWindow({ start: 30, end: 90, windowStart: 1260, windowEnd: 1560 }),
    { start: 1470, end: 1530 },
  );
  assert.deepEqual(
    parseTimeRangeToken({
      text: '00:30-01:30 Deep work',
      windowStartMinutes: 1260,
      windowEndMinutes: 1560,
    }),
    {
      start: 1470,
      end: 1530,
      token: '00:30-01:30',
      cleanedText: 'Deep work',
      warningCode: '',
    },
  );
});

test('a past Daily Note is fully elapsed and exposes no available planning slots', () => {
  assert.deepEqual(
    timelineDayState({
      displayDate: 'August 22nd, 2026',
      currentDate: new Date(2026, 7, 23, 8, 21).getTime(),
      startMinutes: 300,
      endMinutes: 1260,
      nowMinutes: 501,
    }),
    {
      relation: 'past',
      timelineMinutes: 1941,
      scheduleFromMinutes: 300,
      capacityFromMinutes: 1260,
      elapsedThroughMinutes: 1260,
      interactive: false,
      showElapsed: true,
      showAvailableSlots: false,
      showNow: false,
    },
  );
});

test('today keeps planning, capacity, elapsed shading, and interaction on the same minute', () => {
  assert.deepEqual(
    timelineDayState({
      displayDate: 'August 23rd, 2026',
      currentDate: new Date(2026, 7, 23, 8, 21).getTime(),
      startMinutes: 300,
      endMinutes: 1260,
      nowMinutes: 501,
    }),
    {
      relation: 'today',
      timelineMinutes: 501,
      scheduleFromMinutes: 501,
      capacityFromMinutes: 501,
      elapsedThroughMinutes: 501,
      interactive: true,
      showElapsed: true,
      showAvailableSlots: true,
      showNow: true,
    },
  );
});

test('the owning Daily Note stays active during its next-day carryover window', () => {
  assert.deepEqual(
    timelineDayState({
      displayDate: 'August 23rd, 2026',
      currentDate: new Date(2026, 7, 24, 1, 15).getTime(),
      startMinutes: 1260,
      endMinutes: 1560,
      nowMinutes: 75,
    }),
    {
      relation: 'today',
      timelineMinutes: 1515,
      scheduleFromMinutes: 1515,
      capacityFromMinutes: 1515,
      elapsedThroughMinutes: 1515,
      interactive: true,
      showElapsed: true,
      showAvailableSlots: true,
      showNow: true,
    },
  );

  assert.equal(
    timelineDayState({
      displayDate: 'August 23rd, 2026',
      currentDate: new Date(2026, 7, 24, 2, 0).getTime(),
      startMinutes: 1260,
      endMinutes: 1560,
      nowMinutes: 120,
    }).relation,
    'past',
  );
});

test('the chart background uses one grid sector per hour', () => {
  assert.deepEqual(hourlyGridSegments({ startMinutes: 300, endMinutes: 420 }), [
    { start: 300, end: 360, label: '5' },
    { start: 360, end: 420, label: '6' },
  ]);
});

test('the chart background wraps clock labels after midnight', () => {
  assert.deepEqual(hourlyGridSegments({ startMinutes: 1380, endMinutes: 1560 }), [
    { start: 1380, end: 1440, label: '23' },
    { start: 1440, end: 1500, label: '0' },
    { start: 1500, end: 1560, label: '1' },
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

test('available slots start at now and stay grouped across spiral hour cells', () => {
  assert.deepEqual(
    availableSlotGroups({
      events: [
        { freetime: true, start: 540, end: 615 },
        { freetime: true, start: 660, end: 720 },
        { todo: true, start: 615, end: 660 },
      ],
      startMinutes: 300,
      endMinutes: 1260,
      nowMinutes: 572,
      clampToNow: true,
    }),
    [
      {
        key: 'slot:572:615',
        start: 572,
        end: 615,
        duration: 43,
        availableNow: true,
        segments: [{ start: 572, end: 600 }, { start: 600, end: 615 }],
      },
      {
        key: 'slot:660:720',
        start: 660,
        end: 720,
        duration: 60,
        availableNow: false,
        segments: [{ start: 660, end: 720 }],
      },
    ],
  );
});

test('available slots retain full preview ranges and discard invalid intervals', () => {
  assert.deepEqual(
    availableSlotGroups({
      events: [
        { freetime: true, start: 280, end: 330 },
        { freetime: true, start: 390, end: 390 },
        { freetime: true, start: 480, end: 450 },
        { meeting: true, start: 330, end: 390 },
      ],
      startMinutes: 300,
      endMinutes: 600,
      nowMinutes: 500,
      clampToNow: false,
    }),
    [{
      key: 'slot:300:330',
      start: 300,
      end: 330,
      duration: 30,
      availableNow: false,
      segments: [{ start: 300, end: 330 }],
    }],
  );
  assert.deepEqual(
    availableSlotGroups({
      events: [{ freetime: true, start: 300, end: 420 }],
      startMinutes: 300,
      endMinutes: 420,
      nowMinutes: 500,
      clampToNow: true,
    }),
    [],
  );
});

test('floating tooltips keep the preferred outside placement when it fits', () => {
  assert.deepEqual(
    placeFloatingTooltip({
      anchorX: 500,
      anchorY: 300,
      tooltipWidth: 180,
      tooltipHeight: 50,
      viewportWidth: 1000,
      viewportHeight: 700,
      preferred: 'right',
    }),
    { x: 510, y: 275, placement: 'right' },
  );
});

test('radial tooltip geometry preserves the real SVG center for evening items', () => {
  const geometry = radialTooltipGeometry({
    startMinutes: 1200,
    endMinutes: 1260,
    centerX: 300,
    centerY: 200,
    radius: 158,
  });

  assert.deepEqual(geometry.center, { x: 300, y: 200 });
  assert.ok(geometry.direction.x < geometry.center.x, '20:00–21:00 should anchor left of center');
  assert.ok(geometry.direction.y > geometry.center.y, '20:00–21:00 should anchor below center');
});

test('floating tooltips flip before they reach a viewport edge', () => {
  assert.deepEqual(
    placeFloatingTooltip({
      anchorX: 900,
      anchorY: 300,
      tooltipWidth: 180,
      tooltipHeight: 50,
      viewportWidth: 1000,
      viewportHeight: 700,
      preferred: 'right',
    }),
    { x: 710, y: 275, placement: 'left' },
  );
  assert.deepEqual(
    placeFloatingTooltip({
      anchorX: 500,
      anchorY: 20,
      tooltipWidth: 180,
      tooltipHeight: 50,
      viewportWidth: 1000,
      viewportHeight: 700,
      preferred: 'top',
    }),
    { x: 410, y: 30, placement: 'bottom' },
  );
});

test('floating tooltips shift inside the final viewport safety margin', () => {
  assert.deepEqual(
    placeFloatingTooltip({
      anchorX: 100,
      anchorY: 350,
      tooltipWidth: 180,
      tooltipHeight: 50,
      viewportWidth: 200,
      viewportHeight: 400,
      preferred: 'top',
    }),
    { x: 12, y: 290, placement: 'top' },
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
  assert.equal(
    spiralCellInnerHour({ startMinute: 1500, endMinutes: 2700, windowStartMinutes: 1260 }),
    21,
  );
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
    tidy: 'Tidy completed and elapsed items',
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
  assert.deepEqual(copy.tooltips, {
    task: 'Task',
    event: 'Event',
    available: 'Available slot',
    availableNow: 'Available now',
  });
  assert.deepEqual(uiCopy('zh').tooltips, {
    task: '任务',
    event: '事件',
    available: '可用空档',
    availableNow: '当前可用',
  });
  assert.deepEqual(
    capacityMetrics({
      language: 'en',
      capacity: { availableMinutes: 0, fixedMinutes: 90, demandMinutes: 30, overloadMinutes: 30, slackMinutes: 0, unplacedMinutes: 30 },
    }),
    {
      planned: { key: 'demand', label: 'Planned', value: '30m', summaryLabel: 'planned', percent: '0%', percentLabel: 'left', percentTone: 'warning', tone: 'neutral' },
      status: { key: 'overload', label: 'Overload', value: '30m', summaryLabel: 'over', tone: 'warning' },
      available: { key: 'available', label: 'Available', value: '0m', tone: 'neutral' },
      events: { key: 'events', label: 'Events', value: '1h30m', tone: 'event' },
    },
  );
  assert.equal(uiCopy('zh').capacity.demand, '已计划');
  assert.deepEqual(copy.allocation, {
    planned: 'planned',
    free: 'free',
    over: 'over',
    noSlot: 'no slot',
    left: 'left',
  });
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

  assert.equal(metrics.planned.burning, undefined);
  assert.equal(metrics.status.burning, undefined);
  assert.equal(metrics.available.burning, undefined);
  assert.equal(metrics.events.burning, true);
  assert.equal(metrics.events.burningLabel, 'Event time is elapsing');
});

test('capacity summary reports current free time as a share of full-day flexible capacity', () => {
  assert.deepEqual(
    capacityMetrics({
      language: 'en',
      capacity: { availableMinutes: 540, totalAvailableMinutes: 540, fixedMinutes: 420, demandMinutes: 105, overloadMinutes: 0, slackMinutes: 435, unplacedMinutes: 0 },
    }).planned,
    { key: 'demand', label: 'Planned', value: '1h45m', summaryLabel: 'planned', percent: '81%', percentLabel: 'left', percentTone: 'positive', tone: 'neutral' },
  );

  const lateDayDemand = capacityMetrics({
    language: 'en',
    capacity: { availableMinutes: 60, totalAvailableMinutes: 540, demandMinutes: 45, slackMinutes: 15 },
  }).planned;
  assert.equal(lateDayDemand.percent, '3%');

  const overloadedDemand = capacityMetrics({
      language: 'en',
      capacity: { availableMinutes: 90, demandMinutes: 105, overloadMinutes: 15 },
    }).planned;
  assert.equal(overloadedDemand.percent, '0%');
  assert.equal(overloadedDemand.percentLabel, 'left');
  assert.equal(overloadedDemand.percentTone, 'warning');

  const exactDemand = capacityMetrics({
    language: 'en',
    capacity: { availableMinutes: 90, totalAvailableMinutes: 540, demandMinutes: 90 },
  }).planned;
  assert.equal(exactDemand.percent, '0%');
  assert.equal(exactDemand.percentTone, 'neutral');

  const tinyPositiveDemand = capacityMetrics({
    language: 'en',
    capacity: { availableMinutes: 2, totalAvailableMinutes: 540, demandMinutes: 0 },
  }).planned;
  assert.equal(tinyPositiveDemand.percent, '1%');
  assert.equal(tinyPositiveDemand.percentTone, 'positive');

  const fragmentedDemand = capacityMetrics({
    language: 'en',
    capacity: { availableMinutes: 60, totalAvailableMinutes: 540, demandMinutes: 45, unplacedMinutes: 30 },
  }).planned;
  assert.equal(fragmentedDemand.percent, '3%');
  assert.equal(fragmentedDemand.percentTone, 'warning');

  const emptyDemand = capacityMetrics({
    language: 'en',
    capacity: { availableMinutes: 90, demandMinutes: 0, slackMinutes: 90 },
  }).planned;
  assert.equal(emptyDemand.percent, '100%');
  assert.equal(emptyDemand.percentTone, 'positive');
});

test('free capacity reuses the Left semantic state without coloring its label', () => {
  const positive = capacityMetrics({
    language: 'en',
    capacity: { availableMinutes: 120, totalAvailableMinutes: 540, demandMinutes: 30 },
  });
  assert.equal(positive.status.value, '1h30m');
  assert.equal(positive.status.summaryLabel, 'free');
  assert.equal(positive.status.tone, 'positive');

  const exact = capacityMetrics({
    language: 'en',
    capacity: { availableMinutes: 120, totalAvailableMinutes: 540, demandMinutes: 120 },
  });
  assert.equal(exact.status.value, '0m');
  assert.equal(exact.status.tone, 'neutral');

  const fragmented = capacityMetrics({
    language: 'en',
    capacity: { availableMinutes: 120, totalAvailableMinutes: 540, demandMinutes: 90, unplacedMinutes: 30 },
  });
  assert.equal(fragmented.status.tone, 'warning');
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
    normalizeScheduleSettings({ startHour: 9, endHour: 18 }),
    { startHour: 9, endHour: 18, startMinutes: 540, endMinutes: 1080 },
  );
  assert.deepEqual(
    normalizeScheduleSettings({ startHour: '21', endHour: '2' }),
    { startHour: 21, endHour: 2, startMinutes: 1260, endMinutes: 1560 },
  );
  assert.deepEqual(
    normalizeScheduleSettings({ startHour: 0, endHour: 24 }),
    { startHour: 0, endHour: 24, startMinutes: 0, endMinutes: 1440 },
  );
  assert.deepEqual(
    normalizeScheduleSettings({ startHour: 23, endHour: 23 }),
    { startHour: 23, endHour: 23, startMinutes: 1380, endMinutes: 2820 },
  );
  assert.deepEqual(
    normalizeScheduleSettings({ startHour: -1, endHour: 25 }),
    { startHour: 5, endHour: 21, startMinutes: 300, endMinutes: 1260 },
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

  assert.equal(metrics.available.value, '7h31m');
  assert.equal(metrics.available.total, '9h');
  assert.equal(metrics.events.value, '3h15m');
  assert.equal(metrics.events.total, '7h');
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
  assert.deepEqual(
    result.scheduledTasks.map(({ uid, start, end }) => ({ uid, start, end })),
    [{ uid: 'a', start: 300, end: 345 }],
  );
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
