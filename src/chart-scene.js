/* Presentation only. No graph, scheduler, clock, persistence, or mutation API. */
let canvasContext;
const validRange = item => Number.isFinite(item?.start) && Number.isFinite(item?.end) && item.end > item.start;
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
const round = value => Math.round(value * 1000) / 1000;

function sourceItems(items) {
  const seen = new Set();
  return (Array.isArray(items) ? items : []).filter(item => {
    if (!item || typeof item.uid !== 'string' || !item.uid || seen.has(item.uid)
      || typeof item.description !== 'string' || !item.description.trim() || item.freetime) return false;
    seen.add(item.uid); return true;
  });
}

function textMeasure(font, supplied) {
  if (typeof supplied === 'function') return supplied;
  if (typeof document !== 'undefined') {
    canvasContext ||= document.createElement('canvas').getContext('2d');
    if (canvasContext) {
      canvasContext.font = font;
      return text => canvasContext.measureText(text).width;
    }
  }
  return text => [...text].reduce((sum, ch) => sum + (/[^\x00-\xff]/.test(ch) ? 13 : 7), 0);
}

function wrapTitle(text, width, measure) {
  const prefix = [...text.slice(0, 512)].slice(0, 256).join('');
  const chars = [...prefix];
  const maxLines = [...text.slice(0, 161)].length <= 80 ? 80 : 4;
  function split(limit) {
    const lines = []; let from = 0;
    while (from < chars.length && lines.length <= maxLines) {
      let lo = 1, hi = chars.length - from;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (measure(chars.slice(from, from + mid).join('')) <= limit) lo = mid;
        else hi = mid - 1;
      }
      let count = lo;
      const candidate = chars.slice(from, from + count).join('');
      const space = candidate.lastIndexOf(' ');
      if (from + count < chars.length && space >= candidate.length * 0.45) count = [...candidate.slice(0, space + 1)].length;
      else if (from + count < chars.length && /[A-Za-z0-9_]/.test(chars[from + count - 1]) && /[A-Za-z0-9_]/.test(chars[from + count])) {
        let wordStart = from + count - 1;
        while (wordStart > from && /[A-Za-z0-9_]/.test(chars[wordStart - 1])) wordStart -= 1;
        if (wordStart > from) count = wordStart - from;
      }
      lines.push(chars.slice(from, from + count).join('')); from += count;
    }
    return { lines, consumed: from };
  }
  let result = split(width);
  const truncated = result.lines.length > maxLines || result.consumed < chars.length || prefix.length < text.length;
  if (!truncated && result.lines.length > 1) {
    // Find the narrowest balanced wrapping with the same line count. This
    // prevents one-character CJK orphans without dropping any source text.
    const wordWidths = (prefix.match(/[A-Za-z0-9_]+/g) || []).map(measure).filter(value => value <= width);
    let lo = Math.min(width, Math.max(measure(prefix) / result.lines.length, ...wordWidths, 0)), hi = width;
    for (let i = 0; i < 10; i += 1) {
      const mid = (lo + hi) / 2, next = split(mid);
      if (next.lines.length <= result.lines.length && next.consumed === chars.length) hi = mid;
      else lo = mid;
    }
    result = split(Math.min(width, hi + 1));
  }
  const lines = result.lines.slice(0, maxLines);
  if (truncated) {
    let tail = lines.at(-1) || '';
    while (tail && measure(tail + '…') > width) tail = [...tail].slice(0, -1).join('');
    lines[lines.length - 1] = tail.trimEnd() + '…';
  }
  return { lines, truncated };
}

