/** Native Desk affordances: delayed Alt-number hints and one horizontal
 * trackpad step per gesture. Neither handler intercepts text entry or nested
 * horizontal scrollers. No graph data is read or written here. */
export function createDeskNavigation({ root, grid, body, origin, host = window, isOverview, canNavigate, step }) {
  const document = root.ownerDocument;
  let hintTimer = null;
  let dx = 0, dy = 0, last = -Infinity, locked = false, direction = 0;
  const clear = () => {
    if (hintTimer !== null) host.clearTimeout(hintTimer);
    hintTimer = null;
    grid.classList.remove('rm-desk-overview--numbers');
  };
  const allowed = target => isOverview() && (root.contains(target) || target === origin)
    && !target?.closest?.('input,textarea,[contenteditable="true"]');
  const keydown = event => {
    if (event.key !== 'Alt' || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing || event.defaultPrevented || !allowed(event.target)) return;
    event.preventDefault();
    if (hintTimer === null) hintTimer = host.setTimeout(() => {
      hintTimer = null;
      if (allowed(document.activeElement)) grid.classList.add('rm-desk-overview--numbers');
    }, 400);
  };
  const keyup = event => { if (event.key === 'Alt') clear(); };
  const focus = event => { if (!allowed(event.target)) clear(); };
  const wheel = event => {
    if (!canNavigate() || event.ctrlKey || event.defaultPrevented) return;
    for (let node = event.target; node && node !== body; node = node.parentElement) {
      if (node.scrollWidth > node.clientWidth && ['auto', 'scroll'].includes(host.getComputedStyle(node).overflowX)) return;
    }
    const stamp = event.timeStamp;
    const x = event.deltaX || 0, y = event.deltaY || 0;
    if (stamp - last > 300 || direction && x && Math.sign(x) !== direction && Math.abs(x) >= 10) { dx = dy = 0; locked = false; direction = 0; }
    last = stamp;
    if (locked) return;
    dx += x; dy += y;
    if (Math.abs(dx) >= 70 && Math.abs(dx) > Math.abs(dy)) {
      locked = true; direction = Math.sign(dx);
      step(dx > 0 ? -1 : 1);
    } else if (Math.abs(dy) >= 70 && Math.abs(dy) > 2 * Math.abs(dx)) locked = true;
  };
  document.addEventListener('keydown', keydown);
  document.addEventListener('keyup', keyup);
  document.addEventListener('focusin', focus);
  host.addEventListener('blur', clear);
  body.addEventListener('wheel', wheel, { passive: true });
  return { destroy() {
    clear();
    document.removeEventListener('keydown', keydown);
    document.removeEventListener('keyup', keyup);
    document.removeEventListener('focusin', focus);
    host.removeEventListener('blur', clear);
    body.removeEventListener('wheel', wheel);
  } };
}
