export function findSearchSurface(topbar) {
  const known = topbar?.querySelector?.('.rm-find-or-create-wrapper, .rm-find-or-create');
  if (known) return known;
  const input = [...(topbar?.querySelectorAll?.('input') || [])]
    .find((node) => /find|create|search/i.test(node.getAttribute('placeholder') || ''));
  return input?.closest?.('.bp3-input-group') || input?.parentElement || input || null;
}

export function createTopbarRecovery({ getContainer, mount, syncDensity, observeContainer = false }) {
  let host;
  let search;
  let parent;
  let observers = [];
  let timer = null;
  let destroyed = false;
  let attemptedMount = false;

  const disconnect = () => {
    observers.forEach(observer => observer.disconnect());
    observers = [];
  };

  const schedule = () => {
    if (destroyed || timer !== null) return;
    // Let rendering and input run between observer deliveries.
    timer = setTimeout(() => {
      timer = null;
      recover();
    }, 0);
  };

  const watch = () => {
    disconnect();
    if (typeof MutationObserver !== 'function') return;
    if (!host) {
      if (!document.body) return;
      const bootObserver = new MutationObserver(() => {
        if (document.querySelector('.rm-topbar')) schedule();
      });
      bootObserver.observe(document.body, { childList: true, subtree: true });
      observers.push(bootObserver);
      return;
    }
    const hostObserver = new MutationObserver(records => {
      const container = getContainer();
      if (records.some(record => !container?.contains(record.target))) schedule();
    });
    hostObserver.observe(host, { childList: true, subtree: true });
    observers.push(hostObserver);
    if (parent) {
      const shellObserver = new MutationObserver(schedule);
      shellObserver.observe(parent, { childList: true });
      observers.push(shellObserver);
    }
    if (typeof ResizeObserver === 'function') {
      const resizeObserver = new ResizeObserver(syncDensity);
      resizeObserver.observe(host);
      if (search) resizeObserver.observe(search);
      const container = getContainer();
      if (observeContainer && container) resizeObserver.observe(container);
      observers.push(resizeObserver);
    }
  };

  const recover = () => {
    if (destroyed || typeof document === 'undefined') return;
    const nextHost = document.querySelector('.rm-topbar');
    const nextSearch = findSearchSurface(nextHost);
    const nextParent = nextHost?.parentElement || null;
    const changed = nextHost !== host || nextSearch !== search || nextParent !== parent;
    if (changed) {
      host = nextHost;
      search = nextSearch;
      parent = nextParent;
      attemptedMount = false;
    }
    if (host?.contains(getContainer())) {
      attemptedMount = false;
      syncDensity();
    } else if (host && !attemptedMount) {
      // Verify on the next task. If another observer immediately ejects the
      // node, wait for a new host/search surface or a stable attachment.
      attemptedMount = true;
      mount();
      schedule();
    }
    if (changed) watch();
  };

  return {
    recover,
    destroy() {
      destroyed = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      disconnect();
    },
  };
}
