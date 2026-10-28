import { createDeskWheel } from './desk-wheel';

/** Native Desk affordances: delayed Alt-number hints and one horizontal
 * trackpad step per gesture. Neither handler intercepts text entry or nested
 * horizontal scrollers. No graph data is read or written here. */
export function createDeskNavigation({ root, grid, body, origin, host = window, isOverview, canNavigate, step, onSwipe = () => {} }) {
  const document = root.ownerDocument;
  let hintTimer = null;
  let altHints = false;
  let dispatchingWheel = false;
  const gesture = createDeskWheel({
    step: direction => {
      dispatchingWheel = true;
      try { return step(direction); } finally { dispatchingWheel = false; }
    },
    progress: onSwipe,
    setTimer: (fn, delay) => host.setTimeout(fn, delay), clearTimer: id => host.clearTimeout(id),
  });
  // Drag feedback is native :has(--dragging / __drop), not Alt-number state.
  // Keeping them separate lets gray drag pills yield back to held-Alt counters.
  const updateHints = () => grid.classList.toggle('rm-desk-overview--numbers', altHints);
  const clearAlt = () => {
    if (hintTimer !== null) host.clearTimeout(hintTimer);
    hintTimer = null;
    altHints = false;
    updateHints();
  };
  const clear = () => { clearAlt(); gesture.reset(); };
  const allowed = target => isOverview() && (grid.contains(target) || target === origin)
    && !target?.closest?.('input,textarea,[contenteditable="true"]');
  const keydown = event => {
    if (event.key !== 'Alt' || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing || event.defaultPrevented || !allowed(event.target)) return;
    event.preventDefault();
    if (hintTimer === null) hintTimer = host.setTimeout(() => {
      hintTimer = null;
      if (allowed(document.activeElement)) { altHints = true; updateHints(); }
    }, 400);
  };
  const keyup = event => { if (event.key === 'Alt') clearAlt(); };
  const focus = event => { if (!allowed(event.target)) clearAlt(); };
  const wheel = event => {
    if (!canNavigate() || event.ctrlKey || event.metaKey || event.defaultPrevented) { gesture.reset(); return; }
    for (let node = event.target; node && node !== body; node = node.parentElement) {
      if (node.scrollWidth > node.clientWidth && ['auto', 'scroll'].includes(host.getComputedStyle(node).overflowX)) { gesture.reset(); return; }
    }
    const metrics = event.deltaMode === 1 ? { line: parseFloat(host.getComputedStyle(body).lineHeight) || 16 }
      : event.deltaMode === 2 ? { page: body.clientWidth || 600 } : undefined;
    if (gesture.handle(event, metrics)) {
      // Own horizontal intent only. Ordinary vertical scroll, zoom and nested
      // scrollers retain their native handlers/default action.
      if (event.cancelable) event.preventDefault();
      event.stopPropagation();
    }
  };
  document.addEventListener('keydown', keydown);
  document.addEventListener('keyup', keyup);
  document.addEventListener('focusin', focus);
  host.addEventListener('blur', clear);
  body.addEventListener('wheel', wheel, { passive: false });
  return {
    // Native CSS counters follow the reconciled visible DOM order.
    reconcile() { updateHints(); },
    // Selection changes outside a wheel callback end the old gesture. A wheel
    // commit keeps its latch so inertial events cannot skip another card.
    resetForSelection() { if (!dispatchingWheel) gesture.reset(); },
    resetGesture() { gesture.reset(); },
    destroy() {
      clear(); gesture.destroy();
      document.removeEventListener('keydown', keydown);
      document.removeEventListener('keyup', keyup);
      document.removeEventListener('focusin', focus);
      host.removeEventListener('blur', clear);
      body.removeEventListener('wheel', wheel);
    },
  };
}
