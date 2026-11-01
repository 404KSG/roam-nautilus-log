const test = require('node:test');
const assert = require('node:assert/strict');
const { chartScene } = require('../src/log-core');
const measure = text => [...text].reduce((n, c) => n + (/[^\x00-\xff]/.test(c) ? 11 : 6), 0);
const tasks = Array.from({length: 14}, (_, i) => Object.freeze({uid: `task-${i}`, description: `核对项目资料和交付记录 ${i}`, todo: true, duration: 20}));
const build = (events, extra = {}) => chartScene({items: tasks, events, startMinutes: 360, endMinutes: 1200, containerWidth: 400,
  measure, currentLabels: ['Current task', 'Current event'], ...extra});

function checkCompactColumns(scene) {
  const columns = {left: [], right: []};
  for (const r of scene.records) columns[r.label.side].push(r.label);
  for (const [side, labels] of Object.entries(columns)) {
    const occupied = labels.reduce((sum, label) => sum + label.height, 0);
    assert.equal(scene.frame.columnHeights[side], occupied);
    labels.sort((a,b) => a.y-b.y);
    for (let i=1; i<labels.length; i++) {
      assert.ok(labels[i].y >= labels[i-1].y + labels[i-1].height - .001);
      if (labels.length>=4) assert.ok(Math.abs(labels[i].y-labels[i-1].y-labels[i-1].height)<.001, 'dense labels must not have distributed empty gaps');
    }
  }
  const needed = Math.max(scene.frame.timeRadius * scene.frame.plotScale * 2 + 16,
    scene.frame.columnHeights.left, scene.frame.columnHeights.right);
  assert.ok(scene.frame.viewBox.height <= needed + 14.01, 'no hypothetical full-task stack may inflate the canvas');
}

test('height follows occupied columns rather than reserving all flexible tasks on one side', () => {
  const oneSide = tasks.map((task,i) => ({...task,start:540+i*3,end:543+i*3}));
  const twoSides = tasks.map((task,i) => ({...task,start:(i<7?540:780)+(i%7)*3,end:(i<7?543:783)+(i%7)*3}));
  const a=build(oneSide), b=build(twoSides);
  checkCompactColumns(a);checkCompactColumns(b);
  assert.ok(b.frame.viewBox.height < a.frame.viewBox.height * .7, [a.frame.viewBox,b.frame.viewBox]);
  assert.equal(a.records.length,tasks.length);assert.equal(b.records.length,tasks.length);
  assert.ok(a.records.every(r=>r.label.metadataHeight===0));
});

test('only the displayed Current record reserves its subtitle row', () => {
  const events=tasks.map((task,i)=>({...task,start:564+i*20,end:584+i*20}));
  const current=build(events,{nowMinutes:564,interactive:true});
  assert.deepEqual(current.records.filter(r=>r.label.metadataHeight>0).map(r=>r.uid), ['task-0']);
  checkCompactColumns(current);
  const tick=build(events.map(e=>({...e,start:e.start+1,end:e.end+1})),{nowMinutes:565,interactive:true});
  assert.deepEqual(current.frame,tick.frame,'same occupied columns and Current owner need no clock jitter');
  const inactive=build(events,{nowMinutes:564,interactive:false});
  assert.ok(inactive.records.every(r=>r.label.metadataHeight===0));
  assert.equal(current.frame.labelWidth,inactive.frame.labelWidth,'indicator width remains stable across time state');
  assert.equal(current.frame.plotScale,inactive.frame.plotScale);
});

for(const width of [280,320,400,520,640,960]) test(`dense adaptive labels retain source intervals and readable metrics at ${width}px`,()=>{
  const events=tasks.map((task,i)=>({...task,start:(i<7?540:780)+(i%7)*10,end:(i<7?550:790)+(i%7)*10}));
  const before=JSON.stringify(events);
  const s=build(events,{containerWidth:width});checkCompactColumns(s);
  assert.equal(JSON.stringify(events),before);
  for(const r of s.records){
    const e=events.find(e=>e.uid===r.uid);
    assert.deepEqual([r.event.start,r.event.end],[e.start,e.end]);
    assert.ok(r.label.fontSize>=10);
    assert.equal(r.label.side,r.anchor.x<s.frame.center.x?'left':'right');
    assert.ok(r.label.y>=s.frame.timedTop&&r.label.y+r.label.height<=s.frame.timedBottom+.001);
  }
});
