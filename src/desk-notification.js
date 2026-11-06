/** Host Blueprint notifications owned by one Nautilus Desk view. */
const TIMEOUT_MS = 3000;
const MAX_TOASTS = 3;

export function createDeskNotifications({ host = globalThis.window, document = host?.document } = {}) {
  let destroyed = false;
  let toaster = null;
  let container = null;
  const recent = new Map();

  const forget = (key) => {
    const record = recent.get(key);
    if (!record) return;
    if (record.timer !== null) host?.clearTimeout?.(record.timer);
    recent.delete(key);
  };
  const clearRecent = () => { for (const key of [...recent.keys()]) forget(key); };
  const fail = () => {
    const currentToaster = toaster;
    const currentContainer = container;
    toaster = null;
    container = null;
    clearRecent();
    try { currentToaster?.clear?.(); } catch (_error) { /* Only this owned toaster may be cleared. */ }
    // Blueprint's public create API mounts a React root inside our container.
    // Detaching that container alone leaves the owned root mounted.
    const mount = currentContainer?.firstElementChild || currentContainer?.children?.[0];
    try { host?.ReactDOM?.unmountComponentAtNode?.(mount); } catch (_error) { /* The host may not expose ReactDOM. */ }
    currentContainer?.remove?.();
  };
  const ensure = () => {
    if (destroyed) return null;
    if (toaster?.show && container?.isConnected) return toaster;
    if (toaster || container) fail();
    const core = host?.Blueprint?.Core;
    if (!core?.Toaster || typeof core.Toaster.create !== 'function' || !document?.body?.append) return null;
    const owned = document.createElement?.('div');
    if (!owned) return null;
    owned.className = 'nautilus-desk__toaster';
    owned.dataset.nautilusDeskToaster = 'true';
    try {
      document.body.append(owned);
      container = owned;
      // This is a dedicated host Toaster, not the host's shared queue. Blueprint
      // creates its own non-portal surface in the supplied owned container.
      toaster = core.Toaster.create({
        position: core.Position?.TOP || 'top', timeout: TIMEOUT_MS,
        autoFocus: false, canEscapeKeyClear: false, maxToasts: MAX_TOASTS,
      }, owned);
      if (!toaster || typeof toaster.show !== 'function') { fail(); return null; }
      return toaster;
    } catch (_error) { fail(); return null; }
  };
  const notify = ({ key, message, intent }) => {
    if (destroyed || typeof message !== 'string' || !message) return { native: false };
    const stableKey = typeof key === 'string' && key ? key : `nautilus-desk:${intent}:${message}`;
    const instance = ensure();
    if (!instance) return { native: false };
    if (recent.has(stableKey)) return { native: true, deduped: true };
    try {
      // Blueprint's public show(options, key) deliberately overwrites
      // options.key, so the receipt identity belongs in its second argument.
      instance.show({ message, intent, timeout: TIMEOUT_MS }, stableKey);
      const record = { timer: null };
      record.timer = host?.setTimeout?.(() => {
        if (recent.get(stableKey) === record) recent.delete(stableKey);
      }, TIMEOUT_MS) ?? null;
      recent.set(stableKey, record);
      while (recent.size > MAX_TOASTS) forget(recent.keys().next().value);
      return { native: true };
    } catch (_error) {
      fail();
      return { native: false };
    }
  };
  return { notify, destroy() { if (destroyed) return; destroyed = true; for (const key of [...recent.keys()]) forget(key); fail(); } };
}

export { MAX_TOASTS, TIMEOUT_MS };
