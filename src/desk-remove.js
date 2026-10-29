const { createDeskGraphReader, validUid } = require('./desk-graph-read');
const { pureDeskReferenceUid, deskCodeSegments } = require('./desk-preview');
const { isNautilusComponent } = require('./timing-core');
const LIMITS = Object.freeze({ nodes: 4096, depth: 128, children: 2048, membership: 16384, bytes: 8 * 1024 * 1024, references: 128, watches: 8192 });
class DeskRemoveError extends Error { constructor(message, code = 'remove-unavailable') { super(message || 'Could not safely remove this card.'); this.code = code; } }
const fail = (message, code) => { throw new DeskRemoveError(message, code); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clone = value => JSON.parse(JSON.stringify(value));
function createModernDeskRemoveAdapter(api, assertContext = () => {}) {
  const reader = createDeskGraphReader(api, { ...LIMITS, assertContext });
  return { ...reader, api, readBlock(uid) { const n = reader.read(uid); if (n && n.kind !== 'block') fail('Expected a block.'); return n; },
    readPage(uid) { const n = reader.read(uid); if (!n || n.kind !== 'page') fail('Expected a page.'); return n; } };
}
function validateOwningDailyNote({ adapter, api = adapter.api, planUid }) {
  const plan = adapter.readBlock(planUid);
  if (!plan || !isNautilusComponent(plan.string) || plan.parents?.length !== 1 || !plan.page) fail('Plan ownership is unavailable.');
  const page = adapter.readPage(plan.page.uid);
  if (plan.page.title !== undefined && plan.page.title !== page.title) fail('Page ownership changed.');
  if (['pageTitleToDate', 'dateToPageTitle', 'dateToPageUid'].some(name => typeof api?.util?.[name] !== 'function')) fail('Daily Note validation is unavailable.');
  const date = api.util.pageTitleToDate(page.title);
  if (!(date instanceof Date) || !Number.isFinite(date.getTime()) || api.util.dateToPageTitle(date) !== page.title || api.util.dateToPageUid(date) !== page.uid) fail('The plan is not on a verified Daily Note.');
  const ancestors = new Map(), seen = new Set([plan.uid]); let child = plan;
  while (child.parents?.[0] !== page.uid) {
    if (ancestors.size >= LIMITS.depth || child.parents?.length !== 1 || seen.has(child.parents[0])) fail('Plan ancestry is cyclic or unavailable.');
    const parent = adapter.readBlock(child.parents[0]);
    if (!parent || parent.page?.uid !== page.uid) fail('Plan ancestry disagrees with its owning page.');
    assertChild(child, parent.uid, parent.children.find(row => row.uid === child.uid), page.uid);
    ancestors.set(parent.uid, parent); seen.add(parent.uid); child = parent;
  }
  assertChild(child, page.uid, page.children.find(row => row.uid === child.uid), page.uid);
  return { plan, page, date, ancestors };
}
function classifyDeskRemoveIntent({ target, planUid, ownerPageUid, structural = new Set() }) {
  if (!target || target.kind !== 'block' || [planUid, ownerPageUid].includes(target.uid)) fail('Invalid removal target.');
  const ref = pureDeskReferenceUid(target.string);
  const plainWrapper = /^(?:\{\{(?:TODO|\[\[TODO\]\])\}\}\s*)?\(\([A-Za-z0-9_-]{6,255}\)\)$/.test(target.string.trim());
  const pure = plainWrapper && !target.children.length && ref && ![target.uid, planUid, ownerPageUid].includes(ref) && !structural.has(ref);
  return pure ? { kind: 'delete-wrapper', uid: target.uid, sourceUid: ref } : { kind: 'promote', uid: target.uid };
}
function fingerprintDeskRemove(node) { return JSON.stringify(node); }
const sameDeskRemoveFingerprint = (a, b) => fingerprintDeskRemove(a) === fingerprintDeskRemove(b);
function assertChild(node, parent, member, pageUid) {
  if (!node || !member || node.kind !== 'block' || node.order !== member.order || node.parents?.length !== 1 || node.parents[0] !== parent || node.page?.uid !== pageUid) fail('Malformed block ownership or order.');
}
function readStrictDeskRemoveSnapshot({ adapter, api = adapter.api, planUid, targetUid }) {
  const { plan, page, ancestors } = validateOwningDailyNote({ adapter, api, planUid });
  const nodes = new Map([[plan.uid, plan], [page.uid, page], ...ancestors]);
  const direct = parent => {
    for (const member of parent.children) {
      const node = adapter.read(member.uid); assertChild(node, parent.uid, member, page.uid); nodes.set(node.uid, node);
    }
  };
  direct(page); direct(plan);
  const target = adapter.readBlock(targetUid);
  if (!target) return { plan, page, target: null, intent: null, nodes, status: 'already-absent' };
  if (target.parents?.length !== 1 || target.page?.uid !== page.uid) fail('Target ownership changed.');
  if (target.parents[0] === page.uid && page.children.some(row => row.uid === targetUid && row.order === target.order)) {
    return { plan, page, target, intent: null, nodes, status: 'already-removed' };
  }
  const member = plan.children.find(row => row.uid === targetUid);
  if (!member) fail('Target is no longer a direct child of this plan.');
  assertChild(target, plan.uid, member, page.uid);
  const subtree = new Set(), references = new Set();
  const walk = (root, owningPage, local, visited = new Set(), depth = 0) => {
    if (depth > LIMITS.depth || visited.has(root.uid)) fail('Subtree is cyclic or too deep.');
    visited.add(root.uid); nodes.set(root.uid, root);
    if (local) subtree.add(root.uid);
    if (root.kind === 'block') {
      deskCodeSegments(root.string, prose => {
        for (const match of prose.matchAll(/\(\(([A-Za-z0-9_-]{6,255})\)\)/g)) references.add(match[1]);
        if (references.size > LIMITS.references) fail('Too many referenced sources.'); return prose;
      });
    }
    for (const child of root.children) {
      const node = adapter.read(child.uid); assertChild(node, root.uid, child, owningPage);
      walk(node, owningPage, local, visited, depth + 1);
    }
  };
  walk(target, page.uid, true);
  const structural = new Set([plan.uid, page.uid, ...ancestors.keys(), ...subtree]);
  // Set iteration admits newly discovered transitive references once, under
  // the same distinct-reference, node, byte and topology limits.
  for (const ref of references) {
    if (structural.has(ref)) continue;
    const node = adapter.read(ref); nodes.set(ref, node);
    if (node?.kind === 'block') {
      if (!node.page?.uid || node.parents?.length !== 1) fail('Referenced source ownership is unavailable.');
      const sourcePage = adapter.readPage(node.page.uid), parent = adapter.read(node.parents[0]);
      if (!parent || (parent.kind === 'page' ? parent.uid !== sourcePage.uid : parent.page?.uid !== sourcePage.uid)) fail('Referenced source ancestry is unavailable.');
      assertChild(node, parent.uid, parent.children.find(row => row.uid === node.uid), sourcePage.uid);
      nodes.set(sourcePage.uid, sourcePage); nodes.set(parent.uid, parent);
    }
    if (node) walk(node, node.kind === 'page' ? node.uid : node.page?.uid, false);
  }
  const intent = classifyDeskRemoveIntent({ target, planUid, ownerPageUid: page.uid, structural });
  return { plan, page, target, intent, nodes, subtree, status: 'present' };
}
function snapshotFingerprint(snapshot) { return JSON.stringify([...snapshot.nodes].sort(([a], [b]) => a.localeCompare(b))); }
function verifyDeskRemoveResult(before, adapter) {
  const expected = new Map([...before.nodes].map(([uid, node]) => [uid, node === null ? null : clone(node)]));
  const { target, plan, page, intent } = before;
  const p = expected.get(plan.uid);
  p.children = p.children.filter(row => row.uid !== target.uid).map((row, order) => ({ uid: row.uid, order }));
  for (const child of p.children) expected.get(child.uid).order = child.order;
  if (intent.kind === 'delete-wrapper') expected.set(target.uid, null);
  else {
    const t = expected.get(target.uid), day = expected.get(page.uid);
    t.parents = [page.uid]; t.order = page.children.length;
    day.children.push({ uid: target.uid, order: t.order });
  }
  for (const [uid, node] of expected) if (!same(adapter.read(uid), node)) fail('Removal could not be confirmed. Check the original outline before retrying.', 'unconfirmed');
  return { status: intent.kind === 'delete-wrapper' ? 'removed-reference' : 'moved-to-daily-note', uid: target.uid, pageUid: page.uid };
}
// Realm-local uncertain receipts survive view/action disposal. No content or
// credentials enter storage; provider identity is part of the reservation key.
const ledgers = new WeakMap(), surfaces = new WeakMap();
function createDeskRemoveController({ getApi, getContext, runExclusive, host = globalThis.window, hostTimeoutMs = 5000, delay = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  let destroyed = false, composing = false;
  const owned = new Set(), document = host?.document;
  const awaitHost = request => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new DeskRemoveError('Removal response timed out.', 'unconfirmed')), hostTimeoutMs);
    Promise.resolve(request).then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
  const begin = () => { composing = true; }, end = () => { composing = false; };
  document?.addEventListener?.('compositionstart', begin, true); document?.addEventListener?.('compositionend', end, true);
  const context = () => {
    const ctx = getContext(), api = getApi();
    if (!ctx?.provider || ctx.provider !== api || !['graphName', 'graphType', 'userUid'].every(key => typeof ctx[key] === 'string' && ctx[key].trim())) fail('A verified graph and user context is required.');
    return { ...ctx };
  };
  function registerSurface({ planUid, isAlive, isQuiescent }) {
    if (destroyed || !validUid(planUid) || typeof isAlive !== 'function' || typeof isQuiescent !== 'function') fail();
    const api = getApi(); if (!api || typeof api !== 'object') fail();
    const surfaceContext = context();
    if (!surfaces.has(api)) surfaces.set(api, new Set());
    const surface = { provider: api, context: surfaceContext, planUid, isAlive, isQuiescent, composing: () => composing, disposed: false };
    surfaces.get(api).add(surface); owned.add(surface);
    const remove = ({ uid, expectedString, signal } = {}) => {
      let origin;
      try { origin = context(); if (['provider', 'graphName', 'graphType', 'userUid'].some(key => origin[key] !== surfaceContext[key]) || !validUid(uid)) fail('Graph or user changed; reopen Desk.'); }
      catch (error) { return Promise.reject(error); }
      if (!ledgers.has(api)) ledgers.set(api, new Map());
      const ledger = ledgers.get(api), key = JSON.stringify([origin.graphName, origin.graphType, origin.userUid, planUid, uid]);
      const old = ledger.get(key); if (old?.pending) return old.pending;
      if (!old && ledger.size >= 64) return Promise.reject(new DeskRemoveError('Resolve unconfirmed removals before continuing.'));
      const receipt = old || { attempted: false, snapshot: null, pending: null, origin, planUid };
      const assertContext = () => {
        const current = context();
        if (['provider', 'graphName', 'graphType', 'userUid'].some(key => current[key] !== origin[key])) fail('Graph or user changed.', 'context-changed');
      };
      const admission = () => {
        assertContext();
        if (destroyed || surface.disposed || !surface.isAlive() || signal?.aborted) fail('Removal was cancelled.');
        for (const s of surfaces.get(api) || []) if (s.planUid === planUid && !s.disposed && ['graphName', 'graphType'].every(k => s.context[k] === origin[k]) && (!s.isQuiescent() || s.composing())) fail('Close editors and finish composition before removing a card.');
        for (const [otherKey, r] of ledger) if (otherKey !== key && (r.pending || r.attempted && r.planUid === planUid && ['graphName', 'graphType'].every(k => r.origin[k] === origin[k]))) fail('Another removal is pending or unconfirmed.');
      };
      const checkFocus = snapshot => {
        assertContext();
        let focused;
        if (typeof api?.ui?.getFocusedBlock === 'function') {
          const value = api.ui.getFocusedBlock();
          if (value != null && (!validUid(value['block-uid']))) fail('Focused-block state is unavailable.');
          focused = value?.['block-uid'];
        } else {
          const active = document?.activeElement;
          if (!active) fail('Focused-block state is unavailable.');
          if (active.matches?.('input,textarea') || active.isContentEditable) {
            focused = active.closest?.('[data-block-uid]')?.dataset?.blockUid;
            if (!focused) fail('Finish editing before removing a card.');
          }
        }
        if (focused && snapshot.subtree.has(focused)) fail('This block or a descendant is being edited.');
        assertContext();
      };
      const verify = async () => {
        for (let attempt = 0; attempt < 3; attempt++) {
          assertContext();
          try { return verifyDeskRemoveResult(receipt.snapshot, createModernDeskRemoveAdapter(api, assertContext)); }
          catch (error) { assertContext(); if (attempt === 2) throw error; await delay(25 * (attempt + 1)); }
        }
      };
      receipt.verify = verify;
      try { admission(); } catch (error) { return Promise.reject(error); }
      ledger.set(key, receipt);
      const pending = runExclusive(async () => {
        assertContext();
        if (receipt.attempted) return verify();
        admission();
        const snapshot = readStrictDeskRemoveSnapshot({ adapter: createModernDeskRemoveAdapter(api, assertContext), api, planUid, targetUid: uid });
        if (snapshot.status !== 'present') return { status: snapshot.status, uid, pageUid: snapshot.page.uid };
        if (typeof expectedString !== 'string' || snapshot.target.string !== expectedString) fail('The displayed block changed. Refresh before removing it.');
        checkFocus(snapshot);
        const latest = readStrictDeskRemoveSnapshot({ adapter: createModernDeskRemoveAdapter(api, assertContext), api, planUid, targetUid: uid });
        if (latest.status !== 'present' || snapshotFingerprint(snapshot) !== snapshotFingerprint(latest)) fail('The outline changed before removal.');
        admission(); checkFocus(latest);
        const kind = latest.intent.kind === 'delete-wrapper' ? 'delete' : 'move';
        const mutate = api?.data?.block?.[kind]; if (typeof mutate !== 'function') fail(`Public data.block.${kind} is unavailable.`);
        const snapshotBytes = new TextEncoder().encode(snapshotFingerprint(latest)).length;
        const retainedBytes = [...ledger.values()].reduce((sum, record) => sum + (record.snapshotBytes || 0), 0);
        if (retainedBytes + snapshotBytes > 16 * 1024 * 1024) fail('Removal verification memory limit reached.');
        receipt.snapshot = latest; receipt.snapshotBytes = snapshotBytes; receipt.attempted = true;
        // No await separates final context/admission checks from host invocation.
        try {
          if (kind === 'delete') await awaitHost(mutate.call(api.data.block, { block: { uid } }));
          else await awaitHost(mutate.call(api.data.block, { location: { 'parent-uid': latest.page.uid, order: latest.page.children.length }, block: { uid } }));
        } catch (_error) { /* A lost response can still be verified, never reissued. */ }
        return verify();
      }, signal);
      receipt.pending = pending;
      pending.then(() => { ledger.delete(key); }, () => { if (!receipt.attempted) ledger.delete(key); }).finally(() => { if (receipt.pending === pending) receipt.pending = null; });
      return pending;
    };
    return { remove, destroy() { surface.disposed = true; surfaces.get(api)?.delete(surface); owned.delete(surface); } };
  }
  const assertPlanClear = planUid => {
    const ledger = ledgers.get(getApi()); if (!ledger?.size) return;
    const current = context();
    for (const receipt of ledger.values()) if (receipt.attempted && receipt.planUid === planUid && ['graphName', 'graphType'].every(k => receipt.origin[k] === current[k])) fail('A removal is unconfirmed. Verify it before changing this plan.');
  };
  const matching = planUid => {
    const ledger = ledgers.get(getApi()); if (!ledger?.size) return [];
    const current = context();
    return [...ledger].filter(([, r]) => r.attempted && r.planUid === planUid && ['graphName', 'graphType'].every(k => r.origin[k] === current[k]));
  };
  const isBlocked = planUid => { try { return matching(planUid).length > 0; } catch (_error) { return true; } };
  const hasUnconfirmed = planUid => { try { return matching(planUid).some(([, r]) => !r.pending); } catch (_error) { return true; } };
  const verifyPending = planUid => {
    if (!matching(planUid).length) return Promise.resolve({ confirmed: 0 });
    return runExclusive(async () => {
      const ledger = ledgers.get(getApi()); let confirmed = 0;
      for (const [key, receipt] of matching(planUid)) {
        if (receipt.pending) continue;
        await receipt.verify(); // Frozen original context; never invokes a host write.
        ledger.delete(key); confirmed++;
      }
      return { confirmed };
    });
  };
  return { registerSurface, assertPlanClear, isBlocked, hasUnconfirmed, verifyPending, destroy() {
    destroyed = true; for (const s of owned) { s.disposed = true; surfaces.get(s.provider)?.delete(s); } owned.clear();
    document?.removeEventListener?.('compositionstart', begin, true); document?.removeEventListener?.('compositionend', end, true);
  } };
}
module.exports = { LIMITS, DeskRemoveError, createModernDeskRemoveAdapter, validateOwningDailyNote, classifyDeskRemoveIntent,
  fingerprintDeskRemove, sameDeskRemoveFingerprint, readStrictDeskRemoveSnapshot, snapshotFingerprint, verifyDeskRemoveResult, createDeskRemoveController };
