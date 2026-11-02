const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { webcrypto } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const logCore = require('../src/log-core');
const timingCore = require('../src/timing-core');
const { createManagedGraph, exclusiveLocks, CORE, COMPONENT } = require('./managed-template-graph.cjs');
let extension;
const load = async () => extension ||= await import(`data:text/javascript;base64,${fs.readFileSync('extension.js').toString('base64')}#active-workday`);
const NIGHT = 'November 1st, 2026', TODAY = 'November 2nd, 2026';
const macro = `${CORE} 22 15 21 "" 2}}`;

async function setup(t, { today = true, running = false, now = new Date(2026,10,2,0,30) } = {}) {
  const api = await load(), g = createManagedGraph({ day:false });
  let instant = now, actor = 'workday-user', tick;
  const timers = new Map(), realTimers = new Set(); let timerId = 0;
  g.roam.graph.type = 'hosted'; g.roam.user = { uid: () => actor };
  g.pages.set(NIGHT, '11-01-2026');
  g.add({ uid:'night-plan', parentUid:'11-01-2026', order:0, string:macro });
  g.add({ uid:'night-task', parentUid:'night-plan', order:0, string:'{{[[TODO]]}} Night work 90m' });
  g.add({ uid:'night-done', parentUid:'night-plan', order:1, string:'{{[[DONE]]}} Finished work 45m d0:15' });
  g.add({ uid:'night-drawer', parentUid:'night-done', order:0, string:'LOGBOOK::' });
  g.add({ uid:'night-closed', parentUid:'night-drawer', order:0,
    string:'CLOCK: [2026-11-01 Sun 23:30]--[2026-11-02 Mon 00:15] => 0:45' });
  if (today) {
    g.pages.set(TODAY,'11-02-2026');
    g.add({ uid:'today-plan', parentUid:'11-02-2026', order:0, string:macro });
    g.add({ uid:'today-task', parentUid:'today-plan', order:0, string:'{{[[TODO]]}} Next night 30m' });
  }
  if (running) {
    g.add({ uid:'running-drawer', parentUid:'night-task', order:0, string:'LOGBOOK::' });
    g.add({ uid:'night-running', parentUid:'running-drawer', order:0, string:'CLOCK: [2026-11-01 Sun 23:30]' });
  }
  g.hooks.query = (query, ...args) => {
    if (!query.includes('?clock-uid ?clock-string')) return undefined;
    const scoped = query.includes('[?task-uid ...]') ? new Set(args[0]) : null;
    return [...g.blocks.values()].filter(row => /^CLOCK:/.test(row.string)).filter(row => {
      const task = g.blocks.get(g.blocks.get(row.parentUid)?.parentUid);
      return (!scoped || scoped.has(task?.uid)) && (!query.includes('?running-pattern') || args[1].test(row.string));
    }).map(row => {
      const drawer = g.blocks.get(row.parentUid), task = g.blocks.get(drawer.parentUid);
      return [row.uid,row.string,drawer.string,task.uid,task.string,[...g.pages].find(([,id])=>id===g.pageOf(task))?.[0]];
    });
  };
  g.roam.data.block.update = async ({block}) => {
    g.trace.push(['update-request',block.uid]); await g.hooks.beforeUpdate?.(block);
    Object.assign(g.blocks.get(block.uid),block); g.trace.push(['update',block.uid]);
  };
  for (const [key,value] of Object.entries({ 'workday-start':21,'workday-end':2,'timing-line-sidebar':false,
    'actual-time-tracking':true,'energy-bar-enabled':false,'respect-event-order':false })) g.values.set(key,value);
  const host = global.window = { roamAlphaAPI:g.roam, crypto:webcrypto, navigator:{locks:exclusiveLocks()},
    addEventListener(){},removeEventListener(){},document:{addEventListener(){},removeEventListener(){}},
    setInterval(fn){tick=fn;return 1;},clearInterval(){},
    setTimeout(fn,ms){ if(ms<1000){const id=setTimeout(fn,ms);realTimers.add(id);return id;} const id=++timerId;timers.set(id,{fn,ms});return id; },
    clearTimeout(id){clearTimeout(id);realTimers.delete(id);timers.delete(id);},
  };
  const controllers = [];
  const makeRuntime = () => {
    const runtime = api.createTimingRuntime({ extensionAPI:{settings:g.settings}, now:()=>instant, wallNow:()=>instant.getTime() });
    controllers.push(runtime); return runtime;
  };
  const makeSession = (extra={}) => {
    const session = api.createTodayPlanSession({ extensionAPI:{settings:g.settings}, now:()=>instant,
      inspectTemplate:()=>api.inspectCanonicalTemplate(CORE), freezeTemplate:()=>api.freezeCanonicalTemplate(CORE),
      readTemplateTree:api.readBlockTree, buildComponentString:()=>COMPONENT, notify:message=>g.trace.push(['notice',message]), ...extra });
    controllers.push(session); return session;
  };
  t.after(()=>{controllers.forEach(value=>value.destroy());realTimers.forEach(clearTimeout);delete global.window;});
  return {api,g,host,makeRuntime,makeSession,timers,setNow:value=>{instant=value;},setUser:value=>{actor=value;},tick:()=>tick?.(),
    planning:()=>Object.fromEntries(['workday-start','workday-end','respect-event-order'].map(key=>[key,g.values.get(key)]))};
}

