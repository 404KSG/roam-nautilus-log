let nextHintId = 0;

/** A view hint lives outside Roam's outline/embedding stacking contexts. */
export function createViewTooltip({ host, root, current }) {
  const document = root?.ownerDocument || host?.document;
  if (!root?.addEventListener || !document?.body) return { refresh() {}, destroy() {} };
  let anchor = null, panel = null, timer = null, hovered = false, focused = false, closed = false;
  const listeners = [], activeListeners = [];
  const listen = (node, name, callback, options, cleanups = listeners) => {
    node.addEventListener(name, callback, options);
    cleanups.push(() => node.removeEventListener(name, callback, options));
  };
  function hide() {
    if (timer !== null) host.clearTimeout(timer);
    timer = null;
    for (const remove of activeListeners.splice(0)) remove();
    if (panel && anchor) {
      const ids = (anchor.getAttribute('aria-describedby') || '').split(/\s+/).filter(id => id && id !== panel.id);
      if (ids.length) anchor.setAttribute('aria-describedby', ids.join(' '));
      else anchor.removeAttribute('aria-describedby');
    }
    panel?.remove(); panel = null;
  }
  function refresh() {
    if (closed || !anchor || (!panel && timer === null)) return;
    if (!current() || !anchor.isConnected || !anchor.getClientRects().length) { hide(); return; }
    if (!panel) return;
    const rect = anchor.getBoundingClientRect(), width = host.innerWidth, height = host.innerHeight;
    if (rect.bottom <= 0 || rect.top >= height || rect.right <= 0 || rect.left >= width) { hide(); return; }
    const message = anchor.getAttribute('data-nautilus-tooltip') || '';
    if (panel.textContent !== message) panel.textContent = message;
    const style = host.getComputedStyle(anchor);
    for (const name of ['bg', 'border', 'text']) panel.style.setProperty(`--nautilus-log-control-tooltip-${name}`,
      style.getPropertyValue(`--nautilus-log-control-tooltip-${name}`));
    const box = panel.getBoundingClientRect(), gutter = 12, gap = 9;
    panel.style.left = `${Math.max(gutter, Math.min(rect.right - box.width, width - box.width - gutter))}px`;
    const above = rect.top - box.height - gap;
    panel.style.top = `${Math.max(gutter, above >= gutter ? above : Math.min(rect.bottom + gap, height - box.height - gutter))}px`;
  }
  function show(node) {
    if (closed || !current()) return;
    if (anchor !== node) { hide(); anchor = node; }
    node.setAttribute('data-nautilus-floating-hint', 'true');
    if (panel || timer !== null) { refresh(); return; }
    listen(host, 'scroll', refresh, true, activeListeners);
    listen(host, 'resize', refresh, undefined, activeListeners);
    listen(host, 'hashchange', hide, undefined, activeListeners);
    listen(document, 'visibilitychange', () => { if (document.visibilityState === 'hidden') hide(); }, undefined, activeListeners);
    timer = host.setTimeout(() => {
      timer = null;
      if (closed || !current() || !(hovered || focused) || !anchor?.isConnected || document.visibilityState === 'hidden') { hide(); return; }
      panel = document.createElement('div');
      panel.className = 'nautilus-log-view-tooltip';
      panel.setAttribute('role', 'tooltip');
      panel.id = `nautilus-view-hint-${host.crypto?.randomUUID?.() || ++nextHintId}`;
      const ids = new Set((anchor.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
      ids.add(panel.id); anchor.setAttribute('aria-describedby', [...ids].join(' '));
      document.body.append(panel);
      refresh();
    }, host.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : 160);
  }
  const control = target => {
    const node = target?.closest?.('.nautilus-log-desk-btn');
    return node?.closest('.nautilus-log-container') === root ? node : null;
  };
  listen(root, 'pointerover', event => {
    const node = control(event.target);
    if (node && !node.contains(event.relatedTarget)) { hovered = true; show(node); }
  });
  listen(root, 'pointerout', event => {
    const node = control(event.target);
    if (node && !node.contains(event.relatedTarget)) { hovered = false; focused = node.matches(':focus-visible'); if (!focused) hide(); }
  });
  listen(root, 'focusin', event => {
    const node = control(event.target);
    if (node?.matches(':focus-visible')) { focused = true; show(node); }
  });
  listen(root, 'focusout', event => {
    if (control(event.target)) { focused = false; if (!hovered) hide(); }
  });
  listen(root, 'keydown', event => {
    if (event.key === 'Escape') hide();
    else if (control(event.target)?.matches(':focus-visible')) { focused = true; show(control(event.target)); }
  });
  return {
    refresh,
    destroy() {
      closed = true; hide();
      for (const remove of listeners) remove();
      for (const node of root.querySelectorAll('[data-nautilus-floating-hint]')) {
        if (node.closest('.nautilus-log-container') === root) node.removeAttribute('data-nautilus-floating-hint');
      }
      anchor = null;
    },
  };
}
