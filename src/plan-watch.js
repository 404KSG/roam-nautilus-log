const PLAN_PULL_PATTERN = '[:block/string {:block/children [:block/uid :block/string :block/order {:block/refs [:block/uid :block/string]}]}]';

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

function entityLookup(uid) {
  return `[:block/uid "${String(uid || '').replace(/["\\]/g, '')}"]`;
}

/**
 * Deduplicates Roam Pull Watches by plan UID. Rendered copies in the main
 * window and right sidebar share one graph watch, while each subscriber gets
 * the same normalized direct-child snapshot. This is event driven: no DOM
 * observer and no high-frequency graph polling are required.
 */
export function createPlanWatchBridge({ roam = globalThis.window?.roamAlphaAPI } = {}) {
  const watches = new Map();
  let destroyed = false;

  const read = (uid) => {
    if (!uid) return normalizePlanPull(null, uid);
    const pull = roam?.data?.pull || roam?.pull;
    if (typeof pull !== 'function') return normalizePlanPull(null, uid);
    const owner = pull === roam?.data?.pull ? roam.data : roam;
    try {
      return normalizePlanPull(pull.call(owner, PLAN_PULL_PATTERN, [':block/uid', uid]), uid);
    } catch (error) {
      console.debug('[Nautilus Log] Plan snapshot pull unavailable', error);
      return normalizePlanPull(null, uid);
    }
  };

  const remove = (uid, entry) => {
    if (!entry || entry.removing) return entry?.removing;
    watches.delete(uid);
    const removePullWatch = roam?.data?.removePullWatch;
    if (typeof removePullWatch !== 'function' || !entry.registered) return undefined;
    entry.removing = Promise.resolve(entry.registered)
      .then(() => removePullWatch.call(roam.data, PLAN_PULL_PATTERN, entityLookup(uid), entry.callback))
      .catch((error) => console.debug('[Nautilus Log] Plan Pull Watch cleanup failed', error));
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
        registered: null,
        removing: null,
      };
      entry.callback = (_before, after) => {
        if (destroyed || watches.get(uid) !== entry) return;
        const snapshot = after ? normalizePlanPull(after, uid) : read(uid);
        entry.snapshot = snapshot;
        for (const subscriber of [...entry.listeners]) {
          try { subscriber(snapshot); }
          catch (error) { console.error('[Nautilus Log] Plan subscriber failed', error); }
        }
      };
      watches.set(uid, entry);
      const addPullWatch = roam?.data?.addPullWatch;
      if (typeof addPullWatch === 'function') {
        try {
          entry.registered = Promise.resolve(
            addPullWatch.call(roam.data, PLAN_PULL_PATTERN, entityLookup(uid), entry.callback),
          ).catch((error) => console.debug('[Nautilus Log] Plan Pull Watch unavailable', error));
        } catch (error) {
          console.debug('[Nautilus Log] Plan Pull Watch unavailable', error);
        }
      }
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

export { PLAN_PULL_PATTERN };
