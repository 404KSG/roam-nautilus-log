const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {webcrypto} = require('node:crypto');
const {createManagedGraph, exclusiveLocks, CORE, ROOT, TITLE, COMPONENT} = require('./managed-template-graph.cjs');
let api;
const load = async () => api ||= await import(`data:text/javascript;base64,${fs.readFileSync('extension.js').toString('base64')}`);
async function setup(t, config = {}) {
  const api = await load();
  const g = createManagedGraph(config);
  let date = new Date(2026,8,9,10);
  let tick;
  global.window = {roamAlphaAPI:g.roam, crypto:webcrypto, navigator:{locks:exclusiveLocks()}, setTimeout:()=>1,clearTimeout(){},document:{addEventListener(){},removeEventListener(){}}};
  const sessions = [];
  const make = (extra={}) => {
    const session = api.createTodayPlanSession({extensionAPI:{settings:g.settings}, now:()=>date,
      freezeTemplate:()=>api.freezeCanonicalTemplate(CORE), inspectTemplate:()=>api.inspectCanonicalTemplate(CORE), readTemplateTree:api.readBlockTree,
      buildComponentString:()=>COMPONENT, notify:(message)=>g.trace.push(['notice',message]),
      readTrackingSnapshot:()=>({status:'ready',planSnapshot:{pageTitle:TITLE,pageUid:'day',plan:g.blocks.has(ROOT)?{uid:ROOT}:null}}),
      subscribeTracking: fn => {tick = fn;return ()=>{};}, ...extra});
    sessions.push(session);return session;
  };
  t.after(()=>{sessions.forEach(s=>s.destroy());delete global.window;});
  return {g,api,make,setDate:d=>{date=d;},tick:()=>tick?.({status:'ready',planSnapshot:{pageTitle:TITLE,pageUid:'day',plan:{uid:ROOT}}})};
}
test('real source reader preserves native presentation keys and refuses historical or foreign renderers', async t=>{
  const {g,api}=await setup(t);
  const frozen=api.freezeCanonicalTemplate(CORE);
  assert.equal(frozen.kind,'standard');
  assert.equal(frozen.root.properties['children-view-type'],'numbered');
  for(const string of ['LOGBOOK::', ':CLOCK: [2026-09-08 Tue 09:00]--[2026-09-08 Tue 09:30] => 0:30', '{{[[roam/render]]:((foreign-code))}}']) {
    g.blocks.get('source-step').string=string;
    const result=api.freezeCanonicalTemplate(CORE);
    assert.equal(result.kind,'unsupported',string);
    assert.match(result.reason,/history|renderer/i);
  }
});

test('one real session clones all ordinary content and preserves daily and external ownership', async t=>{
  const {g,make}=await setup(t);
  const before=JSON.stringify([...g.blocks]);
  const s=make();
  assert.equal((await s.ensureToday()).status,'ready-present');
  assert.equal(g.blocks.get(ROOT).string,COMPONENT);
  assert.equal(g.blocks.get(ROOT).parentUid,'day');
  assert.equal(g.blocks.get(ROOT).order,1);
  assert.deepEqual(g.children(ROOT).map(b=>b.string),['09:00-09:30 Stand-up','{{[[TODO]]}} Write 30m ((external-note))','{{[[DONE]]}} Prepared 15m','---','((clone-3)) and ((external-note))']);
  assert.equal(g.blocks.get('clone-3').string,'**First step** ((clone-1))');
  assert.equal(g.blocks.get('clone-3')['children-view-type'],'document');
  assert.equal(JSON.stringify([...g.blocks].filter(([uid])=>!uid.startsWith('clone-')&&uid!==ROOT)),before);
  assert.deepEqual(g.trace.filter(r=>r[0]==='open'),[['open',ROOT]]);
});

