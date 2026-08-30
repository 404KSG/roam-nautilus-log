import { createPersistentGoogleAuthClient } from './calendar-auth';

const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const GOOGLE_TASKS_API = 'https://tasks.googleapis.com/tasks/v1';
const TRANSIENT_GOOGLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const DEFAULT_RETRY_DELAYS = [250, 750];
const MAX_RETRY_AFTER_MS = 2000;

export function parseGoogleCalendarIds(value) {
  const ids = String(value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return [...new Set(ids.length ? ids : ['primary'])];
}

function apiErrorMessage(payload, response, service = 'Google Calendar') {
  return payload?.error?.message
    || payload?.error_description
    || `${service} request failed (${response?.status || 'unknown'}).`;
}

function taskDayBounds(date) {
  const day = String(date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('Google Tasks requires a valid date.');
  return {
    dueMin: `${day}T00:00:00.000Z`,
    dueMax: `${day}T23:59:59.999Z`,
  };
}

function retryAfterMs(response, now = Date.now()) {
  const value = String(response?.headers?.get?.('Retry-After') || '').trim();
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(MAX_RETRY_AFTER_MS, seconds * 1000);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, timestamp - now));
}

function syncCancelled(error, signal) {
  return signal?.aborted === true || error?.name === 'AbortError';
}

