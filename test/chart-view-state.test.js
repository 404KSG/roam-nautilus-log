const test = require('node:test');
const assert = require('node:assert/strict');
const { chartRecordAppearance, chartTipLayout } = require('../src/chart-scene');

function look(event, nowMinutes = 600, interactive = true, showElapsed = true) {
  return chartRecordAppearance({ event, nowMinutes, interactive, showElapsed });
}

test('task and event materials have distinct categories and real current/elapsed states', () => {
  const task = { uid: 'task-a', todo: true, start: 600, end: 630 };
  const event = { uid: 'event-a', meeting: true, start: 600, end: 630 };
  assert.equal(look(task).category, 'task');
  assert.equal(look(event).category, 'event');
  assert.equal(look(task).phase, 'current');
  assert.equal(look(event).phase, 'current');
  assert.equal(look(event, 599).phase, 'future');
  assert.equal(look(event, 630).phase, 'elapsed');
  assert.equal(look({ ...event, done: true }).phase, 'completed');
  assert.notEqual(look(task).fill, look(event).fill);
  assert.equal(look(task, 599).variation, look(task, 700).variation);
  assert.ok(look(task).fillOpacity >= .96 && look(task).fillOpacity <= 1);
  assert.equal(look(event, 610, false).current, false);
});

test('explicit task/event urgency color overrides every material phase', () => {
  for (const flags of [{ todo: true }, { meeting: true }, { meeting: true, done: true }]) {
    const event = { uid: 'urgent', start: 500, end: 540, 'bg-color': 'rgba(234,15,15,0.72)', ...flags };
    assert.equal(look(event).fill, event['bg-color']);
    assert.equal(look(event).fillOpacity, 1);
  }
});

test('short Review tips fit their content and do not offer redundant full text', () => {
  const input = { title: 'Review', summary: 'Event · 18:30–19:00 · 30m', meta: 'Event · 18:30–19:00 · 30m', containerWidth: 720,
    measureTitle: text => text.length * 6.5, measureMeta: text => text.length * 5.2 };
  const tip = chartTipLayout(input);
  assert.equal(tip.mode, 'inline');
  assert.equal(tip.more, false);
  assert.ok(tip.width < 240 && tip.width > 180, tip);
  assert.equal(tip.slotHeight, 44);
  const narrow = chartTipLayout({ ...input, containerWidth: 280 });
  assert.ok(narrow.width <= 248);
});

test('tip measurement reserves tabular digit advances used by the painted time text', () => {
  const meta = '18:31–19:11';
  const measured = text => [...text].reduce((n, ch) => n + (ch === '0' ? 8 : 4), 0);
  const result = chartTipLayout({ title: 'Review', summary: meta, meta, containerWidth: 720,
    measureTitle: () => 40, measureMeta: measured });
  assert.ok(result.width >= 40 + measured(meta.replace(/[0-9]/g, '0')) + 33);
  assert.equal(result.more, false);
});

test('clipped or additional detail can explicitly expand without a scroll model', () => {
  const tip = chartTipLayout({ title: '中文'.repeat(100), summary: '已完成 · 未记时', meta: '已完成 · 未记时 · 完成状态来自引用', containerWidth: 280,
    measureTitle: text => text.length * 12, measureMeta: text => text.length * 6 });
  assert.equal(tip.more, true);
  assert.equal(tip.mode, 'stacked');
  assert.equal(tip.width, 248);
  assert.equal(tip.expandedWidth, 248);
  assert.equal(tip.slotHeight, 44);
});
