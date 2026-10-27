const timingCore = require('./timing-core');

function projectDeskTasks(snapshot, planUid, { fallbackMinutes = 15, readString } = {}) {
  if (!snapshot || snapshot.unavailable || snapshot.missing || snapshot['block/uid'] !== planUid
    || !timingCore.isNautilusComponent(snapshot['block/string']) || !Array.isArray(snapshot['block/children'])) {
    throw new Error('The Nautilus plan is unavailable.');
  }
  const seen = new Set();
  const rows = snapshot['block/children'].map((child) => {
    const uid = child?.['block/uid'], string = child?.['block/string'], order = child?.['block/order'];
    if (typeof uid !== 'string' || !uid || seen.has(uid) || typeof string !== 'string' || !Number.isFinite(order)) {
      throw new Error('The Nautilus plan contains an unreadable task.');
    }
    seen.add(uid);
    return {
      uid, string, order, parentUid: planUid,
      taskInstance: timingCore.resolveTaskInstance({ uid, localString: string, references: child['block/refs'], readString, fallbackMinutes }),
    };
  });
  return timingCore.projectPlan(rows, planUid, fallbackMinutes);
}

function plainDeskText(text) {
  return String(text || '')
    .replace(/\{\{\[\[TODO\]\]\}\}|\{\{TODO\}\}/gi, '☐')
    .replace(/\{\{\[\[DONE\]\]\}\}|\{\{DONE\}\}/gi, '☑')
    .replace(/!?\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\s+/g, ' ').trim();
}

function nativeDeskText(string) {
  const value = String(string || '');
  const match = /\{\{(?:\[\[)?(TODO|DONE)(?:\]\])?\}\}/i.exec(value);
  return { status: match?.[1]?.toUpperCase() || null,
    text: plainDeskText(value.replace(/\{\{(?:\[\[)?(?:TODO|DONE)(?:\]\])?\}\}/gi, '')) };
}

