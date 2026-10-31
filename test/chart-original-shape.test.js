const test = require('node:test');
const assert = require('node:assert/strict');
const { chartScene } = require('../src/chart-scene');

const items = Array.from({ length: 20 }, (_, order) => ({
  uid: `source-${order}`, description: order % 4 ? `Task ${order + 1}` : '核对项目需求与交付记录',
  todo: true, done: order >= 12, duration: 30,
}));
const measure = text => [...text].reduce((n, c) => n + (/[^\x00-\xff]/.test(c) ? 11 : 6), 0);
const build = (extra = {}) => chartScene({ items, containerWidth: 720, startMinutes: 360, endMinutes: 1200,
  timeRadius: 150, measure, ...extra });

test('records without a time interval have small label marks, never orbital time geometry', () => {
  const scene = build();
  assert.equal(scene.records.length, items.length);
  for (const r of scene.records) {
    assert.equal(r.event['time-claim'], 'none');
    assert.equal(r.anchor, undefined, r.uid);
    assert.equal(r.slot, undefined, r.uid);
    assert.equal(r.indexPath, undefined, r.uid);
    assert.ok(r.markerPath && Number.isFinite(r.marker.x) && Number.isFinite(r.marker.y), r.uid);
    assert.ok(!Number.isFinite(r.event.start) && !Number.isFinite(r.event.end), r.uid);
  }
});

test('clock changes preserve the full-source frame and source-assigned non-time sides', () => {
  const early = build({ events: items.slice(0, 12).map((r, i) => ({ ...r, start: 480 + i * 30, end: 510 + i * 30 })) });
  const late = build({ events: [] });
  assert.deepEqual(early.frame, late.frame);
  for (const uid of items.slice(12).map(r => r.uid)) {
    const a = early.records.find(r => r.uid === uid), b = late.records.find(r => r.uid === uid);
    assert.ok(['left', 'right'].includes(a.label.side));
    assert.equal(a.label.side, b.label.side, uid);
  }
  assert.ok(early.records.slice(0, 12).every(r => r.kind === 'timed' && r.anchor && !r.markerPath));
});

for (const width of [280, 320, 520, 640, 720, 960]) {
  test(`all titles remain beside the spiral at ${width}px without overlapping labels`, () => {
    const scene = build({ containerWidth: width });
    const { center, timeRadius, plotScale, viewBox } = scene.frame;
    assert.equal(scene.records.length, 20);
    for (const r of scene.records) {
      const b = r.label;
      assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.width <= viewBox.width && b.y + b.height <= viewBox.height, r.uid);
      assert.ok(b.x + b.width < center.x - timeRadius * plotScale || b.x > center.x + timeRadius * plotScale, r.uid);
      assert.ok(r.marker.x >= 3 && r.marker.x <= viewBox.width - 3, r.uid);
      assert.equal(b.lines.join('').replace(/\s/g, ''), r.event.description.replace(/\s/g, ''), r.uid);
    }
    for (let i = 0; i < scene.records.length; i++) for (let j = i + 1; j < scene.records.length; j++) {
      const a = scene.records[i].label, b = scene.records[j].label;
      assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
    }
  });
}

test('dense timed labels never flip across the spiral to fill a column', () => {
  const pending = items.filter(item => !item.done);
  const scene = build({ events: pending.map((r, i) => ({ ...r, start: 720 + i * 3, end: 723 + i * 3 })) });
  const timed = scene.records.filter(r => r.kind === 'timed');
  assert.equal(timed.length, pending.length);
  for (const r of timed) {
    assert.equal(r.label.side, r.anchor.x < scene.frame.center.x ? 'left' : 'right');
    assert.ok(r.label.y >= scene.frame.timedTop && r.label.y + r.label.height <= scene.frame.timedBottom);
  }
  const ordered = [...timed].sort((a, b) => a.label.y - b.label.y);
  for (let i = 1; i < ordered.length; i++) assert.ok(ordered[i - 1].label.y + ordered[i - 1].label.height <= ordered[i].label.y);
});

test('outside-window records keep their real range and use a boundary attachment instead of a time angle', () => {
  const event = { uid: 'early', description: 'Early appointment', meeting: true, start: 60, end: 90 };
  const r = build({ items: [event] }).records[0];
  assert.equal(r.kind, 'outside-window');
  assert.equal(r.event['full-start'], 60);
  assert.equal(r.event['full-end'], 90);
  assert.equal(r.anchor, undefined);
  assert.equal(r.markerPath, undefined);
  assert.equal(r.boundaryAnchor.edge, 'start');
  assert.equal(r.boundaryAnchor.minute, 360);
});
