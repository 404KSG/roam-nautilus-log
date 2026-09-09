import * as timingCore from './timing-core';
import {
  blockUidExists,
  createDailyPage,
  createGraphBlock,
  generateUID,
  openPrimaryPlan,
  pageTitleFor,
  readDailyPageUid,
  readPrimaryPlan,
  showToast,
} from './timing-roam';

const VISIBILITY_THROTTLE_MS = 1500;
const hostGlobal = () => (typeof window !== 'undefined' ? window : globalThis);
const copyFor = (language) => timingCore.executionCopy(language).createToday;

function graphName(host) {
  const name = host.roamAlphaAPI?.graph?.name;
  if (typeof name === 'string' && name) return name;
  const match = String(host.location?.hash || '').match(/^#\/app\/([^/?#]+)/);
  if (!match) return '';
  try { return decodeURIComponent(match[1]); } catch (_error) { return ''; }
}

function fault(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function allocateComponentUid() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const uid = generateUID();
    if (uid && !blockUidExists(uid)) return uid;
  }
  throw fault('uidCollision');
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
    const kind = inspectTemplate()?.kind;
    if (!['standard', 'custom', 'missing'].includes(kind)) throw fault('failed');
    return kind;
  };
  const absent = (target, kind) => setState({
    status: kind === 'custom' ? 'ready-blocked' : 'ready-absent',
    pageTitle: target.pageTitle, pageUid: null, planUid: null, templateKind: kind,
    outcome: null, error: kind === 'custom' ? 'blocked' : null,
  });
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
  const discover = ({ authoritative = false } = {}) => {
    if (destroyed || operation) return getState();
    let target;
    try {
      target = targetNow();
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
    if (snapshot.plan) return finish(target, snapshot, locateMode, 'located');
    if (inspectKind() === 'custom') return absent(target, 'custom');
    if (typeof buildComponentString !== 'function') throw fault('failed');
    const string = await buildComponentString();
    assertTarget(target);
    if (!timingCore.isNautilusComponent(string)) throw fault('failed');
    // Preparation may yield to user edits. Check the target and template again
    // before the first page/block write, including after every awaited mutation.
    snapshot = readTarget(target);
    if (snapshot.plan) return finish(target, snapshot, locateMode, 'located');
    if (inspectKind() === 'custom') return absent(target, 'custom');
    let intent = intents.get(target.key);
    if (!intent) {
      intent = { uid: allocateComponentUid(), attempted: false };
      intents.set(target.key, intent);
    }
    if (blockUidExists(intent.uid)) throw fault(intent.attempted ? 'unconfirmed' : 'uidCollision');
    let pageUid = readDailyPageUid(target.pageTitle);
    if (!pageUid) {
      assertTarget(target);
      pageUid = await createDailyPage(target.pageTitle, target.date);
      assertTarget(target);
    }
    snapshot = readTarget(target);
    if (snapshot.plan) return finish(target, snapshot, locateMode, 'located');
    if (blockUidExists(intent.uid)) throw fault(intent.attempted ? 'unconfirmed' : 'uidCollision');
    assertTarget(target);
    intent.attempted = true;
    let mutationError = null;
    try {
      await createGraphBlock({ parentUid: pageUid, order: 'last', string, open: true, uid: intent.uid });
    } catch (error) { mutationError = error; }
    if (destroyed) return getState();
    // Use the frozen date, not a fresh now(), even if midnight passed in-flight.
    snapshot = readTarget(target, { allowDateChange: true });
    if (!snapshot.plan) throw mutationError || fault('unconfirmed');
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
      setState({ status: 'creating', pageTitle: target.pageTitle, outcome: null, error: null });
      const snapshot = readTarget(target);
      if (snapshot.plan) return finish(target, snapshot, locateMode, 'located');
      if (inspectKind() === 'custom') return absent(target, 'custom');
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
  return { discover, ensureToday, locateToday, getState, subscribe, initialize, destroy };
}