test('00:30 selects the previous overnight owner even when a calendar-today plan exists', async t => {
  const {api,g,planning} = await setup(t);
  const snapshot = api.readActivePrimaryPlan(new Date(2026,10,2,0,30),planning());
  assert.equal(snapshot.plan.uid,'night-plan'); assert.equal(snapshot.pageTitle,NIGHT);
  assert.equal(snapshot.calendarPageTitle,TODAY); assert.equal(snapshot.workday.logicalNowMinutes,1470);
  const projection = timingCore.executionProjection(snapshot,new Date(2026,10,2,0,30),{workdayStart:21,workdayEnd:2});
  assert.equal(projection.availableMinutes,90);
  assert.deepEqual(projection.scheduledTasks.map(task=>[task.uid,task.start,task.end]),[['night-task',1470,1560]]);
  assert.equal(g.trace.filter(row=>row[0]==='request'||row[0]==='update-request').length,0);
});

test('an absent previous day falls back to today; an unreadable previous day never proves absence', async t => {
  const {api,g,planning} = await setup(t);
  g.pages.delete(NIGHT);
  assert.equal(api.readActivePrimaryPlan(new Date(2026,10,2,0,30),planning()).plan.uid,'today-plan');
  g.pages.set(NIGHT,'11-01-2026');
  g.hooks.pull = (_pattern,lookup) => { if(lookup[1]===NIGHT) throw Error('previous day unavailable'); };
  g.hooks.query = (query,title) => { if(query.includes('?page-uid ?uid') && title===NIGHT) throw Error('previous day unavailable'); };
  assert.throws(()=>api.readActivePrimaryPlan(new Date(2026,10,2,0,30),planning()),/unavailable/);
});

test('supported renderer arguments own the overnight window when global hours are absent', async t => {
  const {api,g,makeRuntime,makeSession,planning}=await setup(t);
  g.values.delete('workday-start');g.values.delete('workday-end');
  assert.equal(api.readActivePrimaryPlan(new Date(2026,10,2,0,30),planning()).plan.uid,'night-plan');
  const runtime=makeRuntime();await runtime.initialize();
  assert.equal(runtime.getSnapshot().planSnapshot.execution.availableMinutes,90);
  const session=makeSession();session.initialize();await session.discover({authoritative:true});
  assert.equal(session.getState().planUid,'night-plan');
});

