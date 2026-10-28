// Temporary, opt-in diagnostics. This module never reads graph data, text/input
// values, identifiers, URLs, storage, clipboard, or arbitrary keyboard events.
const REASONS = new Set([
  'enabled', 'manual', 'before-open', 'after-open', 'hide-toggle', 'hide-button',
  'hide-escape', 'after-hide', 'fold', 'unfold', 'focus-open', 'focus-overview',
  'focus-close-button', 'focus-backdrop', 'focus-escape', 'focus-other-desk',
  'focus-open-main', 'focus-non-task-saved', 'focus-read-unavailable',
  'focus-selection-removed', 'focus-hashchange', 'scope-invalid', 'host-removed',
  'host-rebound', 'view-close', 'view-destroy', 'focus-layer-detached',
  'shortcut-back', 'shortcut-next', 'shortcut-previous',
]);
const COMMANDS = {
  start: 'Nautilus Log: Start Desk diagnostics (temporary)',
  show: 'Nautilus Log: Show Desk diagnostics',
  stop: 'Nautilus Log: Stop and clear Desk diagnostics',
};
const finite = value => typeof value === 'number' && Number.isFinite(value)
  ? Math.round(Math.max(-1e7, Math.min(1e7, value)) * 100) / 100 : null;
const cssNumber = value => finite(parseFloat(value));
const dimension = value => ['auto', 'none', 'normal'].includes(value) ? value : cssNumber(value);
const CSS_ENUMS = new Set(('none block inline flex inline-flex grid inline-grid contents flow-root table table-row table-cell list-item static relative absolute fixed sticky visible hidden clip auto scroll overlay border-box content-box row row-reverse column column-reverse normal stretch center start end flex-start flex-end self-start self-end baseline space-between space-around space-evenly').split(' '));
const enumValue = value => CSS_ENUMS.has(value) ? value : null;
const KIND_SELECTORS = [
  ['host', '.nautilus-log-desk-host'], ['chart', '.nautilus-log-container'],
  ['block', '.roam-block-container'], ['block-main', '.rm-block-main'],
  ['block-input', '.rm-block__input,.roam-block'], ['children', '.rm-block-children'],
  ['daily-page', '.roam-log-page'], ['article', '.roam-article'],
  ['article-wrapper', '.rm-article-wrapper'], ['center', '.roam-center'],
  ['main-body', '.roam-body-main'], ['main', '.roam-main'],
  ['sidebar', '#right-sidebar,.rm-sidebar-window'],
];

function measureBox(el, host) {
  if (!el) return null;
  const r = el.getBoundingClientRect(), s = host.getComputedStyle(el);
  const borderX = (cssNumber(s.borderLeftWidth) || 0) + (cssNumber(s.borderRightWidth) || 0);
  const borderY = (cssNumber(s.borderTopWidth) || 0) + (cssNumber(s.borderBottomWidth) || 0);
  const result = {
    kind: KIND_SELECTORS.find(([, selector]) => el.matches?.(selector))?.[0] || 'other',
    x: finite(r.x), y: finite(r.y), width: finite(r.width), height: finite(r.height),
    right: finite(r.right), bottom: finite(r.bottom), centerX: finite(r.x + r.width / 2),
    clientWidth: finite(el.clientWidth), scrollWidth: finite(el.scrollWidth),
    clientHeight: finite(el.clientHeight), scrollHeight: finite(el.scrollHeight),
    scrollLeft: finite(el.scrollLeft), scrollTop: finite(el.scrollTop),
    scrollbarY: finite(Math.max(0, el.offsetWidth - el.clientWidth - borderX)),
    scrollbarX: finite(Math.max(0, el.offsetHeight - el.clientHeight - borderY)),
    inlineWidth: Boolean(el.style?.width), inlineHeight: Boolean(el.style?.height),
    inlineMinHeight: Boolean(el.style?.minHeight), inlineMarginLeft: Boolean(el.style?.marginLeft),
    flexGrow: cssNumber(s.flexGrow), flexShrink: cssNumber(s.flexShrink), flexBasis: dimension(s.flexBasis),
    cssWidth: dimension(s.width),
    scrollbarGutter: ['auto', 'stable', 'stable both-edges'].includes(s.scrollbarGutter) ? s.scrollbarGutter : null,
  };
  for (const name of ['display', 'position', 'overflowX', 'overflowY', 'boxSizing', 'flexDirection', 'alignItems', 'justifyContent']) {
    result[name] = enumValue(s[name]);
  }
  for (const name of ['height', 'minHeight', 'maxHeight', 'minWidth', 'maxWidth', 'rowGap', 'columnGap', 'gridAutoRows', 'zoom']) {
    result[name === 'height' ? 'cssHeight' : name] = dimension(s[name]);
  }
  for (const name of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft']) {
    result[name] = cssNumber(s[name]);
  }
  return result;
}

