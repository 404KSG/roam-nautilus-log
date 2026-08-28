/*
 * Public, dependency-free pieces of Nautilus Log.
 *
 * Keeping the scheduling rules in a small module makes them testable without a
 * Roam graph or a browser.  The ClojureScript renderer uses the same rules in
 * its render seam; this module is also useful to the extension entry point for
 * validating settings before they become render arguments.
 */

const START_HOURS = Object.freeze(Array.from({ length: 24 }, (_value, hour) => hour));
const END_HOURS = Object.freeze(Array.from({ length: 24 }, (_value, index) => index + 1));
const DURATION_TOKEN_RE = /(?:^|\s)(\d+h(?:\d+(?:min|m))?|\d+(?:min|m))(?=\s|$)/i;
const TIME_RANGE_TOKEN_RE = /(?:^|\s)(\d{1,2}(?::\d{1,2})?(?:\s*(?:am|pm))?\s*(?:-|–|až|to)\s*\d{1,2}(?::\d{1,2})?(?:\s*(?:am|pm))?)(?=\s|$)/i;

function asNumber(value) {
  if (value === '' || value === null || value === undefined) return NaN;
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
}

function asTimestamp(value) {
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isFinite(timestamp) ? timestamp : NaN;
  }
  const numeric = asNumber(value);
  if (Number.isFinite(numeric)) return numeric;
  if (typeof value !== 'string') return NaN;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function cleanParsedText(text, token) {
  if (!token) return String(text ?? '');
  return String(text ?? '').replace(token, '').replace(/\s+/g, ' ').trim();
}

function parseDurationToken({ text = '', fallback = 15 } = {}) {
  const source = String(text ?? '');
  const match = DURATION_TOKEN_RE.exec(source);
  if (!match) {
    return {
      minutes: Math.max(0, Math.round(asNumber(fallback) || 0)),
      token: '',
      cleanedText: source,
    };
  }
  const token = match[1];
  const hours = Number(/(\d+)h/i.exec(token)?.[1] || 0);
  const minutes = Number(/(\d+)(?:min|m)/i.exec(token)?.[1] || 0);
  return {
    minutes: hours * 60 + minutes,
    token,
    cleanedText: cleanParsedText(source, token),
  };
}

function clockTokenMinutes(value, inheritedPeriod = null) {
  const match = /^\s*(\d{1,2})(?::(\d{1,2}))?\s*(am|pm)?\s*$/i.exec(String(value ?? ''));
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const explicitPeriod = match[3]?.toLowerCase() || null;
  const period = explicitPeriod || inheritedPeriod;
  if (minute > 59) return null;
  if (period) {
    if (hour < 1 || hour > 12) return null;
    hour = hour % 12 + (period === 'pm' ? 12 : 0);
  } else if (hour > 23) return null;
  return { minutes: hour * 60 + minute, explicitPeriod };
}

function intervalOverlap(start, end, windowStart, windowEnd) {
  return Math.max(0, Math.min(end, windowEnd) - Math.max(start, windowStart));
}

/**
 * Place a wall-clock interval on the continuous timeline owned by a plan.
 * Early clock times belong to the next-day portion only when that placement
 * actually overlaps an overnight chart window.
 */
function alignIntervalToWindow({ start, end, windowStart, windowEnd } = {}) {
  const intervalStart = asNumber(start);
  const intervalEnd = asNumber(end);
  const rangeStart = asNumber(windowStart);
  const rangeEnd = asNumber(windowEnd);
  if (!Number.isFinite(intervalStart) || !Number.isFinite(intervalEnd)
      || intervalEnd <= intervalStart || !Number.isFinite(rangeStart)
      || !Number.isFinite(rangeEnd) || rangeEnd <= rangeStart) {
    return { start: intervalStart, end: intervalEnd };
  }

  const candidates = [0, 1440].map((shift) => ({
    start: intervalStart + shift,
    end: intervalEnd + shift,
  }));
  const ranked = candidates
    .map((candidate) => ({
      ...candidate,
      overlap: intervalOverlap(candidate.start, candidate.end, rangeStart, rangeEnd),
      distance: Math.abs(candidate.start - rangeStart),
    }))
    .sort((left, right) => right.overlap - left.overlap || left.distance - right.distance);
  const best = ranked[0];
  return best.overlap > 0
    ? { start: best.start, end: best.end }
    : { start: intervalStart, end: intervalEnd };
}

