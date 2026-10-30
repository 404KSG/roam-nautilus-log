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
  const maxLines = [...text.slice(0, 161)].length <= 80 ? 8 : 4;
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

/** Only full source identity/title and container geometry size the frame. */
function chartPresentationFrame({ containerWidth, items = [], timeRadius = 150,
  font = '600 13px Inter, system-ui, sans-serif', measure } = {}) {
  const rawWidth = finite(containerWidth, 720);
  const width = rawWidth > 0 ? rawWidth : 720;
  const compact = width <= 520;
  const viewWidth = compact ? Math.max(160, Math.round(width)) : 720;
  const radius = Math.max(20, finite(timeRadius, 150)), outerRadius = radius + 20;
  const scale = compact ? Math.min(1, (viewWidth - 32) / (outerRadius * 2)) : 1;
  const labelWidth = compact ? (viewWidth - 84) / 2 : 148;
  const measured = textMeasure(font, measure);
  const labels = sourceItems(items).map((item, order) => {
    const title = item.description.replace(/\s+/g, ' ').trim();
    const wrapped = wrapTitle(title, labelWidth, measured);
    return { uid: item.uid, order, ...wrapped, width: labelWidth,
      height: Math.max(24, wrapped.lines.length * 18 + 8) };
  });
  const total = labels.reduce((sum, label) => sum + label.height, 0);
  const columnCapacity = labels.length ? Math.ceil(total / 2) + Math.max(...labels.map(label => label.height)) : 0;
  const centerY = compact ? 30 + outerRadius * scale : Math.max(452, columnCapacity + 72) / 2;
  const labelTop = compact ? centerY + outerRadius * scale + 28 : 36;
  const height = compact ? labelTop + columnCapacity + 16 : centerY * 2;
  return { viewBox: { width: viewWidth, height }, center: { x: viewWidth / 2, y: centerY },
    timeRadius: radius, outerRadius, plotScale: scale, compact, density: compact ? 'compact' : 'regular',
    inspector: 'wrapped', compactHeader: width <= 640, labelTop,
    columnCapacity, labelWidth, labels };
}

function arcPath(cx, cy, inner, outer, startDegrees, endDegrees) {
  const point = (angle, radius) => [round(cx + Math.cos(angle * Math.PI / 180) * radius), round(cy - Math.sin(angle * Math.PI / 180) * radius)];
  const a = point(startDegrees, outer), b = point(endDegrees, outer);
  const c = point(endDegrees, inner), d = point(startDegrees, inner);
  return `M${a}A${outer} ${outer} 0 0 0 ${b}L${c}A${inner} ${inner} 0 0 1 ${d}Z`;
}

