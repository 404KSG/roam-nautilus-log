import {
  freezeCanonicalTemplate,
  inspectCanonicalTemplate,
  isRightSidebarRenderContext,
  readBlockTree,
  readExistingTemplateState,
  shouldSuppressRenderContext,
  inspectRendererScaffold,
  readRendererSource,
  readOwnedRendererSourceText,
  rendererSourceText,
  toggleRenderComponent,
  updateTemplateString,
} from "./entry-helpers";
import { createTodayPlanSession } from "./today-plan";
import { createTodayPlanLauncher } from "./today-plan-launcher";
import { createTodayPlanCommands } from "./today-plan-commands";
import * as logCore from "./log-core";
import * as timingCore from "./timing-core";
import { createTimingCommands } from "./timing-commands";
import {
  locateTaskInCurrentSurface,
  openTaskInRightSidebar,
  openPrimaryPlan,
  readAllEntries,
  readBlockString,
  readReferenceCompletionSource,
  readChildren,
  readPrimaryPlan,
  readActivePrimaryPlan,
  showToast,
} from "./timing-roam";
import { createTimingRuntime } from "./timing-runtime";
import { createCompletionStampWriter } from "./completion-stamp-writer";
import { createCompletionStampAdapter } from "./completion-stamp-adapter";
import { changedClockOwners, createRendererClockReader } from "./clock-reader";
import { createTimingTopbar } from "./timing-topbar";
import { createPlanWatchBridge } from "./plan-watch";
import { createRendererPlanSession } from "./renderer-plan-session";
import { REVISION as RENDERER_REVISION, CODE_UID as codeBlockUID, BRIDGE_KEY, inspectRenderer } from './renderer-contract';
import { installRendererBridge } from './renderer-bridge';
import { createRendererMigration, createRendererSourceUpgrade } from './renderer-migration';
import { graphName } from './graph-context';
import { createDeskView } from "./desk-view";
import { createDeskNotifications } from "./desk-notification";
import { createChartHelp } from "./chart-help";
import { createDeskActions } from "./desk-actions";
import {
  decideCalendarManagedChange,
  normalizeGoogleCalendarEvents,
  normalizeGoogleTasks,
} from "./calendar-core";
import { createCalendarReconciler } from "./calendar-reconcile";
import {
  createGoogleCalendarClient,
  parseGoogleCalendarIds,
} from "./calendar-google";
import { createCalendarRuntime } from "./calendar-runtime";
import {
  createPersistentGoogleAuthClient,
  parseCalendarConnection,
} from "./calendar-auth";

const componentName = "Nautilus Log";
// Source, namespace and bridge revision are defined by renderer-contract.
const renderStringCore = `{{[[roam/render]]:((${codeBlockUID}))`;
let activeCodeBlockUID = codeBlockUID;
let activeRenderStringCore = renderStringCore;
const disabledReplacementString = `{{${componentName}-disabled`;
const version = `r${RENDERER_REVISION}`;
const titleblockUID = "roam-render-Nautilus-Log";
const settingsEventName = "nautilus-log:settings-changed";
const languageDefaultVersion = "en-v1";
const productDefaultsVersion = "timing-v1";

// Keep the existing argument order for old templates; the new end-hour value
// is appended after the old color trigger argument.
const defaults = {
  "prefix-str": "[[Nautilus Log]]",
  "desc-length": 22,
  "todo-duration": 15,
  "workday-start": 5,
  "color-1-trigger": "",
  "workday-end": 21,
};

const executionDefaults = {
  "actual-time-tracking": false,
  "energy-bar-enabled": false,
  "timing-line-sidebar": true,
  "pomodoro-minutes": 45,
  "recent-retention-minutes": 45,
  "forgotten-timer-minutes": 120,
};

const completionStampDefaults = {
  // Deliberately separate from template defaults: this is extension-local
  // opt-in metadata, never a renderer argument or graph block field.
  "completion-stamps-enabled": false,
};

const calendarDefaults = {
  "google-calendar-enabled": false,
  "google-calendar-connection": "",
  "google-calendar-ids": "primary",
  "google-calendar-sync-state": "",
  "google-calendar-sync-pending": "",
};

let lifecycleGeneration = 0;
// Object identity protects r2 from a stale or legacy cleanup whose numeric
// generation happens to be the same after a reload.
let r2BridgeOwner = null;
let rendererBridge = null;
let rendererMigration = null;
let rendererSourceUpgrade = null;
function rendererScope() {
  const provider = typeof window === 'undefined' ? null : window.roamAlphaAPI;
  let user = '';
  try { user = provider?.user?.uid?.() || ''; } catch (_) {}
  return { provider, graph: graphName(typeof window === 'undefined' ? {} : window), type: provider?.graph?.type || '', user };
}
let trackingRequest = 0;
let trackingQueue = Promise.resolve();
let timingStartup = null;
let timingRuntime = null;
let timingTopbar = null;
let timingCommands = null;
let todayPlanSession = null;
let todayPlanLauncher = null;
let todayPlanCommands = null;
let planWatchBridge = null;
let deskView = null;
let chartHelp = null;
let deskActions = null;
let calendarRuntime = null;
let completionStampWriter = null;
let completionStampAdapter = null;
let calendarPanelState = { action: "", error: "" };
let unsubscribeClockRender = null;
const rendererClockCache = createRendererClockReader({
  getSnapshot: () => timingRuntime?.getSnapshot?.(),
});
const rendererClockContext = (taskUids) => rendererClockCache.readContext(taskUids);

function dailyPageBounds(pageTitle, logicalEndMinutes = 1440) {
  try {
    const parsed = window.roamAlphaAPI?.util?.pageTitleToDate?.(pageTitle) ?? logCore.dateForPlanTitle(pageTitle);
    return logCore.clockEvidenceBounds({ ownerDate: parsed, endMinutes: logicalEndMinutes }) || {};
  } catch (_error) {
    return {};
  }
}

function getClockRenderContext(pageTitle, taskUids = [], logicalEndMinutes = null) {
  const runtime = window.nautilusLogR2?.settings || window.nautilusLogExtensionData?.settings || {};
  const schedule = logCore.normalizeScheduleSettings({
    startHour: runtime['workday-start'],
    endHour: runtime['workday-end'],
  });
  const resolvedEnd = logicalEndMinutes !== null && logicalEndMinutes !== undefined && Number.isFinite(Number(logicalEndMinutes))
    ? Number(logicalEndMinutes)
    : schedule.endMinutes;
  return {
    ...rendererClockContext(taskUids),
    ...dailyPageBounds(pageTitle, resolvedEnd),
  };
}

