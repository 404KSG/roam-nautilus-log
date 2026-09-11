import * as logCore from './log-core';
import { createGraphWriteGuard } from './graph-write-guard';
import {
  moveGraphBlock,
  readChildren,
  showActionToast,
  showToast,
  updateGraphBlockOpen,
} from './timing-roam';

const COPY = {
  en: {
    already: 'Plan is already tidy.',
    tidied: (count) => `Tidied ${count} ${count === 1 ? 'item' : 'items'}.`,
    undo: 'Undo',
    undone: 'Tidy undone.',
    changed: 'The Plan changed after Tidy, so Undo was not applied.',
    failed: 'Tidy could not be completed.',
  },
  zh: {
    already: '计划已经整理完毕。',
    tidied: (count) => `已整理 ${count} 项。`,
    undo: '撤销',
    undone: '已撤销整理。',
    changed: '整理后计划发生了变化，因此没有执行撤销。',
    failed: '无法完成整理。',
  },
};

function copyFor(language) {
  return COPY[language === 'zh' ? 'zh' : 'en'];
}

function uidOrder(children) {
  return (Array.isArray(children) ? children : [])
    .slice()
    .sort((left, right) => Number(left?.order) - Number(right?.order))
    .map((child) => child?.uid)
    .filter(Boolean);
}

function equalOrder(left, right) {
  return left.length === right.length && left.every((uid, index) => uid === right[index]);
}

