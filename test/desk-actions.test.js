const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let loaded;
const extension = () => loaded ||= import(`data:text/javascript;base64,${Buffer.from(fs.readFileSync(path.join(__dirname, '../extension.js'))).toString('base64')}#desk-actions`);
const ROOT = '[[Nautilus Log]] {{[[roam/render]]:((roam-render-Nautilus-Log-cljs))}}';

async function fixture(overrides = {}) {
  const { createDeskActions } = await extension();
  const rows = [
    { uid:'event', string:'09:00-10:00 Meeting', order:0 },
    { uid:'done', string:'{{[[DONE]]}} Finished', order:1 },
    { uid:'a', string:'{{[[TODO]]}} A 30m', order:2 },
    { uid:'b', string:'{{[[TODO]]}} B 45m', order:3 },
    { uid:'c', string:'{{[[TODO]]}} C 60m', order:4 },
  ];
  const other = new Map([['source-done','{{[[DONE]]}} Reusable'],['child-log','Preserve this descendant']]);
  const writes = [];
  const state = { root:ROOT, failRead:false, noMove:false, uncertainCreate:false, failCreateAfter:false };
  const read = () => { if(state.failRead) throw new Error('unavailable'); return rows.map(row=>({...row})); };
  const readString = uid => uid === 'plan' ? state.root : rows.find(row=>row.uid===uid)?.string ?? other.get(uid) ?? null;
  const api = {
    read, readString, exists:uid=>readString(uid)!==null, generateUid:()=>`new-${writes.length}`,
    runExclusive: action => action(),
    move: async ({uid,parentUid,order}) => {
      writes.push(['move',uid,parentUid,order]);
      if(state.noMove) return;
      rows.splice(order,0,rows.splice(rows.findIndex(row=>row.uid===uid),1)[0]);
      rows.forEach((row,i)=>row.order=i);
    },
    create: async ({uid,parentUid,order,string}) => {
      writes.push(['create',uid,parentUid,order,string]);
      if(state.uncertainCreate) throw new Error('uncertain create');
      rows.splice(order,0,{uid,string,order}); rows.forEach((row,i)=>row.order=i);
      if(state.failCreateAfter) throw new Error('response lost');
      return uid;
    },
    update: async (uid,string) => { writes.push(['update',uid,string]); rows.find(row=>row.uid===uid).string=string; },
    ...overrides,
  };
  const actions = createDeskActions(api);
  return { actions, rows, other, writes, state, api };
}

test('Move to top moves the original outer block to actual index zero, preserving other blocks', async () => {
  const f=await fixture(); const original=new Map(f.rows.map(r=>[r.uid,r.string]));
  await f.actions.moveTask({planUid:'plan',uid:'c',position:'top'});
  assert.deepEqual(f.rows.map(r=>r.uid),['c','event','done','a','b']);
  assert.deepEqual(f.writes,[['move','c','plan',0]]);
  for(const row of f.rows) assert.equal(row.string,original.get(row.uid));
  assert.equal(f.other.get('child-log'),'Preserve this descendant');
});

test('dropping before the first active card also means first in the real outline', async () => {
  const f=await fixture();
  await f.actions.moveTask({planUid:'plan',uid:'c',targetUid:'a'});
  assert.equal(f.rows[0].uid,'c');
  await f.actions.moveTask({planUid:'plan',uid:'c',targetUid:'b',position:'after'});
  assert.deepEqual(f.rows.map(r=>r.uid),['event','done','a','b','c']);
});

test('completed, foreign, or changed targets and replaced renderer roots fail before writing', async () => {
  for(const payload of [{uid:'done',position:'top'},{uid:'foreign',position:'top'},{uid:'b',targetUid:'event'}]) {
    const f=await fixture(); await assert.rejects(f.actions.moveTask({planUid:'plan',...payload})); assert.equal(f.writes.length,0);
  }
  const f=await fixture(); f.state.root='ordinary block';
  await assert.rejects(f.actions.moveTask({planUid:'plan',uid:'b',position:'top'})); assert.equal(f.writes.length,0);
});

test('a fulfilled no-op host move is not reported as success', async () => {
  const f=await fixture(); f.state.noMove=true;
  await assert.rejects(f.actions.moveTask({planUid:'plan',uid:'c',position:'top'}),/confirm/);
  assert.equal(f.writes.length,1);
});

test('moving an explicit TODO reference moves its wrapper, never its reusable source', async () => {
  const f=await fixture(); f.rows[2].string='{{[[TODO]]}} ((source-done))';
  await f.actions.moveTask({planUid:'plan',uid:'a',position:'top'});
  assert.equal(f.rows[0].uid,'a'); assert.equal(f.other.get('source-done'),'{{[[DONE]]}} Reusable');
  assert.equal(f.writes[0][1],'a');
});

