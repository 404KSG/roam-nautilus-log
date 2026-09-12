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
  let state = { version: 1, events: {} }, journal = null, queue = Promise.resolve();
  const hooks = {}, writes = [];
  const blocks = new Map([
    ['plan-today', { uid: 'plan-today', parentUid: 'page', order: 0, string: '[[Nautilus Log]]' }],
    ['plan-tomorrow', { uid: 'plan-tomorrow', parentUid: 'page-2', order: 0, string: '[[Nautilus Log]]' }],
  ]);
  const children = (uid) => [...blocks.values()]
    .filter((block) => block.parentUid === uid)
    .sort((left, right) => Number(left.order) - Number(right.order));
  const read = (uid) => blocks.get(uid)?.string ?? null;
  const create = async ({ parentUid, order = 'last', string, uid: requestedUid }) => {
    const uid = requestedUid || `calendar-${++generated}`;
    writes.push(['create', uid]);
    await hooks.beforeCreate?.({uid,parentUid,string});
    if (blocks.has(uid)) throw new Error('Duplicate UID');
    if (!blocks.has(parentUid)) throw new Error('Missing parent');
    blocks.set(uid, {
      uid,
      parentUid,
      order: order === 'last' ? children(parentUid).length : order,
      string,
    });
    await hooks.afterCreate?.({uid,parentUid,string});
    return uid;
  };
  const update = async (uid, string) => {
    writes.push(['update', uid]);
    await hooks.beforeUpdate?.(uid,string);
    if (!blocks.has(uid)) throw new Error('Missing UID');
    blocks.set(uid, { ...blocks.get(uid), string });
    await hooks.afterUpdate?.(uid,string);
  };
  const removeTree = (uid) => {
    children(uid).forEach((child) => removeTree(child.uid));
    blocks.delete(uid);
  };
  const move = async ({ uid, parentUid, order }) => {
    writes.push(['move', uid]);
    blocks.set(uid, { ...blocks.get(uid), parentUid, order });
    await hooks.afterMove?.(uid);
  };
  return {
    blocks, hooks, writes,
    children,
    read,
    create,
    update,
    remove: async (uid) => { writes.push(['remove',uid]);removeTree(uid);await hooks.afterRemove?.(uid); },
    move,
    loadState: () => structuredClone(state),
    saveState: async (next) => { await hooks.beforeSave?.(next);state = structuredClone(next);await hooks.afterSave?.(next); },
    loadJournal: () => structuredClone(journal),
    saveJournal: async (next) => { await hooks.beforeJournal?.(next);journal = structuredClone(next);await hooks.afterJournal?.(next); },
    runExclusive: operation => { const next=queue.then(operation);queue=next.catch(()=>{});return next; },
    setState: (next) => { state = structuredClone(next); },
    state: () => structuredClone(state),
    journal: () => structuredClone(journal),
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

function countedAdapters(graph) {
  const counts = {
    read: 0,
    children: 0,
    create: 0,
    update: 0,
    remove: 0,
    move: 0,
    saveState: 0,
    saveJournal: 0,
  };
  return {
    counts,
    reset() {
      for (const key of Object.keys(counts)) counts[key] = 0;
    },
    api: {
      ...graph,
      read: (uid) => { counts.read += 1; return graph.read(uid); },
      children: (uid) => { counts.children += 1; return graph.children(uid); },
      create: async (input) => { counts.create += 1; return graph.create(input); },
      update: async (uid, string) => { counts.update += 1; return graph.update(uid, string); },
      remove: async (uid) => { counts.remove += 1; return graph.remove(uid); },
      move: async (input) => { counts.move += 1; return graph.move(input); },
      saveState: async (next) => { counts.saveState += 1; return graph.saveState(next); },
      saveJournal: async (next) => { counts.saveJournal += 1; return graph.saveJournal(next); },
    },
  };
}

function seriesEvents(n) {
  return Array.from({ length: n }, (_, i) => meeting({
    key: `primary:event-${i}`,
    eventId: `event-${i}`,
    parentString: `09:${String(i % 60).padStart(2, '0')}–10:${String(i % 60).padStart(2, '0')} Event ${i} · Google Calendar`,
    sourceString: `Google Calendar · Work · [Open](https://calendar.google.com/event-${i})`,
    details: { location: `Room ${i}`, description: `Desc ${i}` },
  }));
}

function googleTask(overrides = {}) {
  return {
    key: 'task:my-tasks:task-1',
    taskListId: 'my-tasks',
    taskId: 'task-1',
    resourceType: 'google-task',
    status: 'needsAction',
    parentString: '{{[[TODO]]}} Submit report · Google Calendar',
    sourceString: 'Google Tasks · My Tasks',
    details: {
      location: '',
      description: 'Attach the final PDF.',
    },
    ...overrides,
  };
}

test('partial Calendar creation resumes its recorded UIDs after reload, without a second parent', async () => {
  const extension = await loadExtension('calendar-partial-reload');
  const graph = graphHarness();
  let calls = 0;
  graph.hooks.beforeCreate = () => { if (++calls === 2) throw new Error('injected source failure'); };
  const first = extension.createCalendarReconciler(graph);
  await assert.rejects(first.sync({ planUid:'plan-today', events:[meeting()] }));
  const parent = graph.children('plan-today')[0].uid;
  delete graph.hooks.beforeCreate;
  const reloaded = extension.createCalendarReconciler(graph);
  await reloaded.sync({ planUid:'plan-today', events:[meeting()] });
  assert.deepEqual(graph.children('plan-today').map(row=>row.uid), [parent]);
  assert.equal(graph.state().events[meeting().key].parent.uid, parent);
  assert.equal(graph.journal(), null);
});

test('independent Calendar reconcilers serialize the shared mapping before loading it', async () => {
  const extension = await loadExtension('calendar-concurrency');
  const graph = graphHarness();
  const a=extension.createCalendarReconciler(graph), b=extension.createCalendarReconciler(graph);
  await Promise.all([a.sync({planUid:'plan-today',events:[meeting()]}), b.sync({planUid:'plan-today',events:[meeting()]})]);
  assert.equal(graph.children('plan-today').length,1);
  assert.equal(Object.keys(graph.state().events).length,1);
});

for (const boundary of ['journal-before','journal-after','create-after','mapping-before','mapping-after','update-after','move-after','remove-after']) {
  test(`Calendar recovery survives ${boundary} failure without duplicate blocks`, async () => {
    const extension = await loadExtension(`calendar-fault-${boundary}`);
    const graph = graphHarness();
    const reconciler = extension.createCalendarReconciler(graph);
    const existing = ['update-after','move-after','remove-after'].includes(boundary);
    if (existing) await reconciler.sync({planUid:'plan-today',events:[meeting()]});
    let once = true;
    const fail = () => { if (once) { once=false;throw new Error('Injected checkpoint failure'); } };
    const hook = {'journal-before':'beforeJournal','journal-after':'afterJournal','create-after':'afterCreate',
      'mapping-before':'beforeSave','mapping-after':'afterSave','update-after':'afterUpdate','move-after':'afterMove','remove-after':'afterRemove'}[boundary];
    graph.hooks[hook] = fail;
    const planUid=boundary==='move-after'?'plan-tomorrow':'plan-today';
    const event=meeting(boundary==='remove-after'?{status:'cancelled'}:existing?{parentString:'10:00–10:30 Changed · Google Calendar'}:{});
    await assert.rejects(reconciler.sync({planUid,events:[event]}));
    if (boundary==='journal-before') assert.equal(graph.writes.length,0);
    delete graph.hooks[hook];
    const recovered=extension.createCalendarReconciler(graph);
    await recovered.sync({planUid,events:[event]});
    assert.equal(graph.children(planUid).length,boundary==='remove-after'?0:1);
    assert.equal(graph.journal(),null);
  });
}

test('Calendar retry uses current input and target after verifying recorded progress', async () => {
  const extension=await loadExtension('calendar-retry-input');
  const graph=graphHarness();let calls=0;
  graph.hooks.beforeCreate=()=>{if(++calls===2)throw new Error('source unavailable');};
  await assert.rejects(extension.createCalendarReconciler(graph).sync({planUid:'plan-today',events:[meeting()]}));
  delete graph.hooks.beforeCreate;
  const parent=graph.children('plan-today')[0].uid;
  await extension.createCalendarReconciler(graph).sync({planUid:'plan-tomorrow',events:[meeting({parentString:'12:00–12:30 Rescheduled · Google Calendar'})]});
  assert.equal(graph.children('plan-today').length,0);
  assert.deepEqual(graph.children('plan-tomorrow').map(row=>row.uid),[parent]);
  assert.match(graph.read(parent),/Rescheduled/);
});

test('a stale second settings cache fails closed rather than duplicating the deterministic parent', async () => {
  const extension=await loadExtension('calendar-stale-cache');
  const graph=graphHarness();
  await extension.createCalendarReconciler(graph).sync({planUid:'plan-today',events:[meeting()]});
  let stale={version:2,events:{}}, journal=null;
  const other=extension.createCalendarReconciler({...graph,loadState:()=>stale,saveState:async next=>{stale=structuredClone(next);},
    loadJournal:()=>journal,saveJournal:async next=>{journal=structuredClone(next);}});
  const writes=graph.writes.length;
  await assert.rejects(other.sync({planUid:'plan-today',events:[meeting()]}),/occupied|precondition/i);
  assert.equal(graph.children('plan-today').length,1);
  assert.equal(graph.writes.length,writes);
});

test('Calendar cancellation stops before the next block and retains recoverable progress', async () => {
  const extension=await loadExtension('calendar-cancel-block');
  const graph=graphHarness();const controller=new AbortController();
  graph.hooks.afterCreate=()=>controller.abort();
  await assert.rejects(extension.createCalendarReconciler(graph).sync({planUid:'plan-today',events:[meeting()],signal:controller.signal}),/cancelled/i);
  assert.equal(graph.children('plan-today').length,1);
  assert.equal(graph.writes.length,1);
  assert.ok(graph.journal());
  delete graph.hooks.afterCreate;
  await extension.createCalendarReconciler(graph).sync({planUid:'plan-today',events:[meeting()]});
  assert.equal(graph.children('plan-today').length,1);
});

test('runtime destroy propagates through the real reconciler instead of finishing its write loop', async () => {
  const extension=await loadExtension('calendar-runtime-destroy-block');
  const graph=graphHarness();
  const settings=new Map([['google-calendar-enabled',true],['google-calendar-connection',JSON.stringify({id:'synthetic',secret:'synthetic'})]]);
  const runtime=extension.createCalendarRuntime({extensionAPI:{settings:{get:key=>settings.get(key),set:async(key,value)=>settings.set(key,value)}},
    pageTitleToDate:()=>new Date(2026,7,30),clientFactory:()=>({readRange:async()=>[{calendar:{id:'primary'},events:[{id:'meeting-1',summary:'Meeting',start:{dateTime:'2026-08-30T09:00:00Z'},end:{dateTime:'2026-08-30T10:00:00Z'},location:'Room',description:'Notes'}]}],destroy(){}}),
    reconcilerFactory:()=>extension.createCalendarReconciler(graph)});
  graph.hooks.afterCreate=()=>runtime.destroy();
  await assert.rejects(runtime.syncPlan({planUid:'plan-today',pageTitle:'August 30th, 2026'}),/cancelled/i);
  assert.equal(graph.writes.length,1);
  assert.equal(graph.children('plan-today').length,1);
});

test('Calendar write paths fail closed without a known graph and native lock', async () => {
  const extension=await loadExtension('calendar-no-lock');
  const graph=graphHarness();
  const reconciler=extension.createCalendarReconciler({...graph,runExclusive:undefined});
  await assert.rejects(reconciler.sync({planUid:'plan-today',events:[meeting()]}),/known graph.*Web Locks/);
  assert.equal(graph.writes.length,0);
  reconciler.destroy();
});

test('explicit Free transitions remove only untouched imports; missing input never means deletion', async () => {
  const extension=await loadExtension('calendar-excluded');
  const graph=graphHarness(), reconciler=extension.createCalendarReconciler(graph);
  const raw={id:'meeting-1',summary:'Meeting',start:{dateTime:'2026-08-30T09:00:00Z'},end:{dateTime:'2026-08-30T10:00:00Z'}};
  const normalize=event=>extension.normalizeGoogleCalendarEvents({calendar:{id:'primary'},events:[event]});
  await reconciler.sync({planUid:'plan-today',events:normalize(raw)});
  await reconciler.sync({planUid:'plan-today',events:[],force:true});
  assert.equal(graph.children('plan-today').length,1);
  const excluded=normalize({...raw,transparency:'transparent'});
  assert.equal(excluded[0]?.status,'excluded');
  assert.equal((await reconciler.sync({planUid:'plan-today',events:excluded})).removed,1);
  await reconciler.sync({planUid:'plan-today',events:normalize(raw)});
  const parent=graph.children('plan-today')[0].uid;
  await graph.create({parentUid:parent,string:'My notes'});
  const kept=await reconciler.sync({planUid:'plan-today',events:excluded,force:true});
  assert.equal(kept.localKept,1);
  assert.equal(graph.children('plan-today').length,1);
  assert.equal(graph.children(parent).some(row=>row.string==='My notes'),true);
});

test('native graph-level locks serialize two plans sharing the Calendar mapping', async (t) => {
  const extension=await loadExtension('calendar-native-lock');
  const {exclusiveLocks}=require('./test-host-locks.cjs');
  const graph=graphHarness();
  global.window={roamAlphaAPI:{graph:{name:'calendar-native-graph'}},navigator:{locks:exclusiveLocks()}};
  const a=extension.createCalendarReconciler({...graph,runExclusive:undefined});
  const b=extension.createCalendarReconciler({...graph,runExclusive:undefined});
  t.after(()=>{a.destroy();b.destroy();delete global.window;});
  await Promise.all([a.sync({planUid:'plan-today',events:[meeting()]}),b.sync({planUid:'plan-tomorrow',events:[meeting()]})]);
  assert.equal(graph.children('plan-today').length+graph.children('plan-tomorrow').length,1);
  assert.equal(Object.keys(graph.state().events).length,1);
});

for (const change of ['disconnect','graph']) {
  test(`runtime ${change} during a Calendar write stops subsequent requests`, async (t) => {
    const extension=await loadExtension(`calendar-runtime-${change}`);
    const graph=graphHarness();
    graph.blocks.get('plan-today').string='{{[[roam/render]]:((roam-render-Nautilus-Log-cljs))}}';
    const roam={graph:{name:'calendar-context'},data:{pull:(_pattern,lookup)=>({':block/string':graph.read(lookup[1]),':block/page':{':node/title':'August 30th, 2026'}})}};
    global.window={roamAlphaAPI:roam};
    const values=new Map([['google-calendar-enabled',true],['google-calendar-connection',JSON.stringify({id:'test',secret:'test'})]]);
    const runtime=extension.createCalendarRuntime({extensionAPI:{settings:{get:k=>values.get(k),set:async(k,v)=>values.set(k,v)}},
      pageTitleToDate:()=>new Date(2026,7,30),clientFactory:()=>({
        readRange:async()=>[{calendar:{id:'primary'},events:[{id:'meeting-1',summary:'Meeting',start:{dateTime:'2026-08-30T09:00:00Z'},end:{dateTime:'2026-08-30T10:00:00Z'}}]}],
        disconnect:async()=>{values.set('google-calendar-connection','');return true;},destroy(){},cancelSync(){}
      }),reconcilerFactory:()=>extension.createCalendarReconciler(graph)});
    t.after(()=>{runtime.destroy();delete global.window;});
    graph.hooks.afterCreate=async()=>{
      if(change==='disconnect')await runtime.disconnect();
      else global.window.roamAlphaAPI={...roam,graph:{name:'changed-graph'}};
    };
    await assert.rejects(runtime.syncPlan({planUid:'plan-today',pageTitle:'August 30th, 2026'}),/cancelled|graph changed/i);
    assert.equal(graph.writes.length,1);
  });
}

test('force restoring a deleted parent uses the newly clicked date, not its old plan', async () => {
  const extension=await loadExtension('calendar-force-new-date');
  const graph=graphHarness(), reconciler=extension.createCalendarReconciler(graph);
  await reconciler.sync({planUid:'plan-today',events:[meeting()]});
  const uid=graph.state().events[meeting().key].parent.uid;
  await graph.remove(uid);
  await reconciler.sync({planUid:'plan-tomorrow',events:[meeting()],force:true});
  assert.equal(graph.children('plan-today').length,0);
  assert.deepEqual(graph.children('plan-tomorrow').map(row=>row.uid),[uid]);
  assert.equal(graph.state().events[meeting().key].planUid,'plan-tomorrow');
});

for (const mode of ['pre-collision','edited','moved']) {
  test(`ambiguous create (${mode}) is isolated by event without claiming its UID or blocking other events`, async () => {
    const extension=await loadExtension(`calendar-conflict-${mode}`);
    const graph=graphHarness();let uid;
    if (mode==='pre-collision') {
      graph.hooks.afterJournal=record=>{
        if(record?.op.kind==='create'&&!uid){uid=record.op.uid;graph.blocks.set(uid,{uid,parentUid:'plan-today',order:0,string:'Other writer'});}
      };
    } else {
      graph.hooks.afterCreate=block=>{uid=block.uid;throw new Error('after parent');};
    }
    await assert.rejects(extension.createCalendarReconciler(graph).sync({planUid:'plan-today',events:[meeting()]}));
    delete graph.hooks.afterJournal;delete graph.hooks.afterCreate;
    if(mode==='edited')graph.blocks.get(uid).string='My edited title';
    if(mode==='moved')await graph.move({uid,parentUid:'plan-tomorrow',order:0});
    const record=graph.journal();
    const other=meeting({key:'primary:other',eventId:'other',parentString:'12:00–12:30 Other · Google Calendar'});
    const retry=extension.createCalendarReconciler(graph);
    await assert.rejects(retry.sync({planUid:'plan-today',events:[meeting(),other]}), error=>error.incomplete&&error.summary.created===1);
    assert.equal(graph.journal(),null);
    assert.equal(graph.state().events[meeting().key].conflict.id,record.id);
    assert.equal(graph.state().events[meeting().key].parent,null);
    assert.equal(graph.children(uid).length,0, 'no source may be written below the uncertain parent');
    assert.ok(graph.state().events[other.key].parent.uid);
    await retry.sync({planUid:'plan-tomorrow',events:[meeting({key:'primary:third',eventId:'third'})]});
    graph.blocks.get(uid).string=record.op.string;
    await graph.move({uid,parentUid:'plan-today',order:0});
    await retry.sync({planUid:'plan-today',events:[meeting()]});
    assert.equal(graph.state().events[meeting().key].conflict,undefined);
    assert.equal(graph.state().events[meeting().key].parent.uid,uid);
    assert.equal(graph.children(uid).length,1);
  });
}

test('parked conflict keeps the WAL until clearing succeeds and never writes under the uncertain UID', async () => {
  const extension=await loadExtension('calendar-conflict-clear');
  const graph=graphHarness();let uid;
  graph.hooks.afterCreate=block=>{uid=block.uid;throw new Error('after write');};
  await assert.rejects(extension.createCalendarReconciler(graph).sync({planUid:'plan-today',events:[meeting()]}));
  delete graph.hooks.afterCreate;graph.blocks.get(uid).string='User text';
  graph.hooks.beforeJournal=value=>{if(value===null)throw new Error('clear failed');};
  const writes=graph.writes.length;
  await assert.rejects(extension.createCalendarReconciler(graph).sync({planUid:'plan-today',events:[meeting()]}));
  assert.ok(graph.journal());assert.ok(graph.state().events[meeting().key].conflict);
  assert.equal(graph.writes.length,writes);
  delete graph.hooks.beforeJournal;
  await assert.rejects(extension.createCalendarReconciler(graph).sync({planUid:'plan-today',events:[meeting()]}),/conflicts need inspection/i);
  assert.equal(graph.journal(),null);assert.equal(graph.writes.length,writes);
});

test('a parent moved while the source journal is saved receives no new source', async () => {
  const extension=await loadExtension('calendar-parent-moved-in-write');
  const graph=graphHarness();let moved=false;
  graph.hooks.afterJournal=record=>{
    if(record?.op.kind==='create'&&record.beforeEvent.parent&&!moved){
      moved=true;graph.blocks.get(record.beforeEvent.parent.uid).parentUid='plan-tomorrow';
    }
  };
  await assert.rejects(extension.createCalendarReconciler(graph).sync({planUid:'plan-today',events:[meeting()]}),/parent moved/);
  assert.equal(graph.writes.length,1);
  assert.equal(graph.children(graph.children('plan-tomorrow')[0].uid).length,0);
});

test('an update recovery preserves a user edit, and a delete recovery preserves new descendants', async () => {
  const extension=await loadExtension('calendar-recover-user-edit');
  const graph=graphHarness(), reconciler=extension.createCalendarReconciler(graph);
  await reconciler.sync({planUid:'plan-today',events:[meeting()]});
  const uid=graph.state().events[meeting().key].parent.uid;
  graph.hooks.afterUpdate=()=>{throw new Error('after update');};
  const changed=meeting({parentString:'10:00–10:30 Changed · Google Calendar'});
  await assert.rejects(reconciler.sync({planUid:'plan-today',events:[changed]}));
  delete graph.hooks.afterUpdate;graph.blocks.get(uid).string='My own title';
  assert.equal((await reconciler.sync({planUid:'plan-today',events:[changed]})).localKept,1);
  assert.equal(graph.read(uid),'My own title · Google Calendar');
  await reconciler.sync({planUid:'plan-today',events:[meeting()],force:true});
  let note;
  graph.hooks.afterJournal=async record=>{if(record?.op.kind==='remove'&&!note)note=await graph.create({parentUid:uid,string:'Keep me'});};
  await assert.rejects(reconciler.sync({planUid:'plan-today',events:[meeting({status:'cancelled'})]}));
  delete graph.hooks.afterJournal;
  assert.equal((await reconciler.sync({planUid:'plan-today',events:[meeting({status:'cancelled'})]})).localKept,1);
  assert.equal(graph.read(note),'Keep me');assert.notEqual(graph.read(uid),null);
});

test('a pending previous connection is isolated without adopting its blocks or locking all dates', async () => {
  const extension=await loadExtension('calendar-old-connection');
  const graph=graphHarness();graph.hooks.afterCreate=()=>{throw new Error('pending old connection');};
  await assert.rejects(extension.createCalendarReconciler(graph).sync({planUid:'plan-today',events:[meeting()],contextKey:'old'}));
  delete graph.hooks.afterCreate;
  const original=graph.journal(), uid=original.op.uid;
  const next=extension.createCalendarReconciler(graph);
  await assert.rejects(next.sync({planUid:'plan-today',events:[meeting({key:'primary:other'})],contextKey:'new'}),/conflicts need inspection/);
  assert.equal(graph.journal(),null);
  assert.equal(graph.state().events[meeting().key].conflict.scope,original.scope);
  assert.equal(graph.state().events[meeting().key].parent,null);
  assert.equal(graph.children(uid).length,0);
  await next.sync({planUid:'plan-tomorrow',events:[meeting({key:'primary:third'})],contextKey:'new'});
});

test('a committed mapping with a failed journal clear retries without any new graph writes', async () => {
  const extension=await loadExtension('calendar-committed-clear');
  const graph=graphHarness();graph.hooks.beforeJournal=value=>{if(value===null)throw new Error('cannot clear');};
  await assert.rejects(extension.createCalendarReconciler(graph).sync({planUid:'plan-today',events:[meeting()]}));
  assert.equal(graph.state().journalId,graph.journal().id);
  const writes=graph.writes.length;
  delete graph.hooks.beforeJournal;
  await extension.createCalendarReconciler(graph).sync({planUid:'plan-today',events:[meeting()]});
  assert.equal(graph.journal(),null);assert.equal(graph.writes.length,writes);
});

for (const invalid of ['format','graph','flag']) {
  test(`an unreadable or foreign-graph journal (${invalid}) cannot authorize graph writes`, async () => {
    const extension=await loadExtension(`calendar-invalid-${invalid}`);
    const graph=graphHarness();graph.hooks.afterCreate=()=>{throw new Error('pending');};
    await assert.rejects(extension.createCalendarReconciler(graph).sync({planUid:'plan-today',events:[meeting()]}));
    delete graph.hooks.afterCreate;
    const record=graph.journal();
    if(invalid==='format')record.op.kind='unknown';
    else if(invalid==='flag')record.beforeEvent.creating='true';
    else record.graphScope='other-graph';
    await graph.saveJournal(record);
    const writes=graph.writes.length;
    await assert.rejects(extension.createCalendarReconciler(graph).sync({planUid:'plan-today',events:[meeting()]}),/unreadable|another graph/);
    assert.equal(graph.writes.length,writes);assert.ok(graph.journal());
  });
}

test('destroying a reconciler queued on the native mapping lock never starts its writer', async (t) => {
  const extension=await loadExtension('calendar-native-queued-cancel');
  const {exclusiveLocks}=require('./test-host-locks.cjs');
  const graph=graphHarness();
  global.window={roamAlphaAPI:{graph:{name:'calendar-native-queued'}},navigator:{locks:exclusiveLocks()}};
  const a=extension.createCalendarReconciler({...graph,runExclusive:undefined}), b=extension.createCalendarReconciler({...graph,runExclusive:undefined});
  t.after(()=>{a.destroy();b.destroy();delete global.window;});
  let enter,release,first=true;
  const entered=new Promise(resolve=>{enter=resolve;}), gate=new Promise(resolve=>{release=resolve;});
  graph.hooks.beforeCreate=async()=>{if(first){first=false;enter();await gate;}};
  const running=a.sync({planUid:'plan-today',events:[meeting()]});await entered;
  const queued=b.sync({planUid:'plan-tomorrow',events:[meeting()]}).then(()=>null,error=>error);
  b.destroy();release();await running;
  assert.ok(await queued);
  assert.equal(graph.children('plan-tomorrow').length,0);
  assert.equal(graph.writes.length,4);
});

for (const operation of ['update','move']) {
  test(`a deleted known owner after an interrupted ${operation} is preserved as local deletion, not a global WAL block`, async () => {
    const extension=await loadExtension(`calendar-missing-known-${operation}`);
    const graph=graphHarness(), first=extension.createCalendarReconciler(graph);
    await first.sync({planUid:'plan-today',events:[meeting()]});
    const uid=graph.state().events[meeting().key].parent.uid;
    const hook=operation==='update'?'afterUpdate':'afterMove';
    graph.hooks[hook]=()=>{throw new Error('interrupted known owner');};
    const target=operation==='move'?'plan-tomorrow':'plan-today';
    await assert.rejects(first.sync({planUid:target,events:[meeting({parentString:'11:00–11:30 Updated · Google Calendar'})]}));
    delete graph.hooks[hook];await graph.remove(uid);
    const next=extension.createCalendarReconciler(graph);
    const result=await next.sync({planUid:target,events:[meeting(),meeting({key:'primary:other'})]});
    assert.equal(result.localDeleted,1);
    assert.equal(graph.read(uid),null);
    assert.equal(graph.journal(),null);
    assert.ok(graph.state().events['primary:other'].parent.uid);
    await next.sync({planUid:'plan-tomorrow',events:[meeting()],force:true});
    assert.equal(graph.children('plan-tomorrow').some(row=>row.uid===uid),true);
  });
}

test('an interrupted partial-tree update with a missing UID is isolated until the exact owner is restored', async () => {
  const extension=await loadExtension('calendar-missing-partial-update');
  const graph=graphHarness();let n=0;
  graph.hooks.beforeCreate=()=>{if(++n===2)throw new Error('source failed');};
  await assert.rejects(extension.createCalendarReconciler(graph).sync({planUid:'plan-today',events:[meeting()]}));
  delete graph.hooks.beforeCreate;
  graph.hooks.afterUpdate=()=>{throw new Error('parent update failed');};
  await assert.rejects(extension.createCalendarReconciler(graph).sync({planUid:'plan-today',events:[meeting({parentString:'11:00–11:30 Changed · Google Calendar'})]}));
  const record=graph.journal();assert.equal(record.op.kind,'update');assert.equal(record.beforeEvent.creating,true);
  delete graph.hooks.afterUpdate;await graph.remove(record.op.uid);
  await assert.rejects(extension.createCalendarReconciler(graph).sync({planUid:'plan-today',events:[meeting(),meeting({key:'primary:other'})]}),/conflicts need inspection/);
  assert.equal(graph.journal(),null);
  assert.equal(graph.read(record.op.uid),null);
  assert.ok(graph.state().events['primary:other'].parent.uid);
  await graph.create({uid:record.op.uid,parentUid:record.beforeEvent.planUid,string:record.op.beforeString});
  await extension.createCalendarReconciler(graph).sync({planUid:'plan-today',events:[meeting()]});
  assert.equal(graph.state().events[meeting().key].conflict,undefined);
});

test('only a literal boolean true authorizes force overwrites', async () => {
  const extension=await loadExtension('calendar-force-boolean');
  const graph=graphHarness(), reconciler=extension.createCalendarReconciler(graph);
  await reconciler.sync({planUid:'plan-today',events:[meeting()]});
  const uid=graph.state().events[meeting().key].parent.uid;
  await graph.update(uid,'My edited title · Google Calendar');
  const result=await reconciler.sync({planUid:'plan-today',events:[meeting()],force:'false'});
  assert.equal(result.localKept,1);
  assert.equal(graph.read(uid),'My edited title · Google Calendar');
});

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
      parentString: '{{[[DONE]]}} Submit report d15:20 · Google Calendar',
    })],
  });
  assert.equal(completed.updated, 1);
  assert.equal(graph.state().events['task:my-tasks:task-1'].parent.uid, parentUid);
  assert.equal(graph.read(parentUid), '{{[[DONE]]}} Submit report d15:20 · Google Calendar');
  assert.equal(graph.children('plan-today').length, 1);

  const removed = await reconciler.sync({
    planUid: 'plan-today',
    events: [googleTask({ status: 'cancelled' })],
  });
  assert.equal(removed.removed, 1);
  assert.equal(graph.read(parentUid), null);
  assert.equal(graph.state().events['task:my-tasks:task-1'], undefined);
});

