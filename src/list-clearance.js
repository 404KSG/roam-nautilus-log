const PROPERTY = '--nautilus-log-list-clearance';
const GAP = 2;
const PLAIN_GAP = 8;

/** Credit native spacing instead of stacking another fixed band on top of it. */
export function createListClearance({ host, root, owner, current }) {
  if (!root?.style?.setProperty || !owner?.children || typeof host.getComputedStyle !== 'function') {
    return { refresh() {}, destroy() {} };
  }
  let outline = null, shell = null, frame = null, closed = false, owned = null, bound = false, listening = false;
  const sizes = new Set();
  const mutations = typeof host.MutationObserver === 'function' ? new host.MutationObserver(() => refresh()) : null;
  const schedule = () => {
    if (closed || frame !== null || !current()) return;
    frame = host.requestAnimationFrame(() => { frame = null; refresh(); });
  };
  // Write in a later animation frame, outside ResizeObserver delivery.
  const resize = typeof host.ResizeObserver === 'function' ? new host.ResizeObserver(schedule) : null;
  function stop() {
    mutations?.disconnect(); resize?.disconnect(); sizes.clear();
    outline = null; shell = null; bound = false;
    if (listening) host.removeEventListener?.('resize', schedule);
    listening = false;
    if (frame !== null) host.cancelAnimationFrame(frame);
    frame = null;
  }
  const nativeNode = node => {
    const ancestor = node.closest('.nautilus-log-container');
    return !ancestor || !outline.contains(ancestor);
  };
  function bind() {
    const nextOutline = [...owner.children].find(node => node.classList.contains('rm-block-children')) || null;
    const nextShell = root.querySelector(':scope > .nautilus-log-shell');
    if (!bound || nextOutline !== outline || nextShell !== shell) {
      bound = true;
      outline = nextOutline; shell = nextShell;
      mutations?.disconnect();
      mutations?.observe(owner, { childList: true });
      if (shell) mutations?.observe(shell, { childList: true });
      if (outline) mutations?.observe(outline, {
        childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'data-nautilus-desk-hidden'],
      });
    }
    if (!resize && !listening) { host.addEventListener?.('resize', schedule); listening = true; }
    const next = new Set([root, owner]);
    if (outline) {
      next.add(outline);
      for (const tools of outline.querySelectorAll('.rm-embed-container > .rm-embed-settings')) {
        if (nativeNode(tools)) next.add(tools);
      }
    }
    for (const node of sizes) if (!next.has(node)) { resize?.unobserve(node); sizes.delete(node); }
    for (const node of next) if (!sizes.has(node)) { resize?.observe(node); sizes.add(node); }
  }
  function refresh() {
    if (closed || !current() || root.dataset.nautilusView !== 'list'
      || root.dataset.nautilusPlanHasChildren !== 'true' || root.dataset.nautilusNativeFolded === 'true') { stop(); return; }
    bind();
    if (!root.getClientRects().length || !outline?.getClientRects().length) return;
    // A saved List may bind before React removes the initial Chart subtree.
    // Its height is not native spacing and must never enter this calculation.
    if (shell?.querySelector(':scope > .nautilus-log-content')) return;
    const controls = [...root.querySelectorAll('.nautilus-log-controls-top button')]
      .filter(node => node.closest('.nautilus-log-container') === root && node.getClientRects().length);
    if (!controls.length) return;
    const bottom = Math.max(...controls.map(node => node.getBoundingClientRect().bottom));
    const padding = parseFloat(host.getComputedStyle(root).paddingBottom) || 0;
    const rows = [...outline.children].filter(node => node.getClientRects().length);
    const first = rows.length ? Math.min(...rows.map(node => node.getBoundingClientRect().top)) : outline.getBoundingClientRect().top;
    // Subtract our own current padding before crediting native space. Otherwise
    // the next layout would treat our spacer as host spacing and oscillate.
    let needed = padding + PLAIN_GAP - (first - bottom);
    for (const embed of outline.querySelectorAll('.rm-embed-container')) {
      if (!nativeNode(embed) || !embed.getClientRects().length || host.getComputedStyle(embed).visibility === 'hidden') continue;
      const tools = embed.querySelector(':scope > .rm-embed-settings');
      if (!tools) continue;
      // Native settings retain their 28px box at opacity zero, then move above
      // the embed on hover. Reading height does not force a hover or edit.
      const height = tools.getBoundingClientRect().height || parseFloat(host.getComputedStyle(tools).height) || 28;
      needed = Math.max(needed, padding + height + GAP - (embed.getBoundingClientRect().top - bottom));
    }
    if (!Number.isFinite(needed)) return;
    const value = `${Math.max(0, Math.ceil(needed))}px`;
    if (root.style.getPropertyValue(PROPERTY) !== value) root.style.setProperty(PROPERTY, value);
    owned = value;
  }
  return {
    refresh,
    destroy() {
      closed = true; stop();
      if (owned !== null && root.style.getPropertyValue(PROPERTY) === owned) root.style.removeProperty(PROPERTY);
      owned = null;
    },
  };
}