// Only explicit Markdown image syntax creates image elements. This deliberately
// excludes ordinary image-looking links and all code examples.
const DESK_IMAGE_MARKDOWN = /!\[([^\]]*)\]\(([^\s)]+)(?:\s+['"][^)]*['"])?\)/g;

function safeDeskImageUrl(value) {
  const url = String(value || '').trim();
  if (/^data:image\/(?:png|jpe?g|gif|webp|avif);base64,/i.test(url)) return url;
  if (/^blob:/i.test(url)) return url;
  if (!/^https?:/i.test(url)) return null;
  try { return new URL(url).protocol.startsWith('http') ? url : null; }
  catch (_error) { return null; }
}

// Apply prose transforms without losing literal inline/fenced code. Matching the
// exact backtick run also keeps multi-backtick examples and unclosed code inert.
function deskCodeSegments(value, prose, code = (segment) => segment) {
  const source = String(value || ''); let output = '', cursor = 0;
  while (cursor < source.length) {
    const start = source.indexOf('`', cursor);
    if (start < 0) return output + prose(source.slice(cursor));
    output += prose(source.slice(cursor, start));
    let endTick = start;
    while (source[endTick] === '`') endTick += 1;
    const ticks = source.slice(start, endTick);
    const close = source.indexOf(ticks, endTick);
    if (close < 0) return output + code(source.slice(start));
    output += code(source.slice(start, close + ticks.length));
    cursor = close + ticks.length;
  }
  return output;
}

function deskImages(string) {
  const images = [], seen = new Set();
  const add = (src, alt = '') => {
    const safe = safeDeskImageUrl(src);
    if (safe && !seen.has(safe)) { seen.add(safe); images.push({ src: safe, alt }); }
  };
  deskCodeSegments(string, (prose) => {
    for (const match of prose.matchAll(DESK_IMAGE_MARKDOWN)) add(match[2], match[1] || '');
    return prose;
  });
  return images;
}

function nativeDeskPreviewText(string) {
  const code = [];
  const masked = deskCodeSegments(string,
    (prose) => prose.replace(DESK_IMAGE_MARKDOWN, '$1'),
    (segment) => { const marker = `\uE000${code.length}\uE001`; code.push(segment); return marker; });
  const text = nativeDeskText(masked);
  return { ...text, text: text.text.replace(/\uE000(\d+)\uE001/g, (_match, index) => code[Number(index)] || '') };
}

// Native Desk page: root + at most eleven child rows, walking open children to depth two.
function readDeskPreview(uid, readChildren, limit = 11, readString, rootString = '') {
  const sorted = (id) => [...readChildren(id)].sort((a, b) => a.order - b.order);
  const direct = sorted(uid);
  const stack = direct.map((row) => ({ ...row, depth: 1 }));
  const rows = [], images = [], imageSources = new Set();
  const seen = new Set([uid]), references = new Map();
  const resolve = (value, path = []) => deskCodeSegments(value, (prose) => prose.replace(/\(\(([\w-]{6,})\)\)/g, (original, ref) => {
    if (!readString || path.includes(ref) || path.length >= 8) return original;
    if (!references.has(ref)) {
      try { references.set(ref, readString(ref)); }
      catch (_error) { references.set(ref, ''); }
    }
    const text = references.get(ref);
    return typeof text === 'string' ? resolve(text, [...path, ref]) : '(missing)';
  }));
  const addImages = (value) => {
    for (const image of deskImages(value)) if (!imageSources.has(image.src)) {
      imageSources.add(image.src); images.push(image);
    }
  };
  const resolvedRoot = resolve(rootString);
  addImages(resolvedRoot);
  while (stack.length && rows.length < limit) {
    const row = stack.shift();
    if (!row?.uid || seen.has(row.uid)) continue;
    seen.add(row.uid);
    const resolved = resolve(row.string);
    addImages(resolved);
    const previewRow = { ...nativeDeskPreviewText(resolved), depth: row.depth };
    Object.defineProperty(previewRow, 'uid', { value: row.uid, enumerable: false });
    rows.push(previewRow);
    if (row.depth < 2 && row.open !== false) stack.unshift(...sorted(row.uid).map((child) => ({ ...child, depth: 2 })));
  }
  const target = (targetUid, fields) => ({ uid: targetUid, fields });
  const referenceUids = [...references.keys()];
  return { root: nativeDeskPreviewText(resolvedRoot), rows, images, more: stack.length > 0, referenceUids,
    // The root task's order is a Plan ordering concern, not preview content.
    // Descendant order/open/children change the bounded traversal and must reload.
    watchTargets: [target(uid, ['string', 'open', 'children']),
      ...rows.map((row) => target(row.uid, ['string', 'order', 'open', 'children'])),
      ...referenceUids.map((referenceUid) => target(referenceUid, ['string', 'open', 'children']))],
    searchText: direct.map((row) => String(row.string || '')).join(' ') };
}

function nativeRowSpan(height, gap) { return Math.max(1, Math.ceil((height + gap) / 4)); }

function reconcileDeskSelection(previous, next, selectedUid) {
  if (!selectedUid) return null;
  const remaining = new Set(next.map(({ uid }) => uid));
  if (remaining.has(selectedUid)) return selectedUid;
  const index = previous.findIndex(({ uid }) => uid === selectedUid);
  const nearby = [...previous.slice(index + 1), ...previous.slice(0, Math.max(0, index)).reverse()];
  return nearby.find(({ uid }) => remaining.has(uid))?.uid || next[0]?.uid || null;
}

function stepDeskSelection(tasks, selectedUid, direction) {
  const index = tasks.findIndex(({ uid }) => uid === selectedUid);
  return index < 0 ? null : tasks[index + (direction < 0 ? -1 : 1)]?.uid || null;
}

function deskShortcut(event) {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.shiftKey) return null;
  if (event.key === 'Escape' && !event.altKey) return 'back';
  if (!event.altKey) return null;
  if (event.code === 'Comma') return 'next';
  if (event.code === 'Period') return 'previous';
  return null;
}

module.exports = { projectDeskTasks, plainDeskText, nativeDeskText, nativeDeskPreviewText, safeDeskImageUrl, deskImages, readDeskPreview, nativeRowSpan,
  reconcileDeskSelection, stepDeskSelection, deskShortcut };
