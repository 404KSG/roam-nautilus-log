const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function loadExtension(label) {
  const bundle = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}#${label}-${Date.now()}`);
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function jsonResponse(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

function classify(url) {
  const parsed = new URL(String(url));
  if (parsed.pathname.endsWith('/users/me/calendarList')) return { kind: 'calendarList', parsed };
  if (parsed.pathname.includes('/calendars/') && parsed.pathname.endsWith('/events')) {
    return {
      kind: 'events',
      parsed,
      calendarId: decodeURIComponent(parsed.pathname.split('/calendars/')[1].split('/events')[0]),
      pageToken: parsed.searchParams.get('pageToken') || '',
    };
  }
  if (parsed.pathname.endsWith('/users/@me/lists')) return { kind: 'taskLists', parsed };
  if (parsed.pathname.includes('/tasks')) {
    return {
      kind: 'tasks',
      parsed,
      dueMin: parsed.searchParams.has('dueMin'),
      pageToken: parsed.searchParams.get('pageToken') || '',
    };
  }
  return { kind: 'other', parsed };
}

function abortError() {
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
}

function createClient(extension, extras = {}) {
  const {
    loadConnection = () => ({ version: 2, id: 'connection-1', secret: 'opaque-connection-secret' }),
    authorize = async () => 'access-token',
    ...clientExtras
  } = extras;
  return extension.createGoogleCalendarClient({
    authClient: {
      authorize,
      invalidateAccessToken() {},
      destroy() {},
    },
    authOptions: { loadConnection },
    sleepImpl: async () => {},
    randomImpl: () => 0.5,
    ...clientExtras,
  });
}

const RANGE = {
  timeMin: '2026-08-30T00:00:00.000Z',
  timeMax: '2026-08-31T00:00:00.000Z',
};

test('multi-calendar reads use bounded concurrency and keep input order', async () => {
  const extension = await loadExtension('gcal-network-concurrency');
  let inFlight = 0;
  let peak = 0;
  const eventStarts = [];
  const client = createClient(extension, {
    maxConcurrency: 3,
    fetchImpl: async (url) => {
      const info = classify(url);
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      if (info.kind === 'events') eventStarts.push(info.calendarId);
      await delay(30);
      inFlight -= 1;
      if (info.kind === 'calendarList') {
        return jsonResponse({
          items: [
            { id: 'c@example.com', summary: 'C' },
            { id: 'a@example.com', summary: 'A' },
            { id: 'b@example.com', summary: 'B', primary: true },
            { id: 'd@example.com', summary: 'D' },
          ],
        });
      }
      return jsonResponse({ items: [{ id: `event-${info.calendarId}` }] });
    },
  });

  const rows = await client.readRange({
    calendarIds: ['c@example.com', 'a@example.com', 'b@example.com', 'd@example.com'],
    ...RANGE,
  });

  assert.deepEqual(rows.map((row) => row.calendar.id), [
    'c@example.com',
    'a@example.com',
    'b@example.com',
    'd@example.com',
  ]);
  assert.equal(peak, 3);
  assert.deepEqual(eventStarts.slice(0, 3).sort(), ['a@example.com', 'b@example.com', 'c@example.com'].sort());
  const stats = client.getNetworkStats?.();
  if (stats) {
    assert.equal(stats.peakConcurrency, 3);
    assert.ok(stats.peakConcurrency <= 3);
  }
});

test('calendarList metadata is cached for a short connection-scoped TTL', async () => {
  const extension = await loadExtension('gcal-network-metadata-ttl');
  const requests = [];
  let now = 1_000;
  let connection = { version: 2, id: 'connection-1', secret: 'opaque-connection-secret' };
  const client = createClient(extension, {
    nowImpl: () => now,
    metadataTtlMs: 1_000,
    loadConnection: () => connection,
    fetchImpl: async (url) => {
      requests.push(classify(url).kind);
      if (String(url).includes('/calendarList')) {
        return jsonResponse({ items: [{ id: 'connected@example.com', primary: true, summary: 'Work' }] });
      }
      return jsonResponse({ items: [] });
    },
  });

  await client.readRange({ calendarIds: ['primary'], ...RANGE });
  await client.readRange({ calendarIds: ['primary'], ...RANGE });
  assert.equal(requests.filter((kind) => kind === 'calendarList').length, 1);

  now += 1_001;
  await client.readRange({ calendarIds: ['primary'], ...RANGE });
  assert.equal(requests.filter((kind) => kind === 'calendarList').length, 2);

  connection = { version: 2, id: 'connection-2', secret: 'opaque-connection-secret' };
  await client.readRange({ calendarIds: ['primary'], ...RANGE });
  assert.equal(requests.filter((kind) => kind === 'calendarList').length, 3);
});

test('metadata cache stays off without a trusted connection identity and never uses secrets', async () => {
  const extension = await loadExtension('gcal-network-no-identity-cache');
  const urls = [];
  const client = createClient(extension, {
    loadConnection: () => null,
    fetchImpl: async (url) => {
      urls.push(String(url));
      if (String(url).includes('/calendarList')) {
        return jsonResponse({ items: [{ id: 'connected@example.com', primary: true }] });
      }
      return jsonResponse({ items: [] });
    },
  });
  await client.readRange({ calendarIds: ['primary'], ...RANGE });
  await client.readRange({ calendarIds: ['primary'], ...RANGE });
  assert.equal(urls.filter((url) => url.includes('/calendarList')).length, 2);
  assert.equal(urls.some((url) => url.includes('opaque-connection-secret')), false);
  assert.equal(urls.some((url) => url.includes('access-token')), false);
});

test('failed or partial metadata reads are not cached', async () => {
  const extension = await loadExtension('gcal-network-no-error-cache');
  let calendarListCalls = 0;
  const client = createClient(extension, {
    fetchImpl: async (url) => {
      if (String(url).includes('/calendarList')) {
        calendarListCalls += 1;
        if (calendarListCalls === 1) {
          return jsonResponse({ error: { message: 'temporary list failure' } }, 400);
        }
        return jsonResponse({ items: [{ id: 'connected@example.com', primary: true }] });
      }
      return jsonResponse({ items: [] });
    },
  });
  await assert.rejects(
    () => client.readRange({ calendarIds: ['primary'], ...RANGE }),
    /temporary list failure/,
  );
  const rows = await client.readRange({ calendarIds: ['primary'], ...RANGE });
  assert.equal(rows.length, 1);
  assert.equal(calendarListCalls, 2);
});

test('a repeated nextPageToken fails incomplete without following forever', async () => {
  const extension = await loadExtension('gcal-network-repeat-token');
  let eventPages = 0;
  const client = createClient(extension, {
    maxPages: 8,
    fetchImpl: async (url) => {
      if (String(url).includes('/calendarList')) {
        return jsonResponse({ items: [{ id: 'connected@example.com', primary: true }] });
      }
      eventPages += 1;
      if (eventPages > 40) return jsonResponse({ items: [] });
      return jsonResponse({ items: [{ id: `event-${eventPages}` }], nextPageToken: 'loop-token' });
    },
  });
  await assert.rejects(
    () => client.readRange({ calendarIds: ['primary'], ...RANGE }),
    (error) => {
      assert.match(String(error.message), /incomplete/i);
      assert.match(String(error.message), /page token|repeated/i);
      assert.equal(error.incomplete, true);
      assert.equal(error.reason, 'repeated_page_token');
      assert.doesNotMatch(String(error.message), /loop-token/);
      assert.equal(String(JSON.stringify(error.context || {})).includes('loop-token'), false);
      return true;
    },
  );
  assert.ok(eventPages <= 8);
});

test('page and item budgets fail incomplete instead of truncating', async () => {
  const extension = await loadExtension('gcal-network-budgets');
  let eventPages = 0;
  const pageClient = createClient(extension, {
    maxPages: 2,
    fetchImpl: async (url) => {
      if (String(url).includes('/calendarList')) {
        return jsonResponse({ items: [{ id: 'connected@example.com', primary: true }] });
      }
      eventPages += 1;
      return jsonResponse({
        items: [{ id: `event-${eventPages}` }],
        nextPageToken: eventPages >= 10 ? '' : `page-${eventPages}`,
      });
    },
  });
  await assert.rejects(
    () => pageClient.readRange({ calendarIds: ['primary'], ...RANGE }),
    (error) => {
      assert.equal(error.incomplete, true);
      assert.equal(error.reason, 'page_budget');
      assert.match(String(error.message), /incomplete/i);
      return true;
    },
  );
  assert.equal(eventPages, 2);

  let itemPages = 0;
  const itemClient = createClient(extension, {
    maxItems: 3,
    fetchImpl: async (url) => {
      if (String(url).includes('/calendarList')) {
        return jsonResponse({ items: [{ id: 'connected@example.com', primary: true }] });
      }
      itemPages += 1;
      return jsonResponse({
        items: [{ id: `a-${itemPages}` }, { id: `b-${itemPages}` }],
        nextPageToken: itemPages >= 6 ? '' : `item-${itemPages}`,
      });
    },
  });
  await assert.rejects(
    () => itemClient.readRange({ calendarIds: ['primary'], ...RANGE }),
    (error) => {
      assert.equal(error.incomplete, true);
      assert.equal(error.reason, 'item_budget');
      return true;
    },
  );
  assert.ok(itemPages <= 2);
});

test('cancel does not start queued calendar fetches and in-flight success is discarded', async () => {
  const extension = await loadExtension('gcal-network-cancel-queue');
  const fetchStarts = [];
  let releaseEvents;
  const eventsStarted = new Promise((resolve) => { releaseEvents = resolve; });
  let finishInFlight;
  const inFlight = new Promise((resolve) => { finishInFlight = resolve; });
  const client = createClient(extension, {
    maxConcurrency: 2,
    fetchImpl: async (url, options) => {
      const info = classify(url);
      fetchStarts.push(info.kind);
      if (info.kind === 'calendarList') {
        return jsonResponse({
          items: [
            { id: 'a@example.com', primary: true },
            { id: 'b@example.com' },
            { id: 'c@example.com' },
            { id: 'd@example.com' },
          ],
        });
      }
      if (options?.signal?.aborted) throw abortError();
      releaseEvents();
      await inFlight;
      if (options?.signal?.aborted) throw abortError();
      return jsonResponse({ items: [{ id: 'late-event' }] });
    },
  });
  const pending = client.readRange({
    calendarIds: ['a@example.com', 'b@example.com', 'c@example.com', 'd@example.com'],
    ...RANGE,
  });
  await eventsStarted;
  await delay(10);
  const startedBeforeCancel = fetchStarts.length;
  client.cancelSync();
  finishInFlight();
  await assert.rejects(() => pending, /cancelled/);
  await delay(20);
  assert.equal(fetchStarts.length, startedBeforeCancel);
  assert.ok(fetchStarts.filter((kind) => kind === 'events').length <= 2);
});

test('ordinary cancel allows a later read on a fresh controller; destroy stays terminal', async () => {
  const extension = await loadExtension('gcal-network-cancel-resume');
  const signals = [];
  const client = createClient(extension, {
    fetchImpl: async (url, options) => {
      signals.push(options?.signal);
      if (options?.signal?.aborted) throw abortError();
      if (String(url).includes('/calendarList')) {
        return jsonResponse({ items: [{ id: 'connected@example.com', primary: true, summary: 'Work' }] });
      }
      return jsonResponse({ items: [{ id: 'event-1' }] });
    },
  });
  const first = await client.readRange({ calendarIds: ['primary'], ...RANGE });
  assert.equal(first[0].events[0].id, 'event-1');
  client.cancelSync();
  const second = await client.readRange({ calendarIds: ['primary'], ...RANGE });
  assert.equal(second[0].events[0].id, 'event-1');
  assert.equal(signals.at(-1)?.aborted, false);
  assert.notEqual(signals[0], signals.at(-1));
  client.destroy();
  await assert.rejects(
    () => client.readRange({ calendarIds: ['primary'], ...RANGE }),
    /cancelled|no longer/i,
  );
});

test('retry sleep after 401/429 is cancelled without issuing another fetch', async () => {
  const extension = await loadExtension('gcal-network-retry-cancel');
  const requests = [];
  let releaseSleep;
  const sleeping = new Promise((resolve) => { releaseSleep = resolve; });
  const client = createClient(extension, {
    retryDelays: [20, 20],
    sleepImpl: async () => {
      await sleeping;
    },
    fetchImpl: async (url) => {
      const info = classify(url);
      requests.push(info.kind);
      if (info.kind === 'calendarList') {
        return jsonResponse({ items: [{ id: 'connected@example.com', primary: true }] });
      }
      if (requests.filter((kind) => kind === 'events').length === 1) {
        return jsonResponse({ error: { message: 'Slow down' } }, 429, { 'Retry-After': '0' });
      }
      return jsonResponse({ items: [{ id: 'event-ok' }] });
    },
  });
  const pending = client.readRange({ calendarIds: ['primary'], ...RANGE });
  await delay(20);
  client.cancelSync();
  releaseSleep();
  await assert.rejects(() => pending, /cancelled/);
  assert.equal(requests.filter((kind) => kind === 'events').length, 1);
});

test('401 invalidates connection-scoped metadata cache', async () => {
  const extension = await loadExtension('gcal-network-401-cache');
  const requests = [];
  let eventCalls = 0;
  let token = 'access-token-1';
  const client = createClient(extension, {
    metadataTtlMs: 10_000,
    nowImpl: () => 8_000,
    authorize: async () => token,
    fetchImpl: async (url) => {
      const info = classify(url);
      requests.push(info.kind);
      if (info.kind === 'calendarList') {
        return jsonResponse({ items: [{ id: 'connected@example.com', primary: true }] });
      }
      eventCalls += 1;
      if (eventCalls === 1) {
        token = 'access-token-2';
        return jsonResponse({ error: { message: 'Expired' } }, 401);
      }
      return jsonResponse({ items: [{ id: 'event-ok' }] });
    },
  });
  const first = await client.readRange({ calendarIds: ['primary'], ...RANGE });
  assert.equal(first[0].events[0].id, 'event-ok');
  await client.readRange({ calendarIds: ['primary'], ...RANGE });
  assert.equal(requests.filter((kind) => kind === 'calendarList').length, 2);
});

test('task list metadata caches while active tasks stay ungated and dated lifecycle stays dated', async () => {
  const extension = await loadExtension('gcal-network-tasks-compat');
  const requests = [];
  let now = 9_000;
  const client = createClient(extension, {
    nowImpl: () => now,
    metadataTtlMs: 1_000,
    maxConcurrency: 3,
    fetchImpl: async (url) => {
      const info = classify(url);
      requests.push(info);
      if (info.kind === 'taskLists') {
        return jsonResponse({
          items: [
            { id: 'list-a', title: 'A' },
            { id: 'list-b', title: 'B' },
            { id: 'list-c', title: 'C' },
          ],
        });
      }
      if (!info.dueMin) {
        return jsonResponse({ items: [{ id: `${info.parsed.pathname}-active`, status: 'needsAction' }] });
      }
      return jsonResponse({ items: [{ id: `${info.parsed.pathname}-done`, status: 'completed' }] });
    },
  });
  const first = await client.readTasks({ date: '2026-08-30' });
  const second = await client.readTasks({ date: '2026-08-30' });
  assert.equal(first.length, 3);
  assert.deepEqual(first.map((row) => row.taskList.id), ['list-a', 'list-b', 'list-c']);
  assert.equal(second.length, 3);
  assert.equal(requests.filter((info) => info.kind === 'taskLists').length, 1);
  const taskQueries = requests.filter((info) => info.kind === 'tasks');
  assert.equal(taskQueries.length, 12);
  assert.equal(taskQueries.filter((info) => info.dueMin).length, 6);
  assert.equal(taskQueries.filter((info) => !info.dueMin).length, 6);
});

function isCancelledError(error) {
  return error?.reason === 'cancelled'
    || error?.name === 'AbortError'
    || /cancelled/i.test(String(error?.message || ''));
}

test('cached calendarList: cancelled readRange does not adopt a same-turn restart generation', async () => {
  const extension = await loadExtension('gcal-network-cancel-restart-calendar-cache');
  const paths = [];
  const client = createClient(extension, {
    fetchImpl: async (url) => {
      const parsed = new URL(String(url));
      paths.push(parsed.pathname);
      if (parsed.pathname.endsWith('/calendarList')) {
        return jsonResponse({ items: [{ id: 'primary', primary: true, summary: 'Work' }] });
      }
      return jsonResponse({ items: [{ id: `event-${parsed.pathname}` }] });
    },
  });

  await client.readRange({ calendarIds: 'warm', ...RANGE });
  paths.length = 0;
  const oldRead = client.readRange({ calendarIds: 'cancelled-old', ...RANGE });
  client.cancelSync();
  const newRead = client.readRange({ calendarIds: 'new-valid', ...RANGE });
  const outcomes = await Promise.allSettled([oldRead, newRead]);

  assert.equal(outcomes[0].status, 'rejected');
  assert.equal(isCancelledError(outcomes[0].reason), true);
  assert.equal(outcomes[1].status, 'fulfilled');
  assert.equal(outcomes[1].value[0].calendar.id, 'new-valid');
  assert.equal(paths.some((pathname) => pathname.includes('cancelled-old')), false);
  assert.equal(paths.some((pathname) => pathname.includes('new-valid')), true);

  const third = await client.readRange({ calendarIds: 'after-cancel-still-alive', ...RANGE });
  assert.equal(third[0].calendar.id, 'after-cancel-still-alive');
  client.destroy();
  await assert.rejects(
    () => client.readRange({ calendarIds: 'after-destroy', ...RANGE }),
    /cancelled|no longer/i,
  );
});

test('cached task lists: cancelled readTasks does not adopt a same-turn restart generation', async () => {
  const extension = await loadExtension('gcal-network-cancel-restart-task-cache');
  const paths = [];
  const client = createClient(extension, {
    fetchImpl: async (url) => {
      const parsed = new URL(String(url));
      paths.push(parsed.pathname);
      if (parsed.pathname.endsWith('/users/@me/lists')) {
        return jsonResponse({ items: [{ id: 'cancelled-old', title: 'Old' }] });
      }
      return jsonResponse({ items: [{ id: `task-${parsed.pathname}`, status: 'needsAction' }] });
    },
  });

  await client.readTasks({ date: '2026-08-30' });
  const taskFetchesBeforeRace = paths.filter((pathname) => pathname.includes('/tasks')).length;
  const oldRead = client.readTasks({ date: '2026-08-30' });
  client.cancelSync();
  const newRead = client.readTasks({ date: '2026-08-30' });
  const outcomes = await Promise.allSettled([oldRead, newRead]);

  assert.equal(outcomes[0].status, 'rejected');
  assert.equal(isCancelledError(outcomes[0].reason), true);
  assert.equal(outcomes[1].status, 'fulfilled');
  assert.equal(outcomes[1].value[0].taskList.id, 'cancelled-old');
  const taskFetchesAfterRace = paths.filter((pathname) => pathname.includes('/tasks')).length;
  assert.equal(taskFetchesAfterRace - taskFetchesBeforeRace, 2);
});

test('pagination boundary cancel/restart does not let the old page loop continue', async () => {
  const extension = await loadExtension('gcal-network-cancel-restart-page-boundary');
  const eventPages = [];
  let releaseFirstPage;
  const firstPageHeld = new Promise((resolve) => { releaseFirstPage = resolve; });
  let firstPageStarted;
  const firstPageReady = new Promise((resolve) => { firstPageStarted = resolve; });
  const client = createClient(extension, {
    fetchImpl: async (url) => {
      const info = classify(url);
      if (info.kind === 'calendarList') {
        return jsonResponse({ items: [{ id: 'primary', primary: true }] });
      }
      if (info.kind === 'events' && info.calendarId === 'paged-old') {
        eventPages.push(info.pageToken || 'first');
        if (!info.pageToken) {
          firstPageStarted();
          await firstPageHeld;
          return jsonResponse({ items: [{ id: 'old-page-1' }], nextPageToken: 'page-2' });
        }
        return jsonResponse({ items: [{ id: 'old-page-2-should-not-publish' }] });
      }
      return jsonResponse({ items: [{ id: `event-${info.calendarId}` }] });
    },
  });

  const oldRead = client.readRange({ calendarIds: 'paged-old', ...RANGE });
  await firstPageReady;
  client.cancelSync();
  const newRead = client.readRange({ calendarIds: 'new-valid', ...RANGE });
  releaseFirstPage();
  const outcomes = await Promise.allSettled([oldRead, newRead]);

  assert.equal(outcomes[0].status, 'rejected');
  assert.equal(isCancelledError(outcomes[0].reason), true);
  assert.equal(outcomes[1].status, 'fulfilled');
  assert.equal(outcomes[1].value[0].events[0].id, 'event-new-valid');
  assert.equal(eventPages.includes('page-2'), false);
});

test('cached metadata: same-turn cancel/restart cannot finish an old paged event stream', async () => {
  const extension = await loadExtension('gcal-network-cancel-restart-cached-pages');
  const oldPages = [];
  const client = createClient(extension, {
    fetchImpl: async (url) => {
      const info = classify(url);
      if (info.kind === 'calendarList') {
        return jsonResponse({ items: [{ id: 'primary', primary: true }] });
      }
      if (info.kind === 'events' && info.calendarId === 'paged-old') {
        oldPages.push(info.pageToken || 'first');
        if (!info.pageToken) {
          return jsonResponse({ items: [{ id: 'old-page-1' }], nextPageToken: 'page-2' });
        }
        return jsonResponse({ items: [{ id: 'old-page-2-should-not-publish' }] });
      }
      return jsonResponse({ items: [{ id: `event-${info.calendarId}` }] });
    },
  });

  await client.readRange({ calendarIds: 'warm', ...RANGE });
  const oldRead = client.readRange({ calendarIds: 'paged-old', ...RANGE });
  client.cancelSync();
  const newRead = client.readRange({ calendarIds: 'new-valid', ...RANGE });
  const outcomes = await Promise.allSettled([oldRead, newRead]);

  assert.equal(outcomes[0].status, 'rejected');
  assert.equal(isCancelledError(outcomes[0].reason), true);
  assert.equal(outcomes[1].status, 'fulfilled');
  assert.equal(outcomes[1].value[0].events[0].id, 'event-new-valid');
  assert.deepEqual(oldPages, []);
});

test('destroy stays terminal across a same-turn restart attempt', async () => {
  const extension = await loadExtension('gcal-network-destroy-restart');
  const paths = [];
  const client = createClient(extension, {
    fetchImpl: async (url) => {
      const parsed = new URL(String(url));
      paths.push(parsed.pathname);
      if (parsed.pathname.endsWith('/calendarList')) {
        return jsonResponse({ items: [{ id: 'primary', primary: true }] });
      }
      return jsonResponse({ items: [{ id: 'event-late' }] });
    },
  });

  await client.readRange({ calendarIds: 'warm', ...RANGE });
  paths.length = 0;
  const oldRead = client.readRange({ calendarIds: 'cancelled-old', ...RANGE });
  client.destroy();
  const newRead = client.readRange({ calendarIds: 'new-valid', ...RANGE });
  const outcomes = await Promise.allSettled([oldRead, newRead]);
  assert.equal(outcomes[0].status, 'rejected');
  assert.equal(outcomes[1].status, 'rejected');
  assert.equal(paths.some((pathname) => pathname.includes('cancelled-old')), false);
  assert.equal(paths.some((pathname) => pathname.includes('new-valid')), false);
  await assert.rejects(
    () => client.readRange({ calendarIds: 'still-dead', ...RANGE }),
    /cancelled|no longer/i,
  );
});

test('queued calendar fetches from a cancelled read do not run after a restart', async () => {
  const extension = await loadExtension('gcal-network-cancel-restart-queue');
  const eventCalendars = [];
  let releaseInFlight;
  const inFlight = new Promise((resolve) => { releaseInFlight = resolve; });
  let sawSecondSlot;
  const secondSlotReady = new Promise((resolve) => { sawSecondSlot = resolve; });
  const client = createClient(extension, {
    maxConcurrency: 1,
    fetchImpl: async (url) => {
      const info = classify(url);
      if (info.kind === 'calendarList') {
        return jsonResponse({
          items: [
            { id: 'queued-old-a', primary: true },
            { id: 'queued-old-b' },
            { id: 'queued-old-c' },
          ],
        });
      }
      if (info.kind === 'events') {
        eventCalendars.push(info.calendarId);
        if (info.calendarId === 'queued-old-a') {
          sawSecondSlot();
          await inFlight;
        }
        return jsonResponse({ items: [{ id: `event-${info.calendarId}` }] });
      }
      return jsonResponse({ items: [] });
    },
  });

  const oldRead = client.readRange({
    calendarIds: ['queued-old-a', 'queued-old-b', 'queued-old-c'],
    ...RANGE,
  });
  await secondSlotReady;
  await delay(10);
  client.cancelSync();
  const newRead = client.readRange({ calendarIds: 'new-valid', ...RANGE });
  releaseInFlight();
  const outcomes = await Promise.allSettled([oldRead, newRead]);
  assert.equal(outcomes[0].status, 'rejected');
  assert.equal(isCancelledError(outcomes[0].reason), true);
  assert.equal(outcomes[1].status, 'fulfilled');
  assert.equal(outcomes[1].value[0].calendar.id, 'new-valid');
  assert.equal(eventCalendars.includes('queued-old-b'), false);
  assert.equal(eventCalendars.includes('queued-old-c'), false);
});

test('cancel during authorize then restart keeps the new read usable', async () => {
  const extension = await loadExtension('gcal-network-cancel-restart-after-auth');
  const paths = [];
  let hangNextAuthorize = false;
  let releaseAuthorize;
  const authorizeHeld = new Promise((resolve) => { releaseAuthorize = resolve; });
  let authorizeStarted;
  const authorizeReady = new Promise((resolve) => { authorizeStarted = resolve; });
  const client = createClient(extension, {
    authorize: async () => {
      if (hangNextAuthorize) {
        hangNextAuthorize = false;
        authorizeStarted();
        await authorizeHeld;
      }
      return 'access-token';
    },
    fetchImpl: async (url) => {
      const parsed = new URL(String(url));
      paths.push(parsed.pathname);
      if (parsed.pathname.endsWith('/calendarList')) {
        return jsonResponse({ items: [{ id: 'primary', primary: true }] });
      }
      return jsonResponse({ items: [{ id: `event-${parsed.pathname}` }] });
    },
  });

  await client.readRange({ calendarIds: 'warm', ...RANGE });
  paths.length = 0;
  hangNextAuthorize = true;
  const oldRead = client.readRange({ calendarIds: 'cancelled-old', ...RANGE });
  await authorizeReady;
  client.cancelSync();
  const newRead = client.readRange({ calendarIds: 'new-valid', ...RANGE });
  releaseAuthorize();
  const outcomes = await Promise.allSettled([oldRead, newRead]);
  assert.equal(outcomes[0].status, 'rejected');
  assert.equal(isCancelledError(outcomes[0].reason), true);
  assert.equal(outcomes[1].status, 'fulfilled');
  assert.equal(paths.some((pathname) => pathname.includes('cancelled-old')), false);
  assert.equal(paths.some((pathname) => pathname.includes('new-valid')), true);
});

test('cancel during retry sleep then restart does not revive the old fetch loop', async () => {
  const extension = await loadExtension('gcal-network-cancel-restart-after-sleep');
  const requests = [];
  let releaseSleep;
  const sleeping = new Promise((resolve) => { releaseSleep = resolve; });
  let sleepStarted;
  const sleepReady = new Promise((resolve) => { sleepStarted = resolve; });
  const client = createClient(extension, {
    retryDelays: [20, 20],
    sleepImpl: async () => {
      sleepStarted();
      await sleeping;
    },
    fetchImpl: async (url) => {
      const info = classify(url);
      requests.push(info.kind === 'events' ? info.calendarId : info.kind);
      if (info.kind === 'calendarList') {
        return jsonResponse({ items: [{ id: 'primary', primary: true }] });
      }
      if (info.calendarId === 'cancelled-old') {
        return jsonResponse({ error: { message: 'Slow down' } }, 429, { 'Retry-After': '0' });
      }
      return jsonResponse({ items: [{ id: `event-${info.calendarId}` }] });
    },
  });

  await client.readRange({ calendarIds: 'warm', ...RANGE });
  const oldRead = client.readRange({ calendarIds: 'cancelled-old', ...RANGE });
  await sleepReady;
  client.cancelSync();
  const newRead = client.readRange({ calendarIds: 'new-valid', ...RANGE });
  releaseSleep();
  const outcomes = await Promise.allSettled([oldRead, newRead]);
  assert.equal(outcomes[0].status, 'rejected');
  assert.equal(isCancelledError(outcomes[0].reason), true);
  assert.equal(outcomes[1].status, 'fulfilled');
  assert.equal(requests.filter((item) => item === 'cancelled-old').length, 1);
  assert.equal(requests.includes('new-valid'), true);
});

test('metadata completing after a connection change is not stored under the new key', async () => {
  const extension = await loadExtension('gcal-network-connection-swap-during-metadata');
  let connection = { version: 2, id: 'connection-1', secret: 'opaque-connection-secret' };
  let calendarListCalls = 0;
  let releaseList;
  const listHeld = new Promise((resolve) => { releaseList = resolve; });
  let listStarted;
  const listReady = new Promise((resolve) => { listStarted = resolve; });
  const client = createClient(extension, {
    loadConnection: () => connection,
    fetchImpl: async (url) => {
      const info = classify(url);
      if (info.kind === 'calendarList') {
        calendarListCalls += 1;
        if (calendarListCalls === 1) {
          listStarted();
          await listHeld;
          return jsonResponse({ items: [{ id: 'old-primary', primary: true, summary: 'Old Conn' }] });
        }
        return jsonResponse({ items: [{ id: 'new-primary', primary: true, summary: 'New Conn' }] });
      }
      return jsonResponse({ items: [{ id: `event-${info.calendarId}` }] });
    },
  });

  const pending = client.readRange({ calendarIds: ['primary'], ...RANGE });
  await listReady;
  connection = { version: 2, id: 'connection-2', secret: 'opaque-connection-secret' };
  releaseList();
  const first = await pending;
  assert.equal(first[0].calendar.summary, 'Old Conn');
  assert.equal(calendarListCalls, 1);

  const second = await client.readRange({ calendarIds: ['primary'], ...RANGE });
  assert.equal(second[0].calendar.summary, 'New Conn');
  assert.equal(calendarListCalls, 2);
});

test('first authorize without a connection id still succeeds and does not start caching', async () => {
  const extension = await loadExtension('gcal-network-first-authorize-no-connection');
  const calendarListCalls = [];
  let authorizeCalls = 0;
  const client = createClient(extension, {
    loadConnection: () => { throw new Error('no stored connection yet'); },
    authorize: async () => {
      authorizeCalls += 1;
      return 'first-access-token';
    },
    fetchImpl: async (url) => {
      if (String(url).includes('/calendarList')) {
        calendarListCalls.push(String(url));
        return jsonResponse({ items: [{ id: 'fresh@example.com', primary: true, summary: 'Fresh' }] });
      }
      return jsonResponse({ items: [{ id: 'event-1' }] });
    },
  });

  const first = await client.readRange({ calendarIds: ['primary'], ...RANGE });
  const second = await client.readRange({ calendarIds: ['primary'], ...RANGE });
  assert.equal(first[0].calendar.summary, 'Fresh');
  assert.equal(second[0].calendar.summary, 'Fresh');
  assert.equal(authorizeCalls >= 1, true);
  assert.equal(calendarListCalls.length, 2);
});