function labelLayout(frame, records) {
  const sides = { left: [], right: [] }, used = { left: 0, right: 0 };
  const metrics = new Map(frame.labels.map(label => [label.uid, label]));
  for (const record of [...records].sort((a, b) => a.anchor.y - b.anchor.y || a.order - b.order)) {
    const label = metrics.get(record.uid);
    let side = record.anchor.x < frame.center.x ? 'left' : 'right';
    if (used[side] + label.height > frame.columnCapacity) side = side === 'left' ? 'right' : 'left';
    sides[side].push({ record, label }); used[side] += label.height;
  }
  for (const side of ['left', 'right']) {
    const left = side === 'left', entries = sides[side];
    let y = frame.labelTop + (frame.columnCapacity - used[side]) / 2;
    for (const [index, { record, label }] of entries.entries()) {
      const x = frame.compact ? (left ? 34 : frame.viewBox.width / 2 + 8) : (left ? 16 : 556);
      const centerY = y + label.height / 2;
      const endX = frame.compact ? (left ? 28 : frame.viewBox.width - 28) : (left ? 170 : 550);
      const shortX = endX + (frame.compact ? (left ? -6 : 6) : (left ? 6 : -6));
      const a = record.anchor, cx = frame.center.x, cy = frame.center.y;
      const baseR = frame.outerRadius * frame.plotScale;
      const maxR = frame.compact ? Math.min(frame.viewBox.width / 2 - 7, baseR + 12) : baseR + 12;
      const routeR = baseR + 3 + (maxR - baseR - 3) * (index + 1) / (entries.length + 1);
      const angle = Math.atan2(a.y - cy, a.x - cx);
      const p = { x: cx + Math.cos(angle) * routeR, y: cy + Math.sin(angle) * routeR };
      const wrongSide = (a.x < cx) !== left;
      let start = `M${round(a.x)} ${round(a.y)}`;
      let controlX;
      if (frame.compact || wrongSide) {
        const targetAngle = left ? Math.PI : 0;
        const delta = ((targetAngle - angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        const routeX = cx + (left ? -routeR : routeR);
        start += `L${round(p.x)} ${round(p.y)}A${round(routeR)} ${round(routeR)} 0 0 ${delta >= 0 ? 1 : 0} ${round(routeX)} ${round(cy)}`;
        controlX = frame.compact ? (left ? 3 + index * 18 / Math.max(1, entries.length) : frame.viewBox.width - 3 - index * 18 / Math.max(1, entries.length)) : routeX;
        start += `C${round(controlX)} ${round(cy)} ${round(controlX)} ${round(centerY)} ${round(shortX)} ${round(centerY)}`;
      } else {
        controlX = left ? 182 - index * 7 / Math.max(1, entries.length) : 538 + index * 7 / Math.max(1, entries.length);
        start += `C${round(controlX)} ${round(a.y)} ${round(controlX)} ${round(centerY)} ${round(shortX)} ${round(centerY)}`;
      }
      record.label = { ...label, x, y, textX: frame.compact || !left ? x : x + label.width,
        textY: y + (label.height - label.lines.length * 18) / 2 + 13,
        align: frame.compact || !left ? 'start' : 'end',
        connector: start + `L${round(endX)} ${round(centerY)}` };
      y += label.height;
    }
  }
}

/** One visible presentation record per source UID, with honest time claims. */
function chartScene({ items = [], events = [], containerWidth, startMinutes = 300, endMinutes = 1260,
  timeRadius = 150, radiusForMinute, font, measure } = {}) {
  const source = sourceItems(items);
  const frame = chartPresentationFrame({ items: source, containerWidth, timeRadius, font, measure });
  const start = finite(startMinutes, 300), end = finite(endMinutes, 1260);
  const within = item => validRange(item) && item.end > start && item.start < end;
  const plotted = new Map((Array.isArray(events) ? events : []).filter(event => event?.uid && within(event)).map(event => [event.uid, event]));
  // Eligible slots are reserved by the full source collection, not by the
  // changing scheduled/overflow subset. Closed CLOCK never redistributes peers.
  const eligible = source.filter(item => item.todo || !within(item));
  const slots = new Map(eligible.map((item, index) => {
    const step = 360 / Math.max(1, eligible.length), span = Math.min(32, step * 0.82);
    const middle = 210 + index * step;
    return [item.uid, { index, startDegrees: middle - span / 2, endDegrees: middle + span / 2, spanDegrees: span }];
  }));
  const records = source.map((item, order) => {
    const interval = plotted.get(item.uid) || ((item.meeting || item.done) && within(item) ? item : null);
    const timed = Boolean(interval);
    const kind = timed ? 'timed' : validRange(item) ? 'outside-window' : item.done === true ? 'untimed-completed' : 'unplaced';
    const original = interval || item;
    const event = { ...original, description: item.description, uid: item.uid,
      'chart-kind': kind, 'time-claim': !timed ? 'none' : item.meeting ? 'fixed-range'
        : !item.done ? 'planned' : item['duration-source'] === 'actual' ? 'actual' : 'completion-estimate',
      'full-start': validRange(original) ? original.start : null, 'full-end': validRange(original) ? original.end : null };
    if (timed) {
      event.start = Math.max(start, original.start); event.end = Math.min(end, original.end);
    }
    const record = { uid: item.uid, order, kind, event };
    if (timed) {
      const minute = (event.start + event.end) / 2;
      const angle = (180 - (((minute - 540) / 2 % 360 + 360) % 360)) * Math.PI / 180;
      let radius = frame.timeRadius;
      try { if (typeof radiusForMinute === 'function') radius = finite(radiusForMinute(minute), radius); } catch (_) { /* drawing fallback only */ }
      record.anchor = { x: frame.center.x + Math.cos(angle) * (radius + 4) * frame.plotScale,
        y: frame.center.y - Math.sin(angle) * (radius + 4) * frame.plotScale };
    } else {
      const slot = slots.get(item.uid);
      // A source fixed interval that could be plotted is never in this branch.
      // Keep malformed/missing placements visible rather than fabricating times.
      const actualSlot = slot || { index: order, startDegrees: 210 + order * 11, endDegrees: 218 + order * 11, spanDegrees: 8 };
      record.slot = actualSlot;
      const angle = (actualSlot.startDegrees + actualSlot.endDegrees) / 2 * Math.PI / 180;
      const inner = (frame.timeRadius + 8) * frame.plotScale, outer = frame.outerRadius * frame.plotScale;
      record.indexPath = arcPath(frame.center.x, frame.center.y, inner, outer, actualSlot.startDegrees, actualSlot.endDegrees);
      const statusRadius = (inner + outer) / 2;
      record.statusPoint = { x: frame.center.x + Math.cos(angle) * statusRadius,
        y: frame.center.y - Math.sin(angle) * statusRadius,
        room: actualSlot.spanDegrees * Math.PI / 180 * statusRadius };
      record.anchor = { x: frame.center.x + Math.cos(angle) * (outer + 2), y: frame.center.y - Math.sin(angle) * (outer + 2) };
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
  fontFamily = 'Inter, system-ui, sans-serif', measureTitle, measureMeta } = {}) {
  const maxWidth = Math.min(280, Math.max(96, finite(containerWidth, 720) - 32));
  // CSS uses tabular numerals; Canvas defaults to proportional digits. The
  // zero advance gives the tabular width and avoids clipping short time ranges.
  const titleWidth = textMeasure(`600 12px ${fontFamily}`, measureTitle)(String(title).replace(/[0-9]/g, '0'));
  const metaDigits = (String(summary).match(/[0-9]/g) || []).length;
  // Inter's tnum zero can itself be wider than its proportional zero. Include
  // the measured native-font allowance plus subpixel grid rounding, not a
  // tolerance that lets a supposedly complete short tip paint an ellipsis.
  const metaWidth = textMeasure(`400 11px ${fontFamily}`, measureMeta)(String(summary).replace(/[0-9]/g, '0'))
    + 2 + metaDigits * .4;
  let more = String(meta) !== String(summary) || titleWidth > maxWidth - 27 || metaWidth > maxWidth - 27;
  const extra = more ? 38 : 0;
  const inlineWidth = titleWidth + metaWidth + 33 + extra;
  const mode = inlineWidth <= maxWidth ? 'inline' : 'stacked';
  const width = Math.min(maxWidth, Math.ceil(mode === 'inline' ? inlineWidth : Math.max(titleWidth, metaWidth) + 27 + extra));
  if (mode === 'stacked' && (titleWidth > width - 27 - extra || metaWidth > width - 27 - extra)) more = true;
  return { mode, width: Math.max(60, more && mode === 'stacked' ? maxWidth : width), maxWidth,
    expandedWidth: maxWidth, more, slotHeight: 44 };
}

module.exports = { chartScene, chartPresentationFrame, chartRecordAppearance, chartTipLayout };
