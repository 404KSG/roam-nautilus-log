import * as logCore from '../src/log-core.js';
import * as timingCore from '../src/timing-core.js';
// This is the dependency-free module re-exported by src/entry-helpers.js;
// production and the renderer exercise the same sidebar selector contract.
import { isRightSidebarRenderContext } from '../src/render-context.js';

const RealDate = window.__chartRealDate || Date;
const traces = [];
let fakeNow = new RealDate(window.__chartFakeNowMs || '2026-10-29T08:01:00');
const nativeClearInterval = window.clearInterval.bind(window);
const nativeSetInterval = window.setInterval.bind(window);
const realMinuteTimer = new URLSearchParams(window.location.search).get('realClock') === '1';
const fakeIntervals = new Map();
let nextIntervalId = 1000;
window.setInterval = (callback, delay, ...args) => {
  const id = ++nextIntervalId;
  const record = { callback: () => callback(...args), delay: Number(delay) || 0 };
  fakeIntervals.set(id, record);
  if (realMinuteTimer && record.delay === 60000) record.nativeId = nativeSetInterval(() => {
    trace('native-minute-fired', { id, performanceMs: performance.now() }); record.callback();
  }, 60000);
  trace('interval-register', { id, delay: Number(delay) || 0, performanceMs: performance.now() });
  return id;
};
window.clearInterval = (id) => {
  const record = fakeIntervals.get(id);
  fakeIntervals.delete(id);
  return nativeClearInterval(record?.nativeId ?? id);
};

function trace(kind, detail = {}) {
  traces.push({ kind, ...detail });
}

