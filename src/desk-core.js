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

module.exports = {
  projectDeskTasks, plainDeskText, deskPreview, reconcileDeskSelection, stepDeskSelection, deskShortcut,
};