function collectLayout(document, host, surfaceId) {
  const all = document.querySelectorAll('.nautilus-log-desk-host');
  const surfaces = Array.from(all).slice(0, 6).map(container => {
    const chart = container.closest('.nautilus-log-container');
    const root = container.querySelector('.nautilus-desk');
    const grid = root?.querySelector('.nautilus-desk__grid');
    const owner = container.closest('.roam-block-container');
    const children = Array.from(grid?.children || []);
    const visible = children.slice(0, 256).filter(el => el.getClientRects().length);
    const bottom = visible.length ? Math.max(...visible.map(el => el.getBoundingClientRect().bottom)) : null;
    const siblings = [];
    let next = owner?.nextElementSibling, following = null;
    for (let n = 0; next && n < 8; n++, next = next.nextElementSibling) {
      siblings.push(measureBox(next, host));
      if (next.matches('.roam-block-container') && next.getClientRects().length) { following = next; break; }
    }
    const ancestors = [];
    for (let el = container, n = 0; el && n < 12; el = el.parentElement, n++) ancestors.push(measureBox(el, host));
    return {
      surface: surfaceId(container),
      scope: container.closest('#right-sidebar,.rm-sidebar-window') ? 'sidebar'
        : container.closest('.rm-embed-container,.rm-callout__body') ? 'embed' : 'main',
      collapsed: Boolean(chart?.classList.contains('nautilus-log-collapsed')),
      deskMounted: Boolean(root), deskHidden: Boolean(root?.hidden),
      cardCount: children.length, sampledVisibleCards: visible.length, truncatedCards: children.length > 256,
      deepestCardBottom: finite(bottom),
      followingGap: following && bottom !== null ? finite(following.getBoundingClientRect().top - bottom) : null,
      grid: measureBox(grid, host), root: measureBox(root, host), host: measureBox(container, host),
      chart: measureBox(chart, host), shell: measureBox(chart?.querySelector('.nautilus-log-shell'), host),
      owner: measureBox(owner, host), following: measureBox(following, host),
      article: measureBox(container.closest('.roam-article'), host),
      wrapper: measureBox(container.closest('.rm-article-wrapper'), host), ancestors, siblings,
    };
  });
  const allLayers = document.querySelectorAll('.nautilus-desk__focus-layer');
  const layers = Array.from(allLayers).slice(0, 32);
  return {
    viewport: { width: finite(host.innerWidth), height: finite(host.innerHeight),
      devicePixelRatio: finite(host.devicePixelRatio), scrollX: finite(host.scrollX), scrollY: finite(host.scrollY),
      clientWidth: finite(document.documentElement?.clientWidth), scrollWidth: finite(document.documentElement?.scrollWidth),
      focused: typeof document.hasFocus === 'function' ? Boolean(document.hasFocus()) : null,
      visibility: ['visible', 'hidden', 'prerender'].includes(document.visibilityState) ? document.visibilityState : null },
    focusLayers: allLayers.length, truncatedFocusLayers: allLayers.length > 32,
    visibleFocusLayers: layers.filter(el => el.getClientRects().length).length,
    truncatedSurfaces: all.length > 6, surfaces,
  };
}

