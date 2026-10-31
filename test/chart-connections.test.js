const test = require('node:test');
const assert = require('node:assert/strict');
const { chartScene } = require('../src/log-core');
const items = [
  { uid: 'fixed', description: 'Fixed appointment', meeting: true, start: 720, end: 750 },
  { uid: 'known-done', description: 'Recorded completion', todo: true, done: true, start: 630, end: 660 },
  ...Array.from({ length: 7 }, (_, i) => ({ uid: `unstamped-${i}`, description: `完成项目核对与资料整理 ${i + 1}`, todo: true, done: true, duration: 30,
    ...(i === 2 ? { 'status-origin': 'source' } : {}) })),
  { uid: 'next', description: 'Write next section', todo: true, duration: 45 },
  { uid: 'outside', description: 'Earlier recorded task', todo: true, done: true, start: 60, end: 90 },
];
const measure = text => [...text].reduce((n, c) => n + (/[^\x00-\xff]/.test(c) ? 11 : 6), 0);
const build = (extra = {}) => chartScene({ items, events: [], startMinutes: 360, endMinutes: 1200, containerWidth: 720, measure, ...extra });

for (const width of [280, 320, 520, 640, 720, 960]) {
  test(`completed estimates connect to spiral slices at ${width}px without a timestamp gate`, () => {
    const s = build({ containerWidth: width });
    assert.equal(s.completionNode, undefined);
    assert.equal(s.frame.timedTop, 12, 'only the compact source-frame inset, no connection band');
    const estimates = s.records.filter(r => r.event['time-claim'] === 'estimated-allocation');
    assert.equal(estimates.length, 7);
    for (const r of estimates) {
      assert.equal(r.kind, 'timed');
      assert.ok(r.anchor && r.label.connector);
      assert.equal(r.event.end - r.event.start, 30);
      assert.equal(r.event['done-at'], undefined);
      assert.equal(r.event['actual-minutes'], undefined);
      assert.equal(r.connectionTarget, undefined);
      assert.equal(r.markerPath, undefined);
      assert.equal(r.indexPath, undefined);
      assert.ok(r.label.y >= s.frame.timedTop && r.label.y + r.label.height <= s.frame.timedBottom);
    }
    assert.equal(s.records.find(r => r.uid === 'known-done').event['full-start'], 630);
    assert.equal(s.records.find(r => r.uid === 'outside').event['full-start'], 60);
  });
}

test('unchanged membership keeps its frame; queued work does not move completion estimates in time', () => {
  const a = build({ events: [{ ...items.find(i => i.uid === 'next'), start: 780, end: 825 }] });
  const b = build();
  const minute = build({ events: [{ ...items.find(i => i.uid === 'next'), start: 781, end: 826 }] });
  assert.deepEqual(a.frame, minute.frame);
  assert.deepEqual(a.records.filter(r => r.event.done).map(r => [r.uid, r.event.start, r.event.end]),
    b.records.filter(r => r.event.done).map(r => [r.uid, r.event.start, r.event.end]));
  assert.equal(a.records.find(r => r.uid === 'next').kind, 'timed');
  assert.ok(!b.records.some(r => r.uid === 'next'));
  assert.deepEqual(b.pendingQueue.items.map(r => r.uid), ['next']);
});

test('edit metadata and reference timestamps never determine estimated allocation', () => {
  const item = { uid: 'unstamped', description: 'Completed elsewhere', todo: true, done: true, duration: 30 };
  const extra = { ...item, editTime: 1793363400000, 'edit/time': 1793363400000, sourceDoneAt: 900, sourceStart: 870, sourceEnd: 900 };
  const original = build({ items: [item] }), enriched = build({ items: [extra] });
  assert.deepEqual(original.frame, enriched.frame);
  assert.equal(enriched.records[0].kind, 'timed');
  assert.deepEqual([enriched.records[0].event.start, enriched.records[0].event.end], [360, 390]);
  assert.equal(enriched.records[0].event['time-claim'], 'estimated-allocation');
});

test('observed intervals do not become estimated allocations', () => {
  const s = build({ items: items.filter(i => !i.uid.startsWith('unstamped-')) });
  assert.equal(s.completionNode, undefined);
  assert.ok(s.records.every(r => r.event['time-claim'] !== 'estimated-allocation'));
});

test('dense completed estimates retain all titles, including genuine capacity overflow', () => {
  const source = Array.from({ length: 64 }, (_, i) => ({ uid: `done-${i}`, description: `检查交付记录 ${i}`, done: true, todo: true }));
  const s = build({ items: source, containerWidth: 280 });
  assert.equal(s.records.length, 64);
  assert.equal(s.records.filter(r => r.kind === 'timed').length, 56);
  assert.equal(s.records.filter(r => r.kind === 'completed-estimate-overflow').length, 8);
  for (const r of s.records) {
    assert.equal(r.event.duration, 15);
    assert.ok(r.label.y >= 0 && r.label.y + r.label.height <= s.frame.viewBox.height);
    if (r.kind !== 'timed') assert.equal(r.event['estimate-unplaced-reason'], 'capacity');
  }
});
