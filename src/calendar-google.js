const GOOGLE_IDENTITY_SCRIPT_ID = 'nautilus-log-google-identity-services';
const GOOGLE_IDENTITY_SCRIPT_URL = 'https://accounts.google.com/gsi/client';
const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const GOOGLE_CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events.readonly',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
].join(' ');

export function parseGoogleCalendarIds(value) {
  const ids = String(value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return [...new Set(ids.length ? ids : ['primary'])];
}

export async function loadGoogleIdentityServices() {
  if (typeof window === 'undefined') throw new Error('Google Calendar requires a browser window.');
  if (window.google?.accounts?.oauth2) return window.google.accounts.oauth2;
  if (typeof document === 'undefined') throw new Error('Google Calendar requires a browser document.');

  const existing = document.getElementById(GOOGLE_IDENTITY_SCRIPT_ID);
  return new Promise((resolve, reject) => {
    const finish = () => {
      const oauth2 = window.google?.accounts?.oauth2;
      if (oauth2) resolve(oauth2);
      else reject(new Error('Google Identity Services did not become available.'));
    };
    const fail = () => reject(new Error('Google Identity Services could not be loaded.'));
    if (existing) {
      existing.addEventListener('load', finish, { once: true });
      existing.addEventListener('error', fail, { once: true });
      return;
    }
    const script = document.createElement('script');
    script.id = GOOGLE_IDENTITY_SCRIPT_ID;
    script.src = GOOGLE_IDENTITY_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.addEventListener('load', finish, { once: true });
    script.addEventListener('error', fail, { once: true });
    document.head.appendChild(script);
  });
}

function apiErrorMessage(payload, response) {
  return payload?.error?.message
    || payload?.error_description
    || `Google Calendar request failed (${response?.status || 'unknown'}).`;
}

export function createGoogleCalendarClient({
  clientId,
  loadIdentity = loadGoogleIdentityServices,
  fetchImpl = typeof fetch === 'function' ? fetch.bind(globalThis) : null,
  now = Date.now,
} = {}) {
  if (!String(clientId ?? '').trim()) throw new Error('A Google OAuth Client ID is required.');
  if (typeof fetchImpl !== 'function') throw new Error('Google Calendar requires the Fetch API.');

  let token = '';
  let expiresAt = 0;
  let tokenClient = null;
  let tokenRequest = null;

  const hasUsableToken = () => token && Number(now()) < expiresAt - 30_000;

  const authorize = async () => {
    if (hasUsableToken()) return token;
    if (tokenRequest) return tokenRequest;
    tokenRequest = (async () => {
      const oauth2 = await loadIdentity();
      if (!tokenClient) {
        let settle = null;
        tokenClient = oauth2.initTokenClient({
          client_id: String(clientId).trim(),
          scope: GOOGLE_CALENDAR_SCOPES,
          callback: (response) => settle?.(response),
          error_callback: (error) => settle?.({ error: error?.type || 'popup_failed_to_open' }),
        });
        tokenClient.__nautilusSettle = (callback) => { settle = callback; };
      }
      return new Promise((resolve, reject) => {
        tokenClient.__nautilusSettle((response) => {
          tokenClient.__nautilusSettle(null);
          if (!response?.access_token) {
            reject(new Error(response?.error_description || response?.error || 'Google authorization was cancelled.'));
            return;
          }
          token = response.access_token;
          expiresAt = Number(now()) + Math.max(0, Number(response.expires_in) || 0) * 1000;
          resolve(token);
        });
        tokenClient.requestAccessToken({ prompt: '' });
      });
    })();
    try {
      return await tokenRequest;
    } finally {
      tokenRequest = null;
    }
  };

  const fetchJson = async (url) => {
    const accessToken = await authorize();
    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) {
        token = '';
        expiresAt = 0;
      }
      throw new Error(apiErrorMessage(payload, response));
    }
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
    token = '';
    expiresAt = 0;
    tokenRequest = null;
    tokenClient = null;
  };

  return { authorize, readRange, destroy };
}

export { GOOGLE_CALENDAR_SCOPES };