/**
 * Resolve one chart row through the same authoritative task-instance core as
 * the execution panel. Roam does not always include a referenced block's
 * string in a nested Pull Watch snapshot, so the renderer must be able to
 * hydrate that source by UID instead of silently dropping the row.
 */
function resolveRendererTaskInstance(payload = {}, readString = readBlockString, readSource = readReferenceCompletionSource) {
  const safeReadString = (uid) => {
    try {
      const value = typeof readString === "function" ? readString(uid) : "";
      return typeof value === "string" ? value : "";
    } catch (error) {
      console.debug("[Nautilus Log] Referenced task source unavailable", error);
      return "";
    }
  };
  const input = payload && typeof payload === "object" ? payload : {};
  const instance = timingCore.resolveTaskInstance({ ...input, readString: safeReadString,
    includeCompletionEvidence: Object.prototype.hasOwnProperty.call(input, 'displayDate') });
  if (!instance.completionEvidence) return instance;
  const { localMinutes, localTimeInvalid = false, reference: candidate } = instance.completionEvidence;
  let reference = candidate?.state === 'unverified' ? { ...candidate } : null;
  if (candidate && !reference) {
    const chain = Array.isArray(candidate.sourceChain) && candidate.sourceChain.length
      ? candidate.sourceChain : [{ uid: candidate.sourceUid, string: candidate.sourceString }];
    let source = null;
    let changed = false;
    for (const expected of chain) {
      let current = null;
      try { current = typeof readSource === 'function' ? readSource(expected.uid) : null; } catch (_) { /* unverified, never guessed */ }
      if (!current || current.uid !== expected.uid || current.string !== expected.string) {
        source = current;
        changed = true;
        break;
      }
      source = current;
    }
    reference = changed || !source
      ? { state: 'unverified', sourceUid: candidate.sourceUid, sourceMinutes: candidate.minutes,
        reason: source ? 'source-changed' : 'source-unavailable' }
      : logCore.resolveReferenceCompletionTime({ sourceUid: candidate.sourceUid, sourceMinutes: candidate.minutes });
  }
  // Do not expose the extra raw source snapshot beyond this provenance check.
  return { ...instance, completionEvidence: { localMinutes, ...(localTimeInvalid ? { localTimeInvalid } : {}), reference } };
}

function settingValue(extensionAPI, key) {
  const value = extensionAPI.settings.get(key);
  return value === undefined || value === null ? defaults[key] : value;
}

function runtimeSettings(extensionAPI) {
  const calendarConnection = parseCalendarConnection(
    extensionAPI.settings.get("google-calendar-connection"),
  );
  const calendarConfigured = Boolean(calendarConnection);
  const calendarEnabled = extensionAPI.settings.get("google-calendar-enabled") === true
    && calendarConfigured;
  return {
    ...Object.fromEntries(
      Object.keys(defaults).map((key) => [key, settingValue(extensionAPI, key)]),
    ),
    ...Object.fromEntries(
      Object.entries(executionDefaults).map(([key, fallback]) => [
        key,
        extensionAPI.settings.get(key) ?? fallback,
      ]),
    ),
    "google-calendar-enabled": calendarEnabled,
    "google-calendar-configured": calendarConfigured,
    "google-calendar-tasks-configured": Number(calendarConnection?.version) >= 2,
    "completion-stamps-enabled": extensionAPI.settings.get("completion-stamps-enabled") === true,
    language: extensionAPI.settings.get("language") || "en",
  };
}

function publishRuntimeSettings(extensionAPI) {
  if (typeof window === "undefined") return;
  const settings = runtimeSettings(extensionAPI);
  rendererBridge?.publish(settings);
  if (typeof window.dispatchEvent === "function") {
    const event = typeof window.CustomEvent === "function"
      ? new window.CustomEvent(settingsEventName, { detail: { settings } })
      : { type: settingsEventName, detail: { settings } };
    window.dispatchEvent(event);
  }
}

async function generateUpdatedRenderString(renderCore, extensionAPI, replacementKey, newValue) {
  const values = Object.keys(defaults).map((key) => (
    key === replacementKey ? newValue : settingValue(extensionAPI, key)
  ));
  const [prefix, ...args] = values;
  const normalizedPrefix = String(prefix ?? "").trim();
  const quotedColor = args[3] === "" || args[3] === undefined
    ? '""'
    : `"${String(args[3]).replace(/\s/g, "")}"`;
  args[3] = quotedColor;
  return `${normalizedPrefix ? `${normalizedPrefix} ` : ""}${renderCore} ${args.join(" ")}}}`;
}

async function generateTemplateString(extensionAPI, renderCore = activeRenderStringCore) {
  const values = Object.keys(defaults).map((key) => settingValue(extensionAPI, key));
  const [prefix, ...args] = values;
  args[3] = args[3] === "" || args[3] === undefined
    ? '""'
    : `"${String(args[3]).replace(/\s/g, "")}"`;
  const normalizedPrefix = String(prefix ?? "").trim();
  return `${normalizedPrefix ? `${normalizedPrefix} ` : ""}${renderCore} ${args.join(" ")}}}`;
}

async function setDefaultSettings(extensionAPI, recoveredTemplateSettings = null) {
  await Promise.all(Object.entries({ ...defaults, ...executionDefaults, ...completionStampDefaults, ...calendarDefaults }).map(async ([key, fallback]) => {
    const current = extensionAPI.settings.get(key);
    const hasRecovered = recoveredTemplateSettings
      && Object.prototype.hasOwnProperty.call(recoveredTemplateSettings, key);
    const recovered = hasRecovered ? recoveredTemplateSettings[key] : fallback;
    const missing = current === undefined || current === null;
    const untouchedShorthandDefault = hasRecovered
      && Object.prototype.hasOwnProperty.call(defaults, key)
      && current === fallback
      && recovered !== fallback;
    if (missing || untouchedShorthandDefault) {
      await extensionAPI.settings.set(key, recovered);
    }
  }));
}

