const test = require('node:test');
const assert = require('node:assert/strict');
const { chartScene, chartTipLayout } = require('../src/log-core');

const items = [
  { uid: 'event', description: 'Team review', meeting: true, start: 720, end: 780 },
  { uid: 'history', description: 'Completed draft', todo: true, done: true, duration: 30, start: 540, end: 570 },
  { uid: 'write', description: 'Write', todo: true, duration: 45 },
  { uid: 'ship', description: 'Ship', todo: true, duration: 45 },
];
const build = (input = {}) => chartScene({ items, events: [], startMinutes: 360, endMinutes: 1200, containerWidth: 720, ...input });

test('a small plan does not reserve a second empty band for potentially unplaced tasks', () => {
  const scene = build({ events: items.slice(2).map((item, i) => ({ ...item, start: 600 + i * 45, end: 645 + i * 45 })) });
  const plot = scene.frame.timeRadius * scene.frame.plotScale * 2;
  assert.ok(scene.frame.viewBox.height <= plot + 40, scene.frame);
  assert.equal(scene.frame.looseTop, undefined);
});

for (const width of [280, 320, 520, 640, 960]) {
  test(`shared columns preserve every label and a clock-stable frame at ${width}px`, () => {
    const source = [...items, ...Array.from({ length: 12 }, (_, i) => ({ uid: `extra-${i}`, description: `核对交付资料 ${i}`, todo: true, duration: 30 }))];
    const states = [[], source.filter(r => r.todo && !r.done).map((r, i) => ({ ...r, start: 780 + i * 5, end: 810 + i * 5 })),
      source.filter(r => r.todo && !r.done).map((r, i) => ({ ...r, start: 420 + i * 5, end: 450 + i * 5 }))];
    const scenes = states.map(events => build({ items: source, events, containerWidth: width }));
    assert.deepEqual(scenes[1].frame, scenes[2].frame, 'same members, different clock positions');
    for (const scene of scenes) {
      const represented = [...scene.records.map(r => r.uid), ...(scene.pendingQueue?.items || []).map(r => r.uid)];
      assert.equal(represented.length, source.length);
      assert.deepEqual(new Set(represented), new Set(source.map(r => r.uid)));
      const f = scene.frame;
      for (const r of scene.records) {
        const b = r.label;
        assert.ok(b.y >= f.timedTop && b.y + b.height <= f.timedBottom, r.uid);
        if (r.kind !== 'timed') {
          assert.ok(r.marker.x >= 3 && r.marker.x <= f.viewBox.width - 3);
          assert.ok(r.label.side === 'left' ? r.marker.x < b.textX - b.inkWidth : r.marker.x > b.textX + b.inkWidth,
            'non-time markers stay beyond the title, not between title and clock');
        }
      }
      for (let i = 0; i < scene.records.length; i++) for (let j = i + 1; j < scene.records.length; j++) {
        const a = scene.records[i].label, b = scene.records[j].label;
        assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y, `${i}/${j}`);
      }
    }
  });
}

test('closed tips prioritize the title on two compact rows; full details remain explicit', () => {
  const measure = text => text.length * 6;
  const short = chartTipLayout({ title: 'Write', summary: 'Task · 45m', measureTitle: measure, measureMeta: measure });
  const long = chartTipLayout({ title: 'Detailed review '.repeat(30), summary: 'Estimate 30m', meta: 'Estimated allocation, not observed completion', measureTitle: measure, measureMeta: measure });
  assert.equal(short.slotHeight, 66);
  assert.equal(short.mode, 'stacked'); assert.equal(short.more, false);
  assert.equal(long.slotHeight, 66);
  assert.equal(long.mode, 'stacked'); assert.equal(long.more, true);
  assert.ok(long.width <= 280 && long.expandedWidth <= 280);
});
