const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../src/log-core');

const GEOMETRY_KEYS = ['x', 'y', 'width', 'height', 'w', 'h', 'anchorY', 'connectorKneeX', 'connectorRailX', 'track'];

function sampleLabels(count = 18) {
  return Array.from({ length: count }, (_, i) => ({
    uid: `task-${i}`,
    angle: i * 0.31,
    anchorY: 150 - Math.sin(i * 0.31) * 140,
    sortKey: i,
    width: 80 + (i % 3) * 10,
    height: 18,
  }));
}

function sideRailOptions(centerX, centerY, extra = {}) {
  return {
    centerX,
    centerY,
    exclusionRadius: 150,
    gap: 24,
    trackGap: 18,
    layout: 'side-rails',
    maxVerticalOffset: 150 * 0.92,
    rowGap: 26,
    collisionPadding: 6,
    ...extra,
  };
}

function sequentialPlace(labels, options) {
  const occupied = [];
  let calls = 0;
  const rects = labels.map((label) => {
    calls += 1;
    const [rect] = core.placeExternalLabels({
      ...options,
      occupiedRects: occupied,
      labels: [label],
    });
    occupied.push(rect);
    return rect;
  });
  return { rects, calls };
}

function assertGeometryClose(actual, expected, label) {
  for (const key of GEOMETRY_KEYS) {
    if (!Number.isFinite(expected[key]) && !Number.isFinite(actual[key])) continue;
    assert.ok(
      Math.abs(actual[key] - expected[key]) < 1e-7,
      `${label}:${key} actual=${actual[key]} expected=${expected[key]}`,
    );
  }
  assert.equal(actual.uid, expected.uid, `${label}:uid`);
}

test('placeExternalLabels always returns one rect per label so unused cljs fallback is not a layout', () => {
  const labels = sampleLabels(12);
  const placed = core.placeExternalLabels({
    ...sideRailOptions(200, 150),
    labels,
  });
  assert.equal(placed.length, labels.length);
  assert.ok(placed.every((rect) => (
    Number.isFinite(rect.x)
    && Number.isFinite(rect.y)
    && Number.isFinite(rect.w)
    && Number.isFinite(rect.h)
  )));
});

test('cljs-style sequential occupiedRects uses one production layout call per label', () => {
  const labels = sampleLabels(18);
  const { rects, calls } = sequentialPlace(labels, sideRailOptions(200, 150));
  assert.equal(calls, labels.length);
  assert.equal(rects.length, labels.length);
});

test('reusing translated label rectangles matches a fresh layout at the new center', () => {
  for (const offset of [[120, 75], [-85, 201], [0, 0]]) {
    const labels = sampleLabels(18);
    const options = sideRailOptions(200, 150, { labels });
    const original = core.placeExternalLabels(options);
    const shifted = core.translateLabelRects({ rects: original, dx: offset[0], dy: offset[1] });
    const recalculated = core.placeExternalLabels({
      ...options,
      centerX: 200 + offset[0],
      centerY: 150 + offset[1],
      labels: labels.map((label) => ({ ...label, anchorY: label.anchorY + offset[1] })),
    });
    for (let i = 0; i < labels.length; i += 1) {
      assertGeometryClose(shifted[i], recalculated[i], `${offset}:${i}`);
    }
    assert.notEqual(shifted, original);
    assert.notEqual(shifted[0], original[0]);
  }
});

test('cljs-style sequential translation matches a fresh sequential layout at the new center', () => {
  const labels = sampleLabels(18);
  const offset = [120, 75];
  const { rects: original, calls: boundsCalls } = sequentialPlace(labels, sideRailOptions(200, 150));
  const shifted = core.translateLabelRects({ rects: original, dx: offset[0], dy: offset[1] });
  const { rects: recalculated, calls: paintCalls } = sequentialPlace(
    labels.map((label) => ({ ...label, anchorY: label.anchorY + offset[1] })),
    sideRailOptions(200 + offset[0], 150 + offset[1]),
  );
  assert.equal(boundsCalls, 18);
  assert.equal(paintCalls, 18);
  for (let i = 0; i < labels.length; i += 1) {
    assertGeometryClose(shifted[i], recalculated[i], `seq:${i}`);
  }
});

