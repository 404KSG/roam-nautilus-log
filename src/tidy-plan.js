import * as logCore from './log-core';
import {
  moveGraphBlock,
  readChildren,
  showActionToast,
  showToast,
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
} = {}) {
  const undoStates = new Map();

  const applyTarget = async (planUid, currentUids, targetUids) => {
    const moves = logCore.childOrderMoves({ currentUids, targetUids });
    for (const operation of moves) {
      await move({ uid: operation.uid, parentUid: planUid, order: operation.order });
    }
    const confirmed = uidOrder(read(planUid));
    if (!equalOrder(confirmed, targetUids)) {
      throw new Error('Roam could not confirm the final Tidy order.');
    }
    return moves;
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
    if (equalOrder(originalUids, targetUids)) {
      undoStates.delete(planUid);
      return { ok: true, changed: false, count: 0 };
    }
    const moves = await applyTarget(planUid, originalUids, targetUids);
    const token = tokenFor(planUid);
    undoStates.set(planUid, { token, originalUids, targetUids });
    return { ok: true, changed: true, count: moves.length, token };
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
