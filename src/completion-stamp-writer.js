import { createGraphWriteGuard } from './graph-write-guard';
import { graphName } from './graph-context';
import * as core from './completion-stamp-core';
import { readBlockString, updateGraphBlock } from './timing-roam';

const RECEIPTS_KEY = 'completion-stamp-receipts';
const ENABLED_KEY = 'completion-stamps-enabled';
const UID_RE = /^[A-Za-z0-9_-]{6,128}$/;

async function sha256(value, host = globalThis) {
  const crypto = host.crypto || globalThis.crypto;
  if (!crypto?.subtle || typeof TextEncoder !== 'function') throw new Error('Completion timestamp ownership hashing is unavailable.');
  const data = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(data), byte => byte.toString(16).padStart(2, '0')).join('');
}
function publicTodoTriggerConflict(host) {
  const roamjs = host?.roamjs;
  if (!roamjs) return false;
  if (roamjs.loaded && typeof roamjs.loaded.has === 'function') {
    try { return roamjs.loaded.has('todo-trigger') === true; } catch (_error) { return true; }
  }
  if (roamjs.loaded !== undefined) return true;
  return Boolean(roamjs.extension?.['todo-trigger']);
}
function defaultContext(host) {
  const provider = host?.roamAlphaAPI;
  let userUid = '';
  try { const value = provider?.user?.uid?.(); if (typeof value === 'string') userUid = value; } catch (_error) {}
  return { provider, graph: graphName(host), graphType: typeof provider?.graph?.type === 'string' ? provider.graph.type : '', userUid };
}
function sameContext(a, b) {
  return Boolean(a && b && a.provider === b.provider && a.graph === b.graph
    && a.graphType === b.graphType && a.userUid === b.userUid);
}
const receiptKey = (scope, uid) => JSON.stringify([scope.graph, scope.graphType, scope.userUid, uid]);

/** Shared optional suffix policy. Native writes acquire CLOCK's lock; finishTask
 * supplies the already-held path so marker, CLOCK end and stamp cannot deadlock. */
