const MAX_DESCRIPTION_LENGTH = 600;
const GOOGLE_CALENDAR_SOURCE_SUFFIX = 'Google Calendar';

function compactWhitespace(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function decodeHtmlEntities(value) {
  const named = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  };
  return String(value ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    const normalized = entity.toLowerCase();
    if (normalized.startsWith('#x')) {
      const codePoint = Number.parseInt(normalized.slice(2), 16);
      return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : match;
    }
    if (normalized.startsWith('#')) {
      const codePoint = Number.parseInt(normalized.slice(1), 10);
      return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : match;
    }
    return named[normalized] ?? match;
  });
}

export function calendarDescriptionText(value, limit = MAX_DESCRIPTION_LENGTH) {
  const text = decodeHtmlEntities(
    String(value ?? '')
      .replace(/<(?:br|\/p|\/div|\/li)>/gi, ' ')
      .replace(/<[^>]*>/g, ' '),
  );
  const compact = compactWhitespace(text);
  const maximum = Math.max(0, Number(limit) || MAX_DESCRIPTION_LENGTH);
  if (compact.length <= maximum) return compact;
  return `${compact.slice(0, Math.max(0, maximum - 1)).trimEnd()}…`;
}

function safeHttpUrl(value) {
  try {
    const url = new URL(String(value ?? ''));
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    return url.href.replace(/\)/g, '%29');
  } catch (_error) {
    return '';
  }
}

function googleCalendarOpenUrl(value, accountHint) {
  const original = safeHttpUrl(value);
  const hint = compactWhitespace(accountHint);
  if (!original || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(hint)) return original;
  try {
    const url = new URL(original);
    const googleCalendarHost = url.hostname === 'www.google.com'
      || url.hostname === 'calendar.google.com';
    if (!googleCalendarHost || !url.pathname.startsWith('/calendar/')) return original;
    url.searchParams.set('authuser', hint);
    return url.href.replace(/\)/g, '%29');
  } catch (_error) {
    return original;
  }
}

function firstConferenceUrl(event) {
  const direct = safeHttpUrl(event?.hangoutLink);
  if (direct) return direct;
  const entries = event?.conferenceData?.entryPoints;
  if (!Array.isArray(entries)) return '';
  const video = entries.find((entry) => entry?.entryPointType === 'video');
  return safeHttpUrl(video?.uri || entries[0]?.uri);
}

function localTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function localDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function sourceSuffix() {
  return ` · ${GOOGLE_CALENDAR_SOURCE_SUFFIX}`;
}

function declinedBySelf(event) {
  return Array.isArray(event?.attendees)
    && event.attendees.some((attendee) => (
      attendee?.self === true && attendee?.responseStatus === 'declined'
    ));
}

function recurringIdentity(event) {
  if (!event?.recurringEventId) return '';
  return event?.originalStartTime?.dateTime || event?.originalStartTime?.date || '';
}

export function googleCalendarEventKey(calendarId, event = {}) {
  const pieces = [String(calendarId || 'primary'), String(event?.id || '')];
  const recurring = recurringIdentity(event);
  if (recurring) pieces.push(recurring);
  return pieces.join(':');
}

export function googleTaskKey(taskListId, task = {}) {
  return ['task', String(taskListId || 'default'), String(task?.id || '')].join(':');
}

function sourceString(calendar, event) {
  const segments = [
    'Google Calendar',
    compactWhitespace(calendar?.summary || calendar?.id || 'Calendar'),
  ];
  const joinUrl = firstConferenceUrl(event);
  const openUrl = googleCalendarOpenUrl(event?.htmlLink, calendar?.accountHint);
  if (joinUrl) segments.push(`[Join](${joinUrl})`);
  if (openUrl) segments.push(`[Open](${openUrl})`);
  return segments.join(' · ');
}

/**
 * Convert Google Calendar API event resources into the compact Roam contract
 * consumed by Nautilus. All-day, transparent, and self-declined rows are not
 * fixed commitments, so they are intentionally excluded from the day plan.
 */