test('Google Tasks migrate untouched imported defaults while preserving explicit local estimates', async () => {
  const extension = await loadExtension('google-task-implicit-duration-migration');
  const graph = graphHarness();
  const reconciler = extension.createCalendarReconciler(graph);

  await reconciler.sync({
    planUid: 'plan-today',
    events: [googleTask({
      parentString: '{{[[TODO]]}} Submit report 15m · Google Calendar',
    })],
  });
  const mapping = graph.state().events['task:my-tasks:task-1'];

  const migrated = await reconciler.sync({
    planUid: 'plan-today',
    events: [googleTask()],
  });
  assert.equal(migrated.updated, 1);
  assert.equal(graph.read(mapping.parent.uid), '{{[[TODO]]}} Submit report · Google Calendar');

  await graph.update(mapping.parent.uid, '{{[[TODO]]}} Submit report 30m · Google Calendar');
  const preserved = await reconciler.sync({
    planUid: 'plan-today',
    events: [googleTask()],
  });
  assert.equal(preserved.localKept, 1);
  assert.equal(graph.read(mapping.parent.uid), '{{[[TODO]]}} Submit report 30m · Google Calendar');
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

test('an unreadable mapping fails closed with zero graph writes', async () => {
  const extension = await loadExtension('calendar-corrupt-mapping');
  const graph = graphHarness();
  const writes = graph.writes.length;
  for (const invalid of [{}, { version: 3, events: {} }, { version: 2, events: [] }, { version: 1 }]) {
    graph.setState(invalid);
    await assert.rejects(
      extension.createCalendarReconciler(graph).sync({ planUid: 'plan-today', events: [meeting()] }),
      /unreadable/i,
    );
    assert.equal(graph.writes.length, writes);
    assert.equal(graph.children('plan-today').length, 0);
  }
});

test('a legitimate empty mapping is first-run state and can import', async () => {
  const extension = await loadExtension('calendar-empty-mapping');
  const graph = graphHarness();
  graph.setState({ version: 1, events: {} });
  const result = await extension.createCalendarReconciler(graph).sync({
    planUid: 'plan-today',
    events: [meeting()],
  });
  assert.equal(result.created, 1);
  assert.equal(graph.children('plan-today').length, 1);
  assert.equal(graph.state().version, 2);
});

test('an old journal without graphScope fails closed instead of guessing a graph name', async () => {
  const extension = await loadExtension('calendar-journal-no-graph-scope');
  const graph = graphHarness();
  graph.hooks.afterCreate = () => { throw new Error('pending'); };
  await assert.rejects(extension.createCalendarReconciler(graph).sync({
    planUid: 'plan-today',
    events: [meeting()],
  }));
  delete graph.hooks.afterCreate;
  const record = graph.journal();
  assert.equal(typeof record.graphScope, 'string');
  delete record.graphScope;
  record.scope = 'alpha:beta:connection';
  await graph.saveJournal(record);
  const writes = graph.writes.length;
  await assert.rejects(
    extension.createCalendarReconciler(graph).sync({ planUid: 'plan-today', events: [meeting()] }),
    /unreadable/i,
  );
  assert.equal(graph.writes.length, writes);
  assert.ok(graph.journal());
  assert.equal(graph.children('plan-today').length, 1);
});

test('runtime unreadable mapping fails closed before any graph write', async () => {
  const extension = await loadExtension('calendar-runtime-corrupt-mapping');
  const graph = graphHarness();
  const settings = new Map([
    ['google-calendar-enabled', true],
    ['google-calendar-connection', JSON.stringify({ version: 2, id: 'connection-id', secret: 'secret' })],
    ['google-calendar-ids', 'primary'],
    ['google-calendar-sync-state', '{'],
    ['google-calendar-sync-pending', ''],
    ['workday-start', 9],
    ['workday-end', 17],
  ]);
  const runtime = extension.createCalendarRuntime({
    extensionAPI: {
      settings: {
        get: (key) => settings.get(key),
        set: async (key, value) => settings.set(key, value),
      },
    },
    pageTitleToDate: () => new Date(2026, 7, 30),
    clientFactory: () => ({
      readRange: async () => [{
        calendar: { id: 'primary', summary: 'Work' },
        events: [{
          id: 'meeting-1',
          status: 'confirmed',
          summary: 'Weekly meeting',
          start: { dateTime: '2026-08-30T09:30:00+08:00' },
          end: { dateTime: '2026-08-30T10:00:00+08:00' },
        }],
      }],
      destroy() {},
    }),
    reconcilerFactory: (options) => extension.createCalendarReconciler({
      ...graph,
      loadState: options.loadState,
      saveState: options.saveState,
      loadJournal: options.loadJournal,
      saveJournal: options.saveJournal,
    }),
  });
  await assert.rejects(
    runtime.syncPlan({ planUid: 'plan-today', pageTitle: 'August 30th, 2026' }),
    /unreadable/i,
  );
  assert.equal(graph.writes.length, 0);
  assert.equal(graph.children('plan-today').length, 0);
  assert.equal(settings.get('google-calendar-sync-state'), '{');
});

test('runtime empty mapping is a legitimate first-run import', async () => {
  const extension = await loadExtension('calendar-runtime-empty-mapping');
  const graph = graphHarness();
  const settings = new Map([
    ['google-calendar-enabled', true],
    ['google-calendar-connection', JSON.stringify({ version: 2, id: 'connection-id', secret: 'secret' })],
    ['google-calendar-ids', 'primary'],
    ['google-calendar-sync-state', ''],
    ['google-calendar-sync-pending', ''],
    ['workday-start', 9],
    ['workday-end', 17],
  ]);
  const runtime = extension.createCalendarRuntime({
    extensionAPI: {
      settings: {
        get: (key) => settings.get(key),
        set: async (key, value) => settings.set(key, value),
      },
    },
    pageTitleToDate: () => new Date(2026, 7, 30),
    clientFactory: () => ({
      readRange: async () => [{
        calendar: { id: 'primary', summary: 'Work' },
        events: [{
          id: 'meeting-1',
          status: 'confirmed',
          summary: 'Weekly meeting',
          start: { dateTime: '2026-08-30T09:30:00+08:00' },
          end: { dateTime: '2026-08-30T10:00:00+08:00' },
        }],
      }],
      destroy() {},
    }),
    reconcilerFactory: (options) => extension.createCalendarReconciler({
      ...graph,
      loadState: options.loadState,
      saveState: options.saveState,
      loadJournal: options.loadJournal,
      saveJournal: options.saveJournal,
    }),
  });
  const result = await runtime.syncPlan({ planUid: 'plan-today', pageTitle: 'August 30th, 2026' });
  assert.equal(result.created, 1);
  assert.equal(graph.children('plan-today').length, 1);
  assert.notEqual(settings.get('google-calendar-sync-state'), '');
  assert.match(String(settings.get('google-calendar-sync-state')), /"version":2/);
});

test('unchanged Calendar sync reuses same-turn graph reads without dropping lastSeen persistence', async () => {
  const extension = await loadExtension('calendar-read-snapshot-noop');
  const graph = graphHarness();
  const counted = countedAdapters(graph);
  let now = 1_000;
  const reconciler = extension.createCalendarReconciler({
    ...counted.api,
    now: () => now,
  });
  const events24 = seriesEvents(24);
  const events100 = seriesEvents(100);

  await reconciler.sync({ planUid: 'plan-today', events: events24 });
  const firstSeen = graph.state().events[events24[0].key].lastSeenAt;
  counted.reset();
  now = 2_000;
  const noop24 = await reconciler.sync({ planUid: 'plan-today', events: events24 });
  assert.deepEqual(
    { created: noop24.created, updated: noop24.updated, removed: noop24.removed, skipped: noop24.skipped },
    { created: 0, updated: 0, removed: 0, skipped: 24 },
  );
  assert.equal(noop24.localKept || 0, 0);
  assert.equal(counted.counts.create, 0);
  assert.equal(counted.counts.update, 0);
  assert.equal(counted.counts.remove, 0);
  assert.equal(counted.counts.move, 0);
  assert.equal(counted.counts.saveState, 1);
  assert.equal(graph.state().events[events24[0].key].lastSeenAt, 2_000);
  assert.notEqual(firstSeen, 2_000);
  // A+D1-v2 baseline on this dataset is 264 reads / 96 children. Same-turn unique
  // UIDs are 97 strings (96 managed + plan) and 49 children (48 managed + plan).
  assert.equal(counted.counts.read, 97);
  assert.equal(counted.counts.children, 49);

  counted.reset();
  await reconciler.sync({ planUid: 'plan-today', events: events100 });
  counted.reset();
  now = 3_000;
  const noop100 = await reconciler.sync({ planUid: 'plan-today', events: events100 });
  assert.equal(noop100.skipped, 100);
  assert.equal(counted.counts.create, 0);
  assert.equal(counted.counts.saveState, 1);
  assert.equal(counted.counts.read, 401);
  assert.equal(counted.counts.children, 201);
});

function mutatingGraph(graph) {
  let readImpl = (uid) => graph.read(uid);
  let childrenImpl = (uid) => graph.children(uid);
  return {
    setRead(fn) { readImpl = fn; },
    setChildren(fn) { childrenImpl = fn; },
    api: {
      ...graph,
      read: (uid) => readImpl(uid),
      children: (uid) => childrenImpl(uid),
    },
  };
}

test('a queueMicrotask parent move after first read cannot authorize a later write', async () => {
  const extension = await loadExtension('calendar-read-snapshot-microtask-move');
  const graph = graphHarness();
  const proxy = mutatingGraph(graph);
  const reconciler = extension.createCalendarReconciler(proxy.api);
  await reconciler.sync({ planUid: 'plan-today', events: [meeting()] });
  const parentUid = graph.state().events[meeting().key].parent.uid;
  const original = graph.read(parentUid);
  let queued = false;
  proxy.setRead((uid) => {
    const value = graph.read(uid);
    if (!queued) {
      queued = true;
      queueMicrotask(() => {
        graph.blocks.get(parentUid).parentUid = 'plan-tomorrow';
      });
    }
    return value;
  });
  const writes = graph.writes.length;
  await assert.rejects(
    reconciler.sync({
      planUid: 'plan-today',
      events: [meeting({ parentString: '10:00–10:30 Changed · Google Calendar' })],
    }),
    /parent moved|precondition changed/i,
  );
  assert.equal(graph.writes.length, writes);
  assert.equal(graph.read(parentUid), original);
  assert.equal(graph.blocks.get(parentUid).parentUid, 'plan-tomorrow');
});

test('a queueMicrotask user edit after first read cannot be overwritten by a Google update', async () => {
  const extension = await loadExtension('calendar-read-snapshot-microtask-edit');
  const graph = graphHarness();
  const proxy = mutatingGraph(graph);
  const reconciler = extension.createCalendarReconciler(proxy.api);
  await reconciler.sync({ planUid: 'plan-today', events: [meeting()] });
  const parentUid = graph.state().events[meeting().key].parent.uid;
  let queued = false;
  proxy.setRead((uid) => {
    const value = graph.read(uid);
    if (!queued) {
      queued = true;
      queueMicrotask(() => {
        graph.blocks.get(parentUid).string = 'User title during yield';
      });
    }
    return value;
  });
  const writes = graph.writes.length;
  await assert.rejects(
    reconciler.sync({
      planUid: 'plan-today',
      events: [meeting({ parentString: '10:00–10:30 Changed · Google Calendar' })],
    }),
    /precondition changed|changed while recording/i,
  );
  assert.equal(graph.writes.length, writes);
  assert.equal(graph.read(parentUid), 'User title during yield');
});

test('a queueMicrotask graph-switch during a write await still fails closed', async () => {
  const extension = await loadExtension('calendar-read-snapshot-microtask-graph');
  const graph = graphHarness();
  const proxy = mutatingGraph(graph);
  let graphName = 'alpha';
  const assertActive = () => {
    if (graphName !== 'alpha') throw new Error('Calendar graph changed');
  };
  const reconciler = extension.createCalendarReconciler(proxy.api);
  await reconciler.sync({ planUid: 'plan-today', events: [meeting()], assertActive });
  let queued = false;
  proxy.setRead((uid) => {
    const value = graph.read(uid);
    if (!queued) {
      queued = true;
      queueMicrotask(() => { graphName = 'beta'; });
    }
    return value;
  });
  const writes = graph.writes.length;
  await assert.rejects(
    reconciler.sync({
      planUid: 'plan-today',
      events: [meeting({ parentString: '10:00–10:30 Changed · Google Calendar' })],
      assertActive,
    }),
    /graph changed/i,
  );
  assert.equal(graph.writes.length, writes);
});

test('write-after-fail still stops and does not claim a later field', async () => {
  const extension = await loadExtension('calendar-read-snapshot-write-after-fail');
  const graph = graphHarness();
  const reconciler = extension.createCalendarReconciler(graph);
  await reconciler.sync({ planUid: 'plan-today', events: [meeting()] });
  const parentUid = graph.state().events[meeting().key].parent.uid;
  const sourceUid = graph.state().events[meeting().key].source.uid;
  graph.hooks.afterUpdate = () => { throw new Error('after parent update'); };
  await assert.rejects(
    reconciler.sync({
      planUid: 'plan-today',
      events: [meeting({
        parentString: '10:00–10:30 Changed · Google Calendar',
        sourceString: 'Google Calendar · Other · [Open](https://calendar.google.com/event)',
      })],
    }),
  );
  assert.equal(graph.read(parentUid), '10:00–10:30 Changed · Google Calendar');
  assert.equal(
    graph.read(sourceUid),
    'Google Calendar · Work · [Open](https://calendar.google.com/event)',
  );
});

test('a later sync does not adopt a poisoned adapter children buffer from a previous sync', async () => {
  const extension = await loadExtension('calendar-read-snapshot-alias-across-sync');
  const graph = graphHarness();
  const live = [];
  const proxy = mutatingGraph(graph);
  proxy.setChildren((uid) => {
    const rows = graph.children(uid);
    live.splice(0, live.length, ...rows);
    return live;
  });
  const reconciler = extension.createCalendarReconciler(proxy.api);
  await reconciler.sync({ planUid: 'plan-today', events: [meeting()] });
  live.splice(0, live.length, { uid: 'forged', string: 'Forged', order: 0, open: false });
  const result = await reconciler.sync({ planUid: 'plan-today', events: [meeting()] });
  assert.equal(result.skipped, 1);
  assert.equal(result.localKept || 0, 0);
  assert.equal(graph.children('plan-today').some((row) => row.uid === 'forged'), false);
});

test('same-sync child-row cache copies so a later hit ignores in-place aliasing', async () => {
  const extension = await loadExtension('calendar-read-snapshot-alias-same-sync');
  const graph = graphHarness();
  const proxy = mutatingGraph(graph);
  const reconciler = extension.createCalendarReconciler(proxy.api);
  await reconciler.sync({ planUid: 'plan-today', events: [meeting()] });
  const mapping = graph.state().events[meeting().key];
  const sourceUid = mapping.source.uid;
  const descriptionUid = mapping.details.description.uid;
  const live = [];
  let sourceChildrenCalls = 0;
  proxy.setChildren((uid) => {
    const rows = graph.children(uid).map((row) => ({ ...row }));
    if (uid === sourceUid) {
      sourceChildrenCalls += 1;
      live.splice(0, live.length, ...rows);
      return live;
    }
    return rows;
  });
  let poisoned = false;
  proxy.setRead((uid) => {
    if (!poisoned && sourceChildrenCalls >= 1 && uid === descriptionUid) {
      poisoned = true;
      live.splice(0, live.length, { uid: 'forged', string: 'Forged', order: 0, open: false });
    }
    return graph.read(uid);
  });
  const result = await reconciler.sync({ planUid: 'plan-today', events: [meeting()] });
  assert.equal(sourceChildrenCalls, 1);
  assert.equal(poisoned, true);
  assert.equal(result.skipped, 1);
  assert.equal(result.localKept || 0, 0);
  assert.equal(graph.children(sourceUid).some((row) => row.uid === 'forged'), false);
});

test('a throwing graph read is not cached as successful empty data', async () => {
  const extension = await loadExtension('calendar-read-snapshot-throw');
  const graph = graphHarness();
  const proxy = mutatingGraph(graph);
  const reconciler = extension.createCalendarReconciler(proxy.api);
  await reconciler.sync({ planUid: 'plan-today', events: [meeting()] });
  let blows = 0;
  proxy.setRead((uid) => {
    if (uid === graph.state().events[meeting().key].parent.uid && blows < 1) {
      blows += 1;
      throw new Error('transient graph read');
    }
    return graph.read(uid);
  });
  await assert.rejects(
    reconciler.sync({ planUid: 'plan-today', events: [meeting()] }),
    /transient graph read/,
  );
  proxy.setRead((uid) => graph.read(uid));
  const recovered = await reconciler.sync({ planUid: 'plan-today', events: [meeting()] });
  assert.equal(recovered.skipped, 1);
});

test('a throwing children query is not cached as an empty tree', async () => {
  const extension = await loadExtension('calendar-read-snapshot-children-throw');
  const graph = graphHarness();
  const proxy = mutatingGraph(graph);
  const reconciler = extension.createCalendarReconciler(proxy.api);
  await reconciler.sync({ planUid: 'plan-today', events: [meeting()] });
  let blows = 0;
  proxy.setChildren((uid) => {
    if (uid === 'plan-today' && blows < 1) {
      blows += 1;
      throw new Error('transient children');
    }
    return graph.children(uid);
  });
  await assert.rejects(
    reconciler.sync({ planUid: 'plan-today', events: [meeting()] }),
    /transient children/,
  );
  proxy.setChildren((uid) => graph.children(uid));
  const recovered = await reconciler.sync({ planUid: 'plan-today', events: [meeting()] });
  assert.equal(recovered.skipped, 1);
  assert.equal(graph.children('plan-today').length, 1);
});

test('assertActive still runs when a later adapter miss sees a flipped graph flag', async () => {
  const extension = await loadExtension('calendar-read-snapshot-assert-active-miss');
  const graph = graphHarness();
  const proxy = mutatingGraph(graph);
  let reads = 0;
  let graphName = 'alpha';
  proxy.setRead((uid) => {
    reads += 1;
    if (reads === 2) graphName = 'beta';
    return graph.read(uid);
  });
  const reconciler = extension.createCalendarReconciler(proxy.api);
  await assert.rejects(
    reconciler.sync({
      planUid: 'plan-today',
      events: [meeting()],
      assertActive() {
        if (graphName !== 'alpha') throw new Error('Calendar graph changed');
      },
    }),
    /graph changed/i,
  );
  assert.equal(graph.children('plan-today').length, 0);
});

test('assertActive still runs on a same-sync cache hit without another adapter read', async () => {
  const extension = await loadExtension('calendar-read-snapshot-assert-active-hit');
  const graph = graphHarness();
  const proxy = mutatingGraph(graph);
  const reconciler = extension.createCalendarReconciler(proxy.api);
  await reconciler.sync({ planUid: 'plan-today', events: [meeting()] });
  const parentUid = graph.state().events[meeting().key].parent.uid;
  let adapterParentReads = 0;
  let graphName = 'alpha';
  proxy.setRead((uid) => {
    if (uid === parentUid) adapterParentReads += 1;
    return graph.read(uid);
  });
  proxy.setChildren((uid) => {
    if (uid === 'plan-today') graphName = 'beta';
    return graph.children(uid);
  });
  await assert.rejects(
    reconciler.sync({
      planUid: 'plan-today',
      events: [meeting()],
      assertActive() {
        if (graphName !== 'alpha') throw new Error('Calendar graph changed');
      },
    }),
    /graph changed/i,
  );
  assert.equal(adapterParentReads, 1);
});
