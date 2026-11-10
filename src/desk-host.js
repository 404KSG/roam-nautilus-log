const HIDDEN = 'data-nautilus-desk-hidden';
const claims = new WeakMap();

/** Only a graph/plan UID and the view flag are persisted; never task text. */
export function createDeskPreferences(host) {
  const fallback = new Map();
  const key = (graph, uid) => `nautilus-log:desk-view:v1:${encodeURIComponent(graph)}:${encodeURIComponent(uid)}`;
  return {
    read(graph, uid) {
      if (!graph || !uid) return false;
      const id = key(graph, uid);
      if (fallback.has(id)) return fallback.get(id) === true;
      try {
        const value = host.localStorage.getItem(id);
        if (value === 'true' || value === null) return value === 'true';
        return false;
      } catch (_error) { return fallback.get(id) === true; }
    },
    write(graph, uid, enabled) {
      if (!graph || !uid) return false;
      const id = key(graph, uid);
      fallback.set(id, enabled);
      try {
        if (enabled) host.localStorage.setItem(id, 'true');
        else host.localStorage.removeItem(id);
        return true;
      } catch (_error) { return false; }
    },
  };
}

/** Hide only this renderer's sibling outline, not the native editor or other plans. */
export function createDeskOutlineVisibility(container, host = window) {
  const owner = container.closest('.roam-block-container');
  const token = {};
  const marked = new Set();
  let observer = null;
  let hidden = false;
  const release = (node) => {
    const owners = claims.get(node);
    owners?.delete(token);
    if (!owners?.size) { node.removeAttribute(HIDDEN); claims.delete(node); }
    marked.delete(node);
  };
  const scan = () => {
    observer?.disconnect();
    if (!hidden || !owner) return;
    const children = new Set([...owner.children].filter((node) => node.classList.contains('rm-block-children')));
    for (const node of marked) if (!children.has(node)) release(node);
    for (const node of children) {
      let owners = claims.get(node);
      if (!owners) { owners = new Set(); claims.set(node, owners); }
      owners.add(token);
      marked.add(node);
      if (node.getAttribute(HIDDEN) !== 'true') node.setAttribute(HIDDEN, 'true');
    }
    if (observer) {
      observer.observe(owner, { childList: true });
      // A retired extension bundle has its own claim map and may finish its
      // native cleanup later. Reassert only this live owner's visibility flag;
      // never observe descendants or keep watches on replaced outline nodes.
      for (const node of children) observer.observe(node, { attributes: true, attributeFilter: [HIDDEN] });
    }
  };
  const setHidden = (value) => {
    hidden = value;
    observer?.disconnect();
    observer = null;
    if (!value) { for (const node of [...marked]) release(node); return; }
    if (owner && typeof host.MutationObserver === 'function') observer = new host.MutationObserver(scan);
    scan();
  };
  return { setHidden, destroy: () => setHidden(false), foundOwner: Boolean(owner) };
}
