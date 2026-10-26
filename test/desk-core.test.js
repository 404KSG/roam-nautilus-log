const test = require('node:test');
const assert = require('node:assert/strict');
const { projectDeskTasks, deskPreview, reconcileDeskSelection, stepDeskSelection, deskShortcut } = require('../src/desk-core');

const child = (uid, string, order, refs = []) => ({
  'block/uid': uid, 'block/string': string, 'block/order': order, 'block/refs': refs,
});
const snapshot = (children) => ({
  'block/uid': 'plan-desk',
  'block/string': '[[Nautilus Log]] {{[[roam/render]]:((roam-render-Nautilus-Log-cljs))}}',
  'block/children': children,
});
const tasks = (...uids) => uids.map((uid) => ({ uid }));

test('Desk uses direct unfinished tasks, keeps outline order and includes unscheduled work', () => {
  const input = snapshot([
    child('later', '{{[[TODO]]}} Long prompt log 9999m', 4),
    child('done', '{{[[DONE]]}} Finished 20m', 0),
    child('event', '{{[[TODO]]}} 11:00-12:00 Meeting', 1),
    child('first', '{{[[TODO]]}} First task 30m', 2),
    child('divider', '---', 3),
    child('implicit', 'Implicit task', 5),
    child('blank', '', 6),
  ]);
  input['block/children'][3]['block/children'] = [child('nested', '{{[[TODO]]}} Not a card', 0)];
  const before = JSON.stringify(input);
  const result = projectDeskTasks(input, 'plan-desk', { fallbackMinutes: 25 });
  assert.deepEqual(result.map(({ uid }) => uid), ['first', 'later', 'implicit']);
  assert.equal(result[1].plannedMinutes, 9999);
  assert.equal(result[2].plannedMinutes, 25);
  assert.equal(JSON.stringify(input), before);
});

test('Desk preserves local wrapper UID and inherited reference state without changing ownership', () => {
  const sources = new Map([
    ['source-done', '{{[[DONE]]}} Reusable source'],
    ['source-todo', '{{[[TODO]]}} Reusable prompt 40m'],
    ['source-link', '((source-todo))'],
  ]);
  const result = projectDeskTasks(snapshot([
    child('hidden', '((source-done))', 0),
    child('reopened', '{{[[TODO]]}} ((source-done)) 15m', 1),
    child('wrapper', '((source-link))', 2),
  ]), 'plan-desk', { readString: (uid) => sources.get(uid) || '' });
  assert.deepEqual(result.map(({ uid }) => uid), ['reopened', 'wrapper']);
  assert.equal(result[0].statusOwnerUid, 'reopened');
  assert.equal(result[1].statusOwnerUid, 'source-todo');
  assert.equal(result[1].sourceUid, 'source-link');
});

test('invalid or unavailable snapshots are not successful empty desks', () => {
  for (const value of [null, { unavailable: true }, { missing: true }, {}, snapshot(null)]) {
    assert.throws(() => projectDeskTasks(value, 'plan-desk'));
  }
  assert.throws(() => projectDeskTasks(snapshot([]), 'another-plan'));
  assert.throws(() => projectDeskTasks({ ...snapshot([]), 'block/string': 'Just a heading' }, 'plan-desk'));
  assert.throws(() => projectDeskTasks(snapshot([child('bad', 42, 0)]), 'plan-desk'));
  assert.throws(() => projectDeskTasks(snapshot([child('bad', 'Task', NaN)]), 'plan-desk'));
  assert.throws(() => projectDeskTasks(snapshot([child('same', 'A', 0), child('same', 'B', 1)]), 'plan-desk'));
  assert.deepEqual(projectDeskTasks(snapshot([]), 'plan-desk'), []);
});

test('preview is bounded plain text, excludes CLOCK infrastructure, and retains completed child logs', () => {
  const result = deskPreview([
    { string: 'LOGBOOK::', order: 0 },
    { string: '{{[[DONE]]}} Earlier prompt [[Context]]', order: 2 },
    { string: '{{[[TODO]]}} New request', order: 3 },
    { string: 'Hidden third line', order: 4 },
    { string: '', order: 1 },
    { string: 'CLOCK: [2026-10-26 Mon 10:00]', order: 5 },
  ]);
  assert.deepEqual(result, ['☑ Earlier prompt Context', '☐ New request']);
  assert.equal(deskPreview([{ string: 'x'.repeat(300), order: 0 }])[0].length, 160);
  assert.deepEqual(deskPreview([{ string: '<img onerror=alert(1)>', order: 0 }]), ['<img onerror=alert(1)>']);
});

test('selection is UID-based: keep edited/reordered card, then successor, predecessor, or overview', () => {
  assert.equal(reconcileDeskSelection(tasks('a', 'b', 'c'), tasks('c', 'b', 'a'), 'b'), 'b');
  assert.equal(reconcileDeskSelection(tasks('a', 'b', 'c'), tasks('a', 'c'), 'b'), 'c');
  assert.equal(reconcileDeskSelection(tasks('a', 'b', 'c'), tasks('a'), 'c'), 'a');
  assert.equal(reconcileDeskSelection(tasks('a'), tasks('new'), 'a'), 'new');
  assert.equal(reconcileDeskSelection(tasks('a'), [], 'a'), null);
  assert.equal(reconcileDeskSelection([], tasks('a'), null), null, 'opening Desk must not auto-focus the first task');
});

test('previous/next wrap within this Desk and never synthesize a task', () => {
  assert.equal(stepDeskSelection(tasks('a', 'b', 'c'), 'a', -1), 'c');
  assert.equal(stepDeskSelection(tasks('a', 'b', 'c'), 'c', 1), 'a');
  assert.equal(stepDeskSelection(tasks('a'), 'a', 1), 'a');
  assert.equal(stepDeskSelection([], 'a', 1), null);
  assert.equal(stepDeskSelection(tasks('a'), null, 1), null);
});

test('Desk shortcuts match the supplied Desk screenshot and respect IME, nested handlers, and other chords', () => {
  assert.equal(deskShortcut({ altKey: true, code: 'Comma', key: '≤' }), 'next');
  assert.equal(deskShortcut({ altKey: true, code: 'Period', key: '≥' }), 'previous');
  assert.equal(deskShortcut({ key: 'Escape' }), 'back');
  for (const patch of [{ isComposing: true }, { keyCode: 229 }, { defaultPrevented: true }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }]) {
    assert.equal(deskShortcut({ altKey: true, code: 'Comma', ...patch }), null);
  }
  assert.equal(deskShortcut({ code: 'ArrowLeft', key: 'ArrowLeft' }), null);
  assert.equal(deskShortcut({ code: 'Comma', key: ',' }), null);
});