export function createCompletionStampWriter({ extensionAPI, host = globalThis.window || globalThis,
  readBlock = readBlockString, updateBlock = updateGraphBlock, getContext = () => defaultContext(host),
  hash = value => sha256(value, host), guard = createGraphWriteGuard('clock'), notify = () => {},
  writeTimeoutMs = 2500,
} = {}) {
  let destroyed = false, conflictNotified = false, generation = 0, settingsChanges = 0;
  const composing = new Map(), pendingWrites = new Map(), pendingWaits = new Set();
  const setTimer = host.setTimeout?.bind(host) || setTimeout;
  const clearTimer = host.clearTimeout?.bind(host) || clearTimeout;
  const enabled = () => {
    try { return !destroyed && settingsChanges === 0 && extensionAPI?.settings?.get?.(ENABLED_KEY) === true; } catch (_error) { return false; }
  };
  const warn = message => { if (!destroyed) { try { notify(message); } catch (_error) {} } };
  const freezeContext = () => ({ ...getContext(), stampGeneration: generation });
  const contextCurrent = frozen => {
    try { return !destroyed && frozen?.stampGeneration === generation && sameContext(frozen, getContext()); } catch (_error) { return false; }
  };
  const assertActive = (frozen, isCurrent = () => true) => {
    if (!enabled() || !isCurrent()) throw new Error('Completion timestamp was cancelled.');
    guard.assertActive?.();
    if (!contextCurrent(frozen)) throw new Error('The completion context or setting changed during completion.');
  };
  const refuseConflict = () => {
    if (!publicTodoTriggerConflict(host)) return false;
    if (!conflictNotified) {
      conflictNotified = true;
      warn('Nautilus cannot confirm that Todo Trigger is inactive. Disable Todo Trigger before using completion timestamps.');
    }
    return true;
  };
  const isEditorSafe = (uid, graphString) => {
    const compositionOwner = composing.get(uid);
    if (compositionOwner && compositionOwner !== true && compositionOwner.isConnected === false) composing.delete(uid);
    if (composing.has(uid)) return false;
    const document = host?.document;
    if (!document?.querySelectorAll) return true;
    try {
      const prefix = 'block-input-', suffix = `-${uid}`;
      const nodes = [...document.querySelectorAll('textarea[id], input:not([type="checkbox"]):not([type="radio"])[id], [contenteditable="true"][id]')]
        .filter(node => {
          const id = String(node.id || '');
          return id.startsWith(prefix) && id.endsWith(suffix)
            && /^[A-Za-z0-9_:-]+$/.test(id.slice(prefix.length, -suffix.length));
        })
        .filter(node => node.matches?.('textarea, input:not([type="checkbox"]):not([type="radio"])') || node.isContentEditable === true);
      // Rendered .roam-block text hides syntax and expands references. Only a
      // genuine raw editing buffer can be compared with the committed string.
      return nodes.every(node => (node.value ?? node.textContent) === graphString);
    } catch (_error) { return false; }
  };
  const loadReceipts = () => {
    try { return core.parseReceipts(extensionAPI.settings.get(RECEIPTS_KEY)); }
    catch (_error) { return { ok: false, value: null }; }
  };
  const ownsTail = async (receipts, frozen, uid, string) => {
    const item = core.receiptFor(receipts, uid, frozen);
    return Boolean(item && frozen.userUid && core.receiptMatches(item, frozen, uid, string,
      await hash(core.normalizedReceiptBody(string))));
  };
  const prepareReceipt = async (receipts, frozen, uid, string, token, instant) => {
    const item = { v: core.RECEIPT_VERSION, alg: 'sha256', graph: frozen.graph, graphType: frozen.graphType,
      userUid: frozen.userUid, uid, token, bodyHash: await hash(core.normalizedReceiptBody(string)), at: instant.getTime() };
    const next = core.withReceipt(receipts, item);
    if (!next) throw new Error('Completion timestamp ownership cannot be stored safely.');
    return { item, next };
  };

  // A timed-out host call remains pending until the original promise settles.
  // New explicit actions cannot accidentally reissue a write for that owner.
  const waitForHost = (request, signal) => new Promise(resolve => {
    let finished = false, timer;
    const finish = value => {
      if (finished) return;
      finished = true; clearTimer(timer); pendingWaits.delete(cancel);
      signal?.removeEventListener?.('abort', cancel); resolve(value);
    };
    const cancel = () => finish({ settled: false, cancelled: true });
    pendingWaits.add(cancel);
    timer = setTimer(() => finish({ settled: false }), writeTimeoutMs);
    signal?.addEventListener?.('abort', cancel, { once: true });
    request.then(value => finish(value));
    if (signal?.aborted || destroyed) cancel();
  });
  const writeOnce = async ({ uid, before, after, frozen, isCurrent = () => true, signal, onWriteIssued }) => {
    assertActive(frozen, isCurrent);
    const key = receiptKey(frozen, uid);
    if (pendingWrites.has(key)) throw new Error('An earlier completion write is still unresolved.');
    if (readBlock(uid) !== before || !isEditorSafe(uid, before)) return { confirmed: false, reason: 'changed-before-write' };
    assertActive(frozen, isCurrent);
    onWriteIssued?.();
    assertActive(frozen, isCurrent);
    let issued;
    try { issued = updateBlock(uid, after); } catch (error) { issued = Promise.reject(error); }
    const terminal = Promise.resolve(issued).then(() => ({ settled: true }), error => ({ settled: true, error }));
    pendingWrites.set(key, terminal);
    terminal.then(() => { if (pendingWrites.get(key) === terminal) pendingWrites.delete(key); });
    const outcome = await waitForHost(terminal, signal);
    if (!outcome.settled || !contextCurrent(frozen) || !enabled() || !isCurrent()) {
      warn('Completion update could not be confirmed. It may still finish; no automatic retry was made.');
      return { confirmed: false, issued: true, reason: 'unconfirmed' };
    }
    let observed;
    try { observed = readBlock(uid); } catch (_error) {}
    if (observed !== after) {
      warn('Completion update could not be confirmed. No automatic retry was made.');
      return { confirmed: false, issued: true, reason: 'unconfirmed' };
    }
    return { confirmed: true, issued: true, string: after };
  };
  const saveReceiptState = async (next, frozen, uid, expected, isCurrent, item = null) => {
    assertActive(frozen, isCurrent);
    if (readBlock(uid) !== expected) throw new Error('Task changed before ownership was saved.');
    await extensionAPI.settings.set(RECEIPTS_KEY, next);
    assertActive(frozen, isCurrent);
    const saved = loadReceipts();
    if (!saved.ok) throw new Error('Ownership persistence is unconfirmed.');
    const found = core.receiptFor(saved.value, uid, frozen);
    if (item ? !found || Object.keys(item).some(key => found[key] !== item[key]) : found) throw new Error('Ownership persistence is unconfirmed.');
  };
  const assertCanComplete = (uid, frozen = freezeContext()) => {
    assertActive(frozen);
    if (!UID_RE.test(uid) || !frozen.provider || !frozen.graph) throw new Error('A verified task and graph are required.');
    if (pendingWrites.has(receiptKey(frozen, uid))) throw new Error('An earlier completion write is still unresolved.');
    const string = readBlock(uid);
    if (typeof string !== 'string' || !isEditorSafe(uid, string)) throw new Error('Finish editing or composing this task before completing it.');
    return string;
  };

  async function complete({ uid, before, instant, frozen, direct, isCurrent = () => true, signal, onWriteIssued }) {
    assertActive(frozen, isCurrent);
    const done = direct ? core.doneMarkerString(before) : before;
    let prepared = null, after = done, reason = '';
    if (refuseConflict()) reason = 'todo-trigger';
    else if (typeof frozen.userUid !== 'string' || !frozen.userUid.trim()) {
      reason = 'missing-user'; warn('Completion timestamp skipped: a signed-in Roam user identity is required.');
    } else {
      const parsed = loadReceipts();
      if (!parsed.ok) { reason = 'receipt-unreadable'; warn('Completion timestamp ownership is unreadable. Existing timestamps were kept.'); }
      else {
        try {
          const owned = await ownsTail(parsed.value, frozen, uid, before);
          assertActive(frozen, isCurrent);
          const token = core.tokenFor(instant), change = core.completionMutation(done, token, { allowOwnedTail: owned });
          if (change.kind === 'stamp') {
            prepared = await prepareReceipt(parsed.value, frozen, uid, change.string, token, instant);
            assertActive(frozen, isCurrent); after = change.string;
          } else {
            reason = 'foreign-or-unsafe-text';
            warn('The existing time or unsupported task text was preserved; no extra timestamp was added.');
          }
        } catch (error) {
          assertActive(frozen, isCurrent);
          reason = 'ownership-unavailable'; warn('Completion timestamp ownership could not be prepared; no extra timestamp was added.');
        }
      }
    }
    if (!direct && !prepared) return { stamped: false, reason };
    const result = await writeOnce({ uid, before, after, frozen, isCurrent, signal, onWriteIssued });
    if (!result.confirmed) {
      if (direct) throw new Error('Task completion could not be confirmed.');
      return { stamped: false, ...result };
    }
    if (!prepared) return { handled: true, stamped: false, reason };
    try {
      await saveReceiptState(prepared.next, frozen, uid, after, isCurrent, prepared.item);
      return { handled: direct, stamped: true, receiptSaved: true, string: after };
    } catch (_error) {
      warn('The completion time was written, but ownership could not be confirmed. It will be preserved on reopen.');
      return { handled: direct, stamped: true, receiptSaved: false, string: after };
    }
  }

  const stampNative = async ({ uid, before, instant, isCurrent = () => true, frozenContext, signal, onWriteIssued } = {}) => {
    if (!enabled() || !isCurrent()) return { stamped: false, reason: 'cancelled' };
    const frozen = frozenContext || freezeContext();
    if (!UID_RE.test(uid || '') || !frozen.provider || !frozen.graph || !frozen.userUid) {
      warn('Completion timestamp skipped: a verified graph and signed-in user are required.');
      return { stamped: false, reason: 'unknown-context' };
    }
    return guard.run(async () => {
      assertActive(frozen, isCurrent);
      if (refuseConflict()) return { stamped: false, reason: 'todo-trigger' };
      const value = readBlock(uid), transition = core.nativeTransition(before, value);
      if (transition === 'complete') return complete({ uid, before: value, instant, frozen, direct: false, isCurrent, signal, onWriteIssued });
      if (transition !== 'reopen') return { stamped: false, reason: 'no-confirmed-transition' };
      const parsed = loadReceipts();
      if (!parsed.ok) { warn('The existing completion time was preserved because ownership is unreadable.'); return { stamped: false, reason: 'receipt-unreadable' }; }
      let owned = false;
      try { owned = await ownsTail(parsed.value, frozen, uid, before); } catch (_error) {}
      assertActive(frozen, isCurrent);
      if (!owned) {
        if (core.hasCompletionField(value)) warn('The existing completion time was preserved because its ownership could not be verified.');
        return { stamped: false, reason: 'foreign-reopen' };
      }
      const expected = value.replace(/ d(?:[01]\d|2[0-3]):[0-5]\d$/, '');
      // Withdraw and verify deletion authority before changing the text. If the
      // host later refuses that change, an identical manual token must not
      // inherit a receipt for the old suffix.
      try { await saveReceiptState(core.withoutReceipt(parsed.value, uid, frozen), frozen, uid, value, isCurrent); }
      catch (_error) {
        warn('The completion time was preserved because ownership removal could not be confirmed.');
        return { stamped: false, reason: 'receipt-removal-unconfirmed' };
      }
      const result = await writeOnce({ uid, before: value, after: expected, frozen, isCurrent, signal, onWriteIssued });
      if (!result.confirmed) return { stamped: false, ...result };
      return { stamped: true, removed: true, string: expected };
    }, { signal });
  };
  const finishDirect = async ({ uid, instant, locked = false, frozenContext } = {}) => {
    if (!enabled()) return { handled: false };
    const frozen = frozenContext || freezeContext();
    const operation = async () => {
      const before = assertCanComplete(uid, frozen);
      if (core.status(before) === 'DONE') throw new Error('This daily task instance is already complete.');
      return complete({ uid, before, instant, frozen, direct: true });
    };
    return locked ? operation() : guard.run(operation);
  };
  return { enabled, freezeContext, contextCurrent, refuseConflict, isEditorSafe, assertCanComplete,
    beginSettingsChange() {
      generation++; settingsChanges++; let released = false;
      return () => { if (!released) { released = true; settingsChanges--; } };
    },
    setComposing(uid, value, node = null) {
      for (const [owner, element] of composing) if (element !== true && element.isConnected === false) composing.delete(owner);
      if (value) composing.set(uid, node || true); else composing.delete(uid);
    },
    clearComposition() { composing.clear(); },
    reportFailure: warn, finishDirect, stampNative,
    destroy() {
      if (destroyed) return;
      destroyed = true; guard.destroy?.(); composing.clear();
      for (const cancel of [...pendingWaits]) cancel();
      pendingWrites.clear();
    },
  };
}

export { ENABLED_KEY, RECEIPTS_KEY, publicTodoTriggerConflict, sha256 };
