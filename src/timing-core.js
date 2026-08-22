/*
 * Pure execution-layer rules for Nautilus Log.
 *
 * This file intentionally has no Roam or DOM dependency. The graph adapter,
 * topbar controller, and tests all share these rules so CLOCK history, Primary
 * Plan selection, and duration labels cannot drift apart.
 */

const TODO_RE = /\{\{\[\[(TODO|DONE)\]\]\}\}|\{\{(TODO|DONE)\}\}/i;
const CLOCK_RE = /^\s*:?CLOCK:{1,2}\s*\[([^\]]+)\](?:\s*--\s*\[([^\]]+)\])?(?:\s*=>\s*(\d+:[0-5]\d))?\s*$/i;
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ACTIVE_WORK_WINDOW_MINUTES = 45;
const FORGOTTEN_CLOCK_MINUTES = 120;

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

function taskTitle(string) {
  if (typeof string !== 'string') return '(untitled)';
  const cleaned = string
    .replace(TODO_RE, '')
    .replace(/\{\{\[\[?[^}]*\}\}/g, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/#?\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\(\([a-zA-Z0-9_-]{6,}\)\)/g, '')
    .replace(/\s+(?:\d+h)?\d+m\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || '(untitled)';
}

function plannedMinutes(string, fallback = 15) {
  if (typeof string !== 'string') return fallback;
  const compact = string.match(/(?:^|\s)(?:(\d+)h)?(?:(\d+)m)(?=\s|$)/i);
  if (compact) return Number(compact[1] || 0) * 60 + Number(compact[2] || 0);
  const hours = string.match(/(?:^|\s)(\d+)h(?=\s|$)/i);
  return hours ? Number(hours[1]) * 60 : fallback;
}

function compareTreeOrder(left, right) {
  return (Number(left?.order) || 0) - (Number(right?.order) || 0)
    || String(left?.uid || '').localeCompare(String(right?.uid || ''));
}

function isNautilusComponent(string) {
  if (typeof string !== 'string') return false;
  return /\[\[Nautilus Log\]\]/i.test(string)
    && (/roam\/render/i.test(string) || /roam-render-Nautilus-Log-cljs/i.test(string));
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

function projectPlan(rows = [], planUid, fallbackMinutes = 15) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row?.parentUid === planUid && taskStatus(row.string) === 'TODO')
    .sort(compareTreeOrder)
    .map((row) => ({
      uid: row.uid,
      string: row.string,
      order: row.order,
      title: taskTitle(row.string),
      plannedMinutes: plannedMinutes(row.string, fallbackMinutes),
    }));
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
  return (Array.isArray(entries) ? entries : []).reduce((total, entry) => {
    if (entry?.taskUid !== taskUid) return total;
    const startMs = asTime(entry.start);
    const endMs = entry.running ? nowMs : asTime(entry.end);
    if (startMs === null || endMs === null) return total;
    const clippedStart = Math.max(dayStart, startMs);
    const clippedEnd = Math.min(dayEnd, endMs);
    return clippedEnd > clippedStart ? total + Math.floor((clippedEnd - clippedStart) / 60000) : total;
  }, 0);
}

function compactMinutes(minutes) {
  const safe = Math.max(0, Math.floor(Number(minutes) || 0));
  const hours = Math.floor(safe / 60);
  const rest = safe % 60;
  if (!hours) return `${rest}m`;
  return rest ? `${hours}h${rest}m` : `${hours}h`;
}

function durationMetadata({ taskUid, plannedMinutes: planned = 15, entries = [], now = new Date() } = {}) {
  const actual = actualMinutesToday(taskUid, entries, now);
  const normalizedPlanned = Math.max(0, Number(planned) || 0);
  return {
    primaryLabel: actual > 0 ? `Actual ${compactMinutes(actual)}` : `Planned ${compactMinutes(normalizedPlanned)}`,
    detailLabel: actual > 0
      ? `Actual ${compactMinutes(actual)} · Planned ${compactMinutes(normalizedPlanned)}`
      : `Planned ${compactMinutes(normalizedPlanned)}`,
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

function executionStructureKey(snapshot = {}, view = 'timing') {
  if (Number.isInteger(snapshot.revision)) {
    return JSON.stringify([
      view === 'plan' ? 'plan' : 'timing',
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
    view === 'plan' ? 'plan' : 'timing',
    snapshot.status || '',
    snapshot.notice || '',
    plan.plan?.uid || '',
    (plan.tasks || []).map(entry),
    entry(active.focused),
    (active.recent || []).map(entry),
    (snapshot.entries || []).map(entry),
    Number(snapshot.pomodoro?.startedAt) || 0,
  ]);
}

module.exports = {
  ACTIVE_WORK_WINDOW_MINUTES,
  FORGOTTEN_CLOCK_MINUTES,
  actualMinutesToday,
  buildActiveWork,
  chooseFocusedEntry,
  compactMinutes,
  durationMetadata,
  executionStructureKey,
  formatClockLine,
  formatElapsed,
  isNautilusComponent,
  isForgottenClock,
  nextPomodoroState,
  parseClockLine,
  plannedMinutes,
  projectPlan,
  selectPrimaryPlan,
  taskStatus,
  taskTitle,
};