test('partial stays partial on locate, ticks, discover and reload; only explicit same-memory resume fills missing nodes', async t=>{
  const {g,make,tick}=await setup(t);
  let n=0;g.hooks.beforeCreate=()=>{if(++n===3)throw Error('Nth create failure');};
  const s=make({trackingEnabled:()=>true});
  assert.equal((await s.ensureToday()).status,'partial');
  assert.equal((await s.locateToday()).status,'partial');
  tick();assert.equal(s.getState().status,'partial');
  await s.discover({authoritative:true});assert.equal(s.getState().status,'partial');
  const reloaded=make({trackingEnabled:()=>true});reloaded.initialize();
  assert.notEqual(reloaded.getState().status,'ready-present');
  assert.equal((await reloaded.ensureToday({resume:true})).status,'partial');
  assert.equal(g.trace.filter(r=>r[0]==='create').length,2);
  delete g.hooks.beforeCreate;
  assert.equal((await s.ensureToday({resume:true})).status,'ready-present');
  assert.equal(g.trace.filter(r=>r[0]==='create').length,7);
});

for (const phase of ['lock','record','page']) test(`source changes during ${phase} await stop before any template request`, async t=>{
  const {g,make}=await setup(t,{day:phase!=='page'});
  const change=()=>{g.blocks.get('source-task').string='Changed source';};
  if(phase==='lock') window.navigator.locks={request:async(_n,_o,fn)=>{change();return fn();}};
  if(phase==='record') g.hooks.afterSet=(_k,v)=>{if(v)change();};
  if(phase==='page') g.hooks.afterPage=change;
  const s=make();
  assert.equal((await s.ensureToday()).error,'templateChanged');
  assert.equal(g.trace.filter(r=>r[0]==='request').length,0);
  delete g.hooks.afterSet;delete g.hooks.afterPage;
  assert.equal((await s.ensureToday()).status,'ready-present','zero-template-write failures are retryable');
});

for (const change of ['string','open','heading','order','parentUid','delete']) test(`same-intent resume refuses destination ${change} edits`,async t=>{
  const {g,make}=await setup(t);let n=0;
  g.hooks.beforeCreate=()=>{if(++n===4)throw Error('stop');};
  const s=make();await s.ensureToday();delete g.hooks.beforeCreate;
  const block=g.blocks.get('clone-1');
  if(change==='delete')g.blocks.delete(block.uid);
  else block[change]=({string:'Edited',open:false,heading:3,order:4,parentUid:'notes-page'})[change];
  assert.equal((await s.ensureToday({resume:true})).status,'partial');
  assert.equal(s.getState().canResume,false);
  assert.equal(g.trace.filter(r=>r[0]==='create').length,3);
});

for (const uid of ['clone-repeat',ROOT,'external-note']) test(`duplicate allocation ${uid} refuses without writes`,async t=>{
  const {g,make}=await setup(t);g.ids.push(uid,uid);
  assert.equal((await make().ensureToday()).error,'uidCollision');
  assert.equal(g.trace.filter(r=>r[0]==='request').length,0);
});

test('write-then-throw is partial; continuation uses frozen text even after source changes',async t=>{
  const {g,make}=await setup(t);let n=0;
  g.hooks.afterCreate=()=>{if(++n===3)throw Error('response lost');};
  const s=make();assert.equal((await s.ensureToday()).status,'partial');
  g.blocks.get('source-step').string='New template text';delete g.hooks.afterCreate;
  assert.equal((await s.ensureToday({resume:true})).status,'ready-present');
  assert.equal(g.blocks.get('clone-3').string,'**First step** ((clone-1))');
});

test('a fully written throw verifies complete; navigation failure never clones on retry or discovery',async t=>{
  const {g,make,tick}=await setup(t);let n=0;
  g.hooks.afterCreate=()=>{if(++n===7)throw Error('response lost');};
  g.hooks.navigate=()=>{throw Error('navigation failed');};
  const s=make({trackingEnabled:()=>true});
  assert.equal((await s.ensureToday()).status,'nav-failed');
  tick();await s.discover({authoritative:true});assert.equal(s.getState().status,'nav-failed');
  delete g.hooks.navigate;
  assert.equal((await s.locateToday()).status,'ready-present');
  assert.equal(g.trace.filter(r=>r[0]==='create').length,7);
});