async function migratePreviewDefaults(extensionAPI, recoveredTemplateSettings = null) {
  if (extensionAPI.settings.get("product-defaults-version") === productDefaultsVersion) return;
  const prefix = extensionAPI.settings.get("prefix-str");
  const end = Number(extensionAPI.settings.get("workday-end"));
  const recoveredPrefix = recoveredTemplateSettings
    && Object.prototype.hasOwnProperty.call(recoveredTemplateSettings, "prefix-str");
  const recoveredEnd = recoveredTemplateSettings
    && Object.prototype.hasOwnProperty.call(recoveredTemplateSettings, "workday-end");
  if (prefix === "" && !recoveredPrefix) {
    await extensionAPI.settings.set("prefix-str", defaults["prefix-str"]);
  }
  if (end === 24 && !recoveredEnd) {
    await extensionAPI.settings.set("workday-end", defaults["workday-end"]);
  }
  await extensionAPI.settings.set("product-defaults-version", productDefaultsVersion);
}

function destroyTodayPlanLauncher() {
  todayPlanLauncher?.destroy();
  todayPlanLauncher = null;
}

function mountTodayPlanLauncher(extensionAPI) {
  destroyTodayPlanLauncher();
  if (typeof document === "undefined" || !todayPlanSession) return;
  todayPlanLauncher = createTodayPlanLauncher({
    todayPlan: todayPlanSession,
    extensionAPI,
  });
  todayPlanLauncher.initialize();
}

async function startTiming(extensionAPI) {
  if (timingRuntime || typeof document === "undefined") return true;
  if (timingStartup) return timingStartup.promise;
  const generation = lifecycleGeneration;
  const runtime = createTimingRuntime({
    extensionAPI,
    readPlan: planWatchBridge?.read,
    watchPlan: planWatchBridge?.subscribe,
    completionStampWriter,
  });
  const startup = { runtime, promise: null };
  timingStartup = startup;
  const assertStartup = () => {
    if (timingStartup !== startup || generation !== lifecycleGeneration || runtime.isDestroyed()) {
      throw new Error("Actual Time Tracking is no longer active.");
    }
  };
  startup.promise = Promise.resolve().then(async () => {
    let topbar = null;
    let commands = null;
    try {
      assertStartup();
      await runtime.initialize();
      assertStartup();
      topbar = createTimingTopbar({ runtime, extensionAPI, todayPlan: todayPlanSession });
      topbar.initialize();
      assertStartup();
      commands = createTimingCommands({ runtime, extensionAPI });
      commands.initialize();
      assertStartup();
      timingRuntime = runtime;
      let previousClockSnapshot = null;
      unsubscribeClockRender = runtime.subscribe((snapshot) => {
        const owners = changedClockOwners(previousClockSnapshot, snapshot);
        previousClockSnapshot = snapshot;
        if (!owners.length) return;
        rendererClockCache.invalidate(owners);
        if (typeof window.dispatchEvent === 'function' && typeof window.CustomEvent === 'function') {
          window.dispatchEvent(new window.CustomEvent('nautilus-log:clock-changed'));
        }
      });
      timingTopbar = topbar;
      timingCommands = commands;
      todayPlanSession?.initialize?.();
      rendererBridge?.publish(runtimeSettings(extensionAPI), true);
      return true;
    } catch (error) {
      commands?.destroy();
      topbar?.destroy();
      runtime.destroy();
      throw error;
    } finally {
      if (timingStartup === startup) timingStartup = null;
    }
  });
  return startup.promise;
}

async function stopTiming({ closeActive = false } = {}) {
  const pending = timingStartup;
  timingStartup = null;
  if (pending?.runtime !== timingRuntime) pending?.runtime.destroy();
  if (!timingRuntime) return true;
  if (closeActive) await timingRuntime.disable();
  else timingRuntime.destroy();
  unsubscribeClockRender?.();
  unsubscribeClockRender = null;
  rendererClockCache.clear();
  timingCommands?.destroy();
  timingTopbar?.destroy();
  timingRuntime = null;
  timingTopbar = null;
  timingCommands = null;
  rendererBridge?.publish(r2BridgeOwner?.settings || {}, false);
  return true;
}

function setTrackingEnabled(extensionAPI, enabled) {
  const request = ++trackingRequest;
  const generation = lifecycleGeneration;
  const current = () => request === trackingRequest && generation === lifecycleGeneration;
  const run = trackingQueue.then(() => current()
    ? applyTrackingSetting(extensionAPI, enabled, current)
    : extensionAPI.settings.get("actual-time-tracking"));
  trackingQueue = run.catch(() => undefined);
  return run;
}

async function applyTrackingSetting(extensionAPI, enabled, current) {
  if (enabled) {
    await extensionAPI.settings.set("actual-time-tracking", true);
    if (!current()) return extensionAPI.settings.get("actual-time-tracking");
    try {
      destroyTodayPlanLauncher();
      await startTiming(extensionAPI);
    } catch (error) {
      if (!current()) return extensionAPI.settings.get("actual-time-tracking");
      await extensionAPI.settings.set("actual-time-tracking", false);
      if (!current()) return extensionAPI.settings.get("actual-time-tracking");
      mountTodayPlanLauncher(extensionAPI);
      todayPlanSession?.initialize?.();
      publishRuntimeSettings(extensionAPI);
      throw error;
    }
  } else {
    try {
      await stopTiming({ closeActive: true });
      if (!current()) return extensionAPI.settings.get("actual-time-tracking");
      await extensionAPI.settings.set("actual-time-tracking", false);
      if (!current()) return extensionAPI.settings.get("actual-time-tracking");
      todayPlanSession?.initialize?.();
      mountTodayPlanLauncher(extensionAPI);
    } catch (error) {
      if (!current()) return extensionAPI.settings.get("actual-time-tracking");
      await extensionAPI.settings.set("actual-time-tracking", true);
      if (!current()) return extensionAPI.settings.get("actual-time-tracking");
      publishRuntimeSettings(extensionAPI);
      throw error;
    }
  }
  if (current()) publishRuntimeSettings(extensionAPI);
  return enabled;
}

async function initializeLanguage(extensionAPI) {
  const migrated = extensionAPI.settings.get("language-default-version") === languageDefaultVersion;
  const saved = extensionAPI.settings.get("language");
  if (!migrated) {
    await extensionAPI.settings.set("language", "en");
    await extensionAPI.settings.set("language-default-version", languageDefaultVersion);
    return "en";
  }
  if (saved === "en" || saved === "zh") return saved;
  await extensionAPI.settings.set("language", "en");
  return "en";
}

