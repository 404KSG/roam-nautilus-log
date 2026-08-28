import { readPrimaryPlan, showToast } from './timing-roam';

export const TIDY_COMMAND_LABEL = 'Nautilus Log: Tidy Primary Plan';

function currentMinute(date = new Date()) {
  return (date.getHours() * 60) + date.getMinutes();
}

export function settledUidsForTidy(snapshot, nowMinutes = currentMinute()) {
  const completedTasks = (snapshot?.reviewCandidates || snapshot?.reviewTasks || [])
    .filter((task) => task?.status === 'DONE')
    .map((task) => task?.uid);
  const settledEvents = (snapshot?.fixedEvents || [])
    .filter((event) => event?.done === true
      || (Number.isFinite(Number(event?.end)) && Number(event.end) <= nowMinutes))
    .map((event) => event?.uid);
  return [...new Set([...completedTasks, ...settledEvents].filter(Boolean))];
}

function primaryTidyTarget(extensionAPI, date = new Date()) {
  const fallbackMinutes = Number(extensionAPI?.settings?.get?.('todo-duration')) || 15;
  const snapshot = readPrimaryPlan(date, fallbackMinutes);
  return {
    planUid: snapshot?.plan?.uid || null,
    settledUids: settledUidsForTidy(snapshot, currentMinute(date)),
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
      const target = await resolveTarget();
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
