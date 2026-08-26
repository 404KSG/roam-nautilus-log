const PLAN_PULL_PATTERN = '[:block/string {:block/children [:block/uid :block/string :block/order {:block/refs [:block/uid :block/string]}]}]';
const PLAN_MEMBERSHIP_WATCH_PATTERN = '[:block/children]';
const CHILD_WATCH_PATTERN = '[:block/string :block/order]';
const SOURCE_WATCH_PATTERN = '[:block/string]';
const BLOCK_REF_RE = /\(\(([a-zA-Z0-9_-]{6,})\)\)/g;

function sequence(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || typeof value === 'string') return [];
  try {
    if (typeof value[Symbol.iterator] === 'function') return [...value];
  } catch (_error) {
    // Fall through to array-like values returned by older Roam builds.
  }
  return Number.isInteger(value?.length) && value.length >= 0 ? Array.from(value) : [];
}

function field(entity, name, fallback = null) {
  if (!entity) return fallback;
  const plain = name.replace(/^:/, '');
  return entity[name] ?? entity[`:${plain}`] ?? entity[plain] ?? entity[plain.replace('block/', '')] ?? fallback;
}

function normalizeReference(reference) {
  return {
    'block/uid': String(field(reference, ':block/uid', '') || ''),
    'block/string': String(field(reference, ':block/string', '') || ''),
  };
}

function normalizeChild(child) {
  return {
    'block/uid': String(field(child, ':block/uid', '') || ''),
    'block/string': String(field(child, ':block/string', '') || ''),
    'block/order': Number(field(child, ':block/order', 0)) || 0,
    'block/refs': sequence(field(child, ':block/refs', [])).map(normalizeReference),
  };
}

export function normalizePlanPull(entity, uid = '') {
  return {
    'block/uid': String(field(entity, ':block/uid', uid) || uid || ''),
    'block/string': String(field(entity, ':block/string', '') || ''),
    'block/children': sequence(field(entity, ':block/children', [])).map(normalizeChild),
  };
}

function hydratePlanReferences(snapshot, readString, { authoritative = false } = {}) {
  if (!snapshot || typeof readString !== 'function') return snapshot;
  const sourceCache = new Map();
  const readSource = (uid) => {
    if (!sourceCache.has(uid)) {
      try {
        const value = readString(uid);
        sourceCache.set(uid, typeof value === 'string' ? value : '');
      } catch (error) {
        console.debug('[Nautilus Log] Referenced Plan source unavailable', error);
        sourceCache.set(uid, '');
      }
    }
    return sourceCache.get(uid);
  };
  return {
    ...snapshot,
    'block/children': (snapshot['block/children'] || []).map((child) => {
      const references = child['block/refs'] || [];
      const byUid = new Map(references
        .filter((reference) => reference?.['block/uid'])
        .map((reference) => [reference['block/uid'], reference]));
      const localReferenceUids = [...String(child['block/string'] || '')
        .matchAll(new RegExp(BLOCK_REF_RE.source, BLOCK_REF_RE.flags))]
        .map((match) => match[1])
        .filter(Boolean);
      for (const sourceUid of localReferenceUids) {
        const current = byUid.get(sourceUid);
        if (!authoritative && current?.['block/string']) continue;
        const sourceString = readSource(sourceUid);
        if (!sourceString) continue;
        byUid.set(sourceUid, {
          'block/uid': sourceUid,
          'block/string': sourceString,
        });
      }
      return {
        ...child,
        'block/refs': [...byUid.values()],
      };
    }),
  };
}

function entityLookup(uid) {
  return `[:block/uid "${String(uid || '').replace(/["\\]/g, '')}"]`;
}

function referencedUids(snapshot, readString, maxDepth = 8) {
  const result = new Set();
  const supplied = new Map();
  for (const child of snapshot?.['block/children'] || []) {
    for (const reference of child?.['block/refs'] || []) {
      const uid = reference?.['block/uid'];
      if (uid) supplied.set(uid, String(reference?.['block/string'] || ''));
    }
  }
  const sourceCache = new Map(supplied);
  const sourceString = (uid) => {
    if (sourceCache.has(uid)) return sourceCache.get(uid);
    let value = '';
    try { value = typeof readString === 'function' ? readString(uid) : ''; }
    catch (_error) { value = ''; }
    sourceCache.set(uid, typeof value === 'string' ? value : '');
    return sourceCache.get(uid);
  };
  const visit = (string, stack = []) => {
    if (stack.length >= maxDepth) return;
    for (const match of string.matchAll(new RegExp(BLOCK_REF_RE.source, BLOCK_REF_RE.flags))) {
      const uid = match[1];
      if (!uid || stack.includes(uid)) continue;
      result.add(uid);
      const nested = sourceString(uid);
      if (nested) visit(nested, [...stack, uid]);
    }
  };
  for (const child of snapshot?.['block/children'] || []) {
    visit(String(child?.['block/string'] || ''));
  }
  return result;
}

/**
 * Deduplicates Roam Pull Watches by plan UID. Rendered copies in the main
 * window and right sidebar share one graph watch, while each subscriber gets
 * the same normalized direct-child snapshot. This is event driven: no DOM
 * observer and no high-frequency graph polling are required.
 */
