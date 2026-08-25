/*
 * Pure execution-layer rules for Nautilus Log.
 *
 * This file intentionally has no Roam or DOM dependency. The graph adapter,
 * topbar controller, and tests all share these rules so CLOCK history, Primary
 * Plan selection, and duration labels cannot drift apart.
 */

const logCore = require('./log-core');

const TODO_RE = /\{\{\[\[(TODO|DONE)\]\]\}\}|\{\{(TODO|DONE)\}\}/i;
const CLOCK_RE = /^\s*:?CLOCK:{1,2}\s*\[([^\]]+)\](?:\s*--\s*\[([^\]]+)\])?(?:\s*=>\s*(\d+:[0-5]\d))?\s*$/i;
const NAUTILUS_RENDER_RE = /\{\{\s*\[\[roam\/render\]\]\s*:\s*\(\(roam-render-Nautilus-Log-cljs\)\)/i;
const BLOCK_REF_RE = /\(\(([a-zA-Z0-9_-]{6,})\)\)/g;
const DURATION_TOKEN_RE = /(?:^|\s)(\d+h(?:\d+(?:min|m))?|\d+(?:min|m))(?=\s|$)/gi;
const DONE_TIME_RE = /(?:^|\s)d(\d{1,2})(?::(\d{1,2}))?(?=\s|$)/i;
const PROGRESS_RE = /(?:^|\s)d(\d{1,3})%(?=\s|$)/i;
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ACTIVE_WORK_WINDOW_MINUTES = 45;
const FORGOTTEN_CLOCK_MINUTES = 120;

const EXECUTION_COPY = Object.freeze({
  en: {
    tabs: { timing: 'Timing', plan: 'Plan', review: 'Review' },
    identity: { locate: 'Locate Primary Nautilus', views: 'Nautilus execution views', panel: 'Nautilus Log execution panel' },
    actions: {
      clockIn: 'Clock In', clockOut: 'Clock Out', complete: 'Complete task', deleteClock: 'Delete current CLOCK',
      confirmDelete: 'Click again to delete current CLOCK', openPanel: 'Open Nautilus Log execution panel',
      openPanelHint: 'Click: panel · ⌥/Alt: main · ⇧: sidebar',
      startPomodoro: 'Start standalone POMO', stopPomodoro: 'Stop standalone POMO',
    },
    capacity: { label: 'Today capacity', available: 'Available', remaining: 'Remaining', overload: 'Overload', noSlot: 'No fitting slot' },
    plan: { scheduled: 'Scheduled today', unscheduled: 'Unscheduled today', today: 'Today' },
    timing: { timing: 'Timing', actual: 'Actual', planned: 'Planned', remaining: 'Remaining', recent: 'Recent', left: 'left', check: 'Check CLOCK' },
    review: {
      summary: 'Today review summary', completed: 'Completed', compared: 'Compared', actual: 'Actual',
      planned: 'Planned', variance: 'Variance', live: 'Live', paused: 'Paused', notTracked: 'Not tracked', notStarted: 'Not started',
    },
    empty: {
      noActive: 'No active work. Open Plan to start a task.',
      noLog: 'No Nautilus Log was found on today’s Daily Note.',
      noPlanTasks: 'The Primary Plan has no unfinished direct-child tasks.',
      noReviewTasks: 'The Primary Plan has no direct-child tasks to review.',
    },
    trigger: { thread: 'thread', threads: 'threads', check: 'Check CLOCK' },
  },
  zh: {
    tabs: { timing: '计时', plan: '计划', review: '复盘' },
    identity: { locate: '定位主 Nautilus', views: 'Nautilus 执行视图', panel: 'Nautilus Log 执行面板' },
    actions: {
      clockIn: '开始计时', clockOut: '结束计时', complete: '完成任务', deleteClock: '删除当前 CLOCK',
      confirmDelete: '再次点击以删除当前 CLOCK', openPanel: '打开 Nautilus Log 执行面板',
      openPanelHint: '单击：面板 · ⌥/Alt：主界面 · ⇧：侧边栏',
      startPomodoro: '开始独立番茄钟', stopPomodoro: '结束独立番茄钟',
    },
    capacity: { label: '今日容量', available: '可安排', remaining: '余量', overload: '超载', noSlot: '没有连续空档' },
    plan: { scheduled: '今日已安排', unscheduled: '今日未排入', today: '今天' },
    timing: { timing: '计时', actual: '实际', planned: '预计', remaining: '剩余', recent: '最近', left: '后移出', check: '检查 CLOCK' },
    review: {
      summary: '今日复盘摘要', completed: '已完成', compared: '已对比', actual: '实际',
      planned: '预计', variance: '偏差', live: '进行中', paused: '已暂停', notTracked: '未计时', notStarted: '未开始',
    },
    empty: {
      noActive: '当前没有计时任务。打开“计划”开始一项任务。',
      noLog: '今天的 Daily Note 中没有找到 Nautilus Log。',
      noPlanTasks: '主计划中没有未完成的直接子任务。',
      noReviewTasks: '主计划中没有可复盘的直接子任务。',
    },
    trigger: { thread: '项任务', threads: '项任务', check: '检查 CLOCK' },
  },
});

function executionCopy(language = 'en') {
  return language === 'zh' ? EXECUTION_COPY.zh : EXECUTION_COPY.en;
}

function capacitySummary(execution = {}, language = 'en') {
  const { planned, status } = logCore.capacityMetrics({ capacity: execution, language });
  return {
    planned: { value: planned.value, label: planned.summaryLabel },
    status: {
      value: status.value,
      label: status.summaryLabel,
      warning: status.tone === 'warning',
    },
    left: { value: planned.percent, label: planned.percentLabel },
  };
}

function topbarDensity({
  availableWidth,
  fullControlWidth = 220,
  compactControlWidth = 112,
  safetyGap = 12,
} = {}) {
  const available = Number(availableWidth);
  if (!Number.isFinite(available)) return 'full';
  const usableWidth = Math.max(0, available - Math.max(0, Number(safetyGap) || 0));
  if (usableWidth >= fullControlWidth) return 'full';
  if (usableWidth >= compactControlWidth) return 'compact';
  return 'icon';
}

const pad = (value) => String(value).padStart(2, '0');
const asTime = (value) => {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.getTime();
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

function formatStamp(date) {
  const value = date instanceof Date ? date : new Date(date);
  if (!Number.isFinite(value.getTime())) throw new TypeError('A valid CLOCK date is required');
  return `[${String(value.getFullYear()).padStart(4, '0')}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${DAY_NAMES[value.getDay()]} ${pad(value.getHours())}:${pad(value.getMinutes())}]`;
}

function parseTimestamp(text) {
  if (typeof text !== 'string') return null;
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+\S+)?\s+(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (month < 1 || month > 12 || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(hour, minute, 0, 0);
  return date.getFullYear() === year
    && date.getMonth() === month - 1
    && date.getDate() === day
    && date.getHours() === hour
    && date.getMinutes() === minute
    ? date
    : null;
}

function durationMinutes(start, end) {
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / 60000));
}

function formatDuration(minutes) {
  const safe = Math.max(0, Math.round(Number(minutes) || 0));
  return `${Math.floor(safe / 60)}:${pad(safe % 60)}`;
}

function formatClockLine(start, end = null) {
  const startedAt = start instanceof Date ? start : new Date(start);
  if (!end) return `CLOCK: ${formatStamp(startedAt)}`;
  const endedAt = end instanceof Date ? end : new Date(end);
  const safeEnd = endedAt.getTime() < startedAt.getTime() ? startedAt : endedAt;
  return `CLOCK: ${formatStamp(startedAt)}--${formatStamp(safeEnd)} => ${formatDuration(durationMinutes(startedAt, safeEnd))}`;
}

function parseClockLine(string) {
  if (typeof string !== 'string') return null;
  const match = CLOCK_RE.exec(string);
  if (!match) return null;
  const start = parseTimestamp(match[1]);
  const end = match[2] ? parseTimestamp(match[2]) : null;
  if (!start || (match[2] && !end) || (end && end < start)) return null;
  return {
    start,
    end,
    running: !end,
    minutes: end ? durationMinutes(start, end) : null,
  };
}

function taskStatus(string) {
  if (typeof string !== 'string') return null;
  const match = TODO_RE.exec(string);
  return match ? (match[1] || match[2]).toUpperCase() : null;
}

function resolveBlockReferences(string, readString) {
  if (typeof string !== 'string' || typeof readString !== 'function') return string;
  return string.replace(BLOCK_REF_RE, (reference, uid) => {
    const resolved = readString(uid);
    return typeof resolved === 'string' && resolved ? resolved : reference;
  });
}

function taskTitle(string) {
  if (typeof string !== 'string') return '(untitled)';
  const withoutMarkup = string
    .replace(TODO_RE, '')
    .replace(/\{\{\[\[?[^}]*\}\}/g, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/#?\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\(\([a-zA-Z0-9_-]{6,}\)\)/g, '')
    .replace(/\s+d\d{1,3}%/gi, '');
  const cleaned = logCore.parseDurationToken({ text: withoutMarkup, fallback: 0 }).cleanedText
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || '(untitled)';
}

function plannedMinutes(string, fallback = 15) {
  return logCore.parseDurationToken({ text: string, fallback }).minutes;
}

function taskProgress(string) {
  if (typeof string !== 'string') return 0;
  const match = PROGRESS_RE.exec(string);
  return match ? Math.min(100, Number(match[1]) || 0) : 0;
}

function doneTime(string) {
  if (typeof string !== 'string') return { minutes: null, token: '' };
  const match = DONE_TIME_RE.exec(string);
  if (!match) return { minutes: null, token: '' };
  const hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  if (hour > 23 || minute > 59) return { minutes: null, token: '' };
  return { minutes: hour * 60 + minute, token: match[0].trim() };
}

function durationTokens(string) {
  if (typeof string !== 'string') return [];
  return [...string.matchAll(new RegExp(DURATION_TOKEN_RE.source, DURATION_TOKEN_RE.flags))]
    .map((match) => ({
      token: match[1],
      minutes: logCore.parseDurationToken({ text: match[1], fallback: 0 }).minutes,
    }));
}

function removeTaskState(string) {
  return String(string ?? '')
    .replace(new RegExp(TODO_RE.source, 'gi'), ' ')
    .replace(new RegExp(DONE_TIME_RE.source, 'gi'), ' ')
    .replace(new RegExp(PROGRESS_RE.source, 'gi'), ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function removeDurationTokens(string) {
  return String(string ?? '')
    .replace(new RegExp(DURATION_TOKEN_RE.source, DURATION_TOKEN_RE.flags), ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function removeTimeRange(string) {
  const parsed = logCore.parseTimeRangeToken({ text: String(string ?? '') });
  return parsed ? parsed.cleanedText : String(string ?? '');
}

function referenceUids(string) {
  if (typeof string !== 'string') return [];
  return [...string.matchAll(new RegExp(BLOCK_REF_RE.source, BLOCK_REF_RE.flags))]
    .map((match) => match[1]);
}

/**
 * Build one daily task instance with explicit wrapper precedence. A bare
 * reference inherits only its source TODO/DONE state; an explicit wrapper
 * marker reopens or completes the task for today. Completion time, progress,
 * and CLOCK identity always belong to the wrapper. Referenced blocks also
 * contribute reusable content, with a wrapper duration or time range
 * overriding source metadata instead of adding to it.
 */
function resolveTaskInstance({
  uid = '',
  localString = '',
  references = [],
  readString,
  fallbackMinutes = 15,
  maxDepth = 8,
} = {}) {
  const local = String(localString ?? '');
  const supplied = new Map((Array.isArray(references) ? references : [])
    .filter((reference) => reference?.uid && typeof reference.string === 'string')
    .map((reference) => [reference.uid, reference.string]));
  const read = (referenceUid) => {
    if (supplied.has(referenceUid)) return supplied.get(referenceUid);
    if (typeof readString !== 'function') return '';
    const value = readString(referenceUid);
    return typeof value === 'string' ? value : '';
  };
  const resolveSource = (referenceUid, stack = []) => {
    if (!referenceUid || stack.includes(referenceUid) || stack.length >= maxDepth) return '';
    const source = read(referenceUid);
    if (!source) return '';
    const nested = source.replace(new RegExp(BLOCK_REF_RE.source, BLOCK_REF_RE.flags), (_match, nestedUid) => (
      resolveSource(nestedUid, [...stack, referenceUid])
    ));
    return removeTaskState(nested);
  };
  const resolveSourceStatus = (referenceUid, stack = []) => {
    if (!referenceUid || stack.includes(referenceUid) || stack.length >= maxDepth) return null;
    const source = read(referenceUid);
    if (!source) return null;
    const status = taskStatus(source);
    if (status) return status;
    const nestedUid = referenceUids(source)[0] || null;
    return nestedUid
      ? resolveSourceStatus(nestedUid, [...stack, referenceUid])
      : null;
  };

  const refs = referenceUids(local);
  const sourceUid = refs[0] || null;
  const source = sourceUid ? resolveSource(sourceUid) : '';
  const explicitStatus = taskStatus(local);
  const sourceStatus = sourceUid ? resolveSourceStatus(sourceUid) : null;
  const localDone = doneTime(local);
  const localProgress = taskProgress(local);
  const localDurations = durationTokens(local);
  const sourceDurations = durationTokens(source);
  const localDuration = localDurations.at(-1) || null;
  const sourceDuration = sourceDurations.at(-1) || null;
  const planned = localDuration?.minutes ?? sourceDuration?.minutes
    ?? Math.max(0, Math.round(Number(fallbackMinutes) || 0));
  const localRange = parseTimeRangeMinutes(local);
  const sourceRange = parseTimeRangeMinutes(source);
  const range = localRange || sourceRange;

  const resolvedContent = local.replace(
    new RegExp(BLOCK_REF_RE.source, BLOCK_REF_RE.flags),
    (_match, referenceUid) => resolveSource(referenceUid),
  );
  const body = removeTimeRange(removeDurationTokens(removeTaskState(resolvedContent)))
    .replace(/\s+/g, ' ')
    .trim();
  const status = explicitStatus || sourceStatus || 'TODO';
  const statusOrigin = explicitStatus ? 'local' : sourceStatus ? 'source' : 'implicit';
  const marker = `{{[[${status}]]}}`;
  const rangeToken = range?.text || '';
  const progressToken = localProgress > 0 ? `d${localProgress}%` : '';
  const doneToken = explicitStatus === 'DONE' ? localDone.token : '';
  const durationToken = range ? '' : `${planned}m`;
  const effectiveString = [marker, rangeToken, body, durationToken, progressToken, doneToken]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    uid,
    sourceUid,
    localString: local,
    effectiveString,
    title: taskTitle(body),
    status,
    statusOrigin,
    explicitStatus,
    plannedMinutes: planned,
    progress: localProgress,
    remainingMinutes: Math.max(0, Math.round(planned * (1 - localProgress / 100))),
    doneAt: explicitStatus === 'DONE' ? localDone.minutes : null,
    kind: range ? 'event' : 'task',
    range,
  };
}

function parseTimeRangeMinutes(string) {
  const parsed = logCore.parseTimeRangeToken({ text: string });
  if (!parsed) return null;
  return {
    start: parsed.start,
    end: parsed.end,
    text: parsed.token,
    warning: parsed.warningCode === 'sameTime' ? 'Start and end times cannot be the same' : '',
    warningCode: parsed.warningCode,
  };
}

function compareTreeOrder(left, right) {
  return (Number(left?.order) || 0) - (Number(right?.order) || 0)
    || String(left?.uid || '').localeCompare(String(right?.uid || ''));
}

function isNautilusComponent(string) {
  if (typeof string !== 'string') return false;
  return NAUTILUS_RENDER_RE.test(string);
}

function selectPrimaryPlan(rows = [], pageUid, matcher = isNautilusComponent) {
  const validRows = (Array.isArray(rows) ? rows : []).filter((row) => row?.uid && row?.parentUid);
  const childrenByParent = new Map();
  for (const row of validRows) {
    if (!childrenByParent.has(row.parentUid)) childrenByParent.set(row.parentUid, []);
    childrenByParent.get(row.parentUid).push(row);
  }
  for (const children of childrenByParent.values()) children.sort(compareTreeOrder);

  const seen = new Set();
  const walk = (parent) => {
    for (const node of childrenByParent.get(parent) || []) {
      if (seen.has(node.uid)) continue;
      seen.add(node.uid);
      if (matcher(node.string, node)) return node;
      const nested = walk(node.uid);
      if (nested) return nested;
    }
    return null;
  };
  return pageUid ? walk(pageUid) : null;
}

function projectDirectTasks(rows = [], planUid, fallbackMinutes = 15) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row?.parentUid === planUid)
    .sort(compareTreeOrder)
    .map((row) => {
      const instance = row.taskInstance || resolveTaskInstance({
        uid: row.uid,
        localString: row.string,
        references: row.references,
        fallbackMinutes,
      });
      if (instance.kind !== 'task' || !instance.title || instance.title === '(untitled)') return null;
      return {
        ...instance,
        string: instance.effectiveString,
        order: row.order,
      };
    })
    .filter(Boolean);
}

function projectPlan(rows = [], planUid, fallbackMinutes = 15) {
  return projectDirectTasks(rows, planUid, fallbackMinutes)
    .filter((task) => task.status === 'TODO');
}

function projectReviewTasks(rows = [], planUid, fallbackMinutes = 15) {
  return projectDirectTasks(rows, planUid, fallbackMinutes)
    .filter((task) => !(task.status === 'DONE' && task.statusOrigin === 'source'));
}

function projectFixedEvents(rows = [], planUid) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row?.parentUid === planUid)
    .sort(compareTreeOrder)
    .map((row) => {
      const instance = row.taskInstance || resolveTaskInstance({ uid: row.uid, localString: row.string });
      const range = instance.range;
      if (instance.kind !== 'event' || !range) return null;
      return {
        uid: row.uid,
        string: instance.effectiveString,
        order: row.order,
        title: instance.title,
        start: range.start,
        end: range.end,
        meeting: true,
        fixed: true,
        done: instance.status === 'DONE',
        warning: range.warning,
      };
    })
    .filter(Boolean);
}

function chooseFocusedEntry(entries = []) {
  return (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry?.running && asTime(entry.start) !== null)
    .slice()
    .sort((left, right) => asTime(right.start) - asTime(left.start))[0] || null;
}

function normalizedMinuteSetting(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return Math.max(0, Math.round(Number(fallback) || 0));
  return Math.max(0, Math.round(number));
}

function buildActiveWork(entries = [], now = new Date(), windowMinutes = ACTIVE_WORK_WINDOW_MINUTES) {
  const source = (Array.isArray(entries) ? entries : []).filter((entry) => entry?.status !== 'DONE');
  const nowMs = asTime(now) ?? Date.now();
  const normalizedWindowMinutes = normalizedMinuteSetting(windowMinutes, ACTIVE_WORK_WINDOW_MINUTES);
  const windowMs = normalizedWindowMinutes * 60000;
  const focused = chooseFocusedEntry(source);
  const byTask = new Map();
  source.forEach((entry, index) => {
    if (!entry || entry.running || entry.taskUid === focused?.taskUid || normalizedWindowMinutes === 0) return;
    const endMs = asTime(entry.end);
    if (endMs === null || endMs > nowMs || nowMs - endMs >= windowMs) return;
    const previous = byTask.get(entry.taskUid);
    if (!previous || endMs > previous.endMs) byTask.set(entry.taskUid, { entry, endMs, index });
  });
  const recent = [...byTask.values()]
    .sort((left, right) => right.endMs - left.endMs || left.index - right.index)
    .map(({ entry }) => ({ ...entry, activeKind: 'recent' }));
  return {
    focused: focused ? { ...focused, activeKind: 'focused' } : null,
    recent,
    items: [focused, ...recent].filter(Boolean),
    count: (focused ? 1 : 0) + recent.length,
    windowMinutes: normalizedWindowMinutes,
  };
}

function isForgottenClock(entry, now = new Date(), thresholdMinutes = FORGOTTEN_CLOCK_MINUTES) {
  if (!entry?.running) return false;
  const startMs = asTime(entry.start);
  const nowMs = asTime(now);
  const threshold = normalizedMinuteSetting(thresholdMinutes, FORGOTTEN_CLOCK_MINUTES);
  return threshold > 0 && startMs !== null && nowMs !== null && nowMs - startMs >= threshold * 60000;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function actualMinutesToday(taskUid, entries = [], now = new Date()) {
  const dayStart = startOfDay(now).getTime();
  const dayEnd = dayStart + 24 * 60 * 60 * 1000;
  const nowMs = now.getTime();
  const totalMilliseconds = (Array.isArray(entries) ? entries : []).reduce((total, entry) => {
    if (entry?.taskUid !== taskUid) return total;
    const startMs = asTime(entry.start);
    const endMs = entry.running ? nowMs : asTime(entry.end);
    if (startMs === null || endMs === null) return total;
    const clippedStart = Math.max(dayStart, startMs);
    const clippedEnd = Math.min(dayEnd, endMs);
    return clippedEnd > clippedStart ? total + clippedEnd - clippedStart : total;
  }, 0);
  return Math.floor(totalMilliseconds / 60000);
}

function buildDailyReview({ tasks = [], entries = [], now = new Date() } = {}) {
  const entriesByTask = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry?.taskUid) continue;
    if (!entriesByTask.has(entry.taskUid)) entriesByTask.set(entry.taskUid, []);
    entriesByTask.get(entry.taskUid).push(entry);
  }

  const rows = (Array.isArray(tasks) ? tasks : []).map((task) => {
    const taskEntries = entriesByTask.get(task.uid) || [];
    const closedEntries = taskEntries.filter((entry) => !entry.running);
    const closedActual = actualMinutesToday(task.uid, closedEntries, now);
    const currentActual = actualMinutesToday(task.uid, taskEntries, now);
    const completed = task.status === 'DONE';
    const live = !completed && currentActual > 0 && taskEntries.some((entry) => entry.running);
    const comparable = completed && closedActual > 0;
    const actual = completed ? closedActual : currentActual;
    const state = comparable
      ? 'compared'
      : completed
        ? 'not-tracked'
        : live
          ? 'live'
          : actual > 0
            ? 'paused'
            : 'not-started';
    return {
      ...task,
      state,
      actualMinutes: actual,
      varianceMinutes: comparable ? actual - task.plannedMinutes : null,
    };
  });

  const compared = rows.filter((row) => row.state === 'compared');
  const planned = compared.reduce((total, row) => total + row.plannedMinutes, 0);
  const actual = compared.reduce((total, row) => total + row.actualMinutes, 0);
  return {
    summary: {
      totalCount: rows.length,
      completedCount: rows.filter((row) => row.status === 'DONE').length,
      comparedCount: compared.length,
      plannedMinutes: planned,
      actualMinutes: actual,
      varianceMinutes: actual - planned,
    },
    rows,
  };
}

function compactMinutes(minutes) {
  const safe = Math.max(0, Math.floor(Number(minutes) || 0));
  const hours = Math.floor(safe / 60);
  const rest = safe % 60;
  if (!hours) return `${rest}m`;
  return rest ? `${hours}h${rest}m` : `${hours}h`;
}

function durationMetadata({ taskUid, plannedMinutes: planned = 15, entries = [], now = new Date(), language = 'en' } = {}) {
  const actual = actualMinutesToday(taskUid, entries, now);
  const normalizedPlanned = Math.max(0, Number(planned) || 0);
  const copy = executionCopy(language).timing;
  return {
    primaryLabel: actual > 0 ? `${copy.actual} ${compactMinutes(actual)}` : `${copy.planned} ${compactMinutes(normalizedPlanned)}`,
    detailLabel: actual > 0
      ? `${copy.actual} ${compactMinutes(actual)} · ${copy.planned} ${compactMinutes(normalizedPlanned)}`
      : `${copy.planned} ${compactMinutes(normalizedPlanned)}`,
    actualMinutes: actual,
    plannedMinutes: normalizedPlanned,
  };
}

function formatElapsed(milliseconds) {
  const total = Math.max(0, Math.floor((Number(milliseconds) || 0) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

function nextPomodoroState(current, { action, nowMs = Date.now() } = {}) {
  if (action === 'stop') return null;
  if (action === 'switch') return current || { startedAt: nowMs };
  if (action === 'start') return current || { startedAt: nowMs };
  return current || null;
}

function nextStandalonePomodoroState(current, { action, nowMs = Date.now() } = {}) {
  if (action === 'stop') return null;
  if (action === 'start') {
    const startedAt = Number(current?.startedAt);
    return Number.isFinite(startedAt) ? { startedAt } : { startedAt: nowMs };
  }
  return current && Number.isFinite(Number(current.startedAt))
    ? { startedAt: Number(current.startedAt) }
    : null;
}

function standalonePomodoroElapsed(state, now = Date.now()) {
  const startedAt = Number(state?.startedAt);
  const nowMs = asTime(now);
  if (!Number.isFinite(startedAt) || nowMs === null) return 0;
  return Math.max(0, Math.floor((nowMs - startedAt) / 1000));
}

function isStandalonePomodoroOverdue(state, now = Date.now(), thresholdMinutes = 45) {
  const threshold = normalizedMinuteSetting(thresholdMinutes, 45);
  return threshold > 0 && standalonePomodoroElapsed(state, now) >= threshold * 60;
}

function executionStructureKey(snapshot = {}, view = 'timing') {
  const normalizedView = ['timing', 'plan', 'review'].includes(view) ? view : 'timing';
  if (Number.isInteger(snapshot.revision)) {
    return JSON.stringify([
      normalizedView,
      snapshot.revision,
      snapshot.status || '',
      snapshot.notice || '',
    ]);
  }
  const time = (value) => asTime(value);
  const entry = (value) => value ? [
    value.clockUid || '',
    value.taskUid || value.uid || '',
    value.title || '',
    value.status || '',
    time(value.start),
    time(value.end),
    Boolean(value.running),
    Number(value.minutes) || 0,
    Number(value.plannedMinutes) || 0,
  ] : null;
  const plan = snapshot.planSnapshot || {};
  const active = snapshot.activeWork || {};
  return JSON.stringify([
    normalizedView,
    snapshot.status || '',
    snapshot.notice || '',
    plan.plan?.uid || '',
    (plan.tasks || []).map(entry),
    entry(active.focused),
    (active.recent || []).map(entry),
    (snapshot.entries || []).map(entry),
    Number(snapshot.pomodoro?.startedAt) || 0,
    Number(snapshot.standalonePomodoro?.startedAt) || 0,
  ]);
}

module.exports = {
  ACTIVE_WORK_WINDOW_MINUTES,
  FORGOTTEN_CLOCK_MINUTES,
  actualMinutesToday,
  buildDailyReview,
  buildActiveWork,
  capacitySummary,
  chooseFocusedEntry,
  compactMinutes,
  durationMetadata,
  executionCopy,
  executionStructureKey,
  formatClockLine,
  formatElapsed,
  isNautilusComponent,
  isForgottenClock,
  nextPomodoroState,
  nextStandalonePomodoroState,
  standalonePomodoroElapsed,
  isStandalonePomodoroOverdue,
  parseClockLine,
  plannedMinutes,
  taskProgress,
  parseTimeRangeMinutes,
  projectPlan,
  projectReviewTasks,
  projectFixedEvents,
  resolveBlockReferences,
  resolveTaskInstance,
  selectPrimaryPlan,
  taskStatus,
  taskTitle,
  topbarDensity,
};
