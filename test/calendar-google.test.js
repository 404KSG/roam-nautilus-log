const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function loadExtension(label) {
  const bundle = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}#${label}-${Date.now()}`);
}

test('Calendar reads carry the authorized primary account into every event batch', async () => {
  const extension = await loadExtension('calendar-account-hint');
  const requests = [];
  const client = extension.createGoogleCalendarClient({
    authClient: {
      authorize: async () => 'access-token',
      destroy: () => {},
    },
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), authorization: options?.headers?.Authorization });
      const payload = String(url).includes('/users/me/calendarList')
        ? {
          items: [{
            id: 'connected@example.com',
            primary: true,
            summary: 'Connected account',
          }],
        }
        : { items: [] };
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  const batches = await client.readRange({
    calendarIds: ['primary'],
    timeMin: '2026-08-30T00:00:00.000Z',
    timeMax: '2026-08-31T00:00:00.000Z',
  });

  assert.deepEqual(batches, [{
    calendar: {
      id: 'primary',
      summary: 'Connected account',
      accountHint: 'connected@example.com',
    },
    events: [],
  }]);
  assert.equal(requests.length, 2);
  assert.ok(requests.every((request) => request.authorization === 'Bearer access-token'));
});

test('Google Tasks reads active rows without a due gate and merges dated lifecycle rows', async () => {
  const extension = await loadExtension('google-tasks-client');
  const requests = [];
  const client = extension.createGoogleCalendarClient({
    authClient: {
      authorize: async () => 'access-token',
      destroy: () => {},
    },
    fetchImpl: async (url, options) => {
      const parsed = new URL(url);
      requests.push({ parsed, options });
      let payload;
      if (parsed.pathname.endsWith('/users/@me/lists')) {
        payload = { items: [{ id: 'work-list', title: 'Work Tasks' }] };
      } else if (!parsed.searchParams.has('dueMin')) {
        payload = {
          items: [{
            id: 'task-1',
            status: 'needsAction',
            due: '2026-08-30T00:00:00.000Z',
          }],
        };
      } else {
        payload = {
          items: [{
            id: 'task-2',
            status: 'completed',
            due: '2026-08-30T00:00:00.000Z',
          }],
        };
      }
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  const batches = await client.readTasks({ date: '2026-08-30' });

  assert.deepEqual(batches, [{
    taskList: { id: 'work-list', title: 'Work Tasks' },
    tasks: [
      {
        id: 'task-1',
        status: 'needsAction',
        due: '2026-08-30T00:00:00.000Z',
      },
      {
        id: 'task-2',
        status: 'completed',
        due: '2026-08-30T00:00:00.000Z',
      },
    ],
  }]);
  const taskRequests = requests.filter(({ parsed }) => (
    parsed.pathname.includes('/lists/work-list/tasks')
  ));
  assert.equal(taskRequests.length, 2);
  const activeRequest = taskRequests.find(({ parsed }) => !parsed.searchParams.has('dueMin'));
  assert.equal(activeRequest.parsed.searchParams.has('dueMax'), false);
  assert.equal(activeRequest.parsed.searchParams.get('showCompleted'), 'false');
  assert.equal(activeRequest.parsed.searchParams.get('showDeleted'), 'false');
  assert.equal(activeRequest.parsed.searchParams.get('showHidden'), 'false');
  const lifecycleRequest = taskRequests.find(({ parsed }) => parsed.searchParams.has('dueMin'));
  assert.equal(lifecycleRequest.parsed.searchParams.get('dueMin'), '2026-08-30T00:00:00.000Z');
  assert.equal(lifecycleRequest.parsed.searchParams.get('dueMax'), '2026-08-30T23:59:59.999Z');
  assert.equal(lifecycleRequest.parsed.searchParams.get('showCompleted'), 'true');
  assert.equal(lifecycleRequest.parsed.searchParams.get('showDeleted'), 'true');
  assert.equal(lifecycleRequest.parsed.searchParams.get('showHidden'), 'true');
  assert.equal(requests.every(({ options }) => options.headers.Authorization === 'Bearer access-token'), true);
});

test('Google reads retry a bounded 429 response and then continue', async () => {
  const extension = await loadExtension('google-retry-429');
  let requests = 0;
  const delays = [];
  const client = extension.createGoogleCalendarClient({
    authClient: { authorize: async () => 'access-token', destroy: () => {} },
    retryDelays: [5, 10],
    randomImpl: () => 0.5,
    sleepImpl: async (delay) => { delays.push(delay); },
    fetchImpl: async (url) => {
      requests += 1;
      if (requests === 1) {
        return new Response(JSON.stringify({ error: { message: 'Slow down' } }), {
          status: 429,
          headers: { 'Content-Type': 'application/json', 'Retry-After': '0' },
        });
      }
      const payload = String(url).includes('/calendarList')
        ? { items: [{ id: 'connected@example.com', primary: true }] }
        : { items: [] };
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  const result = await client.readRange({
    calendarIds: ['primary'],
    timeMin: '2026-08-30T00:00:00.000Z',
    timeMax: '2026-08-31T00:00:00.000Z',
  });

  assert.equal(result.length, 1);
  assert.equal(requests, 3);
  assert.deepEqual(delays, [0]);
});

test('Google reads stop after two transient retries', async () => {
  const extension = await loadExtension('google-retry-bounded');
  let requests = 0;
  const delays = [];
  const client = extension.createGoogleCalendarClient({
    authClient: { authorize: async () => 'access-token', destroy: () => {} },
    retryDelays: [5, 10],
    randomImpl: () => 0.5,
    sleepImpl: async (delay) => { delays.push(delay); },
    fetchImpl: async () => {
      requests += 1;
      return new Response(JSON.stringify({ error: { message: 'Temporarily unavailable' } }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  await assert.rejects(() => client.readRange({
    calendarIds: ['primary'],
    timeMin: '2026-08-30T00:00:00.000Z',
    timeMax: '2026-08-31T00:00:00.000Z',
  }), /Temporarily unavailable/);
  assert.equal(requests, 3);
  assert.deepEqual(delays, [5, 10]);
});

test('Google reads do not retry an ordinary client error', async () => {
  const extension = await loadExtension('google-no-retry-400');
  let requests = 0;
  let sleeps = 0;
  const client = extension.createGoogleCalendarClient({
    authClient: { authorize: async () => 'access-token', destroy: () => {} },
    sleepImpl: async () => { sleeps += 1; },
    fetchImpl: async () => {
      requests += 1;
      return new Response(JSON.stringify({ error: { message: 'Bad request' } }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  await assert.rejects(() => client.readRange({
    calendarIds: ['primary'],
    timeMin: '2026-08-30T00:00:00.000Z',
    timeMax: '2026-08-31T00:00:00.000Z',
  }), /Bad request/);
  assert.equal(requests, 1);
  assert.equal(sleeps, 0);
});

test('cancelling Google sync aborts immediately without retrying', async () => {
  const extension = await loadExtension('google-cancel-no-retry');
  let requests = 0;
  let sleeps = 0;
  const client = extension.createGoogleCalendarClient({
    authClient: { authorize: async () => 'access-token', destroy: () => {} },
    sleepImpl: async () => { sleeps += 1; },
    fetchImpl: async (_url, options) => {
      requests += 1;
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          const error = new Error('Aborted');
          error.name = 'AbortError';
          reject(error);
        }, { once: true });
      });
    },
  });

  const pending = client.readRange({
    calendarIds: ['primary'],
    timeMin: '2026-08-30T00:00:00.000Z',
    timeMax: '2026-08-31T00:00:00.000Z',
  });
  await Promise.resolve();
  client.cancelSync();

  await assert.rejects(() => pending, /sync was cancelled/);
  assert.equal(requests, 1);
  assert.equal(sleeps, 0);
});
