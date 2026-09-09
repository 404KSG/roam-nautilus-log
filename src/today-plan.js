import * as timingCore from './timing-core';
import { graphName } from './graph-context';
import {
  blockUidExists,
  createDailyPage,
  createGraphBlock,
  openPrimaryPlan,
  pageTitleFor,
  readDailyPageUid,
  readPrimaryPlan,
  showToast,
} from './timing-roam';

const OPERATION_KEY_PREFIX = 'nautilus-log:today-plan-operation:';
const REFERENCE_RE = /\(\(([A-Za-z0-9_-]{6,})\)\)/g;

const VISIBILITY_THROTTLE_MS = 1500;
const hostGlobal = () => (typeof window !== 'undefined' ? window : globalThis);
const copyFor = (language) => timingCore.executionCopy(language).createToday;

function fault(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function componentUid(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `nautilus-log-plan-${date.getFullYear()}-${month}-${day}`;
}

/**
 * One bounded, user-initiated writer for today's component. Background discovery
 * is read-only; timers never create graph content. Web Locks serialize this
 * extension's writers across tabs. If that capability is unavailable, creation
 * fails closed and the native ;; template remains available.
 */
export function createTodayPlanSession({
  extensionAPI,
  now = () => new Date(),
  buildComponentString,
  inspectTemplate = () => ({ kind: 'missing' }),
  freezeTemplate = () => ({ kind: 'missing' }),
  readTemplateTree = () => null,
  trackingEnabled = () => false,
  readTrackingSnapshot = () => null,
  requestTrackingRefresh,
  subscribeTracking,
  notify = showToast,
} = {}) {
  const host = hostGlobal();
  const schedule = host.setTimeout?.bind(host) || setTimeout;
  const cancel = host.clearTimeout?.bind(host) || clearTimeout;
  let destroyed = false;
  let initialized = false;
  let midnightTimer = null;
  let lastVisibilityDiscover = 0;
  let trackingUnsubscribe = null;
  let operation = null;
  let dayRecovery = null;
  let inspectedSnapshot = null;
  let inspectedTitle = '';
  let inspectedKind = null;
  // Retain an uncertain write's UID until it is confirmed. An explicit retry
  // checks that exact UID and never allocates a second block for the same intent.
  const intents = new Map();
  const listeners = new Set();
  let state = {
    status: 'checking', pageTitle: '', pageUid: null, planUid: null,
    templateKind: null, outcome: null, error: null,
  };

  const language = () => extensionAPI?.settings?.get?.('language') || 'en';
  const labels = () => copyFor(language());
  const operationKey = (target) => `${OPERATION_KEY_PREFIX}${encodeURIComponent(target.name)}:${target.pageTitle}`;
  const writeOperationRecord = async (target, intent) => {
    const set = extensionAPI?.settings?.set;
    if (typeof set !== 'function') throw fault('recordUnavailable');
    const record = {
      id: intent.id, pageTitle: target.pageTitle, rootUid: intent.uid,
      nodes: intent.nodes.map((node) => ({ uid: node.uid, parentUid: node.parentUid, order: node.order, fingerprint: node.fingerprint })),
    };
    await set(operationKey(target), JSON.stringify(record));
    if (extensionAPI?.settings?.get?.(operationKey(target)) !== JSON.stringify(record)) throw fault('recordUnavailable');
  };
  const clearOperationRecord = async (target) => {
    const set = extensionAPI?.settings?.set;
    if (typeof set === 'function') await set(operationKey(target), '');
  };
  const rewriteReferences = (string, mapping) => String(string).replace(REFERENCE_RE, (whole, uid) => (
    mapping.get(uid) ? `((${mapping.get(uid)}))` : whole
  ));
  const flattenTemplate = (root, rootUid, roam) => {
    const mapping = new Map([[root.uid, rootUid]]);
    const nodes = [];
    const allocate = () => {
      const uid = roam?.util?.generateUID?.();
      if (typeof uid !== 'string' || !uid) throw fault('apiUnavailable');
      return uid;
    };
    const reserve = (node) => {
      if (node !== root) mapping.set(node.uid, allocate());
      node.children.forEach(reserve);
    };
    reserve(root);
    const visit = (node, parentUid, order) => {
      const uid = mapping.get(node.uid);
      nodes.push({
        uid, parentUid, order, string: rewriteReferences(node.string, mapping),
        properties: { open: node.properties?.open ?? false, ...(node.properties || {}) }, sourceUid: node.uid,
      });
      node.children.forEach((child, index) => visit(child, uid, index));
    };
    visit(root, null, 0);
    return nodes;
  };
  // A compact non-reversible diagnostic checksum keeps private template strings
  // out of extension settings. Full text remains only in this operation's RAM.
  const nodeFingerprint = (node) => {
    const value = JSON.stringify({ string: node.string, properties: node.properties || {} });
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `f${(hash >>> 0).toString(36)}`;
  };
  const matchingCreatedNodes = (intent) => {
    const root = readTemplateTree(intent.uid);
    if (!root) return 0;
    const actual = [];
    const walk = (node, parentUid = null, order = 0) => {
      actual.push({ uid: node.uid, parentUid, order, fingerprint: nodeFingerprint(node) });
      (node.children || []).forEach((child, index) => walk(child, node.uid, index));
    };
    walk(root);
    let count = 0;
    while (count < actual.length && count < intent.nodes.length) {
      const node = actual[count];
      const expected = intent.nodes[count];
      if (node.uid !== expected.uid || node.parentUid !== expected.parentUid
        || node.order !== expected.order || node.fingerprint !== expected.fingerprint) return -1;
      count += 1;
    }
    return actual.length > intent.nodes.length ? -1 : count;
  };
  const matchesCreatedTree = (intent) => matchingCreatedNodes(intent) === intent.nodes.length;
  function getState() {
    const text = labels();
    return {
      ...state, labels: text, language: language(), trackingOn: Boolean(trackingEnabled()),
      message: state.error ? (text[state.error] || text.failed) : '',
    };
  }
  const setState = (patch) => {
    if (destroyed) return getState();
    const next = { ...state, ...patch };
    if (Object.keys(next).every((key) => next[key] === state[key])) return getState();
    state = next;
    const snapshot = getState();
    for (const listener of listeners) {
      try { listener(snapshot); }
      catch (error) { console.error('[Nautilus Log] today-plan listener failed', error); }
    }
    return snapshot;
  };
  const targetNow = () => {
    const date = new Date(now().getTime());
    const name = graphName(host);
    const pageTitle = pageTitleFor(date);
    return { date, name, pageTitle, roam: host.roamAlphaAPI, key: `${name}:${pageTitle}` };
  };
  const assertTarget = (target, { allowDateChange = false } = {}) => {
    if (destroyed) throw fault('destroyed');
    if (hostGlobal() !== host || host.roamAlphaAPI !== target.roam || graphName(host) !== target.name) {
      throw fault('graphChanged');
    }
    if (!allowDateChange && pageTitleFor(now()) !== target.pageTitle) throw fault('dateChanged');
  };
  const readTarget = (target, options) => {
    assertTarget(target, options);
    return readPrimaryPlan(target.date, Number(extensionAPI?.settings?.get?.('todo-duration')) || 15);
  };
  const fail = (error, { target, announce = false } = {}) => {
    if (destroyed || error?.code === 'destroyed' || error?.name === 'AbortError') return getState();
    if (state.status === 'partial') return getState();
    const code = error?.code && labels()[error.code] ? error.code : 'failed';
    const result = setState({
      status: 'read-failed', pageTitle: target?.pageTitle || state.pageTitle,
      pageUid: null, planUid: null, outcome: null, error: code,
    });
    if (announce && hostGlobal() === host) notify?.(result.message, 'warning');
    return result;
  };
  const present = (snapshot, extra = {}) => setState({
    status: 'ready-present', pageTitle: snapshot.pageTitle,
    pageUid: snapshot.pageUid || null, planUid: snapshot.plan?.uid || null,
    templateKind: null, outcome: null, error: null, ...extra,
  });
  const inspectKind = () => {
    const result = inspectTemplate() || {};
    const kind = result.kind;
    if (!['standard', 'custom', 'missing', 'unsupported'].includes(kind)) throw fault('failed');
    return kind;
  };
  const absent = (target, kind, reason = null) => setState({
    status: kind === 'custom' || kind === 'unsupported' ? 'ready-blocked' : 'ready-absent',
    pageTitle: target.pageTitle, pageUid: null, planUid: null, templateKind: kind,
    outcome: kind === 'custom' || kind === 'unsupported' ? 'blocked' : null,
    error: kind === 'custom' || kind === 'unsupported' ? 'blocked' : null, reason,
  });
  const blockTemplate = (target) => {
    const result = absent(target, 'custom');
    if (!destroyed) notify?.(labels().blocked, 'warning');
    return result;
  };
  const checking = (target) => setState({
    status: 'checking', pageTitle: target.pageTitle, pageUid: null, planUid: null,
    templateKind: null, outcome: null, error: null,
  });
  const fromTracking = (target, snapshot) => {
    if (snapshot?.status === 'error') return fail(fault('failed'), { target });
    const plan = snapshot?.planSnapshot;
    if (!snapshot || snapshot.status === 'loading' || !plan || plan.pageTitle !== target.pageTitle) {
      return checking(target);
    }
    if (plan.plan) return present(plan);
    if (snapshot.status === 'working') return checking(target);
    if (inspectedSnapshot !== plan || inspectedTitle !== target.pageTitle) {
      inspectedKind = inspectKind();
      inspectedSnapshot = plan;
      inspectedTitle = target.pageTitle;
    }
    return absent(target, inspectedKind);
  };
  const storedOperation = (target) => {
    const raw = extensionAPI?.settings?.get?.(operationKey(target));
    if (typeof raw !== 'string' || !raw) return null;
    try {
      const record = JSON.parse(raw);
      if (record?.pageTitle !== target.pageTitle || typeof record.rootUid !== 'string'
        || !Array.isArray(record.nodes) || record.nodes.some((node) => (
          typeof node?.uid !== 'string' || typeof node?.fingerprint !== 'string'
        ))) throw new Error('malformed');
      return { uid: record.rootUid, nodes: record.nodes };
    } catch (_error) { throw fault('recordUnavailable'); }
  };
  const recoverPartial = (target) => {
    const record = storedOperation(target);
    if (!record) return false;
    if (!matchesCreatedTree(record)) {
      setState({ status: 'partial', pageTitle: target.pageTitle, pageUid: readDailyPageUid(target.pageTitle), planUid: record.uid, error: 'partial' });
      return true;
    }
    void clearOperationRecord(target);
    return false;
  };
  const discover = ({ authoritative = false } = {}) => {
    if (destroyed || operation) return getState();
    let target;
    try {
      target = targetNow();
      // Settings recovery is bounded to initialization/foreground/explicit
      // discovery; tracking ticks take their existing snapshot fast path.
      if (authoritative || !trackingEnabled()) {
        if (recoverPartial(target)) return getState();
      }
      if (!authoritative && trackingEnabled()) return fromTracking(target, readTrackingSnapshot());
      const snapshot = readTarget(target);
      return snapshot.plan ? present(snapshot) : absent(target, inspectKind());
    } catch (error) { return fail(error, { target }); }
  };

  const openKnown = async (target, snapshot, locateMode) => {
    if (locateMode === 'none') return getState();
    assertTarget(target);
    try {
      await openPrimaryPlan(snapshot.plan.uid, { sidebar: locateMode === 'sidebar' });
      if (!destroyed) return setState({ status: 'ready-present', error: null });
    } catch (_error) {
      if (!destroyed) {
        const result = setState({ status: 'nav-failed', error: 'navFailed' });
        notify?.(result.message, 'warning');
      }
    }
    return getState();
  };
  const openTemplate = async ({ locateMode = 'main' } = {}) => {
    const target = targetNow();
    try {
      const frozen = freezeTemplate();
      if (!frozen.templateUid) throw fault('failed');
      await openPrimaryPlan(frozen.templateUid, { sidebar: locateMode === 'sidebar' });
      return getState();
    } catch (error) { return fail(error, { target, announce: true }); }
  };
  const locateToday = async ({ locateMode = 'main' } = {}) => {
    if (destroyed || operation) return getState();
    const target = targetNow();
    try {
      const snapshot = readTarget(target);
      if (!snapshot.plan) return absent(target, inspectKind());
      present(snapshot);
      return await openKnown(target, snapshot, locateMode);
    } catch (error) { return fail(error, { target, announce: true }); }
  };
  const finish = async (target, snapshot, locateMode, outcome) => {
    if (destroyed) return getState();
    assertTarget(target, { allowDateChange: true });
    intents.delete(target.key);
    if (pageTitleFor(now()) !== target.pageTitle) {
      return fail(fault('dateChangedAfterCreate'), { target: targetNow(), announce: true });
    }
    if (trackingEnabled() && typeof requestTrackingRefresh === 'function') {
      try { await requestTrackingRefresh({ immediate: true }); }
      catch (_error) { /* A confirmed graph write is not retried for a refresh failure. */ }
    }
    assertTarget(target);
    present(snapshot, { outcome });
    return openKnown(target, snapshot, locateMode);
  };
  const ensureLocked = async (target, locateMode) => {
    let snapshot = readTarget(target);
    const existingIntent = intents.get(target.key);
    if (snapshot.plan) {
      if (existingIntent?.attempted && !matchesCreatedTree(existingIntent)) {
        return setState({ status: 'partial', pageTitle: target.pageTitle, pageUid: snapshot.pageUid, planUid: existingIntent.uid, error: 'partial' });
      }
      return finish(target, snapshot, locateMode, 'located');
    }
    const frozen = freezeTemplate();
    if (frozen.kind === 'unsupported' || frozen.kind === 'custom'
      || (frozen.kind === 'missing' && inspectKind() === 'custom')) return blockTemplate(target);
    let root;
    let sourceFingerprint = null;
    if (frozen.kind === 'standard') {
      root = frozen.root;
      sourceFingerprint = frozen.fingerprint;
      if (!root || !sourceFingerprint) throw fault('failed');
    } else {
      // A graph without a managed template retains the historical empty-root
      // fallback. Installed templates always take the full frozen-tree path.
      if (typeof buildComponentString !== 'function') throw fault('failed');
      const string = await buildComponentString();
      if (!timingCore.isNautilusComponent(string)) throw fault('failed');
      root = { uid: '__fallback_root__', string, properties: { open: true }, children: [] };
    }
    assertTarget(target);
    snapshot = readTarget(target);
    if (snapshot.plan) return finish(target, snapshot, locateMode, 'located');
    const beforeWrite = freezeTemplate();
    if (frozen.kind === 'standard' && (beforeWrite.kind !== 'standard' || beforeWrite.fingerprint !== sourceFingerprint)) {
      throw fault('templateChanged');
    }
    if (beforeWrite.kind === 'unsupported' || beforeWrite.kind === 'custom') return blockTemplate(target);
    if (typeof target.roam?.data?.block?.create !== 'function' && typeof target.roam?.createBlock !== 'function') {
      throw fault('apiUnavailable');
    }
    let intent = intents.get(target.key);
    if (!intent) {
      const uid = componentUid(target.date);
      const nodes = flattenTemplate(root, uid, target.roam);
      intent = { uid, nodes, attempted: false, id: `${Date.now()}-${Math.random()}` };
      intent.nodes.forEach((node) => { node.fingerprint = nodeFingerprint(node); });
      intents.set(target.key, intent);
    }
    for (const node of intent.nodes) {
      if (blockUidExists(node.uid)) {
        if (matchesCreatedTree(intent)) {
          snapshot = readTarget(target, { allowDateChange: true });
          if (snapshot.plan) return finish(target, snapshot, locateMode, 'created');
        }
        throw fault(intent.attempted ? 'unconfirmed' : 'uidCollision');
      }
    }
    // Persist only opaque structural fingerprints, never template text. This is
    // a reload diagnostic, not a lock or an automatic recovery queue.
    if (frozen.kind === 'standard') await writeOperationRecord(target, intent);
    let pageUid = readDailyPageUid(target.pageTitle);
    if (!pageUid) {
      assertTarget(target);
      pageUid = await createDailyPage(target.pageTitle, target.date);
      assertTarget(target);
    }
    snapshot = readTarget(target);
    if (snapshot.plan) return finish(target, snapshot, locateMode, 'located');
    assertTarget(target);
    intent.attempted = true;
    let mutationError = null;
    for (const node of intent.nodes) {
      if (destroyed || hostGlobal() !== host || host.roamAlphaAPI !== target.roam || graphName(host) !== target.name) break;
      try {
        await createGraphBlock({
          parentUid: node.parentUid || pageUid, order: node.parentUid ? node.order : 'last',
          string: node.string, uid: node.uid, properties: node.properties,
        });
      } catch (error) { mutationError = error; break; }
    }
    if (destroyed) return getState();
    // A full tree match, not merely a visible renderer root, is the completion
    // criterion. Partial writes are intentionally retained for inspection.
    if (frozen.kind === 'standard' && !matchesCreatedTree(intent)) {
      setState({ status: 'partial', pageTitle: target.pageTitle, pageUid, planUid: intent.uid, error: 'partial' });
      throw mutationError || fault('partial');
    }
    snapshot = readTarget(target, { allowDateChange: true });
    if (!snapshot.plan) throw mutationError || fault('unconfirmed');
    if (frozen.kind === 'standard') await clearOperationRecord(target);
    return finish(target, snapshot, locateMode, snapshot.plan.uid === intent.uid ? 'created' : 'located');
  };
  const ensureToday = ({ locateMode = 'main' } = {}) => {
    if (destroyed) return Promise.resolve(getState());
    if (operation) return operation.promise;
    const target = targetNow();
    const controller = new AbortController();
    const current = { controller, promise: null };
    operation = current;
    // Start after assigning the shared promise, so subscriber re-entry cannot
    // create a second writer or receive a not-yet-assigned promise.
    current.promise = Promise.resolve().then(async () => {
      if (recoverPartial(target)) return getState();
      setState({ status: 'creating', pageTitle: target.pageTitle, outcome: null, error: null });
      const snapshot = readTarget(target);
      if (snapshot.plan) return finish(target, snapshot, locateMode, 'located');
      if (inspectKind() === 'custom') return blockTemplate(target);
      if (!target.name) throw fault('scopeUnavailable');
      const locks = host.navigator?.locks;
      if (typeof locks?.request !== 'function') throw fault('lockUnavailable');
      return locks.request(
        `nautilus-log:today-plan:${encodeURIComponent(target.name)}:${target.pageTitle}`,
        { mode: 'exclusive', signal: controller.signal },
        () => ensureLocked(target, locateMode),
      );
    }).catch((error) => fail(error, { target, announce: true })).finally(() => {
      if (operation === current) operation = null;
    });
    return current.promise;
  };

  const clearMidnight = () => {
    if (midnightTimer !== null) cancel(midnightTimer);
    midnightTimer = null;
  };
  const recoverDate = () => {
    discover();
    if (destroyed || operation || dayRecovery || !trackingEnabled() || !requestTrackingRefresh) return;
    if (readTrackingSnapshot()?.planSnapshot?.pageTitle === pageTitleFor(now())) return;
    dayRecovery = Promise.resolve().then(() => {
      if (!destroyed) return requestTrackingRefresh({ immediate: true });
      return null;
    }).then(() => { if (!destroyed) discover(); })
      .catch((error) => fail(error))
      .finally(() => { dayRecovery = null; });
  };
  const scheduleMidnight = () => {
    clearMidnight();
    if (destroyed) return;
    const current = now();
    const next = new Date(current.getFullYear(), current.getMonth(), current.getDate() + 1);
    midnightTimer = schedule(() => {
      midnightTimer = null;
      if (!destroyed) { recoverDate(); scheduleMidnight(); }
    }, Math.max(50, next.getTime() - current.getTime()));
  };
  const onVisibility = () => {
    if (destroyed || (host.document?.visibilityState && host.document.visibilityState !== 'visible')) return;
    const stamp = Date.now();
    if (stamp - lastVisibilityDiscover < VISIBILITY_THROTTLE_MS) return;
    lastVisibilityDiscover = stamp;
    recoverDate();
    scheduleMidnight();
  };
  const initialize = () => {
    if (destroyed) return false;
    trackingUnsubscribe?.();
    trackingUnsubscribe = typeof subscribeTracking === 'function'
      ? subscribeTracking((snapshot) => {
        if (destroyed || operation || !trackingEnabled()) return;
        try { fromTracking(targetNow(), snapshot); }
        catch (error) { fail(error); }
      }) : null;
    if (!initialized) {
      initialized = true;
      host.document?.addEventListener?.('visibilitychange', onVisibility);
      host.addEventListener?.('focus', onVisibility);
    }
    scheduleMidnight();
    discover();
    return true;
  };
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    operation?.controller.abort();
    clearMidnight();
    host.document?.removeEventListener?.('visibilitychange', onVisibility);
    host.removeEventListener?.('focus', onVisibility);
    trackingUnsubscribe?.();
    trackingUnsubscribe = null;
    listeners.clear();
    intents.clear();
  };
  const subscribe = (listener) => {
    if (destroyed || typeof listener !== 'function') return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  return { discover, ensureToday, locateToday, openTemplate, getState, subscribe, initialize, destroy };
}