test('opening a draft does not write; committed text creates exactly one direct child', async () => {
  const f=await fixture(); const draft=f.actions.beginDraft('plan');
  assert.equal(f.writes.length,0);
  await f.actions.saveDraft({...draft,string:'First prompt'});
  assert.equal(f.rows[0].uid,draft.uid); assert.equal(f.rows[0].string,'First prompt');
  assert.equal(f.writes[0][2],'plan');
  await f.actions.saveDraft({...draft,string:'First prompt revised'});
  await f.actions.saveDraft({...draft,string:'First prompt revised'});
  assert.equal(f.writes.filter(w=>w[0]==='create').length,1);
  assert.equal(f.writes.filter(w=>w[0]==='update').length,1);
  assert.equal(f.rows[0].string,'First prompt revised');
});

test('empty untouched drafts never create junk, but clearing an existing draft is respected', async () => {
  const f=await fixture(); const draft=f.actions.beginDraft('plan');
  await assert.rejects(f.actions.saveDraft({...draft,string:'  '})); assert.equal(f.writes.length,0);
  await f.actions.saveDraft({...draft,string:'typed'});
  await f.actions.saveDraft({...draft,string:''}); assert.equal(f.rows[0].string,'');
});

test('draft writes never overwrite occupied UIDs or external edits', async () => {
  const f=await fixture({generateUid:()=> 'child-log'}); const draft=f.actions.beginDraft('plan');
  await assert.rejects(f.actions.saveDraft({...draft,string:'new'}),/already in use/); assert.equal(f.writes.length,0);
  const g=await fixture(); const own=g.actions.beginDraft('plan');
  await g.actions.saveDraft({...own,string:'first'}); g.rows[0].string='external revision';
  await assert.rejects(g.actions.saveDraft({...own,string:'replacement'}),/changed elsewhere/);
  assert.equal(g.rows[0].string,'external revision');
});

test('lost create responses are verified; uncertain missing creates are never blindly retried', async () => {
  const f=await fixture(); f.state.failCreateAfter=true; const draft=f.actions.beginDraft('plan');
  await f.actions.saveDraft({...draft,string:'present despite response loss'});
  assert.equal(f.writes.length,1);
  const g=await fixture(); g.state.uncertainCreate=true; const uncertain=g.actions.beginDraft('plan');
  await assert.rejects(g.actions.saveDraft({...uncertain,string:'not confirmed'}));
  await assert.rejects(g.actions.saveDraft({...uncertain,string:'not confirmed'}),/no duplicate/);
  assert.equal(g.writes.length,1);
});

test('destroy cancels queued actions without a graph mutation', async () => {
  let release; const gate=new Promise(resolve=>release=resolve);
  const f=await fixture({runExclusive:async action=>{await gate;return action();}});
  const pending=f.actions.moveTask({planUid:'plan',uid:'b',position:'top'});
  await Promise.resolve(); f.actions.destroy(); release();
  await assert.rejects(pending,/cancelled/); assert.equal(f.writes.length,0);
});

test('production guard requires Web Locks and uses the shared outline resource', async t => {
  const prior=global.window;
  global.window={roamAlphaAPI:{graph:{name:'desk-actions-test'}},navigator:{}};
  t.after(()=>{global.window=prior;});
  const f=await fixture({runExclusive:undefined});
  await assert.rejects(f.actions.moveTask({planUid:'plan',uid:'b',position:'top'}),/Web Locks/);
  const names=[];
  global.window.navigator.locks={request:async(name,_options,action)=>{names.push(name);return action();}};
  await f.actions.moveTask({planUid:'plan',uid:'b',position:'top'});
  assert.deepEqual(names,['nautilus-log:outline:desk-actions-test']);
  global.window.roamAlphaAPI.graph.name='another-graph';
  await assert.rejects(f.actions.moveTask({planUid:'plan',uid:'c',position:'top'}),/graph changed/);
});

test('a draft update with a lost response is confirmed instead of creating or overwriting another block', async () => {
  let f;
  f=await fixture({update:async(uid,string)=>{f.writes.push(['update',uid,string]);f.rows.find(r=>r.uid===uid).string=string;throw new Error('lost response');}});
  const draft=f.actions.beginDraft('plan');
  await f.actions.saveDraft({...draft,string:'initial'});
  await f.actions.saveDraft({...draft,string:'latest'});
  assert.equal(f.rows[0].string,'latest');
  assert.equal(f.writes.filter(w=>w[0]==='create').length,1);
  assert.equal(f.writes.filter(w=>w[0]==='update').length,1);
});

test('a graph change during an awaited write prevents read-back or follow-up work in the other graph', async t => {
  const prior=global.window;
  global.window={roamAlphaAPI:{graph:{name:'original'}},navigator:{locks:{request:async(_n,_o,action)=>action()}}};
  t.after(()=>{global.window=prior;});
  let started, release;
  const beginning=new Promise(resolve=>started=resolve);
  const gate=new Promise(resolve=>release=resolve);
  const f=await fixture({runExclusive:undefined,move:async()=>{started();await gate;}});
  const pending=f.actions.moveTask({planUid:'plan',uid:'b',position:'top'});
  await beginning;
  global.window.roamAlphaAPI.graph.name='replacement'; release();
  await assert.rejects(pending,/graph changed/);
  assert.deepEqual(f.rows.map(r=>r.uid),['event','done','a','b','c']);
});
