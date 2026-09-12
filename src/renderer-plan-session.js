import { graphName } from './graph-context';

function defaultGetProvider() {
  const host = typeof window !== 'undefined' ? window : globalThis;
  const data = host?.nautilusLogExtensionData;
  return {
    running: Boolean(data?.running),
    subscribe: data?.watchPlan,
    generation: data?.watchGeneration ?? data?.lifecycleGeneration ?? 0,
    graphApi: host?.roamAlphaAPI,
    graphName: graphName(host),
  };
}

function snapshotChildren(snapshot) {
  return Array.isArray(snapshot?.['block/children']) ? snapshot['block/children'] : [];
}

function childSignature(child) {
  if (!child || typeof child !== 'object') return [child];
  return [
    child['block/uid'],
    child['block/string'],
    child['block/order'],
    (Array.isArray(child['block/refs']) ? child['block/refs'] : []).map((ref) => [
      ref?.['block/uid'],
      ref?.['block/string'],
    ]),
    (Array.isArray(child['block/children']) ? child['block/children'] : []).map(childSignature),
  ];
}

function stateSignature(state) {
  return JSON.stringify({
    status: state.status,
    writesAllowed: state.writesAllowed,
    planUid: state.planUid,
    children: (state.children || []).map(childSignature),
  });
}

function providerPresent(provider) {
  return provider?.running !== false && typeof provider?.subscribe === 'function';
}

/**
 * Renderer-owned Plan subscription. Detects watch-bridge identity / generation
 * and graph scope so a chart that does not remount can drop the previous
 * listener. Unavailable pulls keep same-target last-good data; a confirmed
 * missing pull clears. Temporary errors disable Tidy/Calendar writes.
 */
