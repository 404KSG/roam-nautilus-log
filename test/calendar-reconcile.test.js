const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function loadExtension(label) {
  const bundle = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}#${label}-${Date.now()}`);
}

function graphHarness() {
  let generated = 0;
  let state = { version: 1, events: {} };
  const blocks = new Map([
    ['plan-today', { uid: 'plan-today', parentUid: 'page', order: 0, string: '[[Nautilus Log]]' }],
    ['plan-tomorrow', { uid: 'plan-tomorrow', parentUid: 'page-2', order: 0, string: '[[Nautilus Log]]' }],
  ]);
  const children = (uid) => [...blocks.values()]
    .filter((block) => block.parentUid === uid)
    .sort((left, right) => Number(left.order) - Number(right.order));
  const read = (uid) => blocks.get(uid)?.string ?? null;
  const create = async ({ parentUid, order = 'last', string }) => {
    const uid = `calendar-${++generated}`;
    blocks.set(uid, {
      uid,
      parentUid,
      order: order === 'last' ? children(parentUid).length : order,
      string,
    });
    return uid;
  };
  const update = async (uid, string) => {
    blocks.set(uid, { ...blocks.get(uid), string });
  };
  const removeTree = (uid) => {
    children(uid).forEach((child) => removeTree(child.uid));
    blocks.delete(uid);
  };
  const move = async ({ uid, parentUid, order }) => {
    blocks.set(uid, { ...blocks.get(uid), parentUid, order });
  };
  return {
    blocks,
    children,
    read,
    create,
    update,
    remove: async (uid) => removeTree(uid),
    move,
    loadState: () => state,
    saveState: async (next) => { state = structuredClone(next); },
    setState: (next) => { state = structuredClone(next); },
    state: () => state,
  };
}

function meeting(overrides = {}) {
  return {
    key: 'primary:meeting-1',
    calendarId: 'primary',
    eventId: 'meeting-1',
    status: 'confirmed',
    parentString: '09:30–10:00 Weekly meeting · Google Calendar',
    sourceString: 'Google Calendar · Work · [Open](https://calendar.google.com/event)',
    details: {
      location: 'Meeting Room 3',
      description: 'Review Q3 launch plan.',
    },
    ...overrides,
  };
}

function googleTask(overrides = {}) {
  return {
    key: 'task:my-tasks:task-1',
    taskListId: 'my-tasks',
    taskId: 'task-1',
    resourceType: 'google-task',
    status: 'needsAction',
    parentString: '{{[[TODO]]}} Submit report 25m · Google Calendar',
    sourceString: 'Google Tasks · My Tasks',
    details: {
      location: '',
      description: 'Attach the final PDF.',
    },
    ...overrides,
  };
}

test('first sync writes a compact managed subtree and a stable mapping', async () => {
  const extension = await loadExtension('calendar-create');
  const graph = graphHarness();
  const reconciler = extension.createCalendarReconciler(graph);

  const result = await reconciler.sync({ planUid: 'plan-today', events: [meeting()] });

  assert.deepEqual(result, {
    created: 1,
    updated: 0,
    removed: 0,
    localKept: 0,
    skipped: 0,
  });
  const mapping = graph.state().events['primary:meeting-1'];
  assert.equal(graph.read(mapping.parent.uid), '09:30–10:00 Weekly meeting · Google Calendar');
  assert.equal(graph.read(mapping.source.uid), 'Google Calendar · Work · [Open](https://calendar.google.com/event)');
  assert.equal(graph.read(mapping.details.location.uid), 'Meeting Room 3');
  assert.equal(graph.read(mapping.details.description.uid), 'Review Q3 launch plan.');
  assert.equal(mapping.planUid, 'plan-today');
  assert.equal(graph.children('plan-today').length, 1);
  assert.deepEqual(graph.children(mapping.parent.uid).map((row) => row.uid), [mapping.source.uid]);
});

test('safe sync protects local edits and user children; force refresh updates only managed strings', async () => {
  const extension = await loadExtension('calendar-safe-merge');
  const graph = graphHarness();
  const reconciler = extension.createCalendarReconciler(graph);
  await reconciler.sync({ planUid: 'plan-today', events: [meeting()] });
  const mapping = graph.state().events['primary:meeting-1'];

  await graph.update(mapping.parent.uid, '09:30–10:00 Weekly meeting — my note');
  const noteUid = await graph.create({ parentUid: mapping.parent.uid, string: 'My follow-up notes' });
  const incoming = meeting({
    parentString: '10:00–10:30 Weekly meeting · Google Calendar',
    details: { location: 'Meeting Room 5', description: 'Updated agenda.' },
  });
  const safe = await reconciler.sync({ planUid: 'plan-today', events: [incoming] });

  assert.equal(safe.localKept, 1);
  assert.equal(graph.read(mapping.parent.uid), '09:30–10:00 Weekly meeting — my note · Google Calendar');
  assert.equal(graph.read(mapping.details.location.uid), 'Meeting Room 5');
  assert.equal(graph.read(noteUid), 'My follow-up notes');

  const forced = await reconciler.sync({ planUid: 'plan-today', events: [incoming], force: true });
  assert.equal(forced.updated, 1);
  assert.equal(graph.read(mapping.parent.uid), '10:00–10:30 Weekly meeting · Google Calendar');
  assert.equal(graph.read(noteUid), 'My follow-up notes');
});

