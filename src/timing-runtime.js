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
  warmRightSidebarWindowCache,
} from './timing-roam';

const POMODORO_STATE_KEY = 'actual-time-pomodoro-state';
const REFRESH_INTERVAL_MS = 15_000;

function scheduleNextTask(callback) {
  const host = typeof window !== 'undefined' ? window : globalThis;
  const timer = host.setTimeout(callback, 0);
  return () => host.clearTimeout(timer);
}

function currentPomodoro(extensionAPI, focused) {
  const saved = extensionAPI.settings.get(POMODORO_STATE_KEY);
  if (!focused) {
    if (saved) extensionAPI.settings.set(POMODORO_STATE_KEY, null);
    return null;
  }
  if (saved && Number.isFinite(Number(saved.startedAt))) return { startedAt: Number(saved.startedAt) };
  return { startedAt: focused.start.getTime() };
}

export function createTimingRuntime({
  extensionAPI,
  now = () => new Date(),
  scheduleMutationStart = scheduleNextTask,
}) {
  let destroyed = false;
  let ticker = null;
  let cancelSidebarWarmup = null;
  let refreshHandle = null;
  let refreshHandleKind = null;
  let refreshPromise = null;
  let resolveRefresh = null;
  let mutationQueue = Promise.resolve();
  const pendingMutationStarts = new Set();
  let snapshot = {
    revision: 0,
    status: 'loading',
    notice: '',
    planSnapshot: null,
    entries: [],
    dailyReview: timingCore.buildDailyReview(),
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

  const refresh = ({ notice = '', planSnapshot: suppliedPlanSnapshot, entries: suppliedEntries } = {}) => {
    if (destroyed) return snapshot;
    try {
      const currentNow = now();
      const planSnapshot = suppliedPlanSnapshot === undefined
        ? readPrimaryPlan(currentNow, Number(extensionAPI.settings.get('todo-duration')) || 15)
        : suppliedPlanSnapshot;
      const entries = suppliedEntries === undefined ? readAllEntries() : suppliedEntries;
      const reviewTasks = planSnapshot?.reviewTasks || (planSnapshot?.plan
        ? timingCore.projectReviewTasks(
          planSnapshot.rows,
          planSnapshot.plan.uid,
          Number(extensionAPI.settings.get('todo-duration')) || 15,
        )
        : []);
      const dailyReview = timingCore.buildDailyReview({ tasks: reviewTasks, entries, now: currentNow });
      const recentRetention = extensionAPI.settings.get('recent-retention-minutes') ?? 45;
      const activeWork = timingCore.buildActiveWork(entries, currentNow, recentRetention);
      const pomodoro = currentPomodoro(extensionAPI, activeWork.focused);
      snapshot = {
        revision: snapshot.revision + 1,
        status: 'ready',
        notice,
        planSnapshot,
        entries,
        dailyReview,
        activeWork,
        pomodoro,
        now: currentNow,
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

  const cancelScheduledRefresh = () => {
    if (refreshHandle === null) return false;
    if (refreshHandleKind === 'idle') window.cancelIdleCallback?.(refreshHandle);
    else window.clearTimeout(refreshHandle);
    refreshHandle = null;
    refreshHandleKind = null;
    const finish = resolveRefresh;
    resolveRefresh = null;
    refreshPromise = null;
    finish?.(snapshot);
    return true;
  };

  const waitForMutationStart = () => new Promise((resolve, reject) => {
    let settled = false;
    let cancelScheduled = null;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      pendingMutationStarts.delete(pending);
      callback();
    };
    const pending = {
      cancel() {
        if (settled) return;
        try { cancelScheduled?.(); } catch (_error) { /* Host cancellation is best effort. */ }
        finish(() => resolve(false));
      },
    };
    pendingMutationStarts.add(pending);
    try {
      cancelScheduled = scheduleMutationStart(() => finish(() => resolve(true)));
      if (typeof cancelScheduled !== 'function') cancelScheduled = null;
    } catch (error) {
      finish(() => reject(error));
    }
  });

  const enqueue = (operation, { deferStart = false } = {}) => {
    const run = mutationQueue.then(async () => {
      // A scheduled graph refresh is lower priority than an explicit user
      // mutation. Cancel it before it can compete with Clock Out on the main
      // thread; the mutation schedules a fresh authoritative read afterward.
      cancelScheduledRefresh();
      if (deferStart) {
        const scheduled = await waitForMutationStart();
        if (!scheduled) throw new Error('Actual Time Tracking is no longer active.');
      }
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
    const updated = new Map();
    for (const entry of entries.filter((candidate) => candidate.running)) {
      const closed = await closeClock(entry, instant);
      if (closed) updated.set(entry.clockUid, closed);
    }
    if (updated.size === 0) return entries;
    return entries.map((entry) => updated.get(entry.clockUid) || entry);
  };

  const closeDoneClocks = async (entries = readAllEntries()) => {
    const doneRunning = entries.filter((entry) => entry.running && entry.status === 'DONE');
    if (doneRunning.length === 0) return false;
    await closeEntriesAt(doneRunning, now());
    const closedUids = new Set(doneRunning.map((entry) => entry.clockUid));
    const remainingEntries = entries.filter((entry) => !closedUids.has(entry.clockUid));
    if (!timingCore.chooseFocusedEntry(remainingEntries)) await setPomodoro(null);
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
    // Sidebar navigation is reversible UI feedback, so begin it from the
    // trusted Plan-row UID before graph validation and CLOCK confirmation.
    // This mirrors native Roam Logbook: the graph mutation remains the sole
    // authority, but the selected task starts rendering immediately.
    const hasSidebarIntent = extensionAPI.settings.get('timing-line-sidebar') !== false;
    if (hasSidebarIntent) {
      void frontBlockInRightSidebar(taskUid).then((result) => {
        if (!result?.ok && !result?.skipped) showToast(result?.message || 'The task started, but Roam could not show it at the top of the right sidebar.');
      });
    }
    return enqueue(async () => {
      const taskString = readBlockString(taskUid);
      if (timingCore.taskStatus(taskString) !== 'TODO') {
        throw new Error('Only an unfinished TODO can own the Timing Line.');
      }
      const before = readAllEntries();
      const focused = timingCore.chooseFocusedEntry(before);
      const instant = now();
      if (focused?.taskUid === taskUid) {
        return refresh({ planSnapshot: snapshot.planSnapshot, entries: before });
      }
      await closeEntriesAt(before, instant);
      const created = await createRunningClock(taskUid, instant);
      await setPomodoro(timingCore.nextPomodoroState(snapshot.pomodoro, {
        action: focused ? 'switch' : 'start',
        nowMs: instant.getTime(),
      }));
      return refresh({ planSnapshot: snapshot.planSnapshot, entries: created.entries });
    }, { deferStart: hasSidebarIntent });
  };

  const stopTask = () => enqueue(async () => {
    // The visible Timing Line already carries one confirmed CLOCK UID. Close
    // that exact block and update the cached Plan/entries projection first;
    // an idle aggregate refresh then reconciles any external graph changes.
    const entries = snapshot.entries;
    const running = entries.filter((entry) => entry.running);
    if (running.length === 0) {
      await setPomodoro(null);
      const next = refresh({ planSnapshot: snapshot.planSnapshot, entries });
      void requestRefresh();
      return next;
    }
    const updatedEntries = await closeEntriesAt(entries, now());
    await setPomodoro(timingCore.nextPomodoroState(snapshot.pomodoro, { action: 'stop' }));
    const next = refresh({ planSnapshot: snapshot.planSnapshot, entries: updatedEntries });
    void requestRefresh();
    return next;
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
    if (extensionAPI.settings.get('timing-line-sidebar') !== false) {
      cancelSidebarWarmup = scheduleMutationStart(() => {
        cancelSidebarWarmup = null;
        if (!destroyed) void warmRightSidebarWindowCache();
      });
    }
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
    cancelSidebarWarmup?.();
    cancelSidebarWarmup = null;
    for (const pending of [...pendingMutationStarts]) pending.cancel();
    cancelScheduledRefresh();
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
