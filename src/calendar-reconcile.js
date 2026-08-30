import {
  decideCalendarManagedChange,
  GOOGLE_CALENDAR_SOURCE_SUFFIX,
} from './calendar-core';
import {
  createGraphBlock,
  deleteGraphBlock,
  moveGraphBlock,
  readBlockString,
  readChildren,
  updateGraphBlock,
} from './timing-roam';

const DETAIL_KEYS = ['location', 'description'];
const STATE_VERSION = 2;
const DEFAULT_ORPHAN_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

function emptyState() {
  return { version: STATE_VERSION, events: {} };
}

function normalizeState(value, observedAt) {
  const candidate = value && typeof value === 'object' ? value : {};
  const sourceEvents = candidate.events && typeof candidate.events === 'object'
    ? candidate.events
    : {};
  const events = Object.fromEntries(Object.entries(sourceEvents).flatMap(([key, mapping]) => {
    if (!mapping || typeof mapping !== 'object') return [];
    const lastSeenAt = Number(mapping.lastSeenAt);
    return [[key, {
      ...mapping,
      lastSeenAt: Number.isFinite(lastSeenAt) ? lastSeenAt : observedAt,
      dateKey: String(mapping.dateKey || ''),
    }]];
  }));
  return {
    version: STATE_VERSION,
    events,
  };
}

function defaultMove({ uid, parentUid }) {
  return moveGraphBlock({ uid, parentUid, order: readChildren(parentUid).length });
}

function managedBlock(uid, lastSynced) {
  return { uid, lastSynced: String(lastSynced ?? '') };
}

function detailsFor(event) {
  const details = event?.details && typeof event.details === 'object' ? event.details : {};
  return Object.fromEntries(DETAIL_KEYS.map((key) => [key, String(details[key] ?? '')]));
}

function resultSummary() {
  return { created: 0, updated: 0, removed: 0, localKept: 0, skipped: 0 };
}

function recordLocalPreservation(summary, deleted = false) {
  summary.localKept += 1;
  const key = deleted ? 'localDeleted' : 'localChanged';
  summary[key] = Number(summary[key] || 0) + 1;
}

function ensureGoogleCalendarSource(value) {
  const text = String(value ?? '').trimEnd();
  const suffix = `· ${GOOGLE_CALENDAR_SOURCE_SUFFIX}`;
  return text.endsWith(suffix) ? text : `${text} · ${GOOGLE_CALENDAR_SOURCE_SUFFIX}`;
}

function observedMapping(mapping, event, observedAt) {
  return {
    ...mapping,
    dateKey: String(event?.dateKey || event?.dueDate || mapping?.dateKey || ''),
    lastSeenAt: observedAt,
  };
}

/**
 * Reconcile normalized Google events into a single explicitly selected
 * Nautilus plan. The mapping makes writes incremental and lets normal sync
 * distinguish Google-owned strings from user edits without rendering badges.
 */
