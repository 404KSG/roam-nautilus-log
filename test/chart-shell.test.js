const test = require('node:test');
const assert = require('node:assert/strict');
const { shellRadius, shellRadii, shellInterval, shellGrid, shellNeedle } = require('../src/chart-shell');

const window = { startMinutes: 360, endMinutes: 1200, centerX: 360, centerY: 180 };
const close = (a, b, eps = 1e-7) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('continuous shell retains the hourly radius anchors without overshoot', () => {
  const anchors = [135, 140, 145, 150, 145, 140, 135, 130, 125, 120, 115, 110, 105, 100];
  anchors.forEach((radius, i) => close(shellRadius({ minute: 390 + i * 60, startMinutes: 360 }), radius));
  for (let i = 0; i < anchors.length - 1; i++) for (let offset = 0; offset <= 60; offset++) {
    const r = shellRadius({ minute: 390 + i * 60 + offset, startMinutes: 360 });
    assert.ok(r >= Math.min(anchors[i], anchors[i + 1]) && r <= Math.max(anchors[i], anchors[i + 1]));
  }
  for (let minute = 420; minute < 1200; minute += 60) {
    assert.ok(Math.abs(shellRadius({ minute: minute - .001, startMinutes: 360 }) - shellRadius({ minute: minute + .001, startMinutes: 360 })) < .001);
  }
});

test('radius is relative to configured START, including overnight and shifted windows', () => {
  for (const shift of [0, 900, 1440]) for (let offset = 0; offset < 840; offset += 17) {
    close(shellRadius({ minute: 360 + offset + shift, startMinutes: 360 + shift }), shellRadius({ minute: 360 + offset, startMinutes: 360 }));
  }
});

for (const [startMinutes, endMinutes] of [[0, 1440], [300, 1260], [360, 1200], [1260, 1560], [1260, 2700]]) {
  test(`fold-safe continuous inner edge for ${startMinutes}–${endMinutes}`, () => {
    for (let minute = startMinutes; minute < endMinutes; minute += 2.5) {
      const r = shellRadii({ minute, startMinutes, endMinutes });
      assert.ok(r.inner >= 50 && r.outer > r.inner, JSON.stringify(r));
      if (minute + 720 < endMinutes) {
        const later = shellRadii({ minute: minute + 720, startMinutes, endMinutes });
        assert.ok(r.inner >= later.outer, `${minute}: two turns overlap`);
      }
    }
  });
}

test('fold-boundary side is explicit, with no interpolation through the later turn', () => {
  const before = shellRadii({ ...window, minute: 480, side: 'before' });
  const after = shellRadii({ ...window, minute: 480 });
  assert.ok(before.inner > 90); assert.equal(after.inner, 50);
  const crossing = shellInterval({ ...window, start: 470, end: 490 });
  const ending = shellInterval({ ...window, start: 470, end: 480 });
  const starting = shellInterval({ ...window, start: 480, end: 490 });
  assert.ok(crossing.path && ending.path && starting.path);
  assert.equal(crossing.foldMinute, 480);
  close(ending.endInner.x, before.inner * Math.cos(-7 * Math.PI / 6) + 360, .001);
  close(starting.startInner.x, after.inner * Math.cos(-7 * Math.PI / 6) + 360, .001);
});

test('one continuous record path preserves its exact interval across hour boundaries', () => {
  const input = Object.freeze({ ...window, start: 810, end: 855 });
  const s = shellInterval(input);
  assert.equal(s.start, 810); assert.equal(s.end, 855);
  assert.equal((s.path.match(/M/g) || []).length, 1);
  assert.equal((s.path.match(/Z/g) || []).length, 1);
  assert.ok(s.path.includes('L')); assert.ok(!/NaN|Infinity|undefined/.test(s.path));
  const radius = shellRadius({ minute: 810, startMinutes: 360 });
  close(s.startOuter.x, 360 + radius * Math.cos(-Math.PI / 4), .001);
  close(s.startOuter.y, 180 - radius * Math.sin(Math.PI / 4), .001);
  assert.equal(shellInterval(input).path, s.path, 'repeat evaluation must be deterministic');
  assert.notEqual(shellInterval({ ...input, start: 811, end: 856 }).path, s.path);
});

test('equivalent record, gap, available and estimate intervals use identical geometry', () => {
  const p = { ...window, start: 570, end: 615 };
  assert.equal(shellInterval({ ...p, kind: 'record' }).path, shellInterval({ ...p, kind: 'gap' }).path);
  assert.equal(shellInterval({ ...p, kind: 'available' }).path, shellInterval({ ...p, kind: 'estimate' }).path);
});

test('intervals clip only to the configured window, never to now', () => {
  const s = shellInterval({ ...window, start: 300, end: 1300, nowMinutes: 700 });
  assert.equal(s.start, 360); assert.equal(s.end, 1200);
  assert.equal(s.path, shellInterval({ ...window, start: 360, end: 1200, nowMinutes: 1100 }).path);
});

test('invalid or empty geometry fails closed and oversized windows stay bounded', () => {
  for (const change of [{ start: 800, end: 800 }, { start: 800, end: 700 }, { start: NaN }, { end: Infinity }, { endMinutes: 3000 }, { startMinutes: -1 }]) {
    assert.equal(shellInterval({ ...window, start: 700, end: 800, ...change }).path, '');
  }
  const full = shellInterval({ start: 1260, end: 2700, startMinutes: 1260, endMinutes: 2700 });
  assert.ok(full.path.length < 25000, full.path.length);
});

test('grid is one shell silhouette with ticks, not hour-sector dividers', () => {
  const grid = shellGrid({ ...window, hourStep: 1, plotScale: 1 });
  assert.equal(grid.path, shellInterval({ ...window, start: 360, end: 1200 }).path);
  assert.equal(grid.ticks[0].minute, 360); assert.equal(grid.ticks.at(-1).minute, 1200);
  assert.equal(grid.ticks.filter(t => t.label !== null).length, 15);
  assert.ok(grid.ticks.every(t => Number.isFinite(t.x1) && Number.isFinite(t.labelX)));
  assert.ok(shellGrid({ ...window, hourStep: 3, plotScale: .35 }).ticks.length < grid.ticks.length);
});

test('overnight labels wrap at midnight without changing the logical time axis', () => {
  const grid = shellGrid({ startMinutes: 1260, endMinutes: 1560, hourStep: 1 });
  assert.deepEqual(grid.ticks.filter(t => t.label !== null).map(t => t.label), ['21', '22', '23', '0', '1', '2']);
});

test('needle uses the same inner and outer boundaries as the selected time', () => {
  for (const minute of [361, 479, 480, 791, 1199]) {
    const r = shellRadii({ ...window, minute });
    const n = shellNeedle({ ...window, minute });
    close(Math.hypot(n.x1 - 360, n.y1 - 180), r.inner + 2, .001);
    close(Math.hypot(n.x2 - 360, n.y2 - 180), r.outer + 5, .001);
  }
  assert.equal(shellNeedle({ ...window, minute: 1200 }), null);
});
