/** Native Desk insertion chrome shared by internal moves and additive imports.
 * Pure geometry/collection positions only: no graph APIs or payload parsing. */
const dropSide = (clientX, rect, rtl = false) => rtl === (clientX < rect.left + rect.width / 2) ? 'after' : 'before';
const insertionPosition = (sourceIndex, slot) => slot - (sourceIndex !== null && sourceIndex >= 0 && sourceIndex < slot ? 1 : 0) + 1;

function createDeskDropFeedback({ root, grid, empty, getTasks, host = globalThis.window }) {
  let active = null;
  let rail = null;
  const cards = () => [...grid.children].filter(card => card.matches('.nautilus-desk__card'));
  const clear = () => {
    rail?.remove(); rail = null; active = null;
    grid.classList.remove('rm-desk-overview--drop');
    empty.classList.remove('rm-desk-overview--drop');
  };
  const indexOf = uid => {
    const index = getTasks().findIndex(task => task.uid === uid);
    return index < 0 ? null : index;
  };
  const draw = record => {
    grid.classList.remove('rm-desk-overview--drop');
    empty.classList.remove('rm-desk-overview--drop');
    active = record;
    if (!record.card) {
      rail?.remove(); rail = null;
      (empty.hidden ? grid : empty).classList.add('rm-desk-overview--drop');
      return record.insertion;
    }
    const className = `rm-desk-tile__drop rm-desk-tile__drop--${record.side}`;
    // Preview and ready snapshots may arrive throughout a drag. Reconcile the
    // existing marker like native keyed DOM, rather than detach/remount it on
    // every update (which can invalidate a live hit-test or style observation).
    if (rail?.parentElement !== record.card) {
      rail?.remove();
      rail = grid.ownerDocument.createElement('div');
      rail.setAttribute('aria-hidden', 'true');
      const label = grid.ownerDocument.createElement('span');
      label.className = 'rm-desk-tile__drop-position';
      rail.append(label); record.card.append(rail);
    }
    if (rail.className !== className) rail.className = className;
    const text = String(insertionPosition(indexOf(record.sourceUid), record.slot));
    if (rail.firstElementChild.textContent !== text) rail.firstElementChild.textContent = text;
    return record.insertion;
  };
  const show = (event, { sourceUid = null, internal = false } = {}) => {
    const candidate = event.target?.closest?.('.nautilus-desk__card');
    const card = candidate?.parentElement === grid ? candidate : null;
    if (card) {
      const targetIndex = indexOf(card.dataset.taskUid);
      if (targetIndex === null || internal && card.dataset.taskUid === sourceUid) { clear(); return null; }
      const side = dropSide(event.clientX, card.getBoundingClientRect(), host.getComputedStyle(card).direction === 'rtl');
      return draw({ card, side, sourceUid, internal, background: false, slot: targetIndex + (side === 'after' ? 1 : 0),
        insertion: { kind: side, targetUid: card.dataset.taskUid } });
    }
    // Toolbar controls are not insertion surfaces. Empty text and grid/root
    // padding are; keeping the old rail near its edge matches native sticky slop.
    if (event.target !== grid && event.target !== root && !empty.contains(event.target)) { clear(); return null; }
    if (active?.card?.parentElement === grid && active.sourceUid === sourceUid && active.internal === internal) {
      const r = active.card.getBoundingClientRect();
      const slop = (parseFloat(host.getComputedStyle(grid).columnGap) || 0) + 4;
      if (event.clientX >= r.left - slop && event.clientX <= r.right + slop && event.clientY >= r.top - slop && event.clientY <= r.bottom + slop) return active.insertion;
    }
    const visible = cards();
    const tasks = getTasks();
    const sourceIndex = indexOf(sourceUid);
    if (internal && (sourceIndex === null || insertionPosition(sourceIndex, tasks.length) - 1 === sourceIndex)) { clear(); return null; }
    const last = visible.at(-1) || null;
    return draw({ card: last, side: 'after', sourceUid, internal, background: true, slot: tasks.length,
      insertion: internal ? { kind: 'after', targetUid: tasks.at(-1)?.uid } : { kind: 'background' } });
  };
  const reconcile = () => {
    if (!active) return;
    const { card, sourceUid, internal, background, side } = active;
    if (!root.isConnected || internal && !cards().some(item => item.dataset.taskUid === sourceUid)
      || card && (card.parentElement !== grid || indexOf(card.dataset.taskUid) === null)
      || background && card !== (cards().at(-1) || null)) { clear(); return; }
    const slot = background ? getTasks().length : indexOf(card.dataset.taskUid) + (side === 'after' ? 1 : 0);
    draw({ ...active, slot, insertion: background && internal ? { kind: 'after', targetUid: getTasks().at(-1)?.uid } : active.insertion });
  };
  return { show, clear, reconcile };
}

module.exports = { createDeskDropFeedback, dropSide, insertionPosition };
