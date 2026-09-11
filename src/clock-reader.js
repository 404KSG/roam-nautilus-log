import { readEntriesForTaskUids } from './timing-roam';
import { graphName } from './graph-context';

/** Scoped CLOCK cache. An empty runtime array proves absence only for covered owners. */
export function createRendererClockReader({
  read: readOwners = readEntriesForTaskUids,
  getSnapshot = () => null,
  getScope = () => {
    const host = typeof window !== 'undefined' ? window : globalThis;
    return [host.roamAlphaAPI, graphName(host)];
  },
  now = Date.now,
  ttlMs = 15000,
  maxOwners = 256,
} = {}) {
  const cache = new Map();
  let previousScope = [], previousEntries = null;
  const clear = () => { cache.clear(); previousEntries = null; };
  const read = (taskUids = []) => {
    const scope = getScope();
    if (scope[0] !== previousScope[0] || scope[1] !== previousScope[1]) clear();
    previousScope = scope;
    const snapshot = getSnapshot();
    if (snapshot?.entries !== previousEntries) {
      cache.clear();
      previousEntries = snapshot?.entries;
    }
    const instant = now();
    for (const [uid, value] of cache) if (instant - value.at >= ttlMs) cache.delete(uid);
    const uids = [...new Set(taskUids.filter(uid => typeof uid === 'string' && uid))];
    const covered = new Set(snapshot?.status !== 'error' ? snapshot?.entryTaskUids || [] : []);
    const byOwner = new Map();
    for (const entry of snapshot?.entries || []) {
      if (!covered.has(entry.taskUid)) continue;
      if (!byOwner.has(entry.taskUid)) byOwner.set(entry.taskUid, []);
      byOwner.get(entry.taskUid).push(entry);
    }
    const missing = uids.filter(uid => !covered.has(uid) && !cache.has(uid));
    if (missing.length) {
      try {
        const entries = readOwners(missing);
        if (!Array.isArray(entries)) throw new Error('CLOCK owners returned unreadable data.');
        for (const uid of missing) cache.set(uid, { at: instant, entries: entries.filter(entry => entry.taskUid === uid) });
      } catch (error) {
        console.debug('[Nautilus Log] CLOCK render snapshot unavailable', error);
      }
    }
    const result = uids.flatMap(uid => {
      if (covered.has(uid)) return byOwner.get(uid) || [];
      const cached = cache.get(uid);
      if (!cached) return [];
      cache.delete(uid);cache.set(uid, cached);
      return cached.entries;
    });
    while (cache.size > Math.max(1, maxOwners)) cache.delete(cache.keys().next().value);
    return result;
  };
  return { read, clear, size: () => cache.size };
}