function panelConfig(extensionAPI, language, calendarUiState = calendarPanelState) {
  const zh = language === "zh";
  const labels = zh
    ? {
      tabTitle: "Nautilus Log",
      language: "语言 / Language",
      languageDesc: "选择设置面板显示的语言（切换后立即生效）。",
      start: "图表开始时间",
      startDesc: "选择计划日的开始整点（00:00–23:00）。默认 05:00。",
      end: "图表结束时间",
      endDesc: "选择结束整点；早于或等于开始时间表示次日。默认 21:00。",
      nextDay: "次日",
      prefix: "组件前缀文本",
      prefixDesc: "可选的展示文本，仅插入到新组件前（例如：#日程）；不会影响组件识别。",
      length: "最大图例长度",
      lengthDesc: "图表外部标签的最大长度，超出的文本会根据可用宽度截断。",
      duration: "默认待办时长",
      durationDesc: "没有写时长的弹性任务默认占用的分钟数。",
      color: "紧急触发词",
      colorDesc: "使任务显示为紧急红色的关键词（不可包含空格，例如：重要）。",
      completionStamps: "完成时间戳",
      completionStampsDesc: "可选，默认关闭。在大纲、侧栏和 Desk 完成任务后添加 dHH:MM，不启动 CLOCK/POMO，也不计入 Actual。请先停用 Todo Trigger；手写、旧插件及归属不明的时间戳会保留。",
      tracking: "执行层 · 进阶",
      trackingDesc: "可选功能。将计划转化为行动：支持任务聚焦、CLOCK 计时、多任务切换、一键完成和每日复盘。启用后会在下方显示执行设置；默认关闭。",
      energyBar: "用精力槽显示剩余容量",
      energyBarDesc: "用一根时间容量槽替换顶栏的剩余文本：实色为可自由安排的余量，浅色为未完成计划占用，空槽为已经流逝的弹性时间。",
      sidebar: "计时任务置顶到右侧边栏",
      sidebarDesc: "Clock In 或切换任务时，将当前 Timing Line 打开或移动到 Roam 右侧边栏顶部。",
      pomodoro: "番茄钟阈值",
      pomodoroDesc: "连续聚焦达到该分钟数后，顶栏计时变红但不会自动停止。任务切换不会重置。",
      recentRetention: "Recent 保留时间（分钟）",
      recentRetentionDesc: "Clock Out 或切换任务后，该任务在 Recent 中保留的分钟数。填写 0 可关闭 Recent。",
      forgottenTimer: "遗忘计时提醒（分钟）",
      forgottenTimerDesc: "单条 CLOCK 连续运行达到该时长后显示警告。填写 0 可关闭提醒；不会自动停止或删除计时。",
      calendar: "Google Calendar",
      calendarConnect: "连接",
      calendarDisconnect: "断开连接",
      calendarConnecting: "正在连接…",
      calendarDisconnecting: "正在断开…",
      calendarReconnecting: "正在重新连接…",
      calendarReconnect: "重新连接",
      calendarRetry: "重试",
      calendarDisconnectedDesc: "未连接 · 选择你的 Google 账号并授予只读权限；默认使用主日历。",
      calendarConnectingDesc: "正在等待 Google 授权 · 请在弹出的窗口中选择你的账号。",
      calendarConnectedDesc: "已连接 · 只读 · 主日历 + Google Tasks。使用图表中的 Calendar 按钮同步当前 Nautilus 日期。",
      calendarUpgradeDesc: "Calendar 已连接 · 重新连接一次即可启用 Google Tasks 同步。",
      calendarDisconnectingDesc: "正在安全撤销 Google Calendar 连接…",
      calendarConnectFailedDesc: "未能连接 Google Calendar。没有保存不完整的连接，请重试。",
      calendarDisconnectFailedDesc: "未能断开连接；现有连接已保留，请重试。",
    }
    : {
      tabTitle: "Nautilus Log",
      language: "Language",
      languageDesc: "Select the settings language (takes effect immediately).",
      start: "Chart Start Time",
      startDesc: "Choose any whole-hour start from 00:00 to 23:00. Defaults to 05:00.",
      end: "Chart End Time",
      endDesc: "Choose the ending hour; an hour at or before Start means next day. Defaults to 21:00.",
      nextDay: "next day",
      prefix: "Component Prefix",
      prefixDesc: "Optional display text inserted before a new component (for example, #schedule); it does not affect component detection.",
      length: "Legend Max Length",
      lengthDesc: "Maximum label length; long text is measured and truncated to fit.",
      duration: "Default Todo Duration",
      durationDesc: "Default minutes for an untimed flexible task.",
      color: "Urgent Trigger Word",
      colorDesc: "Keyword that colors a task urgent red (no spaces, for example urgent).",
      completionStamps: "Completion timestamp",
      completionStampsDesc: "Off by default. Adds dHH:MM after completion in the outline, sidebar, and Desk. It does not start CLOCK/POMO or measure Actual. Disable Todo Trigger first. Manual, legacy, and unverified timestamps stay intact.",
      tracking: "Execution Layer · Advanced",
      trackingDesc: "Optional. Turn your plan into action with focus, CLOCK timing, task switching, one-click completion, and daily Review. Enable to reveal execution settings; disabled by default.",
      energyBar: "Show capacity as an energy bar",
      energyBarDesc: "Replace the topbar's left text with one time-capacity bar: solid reserve is free flexible time, the pale layer is unfinished planned demand, and the empty track is elapsed flexible time.",
      sidebar: "Keep Timing Line first in right sidebar",
      sidebarDesc: "After Clock In or a task switch, open or move the Timing Line to the top of Roam's right sidebar.",
      pomodoro: "Pomodoro Threshold",
      pomodoroDesc: "Turn the live elapsed value red after this many continuous focus minutes. Switching tasks keeps the same cycle and never stops time automatically.",
      recentRetention: "Recent Retention (minutes)",
      recentRetentionDesc: "Keep a Clocked Out or switched task in Recent for this many minutes. Enter 0 to disable Recent.",
      forgottenTimer: "Forgotten Timer Warning (minutes)",
      forgottenTimerDesc: "Warn when one CLOCK has kept running for this many minutes. Enter 0 to disable; the warning never stops or deletes time automatically.",
      calendar: "Google Calendar",
      calendarConnect: "Connect",
      calendarDisconnect: "Disconnect",
      calendarConnecting: "Connecting…",
      calendarDisconnecting: "Disconnecting…",
      calendarReconnecting: "Reconnecting…",
      calendarReconnect: "Reconnect",
      calendarRetry: "Try again",
      calendarDisconnectedDesc: "Not connected · Choose your Google account and grant read-only access; Primary calendar is used by default.",
      calendarConnectingDesc: "Waiting for Google · Choose your Google account in the authorization window.",
      calendarConnectedDesc: "Connected · Read-only · Primary calendar + Google Tasks. Use the Calendar control in Nautilus to sync the current date.",
      calendarUpgradeDesc: "Calendar is connected · Reconnect once to enable Google Tasks sync.",
      calendarDisconnectingDesc: "Securely removing the Google Calendar connection…",
      calendarConnectFailedDesc: "Google Calendar could not connect. No partial connection was saved; try again.",
      calendarDisconnectFailedDesc: "Google Calendar could not disconnect. The existing connection was kept; try again.",
    };

  const update = async (key, value) => {
    const next = key === "color-1-trigger" ? String(value).replace(/\s/g, "") : value;
    await extensionAPI.settings.set(key, next);
    publishRuntimeSettings(extensionAPI);
    await updateTemplateString(
      activeRenderStringCore,
      await generateUpdatedRenderString(activeRenderStringCore, extensionAPI, key, next),
    );
  };

  const updateExecutionMinutes = async (key, event, fallback) => {
    const raw = event?.target?.value ?? event;
    if (String(raw ?? "").trim() === "") return;
    const parsed = Number(raw);
    const next = Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : fallback;
    await extensionAPI.settings.set(key, next);
    publishRuntimeSettings(extensionAPI);
    await timingRuntime?.requestRefresh?.();
  };

  const hourLabel = (hour) => `${String(Number(hour)).padStart(2, "0")}:00`;
  const parseHour = (value, fallback) => {
    const parsed = Number.parseInt(String(value ?? ""), 10);
    return Number.isInteger(parsed) ? parsed : fallback;
  };
  const scheduleSelection = logCore.normalizeScheduleSettings({
    startHour: settingValue(extensionAPI, "workday-start"),
    endHour: settingValue(extensionAPI, "workday-end"),
  });
  const { startHour, endHour } = scheduleSelection;
  const startItems = logCore.START_HOURS.map(hourLabel);
  const endLabel = (hour) => {
    const label = hourLabel(hour);
    return Number(hour) <= startHour && Number(hour) !== 24
      ? `${label} · ${labels.nextDay}`
      : label;
  };
  const endItems = logCore.END_HOURS.map(endLabel);
  const updateScheduleHour = async (key, value, fallback) => {
    await update(key, parseHour(value, fallback));
    extensionAPI.settings.panel.create(
      panelConfig(extensionAPI, extensionAPI.settings.get("language") || "en"),
    );
  };

  const executionEnabled = extensionAPI.settings.get("actual-time-tracking") === true;
  const calendarConnection = parseCalendarConnection(
    extensionAPI.settings.get("google-calendar-connection"),
  );
  const calendarConnected = Boolean(calendarConnection);
  const calendarNeedsTaskUpgrade = calendarConnected && Number(calendarConnection?.version) < 2;
  const calendarAction = String(calendarUiState?.action || "");
  const calendarError = String(calendarUiState?.error || "");
  const calendarBusy = calendarAction === "connecting"
    || calendarAction === "disconnecting"
    || calendarAction === "reconnecting";
  const calendarDescription = calendarAction === "connecting"
    ? labels.calendarConnectingDesc
    : calendarAction === "disconnecting"
      ? labels.calendarDisconnectingDesc
      : calendarAction === "reconnecting"
        ? labels.calendarConnectingDesc
        : calendarError === "connect"
          ? labels.calendarConnectFailedDesc
          : calendarError === "disconnect"
            ? labels.calendarDisconnectFailedDesc
            : calendarNeedsTaskUpgrade
              ? labels.calendarUpgradeDesc
              : calendarConnected
                ? labels.calendarConnectedDesc
                : labels.calendarDisconnectedDesc;
  const calendarButtonContent = calendarAction === "connecting"
    ? labels.calendarConnecting
    : calendarAction === "disconnecting"
      ? labels.calendarDisconnecting
      : calendarAction === "reconnecting"
        ? labels.calendarReconnecting
        : calendarError === "connect"
          ? labels.calendarRetry
          : calendarNeedsTaskUpgrade
            ? labels.calendarReconnect
            : calendarConnected
              ? labels.calendarDisconnect
              : labels.calendarConnect;
  const executionSettings = [
    {
      id: "energy-bar-enabled",
      name: labels.energyBar,
      description: labels.energyBarDesc,
      action: {
        type: "switch",
        defaultValue: extensionAPI.settings.get("energy-bar-enabled") ?? false,
        onChange: async (value) => {
          const enabled = typeof value === "boolean" ? value : Boolean(value?.target?.checked);
          await extensionAPI.settings.set("energy-bar-enabled", enabled);
          publishRuntimeSettings(extensionAPI);
        },
      },
    },
    {
      id: "timing-line-sidebar",
      name: labels.sidebar,
      description: labels.sidebarDesc,
      action: {
        type: "switch",
        defaultValue: extensionAPI.settings.get("timing-line-sidebar") ?? true,
        onChange: async (value) => {
          const enabled = typeof value === "boolean" ? value : Boolean(value?.target?.checked);
          await extensionAPI.settings.set("timing-line-sidebar", enabled);
          publishRuntimeSettings(extensionAPI);
        },
      },
    },
    {
      id: "pomodoro-minutes",
      name: labels.pomodoro,
      description: labels.pomodoroDesc,
      action: {
        type: "select",
        default: extensionAPI.settings.get("pomodoro-minutes") ?? 45,
        items: [15, 20, 25, 30, 45, 50, 60, 90],
        onChange: async (value) => {
          await extensionAPI.settings.set("pomodoro-minutes", value);
          publishRuntimeSettings(extensionAPI);
        },
      },
    },
    {
      id: "recent-retention-minutes",
      name: labels.recentRetention,
      description: labels.recentRetentionDesc,
      action: {
        type: "input",
        default: extensionAPI.settings.get("recent-retention-minutes") ?? 45,
        placeholder: "45",
        onChange: (event) => updateExecutionMinutes("recent-retention-minutes", event, 45),
      },
    },
    {
      id: "forgotten-timer-minutes",
      name: labels.forgottenTimer,
      description: labels.forgottenTimerDesc,
      action: {
        type: "input",
        default: extensionAPI.settings.get("forgotten-timer-minutes") ?? 120,
        placeholder: "120",
        onChange: (event) => updateExecutionMinutes("forgotten-timer-minutes", event, 120),
      },
    },
  ];

  return {
    tabTitle: labels.tabTitle,
    settings: [
      {
        id: "language",
        name: labels.language,
        description: labels.languageDesc,
        action: {
          type: "select",
          default: language,
          items: ["en", "zh"],
          onChange: async (value) => {
            await extensionAPI.settings.set("language", value);
            publishRuntimeSettings(extensionAPI);
            extensionAPI.settings.panel.create(panelConfig(extensionAPI, value));
          },
        },
      },
      {
        id: "workday-start",
        name: labels.start,
        description: labels.startDesc,
        action: {
          type: "select",
          default: hourLabel(startHour),
          items: startItems,
          onChange: (value) => updateScheduleHour("workday-start", value, 5),
        },
      },
      {
        id: "workday-end",
        name: labels.end,
        description: labels.endDesc,
        action: {
          type: "select",
          default: endLabel(endHour),
          items: endItems,
          onChange: (value) => updateScheduleHour("workday-end", value, 21),
        },
      },
      {
        id: "desc-length",
        name: labels.length,
        description: labels.lengthDesc,
        action: { type: "select", default: settingValue(extensionAPI, "desc-length"), items: [14, 16, 18, 20, 22, 24, 26, 28], onChange: (value) => update("desc-length", value) },
      },
      {
        id: "todo-duration",
        name: labels.duration,
        description: labels.durationDesc,
        action: { type: "select", default: settingValue(extensionAPI, "todo-duration"), items: [5, 10, 15, 20, 25, 30, 45, 60], onChange: (value) => update("todo-duration", value) },
      },
      {
        id: "prefix-str",
        name: labels.prefix,
        description: labels.prefixDesc,
        action: { type: "input", default: settingValue(extensionAPI, "prefix-str"), onChange: (event) => update("prefix-str", event.target.value) },
      },
      {
        id: "color-1-trigger",
        name: labels.color,
        description: labels.colorDesc,
        action: { type: "input", default: settingValue(extensionAPI, "color-1-trigger"), onChange: (event) => update("color-1-trigger", event.target.value) },
      },
      {
        id: "google-calendar-connection-action",
        name: labels.calendar,
        description: calendarDescription,
        action: {
          type: "button",
          content: calendarButtonContent,
          class: `bp3-button bp3-minimal${calendarBusy ? " bp3-disabled" : ""}`,
          onClick: async () => {
            if (calendarBusy || calendarPanelState.action) return;
            const connection = parseCalendarConnection(
              extensionAPI.settings.get("google-calendar-connection"),
            );
            const reconnecting = Boolean(connection) && Number(connection?.version) < 2;
            const disconnecting = Boolean(connection) && !reconnecting;
            calendarPanelState = {
              action: reconnecting ? "reconnecting" : disconnecting ? "disconnecting" : "connecting",
              error: "",
            };
            const recreatePanel = () => extensionAPI.settings.panel.create(
              panelConfig(extensionAPI, extensionAPI.settings.get("language") || "en"),
            );
            recreatePanel();
            try {
              if (!calendarRuntime) throw new Error("Google Calendar connection is not ready.");
              if (reconnecting) await calendarRuntime.reconnect();
              else if (disconnecting) await calendarRuntime.disconnect();
              else await calendarRuntime.connect();
              calendarPanelState = { action: "", error: "" };
            } catch (error) {
              calendarPanelState = {
                action: "",
                error: disconnecting && !reconnecting ? "disconnect" : "connect",
              };
              console.warn(
                `[Nautilus Log] Google Calendar ${disconnecting && !reconnecting ? "disconnect" : "connect"} failed`,
                error,
              );
            } finally {
              publishRuntimeSettings(extensionAPI);
              recreatePanel();
            }
          },
        },
      },
      {
        id: "completion-stamps-enabled",
        name: labels.completionStamps,
        description: labels.completionStampsDesc,
        action: {
          type: "switch",
          defaultValue: extensionAPI.settings.get("completion-stamps-enabled") === true,
          onChange: async (value) => {
            const enabled = typeof value === "boolean" ? value : Boolean(value?.target?.checked);
            // Cancel before awaiting persistence: rapid off/on changes must not
            // revive an older gesture or direct completion after async work.
            const writer = completionStampWriter, adapter = completionStampAdapter;
            const settle = writer?.beginSettingsChange?.();
            adapter?.sync?.();
            try { await extensionAPI.settings.set("completion-stamps-enabled", enabled); }
            finally {
              settle?.();
              if (writer === completionStampWriter && adapter === completionStampAdapter) {
                publishRuntimeSettings(extensionAPI);
                adapter?.sync?.();
                if (writer?.enabled?.()) writer.refuseConflict();
              }
            }
          },
        },
      },
      {
        id: "actual-time-tracking",
        name: labels.tracking,
        description: labels.trackingDesc,
        action: {
          type: "switch",
          defaultValue: extensionAPI.settings.get("actual-time-tracking") ?? false,
          onChange: async (value) => {
            const enabled = typeof value === "boolean" ? value : Boolean(value?.target?.checked);
            try {
              await setTrackingEnabled(extensionAPI, enabled);
            } finally {
              extensionAPI.settings.panel.create(panelConfig(extensionAPI, extensionAPI.settings.get("language") || "en"));
            }
          },
        },
      },
      ...(executionEnabled ? executionSettings : []),
    ],
  };
}

