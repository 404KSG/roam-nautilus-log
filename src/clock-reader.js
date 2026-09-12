import { readEntriesForTaskUids } from './timing-roam';
import { graphName } from './graph-context';

function coverageSet(snapshot) {
  if (!snapshot || snapshot.status === 'error') return null;
  return new Set((snapshot.entryTaskUids || []).filter((uid) => typeof uid === 'string' && uid));
}

function sameCoverage(left, right) {
  if (left === right) return true;
  if (!left || !right || left.size !== right.size) return false;
  for (const uid of left) {
    if (!right.has(uid)) return false;
  }
  return true;
}

function clockInstant(value) {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value == null) return null;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : String(value);
}

function sameClockFields(previous, next) {
  return previous?.taskUid === next?.taskUid
    && clockInstant(previous?.start) === clockInstant(next?.start)
    && clockInstant(previous?.end) === clockInstant(next?.end)
    && Boolean(previous?.running) === Boolean(next?.running);
}

function entryClockKey(entry, index) {
  return typeof entry?.clockUid === 'string' && entry.clockUid
    ? entry.clockUid
    : `__index:${index}`;
}

/** Owners whose CLOCK identity or certified coverage actually changed. */
export function changedClockOwners(previous, next) {
  const owners = new Set();
  const prevEntries = Array.isArray(previous?.entries) ? previous.entries : [];
  const nextEntries = Array.isArray(next?.entries) ? next.entries : [];
  const prevCoverage = coverageSet(previous);
  const nextCoverage = coverageSet(next);
  const sameEntries = Boolean(previous && next && previous.entries === next.entries);
  if (sameEntries && sameCoverage(prevCoverage, nextCoverage)) return [];

  const prevByClock = new Map();
  prevEntries.forEach((entry, index) => {
    prevByClock.set(entryClockKey(entry, index), entry);
  });
  const nextByClock = new Map();
  nextEntries.forEach((entry, index) => {
    nextByClock.set(entryClockKey(entry, index), entry);
  });

  for (const [clockUid, prev] of prevByClock) {
    const current = nextByClock.get(clockUid);
    if (!current) {
      if (prev?.taskUid) owners.add(prev.taskUid);
      continue;
    }
    if (prev?.taskUid !== current?.taskUid) {
      if (prev?.taskUid) owners.add(prev.taskUid);
      if (current?.taskUid) owners.add(current.taskUid);
      continue;
    }
    if (!sameClockFields(prev, current) && prev?.taskUid) owners.add(prev.taskUid);
  }
  for (const [clockUid, current] of nextByClock) {
    if (!prevByClock.has(clockUid) && current?.taskUid) owners.add(current.taskUid);
  }

  if (prevCoverage && nextCoverage) {
    for (const uid of prevCoverage) {
      if (!nextCoverage.has(uid)) owners.add(uid);
    }
    for (const uid of nextCoverage) {
      if (!prevCoverage.has(uid)) owners.add(uid);
    }
  } else if (!prevCoverage && nextCoverage) {
    for (const uid of nextCoverage) owners.add(uid);
  }

  return [...owners].filter((uid) => typeof uid === 'string' && uid);
}

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
  let previousScope = [];

  const clear = () => {
    cache.clear();
  };

  const invalidate = (taskUids = []) => {
    const list = Array.isArray(taskUids) ? taskUids : [taskUids];
    for (const uid of list) {
      if (typeof uid === 'string' && uid) cache.delete(uid);
    }
  };

  const read = (taskUids = []) => {
    const scope = getScope();
    if (scope[0] !== previousScope[0] || scope[1] !== previousScope[1]) clear();
    previousScope = scope;

    const snapshot = getSnapshot();
    const instant = now();
    for (const [uid, value] of cache) {
      if (instant - value.at >= ttlMs) cache.delete(uid);
    }

    const uids = [...new Set((Array.isArray(taskUids) ? taskUids : [])
      .filter((uid) => typeof uid === 'string' && uid))];
    if (!uids.length) return [];

    // Coverage is explicit owner certification, not "entries happened to be an array".
    const covered = new Set(snapshot?.status !== 'error' ? snapshot?.entryTaskUids || [] : []);
    const byOwner = new Map();
    for (const entry of snapshot?.entries || []) {
      if (!covered.has(entry.taskUid)) continue;
      if (!byOwner.has(entry.taskUid)) byOwner.set(entry.taskUid, []);
      byOwner.get(entry.taskUid).push(entry);
    }

    const missing = uids.filter((uid) => !covered.has(uid) && !cache.has(uid));
    if (missing.length) {
      try {
        const entries = readOwners(missing);
        if (!Array.isArray(entries)) throw new Error('CLOCK owners returned unreadable data.');
        for (const uid of missing) {
          cache.set(uid, {
            at: instant,
            entries: entries.filter((entry) => entry.taskUid === uid),
          });
        }
      } catch (error) {
        console.debug('[Nautilus Log] CLOCK render snapshot unavailable', error);
      }
    }

    const result = uids.flatMap((uid) => {
      if (covered.has(uid)) return byOwner.get(uid) || [];
      const cached = cache.get(uid);
      if (!cached) return [];
      cache.delete(uid);
      cache.set(uid, cached);
      return cached.entries;
    });

    const limit = Math.max(1, maxOwners);
    while (cache.size > limit) cache.delete(cache.keys().next().value);
    return result;
  };

  return { read, clear, invalidate, size: () => cache.size };
}