const clockListenerRecords = [];
for (const target of [window, document]) {
  const add = target.addEventListener.bind(target), remove = target.removeEventListener.bind(target);
  target.addEventListener = (type, listener, options) => {
    if (['focus', 'pageshow', 'visibilitychange'].includes(type)) clockListenerRecords.push({ target, type, listener });
    return add(type, listener, options);
  };
  target.removeEventListener = (type, listener, options) => {
    const index = clockListenerRecords.findIndex(row => row.target === target && row.type === type && row.listener === listener);
    if (index >= 0) clockListenerRecords.splice(index, 1);
    return remove(type, listener, options);
  };
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
  ['connection-source', '{{[[DONE]]}} 完成参考资料对照 30m d8'],
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
const realisticUnknown = ['核对项目周报与月报需求', '整理自动化排版方案与测试记录', '复核本周设计任务的交付清单', '完成新版本的界面验收', '修订英文文档并核对表达', '整理参考资料和实施笔记', '检查日历同步与任务引用', '完成数据导出与归档核验'];
const realisticChildren = routineChildren.slice(0, 14).map((row, i) => ({ ...row,
  'block/string': (i % 3 === 0 ? '{{[[DONE]]}} ' : '') + row['block/string'],
})).concat(realisticUnknown.map((title, i) => ({ 'block/uid': `unknown-${i}`, 'block/string': `{{[[DONE]]}} ${title} 30m`, 'block/order': 14 + i, 'block/refs': [] })));
const longTitles = {
  'long-latin': `Project brief ${'complete readable detail '.repeat(100)}END_LATIN`,
  'long-cjk': `项目简报${'完整内容必须可以阅读与滚动。'.repeat(160)}结束标记`,
  'long-unbroken': `Unbroken_${'X'.repeat(2600)}_END_UNBROKEN`,
};
let children = clone({
  mixed: mixedChildren,
  routine: routineChildren,
  realistic: realisticChildren,
  connections: [
    ['connection-event-0','06:00-08:00 Exercise'], ['connection-event-1','08:00-08:30 Breakfast'],
    ['connection-event-2','08:30-09:00 Travel'], ['connection-event-3','11:30-12:00 Return'],
    ['connection-event-4','12:00-12:30 Lunch'], ['connection-event-5','12:30-13:00 Break'],
    ['connection-event-6','13:00-13:30 Travel'], ['connection-event-7','17:00-17:30 Return'],
    ['connection-event-8','18:45-19:00 Review'], ['connection-event-9','19:15-20:00 Wind down'],
    ['connection-timed-0','{{[[DONE]]}} Editorial work 45m d11:10'],
    ['connection-timed-1','{{[[DONE]]}} Flashcards 30m d16:30'],
    ['connection-timed-2','{{[[DONE]]}} Read 25m d17'],
    ['connection-done-0','{{[[DONE]]}} 核对项目资料与交付清单 30m'],
    ['connection-done-1','{{[[DONE]]}} 整理产品结构和设计说明 30m'],
    ['connection-done-2','((connection-source))'],
    ['connection-done-3','{{[[DONE]]}} 检查界面细节与任务状态 30m'],
    ['connection-done-4','{{[[DONE]]}} 完成文档示例与文字修订 30m'],
    ['connection-done-5','{{[[DONE]]}} 复核数据导出与归档记录 30m'],
    ['connection-done-6','{{[[DONE]]}} 对照测试结果和发布清单 30m'],
    ['connection-pending-0','{{[[TODO]]}} Write 45m'], ['connection-pending-1','{{[[TODO]]}} Ship 45m'],
  ].map(([uid,string],order)=>({'block/uid':uid,'block/string':string,'block/order':order,'block/refs':[]})),
  flow: [
    ['flow-event-0','06:00-07:35 Morning event'], ['flow-event-1','08:00-08:30 Breakfast'],
    ['flow-event-2','08:30-09:00 Travel'], ['flow-event-3','11:30-12:00 Return'],
    ['flow-event-4','12:00-12:30 Lunch'], ['flow-event-5','12:30-13:00 Break'],
    ['flow-current-event','13:00-13:30 Fixed appointment'], ['flow-event-7','17:00-17:30 Travel'],
    ['flow-review','18:30-19:00 Review'], ['flow-event-9','19:05-20:00 Evening event'],
    ['flow-task-0','{{[[TODO]]}} Submit brief 15m'], ['flow-task-1','{{[[TODO]]}} Outline guide 30m'],
    ['flow-task-2','{{[[TODO]]}} Prepare cover 30m'], ['flow-task-3','{{[[TODO]]}} Draft core 60m'],
    ['flow-task-4','{{[[TODO]]}} Refine interface 60m'], ['flow-task-5','{{[[TODO]]}} Write notes 40m'],
    ['flow-task-6','{{[[TODO]]}} Read 30m'], ['flow-task-7','{{[[TODO]]}} Flashcards 45m'],
    ['flow-done-0','{{[[DONE]]}} Completed sample one 20m'], ['flow-done-1','{{[[DONE]]}} Completed sample two 45m'],
  ].map(([uid,string],order)=>({'block/uid':uid,'block/string':string,'block/order':order,'block/refs':[]})),
  stress: realisticChildren.slice(0, 18).concat([
    { 'block/uid': 'overflow-0', 'block/string': '{{[[TODO]]}} 核对跨团队项目的全部需求并逐项检查设计内容与交付材料确保每个任务都能正常阅读 900m', 'block/order': 18, 'block/refs': [] },
    { 'block/uid': 'overflow-1', 'block/string': '{{[[TODO]]}} Overflow beta 900m', 'block/order': 19, 'block/refs': [] },
    { 'block/uid': 'overflow-2', 'block/string': '{{[[TODO]]}} Overflow gamma 900m', 'block/order': 20, 'block/refs': [] },
    { 'block/uid': 'overflow-3', 'block/string': `{{[[TODO]]}} ${'Long title '.repeat(260)}END_LONG 900m`, 'block/order': 21, 'block/refs': [] },
  ]),
  outside: [
    { 'block/uid': 'outside-event', 'block/string': '01:00-01:30 Earlier appointment', 'block/order': 0, 'block/refs': [] },
    { 'block/uid': 'outside-done', 'block/string': '{{[[DONE]]}} Earlier completion 20m d2', 'block/order': 1, 'block/refs': [] },
    { 'block/uid': 'midnight-done', 'block/string': '{{[[DONE]]}} Midnight completion 20m d0', 'block/order': 2, 'block/refs': [] },
  ],
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

let lastScene = null, lastSceneInput = null;
window.nautilusLogCore = {
  ...logCore,
  chartScene(input) {
    lastSceneInput = clone(input);
    const result = logCore.chartScene(input);
    lastScene = result;
    trace('chart-scene', { sourceUids: input.items.map(item => item.uid), kinds: result.records.map(record => record.kind) });
    return result;
  },
  calculateCapacity(input) {
    const result = logCore.calculateCapacity(input);
    trace('capacity', { result: clone(result) });
    return result;
  },
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
  settings: { language: parameters.get('lang') || 'en', ...(windowMode === 'overnight' ? { 'workday-start': 21, 'workday-end': 2 } : windowMode === 'flow' ? { 'workday-start': 6, 'workday-end': 20 } : {}) },
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
  activeClockListeners: () => clockListenerRecords.map(row => ({ target: row.target === window ? 'window' : 'document', type: row.type })),
  scene: () => clone(lastScene),
  sceneInput: () => clone(lastSceneInput),
  sourceRows: () => clone(children),
  expectedSourceUids: () => children.filter(row => {
    const item = resolveTaskInstance({ uid: row['block/uid'], localString: row['block/string'], references: row['block/refs'], fallbackMinutes: 15 });
    return item.kind !== 'structure' && item.title && item.title !== '(untitled)';
  }).map(row => row['block/uid']),
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
  advanceWallClock(iso) {
    fakeNow = new RealDate(iso);
    window.__chartFakeNowMs = fakeNow.getTime();
    trace('wall-clock-without-timer', { iso });
  },
  signalFocus() { window.dispatchEvent(new Event('focus')); },
  signalVisibility(value) {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value });
    document.dispatchEvent(new Event('visibilitychange'));
  },
  signalPageShow() { window.dispatchEvent(new Event('pageshow')); },
  setClock(iso) {
    if (realMinuteTimer) throw new Error('Manual minute callback is forbidden in the native-timer proof');
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
      presentation: lastScene?.frame || null,
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
      externalLabelCount: document.querySelectorAll('.nautilus-log-record-label').length,
      records: [...document.querySelectorAll('svg.nautilus-log-svg [data-task-uid]')].map(el => ({
        uid: el.dataset.taskUid, kind: el.dataset.chartKind, timeClaim: el.dataset.timeClaim,
        title: el.dataset.recordTitle, label: el.querySelector('.nautilus-log-record-title')?.textContent,
        aria: el.getAttribute('aria-label'), visible: getComputedStyle(el).visibility === 'visible',
        marks: el.querySelectorAll('.nautilus-log-slice,.nautilus-log-record-marker').length,
        markerPath: el.querySelector('.nautilus-log-record-marker')?.getAttribute('d') || null,
        markerShape: el.querySelector('.nautilus-log-record-marker')?.dataset.markerShape || null,
        labelSide: el.querySelector('.nautilus-log-record-title')?.dataset.labelSide,
        leader: el.querySelector('.nautilus-log-record-leader')?.getAttribute('d'),
      })),
      sourceUids: lastScene?.records.map(r => r.uid) || [],
      documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      svgCount: document.querySelectorAll('svg.nautilus-log-svg').length,
      sliceCount: document.querySelectorAll('.nautilus-log-event-slice-group[data-chart-kind="timed"]').length,
      recordCount: document.querySelectorAll('svg.nautilus-log-svg [data-task-uid]').length,
      detailText: detail?.textContent || null,
      bodyTooltipCount: document.body.querySelectorAll('[role="tooltip"]').length,
      writes: traces.filter((entry) => entry.kind === 'write').length,
      lastTimeline: [...traces].reverse().find((entry) => entry.kind === 'timeline-day-state') || null,
      lastPresentationObservation: [...traces].reverse().find(entry => entry.kind === 'presentation-observed') || null,
      nowLabel: document.querySelector('.nautilus-log-center-now')?.textContent || null,
      context,
      scheduleOpen: document.querySelector('.nautilus-log-compact-details')?.open ?? null,
      activeClockIntervals: [...fakeIntervals.values()].filter((entry) => entry.delay === 60000).length,
      labels: [...document.querySelectorAll('.nautilus-log-record-title')].filter(label => getComputedStyle(label).visibility === 'visible').map(label => rect(label)),
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
