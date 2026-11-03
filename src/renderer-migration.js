import { createGraphWriteGuard } from './graph-write-guard';
import { graphName } from './graph-context';
import { sha256 } from './completion-stamp-writer';
import { readBlockString, updateGraphBlock } from './timing-roam';
import { CODE_UID, REVISION, RELEASED_RENDERER_SOURCES, migrateRendererReference } from './renderer-contract';
import { prepareRendererSourceChange } from './renderer-source-update';

const KEY = 'renderer-migration-pending';
const SOURCE_KEY = 'renderer-source-upgrade-pending';
const REFERENCE_SPEC = { key: KEY, kinds: ['template','active-plan'], revision: REVISION,
  propose: before => migrateRendererReference(before) };
const FIELDS = ['id','graph','type','user','uid','kind','revision','beforeHash','afterHash'];
function parseStore(raw, spec = REFERENCE_SPEC) {
  if (raw === undefined || raw === null || raw === '') return { version: 1, items: [] };
  try {
    const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
    if (new TextEncoder().encode(text).length > 32768) return null;
    const value = JSON.parse(text);
    if (value?.version !== 1 || !Array.isArray(value.items) || value.items.length > 64
      || Object.keys(value).some(key => !['version','items'].includes(key))) return null;
    const seen = new Set();
    for (const item of value.items) {
      if (!item || Object.keys(item).length !== FIELDS.length || Object.keys(item).some(key => !FIELDS.includes(key))
        || !['id','graph','user','uid'].every(key => typeof item[key] === 'string' && item[key].trim() && item[key].length <= 256)
        || typeof item.type !== 'string' || item.type.length > 64
        || !spec.kinds.includes(item.kind)
        || (spec.source ? !Number.isSafeInteger(item.revision) || item.revision < 1 || item.revision > spec.revision || item.uid !== CODE_UID : item.revision !== spec.revision)
        || ![item.beforeHash,item.afterHash].every(hash => typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash))) return null;
      const key = JSON.stringify([item.graph,item.type,item.user,item.uid]);
      if (seen.has(key)) return null; seen.add(key);
    }
    return value;
  } catch (_) { return null; }
}
function context(host) {
  const provider = host?.roamAlphaAPI;
  let user = '';
  try { user = provider?.user?.uid?.() || ''; } catch (_) {}
  return { provider, graph: graphName(host), type: provider?.graph?.type || '', user };
}
const same = (a, b) => a && b && ['provider','graph','type','user'].every(key => a[key] === b[key]);
const owner = (item, ctx, uid) => item.graph === ctx.graph && item.type === ctx.type && item.user === ctx.user && item.uid === uid;

/** Shared exact-write protocol. Source upgrades use a separate receipt store;
 * reference migrations retain their existing scope and revision contract. */
