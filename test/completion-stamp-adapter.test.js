const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, deferred, flush } = require('./completion-stamp-test-utils.cjs');
const core = require('../src/completion-stamp-core');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

class Events {
  constructor() { this.listeners = new Map(); this.editors = []; this.selected = []; this.body = { tagName: 'BODY', closest: () => null }; }
  addEventListener(type, fn) { const set = this.listeners.get(type) || new Set(); set.add(fn); this.listeners.set(type, set); }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  fire(type, event = {}) { for (const fn of [...this.listeners.get(type) || []]) fn(event); }
  count() { return [...this.listeners.values()].reduce((n, set) => n + set.size, 0); }
  querySelectorAll(selector) { return selector.includes('block-highlight-blue') ? this.selected : this.editors; }
}
function target(uid, { ref = null, extraId = null } = {}) {
  const main = { querySelectorAll: () => extraId ? [node, { id: extraId, closest: () => main }] : [node] };
  const node = { id: `block-input-main-window-${uid}`, closest: selector => selector.includes('.rm-block-main') ? main : node };
  const reference = ref ? { getAttribute: () => ref, dataset: { uid: ref } } : null;
  const label = { querySelectorAll: () => [input], closest: selector => selector.includes('rm-block-ref') ? reference : main };
  const input = { disabled: false, matches: selector => selector === 'input[type="checkbox"]', closest: () => label };
  return { input, node, main };
}
const click = input => ({ isTrusted: true, target: input, button: 0, detail: 1 });
const key = target => ({ isTrusted: true, target, key: 'Enter', ctrlKey: true, keyCode: 13 });

async function setup(t, options = {}) {
  const f = await fixture(t, options);
  const document = new Events(), events = new Events(), timers = new Set(), registered = [], callbacks = new Set();
  f.host.document = document;
  f.host.addEventListener = events.addEventListener.bind(events);
  f.host.removeEventListener = events.removeEventListener.bind(events);
  f.host.setTimeout = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); return id; };
  f.host.clearTimeout = id => { clearTimeout(id); timers.delete(id); };
  const watchUid = lookup => { assert.equal(typeof lookup, 'string', 'watch lookup must use the native EDN form'); const m=/^\[:block\/uid "([\w-]+)"\]$/.exec(lookup); assert.ok(m, lookup); return m[1]; };
  const provider = { data: {
    addPullWatch(pattern, lookup, callback) {
      assert.equal(pattern, '[:block/string]');
      const item = { uid: watchUid(lookup), callback, removes: 0, gate: deferred() }; registered.push(item);
      const install = () => callbacks.add(item);
      item.release = () => { install(); item.gate.resolve(); };
      if (options.watch === 'delayed') return item.gate.promise;
      install();
      if (options.watch === 'sync-transition') { f.blocks.set(item.uid, core.doneMarkerString(f.blocks.get(item.uid))); callback(); }
      if (options.watch === 'reject-installed') return Promise.reject(Error('ambiguous registration'));
      if (options.watch === 'throw-installed') throw Error('ambiguous registration');
      return options.watch === 'null' ? null : undefined;
    },
    removePullWatch(pattern, lookup, callback) {
      assert.equal(pattern, '[:block/string]'); const uid=watchUid(lookup);
      const item=registered.find(r=>r.uid===uid && r.callback===callback); assert.ok(item); item.removes++; callbacks.delete(item);
      if (options.removeReject) return Promise.reject(Error('remove response lost'));
      return undefined;
    },
  } };
  if (options.watch === 'absent') provider.data = {};
  f.changeContext({ provider });
  const adapter = f.api.createCompletionStampAdapter({ writer: f.writer, host: f.host, document,
    read: uid => { options.beforeAdapterRead?.(uid); return f.blocks.has(uid) ? { uid, string: f.blocks.get(uid) } : null; },
    now: options.now || (() => new Date(2026, 10, 1, 10, 31)),
    observationTimeoutMs: options.observationTimeoutMs,
    preparationTimeoutMs: options.preparationTimeoutMs,
    monotonicNow: options.monotonicNow,
  });
  t.after(() => { adapter.destroy(); for (const timer of timers) clearTimeout(timer); });
  const nativeChange = (uid, string) => { f.blocks.set(uid, string); for (const item of [...callbacks]) if (item.uid===uid) item.callback(); };
  const toggle = uid => nativeChange(uid, f.blocks.get(uid).includes('TODO') ? core.doneMarkerString(f.blocks.get(uid)) : core.todoMarkerString(f.blocks.get(uid)));
  const setEnabled = value => { f.values.set('completion-stamps-enabled', value); events.fire('nautilus-log:settings-changed'); };
  return { ...f, document, events, timers, registered, callbacks, adapter, nativeChange, toggle, setEnabled };
}

