import { createTimingTopbar } from '../src/timing-topbar.js';

function task(uid, title, plannedMinutes) {
  return {
    uid,
    title,
    plannedMinutes,
    remainingMinutes: plannedMinutes,
    status: 'TODO',
  };
}

function snapshotFrom(tasks, now, fixedEvents = []) {
  return {
    revision: 1,
    status: 'idle',
    notice: '',
    planSnapshot: {
      plan: { uid: 'plan' },
      tasks: tasks.map((item) => ({ ...item })),
      fixedEvents,
    },
    entries: [],
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
      focused: null,
      recent: [],
      items: [],
      count: 0,
      windowMinutes: 45,
    },
    pomodoro: null,
    standalonePomodoro: null,
    now,
  };
}

const DEFAULT_TASKS = [
  task('task-a', 'Alpha', 60),
  task('task-b', 'Beta', 60),
];
const WARNING_TASKS = [
  task('task-over', 'Overload', 720),
  task('task-small', 'Small', 25),
];

let topbar = null;
let snapshot = null;
let listeners = new Set();
let failNextComplete = false;
let completeCalls = [];
let trackedTimeouts = new Set();
let setTimeoutWrapped = false;
let nativeSetTimeout = null;
let nativeClearTimeout = null;

function wrapTimeouts() {
  if (setTimeoutWrapped) return;
  nativeSetTimeout = window.setTimeout.bind(window);
  nativeClearTimeout = window.clearTimeout.bind(window);
  window.setTimeout = (fn, ms, ...args) => {
    const id = nativeSetTimeout(() => {
      trackedTimeouts.delete(id);
      fn();
    }, ms, ...args);
    trackedTimeouts.add(id);
    return id;
  };
  window.clearTimeout = (id) => {
    trackedTimeouts.delete(id);
    return nativeClearTimeout(id);
  };
  setTimeoutWrapped = true;
}

function publish() {
  for (const listener of listeners) listener(snapshot);
}

function removeTask(uid) {
  const tasks = (snapshot.planSnapshot.tasks || []).filter((item) => item.uid !== uid);
  snapshot = {
    ...snapshot,
    revision: snapshot.revision + 1,
    planSnapshot: {
      ...snapshot.planSnapshot,
      tasks,
    },
  };
  publish();
}

function createRuntime() {
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    requestRefresh: async () => snapshot,
    completeTask: async (uid) => {
      completeCalls.push(uid);
      if (failNextComplete) {
        failNextComplete = false;
        throw new Error('complete failed');
      }
      removeTask(uid);
    },
    startTask: async () => {},
    stopTask: async () => {},
    deleteCurrentClock: async () => {},
    startStandalonePomodoro: async () => {},
    stopStandalonePomodoro: async () => {},
    locate: async () => {},
    openTask: async () => {},
  };
}

function createSettings(energyEnabled = true) {
  const values = {
    'energy-bar-enabled': energyEnabled,
    language: 'en',
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

function mount(options = {}) {
  destroy();
  wrapTimeouts();
  completeCalls = [];
  failNextComplete = Boolean(options.failNextComplete);
  const now = options.now instanceof Date ? options.now : new Date(2026, 8, 9, 10, 0, 0);
  const tasks = options.tasks || DEFAULT_TASKS;
  snapshot = snapshotFrom(tasks, now, options.fixedEvents);
  listeners = new Set();
  topbar = createTimingTopbar({
    runtime: createRuntime(),
    extensionAPI: createSettings(options.energyBarEnabled !== false),
  });
  topbar.initialize();
  const current = api();
  window.energyBarHarness.api = current;
  return current;
}

function destroy() {
  topbar?.destroy();
  topbar = null;
  listeners = new Set();
  snapshot = null;
}

function api() {
  return {
    failNextComplete() {
      failNextComplete = true;
    },
    completeCalls() {
      return completeCalls.slice();
    },
    pendingTimeouts() {
      return trackedTimeouts.size;
    },
    externalComplete(uid) {
      removeTask(uid || snapshot.planSnapshot.tasks[0]?.uid);
    },
    tickMinute() {
      snapshot = {
        ...snapshot,
        now: new Date(snapshot.now.getTime() + 60000),
      };
      publish();
    },
    destroy,
  };
}

window.energyBarHarness = {
  mount,
  destroy,
  tasks: { DEFAULT_TASKS, WARNING_TASKS },
};
