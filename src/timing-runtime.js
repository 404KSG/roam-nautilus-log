import * as timingCore from './timing-core';
import {
  closeClock,
  completeTask,
  createRunningClock,
  deleteClock,
  frontBlockInRightSidebar,
  legacyLogbookIsRunning,
  openTaskInMainWindow,
  openTaskInRightSidebar,
  openPrimaryPlan,
  readAllEntries,
  readBlockString,
  readPrimaryPlan,
  showToast,
  updateGraphBlock,
} from './timing-roam';

const POMODORO_STATE_KEY = 'actual-time-pomodoro-state';
const REFRESH_INTERVAL_MS = 15_000;

function currentPomodoro(extensionAPI, focused) {
  const saved = extensionAPI.settings.get(POMODORO_STATE_KEY);
  if (!focused) {
    if (saved) extensionAPI.settings.set(POMODORO_STATE_KEY, null);
    return null;
  }
  if (saved && Number.isFinite(Number(saved.startedAt))) return { startedAt: Number(saved.startedAt) };
  return { startedAt: focused.start.getTime() };
}

export function createTimingRuntime({ extensionAPI, now = () => new Date() }) {
  let destroyed = false;
  let ticker = null;
  let refreshHandle = null;
  let refreshHandleKind = null;
  let refreshPromise = null;
  let resolveRefresh = null;
  let mutationQueue = Promise.resolve();
  let snapshot = {
    revision: 0,
    status: 'loading',
    notice: '',
    planSnapshot: null,
    entries: [],
    activeWork: { focused: null, recent: [], items: [], count: 0, windowMinutes: 45 },
    pomodoro: null,
    now: now(),
  };
  const listeners = new Set();

  const publish = () => {
    for (const listener of listeners) {
      try { listener(snapshot); } catch (error) { console.error('[Nautilus Log] timing listener failed', error); }
    }
  };

  const setPomodoro = async (value) => {
    snapshot = { ...snapshot, pomodoro: value };
    await extensionAPI.settings.set(POMODORO_STATE_KEY, value);
  };

  const refresh = ({ notice = '' } = {}) => {
    if (destroyed) return snapshot;
    try {
      const planSnapshot = readPrimaryPlan(now(), Number(extensionAPI.settings.get('todo-duration')) || 15);
      const entries = readAllEntries();
      const recentRetention = extensionAPI.settings.get('recent-retention-minutes') ?? 45;
      const activeWork = timingCore.buildActiveWork(entries, now(), recentRetention);
      const pomodoro = currentPomodoro(extensionAPI, activeWork.focused);
      snapshot = {
        revision: snapshot.revision + 1,
        status: 'ready',
        notice,
        planSnapshot,
        entries,
        activeWork,
        pomodoro,
        now: now(),
      };
    } catch (error) {
      snapshot = {
        ...snapshot,
        revision: snapshot.revision + 1,
        status: 'error',
        notice: error.message || 'Timing data could not be refreshed.',
        now: now(),
      };
    }
    publish();
    return snapshot;
  };

  const requestRefresh = ({ notice = '' } = {}) => {
    if (destroyed) return Promise.resolve(snapshot);
    if (refreshPromise) return refreshPromise;
    refreshPromise = new Promise((resolve) => {
      resolveRefresh = resolve;
      const run = () => {
        refreshHandle = null;
        refreshHandleKind = null;
        let next = snapshot;
        try { next = refresh({ notice }); }
        finally {
          const finish = resolveRefresh;
          resolveRefresh = null;
          refreshPromise = null;
          finish?.(next);
        }
      };
      if (typeof window.requestIdleCallback === 'function') {
        refreshHandleKind = 'idle';
        refreshHandle = window.requestIdleCallback(run, { timeout: 1200 });
      } else {
        refreshHandleKind = 'timeout';
        refreshHandle = window.setTimeout(run, 0);
      }
    });
    return refreshPromise;
  };

  const enqueue = (operation) => {
    const run = mutationQueue.then(async () => {
      if (destroyed) throw new Error('Actual Time Tracking is no longer active.');
      snapshot = { ...snapshot, revision: snapshot.revision + 1, status: 'working', notice: '' };
      publish();
      try {
        return await operation();
      } catch (error) {
        refresh({ notice: error.message || 'The graph change could not be confirmed.' });
        throw error;
      }
    });
    mutationQueue = run.catch(() => undefined);
    return run;
  };

  const closeEntriesAt = async (entries, instant) => {
    for (const entry of entries.filter((candidate) => candidate.running)) {
      await closeClock(entry, instant);
    }
  };

  const closeDoneClocks = async (entries = readAllEntries()) => {
    const doneRunning = entries.filter((entry) => entry.running && entry.status === 'DONE');
    if (doneRunning.length === 0) return false;
    await closeEntriesAt(doneRunning, now());
    if (!timingCore.chooseFocusedEntry(readAllEntries())) await setPomodoro(null);
    return true;
  };

  const reconcileLegacyOverlap = async () => {
    const entries = readAllEntries();
    const running = entries.filter((entry) => entry.running).sort((left, right) => right.start - left.start);
    if (running.length <= 1) return;
    const focused = running[0];
    for (const stale of running.slice(1)) {
      await updateGraphBlock(stale.clockUid, timingCore.formatClockLine(stale.start, focused.start));
    }
    const remaining = readAllEntries().filter((entry) => entry.running);
    if (remaining.length !== 1 || remaining[0].clockUid !== focused.clockUid) {
      throw new Error('Legacy overlapping CLOCK records could not be reconciled.');
    }
  };

  const startTask = (taskUid) => {
    const taskString = readBlockString(taskUid);
    if (timingCore.taskStatus(taskString) !== 'TODO') {
      return Promise.reject(new Error('Only an unfinished TODO can own the Timing Line.'));
    }
    if (extensionAPI.settings.get('timing-line-sidebar') !== false) {
      void frontBlockInRightSidebar(taskUid).then((result) => {
        if (!result?.ok && !result?.skipped) showToast(result?.message || 'The task started, but Roam could not show it at the top of the right sidebar.');
      });
    }
    return enqueue(async () => {
      const before = readAllEntries();
      const focused = timingCore.chooseFocusedEntry(before);
      const instant = now();
      if (focused?.taskUid === taskUid) {
        return refresh();
      }
      await closeEntriesAt(before, instant);
      await createRunningClock(taskUid, instant);
      await setPomodoro(timingCore.nextPomodoroState(snapshot.pomodoro, {
        action: focused ? 'switch' : 'start',
        nowMs: instant.getTime(),
      }));
      return refresh();
    });
  };

  const stopTask = () => enqueue(async () => {
    const entries = readAllEntries();
    const running = entries.filter((entry) => entry.running);
    if (running.length === 0) {
      await setPomodoro(null);
      return refresh();
    }
    await closeEntriesAt(running, now());
    await setPomodoro(timingCore.nextPomodoroState(snapshot.pomodoro, { action: 'stop' }));
    return refresh();
  });

  const finishTask = (taskUid) => enqueue(async () => {
    const instant = now();
    const entries = readAllEntries();
    const ownedRunning = entries.filter((entry) => entry.running && entry.taskUid === taskUid);
    await closeEntriesAt(ownedRunning, instant);
    await completeTask(taskUid);
    if (ownedRunning.length > 0) await setPomodoro(null);
    return refresh();
  });

  const deleteCurrentClock = (taskUid) => enqueue(async () => {
    const focused = timingCore.chooseFocusedEntry(readAllEntries());
    if (!focused || focused.taskUid !== taskUid) {
      throw new Error('Only the current Timing CLOCK can be deleted.');
    }
    await deleteClock(focused);
    await setPomodoro(null);
    return refresh();
  });

  const initialize = async () => {
    if (legacyLogbookIsRunning()) {
      const message = 'Disable Roam Logbook before enabling Nautilus Log Actual Time Tracking. Only one extension may write CLOCK records.';
      showToast(message, 'danger');
      throw new Error(message);
    }
    await reconcileLegacyOverlap();
    await closeDoneClocks();
    refresh();
    let lastGraphRefresh = Date.now();
    ticker = window.setInterval(() => {
      if (destroyed) return;
      snapshot = { ...snapshot, now: now() };
      if (Date.now() - lastGraphRefresh >= REFRESH_INTERVAL_MS) {
        lastGraphRefresh = Date.now();
        void requestRefresh().then((next) => {
          if (next.entries.some((entry) => entry.running && entry.status === 'DONE')) {
            enqueue(async () => {
              await closeDoneClocks(next.entries);
              return refresh();
            }).catch((error) => console.error('[Nautilus Log] DONE clock reconciliation failed', error));
          }
        });
      } else {
        publish();
      }
    }, 1000);
    return snapshot;
  };

  const disable = () => enqueue(async () => {
    const entries = readAllEntries();
    await closeEntriesAt(entries, now());
    await setPomodoro(null);
    refresh();
    destroy();
    return true;
  });

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    if (ticker !== null) window.clearInterval(ticker);
    ticker = null;
    if (refreshHandle !== null) {
      if (refreshHandleKind === 'idle') window.cancelIdleCallback?.(refreshHandle);
      else window.clearTimeout(refreshHandle);
    }
    refreshHandle = null;
    refreshHandleKind = null;
    resolveRefresh?.(snapshot);
    resolveRefresh = null;
    refreshPromise = null;
    listeners.clear();
  }

  return {
    initialize,
    refresh,
    requestRefresh,
    startTask,
    stopTask,
    completeTask: finishTask,
    deleteCurrentClock,
    locate: () => openPrimaryPlan(snapshot.planSnapshot?.plan?.uid),
    openTask: (taskUid, { sidebar = false } = {}) => (
      sidebar ? openTaskInRightSidebar(taskUid) : openTaskInMainWindow(taskUid)
    ),
    disable,
    destroy,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    },
    isDestroyed: () => destroyed,
  };
}