export function createPlanWatchBridge({
  roam = globalThis.window?.roamAlphaAPI,
  readString,
} = {}) {
  const watches = new Map();
  let destroyed = false;
  const hasAuthoritativeReader = typeof readString === 'function';

  const readReferencedString = hasAuthoritativeReader
    ? readString
    : (uid) => {
      const pull = roam?.data?.pull || roam?.pull;
      if (!uid || typeof pull !== 'function') return '';
      const owner = pull === roam?.data?.pull ? roam.data : roam;
      const entity = pull.call(owner, SOURCE_WATCH_PATTERN, [':block/uid', uid]);
      return String(field(entity, ':block/string', '') || '');
    };

  const addWatch = (pattern, uid, callback) => {
    const addPullWatch = roam?.data?.addPullWatch;
    if (!uid || typeof addPullWatch !== 'function') return null;
    const watch = { pattern, uid, callback, registered: null, removing: null };
    try {
      watch.registered = Promise.resolve(
        addPullWatch.call(roam.data, pattern, entityLookup(uid), callback),
      ).catch((error) => console.debug('[Nautilus Log] Plan Pull Watch unavailable', error));
    } catch (error) {
      console.debug('[Nautilus Log] Plan Pull Watch unavailable', error);
    }
    return watch;
  };

  const removeWatch = (watch) => {
    if (!watch || watch.removing) return watch?.removing;
    const removePullWatch = roam?.data?.removePullWatch;
    if (typeof removePullWatch !== 'function' || !watch.registered) return undefined;
    watch.removing = Promise.resolve(watch.registered)
      .then(() => removePullWatch.call(roam.data, watch.pattern, entityLookup(watch.uid), watch.callback))
      .catch((error) => console.debug('[Nautilus Log] Plan Pull Watch cleanup failed', error));
    return watch.removing;
  };

  const read = (uid) => {
    if (!uid) return normalizePlanPull(null, uid);
    const pull = roam?.data?.pull || roam?.pull;
    if (typeof pull !== 'function') return normalizePlanPull(null, uid);
    const owner = pull === roam?.data?.pull ? roam.data : roam;
    try {
      const snapshot = normalizePlanPull(
        pull.call(owner, PLAN_PULL_PATTERN, [':block/uid', uid]),
        uid,
      );
      return hydratePlanReferences(snapshot, readReferencedString, {
        authoritative: hasAuthoritativeReader,
      });
    } catch (error) {
      console.debug('[Nautilus Log] Plan snapshot pull unavailable', error);
      return normalizePlanPull(null, uid);
    }
  };

  const syncEntityWatches = (uid, entry) => {
    const refresh = () => {
      if (destroyed || watches.get(uid) !== entry) return;
      const snapshot = read(uid);
      entry.snapshot = snapshot;
      syncEntityWatches(uid, entry);
      for (const subscriber of [...entry.listeners]) {
        try { subscriber(snapshot); }
        catch (error) { console.error('[Nautilus Log] Plan subscriber failed', error); }
      }
    };
    const sync = (watchMap, targetUids, pattern) => {
      for (const [targetUid, watch] of [...watchMap]) {
        if (targetUids.has(targetUid)) continue;
        watchMap.delete(targetUid);
        void removeWatch(watch);
      }
      for (const targetUid of targetUids) {
        if (watchMap.has(targetUid)) continue;
        const watch = addWatch(pattern, targetUid, refresh);
        if (watch) watchMap.set(targetUid, watch);
      }
    };
    const childUids = new Set((entry.snapshot?.['block/children'] || [])
      .map((child) => child?.['block/uid'])
      .filter(Boolean));
    sync(entry.childWatches, childUids, CHILD_WATCH_PATTERN);
    sync(entry.sourceWatches, referencedUids(entry.snapshot, readReferencedString), SOURCE_WATCH_PATTERN);
  };

  const remove = (uid, entry) => {
    if (!entry || entry.removing) return entry?.removing;
    watches.delete(uid);
    const entityWatches = [entry.parentWatch, ...entry.childWatches.values(), ...entry.sourceWatches.values()]
      .filter(Boolean);
    entry.childWatches.clear();
    entry.sourceWatches.clear();
    entry.removing = Promise.all(entityWatches.map((watch) => removeWatch(watch))).catch((error) => {
      console.debug('[Nautilus Log] Plan Pull Watch cleanup failed', error);
    });
    return entry.removing;
  };

  const subscribe = (uid, listener, { emitInitial = true } = {}) => {
    if (destroyed || !uid || typeof listener !== 'function') return () => {};
    let entry = watches.get(uid);
    if (!entry) {
      entry = {
        listeners: new Set(),
        callback: null,
        snapshot: read(uid),
        parentWatch: null,
        childWatches: new Map(),
        sourceWatches: new Map(),
        removing: null,
      };
      entry.callback = () => {
        if (destroyed || watches.get(uid) !== entry) return;
        // A parent pull watch reliably reports membership changes, but Roam
        // does not consistently invalidate it when only a nested child's
        // string changes. Always read a fresh authoritative snapshot and keep
        // direct child/source watches in sync with the latest membership.
        const snapshot = read(uid);
        entry.snapshot = snapshot;
        syncEntityWatches(uid, entry);
        for (const subscriber of [...entry.listeners]) {
          try { subscriber(snapshot); }
          catch (error) { console.error('[Nautilus Log] Plan subscriber failed', error); }
        }
      };
      watches.set(uid, entry);
      entry.parentWatch = addWatch(PLAN_MEMBERSHIP_WATCH_PATTERN, uid, entry.callback);
      syncEntityWatches(uid, entry);
    }
    entry.listeners.add(listener);
    if (emitInitial) listener(entry.snapshot);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      entry.listeners.delete(listener);
      if (entry.listeners.size === 0) void remove(uid, entry);
    };
  };

  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    for (const [uid, entry] of [...watches]) {
      entry.listeners.clear();
      void remove(uid, entry);
    }
  };

  return {
    read,
    subscribe,
    destroy,
    getWatchCount: () => watches.size,
  };
}

export {
  CHILD_WATCH_PATTERN,
  PLAN_MEMBERSHIP_WATCH_PATTERN,
  PLAN_PULL_PATTERN,
  SOURCE_WATCH_PATTERN,
};
