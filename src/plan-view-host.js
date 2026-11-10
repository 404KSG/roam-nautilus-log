import { graphName } from './graph-context.js';
import { isRightSidebarRenderContext } from './render-context.js';

const MODES = new Set(['chart', 'list']);
const ownCaret = owner => [...owner?.querySelectorAll('.rm-caret') || []]
  .find(node => node.closest('.roam-block-container') === owner);

/** Read the local native surface, never the graph's shared :block/open value.
 * Current Roam marks its owning block open/closed; older hosts expose the caret.
 * A childless block has no usable caret and must keep its view control reachable. */
export function nativePlanFolded(owner) {
  if (!owner) return false;
  const caret = ownCaret(owner);
  if (caret?.classList.contains('rm-caret-hidden')) return false;
  if (owner.classList.contains('rm-block--closed')) return true;
  if (owner.classList.contains('rm-block--open')) return false;
  return Boolean(caret?.classList.contains('rm-caret-closed'));
}

export function planViewStorageKey(graph, uid, sidebar = false) {
  return `nautilus-log:view:v1:${encodeURIComponent(graph)}:${encodeURIComponent(uid)}:${sidebar ? 'sidebar' : 'main'}`;
}

export function readPlanView(storage, graph, uid, sidebar = false) {
  try {
    const saved = storage?.getItem(planViewStorageKey(graph, uid, sidebar));
    if (MODES.has(saved)) return saved;
  } catch (_) { /* A fresh, usable chart is the storage-free default. */ }
  return 'chart';
}

/** One renderer surface owns its view and follows its own native caret. */
export function createPlanViewHost({ host, container, planUid, origin, onChange = () => {} }) {
  const root = container.closest('.nautilus-log-container');
  const owner = root.closest('.roam-block-container');
  const graph = graphName(host), provider = host.roamAlphaAPI;
  const sidebar = isRightSidebarRenderContext(root);
  let storage;
  try { storage = host.localStorage; } catch (_) {}
  let mode = readPlanView(storage, graph, planUid, sidebar);
  let folded = nativePlanFolded(owner), closed = false, observer = null, controls = null;
  let callback = null, previous = '';
  const current = () => !closed && root.isConnected && provider === host.roamAlphaAPI && graph === graphName(host);
  function paint() {
    if (!current()) return;
    root.dataset.nautilusView = mode;
    root.dataset.nautilusNativeFolded = String(folded);
    const zh = root.dataset.nautilusLanguage === 'zh';
    const control = root.querySelector('.nautilus-log-desk-btn') || origin;
    if (control) {
      control.setAttribute('aria-checked', String(mode === 'chart'));
      control.setAttribute('aria-label', zh ? '图表视图' : 'Chart view');
      control.setAttribute('data-nautilus-tooltip', mode === 'chart'
        ? (zh ? '切换到列表' : 'Switch to list view') : (zh ? '切换到图表' : 'Switch to chart view'));
      const label = control.querySelector('.nautilus-log-view-label');
      if (label) label.textContent = mode === 'chart' ? (zh ? '图表' : 'Chart') : (zh ? '列表' : 'List');
    }
    const next = `${mode}:${folded}`;
    if (next !== previous) {
      previous = next;
      onChange({ mode, folded });
    }
    callback?.({ mode, folded });
  }
  function sync() {
    if (!current()) return;
    folded = nativePlanFolded(owner);
    const caret = ownCaret(owner);
    // A fallback parent can contain the renderer itself; watching it would
    // observe our own label paints. Only the native controls or caret are owned.
    const nativeControls = caret?.closest('.rm-block__controls') || caret;
    if (controls !== nativeControls) {
      controls = nativeControls;
      observer?.disconnect();
      if (owner) observer?.observe(owner, { attributes: true, attributeFilter: ['class'], childList: true });
      if (controls && controls !== owner) observer?.observe(controls, { attributes: true, attributeFilter: ['class'], childList: true, subtree: true });
    }
    paint();
  }
  if (typeof host.MutationObserver === 'function' && owner) {
    observer = new host.MutationObserver(sync);
    observer.observe(owner, { attributes: true, attributeFilter: ['class'], childList: true });
  }
  return {
    register(options = {}) {
      if (options.origin) origin = options.origin;
      if (typeof options.onViewChange === 'function') callback = options.onViewChange;
      sync();
    },
    setMode(next) {
      if (!current() || !MODES.has(next) || next === mode) return;
      mode = next;
      try { storage?.setItem(planViewStorageKey(graph, planUid, sidebar), mode); } catch (_) {}
      sync();
    },
    toggle() { this.setMode(mode === 'chart' ? 'list' : 'chart'); },
    destroy() { closed = true; observer?.disconnect(); callback = null; },
  };
}
