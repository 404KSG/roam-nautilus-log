const test = require('node:test');
const assert = require('node:assert/strict');
const { chartScene, chartRecordMetadata } = require('../src/log-core');

const task = { uid: 'work', description: 'Write', todo: true, duration: 45 };

test('potentially current labels keep a stable indicator allowance across minute positions', () => {
  const input = { items: [task], startMinutes: 360, endMinutes: 1200, containerWidth: 720 };
  const early = chartScene({ ...input, events: [{ ...task, start: 810, end: 855 }] });
  const late = chartScene({ ...input, events: [{ ...task, start: 811, end: 856 }] });
  assert.deepEqual(early.frame, late.frame);
  const label = early.records[0].label;
  assert.ok(label.metadataHeight >= 12);
  assert.ok(label.height >= label.lines.length * label.lineHeight + label.metadataHeight);
  assert.ok(label.metadataY > label.textY + (label.lines.length - 1) * label.lineHeight);
  assert.ok(label.metadataY <= label.y + label.height);
});

test('duration provenance stays available to inspectors, including actual, estimates and zero', () => {
  assert.deepEqual(chartRecordMetadata({ ...task }), { duration: '45m', status: null });
  assert.deepEqual(chartRecordMetadata({ ...task, done: true, duration: 30, 'actual-minutes': 30, 'planned-duration': 45, 'time-claim': 'actual' }), { duration: '30m', status: 'actual' });
  assert.deepEqual(chartRecordMetadata({ ...task, done: true, 'planned-duration': 0, 'time-claim': 'none' }), { duration: '0m', status: 'estimate' });
  assert.deepEqual(chartRecordMetadata({ uid: 'fixed', done: true, meeting: true, 'full-start': 720, 'full-end': 780 }), { duration: '1h', status: 'completed' });
  assert.deepEqual(chartRecordMetadata({ ...task, done: true, 'duration-source': 'actual', 'actual-minutes': 75, 'time-claim': 'none' }), { duration: '1h15m', status: 'actual' });
});

test('completed labels have no unused metadata row, with full titles and separation retained', () => {
  const items = Array.from({ length: 12 }, (_, i) => ({ ...task, uid: `t${i}`, description: 'Complete source title '.repeat(3), done: true }));
  for (const width of [280, 320, 520, 720]) {
    const scene = chartScene({ items, containerWidth: width, startMinutes: 360, endMinutes: 1200 });
    for (const r of scene.records) {
      assert.equal(r.label.metadataHeight, 0);
      assert.ok(r.label.metadataY <= r.label.y + r.label.height);
    }
    for (let i = 0; i < scene.records.length; i++) for (let j = i + 1; j < scene.records.length; j++) {
      const a = scene.records[i].label, b = scene.records[j].label;
      assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
    }
  }
});
