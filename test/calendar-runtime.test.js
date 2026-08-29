const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function loadExtension(label) {
  const bundle = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}#${label}-${Date.now()}`);
}

test('calendar id input is compact, unique, and defaults to primary', async () => {
  const extension = await loadExtension('calendar-ids');
  assert.deepEqual(extension.parseGoogleCalendarIds(' primary, team@example.com,primary ,, '), [
    'primary',
    'team@example.com',
  ]);
  assert.deepEqual(extension.parseGoogleCalendarIds(''), ['primary']);
  assert.equal(extension.isGoogleOAuthClientId('123-abc.apps.googleusercontent.com'), true);
  assert.equal(extension.isGoogleOAuthClientId('not-a-client-id'), false);
});

test('Google client requests a memory-only token and follows event pagination', async () => {
  const extension = await loadExtension('calendar-google-client');
  const requests = [];
  const tokenRequests = [];
  const loadIdentity = async () => ({
    initTokenClient: ({ client_id, scope, callback }) => ({
      requestAccessToken: (options) => {
        tokenRequests.push({ client_id, scope, options });
        callback({ access_token: 'memory-token', expires_in: 3600 });
      },
    }),
  });
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/users/me/calendarList')) {
      return {
        ok: true,
        json: async () => ({ items: [{ id: 'me@example.com', primary: true, summary: 'Work' }] }),
      };
    }
    if (parsed.searchParams.get('pageToken') === 'next-page') {
      return { ok: true, json: async () => ({ items: [{ id: 'event-2' }] }) };
    }
    return {
      ok: true,
      json: async () => ({ items: [{ id: 'event-1' }], nextPageToken: 'next-page' }),
    };
  };
  const client = extension.createGoogleCalendarClient({
    clientId: 'client-id.apps.googleusercontent.com',
    loadIdentity,
    fetchImpl,
    now: () => 1_000,
  });

  const rows = await client.readRange({
    calendarIds: ['primary'],
    timeMin: '2026-08-30T00:00:00.000Z',
    timeMax: '2026-08-31T00:00:00.000Z',
  });

  assert.equal(tokenRequests.length, 1);
  assert.match(tokenRequests[0].scope, /calendar\.events\.readonly/);
  assert.match(tokenRequests[0].scope, /calendar\.calendarlist\.readonly/);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].calendar.summary, 'Work');
  assert.deepEqual(rows[0].events.map((event) => event.id), ['event-1', 'event-2']);
  assert.equal(requests.length, 3);
  assert.equal(requests[0].options.headers.Authorization, 'Bearer memory-token');
  const eventRequest = new URL(requests[1].url);
  assert.equal(eventRequest.searchParams.get('singleEvents'), 'true');
  assert.equal(eventRequest.searchParams.get('showDeleted'), 'true');
  assert.equal(eventRequest.searchParams.get('timeMin'), '2026-08-30T00:00:00.000Z');
});

test('calendar runtime syncs only the explicitly clicked Nautilus date and plan', async () => {
  const extension = await loadExtension('calendar-runtime');
  const settings = new Map([
    ['google-calendar-enabled', true],
    ['google-oauth-client-id', 'client-id.apps.googleusercontent.com'],
    ['google-calendar-ids', 'primary,team@example.com'],
    ['google-calendar-sync-state', JSON.stringify({ version: 1, events: {} })],
    ['workday-start', 21],
    ['workday-end', 2],
  ]);
  const clientCalls = [];
  const reconcileCalls = [];
  const runtime = extension.createCalendarRuntime({
    extensionAPI: {
      settings: {
        get: (key) => settings.get(key),
        set: async (key, value) => settings.set(key, value),
      },
    },
    pageTitleToDate: () => new Date(2026, 7, 30),
    clientFactory: () => ({
      readRange: async (options) => {
        clientCalls.push(options);
        return [{
          calendar: { id: 'primary', summary: 'Work' },
          events: [{
            id: 'meeting-1',
            status: 'confirmed',
            summary: 'Weekly meeting',
            start: { dateTime: '2026-08-31T01:00:00+08:00' },
            end: { dateTime: '2026-08-31T01:30:00+08:00' },
          }],
        }];
      },
      destroy: () => {},
    }),
    reconcilerFactory: () => ({
      sync: async (options) => {
        reconcileCalls.push(options);
        return { created: 1, updated: 0, removed: 0, localKept: 0, skipped: 0 };
      },
    }),
  });

  const result = await runtime.syncPlan({
    planUid: 'tomorrow-plan',
    pageTitle: 'August 30th, 2026',
    force: true,
  });

  assert.deepEqual(clientCalls[0].calendarIds, ['primary', 'team@example.com']);
  assert.equal(new Date(clientCalls[0].timeMin).getHours(), 21);
  assert.equal(new Date(clientCalls[0].timeMin).getDate(), 30);
  assert.equal(new Date(clientCalls[0].timeMax).getHours(), 2);
  assert.equal(new Date(clientCalls[0].timeMax).getDate(), 31);
  assert.equal(reconcileCalls[0].planUid, 'tomorrow-plan');
  assert.equal(reconcileCalls[0].force, true);
  assert.equal(reconcileCalls[0].events[0].parentString, '01:00–01:30 Weekly meeting');
  assert.equal(result.created, 1);
});

test('calendar runtime stays inert when disabled and explains missing OAuth setup', async () => {
  const extension = await loadExtension('calendar-disabled');
  const settings = new Map([
    ['google-calendar-enabled', false],
    ['google-oauth-client-id', ''],
  ]);
  let clients = 0;
  const runtime = extension.createCalendarRuntime({
    extensionAPI: { settings: { get: (key) => settings.get(key), set: async () => {} } },
    clientFactory: () => { clients += 1; return {}; },
  });

  await assert.rejects(
    runtime.syncPlan({ planUid: 'plan', pageTitle: 'August 30th, 2026' }),
    /not enabled/i,
  );
  assert.equal(clients, 0);

  settings.set('google-calendar-enabled', true);
  await assert.rejects(
    runtime.syncPlan({ planUid: 'plan', pageTitle: 'August 30th, 2026' }),
    /OAuth Client ID/i,
  );
  assert.equal(clients, 0);
});
