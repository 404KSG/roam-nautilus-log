import { decideCalendarManagedChange, GOOGLE_CALENDAR_SOURCE_SUFFIX } from './calendar-core';
import {
  createGraphBlock,
  deleteGraphBlock,
  moveGraphBlock,
  readBlockString,
  readChildren,
  updateGraphBlock,
} from './timing-roam';
import { createGraphWriteGuard } from './graph-write-guard';

const DETAIL_KEYS = ['location', 'description'];
const STATE_VERSION = 2;
const DEFAULT_ORPHAN_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

const clone = (value) => (value == null ? value : JSON.parse(JSON.stringify(value)));
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const isThenable = (value) => Boolean(value) && typeof value.then === 'function';
const copyChildRows = (rows) => rows.map((row) => ({
  uid: row.uid,
  string: row.string,
  order: row.order,
  open: row.open,
}));
const emptyState = () => ({ version: STATE_VERSION, events: {} });
const summaryFor = () => ({ created: 0, updated: 0, removed: 0, localKept: 0, skipped: 0 });
const managedBlock = (uid, string) => ({ uid, lastSynced: String(string ?? '') });
const detailsFor = (event) => Object.fromEntries(
  DETAIL_KEYS.map((key) => [key, String(event?.details?.[key] ?? '')]),
);

function normalizeState(value, observedAt) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![1, 2].includes(value.version)
    || !value.events || typeof value.events !== 'object' || Array.isArray(value.events)) {
    throw new Error('Calendar mapping is unreadable. No graph changes are allowed.');
  }
  const events = Object.fromEntries(Object.entries(value.events).map(([key, mapping]) => {
    if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)
      || (mapping.creating !== undefined && typeof mapping.creating !== 'boolean')) {
      throw new Error('Calendar mapping contains an unreadable entry.');
    }
    if (mapping.key !== undefined && mapping.key !== key) {
      throw new Error('Calendar mapping identity does not match its key.');
    }
    return [key, {
      ...clone(mapping),
      key,
      dateKey: String(mapping.dateKey || ''),
      lastSeenAt: Number.isFinite(Number(mapping.lastSeenAt))
        ? Number(mapping.lastSeenAt)
        : observedAt,
    }];
  }));
  return {
    version: STATE_VERSION,
    events,
    ...(value.journalId ? { journalId: value.journalId } : {}),
  };
}

function preserve(summary, deleted = false) {
  summary.localKept += 1;
  const key = deleted ? 'localDeleted' : 'localChanged';
  summary[key] = (summary[key] || 0) + 1;
}

