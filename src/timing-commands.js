import * as timingCore from './timing-core';
import { getFocusedBlockUid, readBlockString, showToast } from './timing-roam';

const PALETTE_LABELS = Object.freeze([
  'Nautilus Log: 1. Focus current block',
  'Nautilus Log: 2. Clock out Timing Line',
  'Nautilus Log: 3. Locate Primary Plan',
]);
const CONTEXT_CLOCK_IN = 'Nautilus Log: Clock in';
const CONTEXT_CLOCK_OUT = 'Nautilus Log: Clock out';

export function createTimingCommands({
  runtime,
  extensionAPI,
  getFocusedUid = getFocusedBlockUid,
  getString = readBlockString,
  notify = (message) => showToast(message, 'warning'),
} = {}) {
  let initialized = false;

  const run = async (action) => {
    try {
      return await action();
    } catch (error) {
      console.error('[Nautilus Log] timing command failed', error);
      notify(error?.message || 'Nautilus Log could not complete that action.');
      return undefined;
    }
  };

  const unfinishedTask = (uid, fallback = '') => {
    const string = uid ? (getString(uid) ?? fallback) : fallback;
    return timingCore.taskStatus(string) === 'TODO';
  };

  const focusCurrent = () => run(async () => {
    const uid = getFocusedUid();
    if (!uid) throw new Error('Focus an unfinished TODO block before starting timing.');
    if (!unfinishedTask(uid)) throw new Error('Only an unfinished TODO can own the Timing Line.');
    return runtime.startTask(uid);
  });

  const initialize = () => {
    if (initialized) return false;
    initialized = true;
    const palette = extensionAPI?.ui?.commandPalette;
    const contextMenu = window.roamAlphaAPI?.ui?.blockContextMenu;
    if (!palette?.addCommand || !palette?.removeCommand) {
      throw new Error('Roam command-palette actions are unavailable.');
    }

    // Deliberately omit defaultHotkey. Roam exposes these actions in Settings
    // → Hotkeys, where the user can bind them without a global listener or a
    // collision with an existing graph shortcut.
    palette.addCommand({ label: PALETTE_LABELS[0], callback: focusCurrent });
    palette.addCommand({ label: PALETTE_LABELS[1], callback: () => run(() => runtime.stopTask()) });
    palette.addCommand({ label: PALETTE_LABELS[2], callback: () => run(() => runtime.locate()) });

    if (contextMenu?.addCommand) {
      contextMenu.addCommand({
        label: CONTEXT_CLOCK_IN,
        'display-conditional': (context) => unfinishedTask(context?.['block-uid'], context?.['block-string'] || ''),
        callback: (context) => run(() => runtime.startTask(context?.['block-uid'])),
      });
      contextMenu.addCommand({
        label: CONTEXT_CLOCK_OUT,
        'display-conditional': (context) => runtime.getSnapshot().activeWork?.focused?.taskUid === context?.['block-uid'],
        callback: () => run(() => runtime.stopTask()),
      });
    }
    return true;
  };

  const destroy = () => {
    if (!initialized) return;
    initialized = false;
    const palette = extensionAPI?.ui?.commandPalette;
    for (const label of PALETTE_LABELS) {
      try { palette?.removeCommand?.({ label }); } catch (_error) { /* already removed */ }
    }
    const contextMenu = window.roamAlphaAPI?.ui?.blockContextMenu;
    for (const label of [CONTEXT_CLOCK_IN, CONTEXT_CLOCK_OUT]) {
      try { contextMenu?.removeCommand?.({ label }); } catch (_error) { /* already removed */ }
    }
  };

  return { initialize, destroy, focusCurrent };
}

export { PALETTE_LABELS, CONTEXT_CLOCK_IN, CONTEXT_CLOCK_OUT };
