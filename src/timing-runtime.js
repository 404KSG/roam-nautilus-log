import * as timingCore from './timing-core';
import { createClockCoordinator } from './clock-coordinator';
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
  readRunningEntries,
  showToast,
  updateGraphBlock,
  warmRightSidebarWindowCache,
} from './timing-roam';

const POMODORO_STATE_KEY = 'actual-time-pomodoro-state';
const STANDALONE_POMODORO_STATE_KEY = 'standalone-pomodoro-state';
const RECOVERY_REFRESH_INTERVAL_MS = 5 * 60_000;

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
  let initializationPromise = null;
  const assertActive = () => {
    if (destroyed) throw new Error('Actual Time Tracking is no longer active.');
    clockCoordinator.assertCurrent();
  };
  const invalidatedTaskUids = new Set();
  const clockCoordinator = createClockCoordinator({
    onChange: (uids) => {
      if (destroyed) return;
      uids.forEach((uid) => invalidatedTaskUids.add(uid));
      void requestRefresh();
    },
  });
  let ticker = null;
  let removeVisibilityListener = null;
  let cancelSidebarWarmup = null;
  let refreshHandle = null;
  let refreshHandleKind = null;
  let refreshRunner = null;
  let refreshPromise = null;
  let resolveRefresh = null;
  let mutationQueue = Promise.resolve();
  let mutationInFlight = false;
  let refreshAfterMutation = false;
  let projectionStatus = 'loading';
  const pendingMutationStarts = new Set();
  let standaloneClearPromise = null;
  let watchedPlanUid = null;
  let stopPlanWatch = null;
  let watchedPlanRefreshHandle = null;
  let pendingWatchedPlanPull = null;
  let planEpoch = 0;
  let refreshAgain = false;
  let refreshRunning = false;
  let forcePlanRescan = false;
  let lastStructureKey = '';
  let snapshot = {
    revision: 0,
    structureRevision: 0,
    status: 'loading',
    notice: '',
    planSnapshot: null,
    entries: [],
    entryTaskUids: [],
    dailyReview: timingCore.buildDailyReview(),
    activeWork: { focused: null, recent: [], items: [], count: 0, windowMinutes: 45 },
    pomodoro: null,
    standalonePomodoro: null,
    now: now(),
  };
  const listeners = new Set();

  const updateStructure = () => {
    // Compute semantic identity on data changes, not on every elapsed tick.
    const key = timingCore.executionStructureKey({ ...snapshot, structureRevision: null, status: '', notice: '' }, 'plan');
    if (key !== lastStructureKey) {
      lastStructureKey = key;
      snapshot = { ...snapshot, structureRevision: snapshot.structureRevision + 1 };
    }
  };

  const publish = () => {
    for (const listener of listeners) {
      try { listener(snapshot); } catch (error) { console.error('[Nautilus Log] timing listener failed', error); }
    }
  };

  const reconcileSourceCompletion = (next) => {
    if (destroyed || !next.entries.some((entry) => entry.running && entry.status === 'DONE')) return;
    enqueue(async () => {
      const entries = await closeDoneClocks(readCurrentClockEntries());
      return refresh({ planSnapshot: snapshot.planSnapshot, entries });
    }).catch((error) => console.error('[Nautilus Log] source completion reconciliation failed', error));
  };

  const watchedPlanIsUsable = (planPull) => {
    if (!planPull || planPull.missing || planPull.unavailable) return false;
    const string = planPull['block/string'] ?? planPull[':block/string'] ?? '';
    return timingCore.isNautilusComponent(string);
  };

  const invalidateWatchedProjection = () => {
    planEpoch += 1;
    pendingWatchedPlanPull = null;
    if (watchedPlanRefreshHandle !== null) {
      window.clearTimeout(watchedPlanRefreshHandle);
      watchedPlanRefreshHandle = null;
    }
  };

  const refreshWatchedPlan = () => {
    void requestRefresh({ immediate: true }).then(reconcileSourceCompletion);
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
      if (!watchedPlanIsUsable(planPull) || mutationInFlight) {
        // Missing, unsigned, or in-flight roots need a later authoritative
        // read. Never keep a cheap projection that can resurrect a ghost plan.
        invalidateWatchedProjection();
        refreshWatchedPlan();
        return;
      }
      pendingWatchedPlanPull = planPull;
      if (watchedPlanRefreshHandle !== null) return;
      // Roam can emit several Pull Watch callbacks for one edit. Leave the
      // trusted input stack first, then project only the newest cheap Plan
      // Pull. This keeps Enter free of Daily-page and LOGBOOK queries.
      const epoch = planEpoch;
      watchedPlanRefreshHandle = window.setTimeout(() => {
        watchedPlanRefreshHandle = null;
        const latestPull = pendingWatchedPlanPull;
        pendingWatchedPlanPull = null;
        if (destroyed || epoch !== planEpoch || snapshot.planSnapshot?.plan?.uid !== planUid) return;
        if (mutationInFlight || !watchedPlanIsUsable(latestPull)) {
          invalidateWatchedProjection();
          refreshWatchedPlan();
          return;
        }
        const planSnapshot = projectPrimaryPlanPull(
          latestPull,
          snapshot.planSnapshot,
          Number(extensionAPI.settings.get('todo-duration')) || 15,
        );
        if (!planSnapshot || !timingCore.isNautilusComponent(planSnapshot.plan?.string)) {
          invalidateWatchedProjection();
          refreshWatchedPlan();
          return;
        }
        const next = refresh({
          planSnapshot,
          entries: snapshot.entries,
        });
        reconcileSourceCompletion(next);
      }, 0);
    }, { emitInitial: false });
  };

  const setPomodoro = async (value) => {
    assertActive();
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
    assertActive();
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
      .then(() => {
        if (destroyed) return undefined;
        assertActive();
        return extensionAPI.settings.set(STANDALONE_POMODORO_STATE_KEY, null);
      })
      .catch((error) => console.error('[Nautilus Log] standalone POMO restore cleanup failed', error))
      .finally(() => { standaloneClearPromise = null; });
    return standaloneClearPromise;
  };

  const readAuthoritativePlan = (currentNow, { rescanPlan = false } = {}) => {
    const previous = snapshot.planSnapshot;
    const currentPageTitle = pageTitleFor(currentNow);
    const reusablePlanUid = !rescanPlan && previous?.pageTitle === currentPageTitle
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

  const refresh = ({ notice = '', planSnapshot: suppliedPlanSnapshot, entries: suppliedEntries, rescanPlan = false } = {}) => {
    if (destroyed) return snapshot;
    try {
      assertActive();
      const currentNow = now();
      const sourcePlanSnapshot = suppliedPlanSnapshot === undefined
        ? readAuthoritativePlan(currentNow, { rescanPlan: rescanPlan || forcePlanRescan })
        : suppliedPlanSnapshot;
      if (suppliedPlanSnapshot === undefined) forcePlanRescan = false;
      const planSnapshot = sourcePlanSnapshot
        ? {
          ...sourcePlanSnapshot,
          execution: timingCore.executionProjection(sourcePlanSnapshot, currentNow, {
            workdayStart: extensionAPI.settings.get('workday-start') ?? 5,
            workdayEnd: extensionAPI.settings.get('workday-end') ?? 21,
          }),
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
        ...invalidatedTaskUids,
        ...reviewTasks.map((task) => task.uid),
        ...snapshot.entries
          .filter((entry) => entry.running || snapshot.activeWork?.items?.some((item) => item.taskUid === entry.taskUid))
          .map((entry) => entry.taskUid),
      ];
      const rawEntries = suppliedEntries === undefined
        ? readEntriesForTaskUids(relevantTaskUids)
        : suppliedEntries;
      if (suppliedEntries === undefined) invalidatedTaskUids.clear();
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
      projectionStatus = 'ready';
      snapshot = {
        revision: snapshot.revision + 1,
        structureRevision: snapshot.structureRevision,
        status: mutationInFlight ? 'working' : projectionStatus,
        notice,
        planSnapshot,
        entries,
        // Only a scoped graph read certifies complete history for an owner.
        // Supplied mutation projections may contain just a subset of history.
        entryTaskUids: suppliedEntries === undefined ? [...new Set(relevantTaskUids)]
          : suppliedEntries === snapshot.entries ? snapshot.entryTaskUids : [],
        dailyReview,
        activeWork,
        pomodoro,
        standalonePomodoro,
        now: currentNow,
      };
      updateStructure();
      syncPlanWatch();
    } catch (error) {
      projectionStatus = 'error';
      snapshot = {
        ...snapshot,
        revision: snapshot.revision + 1,
        status: mutationInFlight ? 'working' : projectionStatus,
        notice: error.message || 'Timing data could not be refreshed.',
        now: now(),
      };
    }
    publish();
    return snapshot;
  };

  const refreshWhenIdle = (options) => {
    if (destroyed) return snapshot;
    if (mutationInFlight) {
      refreshAfterMutation = true;
      return snapshot;
    }
    return refresh(options);
  };

  const scheduleRefresh = (immediate) => {
    if (destroyed || mutationInFlight || refreshHandle !== null || !refreshRunner) return;
    if (!immediate && typeof window.requestIdleCallback === 'function') {
      refreshHandleKind = 'idle';
      // Never force recovery work into a busy typing frame.
      refreshHandle = window.requestIdleCallback(refreshRunner);
    } else {
      refreshHandleKind = 'timeout';
      refreshHandle = window.setTimeout(refreshRunner, 0);
    }
  };

  const requestRefresh = ({ notice = '', immediate = false, rescanPlan = false } = {}) => {
    if (rescanPlan) forcePlanRescan = true;
    if (destroyed) return Promise.resolve(snapshot);
    if (mutationInFlight) {
      refreshAfterMutation = true;
      return refreshPromise || mutationQueue.then(() => requestRefresh({ notice, immediate, rescanPlan: forcePlanRescan }));
    }
    if (refreshPromise) {
      if (refreshRunning) {
        refreshAgain = true;
      } else {
        scheduleRefresh(immediate);
        if (immediate && refreshHandleKind === 'idle' && refreshRunner) {
          window.cancelIdleCallback?.(refreshHandle);
          refreshHandleKind = 'timeout';
          refreshHandle = window.setTimeout(refreshRunner, 0);
        }
      }
      return refreshPromise;
    }
    refreshPromise = new Promise((resolve) => {
      resolveRefresh = resolve;
      const run = () => {
        if (destroyed || refreshRunner !== run) return;
        refreshHandle = null;
        refreshHandleKind = null;
        if (mutationInFlight) {
          refreshAfterMutation = true;
          return;
        }
        refreshRunner = null;
        refreshRunning = true;
        let next = snapshot;
        try { next = refresh({ notice }); }
        finally {
          refreshRunning = false;
          const finish = resolveRefresh;
          resolveRefresh = null;
          refreshPromise = null;
          finish?.(next);
          if (!destroyed && refreshAgain) {
            refreshAgain = false;
            void requestRefresh({ notice, immediate: true });
          }
        }
      };
      refreshRunner = run;
      scheduleRefresh(immediate);
    });
    return refreshPromise;
  };

  const cancelScheduledRefresh = ({ settle = false } = {}) => {
    if (!refreshPromise) return false;
    if (refreshHandle !== null) {
      if (refreshHandleKind === 'idle') window.cancelIdleCallback?.(refreshHandle);
      else window.clearTimeout(refreshHandle);
    }
    refreshHandle = null;
    refreshHandleKind = null;
    // A user mutation pauses this read; its callers still deserve a fresh
    // result afterward. Only destruction settles without another graph read.
    if (settle) {
      refreshRunner = null;
      refreshRunning = false;
      refreshAgain = false;
      const finish = resolveRefresh;
      resolveRefresh = null;
      refreshPromise = null;
      finish?.(snapshot);
    }
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

  const enqueue = (operation, { deferStart = false, clockMutation = true } = {}) => {
    const run = mutationQueue.then(async () => {
      // Pause background reads without discarding their pending promises.
      if (cancelScheduledRefresh()) refreshAfterMutation = true;
      mutationInFlight = true;
      const changedTaskUids = new Set(snapshot.entries.map((entry) => entry.taskUid));
      try {
        if (deferStart) {
          const scheduled = await waitForMutationStart();
          if (!scheduled) throw new Error('Actual Time Tracking is no longer active.');
        }
        assertActive();
        snapshot = { ...snapshot, revision: snapshot.revision + 1, status: 'working', notice: '' };
        publish();
        await (clockMutation ? clockCoordinator.run(operation) : operation());
      } catch (error) {
        // A failed operation may already have closed/written a block. Re-read
        // those owners rather than restoring a pre-mutation cache as truth.
        refresh({ notice: error.message || 'The graph change could not be confirmed.' });
        throw error;
      } finally {
        mutationInFlight = false;
        if (!destroyed) {
          snapshot = { ...snapshot, revision: snapshot.revision + 1, status: projectionStatus };
          publish();
          if (clockMutation) {
            snapshot.entries.forEach((entry) => changedTaskUids.add(entry.taskUid));
            clockCoordinator.notify([...changedTaskUids]);
          }
          if (refreshAfterMutation || invalidatedTaskUids.size > 0 || refreshPromise) {
            refreshAfterMutation = false;
            void requestRefresh({ notice: snapshot.notice });
          }
        }
      }
      return snapshot;
    });
    mutationQueue = run.catch(() => undefined);
    return run;
  };

  const closeEntriesAt = async (entries, instant, shouldClose = () => true) => {
    const updated = new Map();
    for (const entry of entries.filter((candidate) => candidate.running && shouldClose(candidate))) {
      assertActive();
      const closed = await closeClock(entry, instant);
      assertActive();
      if (closed) updated.set(entry.clockUid, closed);
    }
    if (updated.size === 0) return entries;
    return entries.map((entry) => updated.get(entry.clockUid) || entry);
  };

  const closeDoneClocks = async (entries) => {
    const doneRunning = entries.filter((entry) => entry.running && entry.status === 'DONE');
    if (doneRunning.length === 0) return entries;
    const updatedEntries = await closeEntriesAt(
      entries,
      now(),
      (entry) => entry.status === 'DONE',
    );
    if (!timingCore.chooseFocusedEntry(updatedEntries)) await setPomodoro(null);
    return updatedEntries;
  };

  const reconcileLegacyOverlap = async (entries) => {
    const running = entries.filter((entry) => entry.running).sort((left, right) => right.start - left.start);
    if (running.length <= 1) return entries;
    const focused = running[0];
    const updates = new Map();
    for (const stale of running.slice(1)) {
      assertActive();
      await updateGraphBlock(stale.clockUid, timingCore.formatClockLine(stale.start, focused.start));
      assertActive();
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

  // Call only while holding the CLOCK lock. Cached running rows are never
  // authority; keep closed history, but reread known owners and live CLOCKs.
  const readCurrentClockEntries = (taskUids = []) => {
    const owners = [
      ...taskUids,
      ...invalidatedTaskUids,
      ...snapshot.entries.filter((entry) => entry.running).map((entry) => entry.taskUid),
    ];
    const byUid = new Map([
      ...snapshot.entries.filter((entry) => !entry.running),
      ...readEntriesForTaskUids(owners),
      ...readRunningEntries(),
    ].map((entry) => [entry.clockUid, entry]));
    const liveTasks = new Map();
    const entries = [...byUid.values()].map((entry) => {
      if (!entry.running) return entry;
      if (!liveTasks.has(entry.taskUid)) {
        liveTasks.set(entry.taskUid, timingCore.resolveTaskInstance({
          uid: entry.taskUid, localString: entry.taskString, readString: readBlockString,
        }));
      }
      // A bare daily wrapper inherits its source's TODO/DONE status. Raw
      // CLOCK query rows alone do not resolve that ownership chain.
      return { ...entry, status: liveTasks.get(entry.taskUid).status };
    });
    // Preserve discovered owners even if a subsequent write fails, so the
    // error refresh can still see a foreign task outside today's Plan.
    snapshot = { ...snapshot, entries };
    return entries;
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
      const instant = now();
      if (snapshot.planSnapshot?.pageTitle !== pageTitleFor(instant)) {
        throw new Error('The Plan date changed. Refresh today’s Plan before starting a task.');
      }
      const taskString = readBlockString(taskUid);
      if (typeof taskString !== 'string' || timingCore.resolveTaskInstance({
        uid: taskUid, localString: taskString, readString: readBlockString,
      }).status !== 'TODO') throw new Error('This task is no longer unfinished. Refresh the Plan.');
      const before = readCurrentClockEntries();
      const focused = timingCore.chooseFocusedEntry(before);
      // CLOCK is authoritative even when the caller re-selects the already
      // focused task, so clear any stale standalone state before the early
      // return as well.
      if (snapshot.standalonePomodoro || extensionAPI.settings.get(STANDALONE_POMODORO_STATE_KEY)) {
        await setStandalonePomodoro(null);
      }
      assertActive();
      if (focused?.taskUid === taskUid) {
        const entries = await closeEntriesAt(before, instant, (entry) => entry.clockUid !== focused.clockUid);
        return refresh({ planSnapshot: snapshot.planSnapshot, entries });
      }
      const closedEntries = await closeEntriesAt(before, instant);
      assertActive();
      const created = await createRunningClock(taskUid, instant, taskString, assertActive);
      assertActive();
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

  const stopTask = () => {
    // Bind user intent before waiting for the lock. A stale Stop click must
    // not stop a different CLOCK that another tab has just started.
    const clockUid = timingCore.chooseFocusedEntry(snapshot.entries)?.clockUid;
    return enqueue(async () => {
      const entries = readCurrentClockEntries();
      const updatedEntries = await closeEntriesAt(entries, now(), (entry) => entry.clockUid === clockUid);
      if (!timingCore.chooseFocusedEntry(updatedEntries)) await setPomodoro(null);
      return refresh({ planSnapshot: snapshot.planSnapshot, entries: updatedEntries });
    });
  };

  const finishTask = (taskUid) => enqueue(async () => {
    const task = snapshot.planSnapshot?.tasks?.find((candidate) => candidate.uid === taskUid);
    if (!task || task.status !== 'TODO') {
      throw new Error('Only an unfinished task in today’s Nautilus Plan can be completed.');
    }
    const liveTask = timingCore.resolveTaskInstance({
      uid: taskUid, localString: readBlockString(taskUid), readString: readBlockString,
    });
    if (liveTask.status !== 'TODO') throw new Error('This daily task instance is no longer unfinished.');
    const instant = now();
    const entries = readCurrentClockEntries([taskUid]);
    const ownedRunning = entries.filter((entry) => entry.running && entry.taskUid === taskUid);
    const updatedEntries = await closeEntriesAt(
      entries,
      instant,
      (entry) => entry.taskUid === taskUid,
    );
    assertActive();
    await completeTask(taskUid, liveTask.statusOwnerUid || taskUid);
    assertActive();
    if (ownedRunning.length > 0 && !timingCore.chooseFocusedEntry(updatedEntries)) await setPomodoro(null);
    return refresh({
      planSnapshot: readAuthoritativePlan(instant),
      entries: updatedEntries,
    });
  });

  const deleteCurrentClock = (taskUid) => {
    const clockUid = timingCore.chooseFocusedEntry(snapshot.entries)?.clockUid;
    return enqueue(async () => {
      const entries = readCurrentClockEntries([taskUid]);
      const focused = timingCore.chooseFocusedEntry(entries);
      if (!focused || focused.clockUid !== clockUid || focused.taskUid !== taskUid) {
        throw new Error('The current running CLOCK changed. Refresh before deleting it.');
      }
      await deleteClock(focused);
      assertActive();
      await setPomodoro(null);
      return refresh({
        planSnapshot: snapshot.planSnapshot,
        entries: entries.filter((entry) => entry.clockUid !== focused.clockUid),
      });
    });
  };

  const startStandalonePomodoro = () => enqueue(async () => {
    // Re-check inside the serialized mutation queue so CLOCK always wins a
    // same-tick race with the header stopwatch action.
    if (timingCore.chooseFocusedEntry(snapshot.entries)) {
      return refresh({ planSnapshot: snapshot.planSnapshot, entries: snapshot.entries });
    }
    const instant = now();
    const next = timingCore.nextStandalonePomodoroState(snapshot.standalonePomodoro, {
      action: 'start',
      nowMs: instant.getTime(),
    });
    await setStandalonePomodoro(next);
    return refresh({ planSnapshot: snapshot.planSnapshot, entries: snapshot.entries });
  }, { clockMutation: false });

  const stopStandalonePomodoro = () => enqueue(async () => {
    await setStandalonePomodoro(null);
    return refresh({ planSnapshot: snapshot.planSnapshot, entries: snapshot.entries });
  }, { clockMutation: false });

  const initializeOnce = async () => {
    assertActive();
    if (legacyLogbookIsRunning()) {
      const message = 'Disable Roam Logbook before enabling Nautilus Log Actual Time Tracking. Only one extension may write CLOCK records.';
      showToast(message, 'danger');
      throw new Error(message);
    }
    let initialEntries = readAllEntries();
    if (initialEntries.filter((entry) => entry.running).length > 1
      || initialEntries.some((entry) => entry.running && entry.status === 'DONE')) {
      initialEntries = await clockCoordinator.run(async () => {
        const reconciled = await reconcileLegacyOverlap(readAllEntries());
        assertActive();
        return closeDoneClocks(reconciled);
      });
    }
    assertActive();
    refresh({ entries: initialEntries });
    assertActive();
    if (!snapshot.activeWork.focused && extensionAPI.settings.get(POMODORO_STATE_KEY)) {
      await setPomodoro(null);
      assertActive();
    }
    if (extensionAPI.settings.get('timing-line-sidebar') !== false) {
      cancelSidebarWarmup = scheduleMutationStart(() => {
        cancelSidebarWarmup = null;
        if (!destroyed) void warmRightSidebarWindowCache();
      });
    }
    assertActive();
    clockCoordinator.start();
    let lastGraphRefresh = wallNow();
    const reconcileDoneClocks = (next, label) => {
      if (!next.entries.some((entry) => entry.running && entry.status === 'DONE')) return;
      enqueue(async () => {
        const entries = await closeDoneClocks(readCurrentClockEntries());
        return refresh({ planSnapshot: snapshot.planSnapshot, entries });
      }).catch((error) => console.error(`[Nautilus Log] ${label} reconciliation failed`, error));
    };
    const scheduleRecoveryRefresh = (label = 'background') => {
      if (destroyed || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) return;
      lastGraphRefresh = wallNow();
      void requestRefresh().then((next) => reconcileDoneClocks(next, label));
    };
    const publishTime = () => {
      const currentNow = now();
      // Only the bounded active set can expire here; do not walk the full
      // history or query the graph just to remove an expired Recent item.
      const activeWork = timingCore.buildActiveWork(snapshot.activeWork.items, currentNow, snapshot.activeWork.windowMinutes);
      const changed = activeWork.recent.length !== snapshot.activeWork.recent.length
        || activeWork.focused?.clockUid !== snapshot.activeWork.focused?.clockUid;
      snapshot = { ...snapshot, now: currentNow,
        ...(changed ? { activeWork, revision: snapshot.revision + 1 } : {}) };
      if (changed) updateStructure();
      publish();
    };
    ticker = window.setInterval(() => {
      if (destroyed || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) return;
      // The one-second lane is pure UI time. Publish first and never make a
      // graph query part of a visible elapsed-time tick.
      publishTime();
      if (wallNow() - lastGraphRefresh >= RECOVERY_REFRESH_INTERVAL_MS) {
        scheduleRecoveryRefresh('DONE clock');
      }
    }, 1000);
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      let wasHidden = document.visibilityState === 'hidden';
      const onVisibilityChange = () => {
        const hidden = document.visibilityState === 'hidden';
        if (wasHidden && !hidden) {
          publishTime();
          scheduleRecoveryRefresh('visibility');
        }
        wasHidden = hidden;
      };
      document.addEventListener('visibilitychange', onVisibilityChange);
      removeVisibilityListener = () => document.removeEventListener('visibilitychange', onVisibilityChange);
    }
    return snapshot;
  };

  const initialize = () => {
    if (destroyed) return Promise.reject(new Error('Actual Time Tracking is no longer active.'));
    if (!initializationPromise) {
      initializationPromise = Promise.resolve().then(initializeOnce).catch((error) => {
        destroy();
        throw error;
      });
    }
    return initializationPromise;
  };

  const disable = async () => {
    await enqueue(async () => {
      const entries = readCurrentClockEntries();
      const updatedEntries = await closeEntriesAt(entries, now());
      await setPomodoro(null);
      await setStandalonePomodoro(null);
      refresh({ planSnapshot: snapshot.planSnapshot, entries: updatedEntries });
    });
    destroy();
    return true;
  };

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    clockCoordinator.destroy();
    invalidatedTaskUids.clear();
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
    cancelScheduledRefresh({ settle: true });
    listeners.clear();
  }

  return {
    initialize,
    refresh: refreshWhenIdle,
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
