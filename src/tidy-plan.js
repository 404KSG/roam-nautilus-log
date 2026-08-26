import * as logCore from './log-core';
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
  read = readChildren,
  move = moveGraphBlock,
  notify = showToast,
  notifyAction = showActionToast,
  runningTaskUid = () => null,
  setOpen = updateGraphBlockOpen,
} = {}) {
  const undoStates = new Map();

  const applyTarget = async (planUid, currentUids, targetUids) => {
    const outlineState = new Map(read(planUid)
      .filter((child) => child?.uid && typeof child?.open === 'boolean')
      .map((child) => [child.uid, child.open]));
    const moves = logCore.childOrderMoves({ currentUids, targetUids });
    for (const operation of moves) {
      await move({ uid: operation.uid, parentUid: planUid, order: operation.order });
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
        await setOpen(child.uid, previousOpen);
      }
    }
    return moves;
  };

  const applyOpenTarget = async (planUid, targetUids, open) => {
    const targets = new Set(Array.isArray(targetUids) ? targetUids : []);
    if (targets.size === 0) return [];
    const changedUids = [];
    for (const child of read(planUid)) {
      if (!targets.has(child?.uid) || child?.open === open) continue;
      await setOpen(child.uid, open);
      changedUids.push(child.uid);
    }
    return changedUids;
  };

  const undo = async ({ planUid, token, language = 'en' } = {}) => {
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
      notify(error?.message || copy.failed, 'danger');
      return { ok: false, reason: 'failed', error };
    }
  };

  const tidy = async ({ planUid, settledUids = [], language = 'en' } = {}) => {
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
      notify(error?.message || copy.failed, 'danger');
      return { ok: false, changed: false, reason: 'failed', error };
    }
  };

  return {
    tidy,
    undo,
    run,
    clear: () => undoStates.clear(),
  };
}
