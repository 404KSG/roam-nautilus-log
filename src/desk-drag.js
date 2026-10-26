/** Desk-only drag sorting. Never hand Roam a block-move payload. */
export function createDeskDrag({ grid, canDrag, move, nudge, now = () => Date.now() }) {
  let source = null;
  let target = null;
  let after = false;
  let suppressUntil = 0;
  const cardFor = (node) => {
    const card = node?.closest?.('.nautilus-desk__card');
    return card?.parentElement === grid ? card : null;
  };
  const clearTarget = () => {
    target?.classList.remove('is-drop-before', 'is-drop-after');
    target = null;
  };
  const cancel = () => {
    source?.classList.remove('is-dragging');
    source = null;
    clearTarget();
  };
  const start = (event) => {
    const card = cardFor(event.target);
    if (!card) return;
    if (!canDrag() || card.disabled || !event.dataTransfer) { event.preventDefault(); return; }
    source = card;
    event.stopPropagation();
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-nautilus-desk-task', card.dataset.taskUid);
    source.classList.add('is-dragging');
  };
  const over = (event) => {
    if (!source || !canDrag()) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    const card = cardFor(event.target);
    clearTarget();
    if (!card || card === source) return;
    target = card;
    const rect = card.getBoundingClientRect();
    after = event.clientY > rect.top + rect.height / 2;
    card.classList.add(after ? 'is-drop-after' : 'is-drop-before');
  };
  const drop = (event) => {
    if (!source) return;
    event.preventDefault();
    event.stopPropagation();
    if (canDrag()) {
      const card = cardFor(event.target);
      const rect = card?.getBoundingClientRect();
      move(source.dataset.taskUid, card?.dataset.taskUid || null, rect ? event.clientY > rect.top + rect.height / 2 : true);
    }
    suppressUntil = now() + 300;
    cancel();
  };
  const end = (event) => {
    if (!source && !cardFor(event.target)) return;
    event.stopPropagation();
    suppressUntil = now() + 300;
    cancel();
  };
  const click = (event) => {
    if (event.detail === 0 || now() >= suppressUntil || !cardFor(event.target)) return;
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
  const events = [['dragstart', start], ['dragover', over], ['drop', drop], ['dragend', end], ['keydown', key]];
  for (const [name, listener] of events) grid.addEventListener(name, listener);
  grid.addEventListener('click', click, true);
  return {
    cancel,
    destroy() {
      cancel();
      for (const [name, listener] of events) grid.removeEventListener(name, listener);
      grid.removeEventListener('click', click, true);
    },
  };
}