test('unchanged tracking ticks do not repeatedly rediscover absent carryover when only plan arguments define hours', async t => {
  const {api,g,makeSession,planning}=await setup(t);
  g.values.delete('workday-start');g.values.delete('workday-end');
  g.blocks.get('night-plan').string=`${CORE} 22 15 5 "" 21}}`;
  const snapshot={status:'ready',planSnapshot:api.readActivePrimaryPlan(new Date(2026,10,2,0,30),planning())};
  let tick;
  const session=makeSession({trackingEnabled:()=>true,readTrackingSnapshot:()=>snapshot,subscribeTracking:fn=>{tick=fn;return()=>{};}});
  session.initialize();await session.discover({authoritative:true,checkRecord:true});await new Promise(setImmediate);
  const reads=g.trace.filter(row=>row[0]==='pull'&&String(row[1]).includes('node/title')).length;
  for(let i=0;i<60;i++)tick(snapshot);
  await new Promise(setImmediate);
  assert.equal(session.getState().planUid,'today-plan');
  assert.equal(g.trace.filter(row=>row[0]==='pull'&&String(row[1]).includes('node/title')).length,reads);
});

test('ordinary daytime selection does not read yesterday', async t => {
  const {api,g} = await setup(t);
  g.hooks.pull = (_pattern,lookup) => { if(lookup[1]===NIGHT) throw Error('must not read previous day'); };
  assert.equal(api.readActivePrimaryPlan(new Date(2026,10,2,10),{'workday-start':6,'workday-end':20}).plan.uid,'today-plan');
});

test('END ends overnight ownership exactly, without choosing an unsupported future renderer for writes', async t => {
  const {api,g,planning} = await setup(t);
  assert.equal(api.readActivePrimaryPlan(new Date(2026,10,2,1,59),planning()).plan.uid,'night-plan');
  g.blocks.get('today-plan').string = macro.replace('-r2-cljs','-r3-cljs');
  const snapshot = api.readActivePrimaryPlan(new Date(2026,10,2,2),planning());
  assert.equal(snapshot.plan.uid,'today-plan'); assert.equal(snapshot.rendererReadOnly,true);
  assert.deepEqual(snapshot.tasks,[]); assert.deepEqual(snapshot.reviewCandidates,[]);
});

test('starting and completing after midnight writes CLOCK under the active owner only', async t => {
  const {makeRuntime,g,setNow}=await setup(t);const runtime=makeRuntime();await runtime.initialize();
  await runtime.startTask('night-task');
  const clock=[...g.blocks.values()].find(row=>/^CLOCK:/.test(row.string)&&g.blocks.get(row.parentUid)?.parentUid==='night-task');
  assert.ok(clock);assert.match(clock.string,/2026-11-02 Mon 00:30/);
  assert.equal(g.pageOf(clock),'11-01-2026');
  setNow(new Date(2026,10,2,0,45));await runtime.completeTask('night-task');
  assert.match(clock.string,/00:30.*00:45/);assert.match(g.blocks.get('night-task').string,/DONE/);
  assert.doesNotMatch(g.blocks.get('night-task').string,/\sd\d/,'completion stamps remain independently off');
  assert.equal(runtime.getSnapshot().dailyReview.summary.actualMinutes,60);
  assert.match(g.blocks.get('today-task').string,/TODO/);
});

test('Review and per-task metadata count 23:30–00:15 as 45 minutes on the overnight owner', async t => {
  const {makeRuntime} = await setup(t); const runtime = makeRuntime(); await runtime.initialize();
  const snapshot = runtime.getSnapshot();
  assert.equal(snapshot.planSnapshot.pageTitle,NIGHT);
  assert.equal(snapshot.dailyReview.summary.actualMinutes,45);
  const row = snapshot.dailyReview.rows.find(task=>task.uid==='night-done');
  assert.equal(row.actualMinutes,45); assert.equal(row.varianceMinutes,0);
  const metadata = timingCore.durationMetadata({taskUid:row.uid,plannedMinutes:45,entries:snapshot.entries,
    now:snapshot.now,workday:snapshot.planSnapshot.workday});
  assert.equal(metadata.primaryLabel,'Actual 45m');
});

