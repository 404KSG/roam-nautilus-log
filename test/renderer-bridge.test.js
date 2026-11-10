const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {installRendererBridge}=require('../src/renderer-bridge');
const {REVISION, BRIDGE_KEY}=require('../src/renderer-contract');
let extension;
const load=async()=>extension||=await import(`data:text/javascript;base64,${fs.readFileSync('extension.js').toString('base64')}#bridge-lifecycle`);
const root=revision=>`{{[[roam/render]]:((roam-render-Nautilus-Log${revision===1?'':`-r${revision}`}-cljs))}}`;

function fixture(createRendererPlanSession,host,scope,text) {
  const listeners=new Set();
  let snapshot={'block/uid':'plan','block/string':root(1),'block/children':[{'block/uid':'task','block/string':text,'block/order':0}]};
  const handle=installRendererBridge({host,core:{},taskCore:{},getScope:()=>scope,services:{createRendererPlanSession,
    watchPlan:(_uid,listener)=>{listeners.add(listener);listener(snapshot);return()=>listeners.delete(listener);}}});
  handle.setReady(true);
  return {handle,listeners,setRoot(revision){snapshot={...snapshot,'block/string':root(revision)};listeners.forEach(listener=>listener(snapshot));}};
}

test('a retained v1 view follows the next compatible reader without being destroyed by the old owner',async()=>{
  const {createRendererPlanSession}=await load(),host={},scope={provider:{},graph:'graph',user:'user'};
  const first=fixture(createRendererPlanSession,host,scope,'First reader');
  const session=first.handle.legacy.createRendererPlanSession({planUid:'plan'});
  assert.equal(session.sync().children[0]['block/string'],'First reader');
  const second=fixture(createRendererPlanSession,host,scope,'Replacement reader');
  assert.equal(session.sync().children[0]['block/string'],'Replacement reader');
  assert.equal(first.listeners.size,0);assert.equal(second.listeners.size,1);
  first.handle.destroy();assert.equal(session.sync().writesAllowed,true);assert.equal(second.listeners.size,1);
  scope.user='another-user';assert.equal(session.sync().writesAllowed,false);assert.equal(second.listeners.size,0);
  session.destroy();second.handle.destroy();
});

test('real renderer sessions retain read data but lose write authority when the root contract changes',async()=>{
  const {createRendererPlanSession}=await load(),host={},scope={provider:{},graph:'graph',user:'user'};
  const fixtureValue=fixture(createRendererPlanSession,host,scope,'A task');fixtureValue.setRoot(2);
  const session=fixtureValue.handle.bridge.createRendererPlanSession({planUid:'plan'});
  assert.equal(session.sync().writesAllowed,true);
  fixtureValue.setRoot(REVISION + 1);assert.equal(session.getState().writesAllowed,false);
  assert.equal(session.getState().children[0]['block/string'],'A task');
  fixtureValue.handle.destroy();assert.equal(fixtureValue.listeners.size,0);
});

test('an unknown or newer occupant of the r2 bridge slot is preserved',()=>{
  for(const revision of [undefined,REVISION + 1]){
    const foreign={revision,running:true},host={[BRIDGE_KEY]:foreign};
    assert.throws(()=>installRendererBridge({host}),/unsupported version/);
    assert.equal(host[BRIDGE_KEY],foreign);assert.equal(foreign.running,true);
  }
});
