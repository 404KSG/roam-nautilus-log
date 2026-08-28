import * as timingCore from './timing-core';
import * as logCore from './log-core';
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
  pageTitleFor,
  projectPrimaryPlanPull,
  readAllEntries,
  readEntriesForTaskUids,
  readBlockString,
  readPrimaryPlan,
  showToast,
  updateGraphBlock,
  warmRightSidebarWindowCache,
} from './timing-roam';

const POMODORO_STATE_KEY = 'actual-time-pomodoro-state';
const STANDALONE_POMODORO_STATE_KEY = 'standalone-pomodoro-state';
const RECOVERY_REFRESH_INTERVAL_MS = 5 * 60_000;

function executionProjection(planSnapshot, currentNow, extensionAPI) {
  if (!planSnapshot?.plan) return null;
  const schedule = logCore.normalizeScheduleSettings({
    workdayStart: extensionAPI.settings.get('workday-start') ?? 5,
    workdayEnd: extensionAPI.settings.get('workday-end') ?? 21,
  });
  const nowMinutes = currentNow.getHours() * 60 + currentNow.getMinutes();
  const pendingTasks = (planSnapshot.tasks || []).map((task) => ({
    ...task,
    todo: true,
    done: false,
    // The shared scheduler owns progress reduction. Passing remainingMinutes
    // here would apply the same progress a second time.
    duration: Number(task.plannedMinutes) || 0,
  }));
  const fixedEvents = (planSnapshot.fixedEvents || []).map((event) => ({
    ...event,
    ...logCore.alignIntervalToWindow({
      start: event.start,
      end: event.end,
      windowStart: schedule.startMinutes,
      windowEnd: schedule.endMinutes,
    }),
  }));
  return {
    ...logCore.calculateCapacity({
      startMinutes: schedule.startMinutes,
      endMinutes: schedule.endMinutes,
      nowMinutes,
      fixedEvents,
      allFixedEvents: fixedEvents,
      pendingTasks,
    }),
    nowMinutes,
    startMinutes: schedule.startMinutes,
    endMinutes: schedule.endMinutes,
  };
}

function scheduleNextTask(callback) {
  const host = typeof window !== 'undefined' ? window : globalThis;
  const timer = host.setTimeout(callback, 0);
  return () => host.clearTimeout(timer);
}

function currentPomodoro(extensionAPI, focused) {
  const saved = extensionAPI.settings.get(POMODORO_STATE_KEY);
  if (!focused) return null;
  if (saved && Number.isFinite(Number(saved.startedAt))) return { startedAt: Number(saved.startedAt) };
  return { startedAt: focused.start.getTime() };
}

function currentStandalonePomodoro(extensionAPI, focused) {
  if (focused) return null;
  const saved = extensionAPI.settings.get(STANDALONE_POMODORO_STATE_KEY);
  const startedAt = Number(saved?.startedAt);
  return Number.isFinite(startedAt)
    ? timingCore.nextStandalonePomodoroState(saved, { action: 'start', nowMs: startedAt })
    : null;
}