async function onload({ extensionAPI }) {
  // A stale loader must not displace a working owner before source preflight.
  if (typeof window !== 'undefined' && window[BRIDGE_KEY]?.running) {
    let state;
    try { state = readRendererSource().state; } catch (_) { state = 'unreadable'; }
    if (window[BRIDGE_KEY].revision > RENDERER_REVISION || !['current','absent'].includes(state)) {
      showToast('This client cannot replace the active renderer. Update the extension or inspect the renderer source.', 'warning');
      return;
    }
  }
  const generation = ++lifecycleGeneration;
  trackingRequest += 1;
  trackingQueue = Promise.resolve();
  const currentLoad = () => generation === lifecycleGeneration;
  rendererSourceUpgrade?.destroy();
  rendererSourceUpgrade = null;
  rendererMigration?.destroy();
  rendererMigration = null;
  rendererBridge?.destroy();
  rendererBridge = null;
  rendererClockCache.clear();
  activeCodeBlockUID = codeBlockUID;
  activeRenderStringCore = renderStringCore;
  calendarPanelState = { action: "", error: "" };
  completionStampAdapter?.destroy();
  completionStampAdapter = null;
  completionStampWriter?.destroy();
  completionStampWriter = null;
  chartHelp?.destroy();
  chartHelp = createChartHelp({
    revision: typeof __NAUTILUS_SOURCE_REVISION__ === 'string' ? __NAUTILUS_SOURCE_REVISION__ : 'unknown',
  });
  deskView?.destroy();
  deskActions?.destroy();
  planWatchBridge?.destroy();
  planWatchBridge = createPlanWatchBridge({ readString: readBlockString });
  let loadBridge = null;
  let loadCalendar = null;
  deskActions = createDeskActions();
  deskView = createDeskView({
    actions: deskActions,
    notify: (message) => showToast(message, 'warning'),
    openTask: (uid, sidebar) => sidebar ? openTaskInRightSidebar(uid) : openPrimaryPlan(uid),
    readPlan: planWatchBridge.read,
    watchPlan: planWatchBridge.subscribe,
    readString: readBlockString,
    readChildren,
    getSettings: () => loadBridge?.bridge.settings || {},
  });
  const ownedDesk = deskView, ownedHelp = chartHelp, ownedWatch = planWatchBridge;
  loadBridge = installRendererBridge({ host: window, core: logCore, taskCore: timingCore,
    getScope: rendererScope,
    canMutatePlan: (uid, family) => {
      const info = inspectRenderer(readBlockString(uid));
      return info.mutable && (family === 'legacy' ? info.kind === 'legacy' : info.kind === 'current');
    },
    services: {
      shouldSuppressRenderContext, isRightSidebarRenderContext, getClockRenderContext,
      resolveTaskInstance: resolveRendererTaskInstance, createRendererPlanSession,
      readPlan: ownedWatch.read, watchPlan: ownedWatch.subscribe,
      openDesk: options => ownedDesk.open(options),
      registerDeskHost: options => ownedDesk.registerHost(options),
      closeDeskHost: container => ownedDesk.closeForHost(container),
      toggleChartHelp: options => ownedHelp.toggle(options), closeChartHelp: anchor => ownedHelp.closeForAnchor(anchor),
      locatePlanTask: (uid, origin, sidebar = false) => sidebar ? openTaskInRightSidebar(uid) : locateTaskInCurrentSurface(uid, { origin }),
      syncCalendarPlan: options => loadCalendar ? loadCalendar.syncPlan(options) : Promise.reject(Error('Google Calendar sync is not ready.')),
    },
  });
  rendererBridge = loadBridge;
  r2BridgeOwner = loadBridge.bridge;
  const sourceProgramReady = (allowOlder = false) => {
    const source = readRendererSource();
    return source.programIsolated && (source.state === 'current' || (allowOlder && source.state === 'older'));
  };
  rendererMigration = createRendererMigration({ extensionAPI,
    sourceReady: () => currentLoad() && loadBridge.owns() && sourceProgramReady(),
    notify: message => showToast(message, 'warning'),
  });
  const loadMigration = rendererMigration;
  rendererSourceUpgrade = createRendererSourceUpgrade({ extensionAPI,
    expectedSource: rendererSourceText, read: readOwnedRendererSourceText,
    sourceReady: () => currentLoad() && loadBridge.owns() && sourceProgramReady(true),
    notify: message => showToast(message, 'warning'),
  });
  const loadSourceUpgrade = rendererSourceUpgrade;
  const sourceConfirmed = () => sourceProgramReady() && !loadSourceUpgrade.hasPending();
  // A legacy template may provide settings, never r2 mutation authority over
  // its code UID. New creation and template repair always target r2.
  const recoveredTemplateState = readExistingTemplateState(renderStringCore);
  await setDefaultSettings(extensionAPI, recoveredTemplateState?.settings);
  if (!currentLoad()) return;
  completionStampWriter = createCompletionStampWriter({
    extensionAPI,
    notify: (message) => showToast(message, 'warning'),
  });
  completionStampAdapter = createCompletionStampAdapter({ writer: completionStampWriter });
  if (completionStampWriter.enabled()) completionStampWriter.refuseConflict();
  await migratePreviewDefaults(extensionAPI, recoveredTemplateState?.settings);
  if (!currentLoad()) return;
  const language = await initializeLanguage(extensionAPI);
  if (!currentLoad()) return;
  calendarRuntime?.destroy();
  calendarRuntime = createCalendarRuntime({
    extensionAPI,
    onConnectionChange: () => {
      if (!currentLoad()) return;
      publishRuntimeSettings(extensionAPI);
      if (!calendarPanelState.action) {
        extensionAPI.settings.panel.create(
          panelConfig(extensionAPI, extensionAPI.settings.get("language") || "en"),
        );
      }
    },
  });
  loadCalendar = calendarRuntime;
  calendarRuntime.prepare()
    .catch((error) => {
      console.debug("[Nautilus Log] Google Calendar connection restore unavailable", error);
    });
  publishRuntimeSettings(extensionAPI);
  extensionAPI.settings.panel.create(panelConfig(extensionAPI, language));
  const templateString = await generateTemplateString(extensionAPI);
  if (!currentLoad()) return;
  const assertRendererLoad = () => {
    if (!currentLoad() || !loadBridge.owns()) throw Error('Renderer installation was superseded or the graph changed.');
  };
  try {
    await toggleRenderComponent(true, titleblockUID, version, activeRenderStringCore,
      disabledReplacementString, activeCodeBlockUID, componentName, templateString,
      { assertActive: assertRendererLoad, migrateReference: loadMigration.migrate,
        hasPendingSource: loadSourceUpgrade.hasPending,
        ensureSource: options => sourceConfirmed() ? { ok: true, changed: false } : loadSourceUpgrade.upgrade(options) });
    assertRendererLoad();
    // Only the current plan is considered. The shared active-workday reader
    // supplies the overnight owner when that context is available.
    const active = readActivePrimaryPlan(new Date(), runtimeSettings(extensionAPI), Number(extensionAPI.settings.get('todo-duration')) || 15);
    if (active.plan && inspectRenderer(active.plan.string).kind === 'legacy') {
      const targetUid = active.plan.uid, targetTitle = active.pageTitle;
      const result = await loadMigration.migrate({ uid: targetUid, kind: 'active-plan', expected: active.plan.string,
        isCurrent: () => {
          assertRendererLoad();
          const current = readActivePrimaryPlan(new Date(), runtimeSettings(extensionAPI), Number(extensionAPI.settings.get('todo-duration')) || 15);
          return current.plan?.uid === targetUid && current.pageTitle === targetTitle;
        } });
      if (!result.ok) throw Error('The active plan renderer update is unconfirmed; its contents were preserved for inspection.');
    }
  } catch (error) {
    if (!currentLoad()) return;
    loadBridge.bridge.error = error.message;
    showToast(error.message, 'warning');
  }
  if (!currentLoad()) return;
  let codeReady = false;
  try { codeReady = sourceConfirmed(); } catch (_) {}
  loadBridge.setReady(codeReady, loadBridge.bridge.error || '');
  publishRuntimeSettings(extensionAPI);
  if (!codeReady) return;
  ownedDesk.restoreMountedHosts(options => {
    const revision = options.container.closest?.('[data-nautilus-renderer]')?.getAttribute('data-nautilus-renderer');
    if (revision === String(RENDERER_REVISION)) loadBridge.bridge.registerDeskHost(options);
    else if (!revision || revision === '1') loadBridge.legacy?.registerDeskHost(options);
  });
  todayPlanSession?.destroy?.();
  todayPlanSession = createTodayPlanSession({
    extensionAPI,
    canCreate: () => currentLoad() && loadBridge.owns() && sourceConfirmed(),
    buildComponentString: () => generateTemplateString(extensionAPI, activeRenderStringCore),
    inspectTemplate: () => inspectCanonicalTemplate(activeRenderStringCore),
    freezeTemplate: () => freezeCanonicalTemplate(activeRenderStringCore),
    readTemplateTree: (uid) => readBlockTree(uid),
    trackingEnabled: () => extensionAPI.settings.get("actual-time-tracking") === true,
    readTrackingSnapshot: () => (
      typeof timingRuntime?.getSnapshot === "function" ? timingRuntime.getSnapshot() : null
    ),
    requestTrackingRefresh: (options) => timingRuntime?.requestRefresh?.(options),
    subscribeTracking: (listener) => {
      if (typeof timingRuntime?.subscribe !== "function") return () => {};
      return timingRuntime.subscribe(listener);
    },
  });
  todayPlanSession.initialize();
  todayPlanCommands?.destroy?.();
  todayPlanCommands = createTodayPlanCommands({
    extensionAPI,
    todayPlan: todayPlanSession,
  });
  todayPlanCommands.initialize();
  if (extensionAPI.settings.get("actual-time-tracking") === true) {
    try {
      destroyTodayPlanLauncher();
      await startTiming(extensionAPI);
    } catch (error) {
      if (!currentLoad()) return;
      await extensionAPI.settings.set("actual-time-tracking", false);
      if (!currentLoad()) return;
      publishRuntimeSettings(extensionAPI);
      extensionAPI.settings.panel.create(panelConfig(extensionAPI, language));
      todayPlanSession.initialize();
      mountTodayPlanLauncher(extensionAPI);
      console.error("[Nautilus Log] Actual Time Tracking could not start", error);
    }
  } else {
    mountTodayPlanLauncher(extensionAPI);
  }
}

