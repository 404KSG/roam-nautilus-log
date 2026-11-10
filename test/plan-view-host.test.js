const test = require('node:test');
const assert = require('node:assert/strict');
const load = () => import('../src/plan-view-host.js');

const classes = (...names) => ({ contains: name => names.includes(name) });
function nativeOwner(ownerClasses, caretClasses = []) {
  const owner = { classList: classes(...ownerClasses), querySelectorAll: () => carets };
  const carets = [{ classList: classes(...caretClasses), closest: () => owner }];
  return { owner, carets };
}

test('native folding uses only the owning surface, including caret-only older hosts', async () => {
  const { nativePlanFolded } = await load();
  assert.equal(nativePlanFolded(null), false);
  assert.equal(nativePlanFolded(nativeOwner(['rm-block--closed'], ['rm-caret-closed']).owner), true);
  assert.equal(nativePlanFolded(nativeOwner(['rm-block--open'], ['rm-caret-closed']).owner), false);
  assert.equal(nativePlanFolded(nativeOwner([], ['rm-caret-closed']).owner), true);
  assert.equal(nativePlanFolded(nativeOwner([], ['rm-caret-open']).owner), false);
  const { owner, carets } = nativeOwner(['rm-block--open'], ['rm-caret-open']);
  carets.unshift({ classList: classes('rm-caret-closed'), closest: () => ({}) });
  assert.equal(nativePlanFolded(owner), false, 'a folded descendant cannot fold the plan');
});

test('a childless closed native block retains access to its view control', async () => {
  const { nativePlanFolded } = await load();
  assert.equal(nativePlanFolded(nativeOwner(['rm-block--closed'], ['rm-caret-closed','rm-caret-hidden']).owner), false);
});

test('view preference identity includes graph, plan and local render surface', async () => {
  const { planViewStorageKey } = await load();
  const keys = [planViewStorageKey('a','plan'),planViewStorageKey('b','plan'),planViewStorageKey('a','other'),planViewStorageKey('a','plan',true)];
  assert.equal(new Set(keys).size, 4);
  assert.notEqual(planViewStorageKey('a:b','c'), planViewStorageKey('a','b:c'));
});

test('only an explicit valid new view preference selects List', async () => {
  const { readPlanView, planViewStorageKey } = await load();
  const values = new Map(), storage = { getItem: key => values.get(key) ?? null };
  values.set('nautilus-log:desk-view:v1:graph:plan', 'false');
  values.set('nautilus-log:collapsed:v2:plan:main', 'true');
  assert.equal(readPlanView(storage,'graph','plan'), 'chart');
  values.set(planViewStorageKey('graph','plan'), 'list');
  assert.equal(readPlanView(storage,'graph','plan'), 'list');
  assert.equal(readPlanView(storage,'other-graph','plan'), 'chart');
  assert.equal(readPlanView(storage,'graph','plan',true), 'chart');
  values.set(planViewStorageKey('graph','plan'), 'invalid');
  assert.equal(readPlanView(storage,'graph','plan'), 'chart');
});

test('unavailable or throwing storage still produces a usable Chart view', async () => {
  const { readPlanView } = await load();
  assert.equal(readPlanView(undefined,'graph','plan'), 'chart');
  assert.equal(readPlanView({ getItem() { throw Error('blocked'); } },'graph','plan'), 'chart');
});
