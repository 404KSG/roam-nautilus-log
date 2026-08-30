import {
  normalizeGoogleCalendarEvents,
  normalizeGoogleTasks,
} from './calendar-core';
import {
  createGoogleCalendarClient,
  parseGoogleCalendarIds,
} from './calendar-google';
import {
  GOOGLE_AUTH_SERVICE_URL,
  parseCalendarConnection,
} from './calendar-auth';
import { createCalendarReconciler } from './calendar-reconcile';

const SYNC_STATE_KEY = 'google-calendar-sync-state';
const CONNECTION_KEY = 'google-calendar-connection';

function parseSyncState(value) {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string' || !value.trim()) return { version: 1, events: {} };
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : { version: 1, events: {} };
  } catch (_error) {
    return { version: 1, events: {} };
  }
}

function defaultPageTitleToDate(pageTitle) {
  return window.roamAlphaAPI?.util?.pageTitleToDate?.(pageTitle);
}

function localDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('The Nautilus page date could not be resolved.');
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function planRange(value, { startHour = 5, endHour = 21 } = {}) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('The Nautilus page date could not be resolved.');
  const parsedStart = Number(startHour);
  const parsedEnd = Number(endHour);
  const safeStart = Number.isInteger(parsedStart) && parsedStart >= 0 && parsedStart <= 23
    ? parsedStart
    : 5;
  const safeEnd = Number.isInteger(parsedEnd) && parsedEnd >= 1 && parsedEnd <= 24
    ? parsedEnd
    : 21;
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), safeStart);
  const carryDay = safeEnd === 24 || safeEnd <= safeStart ? 1 : 0;
  const end = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + carryDay,
    safeEnd % 24,
  );
  return { timeMin: start.toISOString(), timeMax: end.toISOString() };
}

