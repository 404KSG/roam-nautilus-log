import { createPersistentGoogleAuthClient } from './calendar-auth';

const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

export function parseGoogleCalendarIds(value) {
  const ids = String(value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return [...new Set(ids.length ? ids : ['primary'])];
}

function apiErrorMessage(payload, response) {
  return payload?.error?.message
    || payload?.error_description
    || `Google Calendar request failed (${response?.status || 'unknown'}).`;
}

export function createGoogleCalendarClient({
  authClient,
  authClientFactory = createPersistentGoogleAuthClient,
  authOptions = {},
  fetchImpl = typeof fetch === 'function' ? fetch.bind(globalThis) : null,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('Google Calendar requires the Fetch API.');
  const authorization = authClient || authClientFactory(authOptions);
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let destroyed = false;

  const fetchJson = async (url, retry = true) => {
    if (destroyed) throw new Error('Google Calendar sync was cancelled.');
    const accessToken = await authorization.authorize({ interactive: true });
    if (!accessToken) throw new Error('Google Calendar must be connected.');
    let response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller?.signal,
    });
    if (response.status === 401 && retry) {
      authorization.invalidateAccessToken?.();
      let refreshed = await authorization.authorize({ interactive: false });
      if (!refreshed) refreshed = await authorization.authorize({ interactive: true });
      if (refreshed) {
        response = await fetchImpl(url, {
          headers: { Authorization: `Bearer ${refreshed}` },
          signal: controller?.signal,
        });
      }
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(apiErrorMessage(payload, response));
    return payload;
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
        },
        events,
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
    cancelSync,
    destroy,
  };
}
