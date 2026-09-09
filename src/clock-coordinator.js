import { graphName } from './graph-context';

/** Browser-local serialization, not a distributed lock across Roam clients. */
export function createClockCoordinator({ onChange = () => {} } = {}) {
  const host = typeof window !== 'undefined' ? window : globalThis;
  const roam = host.roamAlphaAPI;
  const graph = graphName(host);
  const name = `nautilus-log:clock:${encodeURIComponent(graph)}`;
  const controller = new AbortController();
  let destroyed = false;
  let channel = null;

  const assertCurrent = () => {
    if (destroyed) throw new Error('Actual Time Tracking is no longer active.');
    const currentHost = typeof window !== 'undefined' ? window : globalThis;
    if (currentHost !== host || host.roamAlphaAPI !== roam || graphName(host) !== graph) {
      throw new Error('The graph changed. Reload Actual Time Tracking before continuing.');
    }
  };
  const run = (operation) => {
    assertCurrent();
    const locks = (host.navigator || globalThis.navigator)?.locks;
    if (!graph || typeof locks?.request !== 'function') {
      return Promise.reject(new Error('Safe cross-tab CLOCK coordination is unavailable. A known graph and Web Locks are required.'));
    }
    return locks.request(name, { mode: 'exclusive', signal: controller.signal }, async () => {
      assertCurrent();
      return operation();
    });
  };
  const start = () => {
    assertCurrent();
    if (channel || !graph || typeof host.BroadcastChannel !== 'function') return;
    try {
      channel = new host.BroadcastChannel(name);
      channel.onmessage = (event) => {
        if (destroyed || graphName(host) !== graph || host.roamAlphaAPI !== roam) return;
        const uids = event.data?.taskUids;
        if (event.data?.type !== 'clock-changed' || !Array.isArray(uids)) return;
        // Messages are invalidation hints only. All data comes from a fresh
        // graph read, never from another tab's claimed CLOCK or task text.
        onChange(uids.filter((uid) => typeof uid === 'string' && /^[\w-]{1,200}$/.test(uid)).slice(0, 100));
      };
    } catch (error) {
      console.debug('[Nautilus Log] CLOCK notifications unavailable', error);
    }
  };
  const notify = (taskUids) => {
    if (destroyed || !channel) return;
    try { channel.postMessage({ type: 'clock-changed', taskUids: [...new Set(taskUids)].slice(0, 100) }); }
    catch (error) { console.debug('[Nautilus Log] CLOCK notification failed', error); }
  };
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    controller.abort();
    if (channel) channel.onmessage = null;
    channel?.close();
    channel = null;
  };
  return { run, start, notify, assertCurrent, destroy };
}