function onunload() {
  lifecycleGeneration += 1;
  trackingRequest += 1;
  todayPlanCommands?.destroy();
  todayPlanCommands = null;
  destroyTodayPlanLauncher();
  todayPlanSession?.destroy();
  todayPlanSession = null;
  stopTiming({ closeActive: false });
  chartHelp?.destroy();
  chartHelp = null;
  deskView?.destroy();
  deskView = null;
  deskActions?.destroy();
  deskActions = null;
  planWatchBridge?.destroy();
  planWatchBridge = null;
  calendarRuntime?.destroy();
  calendarRuntime = null;
  completionStampAdapter?.destroy();
  completionStampAdapter = null;
  completionStampWriter?.destroy();
  completionStampWriter = null;
  calendarPanelState = { action: "", error: "" };
  rendererClockCache.clear();
  rendererSourceUpgrade?.destroy();
  rendererSourceUpgrade = null;
  rendererMigration?.destroy();
  rendererMigration = null;
  rendererBridge?.destroy();
  rendererBridge = null;
  r2BridgeOwner = null;
  // Do not mutate the graph during unload; the render scaffolding is owned by
  // the user's graph and should remain available for a later reload.
  return toggleRenderComponent(
    false,
    titleblockUID,
    version,
    activeRenderStringCore,
    disabledReplacementString,
    activeCodeBlockUID,
    componentName,
    "",
  );
}