async function reservedUid(key, role) {
  const crypto = globalThis.crypto;
  if (!crypto?.subtle) throw new Error('Calendar sync requires SHA-256 for stable destination identities.');
  const bytes = new Uint8Array(await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify([key, role])),
  ));
  return `nl-gcal-${Array.from(bytes.slice(0, 16), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function ownersOf(value) {
  return value
    ? [value.parent, value.source, ...Object.values(value.details || {})].filter(Boolean)
    : [];
}

/**
 * A mapping-level lock serializes reads and writes. A separate, small write-ahead
 * journal survives an ambiguous host write or a failed final mapping save. Each
 * entry records exact UIDs and before/after mappings, never a text-based claim.
 */
export function createCalendarReconciler({
  read = readBlockString,
  children = readChildren,
  create = createGraphBlock,
  update = updateGraphBlock,
  remove = deleteGraphBlock,
  move = moveGraphBlock,
  loadState = emptyState,
  saveState = async () => {},
  loadJournal = () => null,
  saveJournal = async () => {
    throw new Error('Durable Calendar journal storage is unavailable.');
  },
  runExclusive,
  now = Date.now,
  orphanRetentionMs = DEFAULT_ORPHAN_RETENTION_MS,
} = {}) {
  const guard = runExclusive ? null : createGraphWriteGuard('calendar-mapping');
  let destroyed = false;

  const syncLocked = async ({
    planUid,
    events,
    force,
    signal,
    assertActive: checkCaller,
    contextKey,
  }) => {
    const assertActive = () => {
      if (destroyed || signal?.aborted) throw new Error('Calendar sync was cancelled.');
      guard?.assertActive();
      checkCaller?.();
    };
    assertActive();
    if (!planUid) throw new Error('A Nautilus Log Plan UID is required for Calendar sync.');
    const clockValue = Number(now());
    const observedAt = Number.isFinite(clockValue) ? clockValue : Date.now();
    let state;
    let journal = null;
    let key = '';
    let mapping = null;
    let applied = 0;
    let stage = 'load';
    const summary = summaryFor();
    const blockedKeys = new Set();
    const expectedGraph = guard?.scope || '';
    const scope = `${expectedGraph}:${contextKey || ''}`;

    // Snapshot host reads only until this turn actually yields. Awaiting a
    // thenable — including an already-resolved Promise or async helper — lets
    // other microtasks edit the graph, so the cache must die in that finally.
    const stringCache = new Map();
    const childCache = new Map();
    const invalidateReadCache = () => {
      stringCache.clear();
      childCache.clear();
    };
    const awaitFresh = async (value) => {
      try {
        return await value;
      } finally {
        invalidateReadCache();
      }
    };
    const readText = (uid) => {
      assertActive();
      if (stringCache.has(uid)) return stringCache.get(uid);
      const value = read(uid);
      if (value !== null && value !== undefined && typeof value !== 'string') {
        throw new Error('Unreadable Calendar block.');
      }
      const normalized = value ?? null;
      stringCache.set(uid, normalized);
      return normalized;
    };
    const childRows = (uid) => {
      assertActive();
      if (childCache.has(uid)) return copyChildRows(childCache.get(uid));
      const rows = children(uid);
      if (!Array.isArray(rows) || rows.some((row) => !row?.uid || typeof row.string !== 'string')) {
        throw new Error('Unreadable Calendar children.');
      }
      const snapshot = copyChildRows(rows);
      childCache.set(uid, snapshot);
      return copyChildRows(snapshot);
    };
    const belongs = (uid, parentUid) => (
      readText(parentUid) !== null && childRows(parentUid).some((row) => row.uid === uid)
    );
    const treeKey = (uid) => {
      const seen = new Set();
      const walk = (id, depth = 0) => {
        if (seen.has(id) || seen.size >= 2000 || depth > 64) {
          throw new Error('Calendar subtree exceeds verification limits.');
        }
        seen.add(id);
        const string = readText(id);
        if (string === null) return null;
        return [id, string, childRows(id).map((row) => walk(row.uid, depth + 1))];
      };
      return JSON.stringify(walk(uid));
    };
    const persist = async () => {
      assertActive();
      await awaitFresh(saveState(clone(state)));
      assertActive();
      const saved = normalizeState(await awaitFresh(loadState()), observedAt);
      assertActive();
      if (!same(saved, state)) throw new Error('Calendar mapping could not be read back exactly.');
    };
    const persistJournal = async (value) => {
      assertActive();
      await awaitFresh(saveJournal(clone(value)));
      assertActive();
      const saved = await awaitFresh(loadJournal());
      assertActive();
      if (!same(saved ?? null, value)) {
        throw new Error('Calendar operation record could not be read back exactly.');
      }
      journal = value;
    };
    const putMapping = (eventKey, value) => {
      if (value === null) delete state.events[eventKey];
      else {
        Object.defineProperty(state.events, eventKey, {
          value: clone(value),
          writable: true,
          enumerable: true,
          configurable: true,
        });
      }
    };
    const assertLocation = (value) => {
      if (value?.parent?.uid && readText(value.parent.uid) !== null
        && !belongs(value.parent.uid, value.planUid)) {
        throw new Error('The imported Calendar parent moved; further writes were stopped.');
      }
    };
    const afterMatches = (op) => {
      if (op.kind === 'remove') return readText(op.uid) === null;
      if (op.kind === 'move') return belongs(op.uid, op.parentUid);
      return readText(op.uid) === op.string && (!op.parentUid || belongs(op.uid, op.parentUid));
    };
    const beforeMatches = (op) => {
      if (op.kind === 'create') return readText(op.uid) === null && readText(op.parentUid) !== null;
      if (op.kind === 'remove') {
        return treeKey(op.uid) === op.beforeTree && (!op.parentUid || belongs(op.uid, op.parentUid));
      }
      if (op.kind === 'move') return belongs(op.uid, op.beforeParentUid);
      return readText(op.uid) === op.beforeString && (!op.parentUid || belongs(op.uid, op.parentUid));
    };
    const step = async (op, nextMapping) => {
      assertActive();
      stage = op.kind;
      // A deterministic occupied UID without our own pending record is a
      // collision, not evidence that this client may claim or overwrite it.
      if (!beforeMatches(op)) throw new Error(`Calendar ${op.kind} precondition changed for ${op.uid}.`);
      const crypto = globalThis.crypto;
      if (!crypto?.randomUUID) throw new Error('Calendar operation identities are unavailable.');
      const record = {
        version: 1,
        scope,
        graphScope: expectedGraph,
        id: crypto.randomUUID(),
        key,
        op: clone(op),
        beforeEvent: clone(mapping),
        afterEvent: clone(nextMapping),
      };
      await awaitFresh(persistJournal(record));
      assertActive();
      assertLocation(mapping);
      if (!beforeMatches(op)) {
        throw new Error(`Calendar block ${op.uid} changed while recording the operation.`);
      }
      if (op.kind === 'create') {
        await awaitFresh(create({
          uid: op.uid,
          parentUid: op.parentUid,
          order: op.order ?? 'last',
          string: op.string,
          open: false,
        }));
      } else if (op.kind === 'update') {
        await awaitFresh(update(op.uid, op.string));
      } else if (op.kind === 'move') {
        await awaitFresh(move({ uid: op.uid, parentUid: op.parentUid, order: op.order }));
      } else if (op.kind === 'remove') {
        await awaitFresh(remove(op.uid));
      }
      assertActive();
      assertLocation(nextMapping);
      if (!afterMatches(op)) throw new Error(`Calendar ${op.kind} could not be confirmed for ${op.uid}.`);
      applied += 1;
      mapping = clone(nextMapping);
      putMapping(key, mapping);
    };
    const withField = (path, value) => {
      const next = clone(mapping);
      if (path.startsWith('details.')) {
        const name = path.slice(8);
        next.details ||= {};
        if (value) next.details[name] = value;
        else delete next.details[name];
      } else {
        next[path] = value;
      }
      return next;
    };
    const field = (path) => (
      path.startsWith('details.') ? mapping.details?.[path.slice(8)] : mapping[path]
    );
    const managed = (path, parentUid, incoming, { required = false, ensureSource = false } = {}) => {
      const owner = field(path);
      const current = owner?.uid ? readText(owner.uid) : null;
      if (!owner?.uid || current === null) {
        if (owner?.uid && !force && !mapping.creating) return { changed: false, localKept: true };
        if (!incoming) return { changed: false, localKept: false };
        return (async () => {
          const uid = owner?.uid || await awaitFresh(reservedUid(key, path));
          assertActive();
          if (readText(uid) !== null) {
            throw new Error(`Reserved Calendar UID ${uid} is occupied; it cannot be claimed without its operation record.`);
          }
          await awaitFresh(step(
            { kind: 'create', uid, parentUid, string: incoming, order: path === 'source' ? 0 : 'last' },
            withField(path, managedBlock(uid, incoming)),
          ));
          return { changed: true, localKept: false };
        })();
      }
      // A user-moved nested managed field is local structure, even on force.
      if (path !== 'parent' && !belongs(owner.uid, parentUid)) return { changed: false, localKept: true };
      const decision = decideCalendarManagedChange({
        lastSynced: owner.lastSynced,
        current,
        incoming,
        force,
      });
      if (decision.action === 'update') {
        return awaitFresh(step(
          {
            kind: 'update',
            uid: owner.uid,
            parentUid,
            beforeString: current,
            string: decision.value,
          },
          withField(path, managedBlock(owner.uid, decision.value)),
        )).then(() => ({ changed: true, localKept: false }));
      }
      if (decision.action === 'delete') {
        if (required || childRows(owner.uid).length) return { changed: false, localKept: true };
        return awaitFresh(step(
          { kind: 'remove', uid: owner.uid, parentUid, beforeTree: treeKey(owner.uid) },
          withField(path, null),
        )).then(() => ({ changed: true, localKept: false }));
      }
      if (decision.action === 'keep-local' && ensureSource && incoming) {
        const suffix = `· ${GOOGLE_CALENDAR_SOURCE_SUFFIX}`;
        const text = current.trimEnd();
        if (!text.endsWith(suffix)) {
          // Preserve the established suffix contract without claiming ownership
          // of the user's edited body by advancing lastSynced.
          return awaitFresh(step(
            {
              kind: 'update',
              uid: owner.uid,
              parentUid,
              beforeString: current,
              string: `${text} ${suffix}`,
            },
            mapping,
          )).then(() => ({ changed: true, localKept: true }));
        }
      }
      return { changed: false, localKept: decision.action === 'keep-local' };
    };
    const untouchedTree = () => {
      if (!mapping?.parent?.uid) return false;
      const owned = [mapping.parent, mapping.source, ...Object.values(mapping.details || {})].filter(Boolean);
      if (owned.some((node) => readText(node.uid) !== node.lastSynced)) return false;
      const expected = new Set(owned.map((node) => node.uid));
      const visited = new Set();
      const walk = (uid) => {
        if (!expected.has(uid) || visited.has(uid)) return false;
        visited.add(uid);
        return childRows(uid).every((row) => walk(row.uid));
      };
      return walk(mapping.parent.uid) && visited.size === expected.size;
    };
    const validRecord = (record) => {
      const op = record?.op;
      const validMapping = (value) => value && typeof value === 'object' && !Array.isArray(value)
        && value.key === record.key && typeof value.planUid === 'string'
        && (value.creating === undefined || typeof value.creating === 'boolean')
        && ownersOf(value).every((owner) => (
          typeof owner.uid === 'string' && typeof owner.lastSynced === 'string'
        ));
      if (record?.version !== 1 || typeof record.scope !== 'string' || typeof record.id !== 'string'
        || typeof record.key !== 'string' || typeof op?.uid !== 'string' || !op.uid
        || !['create', 'update', 'move', 'remove'].includes(op.kind)
        || (['create', 'update'].includes(op.kind) && typeof op.string !== 'string')
        || (['create', 'move'].includes(op.kind) && typeof op.parentUid !== 'string')
        || (op.kind === 'update' && typeof op.beforeString !== 'string')
        || (op.kind === 'remove' && typeof op.beforeTree !== 'string')
        || !validMapping(record.beforeEvent)
        || (record.afterEvent !== null && !validMapping(record.afterEvent))) {
        return false;
      }
      if (op.kind === 'create') {
        return ownersOf(record.afterEvent).some((owner) => (
          owner.uid === op.uid && owner.lastSynced === op.string
        ));
      }
      if (!ownersOf(record.beforeEvent).some((owner) => owner.uid === op.uid)) return false;
      if (op.kind === 'move') {
        return record.beforeEvent.planUid === op.beforeParentUid
          && record.afterEvent?.planUid === op.parentUid;
      }
      if (record.afterEvent === null) {
        return op.kind === 'remove' && record.beforeEvent.parent?.uid === op.uid;
      }
      return true;
    };

    try {
      state = normalizeState(await awaitFresh(loadState()), observedAt);
      assertActive();
      journal = await awaitFresh(loadJournal());
      assertActive();
      if (journal) {
        stage = 'recovery';
        const op = journal.op;
        if (!validRecord(journal)) throw new Error('Calendar operation record is unreadable.');
        // Old journals without an explicit graphScope cannot uniquely identify
        // a graph. Never guess a graph name from a composite scope string.
        if (typeof journal.graphScope !== 'string') {
          throw new Error('Calendar operation record is unreadable.');
        }
        if (journal.graphScope !== expectedGraph) {
          throw new Error('Calendar operation record belongs to another graph.');
        }
        key = journal.key;
        if (state.journalId !== journal.id) {
          // Recovery is read-only in the graph. Recognize only the recorded
          // UID's before/after state, commit that progress, then re-plan from
          // this click's current input and force setting.
          if (journal.scope !== scope) {
            // A reconnected account must not adopt an older connection's
            // incomplete import. Keep its original scope and evidence under
            // that event, rather than blocking all other dates with the WAL.
            putMapping(key, { ...journal.beforeEvent, conflict: clone(journal) });
          } else if (afterMatches(op)) {
            putMapping(key, journal.afterEvent);
          } else if (beforeMatches(op)) {
            putMapping(key, journal.beforeEvent);
          } else if (op.kind !== 'create' && (readText(op.uid) !== null || journal.beforeEvent.creating !== true)) {
            // A previously active owner may have been edited, moved or deleted.
            // Keep its old ownership metadata: normal sync preserves deletion,
            // and only a later explicit force may restore that known UID.
            putMapping(key, journal.beforeEvent);
          } else {
            // A pre-write record does not prove create succeeded. A missing
            // owner in a still-incomplete tree is similarly ambiguous. Park
            // exact evidence without claiming or recreating it, so unrelated
            // events are not blocked by the shared WAL.
            putMapping(key, { ...journal.beforeEvent, conflict: clone(journal) });
          }
          state.journalId = journal.id;
          await awaitFresh(persist());
        }
        await awaitFresh(persistJournal(null));
      }
      for (const event of Array.isArray(events) ? events : []) {
        assertActive();
        if (!event?.key || typeof event.key !== 'string') {
          summary.skipped += 1;
          continue;
        }
        key = event.key;
        mapping = Object.hasOwn(state.events, key) ? clone(state.events[key]) : null;
        if (mapping?.conflict) {
          const conflict = mapping.conflict;
          if (!validRecord(conflict) || conflict.scope !== scope) {
            blockedKeys.add(key);
            continue;
          }
          if (afterMatches(conflict.op)) mapping = clone(conflict.afterEvent);
          else if (beforeMatches(conflict.op)) mapping = clone(conflict.beforeEvent);
          else {
            blockedKeys.add(key);
            continue;
          }
          putMapping(key, mapping);
          await awaitFresh(persist());
        }
        const excluded = event.status === 'cancelled' || event.status === 'excluded';
        const existingParent = mapping?.parent?.uid ? readText(mapping.parent.uid) : null;
        const locallyDeleted = Boolean(mapping?.parent?.uid) && existingParent === null;
        if (mapping?.parent?.uid && existingParent !== null && !belongs(mapping.parent.uid, mapping.planUid)) {
          preserve(summary);
          if (mapping.creating) blockedKeys.add(key);
          continue;
        }
        if (excluded) {
          if (!mapping) {
            summary.skipped += 1;
            continue;
          }
          if (untouchedTree()) {
            await awaitFresh(step(
              {
                kind: 'remove',
                uid: mapping.parent.uid,
                parentUid: mapping.planUid,
                beforeTree: treeKey(mapping.parent.uid),
              },
              null,
            ));
            summary.removed += 1;
          } else if (mapping.creating && !mapping.parent) {
            putMapping(key, null);
            summary.skipped += 1;
          } else {
            mapping.lastSeenAt = observedAt;
            putMapping(key, mapping);
            preserve(summary, locallyDeleted);
          }
        } else {
          if (typeof event.parentString !== 'string' || !event.parentString
            || typeof event.sourceString !== 'string' || !event.sourceString) {
            throw new Error('Calendar event content is unreadable.');
          }
          const isNew = !mapping || mapping.creating === true;
          mapping ||= {
            key,
            planUid,
            parent: null,
            source: null,
            details: {},
            creating: true,
          };
          mapping = {
            ...mapping,
            key,
            calendarId: event.calendarId,
            eventId: event.eventId,
            taskListId: event.taskListId,
            taskId: event.taskId,
            resourceType: event.resourceType,
            dateKey: String(event.dateKey || event.dueDate || mapping.dateKey || ''),
            lastSeenAt: observedAt,
          };
          let changed = false;
          let localKept = false;
          if (mapping.planUid !== planUid) {
            if (!mapping.parent || (existingParent === null && force)) mapping.planUid = planUid;
            else if (existingParent !== null && (force || existingParent === mapping.parent.lastSynced)
              && belongs(mapping.parent.uid, mapping.planUid)) {
              await awaitFresh(step(
                {
                  kind: 'move',
                  uid: mapping.parent.uid,
                  beforeParentUid: mapping.planUid,
                  parentUid: planUid,
                  order: childRows(planUid).length,
                },
                { ...mapping, planUid },
              ));
              changed = true;
            } else {
              localKept = true;
            }
          }
          const parentOutcome = managed('parent', mapping.planUid, event.parentString, {
            required: true,
            ensureSource: true,
          });
          const parent = isThenable(parentOutcome) ? await awaitFresh(parentOutcome) : parentOutcome;
          changed ||= parent.changed;
          localKept ||= parent.localKept;
          if (mapping.parent?.uid && readText(mapping.parent.uid) !== null) {
            const sourceOutcome = managed('source', mapping.parent.uid, event.sourceString, { required: true });
            const source = isThenable(sourceOutcome) ? await awaitFresh(sourceOutcome) : sourceOutcome;
            changed ||= source.changed;
            localKept ||= source.localKept;
            if (mapping.source?.uid && readText(mapping.source.uid) !== null) {
              for (const name of DETAIL_KEYS) {
                const detailOutcome = managed(`details.${name}`, mapping.source.uid, detailsFor(event)[name]);
                const outcome = isThenable(detailOutcome) ? await awaitFresh(detailOutcome) : detailOutcome;
                changed ||= outcome.changed;
                localKept ||= outcome.localKept;
              }
            }
          }
          if (isNew) {
            const complete = mapping.parent?.uid && mapping.source?.uid
              && belongs(mapping.parent.uid, mapping.planUid)
              && belongs(mapping.source.uid, mapping.parent.uid)
              && Object.values(mapping.details || {}).every((node) => belongs(node.uid, mapping.source.uid));
            if (!complete) throw new Error('The newly imported Calendar tree is incomplete or was moved.');
          }
          if (mapping.parent && mapping.source) delete mapping.creating;
          putMapping(key, mapping);
          if (isNew) summary.created += 1;
          else if (changed) summary.updated += 1;
          if (localKept) preserve(summary, locallyDeleted);
          if (!isNew && !changed && !localKept) summary.skipped += 1;
        }
        if (journal) {
          state.journalId = journal.id;
          await awaitFresh(persist());
          await awaitFresh(persistJournal(null));
        }
      }
      const retention = Math.max(0, Number(orphanRetentionMs) || DEFAULT_ORPHAN_RETENTION_MS);
      for (const [eventKey, value] of Object.entries(state.events)) {
        // Incomplete creations are integrity obligations, not orphan cache.
        if (value.conflict) {
          if (value.planUid === planUid) blockedKeys.add(eventKey);
          continue;
        }
        if (value.creating || observedAt - value.lastSeenAt <= retention) continue;
        if (!value.parent?.uid || readText(value.parent.uid) === null) delete state.events[eventKey];
      }
      stage = 'save';
      await awaitFresh(persist());
      if (blockedKeys.size) {
        summary.conflicts = blockedKeys.size;
        stage = 'conflict';
        key = [...blockedKeys][0];
        const targets = [...blockedKeys].map((eventKey) => {
          const value = state.events[eventKey];
          return `${eventKey} (block ${value?.conflict?.op?.uid || value?.parent?.uid || 'unconfirmed'})`;
        });
        throw new Error(`Recorded Calendar conflicts need inspection: ${targets.join(', ')}. Other completed changes were retained.`);
      }
      return summary;
    } catch (error) {
      const failure = new Error(`Calendar sync incomplete; any written blocks were retained. ${error?.message || error}`);
      Object.assign(failure, { incomplete: true, failedKey: key, stage, applied, summary });
      throw failure;
    }
  };

  const sync = (options = {}) => {
    const args = { events: [], contextKey: '', ...options, force: options.force === true };
    const operation = () => syncLocked(args);
    return runExclusive
      ? Promise.resolve().then(() => runExclusive(operation, { signal: args.signal }))
      : guard.run(operation, { signal: args.signal });
  };
  const destroy = () => {
    destroyed = true;
    guard?.destroy();
  };
  return { sync, destroy };
}