test('END and workday-setting changes reselect the plan without stopping an existing CLOCK', async t => {
  const {makeRuntime,g,setNow} = await setup(t,{running:true}); const runtime=makeRuntime(); await runtime.initialize();
  const before = g.blocks.get('night-running').string;
  setNow(new Date(2026,10,2,2)); await runtime.refresh();
  assert.equal(runtime.getSnapshot().planSnapshot.plan.uid,'today-plan');
  assert.equal(g.blocks.get('night-running').string,before);
  await assert.rejects(runtime.completeTask('night-task'),/Plan|unfinished/);
  assert.equal(g.blocks.get('night-running').string,before);
  setNow(new Date(2026,10,2,0,30)); g.values.set('workday-end',3); await runtime.refresh();
  assert.equal(runtime.getSnapshot().planSnapshot.plan.uid,'night-plan');
  g.values.set('workday-start',6); g.values.set('workday-end',20); await runtime.refresh();
  assert.equal(runtime.getSnapshot().planSnapshot.plan.uid,'today-plan');
  assert.equal(g.blocks.get('night-running').string,before);
  await runtime.stopTask(); assert.match(g.blocks.get('night-running').string,/--/);
});

test('a queued Finish crossing END cannot complete yesterday or close its CLOCK', async t => {
  const {makeRuntime,g,setNow} = await setup(t,{running:true,now:new Date(2026,10,2,1,59)});
  const runtime=makeRuntime(); await runtime.initialize();
  const before=g.blocks.get('night-running').string, finish=runtime.completeTask('night-task');
  setNow(new Date(2026,10,2,2)); await assert.rejects(finish,/date|ownership/i);
  assert.equal(g.blocks.get('night-running').string,before); assert.match(g.blocks.get('night-task').string,/TODO/);
});

test('a Finish accepted under the lock keeps its owner and instant across END', async t => {
  const {makeRuntime,g,setNow}=await setup(t,{running:true,now:new Date(2026,10,2,1,59)});
  const runtime=makeRuntime();await runtime.initialize();
  let begin,release;const started=new Promise(resolve=>begin=resolve),gate=new Promise(resolve=>release=resolve);
  g.hooks.beforeUpdate=async block=>{if(block.uid==='night-running'){begin();await gate;}};
  const finish=runtime.completeTask('night-task');await started;setNow(new Date(2026,10,2,2,1));release();await finish;
  assert.match(g.blocks.get('night-running').string,/2026-11-02 Mon 01:59/);
  assert.match(g.blocks.get('night-task').string,/DONE/);
  assert.equal(runtime.getSnapshot().planSnapshot.plan.uid,'today-plan');
  assert.equal(g.trace.filter(row=>row[0]==='update'&&row[1]==='night-task').length,1);
});

test('a user change while a CLOCK write is in flight prevents the later DONE write', async t => {
  const {makeRuntime,g,setUser}=await setup(t,{running:true});const runtime=makeRuntime();await runtime.initialize();
  let begin,release;const started=new Promise(resolve=>begin=resolve),gate=new Promise(resolve=>release=resolve);
  g.hooks.beforeUpdate=async block=>{if(block.uid==='night-running'){begin();await gate;}};
  const finish=runtime.completeTask('night-task');await started;setUser('different-user');release();
  await assert.rejects(finish,/user|graph|changed|cancelled/i);
  assert.match(g.blocks.get('night-task').string,/TODO/);
});