test('safe sync reports a locally deleted import separately so the UI can offer an accurate restore hint', async () => {
  const extension = await loadExtension('calendar-local-deletion');
  const graph = graphHarness();
  const reconciler = extension.createCalendarReconciler(graph);
  await reconciler.sync({ planUid: 'plan-today', events: [meeting()] });
  const mapping = graph.state().events['primary:meeting-1'];
  await graph.remove(mapping.parent.uid);

  const safe = await reconciler.sync({ planUid: 'plan-today', events: [meeting()] });
  assert.equal(safe.localKept, 1);
  assert.equal(safe.localDeleted, 1);
  assert.equal(safe.localChanged, undefined);
  assert.equal(graph.read(mapping.parent.uid), null);

  const forced = await reconciler.sync({
    planUid: 'plan-today',
    events: [meeting()],
    force: true,
  });
  assert.equal(forced.updated, 1);
  assert.equal(forced.localKept, 0);
  assert.equal(graph.children('plan-today').length, 1);
});

test('cancelled untouched imports are removed, while locally extended events remain', async () => {
  const extension = await loadExtension('calendar-cancel');
  const graph = graphHarness();
  const reconciler = extension.createCalendarReconciler(graph);
  await reconciler.sync({
    planUid: 'plan-today',
    events: [meeting(), meeting({
      key: 'primary:meeting-2',
      eventId: 'meeting-2',
      parentString: '11:00–11:30 Interview · Google Calendar',
    })],
  });
  const first = graph.state().events['primary:meeting-1'];
  const second = graph.state().events['primary:meeting-2'];
  await graph.create({ parentUid: second.parent.uid, string: 'Keep this local context' });

  const result = await reconciler.sync({
    planUid: 'plan-today',
    force: true,
    events: [
      { key: 'primary:meeting-1', calendarId: 'primary', eventId: 'meeting-1', status: 'cancelled' },
      { key: 'primary:meeting-2', calendarId: 'primary', eventId: 'meeting-2', status: 'cancelled' },
    ],
  });

  assert.equal(result.removed, 1);
  assert.equal(result.localKept, 1);
  assert.equal(graph.read(first.parent.uid), null);
  assert.equal(graph.read(second.parent.uid), '11:00–11:30 Interview · Google Calendar');
});

test('force refresh never deletes user descendants attached to a managed detail', async () => {
  const extension = await loadExtension('calendar-force-detail');
  const graph = graphHarness();
  const reconciler = extension.createCalendarReconciler(graph);
  await reconciler.sync({ planUid: 'plan-today', events: [meeting()] });
  const mapping = graph.state().events['primary:meeting-1'];
  const noteUid = await graph.create({
    parentUid: mapping.details.location.uid,
    string: 'Directions I want to keep',
  });

  const result = await reconciler.sync({
    planUid: 'plan-today',
    force: true,
    events: [meeting({ details: { location: '', description: 'Review Q3 launch plan.' } })],
  });

  assert.equal(result.localKept, 1);
  assert.equal(graph.read(mapping.details.location.uid), 'Meeting Room 3');
  assert.equal(graph.read(noteUid), 'Directions I want to keep');

  const cancelled = await reconciler.sync({
    planUid: 'plan-today',
    events: [{
      key: 'primary:meeting-1',
      calendarId: 'primary',
      eventId: 'meeting-1',
      status: 'cancelled',
    }],
  });
  assert.equal(cancelled.localKept, 1);
  assert.equal(graph.read(mapping.parent.uid), '09:30–10:00 Weekly meeting · Google Calendar');
  assert.equal(graph.read(noteUid), 'Directions I want to keep');
});

test('a moved event follows the clicked date plan without duplicating its block', async () => {
  const extension = await loadExtension('calendar-move');
  const graph = graphHarness();
  const reconciler = extension.createCalendarReconciler(graph);
  await reconciler.sync({ planUid: 'plan-today', events: [meeting()] });
  const parentUid = graph.state().events['primary:meeting-1'].parent.uid;

  const result = await reconciler.sync({
    planUid: 'plan-tomorrow',
    events: [meeting({ parentString: '09:00–09:30 Weekly meeting · Google Calendar' })],
  });

  assert.equal(result.updated, 1);
  assert.equal(graph.children('plan-today').length, 0);
  assert.deepEqual(graph.children('plan-tomorrow').map((row) => row.uid), [parentUid]);
  assert.equal(graph.state().events['primary:meeting-1'].planUid, 'plan-tomorrow');
});

