const { REVISION, BRIDGE_KEY, inspectRenderer } = require('./renderer-contract');
const LEGACY_BRAND = Symbol.for('nautilus-log:legacy-facade-owner');
const LEGACY_PROVIDER = Symbol.for('nautilus-log:legacy-read-provider-v1');

/** Version-local service ownership. A legacy facade may render history but
 * never closes a host or popover registered by the current renderer. */
function installRendererBridge({ host, core, taskCore, services = {}, getScope = () => ({}), canMutatePlan = () => false } = {}) {
  if (!host || (host[BRIDGE_KEY] && host[BRIDGE_KEY].revision !== REVISION)) {
    throw new Error('The renderer bridge slot is occupied by an unsupported version. Reload the matching client.');
  }
  const owner = {}, scope = { ...getScope() }, hosts = new WeakMap(), anchors = new WeakMap(), sessions = new Set();
  let alive = true, ready = false;
  const sameScope = () => {
    try { const current = getScope(); return Object.keys(scope).every(key => current[key] === scope[key]); }
    catch (_) { return false; }
  };
  const bridge = { revision: REVISION, ownerId: owner, running: true, ready: false, status: 'loading', core, taskCore, watchGeneration: owner };
  const active = () => alive && host?.[BRIDGE_KEY] === bridge && sameScope();
  const root = node => node?.closest?.('[data-nautilus-renderer]');
  const newerHost = node => {
    const revision = Number(root(node)?.getAttribute?.('data-nautilus-renderer'));
    return Number.isFinite(revision) && revision > 1;
  };
  const container = options => options?.container || options?.origin?.closest?.('.nautilus-log-container')?.querySelector?.('.nautilus-desk-host');
  const object = value => value !== null && (typeof value === 'object' || typeof value === 'function');
  const validHost = (node, family) => object(node) && active() && ready
    && (family !== 'current' || !root(node) || Number(root(node).getAttribute?.('data-nautilus-renderer')) === REVISION)
    && !(family === 'legacy' && (newerHost(node) || hosts.get(node) === 'current'));
  const register = (options, family, open) => {
    const node = container(options);
    if (!validHost(node, family)) return false;
    const previous = hosts.get(node);
    if (previous && previous !== family) services.closeDeskHost?.(node);
    hosts.set(node, family);
    return open ? services.openDesk?.({ ...options, container: node }) : services.registerDeskHost?.({ ...options, container: node });
  };
  const close = (node, family) => {
    if (!active() || !object(node) || hosts.get(node) !== family || (family === 'legacy' && newerHost(node))) return;
    hosts.delete(node); return services.closeDeskHost?.(node);
  };
  const toggleHelp = (options, family) => {
    const anchor = options?.anchor;
    if (!active() || !ready || !object(anchor)
      || (family === 'current' && root(anchor) && Number(root(anchor).getAttribute?.('data-nautilus-renderer')) !== REVISION)
      || (family === 'legacy' && (newerHost(anchor) || anchors.get(anchor) === 'current'))) return false;
    anchors.set(anchor, family); return services.toggleChartHelp?.(options);
  };
  const closeHelp = (anchor, family) => {
    if (!active() || !object(anchor) || anchors.get(anchor) !== family || (family === 'legacy' && newerHost(anchor))) return;
    anchors.delete(anchor); return services.closeChartHelp?.(anchor);
  };
  const mutate = (name, options, family) => {
    if (!active() || !ready || !canMutatePlan(options?.planUid, family)) {
      return Promise.reject(new Error('This renderer cannot safely change the selected plan. Update or reload this client.'));
    }
    return services[name]?.(options);
  };
  const providerFor = family => {
    let current = {};
    try { current = getScope(); } catch (_) {}
    return { running: active() && (ready || family === 'legacy'), readOnly: !ready,
      subscribe: services.watchPlan, generation: owner,
      graphApi: current.provider, graphName: current.graph || '' };
  };
  const session = (options, family) => {
    const value = services.createRendererPlanSession?.({ ...options,
      canWriteSnapshot: snapshot => {
        const identity = inspectRenderer(snapshot?.['block/string'] ?? snapshot?.[':block/string'] ?? snapshot?.string);
        return identity.mutable && (family === 'legacy' ? identity.kind === 'legacy' : identity.kind === 'current');
      }, getProvider: () => {
        if (family !== 'legacy') return providerFor(family);
        // v1 CLJS retains its original session across extension reloads. Its
        // read adapter may follow a compatible facade in the same graph/user;
        // r2 sessions remain bound to this exact owner.
        const provider = host.nautilusLogExtensionData?.[LEGACY_PROVIDER];
        return sameScope() && typeof provider === 'function' ? provider() : { running:false };
      } });
    if (!value || family === 'legacy') return value;
    const destroy = value.destroy.bind(value);
    value.destroy = () => { sessions.delete(value); destroy(); };
    sessions.add(value); return value;
  };
  function facade(family) {
    const result = { running: true, settings: {}, watchGeneration: owner,
      createRendererPlanSession: options => session(options, family),
      openDesk: options => register(options, family, true),
      registerDeskHost: options => register(options, family, false),
      closeDeskHost: node => close(node, family),
      toggleChartHelp: options => toggleHelp(options, family),
      closeChartHelp: node => closeHelp(node, family),
      syncCalendarPlan: options => mutate('syncCalendarPlan', options, family),
    };
    for (const key of ['shouldSuppressRenderContext','isRightSidebarRenderContext','getClockRenderContext','resolveTaskInstance','readPlan','watchPlan','locatePlanTask']) {
      if (services[key]) result[key] = (...args) => active() ? services[key](...args) : undefined;
    }
    return result;
  }
  Object.assign(bridge, facade('current'));
  bridge.togglePlanView = options => {
    const node = container(options);
    if (!validHost(node, 'current')) return false;
    hosts.set(node, 'current');
    return services.togglePlanView?.({ ...options, container: node });
  };
  const legacy = facade('legacy');
  Object.defineProperty(legacy, LEGACY_BRAND, { value: bridge });
  Object.defineProperty(legacy, LEGACY_PROVIDER, { value: () => providerFor('legacy') });
  const previous = host[BRIDGE_KEY];
  host[BRIDGE_KEY] = bridge;
  // A cold/reloaded r2-only client still supplies the historical renderer's
  // read services. Replace our own prior facade, never another active package.
  const installLegacy = !host.nautilusLogExtensionData || host.nautilusLogExtensionData.running === false
    || Boolean(previous && host.nautilusLogExtensionData[LEGACY_BRAND] === previous);
  if (installLegacy) {
    host.nautilusLogExtensionData = legacy;
    host.nautilusLogCore = core;
    host.nautilusLogTaskCore = taskCore;
  }
  return {
    bridge, legacy: installLegacy ? legacy : null,
    owns: active,
    publish(settings, timingEnabled) {
      if (!active()) return;
      bridge.settings = settings;
      if (timingEnabled !== undefined) bridge.timingEnabled = timingEnabled;
      if (host.nautilusLogExtensionData === legacy) {
        legacy.settings = settings;
        if (timingEnabled !== undefined) legacy.timingEnabled = timingEnabled;
      }
    },
    setReady(value, error = '') {
      if (!active()) return;
      ready = value === true; bridge.ready = ready; bridge.status = ready ? 'ready' : 'blocked'; bridge.error = error;
      // History remains available during a blocked upgrade. Its mutation
      // callbacks still require ready and verified plan identity.
    },
    destroy() {
      if (!alive) return;
      for (const value of [...sessions]) value.destroy();
      alive = false; ready = false; bridge.running = false; legacy.running = false;
      if (host[BRIDGE_KEY] === bridge) delete host[BRIDGE_KEY];
      if (host.nautilusLogExtensionData === legacy) legacy.timingEnabled = false;
      // Preserve static read helpers; a later owner may still use them. No
      // foreign bridge/global is deleted or marked stopped.
    },
  };
}
module.exports = { installRendererBridge };
