import { hasDropModifier, hasRoamDropPayload, isSafeDeskReferenceUid, readDeskDropContext, sameDeskDropContext } from './desk-reference-import';

const NON_BLOCK_SOURCE = '.nautilus-desk,.rm-page-ref,.rm-title-display';
const INTERNAL_TYPE = 'application/x-nautilus-desk-task';
const TERMINAL_MESSAGE_MS = 5000;

const hasType = (transfer, type) => {
  try { return Array.from(transfer?.types || []).includes(type); } catch (_error) { return false; }
};
const cursorFor = transfer => ['all', 'uninitialized', 'copy', 'copyLink', 'copyMove'].includes(transfer?.effectAllowed || 'uninitialized')
  ? 'copy' : null;

/** DOM ownership only: graph validation and synchronous payload freezing live in importReferenceDrop. */
export function createDeskExternalDrop({
  root, grid, empty, statusRegion, feedback, host = globalThis.window, actions, planUid, canAccept = () => false,
  getContext = () => readDeskDropContext(host), notify,
} = {}) {
  const document = root?.ownerDocument || host?.document;
  let candidate = null;
  let suspended = false;
  let epoch = 0;
  let receipt = 0;
  const operations = new Map();
  const live = document?.createElement?.('div');
  const toast = document?.createElement?.('span');
  const toastText = document?.createElement?.('span');
  let messageTimer = null;
  if (live) {
    live.className = 'nautilus-desk__drop-status';
    live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite');
    root?.append(live);
  }
  if (toast) {
    toast.className = 'nautilus-desk__drop-toast bp3-text-small bp3-text-muted';
    toast.hidden = true;
    // The separate live region announces full messages; keep the heading's
    // original accessible name and intrinsic size while showing status in it.
    toast.setAttribute('aria-hidden', 'true');
    toast.append(toastText);
    statusRegion?.append(toast);
  }
  const say = (text, terminal = false) => {
    if (messageTimer !== null) { host.clearTimeout(messageTimer); messageTimer = null; }
    if (live) live.textContent = text || '';
    if (toast) { toastText.textContent = text || ''; toast.hidden = !text; }
    statusRegion?.classList.toggle('nautilus-desk__title--status', Boolean(text));
    // A native tooltip exposes any visually ellipsized message without taking
    // space from Search/New task or introducing a new control row.
    if (text) statusRegion?.setAttribute('title', text);
    else statusRegion?.removeAttribute('title');
    if (text && terminal) messageTimer = host.setTimeout(() => {
      messageTimer = null;
      if (!operations.size) say('');
    }, TERMINAL_MESSAGE_MS);
  };
  const outcome = (text, intent, key) => {
    let delivery = null;
    // Each confirmed mutation gets a new receipt. The semantic UID describes
    // the outcome but cannot identify a rapid remove/re-add cycle.
    const receiptKey = `nautilus-desk:${planUid}:${key}:${++receipt}`;
    try { delivery = notify?.({ message: text, intent, key: receiptKey }); } catch (_error) { /* Accessible status fallback below. */ }
    if (delivery?.native) say('');
    else say(text, true);
  };
  const clearFeedback = () => feedback.clear();
  const clearCandidate = () => { candidate = null; clearFeedback(); };
  const stopOwned = event => { event.preventDefault(); event.stopPropagation(); };
  const abortOperations = () => {
    epoch += 1;
    for (const operation of operations.values()) operation.controller.abort();
    operations.clear();
  };
  const cancelAll = () => { clearCandidate(); abortOperations(); say(''); };
  const candidateCurrent = () => Boolean(candidate && !suspended && sameDeskDropContext(candidate.context, getContext()));
  const ownedTarget = event => Boolean(root?.contains?.(event.target));
  const setFeedback = event => feedback.show(event, { sourceUid: candidate?.uid || null });
  const dragStart = event => {
    // Classify before touching candidate state: unrelated, internal, and modifier
    // starts must never abort or otherwise alter an issued import.
    if (suspended || event.defaultPrevented || hasDropModifier(event) || hasType(event.dataTransfer, INTERNAL_TYPE)) {
      if (hasDropModifier(event)) clearFeedback();
      return;
    }
    const bullet = event.target?.closest?.('.rm-bullet');
    const owner = bullet?.closest?.('[data-block-uid]');
    // A native block leaf keeps its identity in references, query results and
    // embeds. Its surrounding view is not evidence that the block is invalid.
    if (!bullet || !owner || !owner.isConnected || owner.ownerDocument !== document
      || root?.contains(owner) || bullet.closest(NON_BLOCK_SOURCE)) { clearCandidate(); return; }
    const uid = owner.getAttribute('data-block-uid');
    const context = getContext();
    if (!isSafeDeskReferenceUid(uid) || !context?.provider || !context.graphName) { clearCandidate(); return; }
    clearCandidate();
    candidate = { uid, context };
  };
  const dragEnd = () => { if (candidate) clearCandidate(); };
  const dragLeave = event => { if (ownedTarget(event) && !root.contains(event.relatedTarget)) clearFeedback(); };
  const dragOver = event => {
    if (!ownedTarget(event)) return;
    if (hasDropModifier(event) || hasType(event.dataTransfer, INTERNAL_TYPE)) { if (hasDropModifier(event)) clearFeedback(); return; }
    if (!candidateCurrent() || !canAccept() || !hasRoamDropPayload(event.dataTransfer)) {
      // This is an owned unmodified target: stop browser/native drop handling,
      // while never interpreting its untrusted data here.
      stopOwned(event); clearFeedback(); return;
    }
    const effect = cursorFor(event.dataTransfer);
    if (!effect) { stopOwned(event); clearFeedback(); return; }
    // Capture listener ownership stops later native bubble handlers before they
    // can mutate the graph. importReferenceDrop freezes payload synchronously on drop.
    stopOwned(event);
    event.dataTransfer.dropEffect = effect;
    setFeedback(event);
  };
  const drop = event => {
    if (!ownedTarget(event)) return;
    if (hasDropModifier(event) || hasType(event.dataTransfer, INTERNAL_TYPE)) { if (hasDropModifier(event)) clearFeedback(); return; }
    const captured = candidate;
    const insertion = setFeedback(event);
    // All unmodified drops on this confirmed Desk target are ours to reject or
    // accept, preventing browser navigation and later Roam graph handlers.
    stopOwned(event);
    if (!captured || !candidateCurrent() || !canAccept() || !hasRoamDropPayload(event.dataTransfer)) {
      clearCandidate(); say('Could not add this drop. Use one ordinary native Roam block.', true); return;
    }
    const effect = cursorFor(event.dataTransfer);
    if (!effect || !insertion) { clearCandidate(); say('Could not add this drop. Use one ordinary native Roam block.', true); return; }
    const key = `${planUid}\u0000${captured.uid}`;
    let operation = operations.get(key);
    if (!operation || !sameDeskDropContext(operation.context, captured.context)) {
      const controller = new AbortController();
      let request;
      try {
        // Called before this event returns: the action synchronously freezes all
        // authoritative native DataTransfer fields before it queues graph work.
        request = actions?.importReferenceDrop?.({
          planUid, transfer: event.dataTransfer, expectedSourceUid: captured.uid,
          originContext: captured.context, insertion, signal: controller.signal,
        });
      } catch (_error) { request = null; }
      if (!request || typeof request.then !== 'function') { clearCandidate(); say('Could not add this drop.', true); return; }
      operation = { controller, context: captured.context, request, epoch };
      operations.set(key, operation);
      const completion = request.then(async result => {
        if (operations.get(key) !== operation || operation.epoch !== epoch || suspended || !canAccept()) return;
        if (result?.status === 'added') {
          outcome('Added embed. Original kept.', 'success', `import:${captured.uid}:added`);
          return;
        }
        if (result?.status === 'existing-reference' && result.movable && typeof actions?.moveDuplicateReference === 'function') {
          try {
            // The import lock is settled before this callback runs. This is a
            // separate guarded move, never a nested exclusive operation.
            const moved = await actions.moveDuplicateReference({ planUid, sourceUid: result.sourceUid,
              wrapperUid: result.wrapperUid, sourceFingerprint: result.sourceFingerprint,
              originContext: captured.context, insertion, signal: operation.controller.signal });
            if (operations.get(key) !== operation || operation.epoch !== epoch || suspended || !canAccept()) return;
            outcome(moved?.changed ? 'Already in this plan. Moved existing note.' : 'Already in this plan.', 'primary', `import:${captured.uid}:duplicate`);
          } catch (error) {
            if (operations.get(key) === operation && operation.epoch === epoch && !suspended) {
              outcome(error?.message || 'Already in this plan. Existing note could not be moved.', 'warning', `import:${captured.uid}:duplicate-move-error`);
            }
          }
          return;
        }
        if (result?.status === 'existing-source') {
          // A direct Plan member is not an acceptable reusable embed. It gets
          // no repositioning path and must remain visibly distinct from one.
          outcome('That block is already a note on your Desk.', 'warning', `import:${captured.uid}:existing-source`);
          return;
        }
        outcome('Already in this plan.', 'primary', `import:${captured.uid}:duplicate`);
      }, error => {
        if (operations.get(key) !== operation || operation.epoch !== epoch || suspended) return;
        outcome(error?.message || 'Could not confirm the reference. Check this plan before retrying.', 'warning', `import:${captured.uid}:error`);
      });
      completion.finally(() => { if (operations.get(key) === operation) operations.delete(key); });
    }
    clearCandidate();
    say('Adding embed. Original kept.');
  };
  const keydown = event => { if (event.key === 'Escape' && (candidate || operations.size || messageTimer !== null)) cancelAll(); };
  // A settled operation can still own terminal feedback and a timer.
  const lifecycle = () => cancelAll();
  const events = [['dragstart', dragStart, true], ['dragend', dragEnd, true], ['dragleave', dragLeave, true], ['dragover', dragOver, true], ['drop', drop, true], ['keydown', keydown, true]];
  for (const [type, listener, capture] of events) document?.addEventListener?.(type, listener, capture);
  host?.addEventListener?.('blur', lifecycle); host?.addEventListener?.('hashchange', lifecycle);
  return {
    announce(text, { intent = 'warning', key = 'notice' } = {}) { outcome(text, intent, key); },
    reconcile() { if (!root?.isConnected || suspended || !canAccept()) lifecycle(); else feedback.reconcile(); },
    suspend() { suspended = true; cancelAll(); },
    resume() { suspended = false; },
    destroy() {
      cancelAll();
      for (const [type, listener, capture] of events) document?.removeEventListener?.(type, listener, capture);
      host?.removeEventListener?.('blur', lifecycle); host?.removeEventListener?.('hashchange', lifecycle);
      live?.remove(); toast?.remove();
    },
  };
}