function tokenFor(planUid) {
  return `${planUid}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

export function createPlanTidy({
  read: readRows = readChildren,
  move = moveGraphBlock,
  notify = showToast,
  notifyAction = showActionToast,
  runningTaskUid = () => null,
  setOpen = updateGraphBlockOpen,
  runExclusive,
} = {}) {
  const undoStates = new Map();
  const guard = runExclusive ? null : createGraphWriteGuard('outline');
  let destroyed = false, queue = Promise.resolve(), attempted = 0;
  const assertActive = () => {
    if (destroyed) throw new Error('Tidy was cancelled.');
    guard?.assertActive();
  };
  const read = uid => {
    assertActive();
    const rows = readRows(uid);
    if (!Array.isArray(rows) || rows.some(row=>!row?.uid || typeof row.string !== 'string')
      || new Set(rows.map(row=>row.uid)).size !== rows.length) throw new Error('The Plan outline is unreadable.');
    return rows;
  };
  const write = async action => {
    assertActive();
    attempted++;
    await action();
    assertActive();
  };
  const exclusive = action => {
    const next = queue.then(async () => {
      attempted = 0;
      try {
        assertActive();
        return await (runExclusive ? runExclusive(action) : guard.run(action));
      } catch (error) {
        undoStates.clear();
        error.partial = attempted > 0;
        throw error;
      }
    });
    queue = next.catch(()=>{});
    return next;
  };
  const canNotify = () => { try { assertActive();return true; } catch (_) { return false; } };

  const applyTarget = async (planUid, currentUids, targetUids) => {
    const outlineState = new Map(read(planUid)
      .filter((child) => child?.uid && typeof child?.open === 'boolean')
      .map((child) => [child.uid, child.open]));
    const moves = logCore.childOrderMoves({ currentUids, targetUids });
    const expected = currentUids.slice();
    for (const operation of moves) {
      if (!equalOrder(uidOrder(read(planUid)),expected)) throw new Error('The Plan changed during Tidy; further moves were stopped.');
      await write(() => move({ uid: operation.uid, parentUid: planUid, order: operation.order }));
      expected.splice(operation.order,0,expected.splice(expected.indexOf(operation.uid),1)[0]);
    }
    const confirmedChildren = read(planUid);
    if (!equalOrder(uidOrder(confirmedChildren), targetUids)) {
      throw new Error('Roam could not confirm the final Tidy order.');
    }
    // Roam may recreate moved outline rows and collapse their descendants.
    // Restore only states that actually changed, preserving the user's live
    // working context without issuing writes for every sibling.
    for (const child of confirmedChildren) {
      const previousOpen = outlineState.get(child?.uid);
      if (typeof previousOpen === 'boolean' && child?.open !== previousOpen) {
        await write(() => setOpen(child.uid, previousOpen));
      }
    }
    return moves;
  };

  const applyOpenTarget = async (planUid, targetUids, open) => {
    const targets = new Set(Array.isArray(targetUids) ? targetUids : []);
    if (targets.size === 0) return [];
    const changedUids = [];
    for (const child of read(planUid)) {
      if (!targets.has(child?.uid) || child?.open === open || child.uid === runningTaskUid()) continue;
      if (!read(planUid).some(row=>row.uid===child.uid)) throw new Error('The Plan changed during Tidy.');
      await write(() => setOpen(child.uid, open));
      changedUids.push(child.uid);
    }
    return changedUids;
  };

  const undoUnlocked = async ({ planUid, token, language = 'en' } = {}) => {
    const copy = copyFor(language);
    const state = undoStates.get(planUid);
    if (!state || state.token !== token) return { ok: false, reason: 'expired' };
    const currentUids = uidOrder(read(planUid));
    if (!equalOrder(currentUids, state.targetUids)) {
      undoStates.delete(planUid);
      notify(copy.changed, 'warning');
      return { ok: false, reason: 'changed' };
    }
    try {
      await applyTarget(planUid, currentUids, state.originalUids);
      await applyOpenTarget(planUid, state.collapsedUids, true);
      undoStates.delete(planUid);
      notify(copy.undone, 'success');
      return { ok: true };
    } catch (error) {
      if (canNotify()) notify(error?.message || copy.failed, 'danger');
      return { ok: false, partial: attempted > 0, changed: attempted > 0, reason: 'failed', error };
    }
  };

  const tidyUnlocked = async ({ planUid, settledUids = [], language = 'en' } = {}) => {
    if (!planUid) throw new Error('A Nautilus Log Plan UID is required.');
    const runningUid = runningTaskUid();
    const safeSettled = (Array.isArray(settledUids) ? settledUids : [])
      .filter((uid) => uid && uid !== runningUid);
    const children = read(planUid);
    const originalUids = uidOrder(children);
    const targetUids = logCore.stableTidyOrder({
      items: originalUids.map((uid) => ({ uid })),
      settledUids: safeSettled,
    }).map((item) => item.uid);
    const moves = equalOrder(originalUids, targetUids)
      ? []
      : await applyTarget(planUid, originalUids, targetUids);
    const collapsedUids = await applyOpenTarget(planUid, safeSettled, false);
    const changedUids = new Set([
      ...moves.map((operation) => operation.uid),
      ...collapsedUids,
    ]);
    if (changedUids.size === 0) {
      undoStates.delete(planUid);
      return { ok: true, changed: false, count: 0 };
    }
    const token = tokenFor(planUid);
    undoStates.set(planUid, {
      token,
      originalUids,
      targetUids,
      collapsedUids,
    });
    return { ok: true, changed: true, count: changedUids.size, token };
  };

  const tidy = options => exclusive(() => tidyUnlocked(options));
  const undo = options => exclusive(() => undoUnlocked(options));
  const run = async (options = {}) => {
    const language = options.language === 'zh' ? 'zh' : 'en';
    const copy = copyFor(language);
    try {
      const result = await tidy({ ...options, language });
      if (!result.changed) {
        notify(copy.already, 'primary');
        return result;
      }
      notifyAction({
        message: copy.tidied(result.count),
        actionLabel: copy.undo,
        intent: 'success',
        onAction: () => undo({
          planUid: options.planUid,
          token: result.token,
          language,
        }),
      });
      return result;
    } catch (error) {
      if (canNotify()) notify(error?.message || copy.failed, 'danger');
      return { ok: false, changed: Boolean(error.partial), partial: Boolean(error.partial), reason: 'failed', error };
    }
  };

  return {
    tidy,
    undo,
    run,
    clear: () => undoStates.clear(),
    destroy: () => { destroyed = true;guard?.destroy();undoStates.clear(); },
  };
}
