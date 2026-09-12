const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ORIGINAL_ORDER = ['active-a', 'done-a', 'divider', 'past-event', 'active-b'];

async function loadExtension(label) {
  const bundle = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}#${label}-${Date.now()}`);
}

function meeting() {
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
  };
}

function sharedPlan() {
  const blocks = new Map();
  blocks.set('plan-today', {
    uid: 'plan-today',
    parentUid: 'page',
    order: 0,
    string: '[[Nautilus Log]]',
    open: true,
  });
  const strings = {
    'active-a': '{{[[TODO]]}} A',
    'done-a': '{{[[DONE]]}} Done A',
    divider: '---',
    'past-event': '05:00-06:00 Event',
    'active-b': '{{[[TODO]]}} B',
  };
  ORIGINAL_ORDER.forEach((uid, order) => {
    blocks.set(uid, {
      uid,
      parentUid: 'plan-today',
      order,
      string: strings[uid],
      open: uid === 'done-a',
    });
  });
  let generated = 0;
  let state = { version: 1, events: {} };
  let journal = null;
  const writes = [];
  const hooks = {};
  const children = (uid) => [...blocks.values()]
    .filter((block) => block.parentUid === uid)
    .sort((left, right) => Number(left.order) - Number(right.order))
    .map((block, order) => ({ ...block, order }));
  const rewriteOrder = (parentUid) => {
    children(parentUid).forEach((row, order) => {
      blocks.set(row.uid, { ...blocks.get(row.uid), order });
    });
  };
  return {
    blocks,
    writes,
    hooks,
    children,
    read: (uid) => blocks.get(uid)?.string ?? null,
    create: async ({ parentUid, order = 'last', string, uid: requestedUid }) => {
      const uid = requestedUid || `calendar-${++generated}`;
      writes.push(['create', uid]);
      await hooks.beforeCreate?.({ uid, parentUid, string });
      if (blocks.has(uid)) throw new Error('Duplicate UID');
      if (!blocks.has(parentUid)) throw new Error('Missing parent');
      blocks.set(uid, {
        uid,
        parentUid,
        order: order === 'last' ? children(parentUid).length : order,
        string,
        open: false,
      });
      rewriteOrder(parentUid);
      await hooks.afterCreate?.({ uid, parentUid, string });
      return uid;
    },
    update: async (uid, string) => {
      writes.push(['update', uid]);
      if (!blocks.has(uid)) throw new Error('Missing UID');
      blocks.set(uid, { ...blocks.get(uid), string });
    },
    remove: async (uid) => {
      writes.push(['remove', uid]);
      const parentUid = blocks.get(uid)?.parentUid;
      const stack = [uid];
      while (stack.length) {
        const current = stack.pop();
        for (const child of children(current)) stack.push(child.uid);
        blocks.delete(current);
      }
      if (parentUid && blocks.has(parentUid)) rewriteOrder(parentUid);
    },
    move: async ({ uid, parentUid, order }) => {
      writes.push(['move', uid, parentUid, order]);
      await hooks.beforeMove?.({ uid, parentUid, order });
      const rows = children(parentUid).filter((row) => row.uid !== uid);
      const target = Math.max(0, Math.min(Number(order) || 0, rows.length));
      const moving = blocks.get(uid);
      if (!moving) throw new Error('Missing UID');
      rows.splice(target, 0, { ...moving, parentUid });
      rows.forEach((row, nextOrder) => {
        blocks.set(row.uid, { ...blocks.get(row.uid), parentUid, order: nextOrder });
      });
      await hooks.afterMove?.({ uid, parentUid, order });
    },
    setOpen: async (uid, open) => {
      writes.push(['setOpen', uid, open]);
      if (!blocks.has(uid)) throw new Error('Missing UID');
      blocks.set(uid, { ...blocks.get(uid), open });
    },
    loadState: () => structuredClone(state),
    saveState: async (next) => { state = structuredClone(next); },
    loadJournal: () => structuredClone(journal),
    saveJournal: async (next) => { journal = structuredClone(next); },
    state: () => structuredClone(state),
    journal: () => structuredClone(journal),
  };
}

