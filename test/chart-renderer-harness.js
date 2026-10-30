import * as logCore from '../src/log-core.js';
import * as timingCore from '../src/timing-core.js';
// This is the dependency-free module re-exported by src/entry-helpers.js;
// production and the renderer exercise the same sidebar selector contract.
import { isRightSidebarRenderContext } from '../src/render-context.js';

const RealDate = window.__chartRealDate || Date;
const traces = [];
let fakeNow = new RealDate(window.__chartFakeNowMs || '2026-10-29T08:01:00');
const nativeClearInterval = window.clearInterval;
const fakeIntervals = new Map();
let nextIntervalId = 1000;
window.setInterval = (callback, delay, ...args) => {
  const id = ++nextIntervalId;
  fakeIntervals.set(id, { callback: () => callback(...args), delay: Number(delay) || 0 });
  trace('interval-register', { id, delay: Number(delay) || 0 });
  return id;
};
window.clearInterval = (id) => {
  fakeIntervals.delete(id);
  return nativeClearInterval(id);
};

function trace(kind, detail = {}) {
  traces.push({ kind, ...detail });
}

const NativeResizeObserver = window.ResizeObserver;
window.ResizeObserver = class extends NativeResizeObserver {
  constructor(callback) {
    super((entries, observer) => {
      for (const entry of entries) if (entry.target.classList.contains('nautilus-log-shell')) {
        trace('presentation-observed', { width: entry.contentRect.width, height: entry.contentRect.height });
      }
      callback(entries, observer);
    });
  }
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const syntheticStrings = new Map([
  ['source-todo', '{{[[TODO]]}} Draft the project brief 30m'],
  ['source-done', '{{[[DONE]]}} Completed synthetic task 20m d8'],
]);
const mixedChildren = [
  { 'block/uid': 'event-standup', 'block/string': '09:00-09:30 Stand-up', 'block/order': 0, 'block/refs': [] },
  { 'block/uid': 'task-reference', 'block/string': '((source-todo))', 'block/order': 1, 'block/refs': [] },
  { 'block/uid': 'task-completed', 'block/string': '((source-done))', 'block/order': 2, 'block/refs': [] },
  { 'block/uid': 'task-long', 'block/string': '{{[[TODO]]}} 编写项目简报 90m', 'block/order': 3, 'block/refs': [] },
  { 'block/uid': 'task-unbroken', 'block/string': '{{[[TODO]]}} unbroken-title-for-baseline-geometry-XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX 45m', 'block/order': 4, 'block/refs': [] },
];
const denseChildren = Array.from({ length: 10 }, (_value, index) => ({
  'block/uid': `dense-${index}`,
  'block/string': `{{[[TODO]]}} Dense synthetic task ${index + 1} with an intentionally long label ${'X'.repeat(28)} 30m`,
  'block/order': index,
  'block/refs': [],
}));
const parameters = new URLSearchParams(window.location.search);
const routineTitles = ['Plan', 'Read', 'Nap', 'Ship', 'Build', 'Lunch', 'Brief review', 'Team sync',
  'Commute home', 'Commute to work', 'Exercise', 'Breakfast', 'Social', 'Walk', 'Notes', 'Wrap up'];
const routineChildren = routineTitles.map((title, order) => {
  const start = 300 + order * 45;
  const time = minutes => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  return { 'block/uid': `routine-${order}`, 'block/string': `${time(start)}-${time(start + 30)} ${title}`, 'block/order': order, 'block/refs': [] };
});
const scenario = parameters.get('scenario') || 'mixed';
const context = parameters.get('context') || 'main';
const windowMode = parameters.get('window') || 'normal';
const longTitles = {
  'long-latin': `Project brief ${'complete readable detail '.repeat(100)}END_LATIN`,
  'long-cjk': `项目简报${'完整内容必须可以阅读与滚动。'.repeat(160)}结束标记`,
  'long-unbroken': `Unbroken_${'X'.repeat(2600)}_END_UNBROKEN`,
};
let children = clone({
  mixed: mixedChildren,
  routine: routineChildren,
  sparse: mixedChildren.slice(0, 2),
  dense: denseChildren,
  cjk: [
    { 'block/uid': 'cjk-event', 'block/string': '10:00-11:00 设计评审', 'block/order': 0, 'block/refs': [] },
    { 'block/uid': 'cjk-task', 'block/string': '{{[[TODO]]}} 编写项目简报并确认跨团队依赖关系 45m', 'block/order': 1, 'block/refs': [] },
  ],
  long: Object.entries(longTitles).map(([uid, title], order) => ({
    'block/uid': uid, 'block/string': `{{[[TODO]]}} ${title} 30m`, 'block/order': order, 'block/refs': [],
  })),
  completed: [{ 'block/uid': 'completed-direct', 'block/string': '{{[[DONE]]}} Completed milestone 20m d8', 'block/order': 0, 'block/refs': [] }],
  untimed: [
    ['untimed-local', '{{[[DONE]]}} Review project notes 20m'],
    ['untimed-reference', '((source-done))'],
    ['timed-done', '{{[[DONE]]}} Publish summary 20m d8'],
    ['fixed-done', '{{[[DONE]]}} 10:00-10:30 Design review'],
    ['clock-done', '{{[[DONE]]}} Verify export 15m'],
    ['running-only', '{{[[DONE]]}} Running-only record 15m'],
    ['other-day', '{{[[DONE]]}} Earlier-day record 15m'],
    ['pending-next', '{{[[TODO]]}} Draft next chapter 30m'],
  ].map(([uid, string], order) => ({ 'block/uid': uid, 'block/string': string, 'block/order': order, 'block/refs': [] })),
  'untimed-many': Array.from({ length: 12 }, (_, order) => ({
    'block/uid': `untimed-${order}`, 'block/string': `{{[[DONE]]}} 已完成的合成任务 ${order + 1} ${order === 11 ? '长标题必须可读'.repeat(80) + '末尾标记' : ''} 20m`,
    'block/order': order, 'block/refs': [],
  })),
  overnight: [
    { 'block/uid': 'night-event', 'block/string': '23:45-00:15 Night handover', 'block/order': 0, 'block/refs': [] },
    { 'block/uid': 'night-task', 'block/string': '{{[[TODO]]}} Night project brief 90m', 'block/order': 1, 'block/refs': [] },
  ],
  empty: [],
}[scenario] || mixedChildren);

let clockEntries = scenario === 'untimed' ? [
  { taskUid: 'clock-done', start: '2026-10-29T07:20:00', end: '2026-10-29T07:35:00', running: false },
  { taskUid: 'running-only', start: '2026-10-29T07:40:00', running: true },
  { taskUid: 'other-day', start: '2026-10-28T07:00:00', end: '2026-10-28T07:20:00', running: false },
] : [];

function q(query, ...args) {
  const source = String(query);
  trace('query', { source, args: clone(args) });
  if (source.includes('?parent-page-title')) return 'October 29th, 2026';
  if (source.includes('?title')) return [['October 29th, 2026']];
  return [];
}

function sessionState() {
  return { children: clone(children), status: 'ready', writesAllowed: true };
}

const sessionSubscribers = new Set();

function publishSession() {
  for (const subscriber of sessionSubscribers) subscriber(sessionState());
}

function createRendererPlanSession(options) {
  trace('session-create', { options: clone(options) });
  return {
    subscribe(callback) {
      sessionSubscribers.add(callback);
      callback(sessionState());
      trace('session-subscribe');
      return () => { sessionSubscribers.delete(callback); trace('session-unsubscribe'); };
    },
    sync() { trace('session-sync'); publishSession(); },
    destroy() { trace('session-destroy'); sessionSubscribers.clear(); },
  };
}

function readSyntheticString(uid) {
  const value = syntheticStrings.get(uid) || '';
  trace('read-string', { uid, found: Boolean(value) });
  return value;
}

function resolveTaskInstance(payload) {
  const input = { ...payload, readString: readSyntheticString };
  const result = timingCore.resolveTaskInstance(input);
  trace('resolve-task-instance', {
    payload: clone(payload),
    result: {
      uid: result.uid,
      sourceUid: result.sourceUid,
      kind: result.kind,
      status: result.status,
      statusOrigin: result.statusOrigin,
    },
  });
  return result;
}

function dateToPageTitle(date) {
  const dateValue = new RealDate(date);
  const day = dateValue.getDate();
  const suffix = day % 10 === 1 && day !== 11 ? 'st'
    : day % 10 === 2 && day !== 12 ? 'nd'
      : day % 10 === 3 && day !== 13 ? 'rd' : 'th';
  return `${dateValue.toLocaleString('en-US', { month: 'long' })} ${day}${suffix}, ${dateValue.getFullYear()}`;
}

window.nautilusLogCore = {
  ...logCore,
  timelineDayState(input) {
    const result = logCore.timelineDayState(input);
    trace('timeline-day-state', { input: clone(input), result: clone(result) });
    return result;
  },
  scheduleTasks(input) {
    const result = logCore.scheduleTasks(input);
    trace('schedule-tasks', { input: clone(input), result: clone(result) });
    return result;
  },
};
window.roamAlphaAPI = {
  platform: { isMobile: false },
  util: { dateToPageTitle },
};
window.nautilusLogExtensionData = {
  running: true,
  settings: { language: 'en', ...(windowMode === 'overnight' ? { 'workday-start': 21, 'workday-end': 2 } : {}) },
  shouldSuppressRenderContext: () => false,
  isRightSidebarRenderContext,
  createRendererPlanSession,
  resolveTaskInstance,
  getClockRenderContext: (_pageTitle, _uids, logicalEndMinutes) => ({
    entries: clone(clockEntries),
    dayStartMs: new RealDate('2026-10-29T00:00:00').getTime(),
    dayEndMs: new RealDate('2026-10-29T00:00:00').getTime() + Math.max(1440, Number(logicalEndMinutes) || 1440) * 60000,
  }),
  locatePlanTask: (uid, _target, sidebar) => {
    trace('locate', { uid, sidebar: Boolean(sidebar) });
    return Promise.resolve();
  },
  tidyPlan: () => { trace('write', { operation: 'tidyPlan' }); throw new Error('Unexpected graph write'); },
  syncCalendarPlan: () => { trace('write', { operation: 'syncCalendarPlan' }); throw new Error('Unexpected graph write'); },
  registerDeskHost: () => trace('desk-register'),
  closeDeskHost: () => trace('desk-close'),
};

window.__chartHarness = {
  q,
  traces: () => clone(traces),
  setWidth(width) {
    const shell = document.querySelector('#renderer-shell');
    const observed = document.querySelector('.nautilus-log-shell');
    const outer = shell.getBoundingClientRect().width;
    const inner = observed.getBoundingClientRect().width;
    // Calibrate against the actual observed presentation shell, not a fixed
    // padding assumption or a synthetic sidebar selector.
    shell.style.width = `${outer + Number(width) - inner}px`;
    trace('resize', { requested: Number(width), outerBefore: outer, innerBefore: inner });
  },
  longTitles: () => clone(longTitles),
  routineTitles: () => [...routineTitles],
  updateChild(uid, string) {
    const item = children.find(child => child['block/uid'] === uid);
    if (!item) throw new Error('Unknown synthetic fixture UID');
    item['block/string'] = string;
    trace('session-update-child', { uid }); publishSession();
  },
  setClockEntries(entries) {
    clockEntries = clone(entries);
    window.dispatchEvent(new CustomEvent('nautilus-log:clock-changed'));
  },
  setClock(iso) {
    fakeNow = new RealDate(iso);
    window.__chartFakeNowMs = fakeNow.getTime();
    const clockIntervals = [...fakeIntervals.entries()].filter(([, entry]) => entry.delay === 60000);
    if (clockIntervals.length !== 1) throw new Error(`Expected one chart clock interval, got ${clockIntervals.length}`);
    clockIntervals[0][1].callback();
    trace('clock', { iso, timerId: clockIntervals[0][0] });
  },
  removeChild(uid) {
    children = children.filter((child) => child['block/uid'] !== uid);
    trace('session-remove-child', { uid });
    publishSession();
  },
  unload() {
    window.dispatchEvent(new Event('unload'));
    trace('unload');
  },
  unmount() {
    window.ReactDOM.unmountComponentAtNode(document.querySelector('#chart-root'));
    trace('unmount');
  },
  state() {
    const svg = document.querySelector('svg.nautilus-log-svg');
    const shell = document.querySelector('#renderer-shell');
    const workspace = document.querySelector('.nautilus-log-workspace');
    const stage = document.querySelector('.nautilus-log-chart-stage');
    const detail = document.querySelector('.nautilus-log-detail-region');
    const desk = document.querySelector('.nautilus-log-desk-host');
    const following = document.querySelector('#following-sentinel');
    const compactList = document.querySelector('.nautilus-log-compact-list');
    const tooltip = document.querySelector('[role="tooltip"]');
    const eyebrow = detail?.querySelector('.nautilus-log-detail-eyebrow');
    const idle = detail?.querySelector('.nautilus-log-detail-idle');
    const overview = document.querySelector('.nautilus-log-compact-overview-summary');
    const overviewContent = overview?.querySelector('.nautilus-log-compact-overview-summary-content');
    const rect = (element) => {
      if (!element) return null;
      const value = element.getBoundingClientRect();
      return { x: value.x, y: value.y, width: value.width, height: value.height, bottom: value.bottom };
    };
    return {
      shell: rect(shell),
      shellClientWidth: shell?.clientWidth || 0,
      observedShell: rect(document.querySelector('.nautilus-log-shell')),
      observedClientWidth: document.querySelector('.nautilus-log-shell')?.clientWidth || 0,
      presentation: logCore.chartPresentationFrame({ containerWidth: document.querySelector('.nautilus-log-shell')?.clientWidth || 0 }),
      statusText: document.querySelector('.nautilus-log-status-rail')?.textContent || '',
      overflowCount: document.querySelectorAll('.nautilus-log-overflow-panel').length,
      svg: rect(svg),
      workspace: rect(workspace),
      stage: rect(stage),
      detail: rect(detail),
      history: rect(document.querySelector('.nautilus-log-untimed-history')),
      historyItems: [...document.querySelectorAll('.nautilus-log-untimed-item')].map(el => ({uid:el.dataset.taskUid, title:el.textContent, aria:el.getAttribute('aria-label')})),
      desk: rect(desk),
      status: rect(document.querySelector('.nautilus-log-status-rail')),
      following: rect(following),
      compactList: rect(compactList),
      viewBox: svg?.getAttribute('viewBox') || null,
      workspaceClass: workspace?.className || '',
      externalLabelCount: document.querySelectorAll('.nautilus-log-slice-group').length,
      documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      svgCount: document.querySelectorAll('svg.nautilus-log-svg').length,
      sliceCount: document.querySelectorAll('.nautilus-log-event-slice-group').length,
      detailText: detail?.textContent || null,
      bodyTooltipCount: document.body.querySelectorAll('[role="tooltip"]').length,
      writes: traces.filter((entry) => entry.kind === 'write').length,
      lastTimeline: [...traces].reverse().find((entry) => entry.kind === 'timeline-day-state') || null,
      lastPresentationObservation: [...traces].reverse().find(entry => entry.kind === 'presentation-observed') || null,
      nowLabel: document.querySelector('.nautilus-log-center-now')?.textContent || null,
      context,
      scheduleOpen: document.querySelector('.nautilus-log-compact-details')?.open ?? null,
      activeClockIntervals: [...fakeIntervals.values()].filter((entry) => entry.delay === 60000).length,
      labels: [...document.querySelectorAll('.nautilus-log-slice-group text')].map((label) => rect(label)),
      detailIdleLayout: { eyebrow: rect(eyebrow), idle: rect(idle) },
      overview: overview ? { rect: rect(overview), content: rect(overviewContent),
        chevron: rect(overview.querySelector('.nautilus-log-overview-chevron')),
        scrollWidth: overview.scrollWidth, clientWidth: overview.clientWidth,
        contentScrollWidth: overviewContent.scrollWidth, contentClientWidth: overviewContent.clientWidth,
        items: [...overviewContent.children].filter(el => getComputedStyle(el).display !== 'none').map(el => ({ text: el.textContent, rect: rect(el) })),
      } : null,
    };
  },
};

window.scittle?.core?.disable_auto_eval?.();
document.addEventListener('DOMContentLoaded', () => {
  const scripts = document.querySelectorAll('script[type="application/x-scittle"][data-chart-eval]');
  window.__chartEvaluator = {
    call: 'scittle.core.eval_script_tags(document.querySelectorAll(\'script[type="application/x-scittle"][data-chart-eval]\'))',
    namespace: 'nautilus-log-v1',
    scripts: scripts.length,
  };
  try {
    const result = window.scittle.core.eval_script_tags(scripts);
    window.__chartEvaluator.resultType = typeof result;
    Promise.resolve(result).then(
      () => { window.__chartEvaluator.completed = true; },
      (error) => { window.__chartEvaluator.error = String(error?.stack || error); },
    );
  } catch (error) {
    window.__chartEvaluator.error = String(error?.stack || error);
  }
});