test('a cold native commit after 750ms still stamps the first confirmed action',async t=>{
  const f=await setup(t);f.document.fire('click',click(target('task00001').input));
  await wait(850);f.toggle('task00001');await flush();await wait(10);
  assert.equal(f.blocks.get('task00001'),'{{[[DONE]]}} Task 30m d10:31');
  assert.equal(f.updates.length,1);assert.equal(f.timers.size,0);
});

test('an editor that settles after the old final poll is checked again without another toggle',async t=>{
  const f=await setup(t),node=target('task00001');
  const editor={...node.node,tagName:'TEXTAREA',value:f.blocks.get('task00001'),matches:()=>true};
  f.document.editors=[editor];f.document.fire('click',click(node.input));f.toggle('task00001');
  await wait(550);assert.equal(f.updates.length,0);editor.value=f.blocks.get('task00001');
  await wait(350);assert.equal(f.updates.length,1);assert.ok(f.blocks.get('task00001').endsWith(' d10:31'));
});

test('finite fallback reads cover a native commit after 400ms when watches are unavailable',async t=>{
  const f=await setup(t,{watch:'absent'});f.document.fire('click',click(target('task00001').input));
  await wait(600);f.toggle('task00001');await wait(300);
  assert.equal(f.updates.length,1);assert.ok(f.blocks.get('task00001').endsWith(' d10:31'));
});

test('confirmed completion gets a separate bounded opportunity to acquire the CLOCK lock',async t=>{
  const lock=deferred(),f=await setup(t,{lock});f.document.fire('click',click(target('task00001').input));f.toggle('task00001');
  await wait(850);lock.resolve();await flush();await wait(10);
  assert.equal(f.updates.length,1);assert.ok(f.blocks.get('task00001').endsWith(' d10:31'));
});

test('an issued slow write keeps its receipt and can be safely removed on reopening',async t=>{
  const f=await setup(t,{preparationTimeoutMs:30,writeTimeoutMs:2000,update:async(uid,string,blocks)=>{await wait(950);blocks.set(uid,string);}});
  const input=target('task00001').input;
  f.document.fire('click',click(input));f.toggle('task00001');await wait(1050);
  assert.equal(f.blocks.get('task00001'),'{{[[DONE]]}} Task 30m d10:31');
  assert.equal(f.values.get('completion-stamp-receipts')?.items?.length,1);
  f.document.fire('click',click(input));f.toggle('task00001');await wait(1050);
  assert.equal(f.blocks.get('task00001'),'{{[[TODO]]}} Task 30m');
  assert.equal(f.updates.length,2);assert.equal(f.timers.size,0);
});

for (const watch of ['undefined', 'null', 'sync-transition', 'reject-installed', 'throw-installed']) {
  test(`native registration ${watch} stamps once and removes the exact watch`, async t => {
    const f=await setup(t,{watch,removeReject:watch==='reject-installed'}), node=target('task00001');
    f.document.fire('click',click(node.input));
    if(watch!=='sync-transition') f.toggle('task00001');
    await flush(); await wait(5);
    assert.equal(f.blocks.get('task00001'),'{{[[DONE]]}} Task 30m d10:31');
    assert.equal(f.updates.length,1);
    assert.equal(f.registered[0].removes,1);
    assert.equal(f.callbacks.size,0);
    assert.equal(f.timers.size,0);
  });
}