/** Only source data and local geometry size the frame, never the moving clock. */
function chartPresentationFrame({ containerWidth, items = [], timeRadius = 150,
  startMinutes = 300, endMinutes = 1260, font = '500 13px Inter, system-ui, sans-serif', measure } = {}) {
  const rawWidth = finite(containerWidth, 720), width = rawWidth > 0 ? rawWidth : 720;
  const compact = width <= 520, source = sourceItems(items);
  const viewWidth = compact ? Math.max(160, Math.round(width)) : 720;
  const radius = Math.max(20, finite(timeRadius, 150));
  // B uses 336 of the 720 wide-view units for the shell, matching the approved
  // surface-to-label proportion. Compact columns keep their existing budget.
  let plotDiameter = compact ? Math.min(radius * 2, viewWidth * .4) : Math.min(336, radius * 2 * 1.12);
  let fontSize = compact ? 11 : 13;
  const lineHeight = compact ? 15 : 16;
  let labelWidth = compact ? (viewWidth - 56 - plotDiameter) / 2 : 148;
  const fontAt = size => font.replace(/\b\d+(?:\.\d+)?px/, `${size}px`).replace(/^\d+\s/, '500 ');
  let measured = textMeasure(fontAt(fontSize), measure);
  if (compact && !measure) {
    const words = source.flatMap(item => item.description.slice(0, 512).match(/[A-Za-z]+/g) || []).filter(word => word.length <= 24);
    const longest = Math.max(0, ...words.map(measured));
    if (longest > labelWidth) {
      fontSize = Math.max(10, 11 * labelWidth / longest);
      measured = textMeasure(fontAt(fontSize));
      labelWidth = Math.max(labelWidth, Math.min(Math.max(0, ...words.map(measured)), (viewWidth - 56 - Math.min(96, viewWidth * .4)) / 2));
      plotDiameter = viewWidth - 56 - 2 * labelWidth;
    }
  }
  const scale = plotDiameter / (radius * 2), sides = { left: 0, right: 0 };
  const labels = source.map((item, order) => {
    const title = item.description.replace(/\s+/g, ' ').trim();
    const wrapped = wrapTitle(title, labelWidth, measured);
    const metadataHeight = 14;
    const height = wrapped.lines.length * lineHeight + 4 + metadataHeight;
    // This side assignment has no time input, including for pending tasks that
    // might later become unplaced. A loose record never gets a fake angle.
    const sourceSide = sides.left <= sides.right ? 'left' : 'right';
    sides[sourceSide] += height;
    return { uid: item.uid, order, ...wrapped, width: labelWidth, height,
      inkWidth: Math.max(0, ...wrapped.lines.map(measured)), sourceSide, fontSize, lineHeight,
      metadataHeight, metadataFontSize: compact ? 9 : 10 };
  });
  // One source-sized column budget covers both timed and unplaced states.
  // Flexible titles may all move to either side, but never need two copies of space.
  const fixed = { left: 0, right: 0 }, loose = { left: 0, right: 0 };
  let flexible = 0;
  source.forEach((item, index) => {
    const label = labels[index];
    if ((item.meeting || item.done) && validRange(item) && item.end > startMinutes && item.start < endMinutes) {
      const minute = (Math.max(startMinutes, item.start) + Math.min(endMinutes, item.end)) / 2;
      const angle = (180 - (((minute - 540) / 2 % 360 + 360) % 360)) * Math.PI / 180;
      fixed[Math.cos(angle) < 0 ? 'left' : 'right'] += label.height;
    } else if (!item.done && !item.meeting) flexible += label.height;
    else loose[label.sourceSide] += label.height;
  });
  const timedTop = 12;
  const timedHeight = Math.max(plotDiameter + 16, flexible + Math.max(fixed.left + loose.left, fixed.right + loose.right));
  const timedBottom = timedTop + timedHeight;
  const height = timedBottom + 2;
  return { viewBox: { width: viewWidth, height }, center: { x: viewWidth / 2, y: timedTop + timedHeight / 2 },
    timeRadius: radius, plotScale: scale, compact, density: compact ? 'compact' : 'regular',
    inspector: 'wrapped', compactHeader: width <= 640, columnCapacity: timedHeight,
    timedTop, timedBottom,
    labelWidth, fontSize, lineHeight, hourStep: compact && plotDiameter < 180 ? 3 : 1, labels };
}