export function createGoogleCalendarClient({
  authClient,
  authClientFactory = createPersistentGoogleAuthClient,
  authOptions = {},
  fetchImpl = typeof fetch === 'function' ? fetch.bind(globalThis) : null,
  sleepImpl = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  randomImpl = Math.random,
  retryDelays = DEFAULT_RETRY_DELAYS,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('Google Calendar requires the Fetch API.');
  const authorization = authClient || authClientFactory(authOptions);
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let destroyed = false;

  const fetchJson = async (url, refreshOnUnauthorized = true, service = 'Google Calendar') => {
    if (destroyed) throw new Error('Google Calendar sync was cancelled.');
    let accessToken = await authorization.authorize({ interactive: true });
    if (!accessToken) throw new Error('Google Calendar must be connected.');
    let refreshedOnce = false;
    let retryIndex = 0;
    const boundedDelays = Array.isArray(retryDelays) ? retryDelays.slice(0, 2) : DEFAULT_RETRY_DELAYS;

    while (true) {
      let response;
      try {
        response = await fetchImpl(url, {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: controller?.signal,
        });
      } catch (error) {
        if (destroyed || syncCancelled(error, controller?.signal)) {
          throw new Error('Google Calendar sync was cancelled.');
        }
        if (retryIndex >= boundedDelays.length) throw error;
        const baseDelay = Math.max(0, Number(boundedDelays[retryIndex]) || 0);
        retryIndex += 1;
        const jitter = 0.8 + (Math.max(0, Math.min(1, Number(randomImpl()) || 0)) * 0.4);
        await sleepImpl(Math.round(baseDelay * jitter));
        continue;
      }

      if (response.status === 401 && refreshOnUnauthorized && !refreshedOnce) {
        refreshedOnce = true;
        authorization.invalidateAccessToken?.();
        let refreshed = await authorization.authorize({ interactive: false });
        if (!refreshed) refreshed = await authorization.authorize({ interactive: true });
        if (refreshed) {
          accessToken = refreshed;
          continue;
        }
      }

      if (TRANSIENT_GOOGLE_STATUSES.has(response.status) && retryIndex < boundedDelays.length) {
        const configured = Math.max(0, Number(boundedDelays[retryIndex]) || 0);
        retryIndex += 1;
        const requested = retryAfterMs(response);
        const baseDelay = requested === null ? configured : requested;
        const jitter = requested === null
          ? 0.8 + (Math.max(0, Math.min(1, Number(randomImpl()) || 0)) * 0.4)
          : 1;
        await sleepImpl(Math.round(baseDelay * jitter));
        continue;
      }

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(apiErrorMessage(payload, response, service));
      return payload;
    }
  };

  const listCalendarEntries = async () => {
    const items = [];
    let pageToken = '';
    do {
      const url = new URL(`${GOOGLE_CALENDAR_API}/users/me/calendarList`);
      url.searchParams.set('minAccessRole', 'reader');
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const payload = await fetchJson(url.href);
      items.push(...(Array.isArray(payload.items) ? payload.items : []));
      pageToken = payload.nextPageToken || '';
    } while (pageToken);
    return items;
  };

  const listEvents = async ({ calendarId, timeMin, timeMax }) => {
    const items = [];
    let pageToken = '';
    do {
      const url = new URL(
        `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`,
      );
      url.searchParams.set('timeMin', timeMin);
      url.searchParams.set('timeMax', timeMax);
      url.searchParams.set('singleEvents', 'true');
      url.searchParams.set('showDeleted', 'true');
      url.searchParams.set('maxResults', '2500');
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const payload = await fetchJson(url.href);
      items.push(...(Array.isArray(payload.items) ? payload.items : []));
      pageToken = payload.nextPageToken || '';
    } while (pageToken);
    return items;
  };

  const listTaskLists = async () => {
    const items = [];
    let pageToken = '';
    do {
      const url = new URL(`${GOOGLE_TASKS_API}/users/@me/lists`);
      url.searchParams.set('maxResults', '100');
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const payload = await fetchJson(url.href, true, 'Google Tasks');
      items.push(...(Array.isArray(payload.items) ? payload.items : []));
      pageToken = payload.nextPageToken || '';
    } while (pageToken);
    return items;
  };

  const listTaskPages = async ({ taskListId, configureQuery }) => {
    const items = [];
    let pageToken = '';
    do {
      const url = new URL(
        `${GOOGLE_TASKS_API}/lists/${encodeURIComponent(taskListId)}/tasks`,
      );
      url.searchParams.set('showAssigned', 'true');
      url.searchParams.set('maxResults', '100');
      configureQuery(url.searchParams);
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const payload = await fetchJson(url.href, true, 'Google Tasks');
      items.push(...(Array.isArray(payload.items) ? payload.items : []));
      pageToken = payload.nextPageToken || '';
    } while (pageToken);
    return items;
  };

  const listTasks = async ({ taskListId, date }) => {
    const { dueMin, dueMax } = taskDayBounds(date);
    // Google Calendar can schedule a Google Task at a concrete local time,
    // while the public Tasks API exposes only its date. Applying dueMin /
    // dueMax before reading the task can therefore omit otherwise valid
    // scheduled tasks. Read active tasks without that server-side date gate,
    // then let normalizeGoogleTasks keep only the selected local date.
    const [activeTasks, datedLifecycleTasks] = await Promise.all([
      listTaskPages({
        taskListId,
        configureQuery: (query) => {
          query.set('showCompleted', 'false');
          query.set('showDeleted', 'false');
          query.set('showHidden', 'false');
        },
      }),
      listTaskPages({
        taskListId,
        configureQuery: (query) => {
          query.set('dueMin', dueMin);
          query.set('dueMax', dueMax);
          query.set('showCompleted', 'true');
          query.set('showDeleted', 'true');
          query.set('showHidden', 'true');
        },
      }),
    ]);
    const byId = new Map();
    for (const task of [...activeTasks, ...datedLifecycleTasks]) {
      if (task?.id) byId.set(task.id, task);
    }
    return [...byId.values()];
  };

  const readRange = async ({ calendarIds, timeMin, timeMax } = {}) => {
    const selectedIds = parseGoogleCalendarIds(calendarIds);
    const entries = await listCalendarEntries();
    const primary = entries.find((entry) => entry?.primary === true);
    const results = [];
    for (const calendarId of selectedIds) {
      const entry = calendarId === 'primary'
        ? primary
        : entries.find((candidate) => candidate?.id === calendarId);
      const events = await listEvents({ calendarId, timeMin, timeMax });
      results.push({
        calendar: {
          id: calendarId,
          summary: entry?.summaryOverride || entry?.summary || entry?.id || calendarId,
          accountHint: primary?.id || '',
        },
        events,
      });
    }
    return results;
  };

  const readTasks = async ({ date } = {}) => {
    const taskLists = await listTaskLists();
    const results = [];
    for (const taskList of taskLists) {
      if (!taskList?.id) continue;
      const tasks = await listTasks({ taskListId: taskList.id, date });
      results.push({
        taskList: {
          id: taskList.id,
          title: taskList.title || taskList.id,
        },
        tasks,
      });
    }
    return results;
  };

  const destroy = () => {
    destroyed = true;
    controller?.abort();
    authorization.destroy?.();
  };

  const cancelSync = () => {
    controller?.abort();
  };

  return {
    prepare: authorization.prepare,
    prepareIdentity: authorization.prepareIdentity,
    authorize: authorization.authorize,
    disconnect: authorization.disconnect,
    hasConnection: authorization.hasConnection,
    readRange,
    readTasks,
    cancelSync,
    destroy,
  };
}