for(const tracking of [false,true]) test(`SHA-256 reload verification with tracking ${tracking} is bounded and never resumes`,async t=>{
  const {g,make,tick}=await setup(t);let n=0;
  g.hooks.beforeCreate=()=>{if(++n===3)throw Error('stop');};
  const first=make();await first.ensureToday();first.destroy();
  const raw=[...g.values].find(([k])=>k.startsWith('nautilus-log:today-plan-operation:'))[1];
  const receipt=JSON.parse(raw);assert.match(receipt.nodes[0].hash,/^[a-f0-9]{64}$/);
  assert.ok(!raw.includes('Stand-up')&&!raw.includes('Write 30m'));
  const s=make({trackingEnabled:()=>tracking});s.initialize();
  assert.notEqual(s.getState().status,'ready-present');
  await s.discover({authoritative:true});assert.equal(s.getState().status,'partial');
  const reads=g.trace.length;for(let i=0;i<60;i++){tick();s.discover();}
  assert.equal(g.trace.length,reads,'ticks use cached integrity');
  assert.equal((await s.ensureToday({resume:true})).status,'partial');
  assert.equal(s.getState().canResume,false);
});

test('two independent sessions share a lock, not permission to resume each other',async t=>{
  const {g,make}=await setup(t);let n=0;
  g.hooks.beforeCreate=()=>{if(++n===3)throw Error('stop');};
  const a=make(),b=make();
  await Promise.all([a.ensureToday(),b.ensureToday()]);
  assert.equal(a.getState().status,'partial');assert.equal(b.getState().status,'partial');
  delete g.hooks.beforeCreate;
  await b.ensureToday({resume:true});assert.equal(g.trace.filter(r=>r[0]==='create').length,2);
  await a.ensureToday({resume:true});await b.locateToday();
  assert.equal(b.getState().status,'ready-present');
  assert.equal(g.trace.filter(r=>r[0]==='create').length,7);
});

for(const contents of [[],['{{[[DONE]]}} Finished 10m'],['{{[[TODO]]}} Manual 10m']]) test(`existing manual plan (${contents.length ? contents[0] : 'empty'}) is locate-only`,async t=>{
  const {g,make}=await setup(t);g.add({uid:'manual-plan',string:COMPONENT,parentUid:'day',order:1});
  contents.forEach((string,order)=>g.add({uid:`manual-${order}`,string,parentUid:'manual-plan',order}));
  g.blocks.get('source-task').string='LOGBOOK::';
  assert.equal((await make().ensureToday()).planUid,'manual-plan');
  assert.equal(g.trace.filter(r=>r[0]==='request').length,0);
});

for(const phase of ['page','record','first-block']) test(`midnight during ${phase} keeps the frozen day and never marks it as today`,async t=>{
  const {g,make,setDate}=await setup(t,{day:phase!=='page'});
  const midnight=()=>setDate(new Date(2026,8,10,0,0,1));
  if(phase==='page')g.hooks.afterPage=midnight;
  if(phase==='record')g.hooks.afterSet=(_k,v)=>{if(v)midnight();};
  if(phase==='first-block')g.hooks.afterCreate=midnight;
  const s=make();const result=await s.ensureToday();
  assert.equal(result.pageTitle,'September 10th, 2026');
  assert.equal(result.error,phase==='first-block'?'dateChangedAfterCreate':'dateChanged');
  assert.equal(g.trace.filter(r=>r[0]==='create').length,phase==='first-block'?7:0);
  assert.equal(g.trace.filter(r=>r[0]==='open').length,0);
  await s.discover({authoritative:true});assert.equal(s.getState().status,'ready-absent');
});

for(const stop of ['unload','graph']) test(`${stop} after an in-flight write prevents following writes, readback, receipt clearing and navigation`,async t=>{
  const {g,make}=await setup(t);const s=make();let traceLength;
  g.hooks.afterCreate=()=>{if(stop==='unload')s.destroy();else g.roam.graph.name='other';traceLength=g.trace.length;};
  await s.ensureToday();
  assert.equal(g.trace.filter(r=>r[0]==='create').length,1);
  assert.equal(g.trace.length,traceLength);
  assert.ok([...g.values].some(([k,v])=>k.startsWith('nautilus-log:today-plan-operation:')&&v));
});

