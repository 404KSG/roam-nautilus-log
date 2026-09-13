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
    undoFailed: 'Tidy undo could not be completed.',
    undoPartial: 'Tidy undo stopped after applying some changes and cannot be retried.',
  },
  zh: {
    already: '计划已经整理完毕。',
    tidied: (count) => `已整理 ${count} 项。`,
    undo: '撤销',
    undone: '已撤销整理。',
    changed: '整理后计划发生了变化，因此没有执行撤销。',
    failed: '无法完成整理。',
    undoFailed: '无法完成撤销整理。',
    undoPartial: '撤销整理已部分执行，无法重试。',
  },
};

const PLAN_CHANGED = 'The Plan changed during Tidy; further writes were stopped.';
const PLAN_CHANGED_SHORT = 'The Plan changed during Tidy.';
const CONFIRM_ORDER = 'Roam could not confirm the final Tidy order.';
const CONFIRM_OPEN = 'Roam could not confirm the Tidy outline state.';

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

function sameUidSet(left, right) {
  return left.length === right.length && left.every((uid) => right.includes(uid));
}

function tokenFor(planUid) {
  return `${planUid}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

function changeFlags(attempted, confirmed) {
  return {
    partial: attempted > 0,
    attempted,
    confirmed,
    changed: confirmed > 0 ? true : (attempted > 0 ? null : false),
  };
}

function undoTokenStillSafe(existing, live, runningUid) {
  const liveOrder = uidOrder(live);
  if (!equalOrder(liveOrder, existing.targetUids)) return false;
  if (!sameUidSet(liveOrder, existing.originalUids)) return false;
  const byUid = new Map(live.map((row) => [row.uid, row]));
  for (const uid of existing.collapsedUids) {
    const row = byUid.get(uid);
    if (!row) return false;
    if (uid !== runningUid && row.open !== false) return false;
  }
  return true;
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
  let destroyed = false;
  let queue = Promise.resolve();
  let attempted = 0;
  let confirmed = 0;

  const assertActive = () => {
    if (destroyed) throw new Error('Tidy was cancelled.');
    guard?.assertActive();
  };

  const read = (uid) => {
    assertActive();
    const rows = readRows(uid);
    if (!Array.isArray(rows)
      || rows.some((row) => !row?.uid || typeof row.string !== 'string')
      || new Set(rows.map((row) => row.uid)).size !== rows.length) {
      throw new Error('The Plan outline is unreadable.');
    }
    return rows;
  };

  const write = async (action) => {
    assertActive();
    attempted += 1;
    await action();
    confirmed += 1;
    assertActive();
  };

  const exclusive = (action, planUid) => {
    const next = queue.then(async () => {
      attempted = 0;
      confirmed = 0;
      try {
        assertActive();
        return await (runExclusive ? runExclusive(action) : guard.run(action));
      } catch (error) {
        if (planUid) undoStates.delete(planUid);
        if (error && typeof error === 'object') {
          error.partial = attempted > 0;
          error.attempted = attempted;
          error.confirmed = confirmed;
        }
        throw error;
      }
    });
    queue = next.catch(() => {});
    return next;
  };

  const canNotify = () => {
    try {
      assertActive();
      return true;
    } catch (_error) {
      return false;
    }
  };

  const findNextOpenWrite = (live, uids, desiredOpenFor, expectedOrder, runningUid) => {
    const targets = Array.isArray(uids) ? uids : [];
    for (const uid of targets) {
      if (!uid || uid === runningUid) continue;
      const desired = desiredOpenFor(uid);
      if (typeof desired !== 'boolean') continue;
      if (!expectedOrder.includes(uid)) continue;
      if (!equalOrder(uidOrder(live), expectedOrder)) {
        throw new Error(PLAN_CHANGED);
      }
      const row = live.find((child) => child.uid === uid);
      if (!row) throw new Error(PLAN_CHANGED_SHORT);
      if (row.open === desired) continue;
      return { uid, open: desired };
    }
    return null;
  };

  const confirmOpenState = (live, expectedOrder, uids, runningUid, shouldBeOpen) => {
    if (!equalOrder(uidOrder(live), expectedOrder)) {
      throw new Error(CONFIRM_ORDER);
    }
    const byUid = new Map(live.map((row) => [row.uid, row]));
    for (const uid of uids) {
      const row = byUid.get(uid);
      if (!row) throw new Error(CONFIRM_OPEN);
      if (uid !== runningUid && row.open !== shouldBeOpen) throw new Error(CONFIRM_OPEN);
    }
  };

  const applyTarget = async (planUid, currentUids, targetUids, initialRows) => {
    const liveStart = initialRows || read(planUid);
    const outlineState = new Map(liveStart
      .filter((child) => child?.uid && typeof child?.open === 'boolean')
      .map((child) => [child.uid, child.open]));
    const operations = logCore.childOrderMoves({ currentUids, targetUids });
    const expected = currentUids.slice();
    let live = liveStart;
    const moves = [];
    for (const operation of operations) {
      if (!equalOrder(uidOrder(live), expected)) {
        throw new Error(PLAN_CHANGED);
      }
      await write(() => move({ uid: operation.uid, parentUid: planUid, order: operation.order }));
      expected.splice(operation.order, 0, expected.splice(expected.indexOf(operation.uid), 1)[0]);
      live = read(planUid);
      moves.push(operation);
    }
    if (!equalOrder(uidOrder(live), targetUids)) {
      throw new Error(CONFIRM_ORDER);
    }
    const restored = await applyOpenTarget(
      planUid,
      targetUids,
      (uid) => outlineState.get(uid),
      targetUids,
      live,
      false,
    );
    return { moves, live: restored.live };
  };

  const applyOpenTarget = async (planUid, targetUids, open, expectedOrder, liveRows, skipRunning = true) => {
    const targets = Array.isArray(targetUids) ? targetUids.filter(Boolean) : [];
    const changedUids = [];
    let live = liveRows || read(planUid);
    let runningUid = skipRunning ? runningTaskUid() : null;
    const desiredOpenFor = typeof open === 'function' ? open : () => open;
    for (const uid of targets) {
      if (!uid || uid === runningUid) continue;
      const desired = desiredOpenFor(uid);
      if (typeof desired !== 'boolean') continue;
      if (!expectedOrder.includes(uid)) continue;
      if (!equalOrder(uidOrder(live), expectedOrder)) {
        throw new Error(PLAN_CHANGED);
      }
      const row = live.find((child) => child.uid === uid);
      if (!row) throw new Error(PLAN_CHANGED_SHORT);
      if (row.open === desired) continue;
      await write(() => setOpen(uid, desired));
      changedUids.push(uid);
      live = read(planUid);
      if (skipRunning) runningUid = runningTaskUid();
    }
    return { changedUids, live };
  };

  const undoUnlocked = async ({ planUid, token, language = 'en' } = {}) => {
    const copy = copyFor(language);
    const state = undoStates.get(planUid);
    if (!state || state.token !== token) return { ok: false, reason: 'expired' };
    const currentRows = read(planUid);
    const currentUids = uidOrder(currentRows);
    if (!equalOrder(currentUids, state.targetUids)) {
      undoStates.delete(planUid);
      notify(copy.changed, 'warning');
      return { ok: false, reason: 'changed' };
    }
    try {
      let live = currentRows;
      if (!equalOrder(currentUids, state.originalUids)) {
        await applyTarget(planUid, currentUids, state.originalUids, live);
        live = read(planUid);
        if (!equalOrder(uidOrder(live), state.originalUids)) {
          throw new Error(CONFIRM_ORDER);
        }
      }
      let runningUid = runningTaskUid();
      const expandNeeded = findNextOpenWrite(
        live,
        state.collapsedUids,
        () => true,
        state.originalUids,
        runningUid,
      );
      if (expandNeeded) {
        await applyOpenTarget(planUid, state.collapsedUids, true, state.originalUids, live, true);
        live = read(planUid);
        runningUid = runningTaskUid();
      }
      confirmOpenState(live, state.originalUids, state.collapsedUids, runningUid, true);
      undoStates.delete(planUid);
      notify(copy.undone, 'success');
      return { ok: true };
    } catch (error) {
      undoStates.delete(planUid);
      const flags = changeFlags(attempted, confirmed);
      if (canNotify()) {
        notify(error?.message || (attempted > 0 ? copy.undoPartial : copy.undoFailed), 'danger');
      }
      return {
        ok: false,
        reason: 'failed',
        error,
        ...flags,
      };
    }
  };

  const tidyUnlocked = async ({ planUid, settledUids = [] } = {}) => {
    if (!planUid) throw new Error('A Nautilus Log Plan UID is required.');
    let runningUid = runningTaskUid();
    const safeSettled = (Array.isArray(settledUids) ? settledUids : [])
      .filter((uid) => uid && uid !== runningUid);
    const children = read(planUid);
    const originalUids = uidOrder(children);
    const targetUids = logCore.stableTidyOrder({
      items: originalUids.map((uid) => ({ uid })),
      settledUids: safeSettled,
    }).map((item) => item.uid);
    let live = children;
    let moves = [];
    if (!equalOrder(originalUids, targetUids)) {
      const applied = await applyTarget(planUid, originalUids, targetUids, children);
      moves = applied.moves;
      live = read(planUid);
      if (!equalOrder(uidOrder(live), targetUids)) {
        throw new Error(CONFIRM_ORDER);
      }
    }
    runningUid = runningTaskUid();
    let collapsedUids = [];
    const collapseNeeded = findNextOpenWrite(
      live,
      safeSettled,
      () => false,
      targetUids,
      runningUid,
    );
    if (collapseNeeded) {
      const appliedOpen = await applyOpenTarget(
        planUid,
        safeSettled,
        false,
        targetUids,
        live,
        true,
      );
      collapsedUids = appliedOpen.changedUids;
      live = read(planUid);
      runningUid = runningTaskUid();
    }
    const changedUids = new Set([
      ...moves.map((operation) => operation.uid),
      ...collapsedUids,
    ]);
    if (changedUids.size === 0) {
      const existing = undoStates.get(planUid);
      if (!existing || !undoTokenStillSafe(existing, live, runningUid)) {
        undoStates.delete(planUid);
      }
      return { ok: true, changed: false, count: 0 };
    }
    confirmOpenState(live, targetUids, collapsedUids, runningUid, false);
    const token = tokenFor(planUid);
    undoStates.set(planUid, {
      token,
      originalUids,
      targetUids,
      collapsedUids,
    });
    return { ok: true, changed: true, count: changedUids.size, token };
  };

  const tidy = (options) => exclusive(() => tidyUnlocked(options), options?.planUid);
  const undo = (options) => exclusive(() => undoUnlocked(options), options?.planUid);
  const run = async (options = {}) => {
    const language = options.language === 'zh' ? 'zh' : 'en';
    const copy = copyFor(language);
    try {
      const result = await tidy({ ...options, language });
      try {
        if (!result.changed) {
          notify(copy.already, 'primary');
        } else {
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
        }
      } catch (_notifyError) {
        // Graph writes already finished. Do not rewrite the result as unchanged.
        return result;
      }
      return result;
    } catch (error) {
      if (canNotify()) notify(error?.message || copy.failed, 'danger');
      const attemptedCount = Number(error?.attempted) || 0;
      const confirmedCount = Number(error?.confirmed) || 0;
      return {
        ok: false,
        ...changeFlags(attemptedCount, confirmedCount),
        reason: 'failed',
        error,
      };
    }
  };

  return {
    tidy,
    undo,
    run,
    clear: () => undoStates.clear(),
    destroy: () => {
      destroyed = true;
      guard?.destroy();
      undoStates.clear();
    },
  };
}
