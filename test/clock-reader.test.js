const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
async function api() {
  return import(`data:text/javascript;base64,${Buffer.from(fs.readFileSync('extension.js','utf8')).toString('base64')}#clock-reader`);
}

test('renderer reads uncovered historical owners instead of treating today entries as all history', async () => {
  const { createRendererClockReader } = await api();
  const today = { taskUid:'today', clockUid:'clock-today' }, old = { taskUid:'yesterday', clockUid:'clock-old' };
  let snapshot = { entries:[today], entryTaskUids:['today'] };
  const calls = [];
  const reader = createRendererClockReader({ getSnapshot:()=>snapshot, read:uids=>{calls.push(uids);return [old];} });
  assert.deepEqual(reader.read(['today','yesterday']),[today,old]);
  assert.deepEqual(calls,[['yesterday']]);
  assert.deepEqual(reader.read(['yesterday']),[old]);
  assert.equal(calls.length,1);
  snapshot = { entries:[], entryTaskUids:['today'] };
  assert.deepEqual(reader.read(['today']),[], 'a covered empty owner is real absence');
  assert.deepEqual(reader.read(['yesterday']),[old]);
  assert.equal(calls.length,2);
});

test('renderer cache is bounded, expires, and never crosses a graph/API identity', async () => {
  const { createRendererClockReader } = await api();
  let now=0, scope=['api-a','graph-a'], calls=0;
  const reader=createRendererClockReader({ now:()=>now, getScope:()=>scope, maxOwners:2, ttlMs:10,
    read:uids=>{calls++;return uids.map(taskUid=>({taskUid,clockUid:taskUid}));} });
  reader.read(['a']);reader.read(['b']);reader.read(['c']);
  assert.equal(reader.size(),2);
  reader.read(['a']);assert.equal(calls,4);
  now=20;reader.read(['a']);assert.equal(calls,5);
  scope=['api-a','graph-b'];reader.read(['a']);assert.equal(calls,6);
  scope=['api-b','graph-b'];reader.read(['a']);assert.equal(calls,7);
  reader.clear();assert.equal(reader.size(),0);
});