for (const exit of ['disable','destroy','timeout']) {
  test(`late registration is removed after ${exit} rather than installed after cleanup`,async t=>{
    const f=await setup(t,{watch:'delayed',observationTimeoutMs:exit==='timeout'?30:undefined});
    f.document.fire('click',click(target('task00001').input));
    if(exit==='disable')f.setEnabled(false);
    else if(exit==='destroy')f.adapter.destroy();
    else await wait(60);
    assert.equal(f.registered[0].removes,0);
    f.registered[0].release();await flush();
    assert.equal(f.registered[0].removes,1);assert.equal(f.callbacks.size,0);assert.equal(f.updates.length,0);assert.equal(f.timers.size,0);
    if(exit!=='timeout')assert.equal(f.document.count(),0);
  });
}

test('without public watches finite post-event reads still confirm the native transition',async t=>{
  const f=await setup(t,{watch:'absent'});f.document.fire('click',click(target('task00001').input));f.toggle('task00001');
  await wait(25);assert.equal(f.updates.length,1);assert.equal(f.timers.size,0);
});

test('an observation deadline reports once and never backfills a later native change',async t=>{
  const f=await setup(t,{observationTimeoutMs:30});
  f.document.fire('click',click(target('task00001').input));await wait(60);
  f.toggle('task00001');await flush();await wait(10);
  assert.equal(f.blocks.get('task00001'),'{{[[DONE]]}} Task 30m');assert.equal(f.updates.length,0);
  assert.equal(f.notices.filter(n=>/in time/.test(n)).length,1);assert.equal(f.timers.size,0);assert.equal(f.callbacks.size,0);
});

test('a suspended timer cannot revive an expired observation or lock-waiting intent',async t=>{
  for(const stage of ['observation','preparation'])await t.test(stage,async st=>{
    let elapsed=0;const lock=stage==='preparation'?deferred():null;
    const f=await setup(st,{lock,monotonicNow:()=>elapsed});
    f.document.fire('click',click(target('task00001').input));
    if(lock){f.toggle('task00001');await flush();}
    elapsed=3000;
    if(lock)lock.resolve();else f.toggle('task00001');
    await flush();assert.equal(f.updates.length,0);assert.equal(f.saves.length,0);
    assert.equal(f.callbacks.size,0);assert.equal(f.timers.size,0);
  });
});

test('expiry before the writer microtask still reports the skipped follow-up',async t=>{
  let elapsed=0;const f=await setup(t,{monotonicNow:()=>elapsed});
  f.document.fire('click',click(target('task00001').input));f.toggle('task00001');elapsed=3000;
  await flush();assert.equal(f.updates.length,0);assert.equal(f.saves.length,0);
  assert.equal(f.notices.filter(n=>/in time/.test(n)).length,1);assert.equal(f.timers.size,0);
});

test('newer task text during confirmation is preserved with a visible skip reason',async t=>{
  const f=await setup(t);f.document.fire('click',click(target('task00001').input));f.toggle('task00001');
  f.blocks.set('task00001','{{[[DONE]]}} Edited during confirmation');await flush();
  assert.equal(f.updates.length,0);assert.equal(f.blocks.get('task00001'),'{{[[DONE]]}} Edited during confirmation');
  assert.equal(f.notices.filter(n=>/changed during confirmation/.test(n)).length,1);assert.equal(f.timers.size,0);
});

test('a slow confirming read cannot grant a new preparation window after observation expired',async t=>{
  let elapsed=0,slow=false;
  const f=await setup(t,{monotonicNow:()=>elapsed,beforeAdapterRead:()=>{if(slow)elapsed=3000;}});
  f.document.fire('click',click(target('task00001').input));slow=true;f.toggle('task00001');
  await flush();assert.equal(f.updates.length,0);assert.equal(f.saves.length,0);
  assert.equal(f.callbacks.size,0);assert.equal(f.timers.size,0);
});

