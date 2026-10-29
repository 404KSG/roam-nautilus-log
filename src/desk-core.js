const timingCore = require('./timing-core');

function projectDeskTasks(snapshot, planUid, { fallbackMinutes = 15, readString } = {}) {
  if (!snapshot || snapshot.unavailable || snapshot.missing || snapshot['block/uid'] !== planUid
    || !timingCore.isNautilusComponent(snapshot['block/string']) || !Array.isArray(snapshot['block/children'])) {
    throw new Error('The Nautilus plan is unavailable.');
  }
  if (snapshot['block/children'].length > 1024) throw new Error('Desk plan limit exceeded.');
  const strings = new Map(); let calls = 0, expandedBytes = 0;
  const account = text => { expandedBytes += new TextEncoder().encode(text).length; if (expandedBytes > 2 * 1024 * 1024) throw new Error('Desk projection text limit exceeded.'); return text; };
  const boundedRead = typeof readString === 'function' ? uid => {
    if (++calls > 1024) throw new Error('Desk projection expansion limit exceeded.');
    if (!strings.has(uid)) { if (strings.size >= 128) throw new Error('Desk projection reference limit exceeded.'); strings.set(uid, readString(uid)); }
    const value = strings.get(uid); if (value != null && typeof value !== 'string') throw new Error('Unreadable task reference.');
    return typeof value === 'string' ? account(value) : null;
  } : undefined;
  const seen = new Set(), orders = new Set();
  const rows = snapshot['block/children'].map((child) => {
    const uid = child?.['block/uid'], string = child?.['block/string'], order = child?.['block/order'];
    if (typeof uid !== 'string' || !uid || seen.has(uid) || typeof string !== 'string' || !Number.isSafeInteger(order) || order < 0 || orders.has(order)) {
      throw new Error('The Nautilus plan contains an unreadable task.');
    }
    seen.add(uid); orders.add(order); account(string);
    return {
      uid, string, order, parentUid: planUid,
      taskInstance: timingCore.resolveTaskInstance({ uid, localString: string, references: child['block/refs'], readString: boundedRead, fallbackMinutes }),
    };
  });
  if ([...orders].sort((a, b) => a - b).some((order, index) => order !== index)) throw new Error('The Nautilus plan order is incomplete.');
  return timingCore.projectPlan(rows, planUid, fallbackMinutes);
}

const deskPreview = require('./desk-preview');
const { plainDeskText, nativeDeskText, nativeDeskPreviewText, safeDeskImageUrl, deskImages, readDeskPreview,
  createModernDeskPreviewAdapter, buildDeskFullPreview } = deskPreview;

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

// Native editor ownership, rather than event trust or timing, decides whether
// Desk should yield Escape. The editor receives the event before the document
// listener; this helper deliberately neither reads nor changes event state.
function nativeEditorOwnsEscape(event, mount) {
  const editor = mount?.el;
  if (!editor || event?.key !== 'Escape') return false;
  const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
  return (Array.isArray(path) && path.includes(editor))
    || Boolean(event.target && typeof editor.contains === 'function' && editor.contains(event.target));
}

module.exports = { projectDeskTasks, plainDeskText, nativeDeskText, nativeDeskPreviewText, safeDeskImageUrl, deskImages, readDeskPreview,
  createModernDeskPreviewAdapter, buildDeskFullPreview, nativeRowSpan, reconcileDeskSelection, stepDeskSelection, deskShortcut, nativeEditorOwnsEscape };