export function createTimingRuntime({
  extensionAPI,
  now = () => new Date(),
  wallNow = () => Date.now(),
  scheduleMutationStart = scheduleNextTask,
  watchPlan = null,
  readPlan = null,
}) {
  let destroyed = false;
  let ticker = null;
  let removeVisibilityListener = null;
  let cancelSidebarWarmup = null;
  let refreshHandle = null;
  let refreshHandleKind = null;
  let refreshRunner = null;
  let refreshPromise = null;
  let resolveRefresh = null;
  let mutationQueue = Promise.resolve();
  const pendingMutationStarts = new Set();
  let standaloneClearPromise = null;
  let watchedPlanUid = null;
  let stopPlanWatch = null;
  let watchedPlanRefreshHandle = null;
  let pendingWatchedPlanPull = null;
  let snapshot = {
    revision: 0,
    status: 'loading',
    notice: '',
    planSnapshot: null,
    entries: [],
    dailyReview: timingCore.buildDailyReview(),
    activeWork: { focused: null, recent: [], items: [], count: 0, windowMinutes: 45 },
    pomodoro: null,
    standalonePomodoro: null,
    now: now(),
  };
  const listeners = new Set();

  const publish = () => {
    for (const listener of listeners) {
      try { listener(snapshot); } catch (error) { console.error('[Nautilus Log] timing listener failed', error); }
    }
  };

  const syncPlanWatch = () => {
    const planUid = snapshot.planSnapshot?.plan?.uid || null;
    if (planUid === watchedPlanUid) return;
    stopPlanWatch?.();
    stopPlanWatch = null;
    watchedPlanUid = planUid;
    if (!planUid || typeof watchPlan !== 'function') return;
    stopPlanWatch = watchPlan(planUid, (planPull) => {
      if (destroyed || snapshot.planSnapshot?.plan?.uid !== planUid) return;
      if (!planPull) {
        // Compatibility fallback for custom watch adapters that only signal
        // invalidation. The built-in bridge always supplies the direct Pull.
        void requestRefresh({ immediate: true }).then((next) => {
          if (!next.entries.some((entry) => entry.running && entry.status === 'DONE')) return;
          enqueue(async () => {
            const entries = await closeDoneClocks(next.entries);
            return refresh({ planSnapshot: next.planSnapshot, entries });
          }).catch((error) => console.error('[Nautilus Log] source completion reconciliation failed', error));
        });
        return;
      }
      pendingWatchedPlanPull = planPull;
      if (watchedPlanRefreshHandle !== null) return;
      // Roam can emit several Pull Watch callbacks for one edit. Leave the
      // trusted input stack first, then project only the newest cheap Plan
      // Pull. This keeps Enter free of Daily-page and LOGBOOK queries.
      watchedPlanRefreshHandle = window.setTimeout(() => {
        watchedPlanRefreshHandle = null;
        const latestPull = pendingWatchedPlanPull;
        pendingWatchedPlanPull = null;
        if (destroyed || snapshot.planSnapshot?.plan?.uid !== planUid) return;
        const planSnapshot = projectPrimaryPlanPull(
          latestPull,
          snapshot.planSnapshot,
          Number(extensionAPI.settings.get('todo-duration')) || 15,
        );
        const next = refresh({
          planSnapshot: planSnapshot || snapshot.planSnapshot,
          entries: snapshot.entries,
        });
        if (!next.entries.some((entry) => entry.running && entry.status === 'DONE')) return;
        enqueue(async () => {
          const entries = await closeDoneClocks(next.entries);
          return refresh({ planSnapshot: next.planSnapshot, entries });
        }).catch((error) => console.error('[Nautilus Log] source completion reconciliation failed', error));
      }, 0);
    }, { emitInitial: false });
  };

  const setPomodoro = async (value) => {
    snapshot = { ...snapshot, pomodoro: value };
    await extensionAPI.settings.set(POMODORO_STATE_KEY, value);
  };

  const setStandalonePomodoro = async (value) => {
    const next = value
      ? timingCore.nextStandalonePomodoroState(value, { action: 'start', nowMs: value.startedAt })
      : null;
    // A refresh can discover stale persisted POMO while CLOCK is active. Do
    // not let that asynchronous cleanup overwrite a subsequent user start.
    if (standaloneClearPromise) await standaloneClearPromise;
    const saved = extensionAPI.settings.get(STANDALONE_POMODORO_STATE_KEY);
    const savedStartedAt = Number(saved?.startedAt);
    const persistedMatches = next
      ? Number.isFinite(savedStartedAt) && savedStartedAt === next.startedAt
      : !saved;
    const snapshotMatches = next
      ? snapshot.standalonePomodoro?.startedAt === next.startedAt
      : !snapshot.standalonePomodoro;
    if (snapshotMatches && persistedMatches) {
      return next;
    }
    snapshot = { ...snapshot, standalonePomodoro: next };
    await extensionAPI.settings.set(STANDALONE_POMODORO_STATE_KEY, next);
    return next;
  };

  const clearPersistedStandalonePomodoro = () => {
    if (standaloneClearPromise) return standaloneClearPromise;
    if (!extensionAPI.settings.get(STANDALONE_POMODORO_STATE_KEY)) return;
    standaloneClearPromise = Promise.resolve()
      .then(() => extensionAPI.settings.set(STANDALONE_POMODORO_STATE_KEY, null))
      .catch((error) => console.error('[Nautilus Log] standalone POMO restore cleanup failed', error))
      .finally(() => { standaloneClearPromise = null; });
    return standaloneClearPromise;
  };

  const readAuthoritativePlan = (currentNow) => {
    const previous = snapshot.planSnapshot;
    const currentPageTitle = pageTitleFor(currentNow);
    const reusablePlanUid = previous?.pageTitle === currentPageTitle
      ? previous?.plan?.uid
      : null;
    if (reusablePlanUid && typeof readPlan === 'function') {
      try {
        const projected = projectPrimaryPlanPull(
          readPlan(reusablePlanUid),
          previous,
          Number(extensionAPI.settings.get('todo-duration')) || 15,
        );
        if (timingCore.isNautilusComponent(projected?.plan?.string)) return projected;
      } catch (error) {
        console.debug('[Nautilus Log] cached Primary Plan pull unavailable', error);
      }
    }
    return readPrimaryPlan(currentNow, Number(extensionAPI.settings.get('todo-duration')) || 15);
  };

  const refresh = ({ notice = '', planSnapshot: suppliedPlanSnapshot, entries: suppliedEntries } = {}) => {
    if (destroyed) return snapshot;
    try {
      const currentNow = now();
      const sourcePlanSnapshot = suppliedPlanSnapshot === undefined
        ? readAuthoritativePlan(currentNow)
        : suppliedPlanSnapshot;
      const planSnapshot = sourcePlanSnapshot
        ? {
          ...sourcePlanSnapshot,
          execution: executionProjection(sourcePlanSnapshot, currentNow, extensionAPI),
        }
        : sourcePlanSnapshot;
      const reviewTasks = planSnapshot?.reviewCandidates || planSnapshot?.reviewTasks || (planSnapshot?.plan
        ? timingCore.projectReviewCandidates(
          planSnapshot.rows,
          planSnapshot.plan.uid,
          Number(extensionAPI.settings.get('todo-duration')) || 15,
        )
        : []);
      const relevantTaskUids = [
        ...reviewTasks.map((task) => task.uid),
        ...snapshot.entries
          .filter((entry) => entry.running || snapshot.activeWork?.items?.some((item) => item.taskUid === entry.taskUid))
          .map((entry) => entry.taskUid),
      ];
      const rawEntries = suppliedEntries === undefined
        ? readEntriesForTaskUids(relevantTaskUids)
        : suppliedEntries;
      const tasksByUid = new Map(reviewTasks.map((task) => [task.uid, task]));
      const entries = rawEntries.map((entry) => {
        const task = tasksByUid.get(entry.taskUid);
        return task ? {
          ...entry,
          title: task.title,
          status: task.status,
          plannedMinutes: task.plannedMinutes,
        } : entry;
      });
      const dailyReview = timingCore.buildDailyReview({ tasks: reviewTasks, entries, now: currentNow });
      const recentRetention = extensionAPI.settings.get('recent-retention-minutes') ?? 45;
      const activeWork = timingCore.buildActiveWork(entries, currentNow, recentRetention);
      const pomodoro = currentPomodoro(extensionAPI, activeWork.focused);
      const standalonePomodoro = currentStandalonePomodoro(extensionAPI, activeWork.focused);
      if (activeWork.focused && extensionAPI.settings.get(STANDALONE_POMODORO_STATE_KEY)) {
        clearPersistedStandalonePomodoro();
      }
      snapshot = {
        revision: snapshot.revision + 1,
        status: 'ready',
        notice,
        planSnapshot,
        entries,
        dailyReview,
        activeWork,
        pomodoro,
        standalonePomodoro,
        now: currentNow,
      };
      syncPlanWatch();
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

  const requestRefresh = ({ notice = '', immediate = false } = {}) => {
    if (destroyed) return Promise.resolve(snapshot);
    if (refreshPromise) {
      if (immediate && refreshHandleKind === 'idle' && refreshRunner) {
        window.cancelIdleCallback?.(refreshHandle);
        refreshHandleKind = 'timeout';
        refreshHandle = window.setTimeout(refreshRunner, 0);
      }
      return refreshPromise;
    }
    refreshPromise = new Promise((resolve) => {
      resolveRefresh = resolve;
      const run = () => {
        refreshHandle = null;
        refreshHandleKind = null;
        refreshRunner = null;
        let next = snapshot;
        try { next = refresh({ notice }); }
        finally {
          const finish = resolveRefresh;
          resolveRefresh = null;
          refreshPromise = null;
          finish?.(next);
        }
      };
      refreshRunner = run;
      if (!immediate && typeof window.requestIdleCallback === 'function') {
        refreshHandleKind = 'idle';
        // Recovery is background work. A forced idle timeout can fire while
        // the user is typing and recreate the exact intermittent Enter stall
        // this scheduler is meant to avoid.
        refreshHandle = window.requestIdleCallback(run);
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
    refreshRunner = null;
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
        refresh({
          notice: error.message || 'The graph change could not be confirmed.',
          planSnapshot: snapshot.planSnapshot,
          entries: snapshot.entries,
        });
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

  const closeDoneClocks = async (entries) => {
    const doneRunning = entries.filter((entry) => entry.running && entry.status === 'DONE');
    if (doneRunning.length === 0) return entries;
    const updatedEntries = await closeEntriesAt(entries, now());
    if (!timingCore.chooseFocusedEntry(updatedEntries)) await setPomodoro(null);
    return updatedEntries;
  };

  const reconcileLegacyOverlap = async (entries) => {
    const running = entries.filter((entry) => entry.running).sort((left, right) => right.start - left.start);
    if (running.length <= 1) return entries;
    const focused = running[0];
    const updates = new Map();
    for (const stale of running.slice(1)) {
      await updateGraphBlock(stale.clockUid, timingCore.formatClockLine(stale.start, focused.start));
      updates.set(stale.clockUid, {
        ...stale,
        end: new Date(focused.start),
        running: false,
        minutes: Math.max(0, Math.floor((focused.start - stale.start) / 60000)),
      });
    }
    const reconciled = entries.map((entry) => updates.get(entry.clockUid) || entry);
    const remaining = reconciled.filter((entry) => entry.running);
    if (remaining.length !== 1 || remaining[0].clockUid !== focused.clockUid) {
      throw new Error('Legacy overlapping CLOCK records could not be reconciled.');
    }
    return reconciled;
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
      const task = snapshot.planSnapshot?.tasks?.find((candidate) => candidate.uid === taskUid);
      if (!task || task.status !== 'TODO') {
        throw new Error('Only an unfinished task in today’s Nautilus Plan can own the Timing Line.');
      }
      const taskString = readBlockString(taskUid);
      const before = snapshot.entries;
      const focused = timingCore.chooseFocusedEntry(before);
      const instant = now();
      // CLOCK is authoritative even when the caller re-selects the already
      // focused task, so clear any stale standalone state before the early
      // return as well.
      if (snapshot.standalonePomodoro || extensionAPI.settings.get(STANDALONE_POMODORO_STATE_KEY)) {
        await setStandalonePomodoro(null);
      }
      if (focused?.taskUid === taskUid) {
        return refresh({ planSnapshot: snapshot.planSnapshot, entries: before });
      }
      const closedEntries = await closeEntriesAt(before, instant);
      const created = await createRunningClock(taskUid, instant, taskString);
      created.entry = {
        ...created.entry,
        title: task.title,
        status: task.status,
        plannedMinutes: task.plannedMinutes,
      };
      await setPomodoro(timingCore.nextPomodoroState(snapshot.pomodoro, {
        action: focused ? 'switch' : 'start',
        nowMs: instant.getTime(),
      }));
      return refresh({
        planSnapshot: snapshot.planSnapshot,
        entries: [created.entry, ...closedEntries.filter((entry) => entry.clockUid !== created.entry.clockUid)],
      });
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
      return refresh({ planSnapshot: snapshot.planSnapshot, entries });
    }
    const updatedEntries = await closeEntriesAt(entries, now());
    await setPomodoro(timingCore.nextPomodoroState(snapshot.pomodoro, { action: 'stop' }));
    return refresh({ planSnapshot: snapshot.planSnapshot, entries: updatedEntries });
  });

  const finishTask = (taskUid) => enqueue(async () => {
    const task = snapshot.planSnapshot?.tasks?.find((candidate) => candidate.uid === taskUid);
    if (!task || task.status !== 'TODO') {
      throw new Error('Only an unfinished task in today’s Nautilus Plan can be completed.');
    }
    const instant = now();
    const entries = snapshot.entries;
    const ownedRunning = entries.filter((entry) => entry.running && entry.taskUid === taskUid);
    const updatedEntries = await closeEntriesAt(entries, instant);
    await completeTask(taskUid, task.statusOwnerUid || taskUid);
    if (ownedRunning.length > 0) await setPomodoro(null);
    return refresh({
      planSnapshot: readAuthoritativePlan(instant),
      entries: updatedEntries,
    });
  });

  const deleteCurrentClock = (taskUid) => enqueue(async () => {
    const focused = timingCore.chooseFocusedEntry(snapshot.entries);
    if (!focused || focused.taskUid !== taskUid) {
      throw new Error('Only the current Timing CLOCK can be deleted.');
    }
    await deleteClock(focused);
    await setPomodoro(null);
    return refresh({
      planSnapshot: snapshot.planSnapshot,
      entries: snapshot.entries.filter((entry) => entry.clockUid !== focused.clockUid),
    });
  });

  const startStandalonePomodoro = () => enqueue(async () => {
    // Re-check inside the serialized mutation queue so CLOCK always wins a
    // same-tick race with the header stopwatch action.
    if (timingCore.chooseFocusedEntry(snapshot.entries)) return snapshot;
    const instant = now();
    const next = timingCore.nextStandalonePomodoroState(snapshot.standalonePomodoro, {
      action: 'start',
      nowMs: instant.getTime(),
    });
    await setStandalonePomodoro(next);
    return refresh({ planSnapshot: snapshot.planSnapshot, entries: snapshot.entries });
  });

  const stopStandalonePomodoro = () => enqueue(async () => {
    await setStandalonePomodoro(null);
    return refresh({ planSnapshot: snapshot.planSnapshot, entries: snapshot.entries });
  });

  const initialize = async () => {
    if (legacyLogbookIsRunning()) {
      const message = 'Disable Roam Logbook before enabling Nautilus Log Actual Time Tracking. Only one extension may write CLOCK records.';
      showToast(message, 'danger');
      throw new Error(message);
    }
    let initialEntries = readAllEntries();
    initialEntries = await reconcileLegacyOverlap(initialEntries);
    initialEntries = await closeDoneClocks(initialEntries);
    refresh({ entries: initialEntries });
    if (!snapshot.activeWork.focused && extensionAPI.settings.get(POMODORO_STATE_KEY)) {
      await setPomodoro(null);
    }
    if (extensionAPI.settings.get('timing-line-sidebar') !== false) {
      cancelSidebarWarmup = scheduleMutationStart(() => {
        cancelSidebarWarmup = null;
        if (!destroyed) void warmRightSidebarWindowCache();
      });
    }
    let lastGraphRefresh = wallNow();
    const reconcileDoneClocks = (next, label) => {
      if (!next.entries.some((entry) => entry.running && entry.status === 'DONE')) return;
      enqueue(async () => {
        const entries = await closeDoneClocks(next.entries);
        return refresh({ planSnapshot: next.planSnapshot, entries });
      }).catch((error) => console.error(`[Nautilus Log] ${label} reconciliation failed`, error));
    };
    const scheduleRecoveryRefresh = (label = 'background') => {
      if (destroyed || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) return;
      lastGraphRefresh = wallNow();
      void requestRefresh().then((next) => reconcileDoneClocks(next, label));
    };
    ticker = window.setInterval(() => {
      if (destroyed) return;
      snapshot = { ...snapshot, now: now() };
      // The one-second lane is pure UI time. Publish first and never make a
      // graph query part of a visible elapsed-time tick.
      publish();
      if (wallNow() - lastGraphRefresh >= RECOVERY_REFRESH_INTERVAL_MS) {
        scheduleRecoveryRefresh('DONE clock');
      }
    }, 1000);
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      let wasHidden = document.visibilityState === 'hidden';
      const onVisibilityChange = () => {
        const hidden = document.visibilityState === 'hidden';
        if (wasHidden && !hidden) scheduleRecoveryRefresh('visibility');
        wasHidden = hidden;
      };
      document.addEventListener('visibilitychange', onVisibilityChange);
      removeVisibilityListener = () => document.removeEventListener('visibilitychange', onVisibilityChange);
    }
    return snapshot;
  };

  const disable = () => enqueue(async () => {
    const entries = snapshot.entries;
    const updatedEntries = await closeEntriesAt(entries, now());
    await setPomodoro(null);
    await setStandalonePomodoro(null);
    refresh({ planSnapshot: snapshot.planSnapshot, entries: updatedEntries });
    destroy();
    return true;
  });

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    if (ticker !== null) window.clearInterval(ticker);
    ticker = null;
    removeVisibilityListener?.();
    removeVisibilityListener = null;
    if (watchedPlanRefreshHandle !== null) window.clearTimeout(watchedPlanRefreshHandle);
    watchedPlanRefreshHandle = null;
    pendingWatchedPlanPull = null;
    cancelSidebarWarmup?.();
    cancelSidebarWarmup = null;
    stopPlanWatch?.();
    stopPlanWatch = null;
    watchedPlanUid = null;
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
    startStandalonePomodoro,
    stopStandalonePomodoro,
    locate: (options = {}) => openPrimaryPlan(snapshot.planSnapshot?.plan?.uid, options),
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