function parseTimeRangeToken({
  text = '',
  windowStartMinutes,
  windowEndMinutes,
} = {}) {
  const source = String(text ?? '');
  const token = TIME_RANGE_TOKEN_RE.exec(source)?.[1];
  if (!token) return null;
  const parts = token.split(/\s*(?:-|–|až|to)\s*/i);
  if (parts.length !== 2) return null;
  const end = clockTokenMinutes(parts[1]);
  const start = clockTokenMinutes(parts[0], end?.explicitPeriod || null);
  if (!start || !end) return null;
  const sameTime = end.minutes === start.minutes;
  const continuousEnd = sameTime
    ? start.minutes
    : end.minutes > start.minutes ? end.minutes : end.minutes + 1440;
  const aligned = sameTime
    ? { start: start.minutes, end: continuousEnd }
    : alignIntervalToWindow({
      start: start.minutes,
      end: continuousEnd,
      windowStart: windowStartMinutes,
      windowEnd: windowEndMinutes,
    });
  return {
    start: aligned.start,
    end: aligned.end,
    token,
    cleanedText: cleanParsedText(source, token),
    warningCode: sameTime ? 'sameTime' : '',
  };
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
    21,
  );

  const startMinutes = normalizedStart * 60;
  const endMinutes = (normalizedEnd <= normalizedStart ? normalizedEnd + 24 : normalizedEnd) * 60;

  return {
    startHour: normalizedStart,
    endHour: normalizedEnd,
    startMinutes,
    endMinutes,
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
    language: runtime.language === 'zh' ? 'zh' : 'en',
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

/**
 * Split elapsed workday time into the same spiral sectors as the hourly grid.
 * The last segment ends at the exact current minute instead of waiting for the
 * next whole hour, which gives the renderer a continuous past/now boundary.
 */
function pastTimelineSegments({ startMinutes, endMinutes, nowMinutes } = {}) {
  const start = asNumber(startMinutes);
  const end = asNumber(endMinutes);
  const now = asNumber(nowMinutes);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start
      || !Number.isFinite(now) || now <= start) {
    return [];
  }

  const elapsedEnd = Math.min(end, now);
  return hourlyGridSegments({ startMinutes: start, endMinutes: end })
    .filter((segment) => segment.start < elapsedEnd)
    .map((segment) => ({
      start: segment.start,
      end: Math.min(segment.end, elapsedEnd),
    }));
}

function localDayOrdinal(value) {
  if (typeof value === 'string') {
    const match = /^([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th),\s*(\d{4})$/.exec(value.trim());
    if (match) {
      const months = [
        'january', 'february', 'march', 'april', 'may', 'june',
        'july', 'august', 'september', 'october', 'november', 'december',
      ];
      const month = months.indexOf(match[1].toLowerCase());
      const day = Number(match[2]);
      const year = Number(match[3]);
      if (month >= 0 && day >= 1 && day <= 31) {
        const timestamp = Date.UTC(year, month, day);
        const date = new Date(timestamp);
        if (date.getUTCFullYear() === year && date.getUTCMonth() === month && date.getUTCDate() === day) {
          return timestamp / 86400000;
        }
      }
    }
  }
  const timestamp = asTimestamp(value);
  if (!Number.isFinite(timestamp)) return null;
  const date = new Date(timestamp);
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000;
}

/**
 * Describe how a rendered Daily Note relates to the real day.
 *
 * A historical page still reconstructs its plan from the configured start,
 * but its capacity cursor and elapsed shading end at the workday boundary.
 * That prevents yesterday's gaps from becoming actionable "Available" slots.
 */
function timelineDayState({
  displayDate,
  currentDate = Date.now(),
  startMinutes,
  endMinutes,
  nowMinutes,
  playback = false,
} = {}) {
  const start = asNumber(startMinutes);
  const end = asNumber(endMinutes);
  const validRange = Number.isFinite(start) && Number.isFinite(end) && end > start;
  const safeStart = validRange ? start : 0;
  const safeEnd = validRange ? end : safeStart;
  const displayDay = localDayOrdinal(displayDate);
  const currentDay = localDayOrdinal(currentDate);
  const rawNow = asNumber(nowMinutes);
  const dayDelta = displayDay === null || currentDay === null ? 0 : currentDay - displayDay;
  const simulated = playback === true;
  const timelineMinutes = Number.isFinite(rawNow)
    ? (simulated ? rawNow : rawNow + dayDelta * 1440)
    : safeStart;
  const sameCalendarDay = displayDay !== null && currentDay !== null && dayDelta === 0;
  const nextDayCarryover = displayDay !== null && currentDay !== null
    && dayDelta === 1 && safeEnd > 1440 && timelineMinutes < safeEnd;
  const relation = displayDay === null || currentDay === null
    ? 'other'
    : sameCalendarDay || nextDayCarryover
      ? 'today'
      : displayDay < currentDay ? 'past' : 'future';
  const cursor = validRange
    ? effectiveNow({ startMinutes: safeStart, endMinutes: safeEnd, nowMinutes: timelineMinutes })
    : safeStart;
  const today = relation === 'today';
  const past = relation === 'past';

  return {
    relation,
    timelineMinutes,
    scheduleFromMinutes: past && !simulated ? safeStart : (today || simulated ? cursor : safeStart),
    capacityFromMinutes: past && !simulated ? safeEnd : (today || simulated ? cursor : safeStart),
    elapsedThroughMinutes: past && !simulated ? safeEnd : (today || simulated ? cursor : safeStart),
    interactive: today,
    showElapsed: past || today || simulated,
    showAvailableSlots: !past || simulated,
    showNow: (today || simulated)
      && Number.isFinite(timelineMinutes)
      && timelineMinutes >= safeStart
      && timelineMinutes < safeEnd,
  };
}

/**
 * Return elapsed intervals that have no recorded item occupying them.
 *
 * `fill-day` supplies synthetic free-time rows to the renderer; those are
 * deliberately ignored here because they describe the absence of a plan.
 * Gaps are split at hour boundaries so every result maps to exactly one
 * spiral cell, including the partial current hour.
 */
function pastUnplannedSegments({
  startMinutes,
  endMinutes,
  nowMinutes,
  occupiedEvents = [],
} = {}) {
  const start = asNumber(startMinutes);
  const end = asNumber(endMinutes);
  const now = asNumber(nowMinutes);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start
      || !Number.isFinite(now) || now <= start) {
    return [];
  }

  const elapsedEnd = Math.min(end, now);
  const occupied = mergeIntervals(
    (Array.isArray(occupiedEvents) ? occupiedEvents : [])
      .filter((event) => event && event.freetime !== true)
      .map((event) => {
        const eventStart = asNumber(event.start);
        const eventEnd = asNumber(event.end);
        if (!Number.isFinite(eventStart) || !Number.isFinite(eventEnd) || eventEnd <= eventStart) {
          return null;
        }
        const clippedStart = clamp(eventStart, start, elapsedEnd);
        const clippedEnd = clamp(eventEnd, start, elapsedEnd);
        return clippedEnd > clippedStart ? [clippedStart, clippedEnd] : null;
      })
      .filter(Boolean),
  );

  const gaps = [];
  let cursor = start;
  for (const [occupiedStart, occupiedEnd] of occupied) {
    if (occupiedStart > cursor) gaps.push([cursor, occupiedStart]);
    cursor = Math.max(cursor, occupiedEnd);
  }
  if (cursor < elapsedEnd) gaps.push([cursor, elapsedEnd]);

  const cells = pastTimelineSegments({ startMinutes: start, endMinutes: end, nowMinutes: elapsedEnd });
  return gaps.flatMap(([gapStart, gapEnd]) => cells
    .map((cell) => ({
      start: Math.max(gapStart, cell.start),
      end: Math.min(gapEnd, cell.end),
    }))
    .filter((segment) => segment.end > segment.start));
}

