/* Observe bounded, trusted native completion gestures. No graph-wide observer,
 * native event interception, or timestamp writes from passive graph changes. */
import * as core from './completion-stamp-core';

const UID_RE = /^[A-Za-z0-9_-]{6,128}$/;
const WATCH_DELAYS = [0, 50, 150, 400, 800, 1300, 1900, 2400];
const PHASE_TIMEOUT_MS = 2500;
const phaseBudget = value => Number.isFinite(value) && value > 0 ? Math.min(PHASE_TIMEOUT_MS, value) : PHASE_TIMEOUT_MS;
const MAX_PENDING = 64;

function publicPull(host, uid) {
  const roam = host?.roamAlphaAPI, pull = roam?.data?.pull || roam?.pull;
  if (typeof pull !== 'function') return null;
  try {
    const entity = pull.call(pull === roam?.data?.pull ? roam.data : roam,
      '[:block/uid :block/string]', [':block/uid', uid]);
    const actual = entity?.[':block/uid'] ?? entity?.['block/uid'] ?? entity?.uid;
    const string = entity?.[':block/string'] ?? entity?.['block/string'] ?? entity?.string;
    return actual === uid && typeof string === 'string' ? { uid, string } : null;
  } catch (_error) { return null; }
}

const uidFromNativeId = core.nativeUid;
function blockUidFromMain(main) {
  if (!main?.querySelectorAll) return null;
  const nodes = [...main.querySelectorAll('.rm-block-input[id], .roam-block[id]')]
    .filter(node => node.closest?.('.rm-block-main') === main);
  return nodes.length === 1 ? uidFromNativeId(nodes[0].id) : null;
}

function resolveCheckboxTarget(target) {
  const label = target?.closest?.('label.check-container');
  const inputs = label?.querySelectorAll?.('input[type="checkbox"]');
  if (!label || inputs?.length !== 1 || inputs[0].disabled) return null;
  const reference = label.closest?.('.rm-block-ref[data-uid]');
  if (reference) {
    const uid = reference.getAttribute?.('data-uid') ?? reference.dataset?.uid;
    return typeof uid === 'string' && UID_RE.test(uid) ? { uid } : null;
  }
  const uid = blockUidFromMain(label.closest?.('.rm-block-main'));
  return uid ? { uid } : null;
}

function resolveKeyboardTargets(target, document) {
  // An unrelated text field must not borrow a selection behind a dialog.
  if (target?.tagName === 'TEXTAREA' || target?.tagName === 'INPUT' || target?.isContentEditable === true) {
    const uid = uidFromNativeId(target.id); return uid ? [uid] : [];
  }
  const directNode = target?.closest?.('.rm-block-input[id], .roam-block[id]');
  if (directNode && !uidFromNativeId(directNode.id)) return [];
  const selected = [...(document?.querySelectorAll?.('.block-highlight-blue') || [])];
  const selectionSurface = target === document?.body || target === document
    || Boolean(target?.closest?.('.roam-body,.roam-article,.rm-sidebar-window,.nautilus-desk__focus-layer'));
  if (selected.length && selectionSurface) {
    if (selected.length > 20) return [];
    // Resolve each selected root, never all of its unselected descendants.
    const ids = selected.map(root => uidFromNativeId(root.id)
      || blockUidFromMain(root.matches?.('.rm-block-main') ? root : root.querySelector?.(':scope > .rm-block-main')));
    return ids.every(Boolean) ? [...new Set(ids)] : [];
  }
  const direct = uidFromNativeId(directNode?.id);
  return direct ? [direct] : [];
}

function trustedClick(event) {
  // A label's default action emits an input click too. Own only that input
  // event, including a trusted Space/accessibility click, to avoid double intent.
  return event?.isTrusted === true && (event.button === undefined || event.button === 0)
    && event.target?.matches?.('input[type="checkbox"]')
    && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey;
}
function trustedShortcut(event) {
  return event?.isTrusted === true && event.key === 'Enter' && (event.ctrlKey || event.metaKey)
    && !event.altKey && !event.shiftKey && !event.repeat && !event.isComposing && event.keyCode !== 229;
}
function undoGesture(event) {
  return event?.isTrusted === true && (event.ctrlKey || event.metaKey) && !event.altKey
    && ['z', 'y'].includes(String(event.key || '').toLowerCase());
}