for(const failure of ['reject','corrupt','delayed-read']) test(`receipt ${failure}: only successful readback permits template writes`,async t=>{
  const {g,make}=await setup(t);
  if(failure==='reject')g.hooks.beforeSet=()=>{throw Error('settings failed');};
  if(failure==='corrupt')g.values.set(`nautilus-log:today-plan-operation:test-graph:${TITLE}`,'{broken');
  if(failure==='delayed-read')g.hooks.get=(k,values)=>k.startsWith('nautilus-log:')?Promise.resolve(values.get(k)):values.get(k);
  const s=make();const result=await s.ensureToday();
  if(failure==='delayed-read')assert.equal(result.status,'ready-present');
  else {assert.equal(result.status,'read-failed');assert.equal(g.trace.filter(r=>r[0]==='request').length,0);}
});

test('delayed template request coalesces; a rejected ambiguous root keeps its identity for explicit continuation',async t=>{
  const {g,make}=await setup(t);let release,start;
  const gate=new Promise(r=>release=r),started=new Promise(r=>start=r);
  g.hooks.beforeCreate=async()=>{start();await gate;throw Error('ambiguous request');};
  const s=make(),p=s.ensureToday();await started;
  assert.equal(s.getState().status,'creating');assert.equal(s.ensureToday(),p);
  release();assert.equal((await p).status,'partial');
  await s.ensureToday();assert.equal(g.trace.filter(r=>r[0]==='request').length,1);
  delete g.hooks.beforeCreate;
  await s.ensureToday({resume:true});assert.equal(g.trace.filter(r=>r[0]==='create').length,7);
});

test('partial stays partial when destination readback fails on locate or tracking reload',async t=>{
  const {g,make}=await setup(t);let n=0;
  g.hooks.beforeCreate=()=>{if(++n===3)throw Error('stop');};
  const s=make();await s.ensureToday();
  g.hooks.query=q=>{if(q.includes(`?e :block/uid "${ROOT}"`))throw Error('temporary destination read failure');};
  assert.equal((await s.locateToday()).status,'partial');
  const b=make({trackingEnabled:()=>true});b.initialize();
  await b.discover({authoritative:true});assert.equal(b.getState().status,'partial');
});

test('receipt clear write-then-throw confirms completion without stranding a complete tree',async t=>{
  const {g,make}=await setup(t);
  g.hooks.afterSet=(_k,v)=>{if(v==='')throw Error('clear response lost');};
  const s=make();assert.equal((await s.ensureToday()).status,'ready-present');
  assert.equal(g.trace.filter(r=>r[0]==='create').length,7);
});

test('failed page creation and failed receipt readback are retryable before any template request',async t=>{
  const {g,make}=await setup(t,{day:false});
  g.hooks.beforePage=()=>{throw Error('page failed');};const s=make();
  assert.equal((await s.ensureToday()).status,'read-failed');
  delete g.hooks.beforePage;
  g.hooks.afterSet=(k,v)=>{if(v)g.values.set(k,'');};
  assert.equal((await s.ensureToday()).status,'read-failed');
  assert.equal(g.trace.filter(r=>r[0]==='request').length,0);
  delete g.hooks.afterSet;assert.equal((await s.ensureToday()).status,'ready-present');
});

for(const corruption of ['root-parent','root-order','attribute']) test(`full tree count alone cannot certify ${corruption}`,async t=>{
  const {g,make}=await setup(t);let n=0;
  g.hooks.afterCreate=()=>{if(++n===7){const root=g.blocks.get(ROOT);if(corruption==='root-parent')root.parentUid='notes-page';else if(corruption==='root-order')root.order=0;else root['text-align']='right';}};
  assert.equal((await make().ensureToday()).status,'partial');
});