function splitIntervalAtHourBoundaries(start, end) {
  const segments = [];
  let cursor = start;
  while (cursor < end) {
    const nextHour = (Math.floor(cursor / 60) + 1) * 60;
    const segmentEnd = Math.min(end, nextHour);
    segments.push({ start: cursor, end: segmentEnd });
    cursor = segmentEnd;
  }
  return segments;
}

/**
 * Convert the synthetic free-time rows produced by `fill-day` into logical
 * hover targets. A logical slot may span several spiral hour cells, but it
 * remains one accessible target and one tooltip.
 */
function availableSlotGroups({
  events = [],
  startMinutes,
  endMinutes,
  nowMinutes,
  clampToNow = false,
} = {}) {
  const start = asNumber(startMinutes);
  const end = asNumber(endMinutes);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];

  const rawNow = asNumber(nowMinutes);
  const cursor = clampToNow
    ? effectiveNow({ startMinutes: start, endMinutes: end, nowMinutes })
    : start;
  const freeIntervals = mergeIntervals(
    (Array.isArray(events) ? events : [])
      .filter((event) => event && event.freetime === true)
      .map((event) => {
        const slotStart = asNumber(event.start);
        const slotEnd = asNumber(event.end);
        if (!Number.isFinite(slotStart) || !Number.isFinite(slotEnd) || slotEnd <= slotStart) {
          return null;
        }
        const clippedStart = clamp(slotStart, start, end);
        const clippedEnd = clamp(slotEnd, start, end);
        return clippedEnd > clippedStart ? [clippedStart, clippedEnd] : null;
      })
      .filter(Boolean),
  );

  return freeIntervals
    .map(([slotStart, slotEnd]) => {
      const visibleStart = clampToNow ? Math.max(slotStart, cursor) : slotStart;
      if (slotEnd <= visibleStart) return null;
      return {
        key: `slot:${visibleStart}:${slotEnd}`,
        start: visibleStart,
        end: slotEnd,
        duration: slotEnd - visibleStart,
        availableNow: clampToNow
          && Number.isFinite(rawNow)
          && rawNow >= slotStart
          && rawNow < slotEnd,
        segments: splitIntervalAtHourBoundaries(visibleStart, slotEnd),
      };
    })
    .filter(Boolean);
}

/** Classify only recorded elapsed states that remain meaningful after reflow. */
function pastItemStatus({ event, nowMinutes, dailyPage = false } = {}) {
  if (dailyPage !== true || !event) return null;
  const end = asNumber(event.end);
  const now = asNumber(nowMinutes);
  if (!Number.isFinite(end) || !Number.isFinite(now) || end > now) return null;
  if (event.done === true) return 'completed';
  if (event.meeting === true) return 'event';
  return null;
}

/**
 * Return the later hour that shares the same clock angle with this spiral
 * cell. The renderer uses that hour's outer radius as the current cell's inner
 * edge, so 05:00 can occupy the outer band without coloring an empty 17:00
 * cell. A pair that starts at the chart end is outside the visible timeline.
 */
function spiralCellInnerHour({ startMinute, endMinutes, windowStartMinutes = 300 } = {}) {
  const start = asNumber(startMinute);
  const end = asNumber(endMinutes);
  const windowStart = asNumber(windowStartMinutes);
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(windowStart)
      || start < 0 || start >= end) return null;

  const pairedMinute = start + 12 * 60;
  const profileIndex = 5 + Math.floor((pairedMinute - windowStart) / 60);
  return pairedMinute < end ? profileIndex : null;
}

/**
 * Return the UIDs of unfinished fixed events whose half-open time ranges
 * overlap. Touching boundaries (for example 10:00–11:00 and 11:00–12:00) are
 * adjacent, not conflicting.
 */
