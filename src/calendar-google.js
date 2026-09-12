import { createPersistentGoogleAuthClient } from './calendar-auth';
import {
  createGoogleReadError,
  GOOGLE_READ_REASONS,
} from './calendar-read-error';

const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const GOOGLE_TASKS_API = 'https://tasks.googleapis.com/tasks/v1';
const TRANSIENT_GOOGLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const DEFAULT_RETRY_DELAYS = [250, 750];
const MAX_RETRY_AFTER_MS = 2000;
const DEFAULT_MAX_CONCURRENCY = 3;
const MAX_CONCURRENCY_CAP = 8;
const DEFAULT_METADATA_TTL_MS = 15_000;
const DEFAULT_MAX_PAGES = 50;
const DEFAULT_MAX_ITEMS = 20_000;

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

function boundedPositive(value, fallback, cap) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(cap, Math.floor(parsed));
}

function cancelledError() {
  return createGoogleReadError({
    reason: GOOGLE_READ_REASONS.cancelled,
    message: 'Google Calendar sync was cancelled.',
  });
}

function createLimiter(maxConcurrency) {
  let active = 0;
  let peak = 0;
  let started = 0;
  const waiting = [];

  const tryAcquire = (isCurrent) => {
    if (!isCurrent()) return false;
    if (active >= maxConcurrency) return false;
    active += 1;
    started += 1;
    if (active > peak) peak = active;
    return true;
  };

  const acquire = (isCurrent) => {
    if (!isCurrent()) return Promise.reject(cancelledError());
    if (tryAcquire(isCurrent)) return null;
    return new Promise((resolve, reject) => {
      waiting.push(() => {
        if (!isCurrent()) {
          reject(cancelledError());
          return true;
        }
        if (tryAcquire(isCurrent)) {
          resolve();
          return true;
        }
        return false;
      });
    });
  };

  const release = () => {
    active = Math.max(0, active - 1);
    while (waiting.length) {
      const next = waiting.shift();
      if (next()) break;
    }
  };

  const rejectWaiting = () => {
    const pending = waiting.splice(0, waiting.length);
    for (const tryStart of pending) tryStart();
  };

  return {
    acquire,
    release,
    rejectWaiting,
    stats: () => ({ peakConcurrency: peak, startedFetches: started, active }),
  };
}

