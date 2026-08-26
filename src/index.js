import {
  isRightSidebarRenderContext,
  shouldSuppressRenderContext,
  toggleRenderComponent,
  updateTemplateString,
} from "./entry-helpers";
import * as logCore from "./log-core";
import * as timingCore from "./timing-core";
import { createTimingCommands } from "./timing-commands";
import { readAllEntries, readBlockString, readEntriesForTaskUids } from "./timing-roam";
import { createTimingRuntime } from "./timing-runtime";
import { createTimingTopbar } from "./timing-topbar";
import { createPlanWatchBridge } from "./plan-watch";
import { createPlanTidy } from "./tidy-plan";
import "../extension.css";

const componentName = "Nautilus Log";
const codeBlockUID = "roam-render-Nautilus-Log-cljs";
const renderStringCore = `{{[[roam/render]]:((${codeBlockUID}))`;
const disabledReplacementString = `{{${componentName}-disabled`;
const version = "v1";
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
  "timing-line-sidebar": true,
  "pomodoro-minutes": 45,
  "recent-retention-minutes": 45,
  "forgotten-timer-minutes": 120,
};

let timingRuntime = null;
let timingTopbar = null;
let timingCommands = null;
let planWatchBridge = null;
let planTidy = null;
const rendererClockCacheMs = 15_000;
const rendererClockCache = new Map();

function rendererClockCacheKey(taskUids = []) {
  return [...new Set((Array.isArray(taskUids) ? taskUids : []).filter(Boolean))].sort().join('\u0000');
}

function cacheRendererClockEntries(entries, key = '') {
  const previous = rendererClockCache.get(key);
  if (!Array.isArray(entries)) return previous?.entries || [];
  rendererClockCache.set(key, { entries, readAt: Date.now() });
  return entries;
}

function rendererClockEntries(taskUids = []) {
  const runtimeEntries = timingRuntime?.getSnapshot?.()?.entries;
  if (Array.isArray(runtimeEntries)) return runtimeEntries;
  const key = rendererClockCacheKey(taskUids);
  const cached = rendererClockCache.get(key);
  if (cached && Date.now() - cached.readAt < rendererClockCacheMs) {
    return cached.entries;
  }
  try {
    return cacheRendererClockEntries(readEntriesForTaskUids(taskUids), key);
  } catch (error) {
    console.debug("[Nautilus Log] CLOCK render snapshot unavailable", error);
    return cached?.entries || [];
  }
}

function dailyPageBounds(pageTitle, logicalEndMinutes = 1440) {
  try {
    const parsed = window.roamAlphaAPI?.util?.pageTitleToDate?.(pageTitle);
    const date = parsed instanceof Date ? parsed : new Date(parsed);
    if (!Number.isFinite(date.getTime())) return {};
    const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const endMinutes = Number(logicalEndMinutes);
    const dayEnd = Number.isFinite(endMinutes) && endMinutes > 1440
      ? new Date(dayStart.getTime() + endMinutes * 60_000)
      : new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
    return { dayStartMs: dayStart.getTime(), dayEndMs: dayEnd.getTime() };
  } catch (_error) {
    return {};
  }
}

function getClockRenderContext(pageTitle, taskUids = [], logicalEndMinutes = null) {
  const runtime = window.nautilusLogExtensionData?.settings || {};
  const schedule = logCore.normalizeScheduleSettings({
    startHour: runtime['workday-start'],
    endHour: runtime['workday-end'],
  });
  const resolvedEnd = Number.isFinite(Number(logicalEndMinutes))
    ? Number(logicalEndMinutes)
    : schedule.endMinutes;
  return {
    entries: rendererClockEntries(taskUids),
    ...dailyPageBounds(pageTitle, resolvedEnd),
  };
}

/**
 * Resolve one chart row through the same authoritative task-instance core as
 * the execution panel. Roam does not always include a referenced block's
 * string in a nested Pull Watch snapshot, so the renderer must be able to
 * hydrate that source by UID instead of silently dropping the row.
 */
function resolveRendererTaskInstance(payload = {}, readString = readBlockString) {
  const safeReadString = (uid) => {
    try {
      const value = typeof readString === "function" ? readString(uid) : "";
      return typeof value === "string" ? value : "";
    } catch (error) {
      console.debug("[Nautilus Log] Referenced task source unavailable", error);
      return "";
    }
  };
  return timingCore.resolveTaskInstance({
    ...(payload && typeof payload === "object" ? payload : {}),
    readString: safeReadString,
  });
}

function settingValue(extensionAPI, key) {
  const value = extensionAPI.settings.get(key);
  return value === undefined || value === null ? defaults[key] : value;
}

function runtimeSettings(extensionAPI) {
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
    language: extensionAPI.settings.get("language") || "en",
  };
}