function createDeskDiagnostics({ host = globalThis.window, document = host?.document, revision = 'unknown' } = {}) {
  const build = typeof revision === 'string' && /^[a-f0-9]{40}(?:-dirty)?$/.test(revision) ? revision : 'unknown';
  let enabled = false, destroyed = false, sequence = 0, dropped = 0, started = 0, generation = 0;
  let records = [], ids = new WeakMap(), nextId = 0, observer = null, panel = null, output = null, status = null;
  const frames = new Set(), objectUrls = new Set(), exportTimers = new Set();
  const surfaceId = el => { if (!ids.has(el)) ids.set(el, ++nextId); return ids.get(el); };
  const clock = () => {
    try { const value = host?.performance?.now?.() ?? Date.now(); return Number.isFinite(value) ? value : 0; }
    catch (_error) { return 0; }
  };
  const updateStatus = () => {
    if (status) status.textContent = enabled
      ? `On · ${records.length} local events. Stop or close this panel to clear them.`
      : 'Off · no measurements are collected.';
  };
  const report = () => JSON.parse(JSON.stringify({ schema: 'nautilus-desk-diagnostics-v1', revision: build, enabled, dropped, events: records }));
  const renderReport = () => { if (output) output.value = JSON.stringify(report(), null, 2); updateStatus(); };
  const capture = (reason, trusted) => {
    if (!enabled || destroyed) return false;
    const entry = { sequence: ++sequence, elapsedMs: finite(clock() - started), reason: REASONS.has(reason) ? reason : 'other' };
    if (typeof trusted === 'boolean') entry.trustedAction = trusted;
    try { entry.layout = collectLayout(document, host, surfaceId); }
    catch (_error) { entry.measurementUnavailable = true; }
    records.push(entry);
    if (records.length > 40) { records.shift(); dropped++; }
    updateStatus();
    return true;
  };
  const afterLayout = reason => {
    if (!enabled || destroyed || typeof host?.requestAnimationFrame !== 'function') return;
    const epoch = generation;
    const queue = callback => {
      try {
        const id = host.requestAnimationFrame(() => {
          if (epoch !== generation) return;
          frames.delete(id); if (enabled && !destroyed) callback();
        });
        frames.add(id);
      } catch (_error) { /* host is closing */ }
    };
    queue(() => queue(() => capture(reason)));
  };
  const stop = () => {
    enabled = false; generation++;
    observer?.disconnect(); observer = null;
    for (const frame of frames) { try { host.cancelAnimationFrame(frame); } catch (_error) { /* host disposed */ } }
    frames.clear(); records = []; ids = new WeakMap(); nextId = sequence = dropped = 0;
    for (const timer of exportTimers) host.clearTimeout(timer);
    exportTimers.clear();
    for (const url of objectUrls) { try { host.URL?.revokeObjectURL?.(url); } catch (_error) { /* host disposed */ } }
    objectUrls.clear();
    renderReport();
  };
  const start = () => {
    if (destroyed || enabled) return false;
    stop(); enabled = true; started = clock();
    if (host?.MutationObserver && document?.body) {
      const epoch = generation;
      try {
        observer = new host.MutationObserver(changes => {
          if (epoch !== generation || !enabled) return;
          if (changes.some(change => Array.from(change.removedNodes || [])
            .some(node => node.classList?.contains('nautilus-desk__focus-layer')))) capture('focus-layer-detached');
        });
        // No subtree/text/attribute observation; no keyboard or input listeners.
        observer.observe(document.body, { childList: true });
      } catch (_error) { observer?.disconnect(); observer = null; }
    }
    capture('enabled'); renderReport();
    return true;
  };
  const closePanel = () => { stop(); panel?.remove(); panel = output = status = null; };
  const download = () => {
    if (!enabled || !host?.Blob || !host?.URL?.createObjectURL) return false;
    const url = host.URL.createObjectURL(new host.Blob([JSON.stringify(report(), null, 2)], { type: 'application/json' }));
    objectUrls.add(url);
    const link = document.createElement('a');
    link.href = url; link.download = 'nautilus-desk-diagnostics.json';
    // Only a deliberate user button click calls this local-file export. No fetch.
    link.click();
    const timer = host.setTimeout(() => {
      try { host.URL.revokeObjectURL(url); } catch (_error) { /* host disposed */ }
      objectUrls.delete(url); exportTimers.delete(timer);
    }, 0);
    exportTimers.add(timer);
    return true;
  };
  const show = () => {
    if (destroyed || !document?.body) return false;
    if (enabled) capture('manual');
    if (!panel) {
      const el = (tag, className, text) => {
        const node = document.createElement(tag); node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
      };
      panel = el('aside', 'nautilus-desk-diagnostics bp3-card bp3-elevation-3');
      panel.setAttribute('role', 'region'); panel.setAttribute('aria-label', 'Desk diagnostics');
      panel.append(el('h3', 'bp3-heading', 'Desk diagnostics'));
      panel.append(el('p', '', 'Temporary, local-only layout and close-reason data. No note text, input, URLs, or graph identifiers.'));
      status = el('p', ''); status.setAttribute('role', 'status'); panel.append(status);
      const controls = el('div', 'nautilus-desk-diagnostics__controls');
      const button = (label, action) => {
        const node = el('button', 'bp3-button bp3-minimal bp3-small', label); node.type = 'button';
        node.addEventListener('click', action); controls.append(node);
      };
      button('Start', start);
      button('Capture layout', () => { capture('manual'); renderReport(); });
      button('Refresh report', renderReport);
      button('Download report', download);
      button('Stop and clear', stop);
      button('Close diagnostics', closePanel);
      panel.append(controls);
      output = el('textarea', 'bp3-input nautilus-desk-diagnostics__report');
      output.readOnly = true; output.rows = 12; output.setAttribute('aria-label', 'Desk diagnostic report');
      panel.append(output); document.body.append(panel);
      // Do not focus the panel, lock scrolling, or otherwise perturb the editor.
    }
    renderReport();
    return true;
  };
  return { start, stop, show, capture, afterLayout, report, isEnabled: () => enabled,
    destroy() { closePanel(); destroyed = true; } };
}

function createDeskDiagnosticCommands({ extensionAPI, diagnostics, notify = () => {} } = {}) {
  const registered = [];
  const destroy = () => {
    for (const label of registered.splice(0)) {
      try { extensionAPI?.ui?.commandPalette?.removeCommand?.({ label }); } catch (_error) { /* host disposed */ }
    }
  };
  return {
    initialize() {
      if (registered.length) return true;
      const palette = extensionAPI?.ui?.commandPalette;
      if (!palette?.addCommand || !palette?.removeCommand) return false;
      try {
        for (const [name, label] of Object.entries(COMMANDS)) {
          registered.push(label);
          palette.addCommand({ label, callback: () => {
            if (!registered.includes(label)) return;
            const result = diagnostics[name]();
            if (name === 'start' && result) notify('Desk diagnostics enabled for this session. Reproduce the issue, then run Show Desk diagnostics.');
            if (name === 'stop') notify('Desk diagnostics stopped and cleared.');
          } });
        }
        return true;
      } catch (_error) { destroy(); return false; }
    },
    destroy,
  };
}

module.exports = { createDeskDiagnostics, createDeskDiagnosticCommands, COMMANDS };