export function createGoogleCalendarClient({
  authClient,
  authClientFactory = createPersistentGoogleAuthClient,
  authOptions = {},
  fetchImpl = typeof fetch === 'function' ? fetch.bind(globalThis) : null,
  sleepImpl = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  randomImpl = Math.random,
  retryDelays = DEFAULT_RETRY_DELAYS,
  nowImpl = Date.now,
  metadataTtlMs = DEFAULT_METADATA_TTL_MS,
  maxConcurrency = DEFAULT_MAX_CONCURRENCY,
  maxPages = DEFAULT_MAX_PAGES,
  maxItems = DEFAULT_MAX_ITEMS,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('Google Calendar requires the Fetch API.');
  const authorization = authClient || authClientFactory(authOptions);
  const limiter = createLimiter(boundedPositive(maxConcurrency, DEFAULT_MAX_CONCURRENCY, MAX_CONCURRENCY_CAP));
  const pageBudget = boundedPositive(maxPages, DEFAULT_MAX_PAGES, 1_000);
  const itemBudget = boundedPositive(maxItems, DEFAULT_MAX_ITEMS, 100_000);
  const ttlMs = Number(metadataTtlMs);
  const cacheTtlMs = Number.isFinite(ttlMs) && ttlMs >= 0 ? ttlMs : DEFAULT_METADATA_TTL_MS;
  const clock = typeof nowImpl === 'function' ? nowImpl : Date.now;
  let operationController = typeof AbortController === 'function' ? new AbortController() : null;
  let operationGeneration = 0;
  let destroyed = false;
  const metadataCache = {
    calendarList: null,
    taskLists: null,
  };

  const isCurrent = (generation) => (
    !destroyed
    && operationGeneration === generation
    && operationController?.signal?.aborted !== true
  );

  const assertRunnable = (generation) => {
    if (!isCurrent(generation)) throw cancelledError();
  };

  const beginOperation = () => {
    if (destroyed) throw cancelledError();
    if (!operationController || operationController.signal.aborted) {
      operationController = typeof AbortController === 'function' ? new AbortController() : null;
    }
    return Object.freeze({
      generation: operationGeneration,
      controller: operationController,
    });
  };

  const invalidateMetadata = () => {
    metadataCache.calendarList = null;
    metadataCache.taskLists = null;
  };

  const connectionCacheKey = () => {
    const loader = typeof authOptions.loadConnection === 'function'
      ? authOptions.loadConnection
      : null;
    if (!loader) return null;
    let connection;
    try {
      connection = loader();
    } catch (_error) {
      return null;
    }
    const id = String(connection?.id || '').trim();
    if (!id) return null;
    const version = Number(connection.version) >= 2 ? 2 : 1;
    return `${version}:${id}:${GOOGLE_CALENDAR_API}:${GOOGLE_TASKS_API}`;
  };

  const getCached = (slot, key = connectionCacheKey()) => {
    if (!key) return null;
    const entry = metadataCache[slot];
    if (!entry || entry.key !== key) return null;
    const now = Number(clock());
    if (!Number.isFinite(now) || now - entry.at > cacheTtlMs) return null;
    return entry.items;
  };

  const setCached = (slot, items, fetchKey) => {
    // Bind the write to the identity captured before the fetch. A connection
    // swap must not store that payload under the new key; a missing key skips
    // caching so first authorize / no-connection reads still succeed.
    if (!fetchKey) return;
    const key = connectionCacheKey();
    if (!key || key !== fetchKey) return;
    metadataCache[slot] = { key: fetchKey, at: Number(clock()) || 0, items };
  };

  const fetchJson = async (url, refreshOnUnauthorized = true, service = 'Google Calendar', operation) => {
    const generation = operation.generation;
    const signal = operation.controller?.signal;
    assertRunnable(generation);
    let accessToken = await authorization.authorize({ interactive: true });
    assertRunnable(generation);
    if (!accessToken) throw new Error('Google Calendar must be connected.');
    let refreshedOnce = false;
    let retryIndex = 0;
    const boundedDelays = Array.isArray(retryDelays) ? retryDelays.slice(0, 2) : DEFAULT_RETRY_DELAYS;

    while (true) {
      assertRunnable(generation);
      let response;
      let held = false;
      try {
        const pendingSlot = limiter.acquire(() => isCurrent(generation));
        if (pendingSlot) await pendingSlot;
        held = true;
        assertRunnable(generation);
        response = await fetchImpl(url, {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal,
        });
      } catch (error) {
        if (held) {
          limiter.release();
          held = false;
        }
        if (destroyed || operationGeneration !== generation || syncCancelled(error, signal)) {
          throw cancelledError();
        }
        if (retryIndex >= boundedDelays.length) throw error;
        const baseDelay = Math.max(0, Number(boundedDelays[retryIndex]) || 0);
        retryIndex += 1;
        const jitter = 0.8 + (Math.max(0, Math.min(1, Number(randomImpl()) || 0)) * 0.4);
        await sleepImpl(Math.round(baseDelay * jitter));
        assertRunnable(generation);
        continue;
      } finally {
        if (held) limiter.release();
      }

      assertRunnable(generation);

      if (response.status === 401 && refreshOnUnauthorized && !refreshedOnce) {
        invalidateMetadata();
        refreshedOnce = true;
        authorization.invalidateAccessToken?.();
        let refreshed = await authorization.authorize({ interactive: false });
        assertRunnable(generation);
        if (!refreshed) refreshed = await authorization.authorize({ interactive: true });
        assertRunnable(generation);
        if (refreshed) {
          accessToken = refreshed;
          continue;
        }
      }

      if (TRANSIENT_GOOGLE_STATUSES.has(response.status) && retryIndex < boundedDelays.length) {
        const configured = Math.max(0, Number(boundedDelays[retryIndex]) || 0);
        retryIndex += 1;
        const requested = retryAfterMs(response, Number(clock()) || Date.now());
        const baseDelay = requested === null ? configured : requested;
        const jitter = requested === null
          ? 0.8 + (Math.max(0, Math.min(1, Number(randomImpl()) || 0)) * 0.4)
          : 1;
        await sleepImpl(Math.round(baseDelay * jitter));
        assertRunnable(generation);
        continue;
      }

      const payload = await response.json().catch(() => ({}));
      assertRunnable(generation);
      if (!response.ok) throw new Error(apiErrorMessage(payload, response, service));
      return payload;
    }
  };

  const paginate = async ({ service, buildUrl, calendarId, taskListId, operation }) => {
    const items = [];
    const seenTokens = new Set();
    let pageToken = '';
    let pages = 0;
    while (true) {
      assertRunnable(operation.generation);
      pages += 1;
      if (pages > pageBudget) {
        throw createGoogleReadError({
          reason: GOOGLE_READ_REASONS.pageBudget,
          service,
          context: { pages, items: items.length, calendarId, taskListId },
        });
      }
      const payload = await fetchJson(buildUrl(pageToken), true, service, operation);
      assertRunnable(operation.generation);
      const batch = Array.isArray(payload.items) ? payload.items : [];
      if (items.length + batch.length > itemBudget) {
        throw createGoogleReadError({
          reason: GOOGLE_READ_REASONS.itemBudget,
          service,
          context: { pages, items: items.length + batch.length, calendarId, taskListId },
        });
      }
      items.push(...batch);
      const next = String(payload.nextPageToken || '');
      if (!next) return items;
      if (next === pageToken || seenTokens.has(next)) {
        throw createGoogleReadError({
          reason: GOOGLE_READ_REASONS.repeatedPageToken,
          service,
          context: { pages, items: items.length, calendarId, taskListId },
        });
      }
      seenTokens.add(next);
      pageToken = next;
    }
  };

  const listCalendarEntries = async (operation) => {
    assertRunnable(operation.generation);
    const fetchKey = connectionCacheKey();
    const cached = getCached('calendarList', fetchKey);
    if (cached) return cached;
    const items = await paginate({
      service: 'Google Calendar',
      operation,
      buildUrl: (pageToken) => {
        const url = new URL(`${GOOGLE_CALENDAR_API}/users/me/calendarList`);
        url.searchParams.set('minAccessRole', 'reader');
        if (pageToken) url.searchParams.set('pageToken', pageToken);
        return url.href;
      },
    });
    assertRunnable(operation.generation);
    setCached('calendarList', items, fetchKey);
    return items;
  };

  const listEvents = async ({ calendarId, timeMin, timeMax, operation }) => paginate({
    service: 'Google Calendar',
    calendarId,
    operation,
    buildUrl: (pageToken) => {
      const url = new URL(
        `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`,
      );
      url.searchParams.set('timeMin', timeMin);
      url.searchParams.set('timeMax', timeMax);
      url.searchParams.set('singleEvents', 'true');
      url.searchParams.set('showDeleted', 'true');
      url.searchParams.set('maxResults', '2500');
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      return url.href;
    },
  });

  const listTaskLists = async (operation) => {
    assertRunnable(operation.generation);
    const fetchKey = connectionCacheKey();
    const cached = getCached('taskLists', fetchKey);
    if (cached) return cached;
    const items = await paginate({
      service: 'Google Tasks',
      operation,
      buildUrl: (pageToken) => {
        const url = new URL(`${GOOGLE_TASKS_API}/users/@me/lists`);
        url.searchParams.set('maxResults', '100');
        if (pageToken) url.searchParams.set('pageToken', pageToken);
        return url.href;
      },
    });
    assertRunnable(operation.generation);
    setCached('taskLists', items, fetchKey);
    return items;
  };

  const listTaskPages = async ({ taskListId, configureQuery, operation }) => paginate({
    service: 'Google Tasks',
    taskListId,
    operation,
    buildUrl: (pageToken) => {
      const url = new URL(
        `${GOOGLE_TASKS_API}/lists/${encodeURIComponent(taskListId)}/tasks`,
      );
      url.searchParams.set('showAssigned', 'true');
      url.searchParams.set('maxResults', '100');
      configureQuery(url.searchParams);
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      return url.href;
    },
  });

  const listTasks = async ({ taskListId, date, operation }) => {
    const { dueMin, dueMax } = taskDayBounds(date);
    // Google Calendar can schedule a Google Task at a concrete local time,
    // while the public Tasks API exposes only its date. Applying dueMin /
    // dueMax before reading the task can therefore omit otherwise valid
    // scheduled tasks. Read active tasks without that server-side date gate,
    // then let normalizeGoogleTasks keep only the selected local date.
    const [activeTasks, datedLifecycleTasks] = await Promise.all([
      listTaskPages({
        taskListId,
        operation,
        configureQuery: (query) => {
          query.set('showCompleted', 'false');
          query.set('showDeleted', 'false');
          query.set('showHidden', 'false');
        },
      }),
      listTaskPages({
        taskListId,
        operation,
        configureQuery: (query) => {
          query.set('dueMin', dueMin);
          query.set('dueMax', dueMax);
          query.set('showCompleted', 'true');
          query.set('showDeleted', 'true');
          query.set('showHidden', 'true');
        },
      }),
    ]);
    assertRunnable(operation.generation);
    const byId = new Map();
    for (const task of [...activeTasks, ...datedLifecycleTasks]) {
      if (task?.id) byId.set(task.id, task);
    }
    return [...byId.values()];
  };

  const readRange = async ({ calendarIds, timeMin, timeMax } = {}) => {
    const operation = beginOperation();
    const selectedIds = parseGoogleCalendarIds(calendarIds);
    const entries = await listCalendarEntries(operation);
    assertRunnable(operation.generation);
    const primary = entries.find((entry) => entry?.primary === true);
    return Promise.all(selectedIds.map(async (calendarId) => {
      assertRunnable(operation.generation);
      const entry = calendarId === 'primary'
        ? primary
        : entries.find((candidate) => candidate?.id === calendarId);
      const events = await listEvents({ calendarId, timeMin, timeMax, operation });
      assertRunnable(operation.generation);
      return {
        calendar: {
          id: calendarId,
          summary: entry?.summaryOverride || entry?.summary || entry?.id || calendarId,
          accountHint: primary?.id || '',
        },
        events,
      };
    }));
  };

  const readTasks = async ({ date } = {}) => {
    const operation = beginOperation();
    const taskLists = await listTaskLists(operation);
    assertRunnable(operation.generation);
    return Promise.all(taskLists.filter((taskList) => taskList?.id).map(async (taskList) => {
      assertRunnable(operation.generation);
      const tasks = await listTasks({ taskListId: taskList.id, date, operation });
      assertRunnable(operation.generation);
      return {
        taskList: {
          id: taskList.id,
          title: taskList.title || taskList.id,
        },
        tasks,
      };
    }));
  };

  const destroy = () => {
    destroyed = true;
    operationGeneration += 1;
    operationController?.abort();
    limiter.rejectWaiting();
    invalidateMetadata();
    authorization.destroy?.();
  };

  const cancelSync = () => {
    operationGeneration += 1;
    operationController?.abort();
    limiter.rejectWaiting();
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
    getNetworkStats: () => limiter.stats(),
  };
}
