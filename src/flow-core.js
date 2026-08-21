/*
 * Public, dependency-free pieces of Nautilus Flow.
 *
 * Keeping the scheduling rules in a small module makes them testable without a
 * Roam graph or a browser.  The ClojureScript renderer uses the same rules in
 * its render seam; this module is also useful to the extension entry point for
 * validating settings before they become render arguments.
 */

const START_HOURS = Object.freeze([5, 6, 7, 8]);
const END_HOURS = Object.freeze([18, 19, 20, 21, 22, 23, 24]);

function asNumber(value) {
  if (value === '' || value === null || value === undefined) return NaN;
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
}

function normalizeHour(value, options, fallback) {
  const hour = asNumber(value);
  return options.includes(hour) ? hour : fallback;
}

function normalizeScheduleSettings({ startHour, endHour, workdayStart, workdayEnd } = {}) {
  // workday-start/workday-end are retained as aliases for existing settings
  // and old render templates.  New templates use the explicit hour names.
  const normalizedStart = normalizeHour(
    startHour === undefined ? workdayStart : startHour,
    START_HOURS,
    5,
  );
  const normalizedEnd = normalizeHour(
    endHour === undefined ? workdayEnd : endHour,
    END_HOURS,
    24,
  );

  // The available choices make this impossible in the settings panel, but a
  // hand-edited render block must still fail safe rather than render backwards.
  if (normalizedStart * 60 >= normalizedEnd * 60) {
    return { startHour: 5, endHour: 24, startMinutes: 300, endMinutes: 1440 };
  }

  return {
    startHour: normalizedStart,
    endHour: normalizedEnd,
    startMinutes: normalizedStart * 60,
    endMinutes: normalizedEnd * 60,
  };
}

function rendererArgumentValues(args) {
  let values = Array.isArray(args) ? args.slice() : [];
  while (values.length === 1 && Array.isArray(values[0])) values = values[0].slice();
  return values;
}

function runtimeOrFallback(runtime, key, fallback) {
  const value = runtime && runtime[key];
  return value === undefined || value === null ? fallback : value;
}