test('an issued timeout remains unconfirmed and cannot issue a second stamp while the host is unresolved',async t=>{
  const gate=deferred(),f=await setup(t,{writeTimeoutMs:30,update:()=>gate.promise});
  const input=target('task00001').input;
  f.document.fire('click',click(input));f.toggle('task00001');await wait(60);
  assert.equal(f.updates.length,1);assert.equal(f.saves.length,0);assert.equal(f.callbacks.size,0);assert.equal(f.timers.size,0);
  f.document.fire('click',click(input));f.toggle('task00001');await flush();
  f.document.fire('click',click(input));f.toggle('task00001');await flush();
  assert.equal(f.updates.length,1);assert.equal(f.saves.length,0);
  gate.resolve();await flush();
});

test('off/on ABA, undo/redo and navigation invalidate lock-delayed gestures',async t=>{
  for(const exit of ['off-on','undo','redo','navigation'])await t.test(exit,async st=>{
    const lock=deferred(),f=await setup(st,{lock});f.document.fire('click',click(target('task00001').input));f.toggle('task00001');await flush();
    if(exit==='off-on'){f.setEnabled(false);f.setEnabled(true);}
    else if(exit==='navigation')f.events.fire('hashchange');
    else f.document.fire('keydown',{isTrusted:true,key:exit==='undo'?'z':'y',ctrlKey:true});
    lock.resolve();await flush();await wait(5);
    assert.equal(f.updates.length,0);assert.equal(f.saves.length,0);
  });
});

test('timeout prevents an unissued stamp waiting for the clock lock',async t=>{
  const lock=deferred(),f=await setup(t,{lock,preparationTimeoutMs:30});f.document.fire('click',click(target('task00001').input));f.toggle('task00001');
  await wait(60);lock.resolve();await flush();assert.equal(f.updates.length,0);assert.equal(f.timers.size,0);
});

test('newer toggle supersedes an earlier gesture even when text returns to the same DONE value',async t=>{
  const lock=deferred();let minute=30;
  const f=await setup(t,{lock,now:()=>new Date(2026,10,1,10,++minute)}),input=target('task00001').input;
  for(let i=0;i<3;i++){f.document.fire('click',click(input));f.toggle('task00001');await flush();}
  lock.resolve();await flush();await wait(5);
  assert.equal(f.blocks.get('task00001'),'{{[[DONE]]}} Task 30m d10:33');assert.equal(f.updates.length,1);
});

test('keyboard multi-selection freezes one instant and rejects a malformed target set as a unit',async t=>{
  let samples=0;const f=await setup(t,{now:()=>new Date(2026,10,1,10,31+samples++)});
  f.blocks.set('task00002','{{[[TODO]]}} Second');
  f.document.selected=[target('task00001').node,target('task00002').node];
  f.document.fire('keydown',key(f.document.body));f.toggle('task00001');f.toggle('task00002');
  await flush();await wait(5);
  assert.equal(samples,1);assert.equal(f.updates.length,2);assert.ok(f.updates.every(r=>r.string.endsWith(' d10:31')));
  f.document.selected=[target('task00001').node,{id:'block-input-malformed'}];
  f.document.fire('keydown',key(f.document.body));await flush();assert.equal(f.registered.length,2);
  f.document.selected=Array.from({length:21},()=>target('task00001').node);
  f.document.fire('keydown',key(f.document.body));assert.equal(f.registered.length,2);
  f.document.selected=[target('task00001').node];
  f.document.fire('keydown',key({tagName:'TEXTAREA',id:'settings-search',closest:()=>null}));
  assert.equal(f.registered.length,2, 'an unrelated input cannot borrow hidden selected tasks');
});

test('selecting a parent does not admit its unselected descendants', async t => {
  const f = await setup(t), parent = target('parent001');
  f.blocks.set('parent001', '{{[[TODO]]}} Parent'); f.blocks.set('child0001', '{{[[TODO]]}} Child');
  f.document.selected = [{ querySelector: () => parent.main }];
  f.document.fire('keydown', key(f.document.body));
  f.toggle('parent001'); f.toggle('child0001'); await flush(); await wait(5);
  assert.deepEqual(f.updates.map(row => row.uid), ['parent001']);
  assert.equal(f.blocks.get('child0001'), '{{[[DONE]]}} Child');
});