for(const variant of ['duplicate-source','cycle','order','unknown-property','invalid-value','many-roots','sibling','depth']) test(`unsafe ${variant} source fails before template writes`,async t=>{
  const {g,make}=await setup(t);
  if(variant==='duplicate-source')g.hooks.query=q=>q.includes('?parent :block/uid "source-task"')?[[g.blocks.get('source-event')]]:undefined;
  if(variant==='cycle')g.hooks.query=q=>q.includes('?parent :block/uid "source-step"')?[[g.blocks.get('source-task')]]:undefined;
  if(variant==='order')g.blocks.get('source-task').order=0;
  if(variant==='unknown-property')g.blocks.get('source-task').props={private:'not preservable'};
  if(variant==='invalid-value')g.blocks.get('source-task').heading=9;
  if(variant==='many-roots')g.add({uid:'second-template',string:'Nautilus Flow [[roam/templates]]',parentUid:'render-page',order:1});
  if(variant==='sibling')g.add({uid:'extra',string:'Must not be dropped',parentUid:'template',order:1});
  if(variant==='depth')for(let i=0;i<66;i++)g.add({uid:`deep-${i}`,string:'Note',parentUid:i?`deep-${i-1}`:'source-step',order:0});
  const result=await make().ensureToday();
  assert.equal(result.status,'ready-blocked');assert.ok(result.reason);
  assert.equal(g.trace.filter(r=>r[0]==='request'||r[0]==='page-request').length,0);
});

test('late initialization receipt read cannot overwrite a newer partial operation',async t=>{
  const {g,make}=await setup(t);let release,n=0;
  const pending=new Promise(r=>release=r);let first=true;
  g.hooks.get=(k,values)=>{if(k.startsWith('nautilus-log:')&&first){first=false;return pending;}return values.get(k);};
  g.hooks.beforeCreate=()=>{if(++n===3)throw Error('stop');};
  const s=make({trackingEnabled:()=>true});s.initialize();await s.ensureToday();
  release('');await new Promise(r=>setImmediate(r));
  assert.equal(s.getState().status,'partial');
});

test('partial projection is scoped to graph/date, including a return to the original date',async t=>{
  const {g,make,setDate}=await setup(t);let n=0;
  g.hooks.beforeCreate=()=>{if(++n===3)throw Error('stop');};
  const s=make();await s.ensureToday();
  setDate(new Date(2026,8,10,10));await s.discover();assert.equal(s.getState().status,'ready-absent');
  setDate(new Date(2026,8,9,10));await s.discover();assert.equal(s.getState().status,'partial');
});

for(let nth=1;nth<=7;nth++) test(`request ${nth} failure retains the prefix and explicit continuation writes only missing nodes`,async t=>{
  const {g,make}=await setup(t);let n=0;
  g.hooks.beforeCreate=()=>{if(++n===nth)throw Error('Nth create');};
  const s=make();assert.equal((await s.ensureToday()).status,'partial');
  assert.equal(s.getState().verifiedCount,nth-1);
  delete g.hooks.beforeCreate;
  await s.ensureToday({resume:true});assert.equal(s.getState().status,'ready-present');
  assert.equal(g.trace.filter(r=>r[0]==='create').length,7);
});

test('SHA-256 detects destination edits after reload without disclosing source text',async t=>{
  const {g,make}=await setup(t);let n=0;
  g.hooks.beforeCreate=()=>{if(++n===4)throw Error('stop');};
  const a=make();await a.ensureToday();a.destroy();
  g.blocks.get('clone-1').string='Edited stand-up';
  const b=make();await b.discover({authoritative:true});
  assert.equal(b.getState().status,'partial');assert.match(b.getState().reason,/changed/);
  assert.equal(b.getState().canResume,false);
});

test('a rejected root with no visible blocks can be verified after reload even when the template is unreadable',async t=>{
  const {g,make}=await setup(t);g.hooks.beforeCreate=()=>{throw Error('ambiguous root');};
  const a=make();await a.ensureToday();a.destroy();
  g.hooks.query=q=>{if(q.includes('?parent :block/uid "template"'))throw Error('source unavailable');};
  const b=make();assert.equal((await b.ensureToday()).status,'partial');
  assert.equal(g.trace.filter(r=>r[0]==='request').length,1);
});