test('the lightweight entry opens the overnight owner while explicit creation targets the calendar date', async t => {
  const {g,makeSession}=await setup(t,{today:false});const session=makeSession();session.initialize();
  await session.discover({authoritative:true,checkRecord:true});
  assert.equal(session.getState().activeWorkday,true);assert.match(session.getState().labels.locate,/November 1st/);
  await session.activateToday();assert.deepEqual(g.trace.filter(row=>row[0]==='open').at(-1),['open','night-plan']);
  assert.equal(g.trace.filter(row=>row[0]==='request').length,0);
  const result=await session.ensureToday();assert.equal(result.pageTitle,TODAY);assert.equal(result.outcome,'created');
  const root=g.blocks.get('nautilus-log-plan-2026-11-02');assert.ok(root);assert.equal(root.parentUid,'11-02-2026');
  assert.equal(session.getState().planUid,'night-plan');
  assert.equal(g.children('11-01-2026').length,1);
});

test('a disappearing overnight owner becomes unavailable; opening it cannot recreate yesterday', async t => {
  const {g,makeSession}=await setup(t,{today:false});const session=makeSession();session.initialize();await session.discover({authoritative:true});
  g.blocks.delete('night-plan');
  const result=await session.activateToday();assert.equal(result.status,'read-failed');
  assert.equal(g.trace.filter(row=>row[0]==='request'||row[0]==='page-request').length,0);
});

test('an overnight calendar creation coalesces and remains partial after a reload', async t => {
  const {g,makeSession}=await setup(t,{today:false});const session=makeSession();session.initialize();await session.discover({authoritative:true});
  let begin,release;const started=new Promise(resolve=>begin=resolve),gate=new Promise(resolve=>release=resolve);
  g.hooks.beforeCreate=async()=>{begin();await gate;throw Error('uncertain creation');};
  const first=session.ensureToday();await started;assert.equal(session.ensureToday(),first);release();
  assert.equal((await first).status,'partial');assert.equal(session.getCalendarState().status,'partial');
  const requestCount=g.trace.filter(row=>row[0]==='request').length;
  session.destroy();const reloaded=makeSession();reloaded.initialize();await reloaded.discover({authoritative:true});
  assert.equal((await reloaded.ensureToday()).status,'partial');
  assert.equal(g.trace.filter(row=>row[0]==='request').length,requestCount);
});

test('a dated creation label cannot silently create a different calendar date', async t => {
  const {g,makeSession,setNow}=await setup(t,{today:false});const session=makeSession();
  session.initialize();await session.discover({authoritative:true});
  setNow(new Date(2026,10,3,0,30));
  assert.equal((await session.ensureToday({expectedPageTitle:TODAY})).status,'read-failed');
  assert.equal(g.trace.filter(row=>row[0]==='request'||row[0]==='page-request').length,0);
});

test('Locate rechecks the owner at END without waiting for a ticker or creating a plan', async t => {
  const {g,makeRuntime,setNow}=await setup(t,{now:new Date(2026,10,2,1,59)});const runtime=makeRuntime();await runtime.initialize();
  setNow(new Date(2026,10,2,2));await runtime.locate();
  assert.deepEqual(g.trace.filter(row=>row[0]==='open').at(-1),['open','today-plan']);
  assert.equal(g.trace.filter(row=>row[0]==='request').length,0);
});

test('a newer calendar-day renderer is located without a duplicate or a backward rewrite', async t => {
  const {g,makeSession}=await setup(t);g.blocks.get('today-plan').string=macro.replace('-r2-cljs','-r9-cljs');
  const before=g.blocks.get('today-plan').string,session=makeSession();
  const result=await session.ensureToday();assert.equal(result.planUid,'today-plan');assert.equal(result.outcome,'located');
  assert.equal(g.blocks.get('today-plan').string,before);
  assert.equal(g.trace.filter(row=>row[0]==='request'||row[0]==='update-request').length,0);
});

