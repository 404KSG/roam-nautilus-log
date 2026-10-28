/** Desk-only drag sorting. Never hand Roam a block-move payload. */
export function createDeskDrag({ grid, canDrag, move, nudge, feedback, host = globalThis.window, now = () => Date.now() }) {
  let source = null;
  let suppressUntil = 0;
  const cardFor = (node) => {
    const card = node?.closest?.('.nautilus-desk__card');
    return card?.parentElement === grid ? card : null;
  };
  const cancel = () => {
    source?.classList.remove('rm-desk-tile--dragging');
    source = null;
    feedback.clear();
  };
  const reconcile = () => {
    if (!source) return;
    if (source.parentElement !== grid || !source.draggable || !canDrag()) { cancel(); return; }
    feedback.reconcile();
  };
  const start = (event) => {
    const card = cardFor(event.target);
    if (!card) return;
    if (!canDrag() || card.disabled || !event.dataTransfer) { event.preventDefault(); return; }
    cancel();
    source = card;
    event.stopPropagation();
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-nautilus-desk-task', card.dataset.taskUid);
    source.classList.add('rm-desk-tile--dragging');
  };
  const over = (event) => {
    if (!source || !canDrag()) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    feedback.show(event, { sourceUid: source.dataset.taskUid, internal: true });
  };
  const drop = (event) => {
    if (!source) return;
    event.preventDefault();
    event.stopPropagation();
    if (canDrag()) {
      const insertion = feedback.show(event, { sourceUid: source.dataset.taskUid, internal: true });
      if (insertion?.targetUid) move(source.dataset.taskUid, insertion.targetUid, insertion.kind);
    }
    suppressUntil = now() + 300;
    cancel();
  };
  const leave = event => { if (!grid.contains(event.relatedTarget)) feedback.clear(); };
  const end = (event) => {
    if (!source && !cardFor(event.target)) return;
    event.stopPropagation();
    suppressUntil = now() + 300;
    cancel();
  };
  const click = (event) => {
    if (event.detail === 0 || event.target.closest('button') || now() >= suppressUntil || !cardFor(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
  };
  const key = (event) => {
    if (source && event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancel();
      return;
    }
    const card = cardFor(event.target);
    if (!card || !canDrag() || event.defaultPrevented || event.isComposing
      || !event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return;
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    nudge(card.dataset.taskUid, event.key === 'ArrowLeft' ? -1 : 1);
  };
  // Suppress only the trailing click, not a new deliberate pointer gesture.
  const pointerDown = () => { if (!source) suppressUntil = 0; };
  const blur = () => { if (source) { suppressUntil = now() + 300; cancel(); } };
  const events = [['dragstart', start], ['dragover', over], ['drop', drop], ['dragleave', leave], ['dragend', end], ['keydown', key], ['pointerdown', pointerDown]];
  for (const [name, listener] of events) grid.addEventListener(name, listener);
  grid.addEventListener('click', click, true);
  host?.addEventListener?.('blur', blur);
  return {
    cancel, reconcile,
    destroy() {
      cancel();
      for (const [name, listener] of events) grid.removeEventListener(name, listener);
      grid.removeEventListener('click', click, true);
      host?.removeEventListener?.('blur', blur);
    },
  };
}