function publishRuntimeSettings(extensionAPI) {
  if (typeof window === "undefined") return;
  const settings = runtimeSettings(extensionAPI);
  window.nautilusLogExtensionData = {
    ...(window.nautilusLogExtensionData || {}),
    settings,
  };
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

async function generateTemplateString(extensionAPI) {
  const values = Object.keys(defaults).map((key) => settingValue(extensionAPI, key));
  const [prefix, ...args] = values;
  args[3] = args[3] === "" || args[3] === undefined
    ? '""'
    : `"${String(args[3]).replace(/\s/g, "")}"`;
  const normalizedPrefix = String(prefix ?? "").trim();
  return `${normalizedPrefix ? `${normalizedPrefix} ` : ""}${renderStringCore} ${args.join(" ")}}}`;
}

async function setDefaultSettings(extensionAPI) {
  await Promise.all(Object.entries({ ...defaults, ...executionDefaults }).map(async ([key, fallback]) => {
    const current = extensionAPI.settings.get(key);
    if (current === undefined || current === null) await extensionAPI.settings.set(key, fallback);
  }));
}

async function migratePreviewDefaults(extensionAPI) {
  if (extensionAPI.settings.get("product-defaults-version") === productDefaultsVersion) return;
  const prefix = extensionAPI.settings.get("prefix-str");
  const end = Number(extensionAPI.settings.get("workday-end"));
  if (prefix === "") await extensionAPI.settings.set("prefix-str", defaults["prefix-str"]);
  if (end === 24) await extensionAPI.settings.set("workday-end", defaults["workday-end"]);
  await extensionAPI.settings.set("product-defaults-version", productDefaultsVersion);
}

async function startTiming(extensionAPI) {
  if (timingRuntime || typeof document === "undefined") return true;
  const runtime = createTimingRuntime({
    extensionAPI,
    watchPlan: planWatchBridge?.subscribe,
  });
  let topbar = null;
  let commands = null;
  try {
    await runtime.initialize();
    topbar = createTimingTopbar({ runtime, extensionAPI });
    topbar.initialize();
    commands = createTimingCommands({ runtime, extensionAPI });
    commands.initialize();
    timingRuntime = runtime;
    timingTopbar = topbar;
    timingCommands = commands;
  } catch (error) {
    commands?.destroy();
    topbar?.destroy();
    runtime.destroy();
    throw error;
  }
  if (window.nautilusLogExtensionData) {
    window.nautilusLogExtensionData.timingEnabled = true;
  }
  return true;
}

async function stopTiming({ closeActive = false } = {}) {
  if (!timingRuntime) return true;
  if (closeActive) await timingRuntime.disable();
  else timingRuntime.destroy();
  rendererClockCache.clear();
  timingCommands?.destroy();
  timingTopbar?.destroy();
  timingRuntime = null;
  timingTopbar = null;
  timingCommands = null;
  if (typeof window !== "undefined" && window.nautilusLogExtensionData) {
    window.nautilusLogExtensionData.timingEnabled = false;
  }
  return true;
}

async function setTrackingEnabled(extensionAPI, enabled) {
  if (enabled) {
    await extensionAPI.settings.set("actual-time-tracking", true);
    try {
      await startTiming(extensionAPI);
    } catch (error) {
      await extensionAPI.settings.set("actual-time-tracking", false);
      publishRuntimeSettings(extensionAPI);
      throw error;
    }
  } else {
    try {
      await stopTiming({ closeActive: true });
      await extensionAPI.settings.set("actual-time-tracking", false);
    } catch (error) {
      await extensionAPI.settings.set("actual-time-tracking", true);
      publishRuntimeSettings(extensionAPI);
      throw error;
    }
  }
  publishRuntimeSettings(extensionAPI);
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

function panelConfig(extensionAPI, language) {
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
      tracking: "执行层 · 进阶",
      trackingDesc: "可选功能。将计划转化为行动：支持任务聚焦、CLOCK 计时、多任务切换、一键完成和每日复盘。启用后会在下方显示执行设置；默认关闭。",
      sidebar: "计时任务置顶到右侧边栏",
      sidebarDesc: "Clock In 或切换任务时，将当前 Timing Line 打开或移动到 Roam 右侧边栏顶部。",
      pomodoro: "番茄钟阈值",
      pomodoroDesc: "连续聚焦达到该分钟数后，顶栏计时变红但不会自动停止。任务切换不会重置。",
      recentRetention: "Recent 保留时间（分钟）",
      recentRetentionDesc: "Clock Out 或切换任务后，该任务在 Recent 中保留的分钟数。填写 0 可关闭 Recent。",
      forgottenTimer: "遗忘计时提醒（分钟）",
      forgottenTimerDesc: "单条 CLOCK 连续运行达到该时长后显示警告。填写 0 可关闭提醒；不会自动停止或删除计时。",
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
      tracking: "Execution Layer · Advanced",
      trackingDesc: "Optional. Turn your plan into action with focus, CLOCK timing, task switching, one-click completion, and daily Review. Enable to reveal execution settings; disabled by default.",
      sidebar: "Keep Timing Line first in right sidebar",
      sidebarDesc: "After Clock In or a task switch, open or move the Timing Line to the top of Roam's right sidebar.",
      pomodoro: "Pomodoro Threshold",
      pomodoroDesc: "Turn the live elapsed value red after this many continuous focus minutes. Switching tasks keeps the same cycle and never stops time automatically.",
      recentRetention: "Recent Retention (minutes)",
      recentRetentionDesc: "Keep a Clocked Out or switched task in Recent for this many minutes. Enter 0 to disable Recent.",
      forgottenTimer: "Forgotten Timer Warning (minutes)",
      forgottenTimerDesc: "Warn when one CLOCK has kept running for this many minutes. Enter 0 to disable; the warning never stops or deletes time automatically.",
    };

  const update = async (key, value) => {
    const next = key === "color-1-trigger" ? String(value).replace(/\s/g, "") : value;
    await extensionAPI.settings.set(key, next);
    publishRuntimeSettings(extensionAPI);
    await updateTemplateString(renderStringCore, await generateUpdatedRenderString(renderStringCore, extensionAPI, key, next));
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
  const executionSettings = [
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
        id: "prefix-str",
        name: labels.prefix,
        description: labels.prefixDesc,
        action: { type: "input", default: settingValue(extensionAPI, "prefix-str"), onChange: (event) => update("prefix-str", event.target.value) },
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
        id: "color-1-trigger",
        name: labels.color,
        description: labels.colorDesc,
        action: { type: "input", default: settingValue(extensionAPI, "color-1-trigger"), onChange: (event) => update("color-1-trigger", event.target.value) },
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
  planWatchBridge?.destroy();
  planWatchBridge = createPlanWatchBridge({ readString: readBlockString });
  planTidy?.clear();
  planTidy = createPlanTidy({
    runningTaskUid: () => timingRuntime?.getSnapshot?.()?.entries
      ?.find((entry) => entry?.running === true)?.taskUid || null,
  });
  window.nautilusLogCore = logCore;
  window.nautilusLogTaskCore = timingCore;
  window.nautilusLogExtensionData = {
    running: true,
    shouldSuppressRenderContext,
    isRightSidebarRenderContext,
    getClockRenderContext,
    resolveTaskInstance: resolveRendererTaskInstance,
    readPlan: planWatchBridge.read,
    watchPlan: planWatchBridge.subscribe,
    tidyPlan: planTidy.run,
  };
  await setDefaultSettings(extensionAPI);
  await migratePreviewDefaults(extensionAPI);
  const language = await initializeLanguage(extensionAPI);
  publishRuntimeSettings(extensionAPI);
  extensionAPI.settings.panel.create(panelConfig(extensionAPI, language));
  await toggleRenderComponent(
    true,
    titleblockUID,
    version,
    renderStringCore,
    disabledReplacementString,
    codeBlockUID,
    componentName,
    await generateTemplateString(extensionAPI),
  );
  if (extensionAPI.settings.get("actual-time-tracking") === true) {
    try {
      await startTiming(extensionAPI);
    } catch (error) {
      await extensionAPI.settings.set("actual-time-tracking", false);
      publishRuntimeSettings(extensionAPI);
      extensionAPI.settings.panel.create(panelConfig(extensionAPI, language));
      console.error("[Nautilus Log] Actual Time Tracking could not start", error);
    }
  }
}

function onunload() {
  stopTiming({ closeActive: false });
  planWatchBridge?.destroy();
  planWatchBridge = null;
  planTidy?.clear();
  planTidy = null;
  if (typeof window !== "undefined") {
    if (window.nautilusLogExtensionData) {
      window.nautilusLogExtensionData.running = false;
    }
    delete window.nautilusLogCore;
    delete window.nautilusLogTaskCore;
  }
  // Do not mutate the graph during unload; the render scaffolding is owned by
  // the user's graph and should remain available for a later reload.
  return toggleRenderComponent(
    false,
    titleblockUID,
    version,
    renderStringCore,
    disabledReplacementString,
    codeBlockUID,
    componentName,
    "",
  );
}

export {
  createTimingRuntime,
  createTimingCommands,
  createPlanWatchBridge,
  createPlanTidy,
  resolveRendererTaskInstance,
  generateTemplateString,
  generateUpdatedRenderString,
  panelConfig,
  defaults,
  executionDefaults,
};

export default { onload, onunload };