test('source ref identity, hyphenated UIDs and raw ambiguity are validated before observing',async t=>{
  const f=await setup(t);f.blocks.set('abc-def12','{{[[TODO]]}} Source');
  f.document.fire('click',click(target('task00001',{ref:'abc-def12'}).input));f.toggle('abc-def12');await flush();await wait(5);
  assert.equal(f.updates[0].uid,'abc-def12');assert.equal(f.blocks.get('task00001'),'{{[[TODO]]}} Task 30m');
  f.document.fire('click',click(target('task00001',{extraId:'bad-id'}).input));await flush();
  assert.equal(f.registered.length,1);
});

test('trusted input clicks deduplicate events; label clicks, synthetic gestures and IME are not treated as completion',async t=>{
  const f=await setup(t),node=target('task00001');
  f.document.fire('click',{...click(node.input),isTrusted:false});
  f.document.fire('click',{...click(node.input),target:{matches:()=>false}});
  f.document.fire('keydown',{...key(node.node),isComposing:true});
  f.document.fire('keydown',{...key(node.node),repeat:true});
  assert.equal(f.registered.length,0);
  const event={...click(node.input),detail:0};f.document.fire('click',event);f.document.fire('click',event);f.toggle('task00001');
  await flush();await wait(5);assert.equal(f.registered.length,1);assert.equal(f.updates.length,1);
});

test('editable buffers and composition are distinct from committed graph data, and cleanup removes all listeners',async t=>{
  const f=await setup(t),node=target('task00001');
  const editor={...node.node,value:'{{[[TODO]]}} Unsaved text',matches:()=>true};f.document.editors=[editor];
  f.document.fire('click',click(node.input));assert.equal(f.registered.length,0);assert.ok(f.notices.some(n=>/uncommitted/.test(n)));
  editor.value=f.blocks.get('task00001');f.document.fire('compositionstart',{target:editor});
  assert.equal(f.writer.isEditorSafe('task00001',editor.value),false);
  f.document.fire('click',click(node.input));assert.equal(f.registered.length,0);
  f.document.fire('compositionend',{target:editor});
  f.document.fire('keydown',key(editor));f.toggle('task00001');
  await flush();assert.equal(f.updates.length,0,'wait for host to commit its textarea');
  editor.value=f.blocks.get('task00001');await wait(65);
  assert.equal(f.updates.length,1);
  f.adapter.destroy();assert.equal(f.document.count(),0);assert.equal(f.events.count(),0);
  assert.equal(f.writer.isEditorSafe('task00001',editor.value),true);
});

test('a shortcut may stamp a newly committed textarea only after the host confirms that exact buffer', async t => {
  for (const committed of [true, false]) await t.test(String(committed), async st => {
    const f = await setup(st,{observationTimeoutMs:100}), node = target('task00001');
    const editor = { ...node.node, tagName: 'TEXTAREA', value: '{{[[TODO]]}} New user text', matches: () => true };
    f.document.editors = [editor];
    f.document.fire('keydown', key(editor));
    f.nativeChange('task00001', committed ? '{{[[DONE]]}} New user text' : '{{[[DONE]]}} Task 30m');
    await flush(); assert.equal(f.updates.length, 0);
    if (committed) {
      editor.value = '{{[[DONE]]}} New user text'; await wait(65);
      assert.equal(f.blocks.get('task00001'), '{{[[DONE]]}} New user text d10:31');
      assert.equal(f.updates.length, 1);
    } else {
      await wait(130); assert.equal(f.updates.length, 0);
      assert.equal(editor.value, '{{[[TODO]]}} New user text');
    }
  });
});

test('passive DONE, feature-off and graph/provider replacement cannot create a timestamp',async t=>{
  const f=await setup(t,{enabled:false});assert.equal(f.document.count(),0);assert.equal(f.timers.size,0);
  f.document.fire('click',click(target('task00001').input));f.toggle('task00001');await flush();assert.equal(f.updates.length,0);
  f.setEnabled(true);f.nativeChange('task00001','{{[[TODO]]}} Task 30m');
  f.document.fire('click',click(target('task00001').input));f.changeContext({provider:{}});f.toggle('task00001');
  await flush();assert.equal(f.updates.length,0);
  f.adapter.destroy();assert.equal(f.document.count(),0);
});