export function createRendererPlanSession({
  planUid: initialPlanUid = '',
  getPlanUid = () => initialPlanUid,
  getProvider = defaultGetProvider,
} = {}) {
  const listeners = new Set();
  let destroyed = false;
  let syncing = false;
  let bindToken = 0;
  let stopWatch = null;
  let boundSubscribe = null;
  let boundGeneration = null;
  let boundGraphApi = null;
  let boundGraphName = null;
  let boundUid = null;
  let children = [];
  let status = 'unbound';
  let writesAllowed = false;
  let lastGood = null;
  let lastSignature = '';

  const getState = () => ({
    children,
    status,
    writesAllowed: destroyed ? false : writesAllowed,
    stale: status === 'stale',
    planUid: getPlanUid(),
  });

  const emit = () => {
    const next = getState();
    const signature = stateSignature(next);
    if (signature === lastSignature) return;
    lastSignature = signature;
    for (const listener of [...listeners]) {
      try { listener(next); }
      catch (error) { console.error('[Nautilus Log] renderer plan subscriber failed', error); }
    }
  };

  const sameTargetLastGood = () => (
    lastGood
    && lastGood.planUid === boundUid
    && lastGood.graphApi === boundGraphApi
    && lastGood.graphName === boundGraphName
  );

  const adoptUnavailable = () => {
    if (sameTargetLastGood()) {
      children = lastGood.children;
      status = 'stale';
      writesAllowed = false;
      return;
    }
    children = [];
    status = 'unavailable';
    writesAllowed = false;
  };

  const bindingMatchesProvider = (provider, planUid) => (
    boundSubscribe === provider.subscribe
    && boundGeneration === (provider.generation ?? 0)
    && boundGraphApi === provider.graphApi
    && boundGraphName === (provider.graphName ?? '')
    && boundUid === planUid
  );

  const applySnapshot = (snapshot, token) => {
    if (destroyed || token !== bindToken) return;
    const provider = getProvider() || {};
    const planUid = getPlanUid();
    if (!providerPresent(provider) || !bindingMatchesProvider(provider, planUid)) {
      const sameScope = boundGraphApi === provider.graphApi
        && boundGraphName === (provider.graphName ?? '')
        && boundUid === planUid;
      writesAllowed = false;
      if (!sameScope) clearScopeData();
      else if (status === 'ready') status = 'stale';
      emit();
      return;
    }
    if (snapshot == null || snapshot.unavailable === true) {
      adoptUnavailable();
      emit();
      return;
    }
    if (snapshot.missing === true) {
      lastGood = null;
      children = [];
      status = 'missing';
      writesAllowed = false;
      emit();
      return;
    }
    const nextChildren = snapshotChildren(snapshot);
    children = nextChildren;
    lastGood = {
      children: nextChildren,
      planUid: boundUid,
      graphApi: boundGraphApi,
      graphName: boundGraphName,
    };
    status = 'ready';
    writesAllowed = true;
    emit();
  };

  const unbind = () => {
    bindToken += 1;
    const stop = stopWatch;
    stopWatch = null;
    boundSubscribe = null;
    if (typeof stop !== 'function') return;
    try { stop(); }
    catch (error) { console.debug('[Nautilus Log] renderer plan watch cleanup failed', error); }
  };

  const bind = (provider) => {
    const token = ++bindToken;
    const planUid = getPlanUid();
    boundSubscribe = provider.subscribe;
    boundGeneration = provider.generation ?? 0;
    boundGraphApi = provider.graphApi;
    boundGraphName = provider.graphName ?? '';
    boundUid = planUid;
    let stop = null;
    try {
      stop = provider.subscribe(planUid, (snapshot) => applySnapshot(snapshot, token));
    } catch (error) {
      console.debug('[Nautilus Log] renderer plan watch unavailable', error);
      if (token === bindToken && !destroyed) adoptUnavailable();
      return;
    }
    if (destroyed || token !== bindToken) {
      if (typeof stop === 'function') {
        try { stop(); } catch (_error) { /* the replacement bind owns the target */ }
      }
      return;
    }
    stopWatch = typeof stop === 'function' ? stop : () => {};
  };

  const clearScopeData = () => {
    lastGood = null;
    children = [];
    status = 'unbound';
    writesAllowed = false;
  };

  const sync = () => {
    if (destroyed) return getState();
    if (syncing) return getState();
    syncing = true;
    try {
      const provider = getProvider() || {};
      const planUid = getPlanUid();
      const present = providerPresent(provider);
      const nextGeneration = provider.generation ?? 0;
      const nextGraphApi = provider.graphApi;
      const nextGraphName = provider.graphName ?? '';
      const hadBinding = boundUid != null;
      const scopeChanged = hadBinding && (
        boundGraphApi !== nextGraphApi
        || boundGraphName !== nextGraphName
        || boundUid !== planUid
      );
      if (scopeChanged) clearScopeData();

      if (!present) {
        if (stopWatch || boundSubscribe) unbind();
        boundGeneration = nextGeneration;
        boundGraphApi = nextGraphApi;
        boundGraphName = nextGraphName;
        boundUid = planUid;
        if (sameTargetLastGood()) {
          children = lastGood.children;
          status = 'stale';
          writesAllowed = false;
        } else if (!lastGood) {
          children = [];
          status = 'unbound';
          writesAllowed = false;
        }
        emit();
        return getState();
      }

      const sameIdentity = boundSubscribe === provider.subscribe
        && boundGeneration === nextGeneration
        && boundGraphApi === nextGraphApi
        && boundGraphName === nextGraphName
        && boundUid === planUid
        && stopWatch;
      if (sameIdentity) return getState();

      unbind();
      bind(provider);
      emit();
      return getState();
    } finally {
      syncing = false;
    }
  };

  const subscribe = (listener) => {
    if (destroyed || typeof listener !== 'function') return () => {};
    listeners.add(listener);
    try { listener(getState()); }
    catch (error) { console.error('[Nautilus Log] renderer plan subscriber failed', error); }
    return () => listeners.delete(listener);
  };

  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    unbind();
    writesAllowed = false;
    listeners.clear();
  };

  return { sync, subscribe, destroy, getState };
}
