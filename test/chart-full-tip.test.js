const test = require('node:test');
const assert = require('node:assert/strict');
const { chartTipLayout } = require('../src/chart-scene');
const measure = text => [...text].reduce((sum, c) => sum + (/[^\x00-\xff]/.test(c) ? 12 : 6), 0);

test('roomy tips use available local width instead of a universal 280px truncation cap', () => {
  const title = '复核项目文档与交付材料'.repeat(3);
  const tip = chartTipLayout({ title, summary: 'Completed · Estimate 30m', containerWidth: 720, measureTitle: measure, measureMeta: measure });
  assert.equal(tip.contentMode, 'full');
  assert.equal(tip.maxWidth, 688);
  assert.ok(tip.width > 280 && tip.width <= 688);
  assert.ok(tip.width - 27 >= measure(title));
  assert.equal(tip.more, false, 'wide title readability must not depend on More');
});

test('oversized wide content wraps rather than requiring expansion to reveal the title', () => {
  const tip = chartTipLayout({ title: 'X'.repeat(3000), summary: 'Task · 30m', containerWidth: 640 });
  assert.equal(tip.contentMode, 'full');
  assert.equal(tip.width, 608);
  assert.equal(tip.more, false);
});

test('compressed sidebars retain a bounded complete-text action', () => {
  const tip = chartTipLayout({ title: '中文'.repeat(100), summary: 'Estimate 15m', containerWidth: 280 });
  assert.equal(tip.contentMode, 'compact');
  assert.equal(tip.maxWidth, 248);
  assert.equal(tip.more, true);
  assert.equal(tip.expandedWidth, 248);
});

test('extra provenance still offers More even when a wide title is already complete', () => {
  const tip = chartTipLayout({ title: 'Review', summary: 'Estimate 30m', meta: 'Estimated allocation, not observed completion', containerWidth: 720 });
  assert.equal(tip.contentMode, 'full');
  assert.equal(tip.more, true);
  assert.ok(tip.width < 280, 'short content should not stretch across the workspace');
});