test('same-center translation reuses geometry without another layout pass', () => {
  const labels = sampleLabels(8);
  const original = core.placeExternalLabels(sideRailOptions(200, 150, { labels }));
  const reused = core.translateLabelRects({ rects: original, dx: 0, dy: 0 });
  for (let i = 0; i < labels.length; i += 1) {
    assertGeometryClose(reused[i], original[i], `same:${i}`);
  }
  assert.notEqual(reused, original);
  assert.notEqual(reused[0], original[0]);
});

test('translated rects do not alias the original objects', () => {
  const labels = sampleLabels(4);
  const original = core.placeExternalLabels(sideRailOptions(200, 150, { labels }));
  const snapshot = original.map((rect) => ({ ...rect }));
  const shifted = core.translateLabelRects({ rects: original, dx: 40, dy: -15 });
  shifted[0].x += 999;
  shifted[0].y += 999;
  shifted[0].anchorY += 999;
  assert.equal(original[0].x, snapshot[0].x);
  assert.equal(original[0].y, snapshot[0].y);
  assert.equal(original[0].anchorY, snapshot[0].anchorY);
  assert.notEqual(shifted[1], original[1]);
});

test('different label size, order, or exclusion radius need a fresh layout', () => {
  const labels = sampleLabels(6);
  const options = sideRailOptions(200, 150, { labels });
  const original = core.placeExternalLabels(options);
  const shifted = core.translateLabelRects({ rects: original, dx: 80, dy: 40 });
  const movedLabels = labels.map((label) => ({ ...label, anchorY: label.anchorY + 40 }));
  const movedOptions = {
    ...options,
    centerX: 280,
    centerY: 190,
    labels: movedLabels,
  };

  const wider = core.placeExternalLabels({
    ...movedOptions,
    labels: movedLabels.map((label) => ({ ...label, width: label.width + 36, height: 28 })),
  });
  assert.ok(wider.some((rect, i) => Math.abs(rect.x - shifted[i].x) > 1e-7 || Math.abs(rect.y - shifted[i].y) > 1e-7));

  const reordered = core.placeExternalLabels({
    ...movedOptions,
    labels: [...movedLabels].reverse(),
  });
  assert.notEqual(reordered[0].uid, shifted[0].uid);
  assert.ok(reordered.some((rect, i) => rect.uid !== shifted[i].uid || Math.abs(rect.y - shifted[i].y) > 1e-7));

  const tighter = core.placeExternalLabels({
    ...movedOptions,
    exclusionRadius: 90,
    maxVerticalOffset: 90 * 0.92,
  });
  assert.ok(tighter.some((rect, i) => Math.abs(rect.x - shifted[i].x) > 1e-7));
});

test('different label text identity with equal-height anchors needs a fresh layout', () => {
  const labels = [
    { uid: 'alpha', angle: Math.PI, width: 180, height: 20, anchorY: 210, sortKey: 600 },
    { uid: 'beta', angle: Math.PI, width: 180, height: 20, anchorY: 210, sortKey: 600 },
  ];
  const options = sideRailOptions(300, 210, { labels });
  const original = core.placeExternalLabels(options);
  const shifted = core.translateLabelRects({ rects: original, dx: 12, dy: 8 });
  const renamed = core.placeExternalLabels({
    ...options,
    centerX: 312,
    centerY: 218,
    labels: labels.map((label) => ({
      ...label,
      uid: `${label.uid}-renamed`,
      anchorY: label.anchorY + 8,
    })),
  });
  assert.notEqual(renamed[0].uid, shifted[0].uid);
  assert.notEqual(renamed[1].uid, shifted[1].uid);
});