export function createCalendarRuntime({
  extensionAPI,
  pageTitleToDate = defaultPageTitleToDate,
  clientFactory = createGoogleCalendarClient,
  reconcilerFactory = createCalendarReconciler,
  authServiceUrl = GOOGLE_AUTH_SERVICE_URL,
  onConnectionChange = () => {},
} = {}) {
  if (!extensionAPI?.settings) throw new Error('Calendar sync requires the Roam extension settings API.');

  let client = null;
  let inFlight = false;
  let destroyed = false;
  let generation = 0;
  let lastConnectionState = Boolean(parseCalendarConnection(
    extensionAPI.settings.get(CONNECTION_KEY),
  ));

  const notifyConnection = (connected) => {
    const next = connected === true;
    if (next === lastConnectionState) return;
    lastConnectionState = next;
    onConnectionChange(next);
  };

  const reconciler = reconcilerFactory({
    loadState: () => parseSyncState(extensionAPI.settings.get(SYNC_STATE_KEY)),
    saveState: (state) => extensionAPI.settings.set(SYNC_STATE_KEY, JSON.stringify(state)),
  });

  const getClient = () => {
    if (client) return client;
    client = clientFactory({
      authOptions: {
        serviceUrl: authServiceUrl,
        loadConnection: () => parseCalendarConnection(extensionAPI.settings.get(CONNECTION_KEY)),
        saveConnection: async (connection) => {
          await extensionAPI.settings.set(CONNECTION_KEY, JSON.stringify(connection));
        },
        clearConnection: async () => {
          await extensionAPI.settings.set(CONNECTION_KEY, '');
        },
        onConnectionChange: notifyConnection,
      },
    });
    return client;
  };

  const prepare = async () => {
    if (destroyed || extensionAPI.settings.get('google-calendar-enabled') !== true) return false;
    if (!parseCalendarConnection(extensionAPI.settings.get(CONNECTION_KEY))) return false;
    return Boolean(await getClient().prepare?.());
  };

  const prepareIdentity = async () => {
    if (destroyed || extensionAPI.settings.get('google-calendar-enabled') !== true) return false;
    if (parseCalendarConnection(extensionAPI.settings.get(CONNECTION_KEY))) return true;
    await getClient().prepareIdentity?.();
    return true;
  };

  const hasConnection = () => Boolean(parseCalendarConnection(
    extensionAPI.settings.get(CONNECTION_KEY),
  ));

  const connect = async () => {
    if (destroyed) throw new Error('Google Calendar connection is no longer available.');
    await extensionAPI.settings.set('google-calendar-enabled', true);
    try {
      const accessToken = await getClient().authorize?.({ interactive: true });
      if (!accessToken || !hasConnection()) {
        throw new Error('Google Calendar did not return a persistent connection.');
      }
      notifyConnection(true);
      return true;
    } catch (error) {
      if (!hasConnection()) {
        await extensionAPI.settings.set('google-calendar-enabled', false);
        notifyConnection(false);
      }
      throw error;
    }
  };

  const syncPlan = async ({ planUid, pageTitle, force = false } = {}) => {
    if (destroyed) throw new Error('Google Calendar sync is no longer available.');
    if (extensionAPI.settings.get('google-calendar-enabled') !== true) {
      throw new Error('Google Calendar sync is not enabled in Nautilus Log settings.');
    }
    if (!planUid || !pageTitle) throw new Error('Calendar sync requires this Nautilus Plan and its Daily Note date.');
    if (inFlight) throw new Error('A Google Calendar sync is already in progress.');

    inFlight = true;
    const expectedGeneration = generation;
    try {
      const pageDate = pageTitleToDate(pageTitle);
      const range = planRange(pageDate, {
        startHour: extensionAPI.settings.get('workday-start'),
        endHour: extensionAPI.settings.get('workday-end'),
      });
      const date = localDateKey(pageDate);
      const calendarIds = parseGoogleCalendarIds(
        extensionAPI.settings.get('google-calendar-ids'),
      );
      const activeClient = getClient();
      const connection = parseCalendarConnection(extensionAPI.settings.get(CONNECTION_KEY));
      const tasksAuthorized = Number(connection?.version) >= 2;
      const [batches, taskOutcome] = await Promise.all([
        activeClient.readRange({ calendarIds, ...range }),
        tasksAuthorized && typeof activeClient.readTasks === 'function'
          ? activeClient.readTasks({ date })
            .then((value) => ({ value, error: null }))
            .catch((error) => ({ value: [], error }))
          : Promise.resolve({ value: [], error: null }),
      ]);
      if (destroyed || expectedGeneration !== generation) {
        throw new Error('Google Calendar sync was cancelled.');
      }
      const calendarEvents = (Array.isArray(batches) ? batches : []).flatMap((batch) => (
        normalizeGoogleCalendarEvents(batch)
      ));
      const taskBatches = taskOutcome.value;
      if (taskOutcome.error) {
        console.warn('[Nautilus Log] Google Tasks sync unavailable', taskOutcome.error);
      }
      const tasks = (Array.isArray(taskBatches) ? taskBatches : []).flatMap((batch) => (
        normalizeGoogleTasks({
          ...batch,
          date,
          defaultDuration: extensionAPI.settings.get('todo-duration'),
        })
      ));
      const items = [...calendarEvents, ...tasks];
      const result = await reconciler.sync({ planUid, events: items, force: force === true });
      if (destroyed || expectedGeneration !== generation) {
        throw new Error('Google Calendar sync was cancelled.');
      }
      const allDaySkipped = (Array.isArray(batches) ? batches : []).reduce(
        (total, batch) => total + (Array.isArray(batch?.events) ? batch.events : [])
          .filter((event) => event?.start?.date || event?.end?.date).length,
        0,
      );
      return {
        ...result,
        calendarEvents: calendarEvents.filter((item) => item.status !== 'cancelled').length,
        tasks: tasks.filter((item) => item.status !== 'cancelled').length,
        allDaySkipped,
        taskAccessPending: !tasksAuthorized,
        tasksUnavailable: Boolean(taskOutcome.error),
      };
    } finally {
      inFlight = false;
    }
  };

  const disconnect = async () => {
    if (!client && !parseCalendarConnection(extensionAPI.settings.get(CONNECTION_KEY))) {
      await extensionAPI.settings.set('google-calendar-enabled', false);
      notifyConnection(false);
      return true;
    }
    generation += 1;
    const activeClient = getClient();
    activeClient.cancelSync?.();
    try {
      const result = await activeClient.disconnect?.();
      activeClient.destroy?.();
      client = null;
      if (result === false) return false;
      await extensionAPI.settings.set('google-calendar-enabled', false);
      notifyConnection(false);
      return true;
    } catch (error) {
      activeClient.destroy?.();
      client = null;
      throw error;
    }
  };

  const reconnect = async () => {
    if (destroyed) throw new Error('Google Calendar connection is no longer available.');
    await disconnect();
    return connect();
  };

  const destroy = () => {
    destroyed = true;
    generation += 1;
    client?.destroy?.();
    client = null;
  };

  return {
    prepare,
    prepareIdentity,
    connect,
    reconnect,
    syncPlan,
    disconnect,
    hasConnection,
    destroy,
  };
}

export { CONNECTION_KEY, SYNC_STATE_KEY };