test('a delayed clear holds the lock until it settles and cannot erase a later operation receipt',async t=>{
  const {g,make}=await setup(t);let start,release;
  const gate=new Promise(r=>release=r),started=new Promise(r=>start=r);
  g.hooks.beforeSet=async(_k,v)=>{if(v===''){start();await gate;}};
  const a=make(),b=make();const first=a.ensureToday();await started;const second=b.ensureToday();
  assert.equal(g.trace.filter(r=>r[0]==='create').length,7);
  release();await Promise.all([first,second]);
  assert.equal(a.getState().status,'ready-present');assert.equal(b.getState().status,'ready-present');
  assert.equal(g.trace.filter(r=>r[0]==='create').length,7);
});

test('an already-initialized idle tracking session verifies a newly observed reserved root before presenting it',async t=>{
  const {g,make}=await setup(t);let n=0;
  const observer=make({trackingEnabled:()=>true});observer.initialize();
  const writer=make();
  g.hooks.beforeCreate=()=>{if(++n===3)throw Error('stop');};
  await writer.ensureToday();
  await observer.discover();
  assert.equal(observer.getState().status,'partial');
  assert.equal(observer.getState().canResume,false);
});

test('periodic tracking snapshot replacement does not rescan the whole source template',async t=>{
  const {g,make}=await setup(t);
  const s=make({trackingEnabled:()=>true});s.initialize();
  const reads=g.trace.filter(r=>r[0]==='query').length;
  for(let i=0;i<60;i++)s.discover(); // host returns a new snapshot object each time
  assert.equal(g.trace.filter(r=>r[0]==='query').length,reads);
});

test('a changed receipt identity never offers continuation to an older in-memory intent',async t=>{
  const {g,make}=await setup(t);let n=0;
  g.hooks.beforeCreate=()=>{if(++n===3)throw Error('stop');};
  const s=make();await s.ensureToday();
  const [key,raw]=[...g.values].find(([key])=>key.startsWith('nautilus-log:today-plan-operation:'));
  const record=JSON.parse(raw);record.id='another-operation';g.values.set(key,JSON.stringify(record));
  await s.ensureToday({resume:true});
  assert.equal(s.getState().status,'partial');assert.equal(s.getState().canResume,false);
  assert.equal(g.trace.filter(r=>r[0]==='create').length,2);
});

for(const namespaced of [true,false]) test(`native/unqualified presentation reads (${namespaced}) normalize missing defaults without dropping explicit fields`,async t=>{
  const {g,make}=await setup(t,{namespaced});
  delete g.blocks.get('source-event').open;
  const s=make();assert.equal((await s.ensureToday()).status,'ready-present');
  const event=g.blocks.get('clone-1');
  assert.equal(event.open,true);assert.equal(event.heading,0);assert.equal(event['text-align'],'left');assert.equal(event['children-view-type'],'bullet');
  assert.equal(g.blocks.get(ROOT)['children-view-type'],'numbered');
});

test('Roam unqualified activity metadata does not block a complete template copy',async t=>{
  const {g,make}=await setup(t,{namespaced:false});
  const query=g.roam.q.bind(g.roam);
  g.roam.q=(pattern,...args)=>{
    const rows=query(pattern,...args);
    if(!pattern.includes('[*]'))return rows;
    return rows.map(([block])=>[{...block,time:1700000000000,user:{id:7},'seen-by':[{id:7}],id:42}]);
  };
  const result=await make().ensureToday();
  assert.equal(result.status,'ready-present',result.message);
  assert.equal(g.trace.filter(r=>r[0]==='create').length,7);
  assert.equal(g.blocks.get(ROOT).user,undefined,'activity attribution must not be copied');
});

test('Roam unqualified view-type retains numbered and document presentation',async t=>{
  const {g,make}=await setup(t,{namespaced:false});
  const query=g.roam.q.bind(g.roam);
  g.roam.q=(pattern,...args)=>{
    const rows=query(pattern,...args);
    if(!pattern.includes('[*]'))return rows;
    return rows.map(([block])=>{
      const copy={...block};
      if('children-view-type' in copy){copy['view-type']=copy['children-view-type'];delete copy['children-view-type'];}
      return [copy];
    });
  };
  const result=await make().ensureToday();
  assert.equal(result.status,'ready-present',result.message);
  assert.equal(g.blocks.get(ROOT)['children-view-type'],'numbered');
  assert.equal(g.blocks.get('clone-3')['children-view-type'],'document');
});