export function createCalendarReconciler({
  read = readBlockString,
  children = readChildren,
  create = createGraphBlock,
  update = updateGraphBlock,
  remove = deleteGraphBlock,
  move = defaultMove,
  loadState = emptyState,
  saveState = async () => {},
  now = Date.now,
  orphanRetentionMs = DEFAULT_ORPHAN_RETENTION_MS,
} = {}) {
  const createManagedBlock = async ({ parentUid, string, order = 'last' }) => {
    const uid = await create({ parentUid, order, string, open: false });
    return managedBlock(uid, string);
  };

  const createEvent = async (planUid, event) => {
    const parent = await createManagedBlock({
      parentUid: planUid,
      string: event.parentString,
    });
    const source = await createManagedBlock({
      parentUid: parent.uid,
      order: 0,
      string: event.sourceString,
    });
    const details = {};
    for (const key of DETAIL_KEYS) {
      const value = detailsFor(event)[key];
      if (!value) continue;
      details[key] = await createManagedBlock({ parentUid: source.uid, string: value });
    }
    return {
      key: event.key,
      calendarId: event.calendarId,
      eventId: event.eventId,
      taskListId: event.taskListId,
      taskId: event.taskId,
      resourceType: event.resourceType,
      planUid,
      parent,
      source,
      details,
    };
  };

  const updateManagedBlock = async ({
    mapping,
    parentUid,
    incoming,
    force,
    ensureSource = false,
  }) => {
    if (!mapping?.uid) {
      if (!incoming) return { mapping: null, changed: false, localKept: false };
      return {
        mapping: await createManagedBlock({ parentUid, string: incoming }),
        changed: true,
        localKept: false,
      };
    }
    const current = read(mapping.uid);
    if (current === null || current === undefined) {
      if (!force) return { mapping, changed: false, localKept: true };
      if (!incoming) return { mapping: null, changed: false, localKept: false };
      return {
        mapping: await createManagedBlock({ parentUid, string: incoming }),
        changed: true,
        localKept: false,
      };
    }
    const decision = decideCalendarManagedChange({
      lastSynced: mapping.lastSynced,
      current,
      incoming,
      force,
    });
    if (decision.action === 'update') {
      await update(mapping.uid, decision.value);
      return {
        mapping: managedBlock(mapping.uid, decision.value),
        changed: true,
        localKept: false,
      };
    }
    if (decision.action === 'delete') {
      if (children(mapping.uid).length > 0) {
        return { mapping, changed: false, localKept: true };
      }
      await remove(mapping.uid);
      return { mapping: null, changed: true, localKept: false };
    }
    if (decision.action === 'keep-local' && ensureSource && incoming) {
      const withSource = ensureGoogleCalendarSource(current);
      if (withSource !== current) {
        await update(mapping.uid, withSource);
        return { mapping, changed: true, localKept: true };
      }
    }
    return {
      mapping,
      changed: false,
      localKept: decision.action === 'keep-local',
    };
  };

  const hasOnlyUntouchedManagedContent = (mapping) => {
    if (!mapping?.parent?.uid || read(mapping.parent.uid) !== mapping.parent.lastSynced) return false;
    if (!mapping?.source?.uid || read(mapping.source.uid) !== mapping.source.lastSynced) return false;
    for (const detail of Object.values(mapping.details || {})) {
      if (!detail?.uid || read(detail.uid) !== detail.lastSynced) return false;
      if (children(detail.uid).length > 0) return false;
    }
    const parentChildren = children(mapping.parent.uid);
    const managedParentChildren = new Set([mapping.source.uid]);
    if (!parentChildren.some((child) => child?.uid === mapping.source.uid)) return false;
    if (parentChildren.some((child) => !managedParentChildren.has(child?.uid))) return false;
    const sourceChildren = children(mapping.source.uid);
    const managedDetailChildren = new Set(
      Object.values(mapping.details || {}).map((detail) => detail?.uid).filter(Boolean),
    );
    for (const detailUid of managedDetailChildren) {
      if (!sourceChildren.some((child) => child?.uid === detailUid)) return false;
    }
    return !sourceChildren.some((child) => !managedDetailChildren.has(child?.uid));
  };

  const updateEvent = async (planUid, event, mapping, force) => {
    let changed = false;
    let localKept = false;
    if (mapping.planUid !== planUid) {
      const currentParent = read(mapping.parent?.uid);
      if (force || currentParent === mapping.parent?.lastSynced) {
        await move({
          uid: mapping.parent.uid,
          parentUid: planUid,
          order: children(planUid).length,
        });
        mapping = { ...mapping, planUid };
        changed = true;
      } else {
        localKept = true;
      }
    }

    const parentResult = await updateManagedBlock({
      mapping: mapping.parent,
      parentUid: planUid,
      incoming: event.parentString,
      force,
      ensureSource: true,
    });
    mapping = { ...mapping, parent: parentResult.mapping };
    changed ||= parentResult.changed;
    localKept ||= parentResult.localKept;

    const sourceResult = await updateManagedBlock({
      mapping: mapping.source,
      parentUid: mapping.parent.uid,
      incoming: event.sourceString,
      force,
    });
    mapping = { ...mapping, source: sourceResult.mapping };
    changed ||= sourceResult.changed;
    localKept ||= sourceResult.localKept;

    const nextDetails = { ...(mapping.details || {}) };
    const incomingDetails = detailsFor(event);
    for (const key of DETAIL_KEYS) {
      const detailResult = await updateManagedBlock({
        mapping: nextDetails[key],
        parentUid: mapping.source.uid,
        incoming: incomingDetails[key],
        force,
      });
      if (detailResult.mapping) nextDetails[key] = detailResult.mapping;
      else delete nextDetails[key];
      changed ||= detailResult.changed;
      localKept ||= detailResult.localKept;
    }

    return {
      mapping: {
        ...mapping,
        calendarId: event.calendarId,
        eventId: event.eventId,
        taskListId: event.taskListId,
        taskId: event.taskId,
        resourceType: event.resourceType,
        details: nextDetails,
      },
      changed,
      localKept,
    };
  };

  const sync = async ({ planUid, events = [], force = false } = {}) => {
    if (!planUid) throw new Error('A Nautilus Log Plan UID is required for Calendar sync.');
    const clockValue = Number(now());
    const observedAt = Number.isFinite(clockValue) ? clockValue : Date.now();
    const state = normalizeState(await loadState(), observedAt);
    const summary = resultSummary();
    for (const event of Array.isArray(events) ? events : []) {
      if (!event?.key) {
        summary.skipped += 1;
        continue;
      }
      const existing = state.events[event.key];
      const existingParent = existing?.parent?.uid ? read(existing.parent.uid) : null;
      const locallyDeleted = Boolean(existing)
        && (existingParent === null || existingParent === undefined);
      if (event.status === 'cancelled') {
        if (!existing) {
          summary.skipped += 1;
          continue;
        }
        if (hasOnlyUntouchedManagedContent(existing)) {
          await remove(existing.parent.uid);
          delete state.events[event.key];
          summary.removed += 1;
        } else {
          state.events[event.key] = observedMapping(existing, event, observedAt);
          recordLocalPreservation(summary, locallyDeleted);
        }
        continue;
      }
      if (!existing) {
        state.events[event.key] = observedMapping(
          await createEvent(planUid, event),
          event,
          observedAt,
        );
        summary.created += 1;
        continue;
      }
      const outcome = await updateEvent(planUid, event, existing, force === true);
      state.events[event.key] = observedMapping(outcome.mapping, event, observedAt);
      if (outcome.changed) summary.updated += 1;
      if (outcome.localKept) recordLocalPreservation(summary, locallyDeleted);
      if (!outcome.changed && !outcome.localKept) summary.skipped += 1;
    }
    const retention = Math.max(0, Number(orphanRetentionMs) || DEFAULT_ORPHAN_RETENTION_MS);
    for (const [key, mapping] of Object.entries(state.events)) {
      const lastSeenAt = Number(mapping?.lastSeenAt);
      if (!Number.isFinite(lastSeenAt) || observedAt - lastSeenAt <= retention) continue;
      const parentUid = mapping?.parent?.uid;
      if (!parentUid || read(parentUid) === null || read(parentUid) === undefined) {
        delete state.events[key];
      }
    }
    await saveState(state);
    return summary;
  };

  return { sync };
}
