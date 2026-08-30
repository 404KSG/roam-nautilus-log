const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function loadExtension(label) {
  const bundle = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}#${label}-${Date.now()}`);
}

test('Google events become compact fixed-event blocks and skip non-blocking rows', async () => {
  const extension = await loadExtension('calendar-normalize');
  const normalize = extension.normalizeGoogleCalendarEvents;
  assert.equal(typeof normalize, 'function');

  const rows = normalize({
    calendar: { id: 'work@example.com', summary: 'Work' },
    events: [
      {
        id: 'meeting-1',
        status: 'confirmed',
        summary: 'Weekly meeting',
        start: { dateTime: '2026-08-30T09:30:00+08:00' },
        end: { dateTime: '2026-08-30T10:00:00+08:00' },
        location: 'Meeting Room 3',
        description: '<b>Review</b> Q3 launch plan.\n\nBring notes.',
        hangoutLink: 'https://meet.google.com/abc-defg-hij',
        htmlLink: 'https://calendar.google.com/event?eid=meeting-1',
      },
      {
        id: 'all-day',
        status: 'confirmed',
        summary: 'Holiday',
        start: { date: '2026-08-30' },
        end: { date: '2026-08-31' },
      },
      {
        id: 'free',
        status: 'confirmed',
        transparency: 'transparent',
        summary: 'Optional focus',
        start: { dateTime: '2026-08-30T12:00:00+08:00' },
        end: { dateTime: '2026-08-30T12:30:00+08:00' },
      },
      {
        id: 'declined',
        status: 'confirmed',
        summary: 'Declined meeting',
        attendees: [{ self: true, responseStatus: 'declined' }],
        start: { dateTime: '2026-08-30T14:00:00+08:00' },
        end: { dateTime: '2026-08-30T14:30:00+08:00' },
      },
    ],
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].key, 'work@example.com:meeting-1');
  assert.equal(rows[0].parentString, '09:30–10:00 Weekly meeting · Google Calendar');
  assert.equal(
    rows[0].sourceString,
    'Google Calendar · Work · [Join](https://meet.google.com/abc-defg-hij) · [Open](https://calendar.google.com/event?eid=meeting-1)',
  );
  assert.deepEqual(rows[0].detailStrings, [
    'Meeting Room 3',
    'Review Q3 launch plan. Bring notes.',
  ]);
});

test('Google event links prefer the connected account without losing the original event target', async () => {
  const extension = await loadExtension('calendar-account-aware-open');
  const rows = extension.normalizeGoogleCalendarEvents({
    calendar: {
      id: 'primary',
      summary: 'Primary calendar',
      accountHint: 'connected@example.com',
    },
    events: [{
      id: 'meeting-account-aware',
      status: 'confirmed',
      summary: 'Account-aware meeting',
      start: { dateTime: '2026-08-30T17:00:00+08:00' },
      end: { dateTime: '2026-08-30T17:45:00+08:00' },
      htmlLink: 'https://www.google.com/calendar/event?eid=meeting-account-aware',
    }],
  });

  assert.equal(rows.length, 1);
  assert.equal(
    rows[0].sourceString,
    'Google Calendar · Primary calendar · [Open](https://www.google.com/calendar/event?eid=meeting-account-aware&authuser=connected%40example.com)',
  );
});

test('recurring instances use a stable original-start key and cancelled events remain reconcilable', async () => {
  const extension = await loadExtension('calendar-recurring');
  const rows = extension.normalizeGoogleCalendarEvents({
    calendar: { id: 'primary', summary: 'Calendar' },
    events: [
      {
        id: 'series-instance',
        recurringEventId: 'series',
        originalStartTime: { dateTime: '2026-08-30T08:00:00+08:00' },
        status: 'confirmed',
        summary: 'Moved standup',
        start: { dateTime: '2026-08-30T08:30:00+08:00' },
        end: { dateTime: '2026-08-30T08:45:00+08:00' },
      },
      {
        id: 'cancelled-1',
        status: 'cancelled',
      },
    ],
  });

  assert.equal(rows[0].key, 'primary:series-instance:2026-08-30T08:00:00+08:00');
  assert.deepEqual(rows[1], {
    key: 'primary:cancelled-1',
    calendarId: 'primary',
    eventId: 'cancelled-1',
    resourceType: 'calendar-event',
    status: 'cancelled',
    dateKey: '',
  });
});

test('dated Google Tasks become flexible TODO or DONE rows without inventing fixed times', async () => {
  const extension = await loadExtension('google-task-normalize');
  const rows = extension.normalizeGoogleTasks({
    taskList: { id: 'my-tasks', title: 'My Tasks' },
    date: '2026-08-30',
    defaultDuration: 25,
    tasks: [
      {
        id: 'pending-1',
        title: 'Submit report',
        notes: 'Attach the final PDF.',
        status: 'needsAction',
        due: '2026-08-30T00:00:00.000Z',
        webViewLink: 'https://tasks.google.com/task/pending-1',
      },
      {
        id: 'completed-1',
        title: 'Review document',
        status: 'completed',
        due: '2026-08-30T00:00:00.000Z',
        completed: '2026-08-30T01:00:00.000Z',
      },
      {
        id: 'undated',
        title: 'Someday',
        status: 'needsAction',
      },
      {
        id: 'tomorrow',
        title: 'Tomorrow',
        status: 'needsAction',
        due: '2026-08-31T00:00:00.000Z',
      },
      { id: 'deleted-1', deleted: true },
    ],
  });

  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], {
    key: 'task:my-tasks:pending-1',
    taskListId: 'my-tasks',
    taskId: 'pending-1',
    resourceType: 'google-task',
    status: 'needsAction',
    dateKey: '2026-08-30',
    parentString: '{{[[TODO]]}} Submit report 25m · Google Calendar',
    sourceString: 'Google Tasks · My Tasks · [Open](https://tasks.google.com/task/pending-1)',
    detailStrings: ['Attach the final PDF.'],
    details: { location: '', description: 'Attach the final PDF.' },
    dueDate: '2026-08-30',
    completed: '',
    updated: '',
  });
  assert.match(rows[1].parentString, /^\{\{\[\[DONE\]\]\}\} Review document 25m d\d{2}:\d{2} · Google Calendar$/);
  assert.deepEqual(rows[2], {
    key: 'task:my-tasks:deleted-1',
    taskListId: 'my-tasks',
    taskId: 'deleted-1',
    resourceType: 'google-task',
    status: 'cancelled',
    dateKey: '',
  });
});

test('safe managed-string decisions preserve local edits while force refresh overwrites them', async () => {
  const extension = await loadExtension('calendar-merge');
  const decide = extension.decideCalendarManagedChange;

  assert.deepEqual(decide({
    lastSynced: '09:30–10:00 Weekly meeting',
    current: '09:30–10:00 Weekly meeting',
    incoming: '10:00–10:30 Weekly meeting',
  }), { action: 'update', value: '10:00–10:30 Weekly meeting' });

  assert.deepEqual(decide({
    lastSynced: '09:30–10:00 Weekly meeting',
    current: '09:30–10:00 Weekly meeting — local note',
    incoming: '10:00–10:30 Weekly meeting',
  }), { action: 'keep-local', value: '09:30–10:00 Weekly meeting — local note' });

  assert.deepEqual(decide({
    lastSynced: '09:30–10:00 Weekly meeting',
    current: '09:30–10:00 Weekly meeting — local note',
    incoming: '10:00–10:30 Weekly meeting',
    force: true,
  }), { action: 'update', value: '10:00–10:30 Weekly meeting' });
});