function createMigrationEngine({ extensionAPI, host = globalThis.window || globalThis,
  read = readBlockString, update = updateGraphBlock, getContext = () => context(host),
  guard = createGraphWriteGuard('outline'), hash = text => sha256(text, host),
  sourceReady = () => false, notify = () => {}, timeoutMs = 2500,
} = {}, spec = REFERENCE_SPEC) {
  let destroyed = false, pendingStorage = null;
  const waits = new Set();
  const warn = text => { if (!destroyed) { try { notify(text); } catch (_) {} } };
  const enabled = frozen => !destroyed && same(frozen, getContext()) && sourceReady();
  const assert = (frozen, isCurrent) => {
    guard.assertActive?.();
    if (!enabled(frozen) || !isCurrent()) throw Error('Renderer migration context changed.');
  };
  const load = () => {
    const value = parseStore(extensionAPI.settings.get(spec.key), spec);
    if (!value) throw Error('Renderer migration receipts are unreadable; existing references were preserved.');
    return value;
  };
  const wait = promise => new Promise(resolve => {
    let finished = false;
    const done = result => { if (finished) return; finished = true; clearTimeout(timer); waits.delete(cancel); resolve(result); };
    const cancel = () => done({ settled: false });
    const timer = setTimeout(cancel, timeoutMs); waits.add(cancel);
    Promise.resolve(promise).then(() => done({ settled: true }), error => done({ settled: true, error }));
    if (destroyed) cancel();
  });
  const persist = async (value, verify) => {
    if (pendingStorage) throw Error('An earlier migration receipt save is unresolved.');
    let request;
    try { request = Promise.resolve(extensionAPI.settings.set(spec.key, value)); }
    catch (error) { request = Promise.reject(error); }
    const terminal = request.then(() => undefined, error => { throw error; });
    pendingStorage = terminal;
    terminal.then(() => { if (pendingStorage === terminal) pendingStorage = null; }, () => { if (pendingStorage === terminal) pendingStorage = null; });
    const result = await wait(terminal);
    if (!result.settled || result.error || !verify(load())) throw Error('Renderer migration receipt persistence is unconfirmed.');
  };
  const remove = async record => {
    const value = load();
    if (!value.items.some(item => item.id === record.id)) return;
    await persist({ version: 1, items: value.items.filter(item => item.id !== record.id) }, saved => !saved.items.some(item => item.id === record.id));
  };
  const editorSafe = (uid, text) => {
    const document = host?.document;
    if (!document?.querySelectorAll) return true;
    try {
      return [...document.querySelectorAll('textarea[id], [contenteditable="true"][id]')]
        .filter(node => String(node.id).startsWith('block-input-') && String(node.id).endsWith(`-${uid}`))
        .every(node => node !== document.activeElement && (node.value ?? node.textContent) === text);
    } catch (_) { return false; }
  };
  const migrate = ({ uid, kind, expected, isCurrent } = {}) => {
    const frozen = { ...getContext() };
    if (!frozen.provider || !frozen.graph || !frozen.user || typeof uid !== 'string' || !uid
      || !spec.kinds.includes(kind) || (spec.source && (uid !== CODE_UID || typeof isCurrent !== 'function'))) {
      return Promise.resolve({ ok: false, reason: 'unverified-context' });
    }
    isCurrent ||= () => true;
    return guard.run(async () => {
      assert(frozen, isCurrent);
      const before = read(uid);
      if (typeof before !== 'string' || (expected !== undefined && expected !== before) || !editorSafe(uid, before)) {
        return { ok: false, reason: 'changed-or-editing' };
      }
      const store = load(), record = store.items.find(item => owner(item, frozen, uid));
      if (record) {
        if (record.kind !== kind) return { ok: false, reason: 'pending-owner-changed', uid };
        const actualHash = await hash(before); assert(frozen, isCurrent);
        if (read(uid) !== before) return { ok: false, reason: 'changed-during-verification', uid };
        if (actualHash === record.afterHash) {
          await remove(record); assert(frozen, isCurrent);
          return read(uid) === before ? { ok: true, changed: false, verified: true }
            : { ok: false, reason: 'changed-during-verification', uid };
        }
        warn(`A previous renderer-${spec.source ? 'source' : 'reference'} update is unconfirmed. The existing block was kept; reload only verifies it.`);
        return { ok: false, reason: 'unconfirmed', uid };
      }
      const change = spec.source ? await spec.propose(before, hash) : spec.propose(before, hash);
      assert(frozen, isCurrent);
      if (read(uid) !== before || !editorSafe(uid, before)) return { ok: false, reason: 'changed-or-editing' };
      if (!change.changed) return { ok: true, changed: false };
      const entry = { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, graph: frozen.graph, type: frozen.type,
        user: frozen.user, uid, kind, revision: spec.revision, beforeHash: await hash(before), afterHash: await hash(change.string) };
      assert(frozen, isCurrent);
      if (read(uid) !== before || !editorSafe(uid, before)) return { ok: false, reason: 'changed-or-editing' };
      if (store.items.length >= 64) throw Error('Resolve pending renderer migrations before starting another.');
      const reserved = { version: 1, items: [...store.items, entry] };
      if (!parseStore(reserved, spec)) throw Error('Renderer migration receipt exceeds its safe bounds.');
      await persist(reserved, saved => saved.items.some(item => FIELDS.every(key => item[key] === entry[key])));
      try {
        assert(frozen, isCurrent);
        if (read(uid) !== before || !editorSafe(uid, before)) throw Error('Renderer reference changed while reserving migration.');
      } catch (error) {
        // No graph call was issued. Retiring just this nonce is safe; if the
        // settings result is uncertain, retaining the reservation is safer.
        if (same(frozen, getContext()) && !destroyed) { try { await remove(entry); } catch (_) {} }
        throw error;
      }
      let request;
      try { request = update(uid, change.string); } catch (error) { request = Promise.reject(error); }
      const result = await wait(request);
      if (!result.settled || !enabled(frozen) || !isCurrent() || read(uid) !== change.string) {
        warn(`The renderer-${spec.source ? 'source' : 'reference'} update could not be confirmed. No automatic retry or replacement was created.`);
        return { ok: false, reason: 'unconfirmed', uid };
      }
      await remove(entry);
      assert(frozen, isCurrent);
      return read(uid) === change.string ? { ok: true, changed: true, uid, rendererUid: CODE_UID }
        : { ok: false, reason: 'changed-during-verification', uid };
    }).catch(error => { warn(error.message); return { ok: false, reason: 'blocked', error: error.message }; });
  };
  const hasPending = uid => {
    try { const frozen = getContext(); return load().items.some(item => owner(item, frozen, uid)); }
    catch (_) { return true; }
  };
  return { migrate, hasPending, destroy() { destroyed = true; guard.destroy?.(); for (const cancel of [...waits]) cancel(); } };
}

export function createRendererMigration(options) {
  return createMigrationEngine(options, REFERENCE_SPEC);
}

/** One canonical source UID, with verified forward upgrades and no automatic
 * replay of an unconfirmed request. Source text comes only from the bundle. */
export function createRendererSourceUpgrade({ expectedSource, revision = REVISION,
  releasedSources = RELEASED_RENDERER_SOURCES, ...options } = {}) {
  const engine = createMigrationEngine(options, { key: SOURCE_KEY, kinds: ['source'], revision, source: true,
    propose: (before, hash) => prepareRendererSourceChange({ before,
      expected: typeof expectedSource === 'function' ? expectedSource() : expectedSource,
      revision, releasedSources, hash }) });
  return { upgrade: options => engine.migrate({ ...options, uid: CODE_UID, kind: 'source' }),
    hasPending: () => engine.hasPending(CODE_UID), destroy: engine.destroy };
}
export { KEY as RENDERER_MIGRATION_KEY, SOURCE_KEY as RENDERER_SOURCE_UPGRADE_KEY, parseStore as parseRendererMigrationStore };
