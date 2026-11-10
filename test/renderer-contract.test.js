const test = require('node:test');
const assert = require('node:assert/strict');
const r = require('../src/renderer-contract');
const { installRendererBridge } = require('../src/renderer-bridge');

const macro = uid => `{{[[roam/render]]:((${uid})) 22 15 6 "#T0" 20}}`;
test('renderer family discovery recognizes future plans without granting mutation authority', () => {
  for (const uid of r.LEGACY_UIDS) assert.equal(r.inspectRenderer(macro(uid)).kind, 'legacy');
  assert.equal(r.inspectRenderer(macro(r.CODE_UID)).mutable, true);
  const future = r.inspectRenderer(macro(`roam-render-Nautilus-Log-r${r.REVISION + 1}-cljs`));
  assert.equal(future.recognized, true); assert.equal(future.kind, 'newer'); assert.equal(future.mutable, false);
  for (const value of [`\`${macro(r.CODE_UID)}\``, `\`\`\`clojure\n${macro(r.CODE_UID)}\n\`\`\``]) assert.equal(r.inspectRenderer(value).recognized, false);
  assert.equal(r.rendererIdentity(`${r.CODE_UID}-foreign`).kind, 'unsupported');
  assert.equal(r.inspectRenderer(macro(r.CODE_UID) + ' {{[[roam/render]]:((foreign-code))}}').kind, 'ambiguous');
  assert.equal(r.inspectRenderer(macro(r.CODE_UID).replace('22 15', '(do stuff) 15')).mutable, false);
});

test('migration replaces exactly the old UID and retains Unicode prefixes, parameters and suffix text', () => {
  const before = '🌙 [[My Log]] ' + macro(r.LEGACY_UIDS[0]) + ' #review';
  const after = r.migrateRendererReference(before);
  assert.equal(after.string, before.replace(r.LEGACY_UIDS[0], r.CODE_UID));
  assert.deepEqual(r.inspectRenderer(after.string).invocation.args, [22,15,6,'#T0',20]);
  assert.equal(r.migrateRendererReference(after.string).changed, false);
  for (const text of [macro(`roam-render-Nautilus-Log-r${r.REVISION + 1}-cljs`), macro(r.CODE_UID) + macro(r.LEGACY_UIDS[0]), '`'+macro(r.LEGACY_UIDS[0])+'`']) {
    assert.throws(() => r.migrateRendererReference(text), /unsupported|newer|ambiguous/);
  }
});

test('same-revision divergence and newer source content are never installation authority', () => {
  const expected=`\`\`\`clojure\n ;; nautilus-renderer ${r.REVISION}\n(ns ${r.NAMESPACE}) \`\`\``;
  assert.equal(r.inspectRendererSource(null, expected).state, 'absent');
  assert.equal(r.inspectRendererSource(expected, expected).state, 'current');
  assert.equal(r.inspectRendererSource(expected+' ', expected).state, 'mismatch');
  assert.equal(r.inspectRendererSource(expected.replace(`renderer ${r.REVISION}`,`renderer ${r.REVISION + 1}`), expected).state, 'newer');
  assert.equal(r.inspectRendererSource('foreign text', expected).state, 'mismatch');
});

function bridgeFixture(host = {}) {
  const calls = [], provider = {}, scope = { provider, graph: 'fixture' };
  host.roamAlphaAPI = provider;
  const services = {
    readPlan: () => ({ old: false }), watchPlan: () => () => {},
    registerDeskHost: value => calls.push(['register', value.container]),
    openDesk: value => calls.push(['open', value.container]),
    closeDeskHost: value => calls.push(['close', value]),
    toggleChartHelp: value => calls.push(['help', value.anchor]),
    closeChartHelp: value => calls.push(['help-close', value]),
    syncCalendarPlan: value => calls.push(['calendar', value.planUid]),
    createRendererPlanSession: options => { const value = { options, destroyed:false, destroy() { value.destroyed = true; } }; return value; },
  };
  const handle = installRendererBridge({ host, core: { version:2 }, taskCore: {}, services, getScope: () => scope,
    canMutatePlan: (uid, family) => uid === family });
  handle.setReady(true);
  return { host, handle, calls, scope };
}
const node = revision => ({ closest: () => revision ? { getAttribute: () => String(revision) } : null });

test('legacy cleanup cannot close an r2 Desk or Help, while legacy history gets real read services', () => {
  const f = bridgeFixture(), current = node(r.REVISION), legacy = node(1);
  assert.notEqual(f.host.nautilusLogExtensionData, f.host[r.BRIDGE_KEY]);
  assert.deepEqual(f.host.nautilusLogExtensionData.readPlan(), { old:false });
  f.handle.bridge.registerDeskHost({ container:current });
  f.host.nautilusLogExtensionData.closeDeskHost(current);
  f.host.nautilusLogExtensionData.openDesk({ container:current });
  f.handle.bridge.toggleChartHelp({ anchor:current });
  f.host.nautilusLogExtensionData.closeChartHelp(current);
  assert.deepEqual(f.calls.map(row=>row[0]), ['register','help']);
  f.host.nautilusLogExtensionData.registerDeskHost({ container:legacy });
  f.host.nautilusLogExtensionData.closeDeskHost(legacy);
  assert.deepEqual(f.calls.slice(-2).map(row=>row[0]), ['register','close']);
  const session = f.handle.bridge.createRendererPlanSession({ planUid:'current' });
  const captured = session.options.getProvider();
  f.host.nautilusLogExtensionData = { running:false, watchPlan: () => { throw Error('legacy must not own r2 reads'); } };
  assert.equal(session.options.getProvider().subscribe, captured.subscribe);
  assert.equal(session.options.getProvider().running, true);
  f.handle.destroy(); assert.equal(session.destroyed,true);
});

test('a stale owner cannot stop or close the replacement bridge, even when counters could repeat', () => {
  const host = {}, old = bridgeFixture(host), current = node(r.REVISION);
  old.handle.bridge.registerDeskHost({ container:current });
  const next = bridgeFixture(host);
  next.handle.bridge.registerDeskHost({ container:current });
  old.handle.bridge.closeDeskHost(current); old.handle.destroy();
  assert.equal(host[r.BRIDGE_KEY], next.handle.bridge);
  assert.equal(host[r.BRIDGE_KEY].running,true);
  assert.equal(host.nautilusLogExtensionData, next.handle.legacy);
  assert.equal(host.nautilusLogExtensionData.running,true);
  assert.deepEqual(next.calls.map(row=>row[0]), ['register']);
  next.handle.destroy();
});

test('foreign legacy globals are neither replaced nor stopped; newer plan mutation is refused', async () => {
  const legacy = { running:true }, core = {}, host = { nautilusLogExtensionData:legacy, nautilusLogCore:core };
  const f = bridgeFixture(host);
  assert.equal(host.nautilusLogExtensionData,legacy); assert.equal(host.nautilusLogCore,core);
  await assert.rejects(f.handle.bridge.syncCalendarPlan({ planUid:'newer' }),/cannot safely/);
  await f.handle.bridge.syncCalendarPlan({planUid:'current'});
  f.handle.destroy(); assert.equal(legacy.running,true); assert.equal(host.nautilusLogCore,core);
});
