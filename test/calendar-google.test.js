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
