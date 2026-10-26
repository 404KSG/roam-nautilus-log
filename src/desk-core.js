const timingCore = require('./timing-core');

/** A view over the original direct task blocks, never a second task store. */
function projectDeskTasks(snapshot, planUid, { fallbackMinutes = 15, readString } = {}) {
  if (!snapshot || snapshot.unavailable || snapshot.missing
    || snapshot['block/uid'] !== planUid
    || !timingCore.isNautilusComponent(snapshot['block/string'])
    || !Array.isArray(snapshot['block/children'])) {
    throw new Error('The Nautilus plan is unavailable.');
  }
  const seen = new Set();
  const rows = snapshot['block/children'].map((child) => {
    const uid = child?.['block/uid'];
    const string = child?.['block/string'];
    const order = child?.['block/order'];
    if (typeof uid !== 'string' || !uid || seen.has(uid)
      || typeof string !== 'string' || !Number.isFinite(order)) {
      throw new Error('The Nautilus plan contains an unreadable task.');
    }
    seen.add(uid);
    return {
      uid, string, order, parentUid: planUid,
      taskInstance: timingCore.resolveTaskInstance({
        uid, localString: string, references: child['block/refs'], readString, fallbackMinutes,
      }),
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

function deskPreview(children = []) {
  return [...children].sort((a, b) => a.order - b.order)
    .filter(({ string }) => typeof string === 'string' && string.trim()
      && !/^\s*:?(?:LOGBOOK|CLOCK):/i.test(string)
      && !timingCore.isStructuralBlock(string))
    .slice(0, 2)
    .map(({ string }) => {
      const text = plainDeskText(string);
      return text.length > 160 ? `${text.slice(0, 159)}…` : text;
    });
}

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
  if (index < 0 || !tasks.length) return null;
  return tasks[(index + (direction < 0 ? -1 : 1) + tasks.length) % tasks.length].uid;
}

function deskShortcut(event) {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229
    || event.ctrlKey || event.metaKey || event.shiftKey) return null;
  if (event.key === 'Escape' && !event.altKey) return 'back';
  if (!event.altKey) return null;
  // macOS Option changes event.key to ≤ / ≥; physical codes preserve Desk's bindings.
  if (event.code === 'Comma') return 'next';
  if (event.code === 'Period') return 'previous';
  return null;
}

// Keep view ordering separate from the original outline and its scheduling priority.
function orderDeskTasks(tasks, order) {
  if (!Array.isArray(order)) return tasks;
  const remaining = new Map(tasks.map((task) => [task.uid, task]));
  const ordered = [];
  for (const uid of order) {
    if (!remaining.has(uid)) continue;
    ordered.push(remaining.get(uid));
    remaining.delete(uid);
  }
  return [...ordered, ...remaining.values()];
}

function moveDeskTask(tasks, uid, targetUid, after = false) {
  const uids = tasks.map((task) => task.uid);
  if (!uids.includes(uid) || uid === targetUid || (targetUid && !uids.includes(targetUid))) return uids;
  const result = uids.filter((id) => id !== uid);
  const index = targetUid ? result.indexOf(targetUid) + (after ? 1 : 0) : result.length;
  result.splice(index, 0, uid);
  return result;
}

function masonryLayout(heights, width, { gap = 16, minWidth = 280, maxColumns = 3 } = {}) {
  if (!(width > 0)) return { columns: 1, cardWidth: 0, height: 0, items: [] };
  const columns = Math.max(1, Math.min(maxColumns, Math.floor((width + gap) / (minWidth + gap))));
  const cardWidth = (width - gap * (columns - 1)) / columns;
  const bottoms = Array(columns).fill(0);
  const items = heights.map((height) => {
    const column = bottoms.indexOf(Math.min(...bottoms));
    const item = { x: column * (cardWidth + gap), y: bottoms[column] };
    bottoms[column] += Math.max(0, Number(height) || 0) + gap;
    return item;
  });
  return { columns, cardWidth, height: heights.length ? Math.max(...bottoms) - gap : 0, items };
}

module.exports = {
  projectDeskTasks, plainDeskText, deskPreview, reconcileDeskSelection, stepDeskSelection, deskShortcut,
  masonryLayout, orderDeskTasks, moveDeskTask,
};
