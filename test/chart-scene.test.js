const test = require('node:test');
const assert = require('node:assert/strict');
const { chartScene, chartPresentationFrame, projectCompletedEstimates } = require('../src/log-core');
const measure = text => [...text].reduce((sum, char) => sum + (/[^\x00-\xff]/.test(char) ? 13 : 7), 0);
const items = Array.from({ length: 22 }, (_, i) => ({ uid: `item-${i}`, description: `Record ${i + 1}`, todo: true, done: i >= 14, duration: 30 }));
function scene(input = {}) {
  return chartScene({ items, events: [], containerWidth: 720, startMinutes: 300, endMinutes: 1260, measure, ...input });
}

test('completed history stays in the diagram; unfinished unplaced tasks remain in the queue', () => {
  const s = scene();
  assert.deepEqual(s.records.map(r => r.uid), items.slice(14).map(r => r.uid));
  assert.deepEqual(s.pendingQueue.items.map(r => r.uid), items.slice(0, 14).map(r => r.uid));
  assert.ok(s.records.every(r => r.label.lines.length && r.label.connector));
  const estimates = s.records.filter(r => r.event['time-claim'] === 'estimated-allocation');
  assert.equal(estimates.length, 8);
  assert.ok(estimates.every(r => r.anchor && r.event.end - r.event.start === 30));
  assert.ok(!s.records.some(r => r.kind === 'unplaced'));
  assert.ok(s.pendingQueue.items.every(r => !Number.isFinite(r.start) && !Number.isFinite(r.end)));
});

test('minute motion preserves the frame; entering the queue preserves completed time positions', () => {
  const a = scene({ events: items.slice(0, 14).map((r, i) => ({ ...r, start: 480 + i * 30, end: 510 + i * 30 })) });
  const b = scene({ events: [] });
  const next = scene({ events: items.slice(0, 14).map((r, i) => ({ ...r, start: 481 + i * 30, end: 511 + i * 30 })) });
  assert.deepEqual(a.frame, next.frame);
  assert.equal(b.pendingQueue.items.length, 14);
  for (const item of items.slice(14)) {
    const one = a.records.find(r => r.uid === item.uid), two = b.records.find(r => r.uid === item.uid);
    assert.equal(one.label.side, two.label.side);
    assert.deepEqual([one.event.start, one.event.end], [two.event.start, two.event.end]);
  }
  assert.ok(a.records.slice(0, 14).every(r => r.kind === 'timed'));
});

test('one completed estimate connects to a time-scaled slice, not a node or progress ring', () => {
  const s = scene({ items: [items[20]] });
  assert.ok(s.records[0].anchor);
  assert.equal(s.records[0].marker, undefined);
  assert.equal(s.completionNode, undefined);
  assert.equal(s.records[0].indexPath, undefined);
  assert.equal(s.records[0].event['time-claim'], 'estimated-allocation');
  assert.equal(s.records[0].event.end - s.records[0].event.start, 30);
});

test('out-of-window fixed ranges stay visible without a false visible clock position', () => {
  const source = { uid: 'night', description: 'Night appointment', meeting: true, start: 60, end: 90, done: false };
  const s = scene({ items: [source], events: [], startMinutes: 300, endMinutes: 1260 });
  assert.equal(s.records[0].kind, 'outside-window');
  assert.ok(s.records[0].markerPath);
  assert.equal(s.records[0].event['full-start'], 60);
  assert.equal(s.records[0].event['full-end'], 90);
  assert.equal(s.records[0].event['time-claim'], 'none');
});

test('ordinary long CJK is fully wrapped without a lone final character; pathological titles can expand', () => {
  const ordinary = '核对跨团队项目的全部需求并逐项检查设计内容与交付材料确保每个任务都能正常阅读';
  const source = [{ uid: 'cjk', description: ordinary, todo: true, done: true },
    { uid: 'long', description: 'X'.repeat(2600), todo: true, done: true }];
  const s = scene({ items: source });
  const label = s.records[0].label;
  assert.equal(label.lines.join(''), ordinary);
  assert.ok(label.lines.every(line => [...line].length > 1));
  assert.equal(label.truncated, false);
  assert.equal(s.records[1].label.truncated, true);
  assert.equal(s.records[1].event.description.length, 2600);
});

test('balanced wrapping preserves ordinary Latin words that fit a line', () => {
  const widths = { C: 9, o: 7, m: 11, u: 7, t: 4, e: 7, ' ': 3, w: 10, r: 4, k: 7 };
  const measured = text => [...text].reduce((sum, ch) => sum + (widths[ch] || 7), 0);
  const s = scene({ containerWidth: 280, measure: measured,
    items: [{ uid: 'commute', description: 'Commute to work', todo: true, done: true }] });
  assert.deepEqual(s.records[0].label.lines.map(line => line.trim()), ['Commute', 'to work']);
});

for (const width of [280, 320, 520, 640, 960]) {
  test(`all labels fit the source-sized frame at ${width}px, with distinct leaders`, () => {
    const source = Array.from({ length: 64 }, (_, i) => ({ uid: `many-${i}`, description: i % 3 ? `Record ${i}` : '检查中文项目资料与已完成任务', todo: true, done: true }));
    source.forEach(Object.freeze); Object.freeze(source);
    const s = scene({ items: source, containerWidth: width });
    assert.equal(s.records.length, 64);
    assert.equal(new Set(s.records.map(r => r.label.connector)).size, 64);
    for (const r of s.records) {
      const box = r.label;
      assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= s.frame.viewBox.width && box.y + box.height <= s.frame.viewBox.height);
      assert.ok(r.anchor && !r.slot && !r.indexPath);
      assert.equal(r.connectionTarget, undefined);
      assert.equal(r.event.end - r.event.start, 15);
      assert.ok(r.label.y >= s.frame.timedTop && r.label.y + r.label.height <= s.frame.timedBottom);
    }
    for (let i = 0; i < s.records.length; i += 1) for (let j = i + 1; j < s.records.length; j += 1) {
      const a = s.records[i].label, b = s.records[j].label;
      assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
    }
    const projected = projectCompletedEstimates({ items: source, startMinutes: 300, endMinutes: 1260 }).items;
    assert.deepEqual(s.frame, chartPresentationFrame({ items: projected, containerWidth: width, measure }));
  });
}