test('fallback creation refuses legacy and newer renderer sources before creating a Daily Note', async t => {
  const {g,makeSession}=await setup(t,{today:false});
  for(const source of [macro.replace('-r2-cljs','-cljs'),macro.replace('-r2-cljs','-r3-cljs')]) {
    const session=makeSession({inspectTemplate:()=>({kind:'missing'}),freezeTemplate:()=>({kind:'missing'}),buildComponentString:()=>source});
    assert.equal((await session.ensureToday()).status,'read-failed');
  }
  assert.equal(g.trace.filter(row=>row[0]==='request'||row[0]==='page-request').length,0);
});

test('event positions are optional and a future DONE event still reserves its written range', async t => {
  const {api,g}=await setup(t,{now:new Date(2026,10,2,9)});
  g.blocks.get('today-task').string='{{[[TODO]]}} Before 60m';
  g.add({uid:'later-event',parentUid:'today-plan',order:1,string:'{{[[DONE]]}} 12:00-13:00 Reserved'});
  g.add({uid:'after-event',parentUid:'today-plan',order:2,string:'{{[[TODO]]}} After 60m'});
  const snapshot=api.readActivePrimaryPlan(new Date(2026,10,2,9),{'workday-start':9,'workday-end':18});
  const off=timingCore.executionProjection(snapshot,new Date(2026,10,2,9),{workdayStart:9,workdayEnd:18});
  const on=timingCore.executionProjection(snapshot,new Date(2026,10,2,9),{workdayStart:9,workdayEnd:18,respectEventOrder:true});
  assert.deepEqual(off.scheduledTasks.map(task=>[task.uid,task.start]),[['today-task',540],['after-event',600]]);
  assert.deepEqual(on.scheduledTasks.map(task=>[task.uid,task.start]),[['today-task',540],['after-event',780]]);
  assert.equal(on.fixedMinutes,60);assert.deepEqual(api.settledUidsForTidy(snapshot),[]);
});

test('ordinary chart hours do not trim evening CLOCK evidence and local stamps normalize only within the overnight window',()=>{
  const owner=new Date(2026,10,1),context=logCore.planWorkdayContext({ownerDate:owner,runtime:{'workday-start':6,'workday-end':20}});
  const entries=[{taskUid:'task',start:new Date(2026,10,1,22),end:new Date(2026,10,1,22,30)}];
  assert.equal(timingCore.actualMinutesToday('task',entries,new Date(2026,10,2),context),30);
  assert.equal(logCore.localCompletionMinute({minute:15,startMinutes:1260,endMinutes:1560}),1455);
  assert.equal(logCore.localCompletionMinute({minute:120,startMinutes:1260,endMinutes:1560}),1560);
  assert.equal(logCore.localCompletionMinute({minute:180,startMinutes:1260,endMinutes:1560}),180);
  assert.equal(logCore.localCompletionMinute({minute:null,startMinutes:1260,endMinutes:1560}),null);
});

test('DST evidence uses local calendar bounds while the aggregate anchor stays on the local clock',()=>{
  const script=`const c=require('./src/log-core');const t=require('./src/timing-core');
const day=new Date(2026,10,1),now=new Date(2026,10,2,0,30),w=c.planWorkdayContext({ownerDate:day,now,runtime:{'workday-start':21,'workday-end':2}});
const e=[{taskUid:'t',start:new Date(2026,10,1,23,30),end:new Date(2026,10,2,0,15)}];
console.log(JSON.stringify({hours:(w.dayEndMs-w.dayStartMs)/3600000,minute:w.logicalNowMinutes,actual:t.actualMinutesToday('t',e,now,w),summary:c.completedTaskClockSummary({taskUid:'t',entries:e,...w})}));`;
  const value=JSON.parse(execFileSync(process.execPath,['-e',script],{cwd:process.cwd(),env:{...process.env,TZ:'America/New_York'},encoding:'utf8'}));
  assert.deepEqual(value,{hours:27,minute:1470,actual:45,summary:{actualMinutes:45,sessionCount:1,latestEndMinutes:1455}});
});