function boundedInteger(value, min, max, fallback) {
  const number = asNumber(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
}

/**
 * Resolve the renderer's public settings contract. Runtime extension settings
 * intentionally win over serialized render arguments so an open chart reacts
 * immediately to a settings-panel change without graph-wide block rewrites.
 * Direct and one-level nested argument arrays are both accepted because Roam
 * render hosts have used both shapes.
 */
function resolveRendererSettings({ runtime = {}, args = [] } = {}) {
  const [argLength, argDuration, argStart, argTrigger, argEnd] = rendererArgumentValues(args);
  const schedule = normalizeScheduleSettings({
    startHour: runtimeOrFallback(runtime, 'workday-start', argStart),
    endHour: runtimeOrFallback(runtime, 'workday-end', argEnd),
  });
  const trigger = runtimeOrFallback(runtime, 'color-1-trigger', argTrigger);

  return {
    'legend-len-limit': boundedInteger(
      runtimeOrFallback(runtime, 'desc-length', argLength),
      15,
      30,
      22,
    ),
    'default-duration': boundedInteger(
      runtimeOrFallback(runtime, 'todo-duration', argDuration),
      5,
      60,
      15,
    ),
    'workday-start': schedule.startMinutes,
    'workday-end': schedule.endMinutes,
    'workday-start-hour': schedule.startHour,
    'workday-end-hour': schedule.endHour,
    'custom-color-1-tag': trigger === undefined || trigger === null ? '' : String(trigger),
    language: runtime.language === 'en' ? 'en' : 'zh',
  };
}

function hourlyGridSegments({ startMinutes, endMinutes } = {}) {
  const start = asNumber(startMinutes);
  const end = asNumber(endMinutes);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];

  const segments = [];
  for (let minute = start; minute < end; minute += 60) {
    segments.push({
      start: minute,
      end: Math.min(end, minute + 60),
      label: minute % 60 === 0 ? String(Math.floor(minute / 60) % 24) : '',
    });
  }
  return segments;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizedInterval(event, startMinutes, endMinutes) {
  if (!event || event.done || event.meeting !== true) return null;
  const start = asNumber(event.start);
  const end = asNumber(event.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  const clippedStart = clamp(start, startMinutes, endMinutes);
  const clippedEnd = clamp(end, startMinutes, endMinutes);
  return clippedEnd > clippedStart ? [clippedStart, clippedEnd] : null;
}

function mergeIntervals(intervals) {
  const sorted = intervals
    .filter(Boolean)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return sorted.reduce((merged, interval) => {
    const previous = merged[merged.length - 1];
    if (previous && interval[0] <= previous[1]) {
      previous[1] = Math.max(previous[1], interval[1]);
    } else {
      merged.push(interval.slice());
    }
    return merged;
  }, []);
}

function effectiveNow({ startMinutes, endMinutes, nowMinutes }) {
  const now = asNumber(nowMinutes);
  return Number.isFinite(now) ? clamp(now, startMinutes, endMinutes) : startMinutes;
}

function remainingDuration(task) {
  if (!task || task.done) return 0;
  const rawDuration = asNumber(task.duration);
  if (!Number.isFinite(rawDuration) || rawDuration <= 0) return 0;
  // Renderers normally pass already-reduced duration.  Accepting progress here
  // makes the public seam safe for callers that pass a raw estimate instead.
  const progress = clamp(asNumber(task.progress) || 0, 0, 100);
  return Math.max(0, Math.round(rawDuration * (1 - progress / 100)));
}

function futureFixedIntervals({ startMinutes, endMinutes, nowMinutes, fixedEvents = [] }) {
  const cursor = effectiveNow({ startMinutes, endMinutes, nowMinutes });
  return mergeIntervals(
    fixedEvents
      .map((event) => normalizedInterval(event, Math.max(startMinutes, cursor), endMinutes))
      .filter(Boolean),
  );
}

function intervalMinutes(intervals) {
  return intervals.reduce((total, [start, end]) => total + Math.max(0, end - start), 0);
}

function scheduleTasks({
  startMinutes,
  endMinutes,
  nowMinutes,
  tasks = [],
  fixedEvents = [],
} = {}) {
  const start = asNumber(startMinutes);
  const end = asNumber(endMinutes);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return { scheduledTasks: [], overflowTasks: tasks.slice(), fixedMinutes: 0, intervals: [] };
  }

  const cursorStart = effectiveNow({ startMinutes: start, endMinutes: end, nowMinutes });
  const fixedIntervals = futureFixedIntervals({
    startMinutes: start,
    endMinutes: end,
    nowMinutes,
    fixedEvents,
  });
  const scheduledTasks = [];
  const overflowTasks = [];
  let cursor = cursorStart;

  for (const task of tasks) {
    const duration = remainingDuration(task);
    if (!duration) continue;

    let placed = false;
    while (cursor < end && !placed) {
      const fixed = fixedIntervals.find(([fixedStart, fixedEnd]) => fixedEnd > cursor);
      if (!fixed) {
        if (cursor + duration <= end) {
          scheduledTasks.push({ ...task, duration, start: cursor, end: cursor + duration });
          cursor += duration;
          placed = true;
        } else {
          cursor = end;
        }
        continue;
      }

      const [fixedStart, fixedEnd] = fixed;
      if (fixedStart > cursor && cursor + duration <= fixedStart) {
        scheduledTasks.push({ ...task, duration, start: cursor, end: cursor + duration });
        cursor += duration;
        placed = true;
      } else {
        cursor = Math.max(cursor, fixedEnd);
      }
    }

    if (!placed) overflowTasks.push({ ...task, duration });
  }

  const fixedSegments = fixedIntervals.map(([fixedStart, fixedEnd]) => ({
    meeting: true,
    fixed: true,
    start: fixedStart,
    end: fixedEnd,
    duration: fixedEnd - fixedStart,
  }));

  return {
    scheduledTasks,
    overflowTasks,
    fixedMinutes: intervalMinutes(fixedIntervals),
    intervals: fixedSegments.concat(scheduledTasks).sort((a, b) => a.start - b.start),
  };
}

/**
 * Return the historical slice for a completed item only when the graph has an
 * explicit completion timestamp.  The start is deliberately derived from the
 * original estimate, never from a previous task's completion time: a task
 * estimated at 60 minutes and completed at 21:50 occupies 20:50–21:50.
 *
 * `duration` is expected to be the original estimate (before progress is
 * applied).  Callers that parse a task can pass their configured default when
 * the task has no explicit estimate.
 */
function historicalDoneSlice({ done, doneAt, duration, defaultDuration } = {}) {
  if (done !== true || doneAt === null || doneAt === undefined) return null;

  const end = asNumber(doneAt);
  const explicitDuration = asNumber(duration);
  const fallbackDuration = asNumber(defaultDuration);
  const originalDuration = Number.isFinite(explicitDuration) && explicitDuration > 0
    ? explicitDuration
    : fallbackDuration;

  if (!Number.isFinite(end) || !Number.isFinite(originalDuration) || originalDuration <= 0) {
    return null;
  }

  return {
    start: end - originalDuration,
    end,
    duration: originalDuration,
  };
}

function calculateCapacity({
  startMinutes,
  endMinutes,
  nowMinutes,
  fixedEvents = [],
  pendingTasks = [],
} = {}) {
  const start = asNumber(startMinutes);
  const end = asNumber(endMinutes);
  const cursor = Number.isFinite(start) && Number.isFinite(end) && end > start
    ? effectiveNow({ startMinutes: start, endMinutes: end, nowMinutes })
    : 0;
  const fixedIntervals = Number.isFinite(start) && Number.isFinite(end) && end > start
    ? futureFixedIntervals({ startMinutes: start, endMinutes: end, nowMinutes, fixedEvents })
    : [];
  const rawAvailable = Math.max(0, (Number.isFinite(end) ? end : 0) - cursor);
  const availableMinutes = Math.max(0, rawAvailable - intervalMinutes(fixedIntervals));
  const demandMinutes = pendingTasks.reduce((total, task) => total + remainingDuration(task), 0);
  const overloadMinutes = Math.max(0, demandMinutes - availableMinutes);
  const slackMinutes = Math.max(0, availableMinutes - demandMinutes);
  const plan = scheduleTasks({ startMinutes: start, endMinutes: end, nowMinutes, tasks: pendingTasks, fixedEvents });
  const unplacedMinutes = plan.overflowTasks.reduce(
    (total, task) => total + remainingDuration(task),
    0,
  );

  return {
    availableMinutes,
    demandMinutes,
    overloadMinutes,
    slackMinutes,
    unplacedMinutes,
    fixedMinutes: intervalMinutes(fixedIntervals),
    overflowTasks: plan.overflowTasks,
  };
}

function formatDuration(minutes) {
  const value = Math.max(0, Math.round(asNumber(minutes) || 0));
  const hours = Math.floor(value / 60);
  const remainder = value % 60;
  if (!hours) return `${remainder}m`;
  return `${hours}h${String(remainder).padStart(2, '0')}m`;
}

const UI_COPY = {
  en: {
    capacity: {
      available: 'Available',
      demand: 'Demand',
      overload: 'Overload',
      fragmented: 'No fitting slot',
      remaining: 'Remaining',
    },
    legend: { urgent: 'Urgent', event: 'Event', task: 'Task' },
    controls: {
      hideDone: 'Hide completed items',
      showDone: 'Show completed items',
      playback: 'Play back the day',
      collapse: 'Collapse Nautilus Flow',
      expand: 'Expand Nautilus Flow',
    },
    panels: {
      overflow: 'Unscheduled today',
      warnings: 'Schedule warnings',
      item: 'item',
      items: 'items',
    },
    warnings: {
      overnight: 'Overnight events display only through 24:00',
      sameTime: 'Start and end times cannot be the same',
    },
  },
  zh: {
    capacity: {
      available: '可安排',
      demand: '待办需求',
      overload: '超载',
      fragmented: '空档不足',
      remaining: '余量',
    },
    legend: { urgent: '紧急', event: '事件', task: '任务' },
    controls: {
      hideDone: '隐藏已完成事项',
      showDone: '显示已完成事项',
      playback: '回放一整天',
      collapse: '折叠 Nautilus Flow',
      expand: '展开 Nautilus Flow',
    },
    panels: {
      overflow: '今日放不下',
      warnings: '时间范围提醒',
      item: '项',
      items: '项',
    },
    warnings: {
      overnight: '跨日事件仅显示至 24:00',
      sameTime: '开始时间与结束时间不能相同',
    },
  },
};

function uiCopy(language = 'zh') {
  return language === 'en' ? UI_COPY.en : UI_COPY.zh;
}

function capacityMetrics({ capacity = {}, language = 'zh' } = {}) {
  const copy = uiCopy(language).capacity;
  const available = {
    key: 'available', label: copy.available, value: formatDuration(capacity.availableMinutes), tone: 'neutral',
  };
  const demand = {
    key: 'demand', label: copy.demand, value: formatDuration(capacity.demandMinutes), tone: 'neutral',
  };
  let status;
  if (capacity.overloadMinutes > 0) {
    status = { key: 'overload', label: copy.overload, value: formatDuration(capacity.overloadMinutes), tone: 'warning' };
  } else if (capacity.unplacedMinutes > 0) {
    status = { key: 'fragmented', label: copy.fragmented, value: formatDuration(capacity.unplacedMinutes), tone: 'warning' };
  } else {
    status = { key: 'remaining', label: copy.remaining, value: formatDuration(capacity.slackMinutes), tone: 'neutral' };
  }
  return [available, demand, status];
}

function formatCapacitySummary(capacity) {
  const available = formatDuration(capacity.availableMinutes);
  const demand = formatDuration(capacity.demandMinutes);
  if (capacity.overloadMinutes > 0) {
    return `可安排 ${available} · 待办需求 ${demand} · 超载 ${formatDuration(capacity.overloadMinutes)}`;
  }
  if (capacity.unplacedMinutes > 0) {
    return `可安排 ${available} · 待办需求 ${demand} · 空档不足 ${formatDuration(capacity.unplacedMinutes)}`;
  }
  return `可安排 ${available} · 待办需求 ${demand} · 余量 ${formatDuration(capacity.slackMinutes)}`;
}

function characterWidth(character) {
  // East Asian wide characters are approximately two Latin glyphs in the
  // renderer's default font.  This is a fallback; callers can pass a real
  // measurement function to truncateTextToWidth when one is available.
  return character === '…' || character === '·' || character.charCodeAt(0) <= 255 ? 1 : 2;
}

let textCanvasContext;

function fallbackTextWidth(candidate) {
  return Array.from(candidate).reduce((sum, char) => sum + characterWidth(char), 0);
}

function browserTextWidth(candidate, font) {
  if (typeof document === 'undefined' || !document.createElement) return fallbackTextWidth(candidate);
  if (!textCanvasContext) textCanvasContext = document.createElement('canvas').getContext('2d');
  if (!textCanvasContext) return fallbackTextWidth(candidate);
  if (font) textCanvasContext.font = font;
  return textCanvasContext.measureText(candidate).width;
}

function truncateTextToWidth(textOrOptions, maxWidth, measure = null) {
  // The ClojureScript bridge passes an object, while the small public JS seam
  // historically accepted positional arguments.  Keep both contracts so the
  // renderer and direct callers exercise the same implementation.
  const options = textOrOptions && typeof textOrOptions === 'object'
    ? textOrOptions
    : null;
  const value = String(options ? (options.text ?? '') : (textOrOptions ?? ''));
  const limit = Math.max(1, asNumber(options ? options.maxWidth : maxWidth) || 1);
  const requestedMeasure = (options && options.measure) || measure;
  const width = typeof requestedMeasure === 'function'
    ? requestedMeasure
    : (candidate) => browserTextWidth(candidate, options?.font);
  if (width(value) <= limit) return value;
  const ellipsis = '…';
  let result = '';
  for (const char of Array.from(value)) {
    if (width(result + char + ellipsis) > limit) break;
    result += char;
  }
  return result ? result + ellipsis : ellipsis;
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

function placeLabelTracks(labelsOrOptions, maxTracks = 3) {
  const options = Array.isArray(labelsOrOptions) ? null : labelsOrOptions || {};
  const labels = Array.isArray(labelsOrOptions) ? labelsOrOptions : options.labels || [];
  const requestedTracks = options && options.maxTracks !== undefined ? options.maxTracks : maxTracks;
  const trackCount = Math.max(1, Math.floor(requestedTracks));
  const tracks = Array.from({ length: trackCount }, () => []);
  return labels.map((label) => {
    let selected = -1;
    for (let track = 0; track < trackCount; track += 1) {
      const collides = tracks[track].some((placed) => rangesOverlap(label.start, label.end, placed.start, placed.end));
      if (!collides) {
        selected = track;
        break;
      }
    }
    if (selected < 0) selected = trackCount - 1;
    tracks[selected].push(label);
    return { ...label, track: selected };
  });
}

function externalLabelRect(label, options, track = 0) {
  const width = Math.max(1, asNumber(label.width) || 1);
  const height = Math.max(1, asNumber(label.height) || 1);
  const angle = asNumber(label.angle) || 0;
  const centerX = asNumber(options.centerX) || 0;
  const centerY = asNumber(options.centerY) || 0;
  const exclusionRadius = Math.max(0, asNumber(options.exclusionRadius) || 0);
  const gap = Math.max(0, asNumber(options.gap) || 0);
  const trackGap = Math.max(1, asNumber(options.trackGap) || 18);
  const directionX = Math.cos(angle);
  const directionY = -Math.sin(angle);
  const projectedHalfSize = Math.abs(directionX) * width / 2
    + Math.abs(directionY) * height / 2;
  const distance = exclusionRadius + gap + projectedHalfSize + track * trackGap + 0.001;
  const labelCenterX = centerX + directionX * distance;
  const labelCenterY = centerY + directionY * distance;

  return {
    ...label,
    x: labelCenterX - width / 2,
    y: labelCenterY - height / 2,
    width,
    height,
    w: width,
    h: height,
    track,
  };
}

function labelRectsOverlap(first, second, padding = 0) {
  const firstWidth = asNumber(first.width ?? first.w) || 0;
  const firstHeight = asNumber(first.height ?? first.h) || 0;
  const secondWidth = asNumber(second.width ?? second.w) || 0;
  const secondHeight = asNumber(second.height ?? second.h) || 0;
  return !(
    first.x + firstWidth + padding <= second.x
    || second.x + secondWidth + padding <= first.x
    || first.y + firstHeight + padding <= second.y
    || second.y + secondHeight + padding <= first.y
  );
}

function placeExternalLabels(options = {}) {
  const labels = Array.isArray(options.labels) ? options.labels : [];
  const collisionPadding = Math.max(0, asNumber(options.collisionPadding) || 0);
  const occupied = Array.isArray(options.occupiedRects) ? options.occupiedRects.slice() : [];
  return labels.map((label) => {
    let track = Math.max(0, Math.floor(asNumber(label.track) || 0));
    let candidate = externalLabelRect(label, options, track);
    const searchLimit = occupied.length + labels.length + 4;
    while (track < searchLimit && occupied.some((rect) => labelRectsOverlap(candidate, rect, collisionPadding))) {
      track += 1;
      candidate = externalLabelRect(label, options, track);
    }
    occupied.push(candidate);
    return candidate;
  });
}

function isCompactChartWidth(width, threshold = 520) {
  const normalizedWidth = asNumber(width);
  const normalizedThreshold = asNumber(threshold);
  if (!Number.isFinite(normalizedWidth) || !Number.isFinite(normalizedThreshold)) return false;
  return normalizedWidth <= normalizedThreshold;
}

module.exports = {
  START_HOURS,
  END_HOURS,
  normalizeScheduleSettings,
  resolveRendererSettings,
  hourlyGridSegments,
  scheduleTasks,
  historicalDoneSlice,
  calculateCapacity,
  formatDuration,
  uiCopy,
  capacityMetrics,
  formatCapacitySummary,
  truncateTextToWidth,
  placeLabelTracks,
  placeExternalLabels,
  isCompactChartWidth,
};
