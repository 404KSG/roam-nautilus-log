const test = require('node:test');
const assert = require('node:assert/strict');
const { chartScene, chartPresentationFrame } = require('../src/chart-scene');
const measure = text => [...text].reduce((sum, char) => sum + (/[^\x00-\xff]/.test(char) ? 13 : 7), 0);
const items = Array.from({ length: 22 }, (_, i) => ({ uid: `item-${i}`, description: `Record ${i + 1}`, todo: true, done: i >= 14, duration: 30 }));
function scene(input = {}) {
  return chartScene({ items, events: [], containerWidth: 720, startMinutes: 300, endMinutes: 1260, measure, ...input });
}

test('every source record gets an in-diagram record and label, not a footer fallback', () => {
  const s = scene();
  assert.deepEqual(s.records.map(r => r.uid), items.map(r => r.uid));
  assert.ok(s.records.every(r => r.label.lines.length && r.indexPath && r.event['time-claim'] === 'none'));
  assert.equal(s.records.filter(r => r.kind === 'untimed-completed').length, 8);
  assert.equal(s.records.filter(r => r.kind === 'unplaced').length, 14);
  assert.ok(s.records.every(r => !Number.isFinite(r.event.start) && !Number.isFinite(r.event.end)));
});

test('clock-driven scheduling and END cannot change frame or stable non-time slots', () => {
  const a = scene({ events: items.slice(0, 14).map((r, i) => ({ ...r, start: 480 + i * 30, end: 510 + i * 30 })) });
  const b = scene({ events: [] });
  assert.deepEqual(a.frame, b.frame);
  for (const item of items.slice(14)) {
    const one = a.records.find(r => r.uid === item.uid), two = b.records.find(r => r.uid === item.uid);
    assert.equal(one.indexPath, two.indexPath);
    assert.deepEqual(one.slot, two.slot);
  }
  assert.ok(a.records.slice(0, 14).every(r => r.kind === 'timed'));
});

test('one non-time record never becomes a near-full progress ring', () => {
  const s = scene({ items: [items[20]] });
  assert.ok(s.records[0].slot.spanDegrees <= 32);
  assert.equal(s.frame.outerRadius - s.frame.timeRadius, 20);
  assert.equal(s.records[0].event['time-claim'], 'none');
});

test('out-of-window fixed ranges stay visible without a false visible clock position', () => {
  const source = { uid: 'night', description: 'Night appointment', meeting: true, start: 60, end: 90, done: false };
  const s = scene({ items: [source], events: [], startMinutes: 300, endMinutes: 1260 });
  assert.equal(s.records[0].kind, 'outside-window');
  assert.ok(s.records[0].indexPath);
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
      assert.ok(r.slot.spanDegrees > 0 && r.slot.spanDegrees <= 32);
      if (s.frame.compact) {
        const routingRadius = Number(r.label.connector.match(/A([\d.]+)/)[1]);
        assert.ok(s.frame.center.y + routingRadius < s.frame.labelTop,
          'outer routing arcs must stay above the compact label area');
      }
    }
    for (let i = 0; i < s.records.length; i += 1) for (let j = i + 1; j < s.records.length; j += 1) {
      const a = s.records[i].label, b = s.records[j].label;
      assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
    }
    assert.deepEqual(s.frame, chartPresentationFrame({ items: source, containerWidth: width, measure }));
  });
}
