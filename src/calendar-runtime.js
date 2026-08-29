import { normalizeGoogleCalendarEvents } from './calendar-core';
import { createGoogleCalendarClient, parseGoogleCalendarIds } from './calendar-google';
import { createCalendarReconciler } from './calendar-reconcile';

const SYNC_STATE_KEY = 'google-calendar-sync-state';

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

function dayRange(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('The Nautilus page date could not be resolved.');
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const end = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
  return { timeMin: start.toISOString(), timeMax: end.toISOString() };
}

export function createCalendarRuntime({
  extensionAPI,
  pageTitleToDate = defaultPageTitleToDate,
  clientFactory = createGoogleCalendarClient,
  reconcilerFactory = createCalendarReconciler,
} = {}) {
  if (!extensionAPI?.settings) throw new Error('Calendar sync requires the Roam extension settings API.');

  let client = null;
  let activeClientId = '';
  let inFlight = false;
  let destroyed = false;

  const reconciler = reconcilerFactory({
    loadState: () => parseSyncState(extensionAPI.settings.get(SYNC_STATE_KEY)),
    saveState: (state) => extensionAPI.settings.set(SYNC_STATE_KEY, JSON.stringify(state)),
  });

  const getClient = (clientId) => {
    if (client && activeClientId === clientId) return client;
    client?.destroy?.();
    client = clientFactory({ clientId });
    activeClientId = clientId;
    return client;
  };

  const syncPlan = async ({ planUid, pageTitle, force = false } = {}) => {
    if (destroyed) throw new Error('Google Calendar sync is no longer available.');
    if (extensionAPI.settings.get('google-calendar-enabled') !== true) {
      throw new Error('Google Calendar sync is not enabled in Nautilus Log settings.');
    }
    const clientId = String(extensionAPI.settings.get('google-oauth-client-id') || '').trim();
    if (!clientId) throw new Error('Add a Google OAuth Client ID in Nautilus Log settings first.');
    if (!planUid || !pageTitle) throw new Error('Calendar sync requires this Nautilus Plan and its Daily Note date.');
    if (inFlight) throw new Error('A Google Calendar sync is already in progress.');

    inFlight = true;
    try {
      const range = dayRange(pageTitleToDate(pageTitle));
      const calendarIds = parseGoogleCalendarIds(
        extensionAPI.settings.get('google-calendar-ids'),
      );
      const batches = await getClient(clientId).readRange({ calendarIds, ...range });
      const events = (Array.isArray(batches) ? batches : []).flatMap((batch) => (
        normalizeGoogleCalendarEvents(batch)
      ));
      return await reconciler.sync({ planUid, events, force: force === true });
    } finally {
      inFlight = false;
    }
  };

  const destroy = () => {
    destroyed = true;
    client?.destroy?.();
    client = null;
    activeClientId = '';
  };

  return { syncPlan, destroy };
}

export { SYNC_STATE_KEY };
