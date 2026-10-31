/** Pure continuous-shell geometry. No clock, scheduling, DOM or graph access. */
const RADII = Object.freeze([135, 140, 145, 150, 145, 140, 135, 130, 125, 120, 115, 110,
  105, 100, 95, 90, 85, 80, 75, 70, 68, 66, 64, 62]);
const finite = Number.isFinite;
const round = n => Math.round(n * 1000) / 1000;
const empty = () => ({ start: null, end: null, path: '', outerPath: '' });

function configuration(input = {}) {
  const { startMinutes = 300, endMinutes = 1260, innerRadius = 50, radiusScale = 1,
    centerX = 0, centerY = 0 } = input;
  if (![startMinutes, endMinutes, innerRadius, radiusScale, centerX, centerY].every(finite)
    || startMinutes < 0 || endMinutes <= startMinutes || endMinutes - startMinutes > 1440
    || innerRadius <= 0 || radiusScale <= 0 || innerRadius >= RADII.at(-1) * radiusScale) return null;
  return { startMinutes, endMinutes, innerRadius, radiusScale, centerX, centerY };
}

function controlRadius(index) {
  // Continue the initial linear slope; repeat the tail so it settles smoothly.
  if (index < 0) return RADII[0] + index * (RADII[1] - RADII[0]);
  return RADII[Math.min(index, RADII.length - 1)];
}

/** Convex cubic B-spline: C2 shoulders, no narrow exact-anchor apex or overshoot. */
function shellRadius({ minute, startMinutes = 300, radiusScale = 1 } = {}) {
  if (![minute, startMinutes, radiusScale].every(finite) || radiusScale <= 0) return null;
  const q = Math.max(-.5, (minute - startMinutes) / 60 - .5);
  if (q >= RADII.length) return RADII.at(-1) * radiusScale;
  const i = Math.floor(q), t = q - i, t2 = t * t, t3 = t2 * t;
  // Nonnegative weights sum to one. Linear stretches are reproduced exactly;
  // only turns in the control profile are rounded, without changing clock angles.
  const value = (controlRadius(i - 1) * (1 - t) ** 3
    + controlRadius(i) * (3 * t3 - 6 * t2 + 4)
    + controlRadius(i + 1) * (-3 * t3 + 3 * t2 + 3 * t + 1)
    + controlRadius(i + 2) * t3) / 6;
  return value * radiusScale;
}

function radiiAt(minute, config, side) {
  const outer = shellRadius({ ...config, minute });
  const paired = minute + 720;
  const folded = paired < config.endMinutes
    || (side === 'before' && paired === config.endMinutes && minute > config.startMinutes);
  const inner = folded ? Math.max(config.innerRadius,
    shellRadius({ ...config, minute: paired }) + config.radiusScale) : config.innerRadius;
  return { outer, inner, folded };
}

function shellRadii(input = {}) {
  const config = configuration(input);
  return config && finite(input.minute) ? radiiAt(input.minute, config, input.side) : null;
}

function point(minute, radius, config) {
  const angle = ((minute - 900) % 720) * Math.PI / 360;
  return { x: round(config.centerX + Math.cos(angle) * radius), y: round(config.centerY + Math.sin(angle) * radius) };
}
const coordinates = p => `${p.x},${p.y}`;
const openPath = points => points.length ? 'M' + points.map(coordinates).join('L') : '';

/** Bounded five-minute chords include exact range ends, fold and radius-anchor knots. */
function samples(start, end, config) {
  const times = new Set([start, end]);
  for (let t = Math.ceil(start / 5) * 5; t < end; t += 5) times.add(t);
  for (let t = config.startMinutes + 30; t < end; t += 60) if (t > start) times.add(t);
  const fold = config.endMinutes - 720;
  if (fold > start && fold < end) times.add(fold);
  return [...times].sort((a, b) => a - b);
}

function shellInterval(input = {}) {
  const config = configuration(input);
  if (!config || !finite(input.start) || !finite(input.end) || input.end <= input.start) return empty();
  const start = Math.max(input.start, config.startMinutes), end = Math.min(input.end, config.endMinutes);
  if (end <= start) return empty();
  const times = samples(start, end, config), fold = config.endMinutes - 720;
  const outer = times.map(t => point(t, radiiAt(t, config).outer, config));
  const inner = [];
  for (const t of [...times].reverse()) {
    // At a fold-crossing, preserve both one-sided inner edges. Never interpolate
    // through the later turn, or borrow its area for the earlier interval.
    const side = t === end && t === fold ? 'before' : undefined;
    inner.push(point(t, radiiAt(t, config, side).inner, config));
    if (t === fold && start < t && t < end) inner.push(point(t, radiiAt(t, config, 'before').inner, config));
  }
  const outerPath = openPath(outer);
  return { start, end, path: outerPath + 'L' + inner.map(coordinates).join('L') + 'Z', outerPath,
    startOuter: outer[0], endOuter: outer.at(-1), startInner: inner.at(-1), endInner: inner[0],
    foldMinute: start < fold && fold < end ? fold : null };
}

function shellGrid(input = {}) {
  const config = configuration(input);
  if (!config) return { path: '', ticks: [] };
  const { startMinutes: start, endMinutes: end } = config;
  const hourStep = finite(input.hourStep) ? Math.max(1, Math.round(input.hourStep)) : 1;
  const compact = finite(input.plotScale) && input.plotScale < .6;
  const times = new Set([start, end]);
  for (let t = Math.ceil(start / (compact ? 60 : 15)) * (compact ? 60 : 15); t < end; t += compact ? 60 : 15) times.add(t);
  const ticks = [...times].sort((a, b) => a - b).map(minute => {
    const major = minute % 60 === 0 || minute === start || minute === end;
    const radius = shellRadius({ ...config, minute });
    const a = point(minute, radius + 2, config), b = point(minute, radius + (major ? 7 : 4), config);
    const labelPoint = point(minute, radius - 10, config);
    const hour = Math.floor(minute / 60) % 24;
    const shown = major && (hourStep === 1 || minute === start || minute === end || hour % hourStep === 0);
    const label = shown ? `${hour}${minute % 60 ? ':' + String(minute % 60).padStart(2, '0') : ''}` : null;
    return { minute, major, label, x1: a.x, y1: a.y, x2: b.x, y2: b.y, labelX: labelPoint.x, labelY: labelPoint.y };
  });
  return { path: shellInterval({ ...config, start, end }).path, ticks };
}

function shellNeedle(input = {}) {
  const config = configuration(input), minute = input.minute;
  if (!config || !finite(minute) || minute < config.startMinutes || minute >= config.endMinutes) return null;
  const r = radiiAt(minute, config), a = point(minute, r.inner + 2, config), b = point(minute, r.outer + 5, config);
  return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
}

module.exports = { shellRadius, shellRadii, shellInterval, shellGrid, shellNeedle };