export function createCompletionStampAdapter({ writer, host = globalThis.window || globalThis,
  document = host?.document, now = () => new Date(), read = uid => publicPull(host, uid),
  observationTimeoutMs = PHASE_TIMEOUT_MS, preparationTimeoutMs = PHASE_TIMEOUT_MS,
  monotonicNow = () => host?.performance?.now?.() ?? globalThis.performance?.now?.() ?? Date.now(),
} = {}) {
  let destroyed = false, listening = false, epoch = 0, sequence = 0;
  const observationBudget = phaseBudget(observationTimeoutMs), preparationBudget = phaseBudget(preparationTimeoutMs);
  const jobs = new Map(), seenEvents = new WeakSet();
  const report = text => { try { writer?.reportFailure?.(text); } catch (_error) {} };
  const pull = uid => { try { return read(uid); } catch (_error) { return null; } };
  const active = action => !destroyed && !action.cancelled && writer?.enabled?.() === true
    && action.epoch === epoch && jobs.get(action.uid) === action
    && writer.contextCurrent(action.context);
  const current = action => active(action) && (action.phase === 'issued' || monotonicNow() < action.expiresAt);

  function releaseWatch(action) {
    action.removeRequested = true;
    if (!action.registration) return;
    action.registration.then(() => {
      if (!action.removed) { action.removed = true; return action.remove?.(); }
    }).catch(() => {});
  }
  function stopObserving(action) {
    for (const timer of action.timers) host.clearTimeout(timer);
    action.timers.clear(); releaseWatch(action);
  }
  function cancel(action) {
    action.cancelled = true; action.abort.abort(); stopObserving(action);
    if (action.deadline !== null) { host.clearTimeout(action.deadline); action.deadline = null; }
    if (jobs.get(action.uid) === action) jobs.delete(action.uid);
  }
  function invalidate() {
    epoch++;
    for (const action of [...jobs.values()]) cancel(action);
  }
  function expire(action) {
    if (!active(action)) { cancel(action); return; }
    if (action.phase === 'issued') return;
    if (!action.gesture.noticeReported) {
      action.gesture.noticeReported = true;
      report(action.phase === 'waiting'
        ? 'A completion timestamp was skipped: Roam did not confirm the native change and editor state in time. No timestamp write was issued for that task.'
        : 'A completion timestamp follow-up could not start in time. No timestamp write was issued for that task.');
    }
    cancel(action);
  }
  function armDeadline(action, duration) {
    if (action.deadline !== null) host.clearTimeout(action.deadline);
    action.expiresAt = monotonicNow() + duration;
    const phase = action.phase, expiresAt = action.expiresAt;
    action.deadline = host.setTimeout(() => {
      if (action.phase !== phase || action.expiresAt !== expiresAt) return;
      action.deadline = null; expire(action);
    }, duration);
  }
  function inspect(action) {
    if (!current(action)) { expire(action); return; }
    if (writer.refuseConflict()) { cancel(action); return; }
    if (action.phase !== 'waiting') return;
    const value = pull(action.uid);
    if (!value || value.uid !== action.uid || !core.nativeTransition(action.before, value.string)) return;
    // Graph notification can precede React's editor-buffer commit. Wait only
    // inside this gesture's finite window; never replace an uncommitted buffer.
    if (!writer.isEditorSafe(action.uid, value.string)) return;
    if (!current(action)) { expire(action); return; }
    action.phase = 'preparing'; stopObserving(action);
    // Observing Roam and acquiring/preparing the write are separate budgets.
    // Once issued, the writer owns its bounded settlement and receipt path;
    // this adapter must not cancel a valid in-flight write at the old deadline.
    armDeadline(action, preparationBudget);
    Promise.resolve().then(() => writer.stampNative({ uid: action.uid, before: action.before,
      instant: action.instant, frozenContext: action.context, signal: action.abort.signal,
      isCurrent: () => current(action),
      onWriteIssued: () => {
        if (!current(action)) throw Error('Completion intent expired before writing.');
        action.phase = 'issued';
        if (action.deadline !== null) { host.clearTimeout(action.deadline); action.deadline = null; }
      } }))
      .then(result => {
        if (!active(action)) return;
        if (action.phase !== 'issued' && monotonicNow() >= action.expiresAt) { expire(action); return; }
        if (['no-confirmed-transition','changed-before-write'].includes(result?.reason) && !action.gesture.noticeReported) {
          action.gesture.noticeReported = true;
          report('A completion timestamp was skipped because the task or editor changed during confirmation. The newer text was preserved.');
        }
      })
      .catch(() => {
        if (!active(action)) return;
        if (action.phase !== 'issued' && monotonicNow() >= action.expiresAt) expire(action);
        else report('Completion timestamp outcome could not be confirmed. No automatic retry was made.');
      })
      .finally(() => {
        if (action.deadline !== null) { host.clearTimeout(action.deadline); action.deadline = null; }
        if (jobs.get(action.uid) === action) jobs.delete(action.uid);
      });
  }
  function addWatch(action) {
    const api = host?.roamAlphaAPI?.data;
    if (typeof api?.addPullWatch !== 'function' || typeof api?.removePullWatch !== 'function') return;
    const pattern = '[:block/string]', lookup = `[:block/uid "${action.uid}"]`;
    const callback = () => inspect(action);
    // Install the settlement latch BEFORE calling a host that can synchronously
    // emit, or return a late/rejected registration. Cleanup always waits for it.
    let settle;
    action.registration = new Promise(resolve => { settle = resolve; });
    action.remove = () => api.removePullWatch(pattern, lookup, callback);
    action.registration.then(() => {
      if (action.removeRequested) releaseWatch(action);
      else inspect(action);
    }).catch(() => {});
    try { Promise.resolve(api.addPullWatch(pattern, lookup, callback)).then(() => settle(), () => settle()); }
    catch (_error) { settle(); }
  }
  function intent(uid, gesture) {
    if (destroyed || !writer?.enabled?.()) return;
    const previous = jobs.get(uid);
    if (previous) cancel(previous);
    const value = pull(uid);
    if (!value || value.uid !== uid) { report('Completion timestamp skipped because the target block could not be read.'); return; }
    if (!core.oneStatus(value.string)) return;
    let before = value.string;
    // Cmd/Ctrl+Enter may commit the user's current textarea and change its
    // marker together. Freeze that buffer as an expectation only; never write
    // it ourselves. The graph must later match its exact native transition.
    const buffer = gesture.buffers.get(uid);
    if (typeof buffer === 'string' && core.oneStatus(buffer) && core.status(buffer) === core.status(before)
      && writer.isEditorSafe(uid, buffer)) before = buffer;
    if (!writer.isEditorSafe(uid, before)) {
      report('Completion timestamp skipped while this block has uncommitted text or input-method composition.'); return;
    }
    if (jobs.size >= MAX_PENDING) { report('Too many pending completion actions; the native task change was left intact.'); return; }
    const action = { uid, before, instant: gesture.instant, context: gesture.context,
      epoch: gesture.epoch, id: gesture.id, gesture, abort: new AbortController(), phase: 'waiting', cancelled: false,
      timers: new Set(), deadline: null, expiresAt: null, registration: null, remove: null, removeRequested: false, removed: false };
    jobs.set(uid, action);
    armDeadline(action, observationBudget);
    addWatch(action);
    if (!current(action) || action.phase !== 'waiting') return;
    for (const delay of WATCH_DELAYS.filter(delay => delay < observationBudget)) {
      const timer = host.setTimeout(() => { action.timers.delete(timer); inspect(action); }, delay);
      action.timers.add(timer);
    }
  }
  function admit(event, uids) {
    if (!listening || !writer?.enabled?.() || seenEvents.has(event) || !uids.length) return;
    seenEvents.add(event);
    if (writer.refuseConflict()) { invalidate(); return; }
    const buffers = new Map();
    if (trustedShortcut(event) && event.target?.tagName === 'TEXTAREA') {
      const uid = uidFromNativeId(event.target.id);
      if (uid && typeof event.target.value === 'string') buffers.set(uid, event.target.value);
    }
    const gesture = { instant: now(), context: writer.freezeContext(), epoch, id: ++sequence, buffers };
    // Reject a malformed list as a unit; no arbitrary first twenty targets.
    if (uids.length > 20 || uids.some(uid => !UID_RE.test(uid))) return;
    uids.forEach(uid => intent(uid, gesture));
  }
  const onClick = event => { if (trustedClick(event)) { const target = resolveCheckboxTarget(event.target); admit(event, target ? [target.uid] : []); } };
  const onKeyDown = event => {
    if (undoGesture(event)) { invalidate(); return; }
    if (trustedShortcut(event)) admit(event, resolveKeyboardTargets(event.target, document));
  };
  const compositionUid = event => uidFromNativeId(event.target?.closest?.('.rm-block-input[id], .roam-block[id]')?.id)
    || blockUidFromMain(event.target?.closest?.('.rm-block-main'));
  const onCompositionStart = event => { const uid = compositionUid(event); if (uid) writer.setComposing(uid, true, event.target); };
  const onCompositionEnd = event => { const uid = compositionUid(event); if (uid) writer.setComposing(uid, false); };
  const events = [['click', onClick], ['keydown', onKeyDown], ['compositionstart', onCompositionStart], ['compositionend', onCompositionEnd]];
  const onNavigation = () => { invalidate(); writer.clearComposition(); };
  const sync = () => {
    const next = !destroyed && writer?.enabled?.() === true;
    if (next === listening) return;
    invalidate(); writer.clearComposition(); listening = next;
    for (const [type, fn] of events) document?.[next ? 'addEventListener' : 'removeEventListener']?.(type, fn, true);
    host?.[next ? 'addEventListener' : 'removeEventListener']?.('hashchange', onNavigation);
  };
  const onSettings = () => sync();
  host?.addEventListener?.('nautilus-log:settings-changed', onSettings);
  sync();
  return { sync, destroy() {
    if (destroyed) return;
    destroyed = true; sync();
    host?.removeEventListener?.('nautilus-log:settings-changed', onSettings);
  } };
}

export { blockUidFromMain, publicPull, resolveCheckboxTarget, resolveKeyboardTargets, trustedClick, trustedShortcut, uidFromNativeId };
