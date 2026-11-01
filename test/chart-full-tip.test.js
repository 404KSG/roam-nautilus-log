const test = require('node:test');
const assert = require('node:assert/strict');
const { chartTipLayout } = require('../src/chart-scene');
const measure = text => [...text].reduce((sum, c) => sum + (/[^\x00-\xff]/.test(c) ? 12 : 6), 0);

test('two-row previews grow horizontally beyond 280px before clipping', () => {
  const title = '复核项目文档与交付材料'.repeat(3);
  const tip = chartTipLayout({ title, summary: 'Completed · Estimate 30m', containerWidth: 720, measureTitle: measure, measureMeta: measure });
  assert.equal(tip.contentMode, 'compact');
  assert.equal(tip.maxWidth, 688);
  assert.ok(tip.width > 280 && tip.width <= 688);
  assert.ok(tip.width - 23 >= measure(title));
  assert.equal(tip.more, false, 'fitting titles do not need More');
});

test('oversized titles offer explicit full text at every width instead of automatic wrapping', () => {
  for (const containerWidth of [280, 320, 400, 520, 640, 720]) {
    const tip = chartTipLayout({ title: 'X'.repeat(3000), summary: 'Task · 30m', containerWidth });
    assert.equal(tip.contentMode, 'compact');
    assert.equal(tip.width, containerWidth - 32);
    assert.equal(tip.expandedWidth, containerWidth - 32);
    assert.equal(tip.slotHeight, 42);
    assert.equal(tip.more, true);
  }
});

test('oversized summaries also offer full text without growing a third preview row', () => {
  const tip = chartTipLayout({ title: 'Review', summary: 'Long metadata '.repeat(100), containerWidth: 720 });
  assert.equal(tip.contentMode, 'compact');
  assert.equal(tip.width, 688);
  assert.equal(tip.more, true);
});

test('extra provenance keeps More while short content retains a natural width', () => {
  const tip = chartTipLayout({ title: 'Review', summary: 'Estimate 30m', meta: 'Estimated allocation, not observed completion', containerWidth: 720 });
  assert.equal(tip.contentMode, 'compact');
  assert.equal(tip.more, true);
  assert.ok(tip.width < 280);
});

test('title measurement includes the same tabular-digit and rounding room as metadata', () => {
  const title = 'Guide v111', measured = text => text.length * 8;
  const tip = chartTipLayout({ title, summary: 'Task', containerWidth: 720, measureTitle: measured, measureMeta: () => 20 });
  assert.ok(tip.width >= Math.ceil(measured('Guide v000') + 2 + 3 * .4 + 23));
  assert.equal(tip.more, false);
});

test('longer fitting titles widen the preview without changing the slot height', () => {
  const sizes = ['Read', 'Review project notes', 'Review project notes and verify all the source materials'].map(title =>
    chartTipLayout({ title, summary: 'Task', containerWidth: 720, measureTitle: measure, measureMeta: measure }));
  assert.ok(sizes[0].width < sizes[1].width && sizes[1].width < sizes[2].width);
  assert.ok(sizes.every(tip => tip.slotHeight === 42 && !tip.more));
});
