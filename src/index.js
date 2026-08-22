import {
  isRightSidebarRenderContext,
  shouldSuppressRenderContext,
  toggleRenderComponent,
  updateTemplateString,
} from "./entry-helpers";
import * as logCore from "./log-core";
import { createTimingCommands } from "./timing-commands";
import { createTimingRuntime } from "./timing-runtime";
import { createTimingTopbar } from "./timing-topbar";
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
  const runtime = createTimingRuntime({ extensionAPI });
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
      startDesc: "螺旋图从每天 5、6、7 或 8 点开始绘制。默认 5 点。",
      end: "图表结束时间",
      endDesc: "螺旋图绘制到每天 18–24 点。默认 21 点。",
      prefix: "组件前缀文本",
      prefixDesc: "在新建组件前默认插入的文本前缀（例如：#日程）。",
      length: "最大图例长度",
      lengthDesc: "图表外部标签的最大长度，超出的文本会根据可用宽度截断。",
      duration: "默认待办时长",
      durationDesc: "没有写时长的弹性任务默认占用的分钟数。",
      color: "紧急触发词",
      colorDesc: "使任务显示为紧急红色的关键词（不可包含空格，例如：重要）。",
      tracking: "实际时间记录",
      trackingDesc: "启用后显示 Nautilus Log 顶栏，并允许聚焦、CLOCK 计时、任务切换和一键完成。默认关闭；关闭时整套顶栏交互均不加载。",
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
      startDesc: "Draw the spiral from 5, 6, 7, or 8 AM. Defaults to 5 AM.",
      end: "Chart End Time",
      endDesc: "Draw through 18:00–24:00. Defaults to 21:00 (9 PM).",
      prefix: "Component Prefix",
      prefixDesc: "Text inserted before a new component (for example, #schedule).",
      length: "Legend Max Length",
      lengthDesc: "Maximum label length; long text is measured and truncated to fit.",
      duration: "Default Todo Duration",
      durationDesc: "Default minutes for an untimed flexible task.",
      color: "Urgent Trigger Word",
      colorDesc: "Keyword that colors a task urgent red (no spaces, for example urgent).",
      tracking: "Actual Time Tracking",
      trackingDesc: "Enable the Nautilus Log topbar for focus, CLOCK timing, task switching, and one-click completion. Defaults off; while off the entire topbar interaction layer stays unloaded.",
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
        action: { type: "select", default: settingValue(extensionAPI, "workday-start"), items: [5, 6, 7, 8], onChange: (value) => update("workday-start", value) },
      },
      {
        id: "workday-end",
        name: labels.end,
        description: labels.endDesc,
        action: { type: "select", default: settingValue(extensionAPI, "workday-end"), items: [18, 19, 20, 21, 22, 23, 24], onChange: (value) => update("workday-end", value) },
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
    ],
  };
}

async function onload({ extensionAPI }) {
  window.nautilusLogCore = logCore;
  window.nautilusLogExtensionData = {
    running: true,
    shouldSuppressRenderContext,
    isRightSidebarRenderContext,
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
  if (typeof window !== "undefined") {
    if (window.nautilusLogExtensionData) {
      window.nautilusLogExtensionData.running = false;
    }
    delete window.nautilusLogCore;
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
  generateTemplateString,
  generateUpdatedRenderString,
  panelConfig,
  defaults,
  executionDefaults,
};

export default { onload, onunload };