function labelLayout(frame, records) {
  const sides = { left: { timed: [], loose: [] }, right: { timed: [], loose: [] } };
  const metrics = new Map(frame.labels.map(label => [label.uid, label]));
  const routeY = record => {
    const angle = Math.atan2(record.anchor.y - frame.center.y, record.anchor.x - frame.center.x);
    return Math.sin(angle);
  };
  for (const record of records) {
    record.label = { ...metrics.get(record.uid) };
    if (record.kind !== 'timed') sides[record.label.sourceSide].loose.push(record);
  }
  for (const record of records.filter(r => r.kind === 'timed').sort((a, b) => routeY(a) - routeY(b) || a.event.start - b.event.start || a.order - b.order)) {
    const side = record.anchor.x < frame.center.x ? 'left' : 'right';
    sides[side].timed.push(record);
  }
  function position(record, side, y) {
    const label = record.label, left = side === 'left';
    const x = left ? 16 : frame.viewBox.width - 16 - label.width;
    const textX = left ? x + label.width : x;
    const titleHeight = label.height - label.metadataHeight;
    const middle = y + titleHeight / 2;
    const textY = y + (titleHeight - label.lines.length * label.lineHeight) / 2 + label.fontSize;
    Object.assign(label, { x, y, side, textX, align: left ? 'end' : 'start', textY,
      metadataY: textY + (label.lines.length - 1) * label.lineHeight + label.metadataHeight });
    if (record.kind !== 'timed') {
      // Non-time glyphs sit beyond the text's outer edge. They neither point
      // into the clock nor cross the real slice leaders on the inner edge.
      const textEdge = left ? textX - label.inkWidth : textX + label.inkWidth;
      const startX = textEdge + (left ? -4 : 4);
      const markerX = textEdge + (left ? -8 : 8);
      record.marker = { x: markerX, y: middle, size: 6, shape: record.kind === 'unplaced' ? 'diamond' : 'square' };
      label.connector = `M${round(startX)} ${round(middle)}L${round(markerX)} ${round(middle)}`;
      record.markerPath = record.marker.shape === 'diamond'
        ? `M${round(markerX)},${round(middle - 3)}l3,3 -3,3 -3,-3Z`
        : `M${round(markerX - 3)},${round(middle - 3)}h6v6h-6Z`;
      return;
    }
    const a = record.anchor, { x: cx, y: cy } = frame.center;
    const radius = frame.timeRadius * frame.plotScale;
    const endX = left ? x + label.width + 5 : x - 5;
    const railX = cx + (left ? -1 : 1) * (radius + 5);
    const angle = Math.atan2(a.y - cy, a.x - cx);
    const p = { x: cx + Math.cos(angle) * (radius + 5), y: cy + Math.sin(angle) * (radius + 5) };
    const controlX = (railX + endX) / 2;
    // All curves on a side share their x coordinates and preserve angular
    // order. Their horizontal approach stays outside the spiral silhouette.
    label.connector = `M${round(a.x)} ${round(a.y)}L${round(p.x)} ${round(p.y)}L${round(railX)} ${round(p.y)}`
      + `C${round(controlX)} ${round(p.y)} ${round(controlX)} ${round(middle)} ${round(endX)} ${round(middle)}`;
  }
  for (const side of ['left', 'right']) {
    const { timed, loose } = sides[side];
    const low = frame.timedTop;
    const high = frame.timedBottom - loose.reduce((sum, record) => sum + record.label.height, 0);
    let cursor = high;
    for (const record of loose) { position(record, side, cursor); cursor += record.label.height; }
    const ys = []; cursor = low;
    for (const record of timed) {
      const y = Math.max(cursor, Math.min(high - record.label.height, record.anchor.y - record.label.height / 2));
      ys.push(y); cursor = y + record.label.height;
    }
    cursor = high;
    for (let i = timed.length - 1; i >= 0; i -= 1) { ys[i] = Math.min(ys[i], cursor - timed[i].label.height); cursor = ys[i]; }
    for (let i = 0; i < timed.length; i += 1) position(timed[i], side, ys[i]);
  }
}

/** Draw observed intervals and explicit planned allocations with distinct claims. */
function chartScene({ items = [], events = [], containerWidth, startMinutes = 300, endMinutes = 1260,
  timeRadius = 150, radiusForMinute, font, measure } = {}) {
  const source = sourceItems(items);
  const start = finite(startMinutes, 300), end = finite(endMinutes, 1260);
  const frame = chartPresentationFrame({ items: source, containerWidth, timeRadius, startMinutes: start, endMinutes: end, font, measure });
  const within = item => validRange(item) && item.end > start && item.start < end;
  const plotted = new Map((Array.isArray(events) ? events : []).filter(event => event?.uid && within(event)).map(event => [event.uid, event]));
  const records = source.map((item, order) => {
    const interval = plotted.get(item.uid) || ((item.meeting || item.done) && within(item) ? item : null);
    const timed = Boolean(interval);
    const kind = timed ? 'timed' : validRange(item) ? 'outside-window' : item.done === true ? 'completed-estimate-overflow' : 'unplaced';
    const original = interval || item;
    const event = { ...original, description: item.description, uid: item.uid,
      'chart-kind': kind, 'time-claim': !timed ? 'none' : item['estimated-allocation'] ? 'estimated-allocation'
        : item.meeting ? 'fixed-range' : !item.done ? 'planned' : item['duration-source'] === 'actual' ? 'actual' : 'completion-estimate',
      'full-start': validRange(original) ? original.start : null, 'full-end': validRange(original) ? original.end : null };
    if (timed) {
      event.start = Math.max(start, original.start); event.end = Math.min(end, original.end);
    }
    if (item['estimated-allocation'] && timed) {
      event['overlaps-planned'] = [...plotted.values()].some(other => other.uid !== item.uid && !other.done && !other.meeting
        && other.start < event.end && other.end > event.start);
    }
    const record = { uid: item.uid, order, kind, event };
    if (timed) {
      const minute = (event.start + event.end) / 2;
      const angle = (180 - (((minute - 540) / 2 % 360 + 360) % 360)) * Math.PI / 180;
      let radius = frame.timeRadius;
      try { if (typeof radiusForMinute === 'function') radius = finite(radiusForMinute(minute), radius); } catch (_) { /* drawing fallback only */ }
      record.anchor = { x: frame.center.x + Math.cos(angle) * (radius + 4) * frame.plotScale,
        y: frame.center.y - Math.sin(angle) * (radius + 4) * frame.plotScale };
    }
    return record;
  });
  labelLayout(frame, records);
  return { frame, records };
}