test('cancellation treats a user-moved managed source as local structure', async () => {
  const extension = await loadExtension('calendar-moved-source');
  const graph = graphHarness();
  const reconciler = extension.createCalendarReconciler(graph);
  await reconciler.sync({ planUid: 'plan-today', events: [meeting()] });
  const mapping = graph.state().events['primary:meeting-1'];
  await graph.move({ uid: mapping.source.uid, parentUid: 'plan-today', order: 1 });

  const result = await reconciler.sync({
    planUid: 'plan-today',
    events: [{
      key: 'primary:meeting-1',
      calendarId: 'primary',
      eventId: 'meeting-1',
      status: 'cancelled',
    }],
  });

  assert.equal(result.localKept, 1);
  assert.equal(graph.read(mapping.parent.uid), '09:30–10:00 Weekly meeting · Google Calendar');
  assert.equal(graph.read(mapping.source.uid), mapping.source.lastSynced);
});

test('one Google Task is updated in place across pending, completed, and deleted states', async () => {
  const extension = await loadExtension('google-task-lifecycle');
  const graph = graphHarness();
  const reconciler = extension.createCalendarReconciler(graph);

  const created = await reconciler.sync({
    planUid: 'plan-today',
    events: [googleTask()],
  });
  const initial = graph.state().events['task:my-tasks:task-1'];
  const parentUid = initial.parent.uid;
  assert.equal(created.created, 1);
  assert.equal(graph.children('plan-today').length, 1);

  const completed = await reconciler.sync({
    planUid: 'plan-today',
    events: [googleTask({
      status: 'completed',
      parentString: '{{[[DONE]]}} Submit report 25m d15:20 · Google Calendar',
    })],
  });
  assert.equal(completed.updated, 1);
  assert.equal(graph.state().events['task:my-tasks:task-1'].parent.uid, parentUid);
  assert.equal(graph.read(parentUid), '{{[[DONE]]}} Submit report 25m d15:20 · Google Calendar');
  assert.equal(graph.children('plan-today').length, 1);

  const removed = await reconciler.sync({
    planUid: 'plan-today',
    events: [googleTask({ status: 'cancelled' })],
  });
  assert.equal(removed.removed, 1);
  assert.equal(graph.read(parentUid), null);
  assert.equal(graph.state().events['task:my-tasks:task-1'], undefined);
});

test('mapping state migrates in place and prunes only old missing Roam parents', async () => {
  const extension = await loadExtension('calendar-state-maintenance');
  const graph = graphHarness();
  const now = 200 * 24 * 60 * 60 * 1000;
  graph.setState({
    version: 1,
    events: {
      orphan: {
        planUid: 'plan-today',
        parent: { uid: 'missing-parent', lastSynced: 'Missing' },
        lastSeenAt: 1,
      },
      live: {
        planUid: 'plan-today',
        parent: { uid: 'live-parent', lastSynced: 'Live import' },
        lastSeenAt: 1,
      },
    },
  });
  graph.blocks.set('live-parent', {
    uid: 'live-parent',
    parentUid: 'plan-today',
    order: 0,
    string: 'Live import',
  });
  const reconciler = extension.createCalendarReconciler({
    ...graph,
    now: () => now,
    orphanRetentionMs: 90 * 24 * 60 * 60 * 1000,
  });

  const result = await reconciler.sync({ planUid: 'plan-today', events: [] });

  assert.deepEqual(result, {
    created: 0,
    updated: 0,
    removed: 0,
    localKept: 0,
    skipped: 0,
  });
  assert.equal(graph.state().version, 2);
  assert.equal(graph.state().events.orphan, undefined);
  assert.equal(graph.state().events.live.parent.uid, 'live-parent');
  assert.equal(graph.read('live-parent'), 'Live import');
});

test('a newly migrated orphan receives a grace period instead of disappearing immediately', async () => {
  const extension = await loadExtension('calendar-state-migration-grace');
  const graph = graphHarness();
  const observedAt = 300 * 24 * 60 * 60 * 1000;
  graph.setState({
    version: 1,
    events: {
      orphan: {
        planUid: 'plan-today',
        parent: { uid: 'missing-parent', lastSynced: 'Missing' },
      },
    },
  });
  const reconciler = extension.createCalendarReconciler({
    ...graph,
    now: () => observedAt,
  });

  await reconciler.sync({ planUid: 'plan-today', events: [] });

  assert.equal(graph.state().events.orphan.lastSeenAt, observedAt);
  assert.equal(graph.state().version, 2);
});
