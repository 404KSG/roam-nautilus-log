const test = require('node:test');
const assert = require('node:assert/strict');
const { projectDeskTasks, nativeDeskText, readDeskPreview, reconcileDeskSelection, stepDeskSelection, deskShortcut } = require('../src/desk-core');

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

test('native preview keeps completed children, follows open rows to depth two, and bounds its work', () => {
  const tree = {root: Array.from({length:20},(_,i)=>({uid:`note-${i}`,string:i===0?'{{[[DONE]]}} Earlier [[Context]]':`Prompt ${i}`,order:i,open:i!==1})),
    'note-0':[{uid:'nested',string:'Nested log',order:0,open:true}],
    nested:[{uid:'deep',string:'Not part of the preview',order:0}],
    'note-1':[{uid:'closed',string:'Collapsed child',order:0}]};
  const reads=[];
  const result=readDeskPreview('root',uid=>{reads.push(uid);return tree[uid]||[];});
  assert.equal(result.rows.length,11); assert.equal(result.more,true);
  assert.deepEqual(result.rows[0],{status:'DONE',text:'Earlier Context',depth:1});
  assert.deepEqual(result.rows[1],{status:null,text:'Nested log',depth:2});
  assert.equal(reads.includes('nested'),false); assert.equal(reads.includes('note-1'),false);
  assert.match(result.searchText,/Prompt 19/, 'search can match direct children beyond the preview budget');
  assert.deepEqual(nativeDeskText('<img onerror=alert(1)>'),{status:null,text:'<img onerror=alert(1)>'});
});

test('selection is UID-based: keep edited/reordered card, then successor, predecessor, or overview', () => {
  assert.equal(reconcileDeskSelection(tasks('a', 'b', 'c'), tasks('c', 'b', 'a'), 'b'), 'b');
  assert.equal(reconcileDeskSelection(tasks('a', 'b', 'c'), tasks('a', 'c'), 'b'), 'c');
  assert.equal(reconcileDeskSelection(tasks('a', 'b', 'c'), tasks('a'), 'c'), 'a');
  assert.equal(reconcileDeskSelection(tasks('a'), tasks('new'), 'a'), 'new');
  assert.equal(reconcileDeskSelection(tasks('a'), [], 'a'), null);
  assert.equal(reconcileDeskSelection([], tasks('a'), null), null, 'opening Desk must not auto-focus the first task');
});

test('native previous/next stop at the ends; the UI owns the separate new-note slot', () => {
  assert.equal(stepDeskSelection(tasks('a', 'b', 'c'), 'a', -1), null);
  assert.equal(stepDeskSelection(tasks('a', 'b', 'c'), 'c', 1), null);
  assert.equal(stepDeskSelection(tasks('a', 'b', 'c'), 'a', 1), 'b');
  assert.equal(stepDeskSelection(tasks('a'), 'a', 1), null);
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