test('canonical source serialization grows with the tree, not exponential JSON escaping',async t=>{
  const {g,api}=await setup(t);
  for(let i=0;i<12;i++)g.add({uid:`nested-${i}`,string:'A "quoted" note \\ path',parentUid:i?`nested-${i-1}`:'source-step',order:0});
  const source=api.freezeCanonicalTemplate(CORE);
  assert.equal(source.kind,'standard');assert.ok(source.fingerprint.length<10000);
});

for(const stop of ['unload','graph']) test(`${stop} during sidebar lookup prevents following native navigation`,async t=>{
  const {g,make}=await setup(t);const s=make();await s.ensureToday({locateMode:'none'});
  let start,release;
  const started=new Promise(r=>start=r),gate=new Promise(r=>release=r);
  g.roam.ui.rightSidebar.getWindows=()=>{start();return gate;};
  const locating=s.locateToday({locateMode:'sidebar'});await started;
  if(stop==='unload')s.destroy();else g.roam.graph.name='another-graph';
  release([]);await locating;
  assert.equal(g.trace.filter(r=>r[0]==='sidebar').length,0);
});

for(const scenario of ['fresh','midnight']) test(`explicit continuation (${scenario}) never starts a new operation`,async t=>{
  const {g,make,setDate}=await setup(t);const s=make();
  if(scenario==='midnight'){
    let n=0;g.hooks.beforeCreate=()=>{if(++n===3)throw Error('stop');};
    await s.ensureToday();delete g.hooks.beforeCreate;
    setDate(new Date(2026,8,10,0,0,1));
  }
  const writes=g.trace.filter(r=>r[0]==='request'||r[0]==='page-request').length;
  const result=await s.ensureToday({resume:true});
  assert.equal(result.error,'resumeUnavailable');
  assert.equal(g.trace.filter(r=>r[0]==='request'||r[0]==='page-request').length,writes);
});

for(const fault of ['missing','throw']) for(const route of ['discover','locateToday','ensureToday']) test(`known incomplete receipt stays incomplete when settings ${fault} on ${route}`,async t=>{
  const {g,make}=await setup(t);let n=0;
  g.hooks.beforeCreate=()=>{if(++n===3)throw Error('stop');};
  const a=make();await a.ensureToday();a.destroy();
  const b=make();await b.discover({authoritative:true});assert.equal(b.getState().status,'partial');
  if(fault==='missing') {
    for(const key of g.values.keys())if(key.startsWith('nautilus-log:today-plan-operation:'))g.values.set(key,'');
  } else g.hooks.get=(key,values)=>{if(key.startsWith('nautilus-log:today-plan-operation:'))throw Error('settings temporarily unavailable');return values.get(key);};
  await b[route]({authoritative:true});
  assert.equal(b.getState().status,'partial');
  assert.equal(g.trace.filter(r=>r[0]==='create').length,2);
});

test('an Inspect UID lookup failure cannot clear an incomplete operation',async t=>{
  const {g,make}=await setup(t);let n=0;
  g.hooks.beforeCreate=()=>{if(++n===3)throw Error('stop');};const s=make();await s.ensureToday();
  g.roam.data.pull=()=>{throw Error('UID lookup unavailable');};
  await s.locateToday();assert.equal(s.getState().status,'partial');
});

test('a settings outage including language reads remains a visible, handled partial failure',async t=>{
  const {g,make}=await setup(t);let n=0;
  g.hooks.beforeCreate=()=>{if(++n===3)throw Error('stop');};const s=make();await s.ensureToday();
  g.hooks.get=()=>{throw Error('Settings are unavailable');};
  await s.locateToday();
  assert.equal(s.getState().status,'partial');assert.match(s.getState().message,/Settings are unavailable/);
});