function overlappingFixedEventUids({ events = [] } = {}) {
  const fixedEvents = (Array.isArray(events) ? events : [])
    .filter((event) => event && event.uid && event.meeting === true && !event.done)
    .map((event) => ({ ...event, start: asNumber(event.start), end: asNumber(event.end) }))
    .filter((event) => Number.isFinite(event.start) && Number.isFinite(event.end) && event.end > event.start);
  const conflicts = new Set();

  for (let left = 0; left < fixedEvents.length; left += 1) {
    for (let right = left + 1; right < fixedEvents.length; right += 1) {
      const first = fixedEvents[left];
      const second = fixedEvents[right];
      if (first.start < second.end && second.start < first.end) {
        conflicts.add(first.uid);
        conflicts.add(second.uid);
      }
    }
  }

  return fixedEvents.filter((event) => conflicts.has(event.uid)).map((event) => event.uid);
}

/**
 * Identify the flexible task whose scheduled half-open interval contains now.
 * A chart outside today's Daily Page is intentionally inert: it can preview a
 * plan, but it must not claim that any task is current.
 */
function isCurrentPlannedTask({ event, nowMinutes, dailyPage = false } = {}) {
  if (dailyPage !== true || !event || event.todo !== true || event.done === true) return false;
  const start = asNumber(event.start);
  const end = asNumber(event.end);
  const now = asNumber(nowMinutes);
  return Number.isFinite(start) && Number.isFinite(end) && Number.isFinite(now)
    && end > start && start <= now && now < end;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizedInterval(event, startMinutes, endMinutes, { includeDone = false } = {}) {
  if (!event || (!includeDone && event.done) || event.meeting !== true) return null;
  const start = asNumber(event.start);
  const end = asNumber(event.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  const clippedStart = clamp(start, startMinutes, endMinutes);
  const clippedEnd = clamp(end, startMinutes, endMinutes);
  return clippedEnd > clippedStart ? [clippedStart, clippedEnd] : null;
}

/**
 * Identify the time pool that is currently elapsing.
 *
 * Workday and event intervals are deliberately half-open: a minute exactly at
 * an event's end belongs to Available (unless another overlapping event starts
 * at that same minute).  The raw now value is used instead of effectiveNow so
 * callers never turn an out-of-range clock into a false boundary state.
 */
function burningCapacityBucket({
  startMinutes,
  endMinutes,
  nowMinutes,
  fixedEvents = [],
} = {}) {
  const start = asNumber(startMinutes);
  const end = asNumber(endMinutes);
  const now = asNumber(nowMinutes);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start
      || !Number.isFinite(now) || now < start || now >= end) {
    return null;
  }

  const events = Array.isArray(fixedEvents) ? fixedEvents : [];
  const eventBurning = events.some((event) => {
    const interval = normalizedInterval(event, start, end);
    return interval && now >= interval[0] && now < interval[1];
  });
  return eventBurning ? 'events' : 'available';
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
function historicalDoneSlice({
  done,
  doneAt,
  duration,
  defaultDuration,
  actualDuration,
  lastClockEnd,
} = {}) {
  if (done !== true) return null;

  const actual = asNumber(actualDuration);
  const hasActual = Number.isFinite(actual) && actual > 0;
  const explicitEnd = asNumber(doneAt);
  const clockEnd = asNumber(lastClockEnd);
  const end = Number.isFinite(explicitEnd) ? explicitEnd : hasActual ? clockEnd : NaN;
  const explicitDuration = asNumber(duration);
  const fallbackDuration = asNumber(defaultDuration);
  const originalDuration = hasActual
    ? actual
    : Number.isFinite(explicitDuration) && explicitDuration > 0
      ? explicitDuration
      : fallbackDuration;

  if (!Number.isFinite(end) || !Number.isFinite(originalDuration) || originalDuration <= 0) {
    return null;
  }

  return {
    start: end - originalDuration,
    end,
    duration: originalDuration,
    ...(hasActual ? { durationSource: 'actual' } : {}),
  };
}

/**
 * Condense one completed task's closed CLOCK intervals into a daily Actual
 * total. Session positions remain authoritative in LOGBOOK; the spiral uses
 * only this summary to render one completion-anchored historical slice.
 */
function completedTaskClockSummary({ taskUid, entries = [], dayStartMs, dayEndMs } = {}) {
  const dayStart = asTimestamp(dayStartMs);
  const dayEnd = asTimestamp(dayEndMs);
  if (!taskUid || !Number.isFinite(dayStart) || !Number.isFinite(dayEnd) || dayEnd <= dayStart) {
    return { actualMinutes: 0, sessionCount: 0, latestEndMinutes: null };
  }

  let actualMilliseconds = 0;
  let sessionCount = 0;
  let latestEnd = null;
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (entry?.taskUid !== taskUid || entry?.running === true) continue;
    const start = asTimestamp(entry?.start);
    const end = asTimestamp(entry?.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const clippedStart = Math.max(dayStart, start);
    const clippedEnd = Math.min(dayEnd, end);
    if (clippedEnd <= clippedStart) continue;
    actualMilliseconds += clippedEnd - clippedStart;
    sessionCount += 1;
    latestEnd = latestEnd === null ? clippedEnd : Math.max(latestEnd, clippedEnd);
  }

  return {
    actualMinutes: Math.floor(actualMilliseconds / 60000),
    sessionCount,
    latestEndMinutes: latestEnd === null ? null : Math.floor((latestEnd - dayStart) / 60000),
  };
}

function calculateCapacity({
  startMinutes,
  endMinutes,
  nowMinutes,
  fixedEvents = [],
  allFixedEvents = fixedEvents,
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
  const totalFixedIntervals = Number.isFinite(start) && Number.isFinite(end) && end > start
    ? mergeIntervals(
      (Array.isArray(allFixedEvents) ? allFixedEvents : [])
        .map((event) => normalizedInterval(event, start, end, { includeDone: true }))
        .filter(Boolean),
    )
    : [];
  const rawAvailable = Math.max(0, (Number.isFinite(end) ? end : 0) - cursor);
  const availableMinutes = Math.max(0, rawAvailable - intervalMinutes(fixedIntervals));
  const totalFixedMinutes = intervalMinutes(totalFixedIntervals);
  const totalAvailableMinutes = Math.max(
    0,
    (Number.isFinite(start) && Number.isFinite(end) && end > start ? end - start : 0)
      - totalFixedMinutes,
  );
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
    totalAvailableMinutes,
    totalFixedMinutes,
    burningBucket: burningCapacityBucket({
      startMinutes: start,
      endMinutes: end,
      nowMinutes,
      fixedEvents,
    }),
    scheduledTasks: plan.scheduledTasks,
    overflowTasks: plan.overflowTasks,
  };
}

function formatDuration(minutes) {
  const value = Math.max(0, Math.round(asNumber(minutes) || 0));
  const hours = Math.floor(value / 60);
  const remainder = value % 60;
  if (!hours) return `${remainder}m`;
  if (!remainder) return `${hours}h`;
  return `${hours}h${String(remainder).padStart(2, '0')}m`;
}

const UI_COPY = {
  en: {
    capacity: {
      available: 'Available',
      events: 'Events',
      demand: 'Planned',
      overload: 'Overload',
      fragmented: 'No fitting slot',
      remaining: 'Remaining',
      burningAvailable: 'Flexible time is elapsing',
      burningEvents: 'Event time is elapsing',
      now: 'Current time',
    },
    allocation: {
      planned: 'planned',
      free: 'free',
      over: 'over',
      noSlot: 'no slot',
      left: 'left',
    },
    legend: { urgent: 'Urgent', event: 'Event', task: 'Task' },
    controls: {
      hideDone: 'Hide completed items',
      showDone: 'Show completed items',
      playback: 'Play back the day',
      tidy: 'Tidy completed and elapsed items',
      collapse: 'Collapse Nautilus Log',
      expand: 'Expand Nautilus Log',
    },
    panels: {
      overview: 'Overview',
      overflow: 'Unscheduled today',
      warnings: 'Schedule warnings',
      schedule: 'Schedule',
      item: 'item',
      items: 'items',
    },
    tooltips: {
      task: 'Task',
      event: 'Event',
      available: 'Available slot',
      availableNow: 'Available now',
    },
    warnings: {
      overnight: 'Continues into the next day',
      sameTime: 'Start and end times cannot be the same',
    },
  },
  zh: {
    capacity: {
      available: '可安排',
      events: '事件',
      demand: '已计划',
      overload: '超载',
      fragmented: '空档不足',
      remaining: '余量',
      burningAvailable: '可安排时间正在流逝',
      burningEvents: '事件时间正在流逝',
      now: '当前时间',
    },
    allocation: {
      planned: '已计划',
      free: '余量',
      over: '超载',
      noSlot: '无合适空档',
      left: '剩余',
    },
    legend: { urgent: '紧急', event: '事件', task: '任务' },
    controls: {
      hideDone: '隐藏已完成事项',
      showDone: '显示已完成事项',
      playback: '回放一整天',
      tidy: '整理已完成任务与已过去事件',
      collapse: '折叠 Nautilus Log',
      expand: '展开 Nautilus Log',
    },
    panels: {
      overview: '概览',
      overflow: '今日放不下',
      warnings: '时间范围提醒',
      schedule: '时间安排',
      item: '项',
      items: '项',
    },
    tooltips: {
      task: '任务',
      event: '事件',
      available: '可用空档',
      availableNow: '当前可用',
    },
    warnings: {
      overnight: '连续到次日',
      sameTime: '开始时间与结束时间不能相同',
    },
  },
};

function uiCopy(language = 'en') {
  return language === 'en' ? UI_COPY.en : UI_COPY.zh;
}

function capacityMetrics({ capacity = {}, language = 'en' } = {}) {
  const localized = uiCopy(language);
  const copy = localized.capacity;
  const allocation = localized.allocation;
  const burningBucket = capacity.burningBucket;
  const markBurning = (metric, bucket, label) => (
    burningBucket === bucket
      ? { ...metric, burning: true, burningLabel: label }
      : metric
  );
  const availableMinutes = Math.max(0, asNumber(capacity.availableMinutes) || 0);
  const totalAvailableMinutes = asNumber(capacity.totalAvailableMinutes);
  const totalFixedMinutes = asNumber(capacity.totalFixedMinutes);
  const demandMinutes = Math.max(0, asNumber(capacity.demandMinutes) || 0);
  const freeMinutes = Math.max(0, availableMinutes - demandMinutes);
  const fullDayAvailableMinutes = Number.isFinite(totalAvailableMinutes) && totalAvailableMinutes > 0
    ? totalAvailableMinutes
    : availableMinutes;
  const roundedLeftPercent = fullDayAvailableMinutes > 0
    ? Math.round((freeMinutes / fullDayAvailableMinutes) * 100)
    : 0;
  // Preserve the distinction between a tiny real buffer and an exact fit:
  // positive capacity never renders as 0%, while invalid inputs cannot push
  // the compact indicator outside its 0–100% contract.
  const leftPercentValue = Math.min(
    100,
    freeMinutes > 0 ? Math.max(1, roundedLeftPercent) : 0,
  );
  const leftPercent = `${leftPercentValue}%`;
  const percentTone = capacity.overloadMinutes > 0 || capacity.unplacedMinutes > 0
    ? 'warning'
    : freeMinutes > 0
      ? 'positive'
      : 'neutral';
  const available = markBurning({
    key: 'available',
    label: copy.available,
    value: formatDuration(availableMinutes),
    ...(Number.isFinite(totalAvailableMinutes)
      ? { total: formatDuration(totalAvailableMinutes) }
      : {}),
    tone: 'neutral',
  }, 'available', copy.burningAvailable);
  const events = markBurning({
    key: 'events',
    label: copy.events,
    value: formatDuration(capacity.fixedMinutes),
    ...(Number.isFinite(totalFixedMinutes)
      ? { total: formatDuration(totalFixedMinutes) }
      : {}),
    tone: 'event',
  }, 'events', copy.burningEvents);
  const demand = {
    key: 'demand',
    label: copy.demand,
    value: formatDuration(demandMinutes),
    summaryLabel: allocation.planned,
    percent: leftPercent,
    percentLabel: allocation.left,
    percentTone,
    tone: 'neutral',
  };
  let status;
  if (capacity.overloadMinutes > 0) {
    status = {
      key: 'overload',
      label: copy.overload,
      value: formatDuration(capacity.overloadMinutes),
      summaryLabel: allocation.over,
      tone: 'warning',
    };
  } else if (capacity.unplacedMinutes > 0) {
    status = {
      key: 'fragmented',
      label: copy.fragmented,
      value: formatDuration(capacity.unplacedMinutes),
      summaryLabel: allocation.noSlot,
      tone: 'warning',
    };
  } else {
    status = {
      key: 'remaining',
      label: copy.remaining,
      value: formatDuration(freeMinutes),
      summaryLabel: allocation.free,
      tone: freeMinutes > 0 ? 'positive' : 'neutral',
    };
  }
  // The first row answers the planning question (planned, free/over, and left),
  // while the second row provides the flexible and fixed time budgets behind it.
  return {
    planned: demand,
    status,
    available,
    events,
  };
}

function formatCapacitySummary(capacity) {
  const available = formatDuration(capacity.availableMinutes);
  const events = formatDuration(capacity.fixedMinutes);
  const demand = formatDuration(capacity.demandMinutes);
  if (capacity.overloadMinutes > 0) {
    return `可安排 ${available} · 事件 ${events} · 待办需求 ${demand} · 超载 ${formatDuration(capacity.overloadMinutes)}`;
  }
  if (capacity.unplacedMinutes > 0) {
    return `可安排 ${available} · 事件 ${events} · 待办需求 ${demand} · 空档不足 ${formatDuration(capacity.unplacedMinutes)}`;
  }
  return `可安排 ${available} · 事件 ${events} · 待办需求 ${demand} · 余量 ${formatDuration(capacity.slackMinutes)}`;
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

function sideRailMaxVerticalOffset(options, exclusionRadius) {
  return Math.max(
    0,
    asNumber(options.maxVerticalOffset) || exclusionRadius * 0.92,
  );
}

function sideRailSourceY(label, options) {
  const explicitAnchorY = Number(label.anchorY);
  if (Number.isFinite(explicitAnchorY)) return explicitAnchorY;
  const centerY = asNumber(options.centerY) || 0;
  const exclusionRadius = Math.max(0, asNumber(options.exclusionRadius) || 0);
  return centerY - Math.sin(asNumber(label.angle) || 0) * exclusionRadius;
}

function sideRailSide(label) {
  return Math.cos(asNumber(label.angle) || 0) < 0 ? 'left' : 'right';
}

function compareSideRailSourceOrder(first, second, options) {
  const firstAnchorY = sideRailSourceY(first, options);
  const secondAnchorY = sideRailSourceY(second, options);
  if (Math.abs(firstAnchorY - secondAnchorY) > 0.5) {
    return firstAnchorY - secondAnchorY;
  }

  const firstSortKey = Number(first.sortKey);
  const secondSortKey = Number(second.sortKey);
  if (Number.isFinite(firstSortKey) && Number.isFinite(secondSortKey)
      && firstSortKey !== secondSortKey) {
    // At the leftmost point of the spiral, later times continue upward. On
    // the right they continue downward. This tie-break keeps that reading
    // order stable when two connector anchors share almost the same height.
    return sideRailSide(first) === 'left'
      ? secondSortKey - firstSortKey
      : firstSortKey - secondSortKey;
  }

  return String(first.uid ?? '').localeCompare(String(second.uid ?? ''));
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
  if (options.layout === 'side-rails') {
    const maxVerticalOffset = sideRailMaxVerticalOffset(options, exclusionRadius);
    const side = directionX < 0 ? -1 : 1;
    const verticalOffset = clamp(
      directionY * maxVerticalOffset,
      -maxVerticalOffset,
      maxVerticalOffset,
    );
    const railDistance = exclusionRadius + gap + track * trackGap;
    const connectorKneeX = centerX + side * (exclusionRadius + gap * 0.42);
    const connectorRailX = centerX + side * (exclusionRadius + gap);
    const x = side > 0
      ? centerX + railDistance
      : centerX - railDistance - width;

    return {
      ...label,
      x,
      y: centerY + verticalOffset - height / 2,
      width,
      height,
      w: width,
      h: height,
      side: side > 0 ? 'right' : 'left',
      anchorY: sideRailSourceY(label, options),
      connectorKneeX,
      connectorRailX,
      track,
    };
  }
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

function sideRailCenterBounds(label, options, occupied, orderingGap) {
  const centerY = asNumber(options.centerY) || 0;
  const exclusionRadius = Math.max(0, asNumber(options.exclusionRadius) || 0);
  const maxVerticalOffset = sideRailMaxVerticalOffset(options, exclusionRadius);
  let minimum = centerY - maxVerticalOffset;
  let maximum = centerY + maxVerticalOffset;
  const side = sideRailSide(label);

  for (const placed of occupied) {
    if ((placed.side || sideRailSide(placed)) !== side) continue;
    const comparison = compareSideRailSourceOrder(label, placed, options);
    if (!comparison) continue;
    const placedCenterY = placed.y + (asNumber(placed.height ?? placed.h) || 0) / 2;
    if (comparison < 0) maximum = Math.min(maximum, placedCenterY - orderingGap);
    else minimum = Math.max(minimum, placedCenterY + orderingGap);
  }

  return { minimum, maximum };
}

function sideRailCenterCandidates(label, baseRect, options, occupied, collisionPadding) {
  const exclusionRadius = Math.max(0, asNumber(options.exclusionRadius) || 0);
  const maxVerticalOffset = sideRailMaxVerticalOffset(options, exclusionRadius);
  const height = Math.max(1, asNumber(label.height) || 1);
  const rowGap = Math.max(
    1,
    asNumber(options.rowGap) || height + collisionPadding + 4,
  );
  const orderingGap = Math.max(1, asNumber(options.orderingGap) || rowGap);
  const { minimum, maximum } = sideRailCenterBounds(label, options, occupied, orderingGap);
  const desiredCenterY = baseRect.y + baseRect.height / 2;
  if (minimum > maximum) {
    const bandMinimum = (asNumber(options.centerY) || 0) - maxVerticalOffset;
    const bandMaximum = (asNumber(options.centerY) || 0) + maxVerticalOffset;
    // Dense labels may exhaust the preferred band. Continue the established
    // order just beyond that band instead of reversing connectors or sending
    // the label many horizontal tracks away.
    if (maximum < bandMinimum) return [maximum];
    if (minimum > bandMaximum) return [minimum];
    return [(minimum + maximum) / 2];
  }

  const nearestCenterY = clamp(desiredCenterY, minimum, maximum);
  const maxSteps = Math.max(1, Math.ceil((maxVerticalOffset * 2) / rowGap));
  const candidates = [nearestCenterY];
  for (let step = 1; step <= maxSteps; step += 1) {
    candidates.push(nearestCenterY - step * rowGap);
    candidates.push(nearestCenterY + step * rowGap);
  }
  candidates.push(minimum, maximum);
  const seen = new Set();
  return candidates.filter((candidate) => {
    if (candidate < minimum || candidate > maximum) return false;
    const key = Math.round(candidate * 1000);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
    if (options.layout === 'side-rails') {
      const searchLimit = Math.max(16, occupied.length * 2 + labels.length + 4);
      let candidate = null;
      let fallback = externalLabelRect(label, options, track);

      sideRailSearch:
      for (; track <= searchLimit; track += 1) {
        const baseRect = externalLabelRect(label, options, track);
        const centerCandidates = sideRailCenterCandidates(
          label,
          baseRect,
          options,
          occupied,
          collisionPadding,
        );
        for (const labelCenterY of centerCandidates) {
          const rowCandidate = {
            ...baseRect,
            y: labelCenterY - baseRect.height / 2,
            rowOffset: labelCenterY - (baseRect.y + baseRect.height / 2),
          };
          fallback = rowCandidate;
          if (!occupied.some((rect) => labelRectsOverlap(rowCandidate, rect, collisionPadding))) {
            candidate = rowCandidate;
            break sideRailSearch;
          }
        }
      }
      occupied.push(candidate || fallback);
      return candidate || fallback;
    }

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

/**
 * Return the real SVG center and a radial point just outside an interval.
 * Keeping both points in the same `{ x, y }` coordinate contract prevents the
 * screen-space direction test from silently treating the center as (0, 0).
 */
function radialTooltipGeometry({
  startMinutes,
  endMinutes,
  centerX,
  centerY,
  radius,
} = {}) {
  const start = asNumber(startMinutes);
  const end = asNumber(endMinutes);
  const x = asNumber(centerX);
  const y = asNumber(centerY);
  const normalizedRadius = Math.max(0, asNumber(radius) || 0);
  if (![start, end, x, y].every(Number.isFinite) || end <= start) return null;

  const middle = (start + end) / 2;
  const rawAngle = (middle - 540) / 2;
  const angle = ((rawAngle % 360) + 360) % 360;
  const radians = (180 - angle) * (Math.PI / 180);
  return {
    center: { x, y },
    direction: {
      x: x + normalizedRadius * Math.cos(radians),
      y: y - normalizedRadius * Math.sin(radians),
    },
  };
}

/**
 * Position a measured floating tooltip beside an anchor without letting it
 * escape the browser viewport. The preferred radial side is tried first, then
 * its opposite, followed by the two perpendicular sides. Only after choosing
 * the lowest-overflow side do we shift the box inside the safety margin.
 */
function placeFloatingTooltip({
  anchorX,
  anchorY,
  tooltipWidth,
  tooltipHeight,
  viewportWidth,
  viewportHeight,
  preferred = 'right',
  margin = 12,
  gap = 10,
} = {}) {
  const xAnchor = asNumber(anchorX);
  const yAnchor = asNumber(anchorY);
  const width = Math.max(0, asNumber(tooltipWidth) || 0);
  const height = Math.max(0, asNumber(tooltipHeight) || 0);
  const viewportW = Math.max(0, asNumber(viewportWidth) || 0);
  const viewportH = Math.max(0, asNumber(viewportHeight) || 0);
  const safeMargin = Math.max(0, asNumber(margin) || 0);
  const safeGap = Math.max(0, asNumber(gap) || 0);
  if (!Number.isFinite(xAnchor) || !Number.isFinite(yAnchor)) return null;

  const placements = {
    right: { x: xAnchor + safeGap, y: yAnchor - height / 2 },
    left: { x: xAnchor - safeGap - width, y: yAnchor - height / 2 },
    top: { x: xAnchor - width / 2, y: yAnchor - safeGap - height },
    bottom: { x: xAnchor - width / 2, y: yAnchor + safeGap },
  };
  const orderByPreference = {
    right: ['right', 'left', 'top', 'bottom'],
    left: ['left', 'right', 'top', 'bottom'],
    top: ['top', 'bottom', 'right', 'left'],
    bottom: ['bottom', 'top', 'right', 'left'],
  };
  const order = orderByPreference[preferred] || orderByPreference.right;
  const overflow = ({ x, y }) => (
    Math.max(0, safeMargin - x)
    + Math.max(0, x + width - (viewportW - safeMargin))
    + Math.max(0, safeMargin - y)
    + Math.max(0, y + height - (viewportH - safeMargin))
  );
  const choice = order
    .map((placement) => ({ placement, ...placements[placement] }))
    .reduce((best, candidate) => {
      const score = overflow(candidate);
      return !best || score < best.score
        ? { ...candidate, score }
        : best;
    }, null);
  const maxX = Math.max(safeMargin, viewportW - safeMargin - width);
  const maxY = Math.max(safeMargin, viewportH - safeMargin - height);

  return {
    x: Math.round(Math.min(maxX, Math.max(safeMargin, choice.x))),
    y: Math.round(Math.min(maxY, Math.max(safeMargin, choice.y))),
    placement: choice.placement,
  };
}

/**
 * Move settled direct children to the front without changing the relative
 * order inside either partition.  This is the central Tidy invariant: active
 * flexible tasks keep the exact priority order consumed by scheduleTasks,
 * while fixed events retain their explicit ranges.
 */
function stableTidyOrder({ items = [], settledUids = [] } = {}) {
  const source = Array.isArray(items) ? items.slice() : [];
  const settled = new Set((Array.isArray(settledUids) ? settledUids : [])
    .filter((uid) => typeof uid === 'string' && uid));
  if (settled.size === 0) return source;
  return source.filter((item) => settled.has(item?.uid))
    .concat(source.filter((item) => !settled.has(item?.uid)));
}

/**
 * Produce deterministic move-to-index operations for one sibling list.  The
 * simulated list is updated after every move so applying the returned moves
 * in order reaches targetUids without rewriting blocks already in place.
 */
function childOrderMoves({ currentUids = [], targetUids = [] } = {}) {
  const current = Array.isArray(currentUids) ? currentUids.slice() : [];
  const target = Array.isArray(targetUids) ? targetUids.slice() : [];
  if (current.length !== target.length
      || new Set(current).size !== current.length
      || new Set(target).size !== target.length
      || current.some((uid) => !target.includes(uid))) {
    return [];
  }
  const moves = [];
  for (let order = 0; order < target.length; order += 1) {
    if (current[order] === target[order]) continue;
    const from = current.indexOf(target[order], order + 1);
    if (from < 0) return [];
    const [uid] = current.splice(from, 1);
    current.splice(order, 0, uid);
    moves.push({ uid, order });
  }
  return moves;
}

module.exports = {
  START_HOURS,
  END_HOURS,
  normalizeScheduleSettings,
  parseDurationToken,
  parseTimeRangeToken,
  alignIntervalToWindow,
  resolveRendererSettings,
  hourlyGridSegments,
  pastTimelineSegments,
  timelineDayState,
  pastUnplannedSegments,
  availableSlotGroups,
  pastItemStatus,
  spiralCellInnerHour,
  overlappingFixedEventUids,
  isCurrentPlannedTask,
  scheduleTasks,
  completedTaskClockSummary,
  historicalDoneSlice,
  calculateCapacity,
  burningCapacityBucket,
  formatDuration,
  uiCopy,
  capacityMetrics,
  formatCapacitySummary,
  truncateTextToWidth,
  placeLabelTracks,
  placeExternalLabels,
  radialTooltipGeometry,
  placeFloatingTooltip,
  stableTidyOrder,
  childOrderMoves,
  isCompactChartWidth,
};
