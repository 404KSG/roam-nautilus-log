import { readActivePrimaryPlan, showToast } from './timing-roam';
import { alignIntervalToWindow, settledPlanUids } from './log-core';

export const TIDY_COMMAND_LABEL = 'Nautilus Log: Tidy Primary Plan';

function currentMinute(date = new Date()) {
  return (date.getHours() * 60) + date.getMinutes();
}

export function settledUidsForTidy(snapshot, nowMinutes = undefined) {
  const workday = snapshot?.workday;
  const minute = Number.isFinite(nowMinutes) ? nowMinutes : workday?.logicalNowMinutes ?? currentMinute();
  const tasks = (snapshot?.reviewCandidates || snapshot?.reviewTasks || []).map(task => ({
    uid: task?.uid, todo:true, done: task?.status === 'DONE',
  }));
  const events = (snapshot?.fixedEvents || []).map(event => ({ ...event, meeting:true,
    ...(workday ? alignIntervalToWindow({ start:event.start,end:event.end,
      windowStart:workday.startMinutes,windowEnd:workday.endMinutes }) : {}) }));
  return [...new Set(settledPlanUids({ items:[...tasks,...events], nowMinutes:minute }))];
}

function primaryTidyTarget(extensionAPI, date = new Date()) {
  const fallbackMinutes = Number(extensionAPI?.settings?.get?.('todo-duration')) || 15;
  const snapshot = readActivePrimaryPlan(date, {
    'workday-start': extensionAPI?.settings?.get?.('workday-start'),
    'workday-end': extensionAPI?.settings?.get?.('workday-end'),
  }, fallbackMinutes);
  if (snapshot.rendererReadOnly) throw Error('Update this client before changing a newer renderer plan.');
  return {
    planUid: snapshot?.plan?.uid || null,
    settledUids: settledUidsForTidy(snapshot),
    language: extensionAPI?.settings?.get?.('language') === 'zh' ? 'zh' : 'en',
  };
}

export function createTidyCommands({
  extensionAPI,
  tidy,
  resolveTarget = () => primaryTidyTarget(extensionAPI),
  notify = (message) => showToast(message, 'danger'),
} = {}) {
  let initialized = false;

  const run = async () => {
    try {
      const resolved = resolveTarget();
      const target = resolved && typeof resolved.then === 'function'
        ? await resolved
        : resolved;
      return await tidy(target || {});
    } catch (error) {
      console.error('[Nautilus Log] Tidy command failed', error);
      notify(error?.message || 'Nautilus Log could not tidy the Primary Plan.');
      return { ok: false, changed: false, reason: 'failed', error };
    }
  };

  const initialize = () => {
    if (initialized) return false;
    const palette = extensionAPI?.ui?.commandPalette;
    if (!palette?.addCommand || !palette?.removeCommand) {
      return false;
    }
    initialized = true;
    // Deliberately omit defaultHotkey. Roam lists this command in Settings
    // -> Hotkeys, where the user can bind it without a global key listener or
    // collisions with Roam, the browser, or another extension.
    palette.addCommand({ label: TIDY_COMMAND_LABEL, callback: run });
    return true;
  };

  const destroy = () => {
    if (!initialized) return;
    initialized = false;
    try {
      extensionAPI?.ui?.commandPalette?.removeCommand?.({ label: TIDY_COMMAND_LABEL });
    } catch (_error) { /* already removed */ }
  };

  return { initialize, destroy, run };
}
