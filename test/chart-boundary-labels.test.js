const test = require('node:test');
const assert = require('node:assert/strict');
const { chartScene, shellInterval, shellRadius } = require('../src/log-core');

const measure = text => [...text].reduce((sum, ch) => sum + (/[^\x00-\xff]/.test(ch) ? 11 : 6), 0);
const sceneFor = (items, extra = {}) => {
  const startMinutes = extra.startMinutes ?? 360;
  return chartScene({ items, events: [], containerWidth: 720, startMinutes, endMinutes: 1200, measure,
    radiusForMinute: minute => shellRadius({ minute, startMinutes }), ...extra });
};
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < .002, `${actual} != ${expected}`);

// The user's Write example is complete at 20:43–21:28, beyond END 20:00.
// A boundary leader is only an annotation anchor, never a fabricated interval.
test('a completed after-END record uses an ordinary boundary leader without a special icon or retiming', () => {
  const item = Object.freeze({ uid: 'write', description: 'Write', todo: true, done: true,
    start: 1243, end: 1288, duration: 45, 'duration-source': 'actual', 'actual-minutes': 45 });
  const input = Object.freeze([item]);
  const scene = sceneFor(input);
  const record = scene.records[0];
  assert.equal(record.kind, 'outside-window');
  assert.equal(record.marker, undefined);
  assert.equal(record.markerPath, undefined);
  assert.equal(record.anchor, undefined);
  assert.equal(record.boundaryAnchor.edge, 'end');
  assert.equal(record.boundaryAnchor.minute, 1200);
  const { frame } = scene;
  const edge = shellInterval({ startMinutes: 360, endMinutes: 1200, start: 360, end: 1200,
    centerX: frame.center.x, centerY: frame.center.y }).endOuter;
  close(record.boundaryAnchor.x, frame.center.x + (edge.x - frame.center.x) * frame.plotScale);
  close(record.boundaryAnchor.y, frame.center.y + (edge.y - frame.center.y) * frame.plotScale);
  assert.equal(record.label.side, 'left');
  assert.ok(record.label.connector.includes('C'), 'use the ordinary curved leader');
  assert.deepEqual([record.event.start, record.event.end, record.event['full-start'], record.event['full-end']], [1243, 1288, 1243, 1288]);
  assert.equal(record.event['time-claim'], 'none');
  assert.equal(record.event['actual-minutes'], 45);
  assert.equal(scene.pendingQueue, null);
});

test('START/END attachments follow configured and overnight boundaries, not a hard-coded 20:00', () => {
  for (const [startMinutes, endMinutes, start, end, edge, minute] of [
    [360, 1200, 330, 360, 'start', 360],
    [360, 1080, 1200, 1245, 'end', 1080],
    [1260, 1560, 1570, 1615, 'end', 1560],
    [1260, 1560, 1200, 1260, 'start', 1260],
  ]) {
    const item = Object.freeze({ uid: 'boundary-record', description: 'Outside record', done: true, todo: true, start, end });
    const scene = sceneFor([item], { startMinutes, endMinutes });
    const r = scene.records[0];
    assert.equal(r.kind, 'outside-window');
    assert.equal(r.boundaryAnchor.edge, edge);
    assert.equal(r.boundaryAnchor.minute, minute);
    assert.equal(r.markerPath, undefined);
    assert.equal(r.anchor, undefined);
    assert.deepEqual([r.event.start, r.event.end], [start, end]);
    const window = shellInterval({ startMinutes, endMinutes, start: startMinutes, end: endMinutes,
      centerX: scene.frame.center.x, centerY: scene.frame.center.y });
    const point = edge === 'end' ? window.endOuter : window.startOuter;
    close(r.boundaryAnchor.x, scene.frame.center.x + (point.x - scene.frame.center.x) * scene.frame.plotScale);
    close(r.boundaryAnchor.y, scene.frame.center.y + (point.y - scene.frame.center.y) * scene.frame.plotScale);
  }
});

test('partial intersections stay real timed slices; unknown completion placement gets no invented boundary', () => {
  const partial = { uid: 'partial', description: 'Partly visible', done: true, todo: true, start: 1180, end: 1240 };
  const r = sceneFor([partial]).records[0];
  assert.equal(r.kind, 'timed');
  assert.ok(r.anchor);
  assert.equal(r.boundaryAnchor, undefined);
  assert.deepEqual([r.event.start, r.event.end, r.event['full-start'], r.event['full-end']], [1180, 1200, 1180, 1240]);
  const unknown = sceneFor([{ uid: 'unknown', description: 'No known position', done: true, todo: true, duration: 3000 }]).records[0];
  assert.equal(unknown.kind, 'completed-estimate-overflow');
  assert.equal(unknown.boundaryAnchor, undefined);
  assert.equal(unknown.anchor, undefined);
  assert.ok(unknown.markerPath);
  const invalid = sceneFor([{ ...partial, start: 1300, end: 1345 }], { startMinutes: 1200, endMinutes: 360 }).records[0];
  assert.equal(invalid.boundaryAnchor, undefined);
});

for (const width of [280, 320, 520, 720, 960]) {
  test(`many outside records share the boundary without label overlap at ${width}px`, () => {
    const items = Array.from({ length: 28 }, (_, i) => Object.freeze({ uid: `outside-${i}`,
      description: i % 2 ? `Completed outside record ${i}` : `规划时段之外的完成记录 ${i}`,
      done: true, todo: true, start: 1230 + i, end: 1275 + i }));
    const scene = sceneFor(Object.freeze(items), { containerWidth: width });
    const { frame } = scene;
    assert.equal(scene.records.length, items.length);
    assert.equal(new Set(scene.records.map(r => r.label.connector)).size, items.length);
    for (const r of scene.records) {
      assert.equal(r.boundaryAnchor.minute, 1200);
      assert.equal(r.label.side, 'left');
      assert.equal(r.markerPath, undefined);
      assert.ok(r.label.y >= frame.timedTop && r.label.y + r.label.height <= frame.timedBottom);
      assert.ok(r.label.x >= 0 && r.label.x + r.label.width <= frame.viewBox.width);
    }
    for (let i = 0; i < scene.records.length; i++) for (let j = i + 1; j < scene.records.length; j++) {
      const a = scene.records[i].label, b = scene.records[j].label;
      assert.ok(a.y + a.height <= b.y || b.y + b.height <= a.y, `${i}/${j}`);
    }
  });
}