export function normalizeGoogleCalendarEvents({ calendar = {}, events = [] } = {}) {
  const calendarId = String(calendar?.id || 'primary');
  return (Array.isArray(events) ? events : []).flatMap((event) => {
    const key = googleCalendarEventKey(calendarId, event);
    if (!event?.id) return [];
    if (event?.status === 'cancelled') {
      return [{
        key,
        calendarId,
        eventId: event.id,
        resourceType: 'calendar-event',
        status: 'cancelled',
      }];
    }
    if (event?.start?.date || event?.end?.date) return [];
    if (event?.transparency === 'transparent' || declinedBySelf(event)) return [];
    const start = localTime(event?.start?.dateTime);
    const end = localTime(event?.end?.dateTime);
    if (!start || !end) return [];

    const title = compactWhitespace(event?.summary) || 'Busy';
    const location = compactWhitespace(event?.location);
    const description = calendarDescriptionText(event?.description);
    return [{
      key,
      calendarId,
      eventId: event.id,
      resourceType: 'calendar-event',
      status: event?.status || 'confirmed',
      parentString: `${start}–${end} ${title}${sourceSuffix()}`,
      sourceString: sourceString(calendar, event),
      detailStrings: [location, description].filter(Boolean),
      details: { location, description },
      updated: event?.updated || '',
    }];
  });
}

function taskSourceString(taskList, task) {
  const segments = [
    'Google Tasks',
    compactWhitespace(taskList?.title || taskList?.id || 'Tasks'),
  ];
  const openUrl = safeHttpUrl(task?.webViewLink);
  if (openUrl) segments.push(`[Open](${openUrl})`);
  return segments.join(' · ');
}

function normalizedTaskDuration(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 15;
}

/**
 * Convert dated Google Tasks into Nautilus flexible task rows. Google Tasks
 * exposes a date-only due value, not a reliable scheduled interval, so these
 * rows deliberately use Nautilus's configured default estimate.
 */
export function normalizeGoogleTasks({
  taskList = {},
  tasks = [],
  date = '',
  defaultDuration = 15,
} = {}) {
  const taskListId = String(taskList?.id || 'default');
  const selectedDate = String(date || '').slice(0, 10);
  const duration = normalizedTaskDuration(defaultDuration);

  return (Array.isArray(tasks) ? tasks : []).flatMap((task) => {
    if (!task?.id) return [];
    const key = googleTaskKey(taskListId, task);
    if (task?.deleted === true) {
      return [{
        key,
        taskListId,
        taskId: task.id,
        resourceType: 'google-task',
        status: 'cancelled',
      }];
    }

    const dueDate = String(task?.due || '').slice(0, 10);
    if (!selectedDate || dueDate !== selectedDate) return [];
    if (task?.status !== 'needsAction' && task?.status !== 'completed') return [];

    const completed = task.status === 'completed';
    const title = compactWhitespace(task?.title) || 'Untitled task';
    const notes = calendarDescriptionText(task?.notes);
    const completedAt = completed && localDateKey(task?.completed) === selectedDate
      ? localTime(task.completed)
      : '';
    const completionToken = completedAt ? ` d${completedAt}` : '';
    const marker = completed ? '{{[[DONE]]}}' : '{{[[TODO]]}}';

    return [{
      key,
      taskListId,
      taskId: task.id,
      resourceType: 'google-task',
      status: completed ? 'completed' : 'needsAction',
      parentString: `${marker} ${title} ${duration}m${completionToken}${sourceSuffix()}`,
      sourceString: taskSourceString(taskList, task),
      detailStrings: [notes].filter(Boolean),
      details: { location: '', description: notes },
      dueDate,
      completed: task?.completed || '',
      updated: task?.updated || '',
    }];
  });
}

/**
 * Decide whether a Google-owned string can be updated without surprising the
 * user. Only an unchanged last import is writable during normal sync. Option
 * refresh deliberately overwrites that managed string, never user siblings.
 */
export function decideCalendarManagedChange({
  lastSynced = '',
  current = '',
  incoming = '',
  force = false,
} = {}) {
  const existing = String(current ?? '');
  const next = String(incoming ?? '');
  if (force === true || existing === String(lastSynced ?? '')) {
    if (existing === next) return { action: 'unchanged', value: existing };
    return { action: next ? 'update' : 'delete', value: next };
  }
  return { action: 'keep-local', value: existing };
}

export { GOOGLE_CALENDAR_SOURCE_SUFFIX, MAX_DESCRIPTION_LENGTH };
