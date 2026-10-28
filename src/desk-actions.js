import { createGraphWriteGuard } from './graph-write-guard';
import { isNautilusComponent, resolveTaskInstance } from './timing-core';
import { readChildren, readBlockString, blockUidExists, moveGraphBlock, createGraphBlock, updateGraphBlock } from './timing-roam';
import { canonicalDeskReference, createModernReferenceAdapter, DeskReferenceImportError, fingerprintDeskReferenceSource, freezeReferenceDrop, isSafeDeskReferenceUid, isUnsupportedReferenceSource, readDeskDropContext, readStrictReferenceEntity, readStrictReferenceOutline, sameDeskDropContext, stableDeskReferenceUid } from './desk-reference-import';

/** All Desk writes share Tidy's outline lock. A successful host call is not confirmation. */
export function createDeskActions({
  read = readChildren, readString = readBlockString, exists = blockUidExists,
  move = moveGraphBlock, create = createGraphBlock, update = updateGraphBlock,
  generateUid = () => window.roamAlphaAPI.util.generateUID(), runExclusive,
  referenceApi = () => globalThis.window?.roamAlphaAPI, getContext = () => readDeskDropContext(globalThis.window),
  stableReferenceUid = stableDeskReferenceUid,
} = {}) {
  const guard = runExclusive ? null : createGraphWriteGuard('outline');
  const drafts = new Map();
  const imports = new Map();
  let queue = Promise.resolve();
  let destroyed = false;
  const assertActive = (signal) => {
    if (destroyed || signal?.aborted) throw new Error('Desk write was cancelled.');
    guard?.assertActive();
  };
  const outline = (planUid) => {
    assertActive();
    if (!isNautilusComponent(readString(planUid))) throw new Error('The Nautilus plan is no longer available.');
    const rows = read(planUid);
    if (!Array.isArray(rows) || rows.some((r) => !r?.uid || typeof r.string !== 'string'
      || !Number.isInteger(r.order) || r.order < 0)
      || new Set(rows.map((r) => r.uid)).size !== rows.length
      || new Set(rows.map((r) => r.order)).size !== rows.length) throw new Error('The plan outline is unreadable.');
    return [...rows].sort((a, b) => a.order - b.order);
  };
  const exclusive = (action, signal) => {
    const next = queue.then(() => {
      assertActive(signal);
      return runExclusive ? runExclusive(action, { signal }) : guard.run(action, { signal });
    });
    queue = next.catch(() => {});
    return next;
  };
  const sameOrder = (rows, expected) => rows.map((r) => r.uid).join('\0') === expected.join('\0');
  const task = (row) => resolveTaskInstance({ uid: row.uid, localString: row.string, readString });

  const moveTask = ({ planUid, uid, targetUid = null, position = 'before' }) => exclusive(async () => {
    const rows = outline(planUid);
    const isActiveTask = (row) => {
      const item = task(row);
      return item.kind === 'task' && item.status === 'TODO' && item.title && item.title !== '(untitled)';
    };
    const source = rows.find((row) => row.uid === uid);
    if (!source || !isActiveTask(source)) throw new Error('The task is no longer unfinished in this plan.');
    const active = rows.filter(isActiveTask);
    const target = rows.find((row) => row.uid === targetUid);
    if (position !== 'top' && (!target || !active.some((row) => row.uid === targetUid))) throw new Error('The target card changed. Refresh and try again.');
    if (uid === targetUid && position !== 'top') return { changed: false, uid };
    const expected = rows.map((row) => row.uid).filter((id) => id !== uid);
    // Dropping before the first visible task means first in the actual outline,
    // even when hidden events or completed blocks previously preceded it.
    const toTop = position === 'top' || (position === 'before' && targetUid === active[0]?.uid);
    const order = toTop ? 0 : expected.indexOf(targetUid) + (position === 'after' ? 1 : 0);
    expected.splice(order, 0, uid);
    if (sameOrder(rows, expected)) return { changed: false, uid };
    assertActive();
    await move({ uid, parentUid: planUid, order });
    assertActive();
    const confirmed = outline(planUid);
    if (!sameOrder(confirmed, expected)) throw new Error('Roam could not confirm the new block order. Check the original outline before retrying.');
    if (confirmed.some((row) => rows.find((before) => before.uid === row.uid)?.string !== row.string)) {
      throw new Error('The outline changed while moving the task. Check the original outline.');
    }
    return { changed: true, uid, order };
  });

  const importReferenceDrop = ({ planUid, transfer, expectedSourceUid, originContext, insertion, signal } = {}) => {
    let claim, adapter;
    try {
      claim = freezeReferenceDrop(transfer, originContext, expectedSourceUid);
      if (typeof originContext?.graphType !== 'string' || !originContext.graphType || typeof originContext?.userUid !== 'string' || !originContext.userUid) {
        throw new DeskReferenceImportError('A complete graph, type, and user context is required for reference imports.', 'context-changed');
      }
      adapter = createModernReferenceAdapter(typeof referenceApi === 'function' ? referenceApi() : referenceApi);
      if (adapter.api !== originContext.provider) throw new DeskReferenceImportError('The graph provider changed. Start a new drag.', 'context-changed');
    } catch (error) { return Promise.reject(error); }
    const reservationKey = [originContext.graphType, originContext.graphName, planUid, claim.sourceUid].join('\u0000');
    const existing = imports.get(reservationKey);
    if (existing?.pending) return existing.pending;
    const reservation = existing || { attempted: false, pending: null };
    imports.set(reservationKey, reservation);
    const pending = exclusive(async () => {
      const assertContext = () => {
        assertActive(signal);
        const current = getContext();
        if (!sameDeskDropContext(originContext, current) || current?.provider !== adapter.api) {
          throw new DeskReferenceImportError('The graph or user changed. Start a new drag.', 'context-changed');
        }
      };
      const entity = async (uid) => readStrictReferenceEntity(adapter, uid);
      const activeTask = (row) => {
        const item = resolveTaskInstance({
          uid: row.uid, localString: row.string,
          readString: uid => readStrictReferenceEntity(adapter, uid)?.string || '',
        });
        return item.kind === 'task' && item.status === 'TODO' && item.title && item.title !== '(untitled)';
      };
      const sourceUid = claim.sourceUid;
      const canonical = canonicalDeskReference(sourceUid);
      const simpleReference = (row) => {
        const value = String(row?.string || '').trim();
        return value === canonical || value === `((${sourceUid}))`;
      };
      const validSource = (source) => {
        if (!source || source.uid !== sourceUid || sourceUid === planUid || typeof source.string !== 'string' || !source.string.trim()
          || typeof source.title === 'string' || source.parentUids.length !== 1 || !source.parentUids[0] || !source.pageUid
          || source.children.some(child => !child.uid || !Number.isInteger(child.order) || child.order < 0)
          || isUnsupportedReferenceSource(source.string)) {
          throw new DeskReferenceImportError('The source block is no longer a readable ordinary block.', 'invalid-source');
        }
        const instance = resolveTaskInstance({ uid: `preview-${sourceUid}`, localString: canonical, readString: uid => uid === sourceUid ? source.string : '' });
        if (instance.kind !== 'task' || instance.status !== 'TODO' || !instance.title || instance.title === '(untitled)') {
          throw new DeskReferenceImportError('This block cannot become a visible unfinished Desk task.', 'not-a-task');
        }
        return instance;
      };

      assertContext();
      let rows = readStrictReferenceOutline(adapter, planUid);
      const source = await entity(sourceUid);
      assertContext();
      validSource(source);
      const sourceFingerprint = fingerprintDeskReferenceSource(source);
      if (!sourceFingerprint) throw new DeskReferenceImportError('The source block is unreadable.', 'invalid-source');
      if (reservation.attempted && reservation.sourceFingerprint && reservation.sourceFingerprint !== sourceFingerprint) {
        throw new DeskReferenceImportError('The source changed while the reference was being created. Check this plan before retrying.', 'unconfirmed');
      }
      if (rows.some(row => row.uid === sourceUid)) return { status: 'existing-source', sourceUid };
      const duplicate = rows.find(row => simpleReference(row) && activeTask(row));
      if (duplicate) return { status: 'existing-reference', sourceUid, wrapperUid: duplicate.uid, order: duplicate.order };

      const wrapperUid = await stableReferenceUid({ graphName: originContext.graphName, graphType: originContext.graphType || '', planUid, sourceUid });
      assertContext();
      if (!isSafeDeskReferenceUid(wrapperUid)) throw new DeskReferenceImportError('Could not reserve a safe reference ID.', 'uid-unavailable');
      const reservedEntity = await entity(wrapperUid);
      assertContext();
      if (reservedEntity) {
        if (reservedEntity.uid === wrapperUid && reservedEntity.string === canonical && reservedEntity.parentUids.length === 1
          && reservedEntity.parentUids[0] === planUid && reservedEntity.children.length === 0
          && rows.some(row => row.uid === wrapperUid && row.string === canonical)) {
          const row = rows.find(candidate => candidate.uid === wrapperUid);
          return { status: 'existing-reference', sourceUid, wrapperUid, order: row.order };
        }
        throw new DeskReferenceImportError('Reference ID collision: the reserved ID belongs to another block. Nothing was changed.', 'uid-collision');
      }
      // Re-read both plan and source after asynchronous ID/collision checks.
      // The graph lock serializes Nautilus writes, not an external editor.
      assertContext();
      rows = readStrictReferenceOutline(adapter, planUid);
      const refreshedSource = await entity(sourceUid);
      assertContext();
      validSource(refreshedSource);
      if (fingerprintDeskReferenceSource(refreshedSource) !== sourceFingerprint) {
        throw new DeskReferenceImportError('The source changed before the reference could be created.', 'source-changed');
      }
      if (rows.some(row => row.uid === sourceUid)) return { status: 'existing-source', sourceUid };
      const refreshedDuplicate = rows.find(row => simpleReference(row) && activeTask(row));
      if (refreshedDuplicate) return { status: 'existing-reference', sourceUid, wrapperUid: refreshedDuplicate.uid, order: refreshedDuplicate.order };
      if (reservation.attempted) {
        throw new DeskReferenceImportError('Could not confirm the reference. Check this plan before retrying.', 'unconfirmed');
      }

      const active = rows.filter(activeTask);
      let order;
      if (insertion?.kind === 'background') {
        const last = active.at(-1);
        order = last ? rows.findIndex(row => row.uid === last.uid) + 1 : 0;
      } else if ((insertion?.kind === 'before' || insertion?.kind === 'after') && typeof insertion.targetUid === 'string') {
        const targetIndex = rows.findIndex(row => row.uid === insertion.targetUid);
        const target = rows[targetIndex];
        if (targetIndex < 0 || !active.some(row => row.uid === target.uid)) {
          throw new DeskReferenceImportError('The target card changed. Refresh and try again.', 'stale-target');
        }
        order = insertion.kind === 'before' && target.uid === active[0]?.uid ? 0 : targetIndex + (insertion.kind === 'after' ? 1 : 0);
      } else {
        throw new DeskReferenceImportError('The drop target is no longer available.', 'stale-target');
      }
      const expected = rows.map(row => row.uid);
      expected.splice(order, 0, wrapperUid);
      reservation.attempted = true;
      reservation.sourceFingerprint = sourceFingerprint;
      let failure = null;
      try {
        assertContext();
        await adapter.create({ uid: wrapperUid, parentUid: planUid, order, string: canonical, open: true });
      } catch (error) { failure = error; }
      assertContext();
      rows = readStrictReferenceOutline(adapter, planUid);
      const wrapper = await entity(wrapperUid);
      const currentSource = await entity(sourceUid);
      assertContext();
      const sourceAfter = fingerprintDeskReferenceSource(currentSource);
      const confirmed = wrapper && wrapper.uid === wrapperUid && wrapper.string === canonical
        && wrapper.parentUids.length === 1 && wrapper.parentUids[0] === planUid && wrapper.children.length === 0
        && sameOrder(rows, expected) && sourceAfter === sourceFingerprint;
      if (!confirmed) throw failure || new DeskReferenceImportError('Could not confirm the reference. Check this plan before retrying.', 'unconfirmed');
      return { status: 'added', sourceUid, wrapperUid, order };
    }, signal);
    reservation.pending = pending;
    pending.finally(() => { if (reservation.pending === pending) reservation.pending = null; }).catch(() => {});
    return pending;
  };

  const beginDraft = (planUid) => {
    assertActive();
    const uid = generateUid();
    if (typeof uid !== 'string' || !uid || drafts.has(uid)) throw new Error('Could not reserve a new block UID.');
    const draft = { uid, planUid, attempted: false, last: null, pending: null, pendingUpdate: null };
    drafts.set(uid, draft);
    return { uid, planUid };
  };
  const saveDraft = ({ uid, planUid, string }) => exclusive(async () => {
    const draft = drafts.get(uid);
    if (!draft || draft.planUid !== planUid || typeof string !== 'string' || (draft.last === null && !string.trim())) throw new Error('This draft is not available.');
    let rows = outline(planUid);
    let row = rows.find((candidate) => candidate.uid === uid);
    if (draft.last === null && draft.attempted) {
      // An ambiguous create is verification-only. Never mint another UID or
      // blindly repeat a create that might still complete in Roam.
      if (!row || row.string !== draft.pending) throw new Error('Could not confirm the new note. Check the original outline; no duplicate was created.');
      draft.last = row.string;
    }
    if (draft.pendingUpdate !== null) {
      if (!row || row.string !== draft.pendingUpdate) throw new Error('Could not confirm the draft update. Check the original note before retrying.');
      draft.last = draft.pendingUpdate;
      draft.pendingUpdate = null;
    }
    if (draft.last !== null && (!row || row.string !== draft.last)) throw new Error('The new note was changed elsewhere. Desk will not overwrite it.');
    if (draft.last === null) {
      const expected = [uid, ...rows.map((candidate) => candidate.uid)];
      if (row || exists(uid)) throw new Error('The reserved block UID is already in use.');
      draft.pending = string;
      draft.attempted = true;
      assertActive();
      let failure;
      try { await create({ uid, parentUid: planUid, order: 0, string, open: true }); }
      catch (error) { failure = error; }
      assertActive();
      rows = outline(planUid);
      row = rows.find((candidate) => candidate.uid === uid);
      if (!row || row.string !== string || !sameOrder(rows, expected)) throw failure || new Error('Roam could not confirm the new note and its position.');
      draft.last = string;
    } else if (string !== draft.last) {
      if (!row || row.string !== draft.last) throw new Error('The new note was changed elsewhere. Desk will not overwrite it.');
      assertActive();
      draft.pendingUpdate = string;
      let failure;
      try { await update(uid, string); } catch (error) { failure = error; }
      assertActive();
      rows = outline(planUid);
      row = rows.find((candidate) => candidate.uid === uid);
      if (!row || row.string !== string) throw failure || new Error('Roam could not confirm the draft text.');
      draft.last = string;
      draft.pendingUpdate = null;
    }
    return { uid, string: draft.last };
  });
  return {
    moveTask, importReferenceDrop, beginDraft, saveDraft,
    releaseDraft: (uid) => drafts.delete(uid),
    destroy: () => { destroyed = true; guard?.destroy(); drafts.clear(); imports.clear(); },
  };
}
