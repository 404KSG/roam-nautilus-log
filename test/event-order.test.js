const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const core=require('../src/log-core');
const timing=require('../src/timing-core');
const macro='{{[[roam/render]]:((roam-render-Nautilus-Log-r2-cljs))}}';
function snapshot(rows,date=new Date(2026,10,4)) {
  const projected=rows.map((row,order)=>({...row,order,parentUid:'plan'}));
  return {date,pageTitle:'November 4th, 2026',pageUid:'day',plan:{uid:'plan',string:macro},rows:projected,
    tasks:timing.projectPlan(projected,'plan'),fixedEvents:timing.projectFixedEvents(projected,'plan')};
}
const positions=projection=>({scheduled:projection.scheduledTasks.map(task=>[task.uid,task.start,task.end]),overflow:projection.overflowTasks.map(task=>task.uid)});
const routines=[
  {uid:'morning',string:'06:00-08:00 Morning routine'},
  {uid:'breakfast',string:'08:00-08:30 Breakfast'},
  {uid:'lunch',string:'11:30-12:30 Lunch'},
  {uid:'break',string:'13:00-13:30 Break'},
  {uid:'evening',string:'17:30-18:30 Evening routine'},
  {uid:'review',string:'18:30-19:00 Review'},
  {uid:'first',string:'{{[[TODO]]}} First task 45m'},
  {uid:'second',string:'{{[[TODO]]}} Second task 30m'},
];

test('legacy event-position settings cannot strand morning work after evening events',()=>{
  const plan=snapshot(routines),before=JSON.stringify(plan),now=new Date(2026,10,4,8,13);
  for(const retiredSettings of [{},{respectEventOrder:true},{'respect-event-order':true}]) {
    const result=timing.executionProjection(plan,now,{workdayStart:6,workdayEnd:20,...retiredSettings});
    assert.deepEqual(positions(result),{scheduled:[['first',510,555],['second',555,585]],overflow:[]});
    assert.equal(result.availableMinutes,510);assert.equal(result.fixedMinutes,197);
    assert.equal(result.totalFixedMinutes,330);assert.equal(result.unplacedMinutes,0);
  }
  const stale={...plan,workday:{...core.planWorkdayContext({ownerDate:plan.date,now,runtime:{'workday-start':6,'workday-end':20}}),respectEventOrder:true}};
  assert.deepEqual(positions(timing.executionProjection(stale,now)),{scheduled:[['first',510,555],['second',555,585]],overflow:[]});
  assert.equal(JSON.stringify(plan),before);
});

test('renderer settings ignore the retired key even when an old client supplies true',()=>{
  const settings=core.resolveRendererSettings({runtime:{'workday-start':6,'workday-end':20,'respect-event-order':true}});
  assert.equal(settings['respect-event-order'],undefined);
  const context=core.planWorkdayContext({ownerDate:new Date(2026,10,4),runtime:{'respect-event-order':true}});
  assert.equal(context.respectEventOrder,undefined);
});

test('cached earliest-start hints cannot reactivate the retired constraint',()=>{
  const fixedEvents=routines.slice(0,6).map(row=>{const range=core.parseTimeRangeToken({text:row.string});return {uid:row.uid,meeting:true,start:range.start,end:range.end};});
  const tasks=[{uid:'first',duration:45,earliestStart:1140},{uid:'second',duration:30,earliestStart:3000}];
  const before=JSON.stringify(tasks);
  const result=core.scheduleTasks({startMinutes:360,endMinutes:1200,nowMinutes:493,fixedEvents,tasks});
  assert.deepEqual(positions(result),{scheduled:[['first',510,555],['second',555,585]],overflow:[]});
  assert.equal(JSON.stringify(tasks),before);
});

test('overlapping and DONE fixed ranges still reserve time without blocking earlier gaps',()=>{
  const plan=snapshot([
    {uid:'event',string:'12:00-13:00 First commitment'},
    {uid:'done-event',string:'{{[[DONE]]}} 12:30-14:00 Still reserved'},
    {uid:'task',string:'{{[[TODO]]}} Work 30m'},
  ]);
  const result=timing.executionProjection(plan,new Date(2026,10,4,9),{workdayStart:9,workdayEnd:16,respectEventOrder:true});
  assert.equal(result.fixedMinutes,120);assert.equal(result.availableMinutes,300);
  assert.deepEqual(positions(result),{scheduled:[['task',540,570]],overflow:[]});
  assert.deepEqual(core.overlappingFixedEventUids({events:plan.fixedEvents}),['event','done-event']);
});

test('an event beyond the workday does not strand otherwise fitting tasks',()=>{
  const plan=snapshot([
    {uid:'late',string:'17:00-18:00 Outside the budget window'},
    {uid:'first',string:'{{[[TODO]]}} First 30m'},
    {uid:'second',string:'{{[[TODO]]}} Second 15m'},
  ]);
  const result=timing.executionProjection(plan,new Date(2026,10,4,9),{workdayStart:9,workdayEnd:17,respectEventOrder:true});
  assert.deepEqual(positions(result),{scheduled:[['first',540,570],['second',570,585]],overflow:[]});
});

test('overnight reservations remain aligned while tasks use earlier free gaps',()=>{
  const plan=snapshot([
    {uid:'midnight',string:'23:30-00:30 Overnight commitment'},
    {uid:'first',string:'{{[[TODO]]}} First 15m'},
    {uid:'earlier',string:'22:00-22:30 Earlier written later'},
    {uid:'second',string:'{{[[TODO]]}} Second 15m'},
  ]);
  const result=timing.executionProjection(plan,new Date(2026,10,4,23),{workdayStart:21,workdayEnd:2,respectEventOrder:true});
  assert.deepEqual(positions(result),{scheduled:[['first',1380,1395],['second',1395,1410]],overflow:[]});
  assert.equal(result.fixedMinutes,60);
});

test('only relative task order controls allocation; fixed-event outline placement does not',()=>{
  const now=new Date(2026,10,4,8,13),settings={workdayStart:6,workdayEnd:20,respectEventOrder:true};
  const sameTasks=[routines[6],...routines.slice(0,6),routines[7]];
  assert.deepEqual(positions(timing.executionProjection(snapshot(sameTasks),now,settings)),positions(timing.executionProjection(snapshot(routines),now,settings)));
  const swapped=[...routines.slice(0,6),routines[7],routines[6]];
  assert.deepEqual(positions(timing.executionProjection(snapshot(swapped),now,settings)),{scheduled:[['second',510,540],['first',540,585]],overflow:[]});
});

test('whole tasks still do not split or overtake when a genuine gap is too small',()=>{
  const plan=snapshot([
    {uid:'event',string:'09:15-10:00 Reserved'},
    {uid:'first',string:'{{[[TODO]]}} First 60m'},
    {uid:'second',string:'{{[[TODO]]}} Second 10m'},
  ]);
  const result=timing.executionProjection(plan,new Date(2026,10,4,9),{workdayStart:9,workdayEnd:10});
  assert.deepEqual(positions(result),{scheduled:[],overflow:['first','second']});
});

test('the settings panel no longer exposes an event-position switch for saved true values',async()=>{
  const module=await import(`data:text/javascript;base64,${fs.readFileSync(path.join(__dirname,'../extension.js')).toString('base64')}#retired-event-positions`);
  const api={settings:{get:key=>key==='respect-event-order'?true:undefined,set:async()=>{throw Error('Unexpected setting write');}}};
  for(const language of ['en','zh']) {
    const panel=module.panelConfig(api,language);
    assert.ok(!panel.settings.some(item=>item.id==='respect-event-order'));
  }
});
