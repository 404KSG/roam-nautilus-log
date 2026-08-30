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
