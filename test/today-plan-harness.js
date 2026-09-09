import { createTimingTopbar } from '../src/timing-topbar.js';
import { createTodayPlanLauncher } from '../src/today-plan-launcher.js';
import * as timingCore from '../src/timing-core.js';

function task(uid, title, plannedMinutes) {
  return {
    uid,
    title,
    plannedMinutes,
    remainingMinutes: plannedMinutes,
    status: 'TODO',
  };
}

function snapshotFrom({ tasks = [], now, plan = null, focused = null, standalonePomodoro = null } = {}) {
  return {
    revision: 1,
    status: 'idle',
    notice: '',
    planSnapshot: {
      plan,
      tasks: tasks.map((item) => ({ ...item })),
      fixedEvents: [],
    },
    entries: focused ? [focused] : [],
    dailyReview: {
      summary: {
        totalCount: 0,
        completedCount: 0,
        comparedCount: 0,
        plannedMinutes: 0,
        actualMinutes: 0,
        varianceMinutes: 0,
      },
      rows: [],
    },
    activeWork: {
      focused,
      recent: [],
      items: focused ? [focused] : [],
      count: focused ? 1 : 0,
      windowMinutes: 45,
    },
    pomodoro: focused ? { startedAt: focused.start.getTime() } : null,
    standalonePomodoro,
    now,
  };
}

const DEFAULT_TASKS = [
  task('task-a', 'Alpha', 60),
  task('task-b', 'Beta', 60),
];

let topbar = null;
let launcher = null;
let snapshot = null;
let planState = null;
let runtimeListeners = new Set();
let planListeners = new Set();
let ensureCalls = [];
let locateCalls = [];
let discoverCalls = [];

function publishRuntime() {
  for (const listener of runtimeListeners) listener(snapshot);
}

function publishPlan() {
  for (const listener of planListeners) listener(planState);
}

function createPlanSession() {
  return {
    getState: () => planState,
    subscribe(listener) {
      planListeners.add(listener);
      return () => planListeners.delete(listener);
    },
    ensureToday: async (options = {}) => {
      ensureCalls.push(options);
      if (planState.status === 'ready-absent') {
        planState = {
          ...planState,
          status: 'ready-present',
          planUid: 'plan',
          outcome: 'created',
        };
        snapshot = {
          ...snapshot,
          planSnapshot: {
            ...snapshot.planSnapshot,
            plan: { uid: 'plan' },
            tasks: DEFAULT_TASKS.map((item) => ({ ...item })),
          },
        };
        publishPlan();
        publishRuntime();
      }
      return planState;
    },
    locateToday: async (options = {}) => {
      locateCalls.push(options);
      return planState;
    },
    discover: (options) => { discoverCalls.push(options); return planState; },
  };
}

function createRuntime() {
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      runtimeListeners.add(listener);
      return () => runtimeListeners.delete(listener);
    },
    requestRefresh: async () => snapshot,
    completeTask: async () => {},
    startTask: async () => {},
    stopTask: async () => {},
    deleteCurrentClock: async () => {},
    startStandalonePomodoro: async () => {},
    stopStandalonePomodoro: async () => {},
    locate: async () => {},
    openTask: async () => {},
  };
}

function createSettings({ energyBarEnabled = true, language = 'en' } = {}) {
  const values = {
    'energy-bar-enabled': energyBarEnabled,
    language,
    'workday-start': 5,
    'workday-end': 21,
    'todo-duration': 15,
    'forgotten-timer-minutes': 120,
    'pomodoro-minutes': 45,
  };
  return {
    settings: {
      get: (key) => values[key],
    },
  };
}

function basePlan(status, language = 'en') {
  return {
    status,
    pageTitle: 'September 9th, 2026',
    pageUid: status === 'ready-present' || status === 'nav-failed' ? 'day' : null,
    planUid: status === 'ready-present' || status === 'nav-failed' ? 'plan' : null,
    templateKind: status === 'ready-blocked' ? 'custom' : 'standard',
    outcome: null,
    error: null,
    language,
    trackingOn: true,
    labels: timingCore.executionCopy(language).createToday,
  };
}

function destroy() {
  topbar?.destroy();
  launcher?.destroy();
  topbar = null;
  launcher = null;
  runtimeListeners = new Set();
  planListeners = new Set();
  snapshot = null;
  planState = null;
}

function mountLauncher(options = {}) {
  destroy();
  ensureCalls = [];
  locateCalls = [];
  discoverCalls = [];
  snapshot = snapshotFrom({ now: new Date(2026, 8, 9, 10, 0, 0) });
  const language = options.language || 'en';
  planState = basePlan(options.status || 'ready-absent', language);
  planState.trackingOn = false;
  launcher = createTodayPlanLauncher({
    todayPlan: createPlanSession(),
    extensionAPI: createSettings({ language, energyBarEnabled: false }),
  });
  launcher.initialize();
  const current = api();
  window.todayPlanHarness.api = current;
  return current;
}

function mountTopbar(options = {}) {
  destroy();
  ensureCalls = [];
  locateCalls = [];
  discoverCalls = [];
  const language = options.language || 'en';
  const now = options.now instanceof Date ? options.now : new Date(2026, 8, 9, 10, 0, 0);
  const status = options.status || 'ready-present';
  const hasPlan = status === 'ready-present' || status === 'nav-failed';
  const tasks = options.tasks === undefined ? (hasPlan ? DEFAULT_TASKS : []) : options.tasks;
  const focused = options.clock
    ? {
      taskUid: 'task-a',
      title: 'Alpha',
      start: new Date(now.getTime() - 65000),
      running: true,
      clockUid: 'clock-a',
      taskString: '{{[[TODO]]}} Alpha 60m',
    }
    : null;
  planState = basePlan(status, language);
  snapshot = snapshotFrom({
    tasks,
    now,
    plan: hasPlan ? { uid: 'plan' } : null,
    focused,
    standalonePomodoro: options.pomo ? { startedAt: now.getTime() - 65000 } : null,
  });
  topbar = createTimingTopbar({
    runtime: createRuntime(),
    extensionAPI: createSettings({
      energyBarEnabled: options.energyBarEnabled !== false,
      language,
    }),
    todayPlan: createPlanSession(),
  });
  topbar.initialize();
  const current = api();
  window.todayPlanHarness.api = current;
  return current;
}

function api() {
  return {
    ensureCalls: () => ensureCalls.slice(),
    locateCalls: () => locateCalls.slice(),
    discoverCalls: () => discoverCalls.slice(),
    setStatus(status, extra = {}) {
      planState = { ...planState, status, ...extra };
      const hasPlan = status === 'ready-present' || status === 'nav-failed';
      snapshot = {
        ...snapshot,
        planSnapshot: {
          ...snapshot.planSnapshot,
          plan: hasPlan ? { uid: extra.planUid || 'plan' } : null,
          tasks: extra.tasks || snapshot.planSnapshot.tasks,
        },
      };
      publishPlan();
      publishRuntime();
    },
    destroy,
  };
}

window.todayPlanHarness = {
  mountLauncher,
  mountTopbar,
  destroy,
  tasks: { DEFAULT_TASKS },
};
