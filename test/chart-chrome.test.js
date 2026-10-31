const test = require('node:test');
const assert = require('node:assert/strict');
const { chartTipLayout } = require('../src/chart-scene');
const measure = text => [...text].reduce((sum, ch) => sum + (/[^\x00-\xff]/.test(ch) ? 11 : 6), 0);

test('compact CJK titles retain a full text column beside the shared More action', () => {
  const title = '核对项目资料分类与交付说明文本';
  for (const containerWidth of [280, 320, 520, 720]) {
    const tip = chartTipLayout({ title, summary: 'Completed · Estimate 30m', meta: 'Estimated allocation, not observed completion', containerWidth,
      measureTitle: measure, measureMeta: measure });
    assert.equal(tip.mode, 'stacked');
    assert.ok(tip.width - 23 - tip.actionWidth - 4 >= measure(title), tip);
    assert.ok(tip.actionWidth >= 28);
    assert.equal(tip.slotHeight, 42);
    assert.equal(tip.more, true);
  }
});

test('short full summaries do not require More just because title and metadata have different rows', () => {
  const tip = chartTipLayout({ title: 'Review', summary: 'Event · 18:30–19:00 · 30m', containerWidth: 720,
    measureTitle: measure, measureMeta: measure });
  assert.equal(tip.more, false);
  assert.equal(tip.mode, 'stacked');
});

test('long text retains explicit expansion without an unbounded closed slot', () => {
  const tip = chartTipLayout({ title: 'X'.repeat(3000), summary: 'Estimate 15m', containerWidth: 280 });
  assert.equal(tip.more, true); assert.equal(tip.width, 248); assert.equal(tip.slotHeight, 42);
});

test('tip width budgets include balanced padding before deciding whether a title fits', () => {
  const tip = chartTipLayout({ title: 'A near-limit title', summary: 'Task', containerWidth: 280,
    measureTitle: () => 235, measureMeta: () => 20 });
  assert.equal(tip.more, true, '6px side padding, borders, dot and gap leave 225px before an expansion action');
  assert.equal(tip.width, 248);
});
