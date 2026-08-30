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

test('Google Tasks reads every list for one exact due date with completed and deleted rows', async () => {
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
      } else if (parsed.searchParams.get('pageToken') === 'next-task-page') {
        payload = { items: [{ id: 'task-2', status: 'completed' }] };
      } else {
        payload = {
          items: [{ id: 'task-1', status: 'needsAction' }],
          nextPageToken: 'next-task-page',
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
      { id: 'task-1', status: 'needsAction' },
      { id: 'task-2', status: 'completed' },
    ],
  }]);
  const taskRequest = requests.find(({ parsed }) => parsed.pathname.includes('/lists/work-list/tasks'));
  assert.equal(taskRequest.parsed.searchParams.get('dueMin'), '2026-08-30T00:00:00.000Z');
  assert.equal(taskRequest.parsed.searchParams.get('dueMax'), '2026-08-30T23:59:59.999Z');
  assert.equal(taskRequest.parsed.searchParams.get('showCompleted'), 'true');
  assert.equal(taskRequest.parsed.searchParams.get('showDeleted'), 'true');
  assert.equal(taskRequest.parsed.searchParams.get('showHidden'), 'true');
  assert.equal(requests.every(({ options }) => options.headers.Authorization === 'Bearer access-token'), true);
});
