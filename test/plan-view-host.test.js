const test = require('node:test');
const assert = require('node:assert/strict');
const load = () => import('../src/plan-view-host.js');

const classes = (...names) => ({ contains: name => names.includes(name) });
function nativeOwner(ownerClasses, caretClasses = []) {
  const owner = { classList: classes(...ownerClasses), querySelectorAll: () => { throw Error('Native descendants must not be scanned'); } };
  const carets = [{ classList: classes(...caretClasses), closest: () => owner }];
  const controls = { classList: classes('rm-block__controls'), querySelectorAll: () => carets };
  owner.children = [{ classList: classes('rm-block-main'), children: [controls] }];
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
  assert.equal(nativePlanFolded(nativeOwner(['rm-block--closed'], ['rm-caret-closed','rm-caret-hidden']).owner, false), false);
  assert.equal(nativePlanFolded(nativeOwner(['rm-block--closed'], ['rm-caret-closed']).owner, false), false);
});

test('decorative caret visibility cannot change a nonempty native plan fold', async () => {
  const { nativePlanFolded } = await load();
  for (const hidden of [[],['rm-caret-hidden']]) {
    assert.equal(nativePlanFolded(nativeOwner(['rm-block--closed'], ['rm-caret-closed',...hidden]).owner, true), true);
    assert.equal(nativePlanFolded(nativeOwner(['rm-block--open'], ['rm-caret-open',...hidden]).owner, true), false);
    assert.equal(nativePlanFolded(nativeOwner([], ['rm-caret-closed',...hidden]).owner), true);
  }
});

function hostFixture() {
  const { owner } = nativeOwner(['rm-block--closed'], ['rm-caret-closed','rm-caret-hidden']);
  const writes = [], observers = [];
  const element = () => {
    const attributes = new Map();
    return { getAttribute: key => attributes.get(key) ?? null,
      setAttribute: (key, value) => { attributes.set(key, value); writes.push([key,value]); } };
  };
  const control = element(), root = { ...element(), dataset: {}, isConnected: true,
    closest: selector => selector === '.roam-block-container' ? owner : null,
    querySelector: () => control };
  const host = { roamAlphaAPI: { graph: { name: 'watch-fixture' } },
    localStorage: { getItem: () => null },
    MutationObserver: class {
      constructor(callback) { this.callback=callback; this.disconnected=false; observers.push(this); }
      observe() { this.disconnected=false; }
      disconnect() { this.disconnected=true; }
    } };
  return { host, root, control, writes, observers, container: { closest: () => root } };
}

test('view host uses verified membership, retains it across failed reads and releases its subscription', async () => {
  const { createPlanViewHost } = await load(), fixture = hostFixture();
  let listener, stops = 0;
  const changes = [];
  const view = createPlanViewHost({ ...fixture, planUid: 'plan', onChange: value => changes.push(value),
    watchPlan: (_uid, callback) => { listener=callback;callback({ 'block/children': [] }); return () => stops++; } });
  view.register();
  assert.equal(fixture.root.getAttribute('data-nautilus-native-folded'), 'false');
  assert.equal(fixture.root.getAttribute('data-nautilus-plan-has-children'), 'false');
  listener({ 'block/children': [{ 'block/uid': 'task' }] });
  assert.equal(fixture.root.getAttribute('data-nautilus-native-folded'), 'true');
  assert.equal(fixture.root.getAttribute('data-nautilus-plan-has-children'), 'true');
  listener({ unavailable: true, 'block/children': [] });
  assert.equal(fixture.root.getAttribute('data-nautilus-native-folded'), 'true');
  assert.equal(fixture.root.getAttribute('data-nautilus-plan-has-children'), 'true');
  view.destroy();view.destroy();
  assert.equal(stops,1);
  fixture.writes.length=0;
  listener({ 'block/children': [] });
  assert.equal(fixture.writes.length,0);
  assert.deepEqual(changes,[{mode:'chart',folded:false},{mode:'chart',folded:true}]);
});

test('unchanged native signals and repeated registration do not repaint or re-notify', async () => {
  const { createPlanViewHost } = await load(), fixture = hostFixture();
  let calls=0;
  const options={ onViewChange: () => calls++ };
  const view=createPlanViewHost({ ...fixture, planUid:'plan', watchPlan: (_uid,callback) => {
    callback({ 'block/children': [{ 'block/uid':'task' }] });return () => {};
  } });
  view.register(options);assert.equal(calls,1);fixture.writes.length=0;
  for(let i=0;i<20;i++) { view.register(options);fixture.observers[0].callback(); }
  assert.equal(fixture.writes.length,0);
  assert.equal(calls,1);
  view.destroy();
});

test('toggle updates the current callback and paints the new mode once without rebinding', async () => {
  const { createPlanViewHost } = await load(), fixture = hostFixture();
  let subscriptions=0, oldCalls=0, newCalls=0;
  const view=createPlanViewHost({ ...fixture, planUid:'plan', watchPlan: (_uid,callback) => {
    subscriptions++; callback({ 'block/children': [{ 'block/uid':'task' }] }); return () => {};
  } });
  view.register({ onViewChange: () => oldCalls++ }); fixture.writes.length=0;
  view.toggle({ onViewChange: () => newCalls++ });
  assert.equal(subscriptions,1); assert.equal(oldCalls,1); assert.equal(newCalls,1);
  assert.deepEqual(fixture.writes.filter(([key])=>key==='data-nautilus-view'),[['data-nautilus-view','list']]);
  view.destroy();
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
