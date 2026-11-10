let nextHintId = 0;

/** One floating hint owner for this renderer's Help, Calendar and view controls. */
export function createViewTooltip({ host, root, current }) {
  const document = root?.ownerDocument || host?.document;
  if (!root?.addEventListener || !document?.body) return { refresh() {}, destroy() {} };
  let anchor = null, panel = null, timer = null, hovered = null, focused = null, closed = false;
  let generation = 0, observer = null, observedGroup = null, dismissed = null;
  const listeners = [], activeListeners = [];
  const listen = (node, name, callback, options, cleanups = listeners) => {
    node.addEventListener(name, callback, options);
    cleanups.push(() => node.removeEventListener(name, callback, options));
  };
  const control = target => {
    // Calendar temporarily removes its tooltip attribute while its result is open.
    const node = target?.closest?.('[data-nautilus-tooltip],.nautilus-log-calendar-btn');
    return node?.closest('.nautilus-log-container') === root
      && node.closest('.nautilus-log-controls-top') ? node : null;
  };
  const available = node => node?.isConnected && control(node) === node && node.getClientRects().length;
  const popoverOpen = () => [...root.querySelectorAll('.nautilus-log-help-btn[aria-expanded="true"],.nautilus-log-calendar-btn[aria-expanded="true"]')]
    .some(node => node.closest('.nautilus-log-container') === root);
  function clearPanel() {
    generation++;
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
  function hide() {
    clearPanel(); observer?.disconnect(); observedGroup = null;
  }
  function watch(node) {
    const group = node.closest('.nautilus-log-controls-top');
    if (observedGroup === group) return;
    observer?.disconnect();
    if (!observer && typeof host.MutationObserver === 'function') observer = new host.MutationObserver(select);
    observer?.observe(group, {
      attributes: true, attributeFilter: ['data-nautilus-tooltip', 'aria-expanded'], childList: true, subtree: true,
    });
    observedGroup = group;
  }
  function position() {
    if (closed || !anchor || (!panel && timer === null)) return;
    if (!current() || !available(anchor)) { hide(); return; }
    if (popoverOpen()) { clearPanel(); return; }
    if (!panel) return;
    const rect = anchor.getBoundingClientRect(), width = host.innerWidth, height = host.innerHeight;
    if (rect.bottom <= 0 || rect.top >= height || rect.right <= 0 || rect.left >= width) { hide(); return; }
    const message = anchor.getAttribute('data-nautilus-tooltip') || '';
    if (panel.textContent !== message) panel.textContent = message;
    const style = host.getComputedStyle(anchor), pseudo = host.getComputedStyle(anchor, '::after');
    for (const name of ['bg', 'border', 'text']) panel.style.setProperty(`--nautilus-log-control-tooltip-${name}`,
      style.getPropertyValue(`--nautilus-log-control-tooltip-${name}`));
    panel.style.fontFamily = pseudo.fontFamily;
    panel.style.whiteSpace = pseudo.whiteSpace;
    const box = panel.getBoundingClientRect(), gutter = 12, gap = 9;
    panel.style.left = `${Math.max(gutter, Math.min(rect.right - box.width, width - box.width - gutter))}px`;
    const below = rect.bottom + gap, above = rect.top - box.height - gap;
    const placeBelow = below + box.height <= height - gutter || above < gutter;
    panel.dataset.placement = placeBelow ? 'below' : 'above';
    panel.style.top = `${Math.max(gutter, placeBelow ? Math.min(below, height - box.height - gutter) : above)}px`;
  }
  function show(node) {
    if (closed || !current() || !available(node)) { hide(); return; }
    if (anchor !== node) { clearPanel(); anchor = node; }
    if (popoverOpen() || !node.getAttribute('data-nautilus-tooltip') || document.visibilityState === 'hidden') {
      // Retain the interaction observer so an async disclosure close can restore
      // the label even when the pointer never leaves this button.
      clearPanel(); return;
    }
    if (node.getAttribute('data-nautilus-floating-hint') !== 'true') node.setAttribute('data-nautilus-floating-hint', 'true');
    if (panel || timer !== null) { position(); return; }
    listen(host, 'scroll', position, true, activeListeners);
    listen(host, 'resize', position, undefined, activeListeners);
    listen(host, 'hashchange', hide, undefined, activeListeners);
    listen(document, 'visibilitychange', () => { if (document.visibilityState === 'hidden') hide(); }, undefined, activeListeners);
    const token = generation;
    timer = host.setTimeout(() => {
      if (token !== generation) return;
      timer = null;
      if (closed || !current() || (hovered !== anchor && focused !== anchor) || !available(anchor)) { hide(); return; }
      if (popoverOpen() || !anchor.getAttribute('data-nautilus-tooltip') || document.visibilityState === 'hidden') { clearPanel(); return; }
      panel = document.createElement('div');
      panel.className = 'nautilus-log-view-tooltip';
      panel.setAttribute('role', 'tooltip');
      panel.id = `nautilus-view-hint-${host.crypto?.randomUUID?.() || ++nextHintId}`;
      const ids = new Set((anchor.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
      ids.add(panel.id); anchor.setAttribute('aria-describedby', [...ids].join(' '));
      document.body.append(panel);
      position();
    }, host.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : 160);
  }
  function select() {
    if (closed || !current()) { hide(); return; }
    if (!available(hovered)) hovered = null;
    if (!available(focused) || focused !== document.activeElement || !focused.matches(':focus-visible')) focused = null;
    const node = hovered || focused;
    if (node && node !== dismissed) { watch(node); show(node); }
    else { hide(); anchor = node; }
  }
  listen(root, 'pointerover', event => {
    const node = control(event.target);
    if (node && !node.contains(event.relatedTarget)) { hovered = node; dismissed = null; select(); }
  });
  listen(root, 'pointerout', event => {
    const node = control(event.target);
    if (node && !node.contains(event.relatedTarget)) { if (hovered === node) hovered = null; select(); }
  });
  listen(root, 'focusin', event => {
    const node = control(event.target);
    if (node?.matches(':focus-visible')) { focused = node; hovered = null; dismissed = null; select(); }
  });
  listen(root, 'focusout', event => {
    const node = control(event.target);
    if (node) { if (focused === node) focused = null; select(); }
  });
  listen(root, 'keydown', event => {
    if (event.key === 'Escape') {
      if (popoverOpen()) clearPanel();
      else { if (panel || timer !== null) dismissed = anchor; hide(); }
    } else {
      const node = control(event.target);
      if (node?.matches(':focus-visible')) { focused = node; hovered = null; dismissed = null; select(); }
    }
  });
  listen(root, 'click', event => {
    if (control(event.target)) {
      dismissed = null;
      if (host.queueMicrotask) host.queueMicrotask(select); else Promise.resolve().then(select);
    }
  }, true);
  return {
    refresh() { if (observedGroup || panel || timer !== null) select(); },
    destroy() {
      closed = true; hide();
      for (const remove of listeners) remove();
      for (const node of root.querySelectorAll('[data-nautilus-floating-hint]')) {
        if (node.closest('.nautilus-log-container') === root) node.removeAttribute('data-nautilus-floating-hint');
      }
      anchor = null; hovered = null; focused = null; dismissed = null;
    },
  };
}