export {
  createDeskView,
  createDeskNotifications,
  createDeskActions,
  createTimingRuntime,
  createCompletionStampWriter,
  createCompletionStampAdapter,
  createRendererClockReader,
  changedClockOwners,
  createRendererPlanSession,
  createRendererMigration,
  createRendererSourceUpgrade,
  installRendererBridge,
  inspectRendererScaffold,
  readRendererSource,
  createTimingCommands,
  createTodayPlanSession,
  createTodayPlanLauncher,
  createTodayPlanCommands,
  inspectCanonicalTemplate,
  freezeCanonicalTemplate,
  readBlockTree,
  createPlanWatchBridge,
  readPrimaryPlan,
  readActivePrimaryPlan,
  readChildren,
  resolveRendererTaskInstance,
  generateTemplateString,
  generateUpdatedRenderString,
  panelConfig,
  defaults,
  executionDefaults,
  calendarDefaults,
  completionStampDefaults,
  normalizeGoogleCalendarEvents,
  normalizeGoogleTasks,
  decideCalendarManagedChange,
  createCalendarReconciler,
  createGoogleCalendarClient,
  createPersistentGoogleAuthClient,
  parseGoogleCalendarIds,
  parseCalendarConnection,
  createCalendarRuntime,
  locateTaskInCurrentSurface,
};

export default { onload, onunload };
