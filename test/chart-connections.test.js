const test = require('node:test');
const assert = require('node:assert/strict');
const { chartScene } = require('../src/chart-scene');
const items = [
  { uid: 'fixed', description: 'Fixed appointment', meeting: true, start: 720, end: 750 },
  { uid: 'known-done', description: 'Recorded completion', todo: true, done: true, start: 630, end: 660 },
  ...Array.from({ length: 7 }, (_, i) => ({ uid: `unknown-${i}`, description: `完成项目核对与资料整理 ${i + 1}`, todo: true, done: true, duration: 30,
    ...(i === 2 ? { 'status-origin': 'source' } : {}) })),
  { uid: 'next', description: 'Write next section', todo: true, duration: 45 },
  { uid: 'outside', description: 'Earlier recorded task', todo: true, done: true, start: 60, end: 90 },
];
const measure = text => [...text].reduce((n, c) => n + (/[^\x00-\xff]/.test(c) ? 11 : 6), 0);
const build = (extra = {}) => chartScene({ items, events: [], startMinutes: 360, endMinutes: 1200, containerWidth: 720, measure, ...extra });

for (const width of [280, 320, 520, 640, 720, 960]) {
  test(`untimed completions connect to one named status node at ${width}px, not clock positions`, () => {
    const s = build({ containerWidth: width });
    const node = s.completionNode;
    assert.ok(node, 'the approved completed/untimed node must exist');
    assert.equal(node.key, 'untimed-completed');
    assert.equal(node.uids.length, 7);
    assert.ok(node.y + node.height <= s.frame.timedTop - 12);
    for (const r of s.records.filter(r => r.kind === 'untimed-completed')) {
      assert.equal(r.connectionTarget, node.key);
      assert.equal(r.anchor, undefined);
      assert.equal(r.slot, undefined);
      assert.equal(r.indexPath, undefined);
      assert.equal(r.event['time-claim'], 'none');
      assert.ok(!Number.isFinite(r.event.start) && !Number.isFinite(r.event.end));
      assert.ok(r.label.y + r.label.height <= s.frame.timedTop - 12);
      const edge = r.label.side === 'left' ? r.label.x + r.label.width + 5 : r.label.x - 5;
      assert.ok(Math.abs(r.marker.x - edge) >= 16, r.uid);
      assert.equal(r.marker.x, r.label.side === 'left' ? node.x : node.x + node.width);
      assert.ok(r.marker.y >= node.y && r.marker.y <= node.y + node.height);
      const coords = r.label.connector.match(/-?\d+(?:\.\d+)?/g).map(Number);
      assert.ok(Math.abs(coords.at(-2) - r.marker.x) < .001 && Math.abs(coords.at(-1) - r.marker.y) < .001);
    }
    for (const r of s.records.filter(r => r.kind !== 'untimed-completed')) assert.notEqual(r.connectionTarget, node.key);
    assert.equal(s.records.find(r => r.uid === 'outside').event['full-start'], 60);
  });
}

test('clock scheduling cannot resize the frame or move the completion node', () => {
  const a = build({ events: [{ ...items.find(i => i.uid === 'next'), start: 780, end: 825 }] });
  const b = build();
  assert.deepEqual(a.frame, b.frame);
  assert.deepEqual(a.completionNode, b.completionNode);
  assert.equal(a.records.find(r => r.uid === 'next').kind, 'timed');
  assert.equal(b.records.find(r => r.uid === 'next').kind, 'unplaced');
});

test('edit metadata and reference timestamps never become completion positions', () => {
  const item = { uid: 'unknown', description: 'Completed elsewhere', todo: true, done: true, duration: 30 };
  const extra = { ...item, editTime: 1793363400000, 'edit/time': 1793363400000, sourceDoneAt: 900, sourceStart: 870, sourceEnd: 900 };
  const original = build({ items: [item] }), enriched = build({ items: [extra] });
  assert.deepEqual(original.frame, enriched.frame);
  assert.equal(enriched.records[0].kind, 'untimed-completed');
  assert.equal(enriched.records[0].event.start, undefined);
  assert.equal(enriched.records[0].event.end, undefined);
  assert.equal(enriched.records[0].event['time-claim'], 'none');
});

test('no untimed completions means no completed-status node', () => {
  const s = build({ items: items.filter(i => !i.uid.startsWith('unknown-')) });
  assert.equal(s.completionNode, null);
});

test('a dense completion group retains every title and stays out of the time band', () => {
  const source = Array.from({ length: 64 }, (_, i) => ({ uid: `done-${i}`, description: `检查交付记录 ${i}`, done: true, todo: true }));
  const s = build({ items: source, containerWidth: 280 });
  assert.equal(s.completionNode.uids.length, 64);
  assert.equal(s.records.length, 64);
  for (const r of s.records) assert.ok(r.label.y >= 0 && r.label.y + r.label.height <= s.frame.timedTop - 12);
});
