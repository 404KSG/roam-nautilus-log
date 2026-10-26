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

// Native Desk page: root + at most eleven child rows, walking open children to depth two.
function readDeskPreview(uid, readChildren, limit = 11, readString) {
  const sorted = (id) => [...readChildren(id)].sort((a, b) => a.order - b.order);
  const direct = sorted(uid);
  const stack = direct.map((row) => ({ ...row, depth: 1 }));
  const rows = [], seen = new Set([uid]), references = new Map();
  const resolve = (value, path = []) => String(value || '').replace(/\(\(([\w-]{6,})\)\)/g, (original, ref) => {
    if (!readString || path.includes(ref) || path.length >= 8) return original;
    if (!references.has(ref)) references.set(ref, readString(ref));
    const text = references.get(ref);
    return typeof text === 'string' ? resolve(text, [...path, ref]) : '(missing)';
  });
  while (stack.length && rows.length < limit) {
    const row = stack.shift();
    if (!row?.uid || seen.has(row.uid)) continue;
    seen.add(row.uid);
    rows.push({ ...nativeDeskText(resolve(row.string)), depth: row.depth });
    if (row.depth < 2 && row.open !== false) stack.unshift(...sorted(row.uid).map((child) => ({ ...child, depth: 2 })));
  }
  return { rows, more: stack.length > 0, searchText: direct.map((row) => String(row.string || '')).join(' ') };
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

module.exports = { projectDeskTasks, plainDeskText, nativeDeskText, readDeskPreview, nativeRowSpan,
  reconcileDeskSelection, stepDeskSelection, deskShortcut };