/** Category/state paint is separate from scheduling and record placement. */
function chartRecordAppearance({ event = {}, nowMinutes, interactive = false, showElapsed = false } = {}) {
  const category = event.meeting === true ? 'event' : 'task';
  const done = event.done === true;
  const current = !done && interactive === true && validRange(event)
    && Number.isFinite(nowMinutes) && event.start <= nowMinutes && nowMinutes < event.end;
  const elapsed = showElapsed === true && validRange(event) && Number.isFinite(nowMinutes) && event.end <= nowMinutes;
  const phase = done ? 'completed' : current ? 'current' : elapsed ? 'elapsed' : 'future';
  let hash = 2166136261;
  for (const char of String(event.uid || '')) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  const variation = hash % 5;
  const override = typeof event['bg-color'] === 'string' && event['bg-color'];
  return { category, phase, current, currentEvent: current && category === 'event', variation,
    fill: override || `var(--nautilus-log-${category}-${phase}-fill)`,
    stroke: `var(--nautilus-log-${category})`, fillOpacity: override ? 1 : .96 + variation / 100 };
}

/** Closed tips fit content, but always remain within the local workspace. */
function chartTipLayout({ title = '', summary = '', meta = summary, containerWidth = 720,
  fontFamily = 'Inter, system-ui, sans-serif', moreLabel = 'More', measureTitle, measureMeta } = {}) {
  const localWidth = finite(containerWidth, 720);
  const compact = localWidth <= 360;
  const maxWidth = Math.max(96, localWidth - 32);
  // CSS uses tabular numerals; Canvas defaults to proportional digits. The
  // zero advance gives the tabular width and avoids clipping short time ranges.
  const titleWidth = textMeasure(`500 11px ${fontFamily}`, measureTitle)(String(title).replace(/[0-9]/g, '0'));
  const metaDigits = (String(summary).match(/[0-9]/g) || []).length;
  // Inter's tnum zero can itself be wider than its proportional zero. Include
  // the measured native-font allowance plus subpixel grid rounding, not a
  // tolerance that lets a supposedly complete short tip paint an ellipsis.
  const metaWidth = textMeasure(`400 11px ${fontFamily}`, measureMeta)(String(summary).replace(/[0-9]/g, '0'))
    + 2 + metaDigits * .4;
  // Equal-size text rows share an action whose label aligns with metadata.
  // Wide content wraps in full; only compact views require expansion for clipped text.
  const contentGutter = 6 * 2 + 2 + 5 + 4;
  const more = String(meta) !== String(summary) || (compact && (titleWidth > maxWidth - contentGutter || metaWidth > maxWidth - contentGutter));
  const actionWidth = Math.max(28, Math.ceil(textMeasure(`400 11px ${fontFamily}`)(moreLabel)) + 6);
  const actionRoom = more ? actionWidth + 4 + 6 : 0;
  const width = Math.max(titleWidth, metaWidth) + contentGutter + actionRoom;
  return { mode: 'stacked', contentMode: compact ? 'compact' : 'full',
    width: Math.max(60, Math.min(maxWidth, Math.ceil(width))), maxWidth,
    expandedWidth: maxWidth, more, actionWidth, slotHeight: 42 };
}

module.exports = { chartScene, chartPresentationFrame, chartRecordAppearance, chartTipLayout };
