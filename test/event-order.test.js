const test=require('node:test');
const assert=require('node:assert/strict');
const core=require('../src/log-core');
const timing=require('../src/timing-core');
const macro='{{[[roam/render]]:((roam-render-Nautilus-Log-r2-cljs))}}';
function snapshot(rows,date=new Date(2026,10,1)) {
  const projected=rows.map((row,order)=>({...row,order,parentUid:'plan'}));
  return {date,pageTitle:'November 1st, 2026',pageUid:'day',plan:{uid:'plan',string:macro},rows:projected,
    tasks:timing.projectPlan(projected,'plan'),fixedEvents:timing.projectFixedEvents(projected,'plan'),reviewCandidates:timing.projectReviewCandidates(projected,'plan')};
}
const positions=projection=>({scheduled:projection.scheduledTasks.map(task=>[task.uid,task.start,task.end]),overflow:projection.overflowTasks.map(task=>task.uid)});

test('overlapping reservations merge for capacity while their cumulative end constrains following tasks',()=>{
  const plan=snapshot([
    {uid:'first',string:'12:00-13:00 First commitment'},
    {uid:'overlap',string:'{{[[DONE]]}} 12:30-14:00 Still reserved'},
    {uid:'task',string:'{{[[TODO]]}} Work 30m'},
  ]);
  const result=timing.executionProjection(plan,new Date(2026,10,1,9),{workdayStart:9,workdayEnd:16,respectEventOrder:true});
  assert.equal(result.fixedMinutes,120);assert.equal(result.availableMinutes,300);
  assert.deepEqual(positions(result),{scheduled:[['task',840,870]],overflow:[]});
  assert.deepEqual(core.overlappingFixedEventUids({events:plan.fixedEvents}),['first','overlap']);
});

test('a beyond-END floor leaves the whole ordered queue visible instead of overtaking or splitting',()=>{
  const plan=snapshot([
    {uid:'late',string:'17:00-18:00 Outside the budget window'},
    {uid:'first',string:'{{[[TODO]]}} First 30m'},
    {uid:'second',string:'{{[[TODO]]}} Second 15m'},
  ]);
  const result=timing.executionProjection(plan,new Date(2026,10,1,9),{workdayStart:9,workdayEnd:17,respectEventOrder:true});
  assert.deepEqual(positions(result),{scheduled:[],overflow:['first','second']});
  assert.equal(result.unplacedMinutes,45);assert.equal(result.overloadMinutes,0);
});

test('malformed, zero and reversed event ranges supply no floor; completed task rows do not reset an existing floor',()=>{
  const values=core.eventStartFloors([
    {uid:'invalid',meeting:true,start:540,end:'invalid'},
    {uid:'zero',meeting:true,start:540,end:540},
    {uid:'reversed',meeting:true,start:660,end:600},
    {uid:'unbounded',meeting:true,start:600,end:Infinity},
    {uid:'first',todo:true,duration:30},
    {uid:'valid',meeting:true,start:720,end:780},
    {uid:'done-task',todo:true,done:true,duration:15},
    {uid:'last',todo:true,duration:15},
  ]);
  assert.equal(values.find(row=>row.uid==='first').earliestStart,0);
  assert.equal(values.find(row=>row.uid==='last').earliestStart,780);
  assert.equal(values.find(row=>row.uid==='done-task').earliestStart,undefined);
});

test('overnight event alignment precedes cumulative floors even for nonchronological outline rows',()=>{
  const plan=snapshot([
    {uid:'midnight',string:'23:30-00:30 Overnight commitment'},
    {uid:'first',string:'{{[[TODO]]}} First 15m'},
    {uid:'earlier',string:'22:00-22:30 Earlier written later'},
    {uid:'second',string:'{{[[TODO]]}} Second 15m'},
  ]);
  const now=new Date(2026,10,1,23),settings={workdayStart:21,workdayEnd:2};
  assert.equal(timing.executionProjection(plan,now,settings).scheduledTasks[0].start,1380);
  assert.deepEqual(positions(timing.executionProjection(plan,now,{...settings,respectEventOrder:true})),
    {scheduled:[['first',1470,1485],['second',1485,1500]],overflow:[]});
});

test('forecasting preserves outline order; only an explicit reorder changes event-relative placement',()=>{
  const rows=[
    {uid:'late',string:'14:00-15:00 Later commitment'},
    {uid:'first',string:'{{[[TODO]]}} First 60m'},
    {uid:'done',string:'{{[[DONE]]}} Finished work 15m'},
    {uid:'early-done',string:'{{[[DONE]]}} 12:00-13:00 Future reservation'},
    {uid:'past',string:'08:00-09:00 Elapsed event'},
    {uid:'second',string:'{{[[TODO]]}} Second 30m'},
  ];
  const original=JSON.stringify(rows),settings={workdayStart:9,workdayEnd:17,respectEventOrder:true};
  const before=timing.executionProjection(snapshot(rows),new Date(2026,10,1,10),settings);
  assert.deepEqual(positions(before),{scheduled:[['first',900,960],['second',960,990]],overflow:[]});
  assert.deepEqual(positions(timing.executionProjection(snapshot(rows),new Date(2026,10,1,10,30),settings)),positions(before));
  assert.equal(JSON.stringify(rows),original);
  const manuallyReordered=[rows[1],rows[0],...rows.slice(2)];
  assert.deepEqual(positions(timing.executionProjection(snapshot(manuallyReordered),new Date(2026,10,1,10),settings)),
    {scheduled:[['first',600,660],['second',900,930]],overflow:[]});
});
