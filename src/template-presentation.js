import { REVISION } from './renderer-contract';
import { graphName } from './graph-context';

const OWNER = Symbol.for('nautilus-log:template-presentation-owner');
const ATTRIBUTE = 'data-nautilus-template-view';
const WATCH_PATTERN = '[:block/string :block/order :block/page :block/children {:block/_children [:block/uid]}]';
const ANCHOR = 'roam-render-Nautilus-Log';
const scope = host => {
  let user = '';
  try { user = host.roamAlphaAPI?.user?.uid?.() || ''; } catch (_) {}
  return { provider: host.roamAlphaAPI, graph: graphName(host), user };
};

function metadataWatch(host, uid, callback) {
  const data = host.roamAlphaAPI?.data;
  if (typeof data?.addPullWatch !== 'function' || typeof data?.removePullWatch !== 'function') return () => {};
  const lookup = `[:block/uid ${JSON.stringify(uid)}]`;
  const listener = () => callback();
  let registered;
  try { registered = Promise.resolve(data.addPullWatch(WATCH_PATTERN, lookup, listener)); }
  catch (_) { return () => {}; }
  // Removal waits for a late registration, including when a renderer unmounts
  // before the host finishes adding the watch.
  let removed = false;
  registered.catch(() => {});
  return () => {
    if (removed) return;
    removed = true;
    registered.then(() => data.removePullWatch(WATCH_PATTERN, lookup, listener)).catch(() => {});
  };
}

/** A presentation-only distinction for the verified managed template. It never
 * changes task data, source text, planning settings, or the running timer. */
export function createTemplatePresentation({ host = globalThis.window || globalThis,
  resolveIdentity = () => null, getLanguage = () => 'en', isActive = () => true,
  watch = (uid, callback) => metadataWatch(host, uid, callback),
} = {}) {
  const initial = scope(host), token = {}, entries = new Map(), watches = new Map();
  let alive = true, queued = false, identity = null;
  const active = () => {
    const current = scope(host);
    return alive && isActive() && ['provider','graph','user'].every(key => initial[key] === current[key]);
  };
  const removeCaption = entry => {
    if (entry.caption?.[OWNER] === token) entry.caption.remove();
    entry.caption = null;
  };
  const release = entry => {
    if (entry.closed) return;
    entry.closed = true;
    entry.observer?.disconnect();
    removeCaption(entry);
    if (entry.root[OWNER] === token) {
      entry.root.removeAttribute(ATTRIBUTE);
      delete entry.root[OWNER];
    }
    if (entries.get(entry.container) === entry) entries.delete(entry.container);
  };
  const clearForeignCaptions = parent => {
    for (const node of parent?.querySelectorAll?.(':scope > .nautilus-log-template-caption') || []) {
      if (node[OWNER] && node[OWNER] !== token) node.remove();
    }
  };
  const paint = entry => {
    if (entry.closed) return;
    const { root, container, uid } = entry;
    if (!active() || !root.isConnected || container.parentElement !== root || root[OWNER] !== token
      || root.getAttribute('data-nautilus-log-block') !== uid
      || root.getAttribute('data-nautilus-renderer') !== String(REVISION)) {
      release(entry); return;
    }
    const ownsTemplate = identity?.renderUid === uid;
    root.toggleAttribute(ATTRIBUTE, ownsTemplate);
    const parent = root.querySelector(':scope > .nautilus-log-shell > .nautilus-log-header > .nautilus-log-header-copy');
    clearForeignCaptions(parent);
    if (!ownsTemplate || !parent) { removeCaption(entry); return; }
    if (entry.caption?.parentElement !== parent) {
      removeCaption(entry);
      const caption = host.document.createElement('div');
      caption.className = 'nautilus-log-template-caption';caption[OWNER] = token;
      const title = host.document.createElement('strong'), detail = host.document.createElement('span');
      caption.append(title, detail);parent.append(caption);entry.caption = caption;
    }
    const zh = getLanguage() === 'zh';
    const [title, detail] = entry.caption.children;
    const nextTitle = zh ? '模板预览' : 'Template preview';
    const nextDetail = zh ? '固定内容，用于新建日计划' : 'Default content for new plans';
    if (title.textContent !== nextTitle) title.textContent = nextTitle;
    if (detail.textContent !== nextDetail) detail.textContent = nextDetail;
  };
  const syncWatches = () => {
    const wanted = entries.size ? new Set([ANCHOR, identity?.templateUid, identity?.renderUid].filter(Boolean)) : new Set();
    for (const [uid, stop] of watches) if (!wanted.has(uid)) { stop();watches.delete(uid); }
    for (const uid of wanted) if (!watches.has(uid)) {
      watches.set(uid, () => {});
      try { watches.set(uid, watch(uid, refresh) || (() => {})); } catch (_) { /* read-only fallback: refresh on registration/settings */ }
    }
  };
  function reconcile() {
    if (!active()) { destroy(); return; }
    if (!entries.size) { syncWatches(); return; }
    try { identity = resolveIdentity(); }
    catch (_) { /* Keep only this scope's previously verified presentation. */ }
    for (const entry of [...entries.values()]) paint(entry);
    syncWatches();
  }
  function refresh() {
    if (!alive || queued) return;
    queued = true;
    Promise.resolve().then(() => { queued = false;if (alive) reconcile(); });
  }
  const register = ({ container, planUid } = {}) => {
    if (!active() || !container || !planUid) return false;
    const root = container.parentElement;
    if (!root?.classList?.contains('nautilus-log-container')
      || !container.classList?.contains('nautilus-log-desk-host')
      || root.getAttribute('data-nautilus-log-block') !== planUid
      || root.getAttribute('data-nautilus-renderer') !== String(REVISION)) return false;
    let entry = entries.get(container);
    if (entry && (entry.root !== root || entry.uid !== planUid)) { release(entry);entry = null; }
    if (!entry) {
      entry = { root, container, uid: planUid, caption: null, observer: null, closed: false };
      entries.set(container, entry);root[OWNER] = token;
      if (typeof host.MutationObserver === 'function') {
        entry.observer = new host.MutationObserver(() => { paint(entry);syncWatches(); });
        entry.observer.observe(root, { childList: true, attributes: true,
          attributeFilter: ['data-nautilus-log-block','data-nautilus-renderer'] });
      }
    } else if (root[OWNER] !== token) {
      release(entry);return false;
    }
    refresh();return true;
  };
  const close = container => {
    const entry = entries.get(container);
    if (entry) release(entry);
    syncWatches();
  };
  function destroy() {
    if (!alive) return;
    alive = false;
    for (const entry of [...entries.values()]) release(entry);
    for (const stop of watches.values()) stop();
    watches.clear();
  }
  return { register, close, refresh, destroy };
}
