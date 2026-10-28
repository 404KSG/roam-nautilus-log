import { hasDropModifier, hasRoamDropPayload, readDeskDropContext, sameDeskDropContext } from './desk-reference-import';

const AMBIGUOUS_SOURCE = '.nautilus-desk,.rm-reference-container,.rm-reference-item,.roam-query,.roam-query-content,.rm-embed-container,.rm-embed,.rm-block-ref,.rm-page-ref,.rm-title-display';
const OUTLINE_SOURCE = '.roam-article,.rm-sidebar-window,.rm-sidebar-outline';
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
  getContext = () => readDeskDropContext(host),
} = {}) {
  const document = root?.ownerDocument || host?.document;
  let candidate = null;
  let suspended = false;
  let epoch = 0;
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
    // space from Search/New note/Hide Desk or introducing a new control row.
    if (text) statusRegion?.setAttribute('title', text);
    else statusRegion?.removeAttribute('title');
    if (text && terminal) messageTimer = host.setTimeout(() => {
      messageTimer = null;
      if (!operations.size) say('');
    }, TERMINAL_MESSAGE_MS);
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
    if (!bullet || !owner || root?.contains(owner) || bullet.closest(AMBIGUOUS_SOURCE) || !bullet.closest(OUTLINE_SOURCE)) return;
    const uid = owner.getAttribute('data-block-uid');
    const context = getContext();
    if (!uid || !context?.provider || !context.graphName) return;
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
      request.then(result => {
        if (operations.get(key) !== operation || operation.epoch !== epoch || suspended || !canAccept()) return;
        say(result?.status === 'added' ? 'Added reference. Original kept.' : 'Already in this plan.', true);
      }, () => {
        if (operations.get(key) !== operation || operation.epoch !== epoch || suspended) return;
        say('Could not confirm the reference. Check this plan before retrying.', true);
      }).finally(() => { if (operations.get(key) === operation) operations.delete(key); });
    }
    clearCandidate();
    say('Adding reference. Original kept.');
  };
  const keydown = event => { if (event.key === 'Escape' && (candidate || operations.size || messageTimer !== null)) cancelAll(); };
  // A settled operation can still own terminal feedback and a timer.
  const lifecycle = () => cancelAll();
  const events = [['dragstart', dragStart, true], ['dragend', dragEnd, true], ['dragleave', dragLeave, true], ['dragover', dragOver, true], ['drop', drop, true], ['keydown', keydown, true]];
  for (const [type, listener, capture] of events) document?.addEventListener?.(type, listener, capture);
  host?.addEventListener?.('blur', lifecycle); host?.addEventListener?.('hashchange', lifecycle);
  return {
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