test('parallel Calendar mapping and Plan Tidy use different locks and do not mint a fake Undo', async (t) => {
  const extension = await loadExtension('calendar-tidy-parallel-locks');
  const previousWindow = global.window;
  const lockNames = [];
  const realRequest = navigator.locks.request.bind(navigator.locks);
  const host = {
    roamAlphaAPI: { graph: { name: 'synthetic-calendar-tidy' } },
    navigator: {
      locks: {
        request(name, options, callback) {
          lockNames.push({ name, mode: options?.mode });
          return realRequest(name, options, callback);
        },
      },
    },
  };
  global.window = host;
  t.after(() => {
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
  });

  const graph = sharedPlan();
  const notices = [];
  const actions = [];
  const tidy = extension.createPlanTidy({
    read: (uid) => graph.children(uid),
    move: graph.move,
    setOpen: graph.setOpen,
    notify: (message, intent) => notices.push({ message, intent }),
    notifyAction: (options) => actions.push(options),
  });
  const calendar = extension.createCalendarReconciler({
    read: graph.read,
    children: graph.children,
    create: graph.create,
    update: graph.update,
    remove: graph.remove,
    move: graph.move,
    loadState: graph.loadState,
    saveState: graph.saveState,
    loadJournal: graph.loadJournal,
    saveJournal: graph.saveJournal,
  });

  let releaseFirstMove;
  const firstMoveGate = new Promise((resolve) => {
    releaseFirstMove = resolve;
  });
  let moveStarts = 0;
  graph.hooks.beforeMove = async () => {
    moveStarts += 1;
    if (moveStarts === 1) await firstMoveGate;
  };

  const tidyRun = tidy.run({
    planUid: 'plan-today',
    settledUids: ['done-a', 'past-event'],
    language: 'en',
  });
  while (moveStarts === 0) await new Promise((resolve) => setImmediate(resolve));

  const calendarResult = await calendar.sync({
    planUid: 'plan-today',
    events: [meeting()],
  });
  releaseFirstMove();
  const tidyResult = await tidyRun;

  const outline = graph.children('plan-today').map((row) => row.uid);
  const mapping = graph.state().events[meeting().key];
  const parentUid = mapping?.parent?.uid;
  const parentRows = parentUid
    ? graph.children('plan-today').filter((row) => row.uid === parentUid)
    : [];

  assert.equal(calendarResult.created, 1);
  assert.equal(parentRows.length, 1);
  assert.equal(graph.journal(), null);
  assert.equal(Boolean(parentUid) && graph.read(parentUid) !== null, true);
  assert.ok(outline.includes(parentUid));

  const outlineLocks = lockNames.filter((row) => row.name.includes(':outline:'));
  const calendarLocks = lockNames.filter((row) => row.name.includes(':calendar-mapping:'));
  assert.ok(outlineLocks.length >= 1);
  assert.ok(calendarLocks.length >= 1);
  assert.equal(
    outlineLocks[0].name,
    `nautilus-log:outline:${encodeURIComponent('synthetic-calendar-tidy')}`,
  );
  assert.equal(
    calendarLocks[0].name,
    `nautilus-log:calendar-mapping:${encodeURIComponent('synthetic-calendar-tidy')}`,
  );
  assert.notEqual(outlineLocks[0].name, calendarLocks[0].name);

  // Different lock names allow Calendar to commit while Tidy is in-flight.
  // Tidy must fail closed on the changed outline rather than mint a token that
  // could later pretend to undo Calendar ownership. Host writes already issued
  // cannot be retracted: there is no CAS.
  assert.equal(tidyResult.ok, false);
  assert.equal(tidyResult.token, undefined);
  assert.equal(actions.length, 0);
  if (tidyResult.ok === false && tidyResult.token) {
    assert.fail('failed Tidy must not keep an Undo token');
  }

  const undo = await tidy.undo({
    planUid: 'plan-today',
    token: 'not-a-real-token',
    language: 'en',
  });
  assert.equal(undo.ok, false);
  assert.ok(undo.reason === 'expired' || undo.reason === 'changed' || undo.reason === 'failed');
  assert.equal(graph.children('plan-today').filter((row) => row.uid === parentUid).length, 1);
  assert.equal(graph.read(parentUid), meeting().parentString);
});
