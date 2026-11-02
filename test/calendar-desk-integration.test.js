const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function loadExtension() {
  const bundle = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}#calendar-desk-locks`);
}

function meeting() {
  return {
    key: 'primary:meeting-1', calendarId: 'primary', eventId: 'meeting-1', status: 'confirmed',
    parentString: '09:30–10:00 Weekly meeting · Google Calendar',
    sourceString: 'Google Calendar · Work · [Open](https://calendar.google.com/event)',
    details: { location: 'Meeting Room 3', description: 'Review Q3 launch plan.' },
  };
}

function sharedPlan() {
  const blocks = new Map();
  blocks.set('plan-today', { uid: 'plan-today', parentUid: 'page', order: 0,
    string: '[[Nautilus Log]] {{[[roam/render]]:((roam-render-Nautilus-Log-cljs))}}', open: true });
  Object.entries({ 'active-a': '{{[[TODO]]}} A', 'done-a': '{{[[DONE]]}} Done A',
    divider: '---', 'past-event': '05:00-06:00 Event', 'active-b': '{{[[TODO]]}} B' })
    .forEach(([uid, string], order) => blocks.set(uid, { uid, string, parentUid: 'plan-today', order, open: uid === 'done-a' }));
  const children = uid => [...blocks.values()].filter(b => b.parentUid === uid)
    .sort((a, b) => a.order - b.order).map((b, order) => ({ ...b, order }));
  const reorder = parentUid => children(parentUid).forEach((row, order) => blocks.set(row.uid, { ...blocks.get(row.uid), order }));
  let generated = 0, state = { version: 1, events: {} }, journal = null;
  const writes = [], hooks = {};
  return {
    blocks, writes, hooks, children,
    read: uid => blocks.get(uid)?.string ?? null,
    create: async ({ parentUid, order = 'last', string, uid: requestedUid }) => {
      const uid = requestedUid || `calendar-${++generated}`;
      assert.ok(!blocks.has(uid) && blocks.has(parentUid));
      writes.push(['create', uid]);
      blocks.set(uid, { uid, parentUid, order: order === 'last' ? children(parentUid).length : order, string, open: false });
      reorder(parentUid);
      return uid;
    },
    update: async (uid, string) => {
      assert.ok(blocks.has(uid)); writes.push(['update', uid]);
      blocks.set(uid, { ...blocks.get(uid), string });
    },
    remove: async uid => {
      writes.push(['remove', uid]);
      const parentUid = blocks.get(uid)?.parentUid, stack = [uid];
      while (stack.length) {
        const current = stack.pop();
        stack.push(...children(current).map(row => row.uid)); blocks.delete(current);
      }
      if (blocks.has(parentUid)) reorder(parentUid);
    },
    move: async ({ uid, parentUid, order }) => {
      writes.push(['move', uid, parentUid, order]);
      await hooks.beforeMove?.();
      const rows = children(parentUid).filter(row => row.uid !== uid);
      assert.ok(blocks.has(uid));
      rows.splice(order, 0, { ...blocks.get(uid), parentUid });
      rows.forEach((row, i) => blocks.set(row.uid, { ...row, parentUid, order: i }));
    },
    loadState: () => structuredClone(state), saveState: async next => { state = structuredClone(next); },
    loadJournal: () => structuredClone(journal), saveJournal: async next => { journal = structuredClone(next); },
    state: () => structuredClone(state), journal: () => structuredClone(journal),
  };
}

test('Calendar and Desk retain separate locks and a concurrent outline change fails Desk confirmation', { timeout: 10000 }, async t => {
  const extension = await loadExtension(), previousWindow = global.window, lockNames = [];
  const request = navigator.locks.request.bind(navigator.locks);
  global.window = {
    roamAlphaAPI: { graph: { name: 'synthetic-calendar-desk' } },
    navigator: { locks: { request(name, options, callback) {
      lockNames.push(name); return request(name, options, callback);
    } } },
  };
  const graph = sharedPlan();
  const original = graph.children('plan-today');
  const desk = extension.createDeskActions({ read: graph.children, readString: graph.read, move: graph.move });
  const calendar = extension.createCalendarReconciler({
    read: graph.read, children: graph.children, create: graph.create, update: graph.update,
    remove: graph.remove, move: graph.move, loadState: graph.loadState, saveState: graph.saveState,
    loadJournal: graph.loadJournal, saveJournal: graph.saveJournal,
  });
  t.after(() => {
    desk.destroy(); calendar.destroy();
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
  });
  let releaseMove, startedMove;
  const gate = new Promise(resolve => { releaseMove = resolve; });
  const started = new Promise(resolve => { startedMove = resolve; });
  graph.hooks.beforeMove = async () => { startedMove(); await gate; };
  const moving = desk.moveTask({ planUid: 'plan-today', uid: 'active-b', position: 'top' });
  // Fail promptly if the move rejects before reaching the intended concurrency point.
  await Promise.race([started, moving.then(() => { throw new Error('Move did not reach the gate'); })]);
  const rejection = assert.rejects(moving, /confirm the new block order|outline changed/);
  let result;
  try { result = await calendar.sync({ planUid: 'plan-today', events: [meeting()] }); }
  finally { releaseMove(); }
  await rejection;

  const parentUid = graph.state().events[meeting().key]?.parent?.uid;
  assert.equal(result.created, 1);
  assert.equal(graph.journal(), null);
  assert.equal(graph.children('plan-today').filter(row => row.uid === parentUid).length, 1);
  assert.equal(graph.read(parentUid), meeting().parentString);
  assert.ok(lockNames.includes('nautilus-log:outline:synthetic-calendar-desk'));
  assert.ok(lockNames.includes('nautilus-log:calendar-mapping:synthetic-calendar-desk'));
  assert.equal(graph.writes.filter(([kind]) => kind === 'move').length, 1, 'no blind retry or rollback');
  for (const row of original) {
    assert.equal(graph.read(row.uid), row.string);
    assert.equal(graph.blocks.get(row.uid).open, row.open);
  }
});
