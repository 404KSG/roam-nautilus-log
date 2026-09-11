import { graphName } from './graph-context';

/** Browser-local mutual exclusion plus a frozen host/graph lifecycle. */
export function createGraphWriteGuard(resource) {
  const host = typeof window !== 'undefined' ? window : globalThis;
  const roam = host.roamAlphaAPI, scope = graphName(host);
  const controllers = new Set();
  let destroyed = false;
  const assertActive = () => {
    if (destroyed) throw new Error('Graph operation was cancelled.');
    if (host.roamAlphaAPI !== roam || graphName(host) !== scope) throw new Error('The graph changed; the operation was cancelled.');
  };
  const run = async (operation, { signal } = {}) => {
    assertActive();
    const locks = host.navigator?.locks;
    if (!scope || typeof locks?.request !== 'function') {
      throw new Error('Safe graph writes require a known graph and Web Locks.');
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    controllers.add(controller);
    if (signal?.aborted) abort();
    signal?.addEventListener('abort', abort, { once: true });
    try {
      return await locks.request(`nautilus-log:${resource}:${encodeURIComponent(scope)}`,
        { mode:'exclusive', signal:controller.signal }, () => {
          assertActive();
          if (controller.signal.aborted) throw new Error('Graph operation was cancelled.');
          return operation();
        });
    } finally {
      signal?.removeEventListener('abort', abort);
      controllers.delete(controller);
    }
  };
  const destroy = () => { destroyed = true; for (const controller of controllers) controller.abort(); controllers.clear(); };
  return { run, assertActive, destroy, scope };
}
