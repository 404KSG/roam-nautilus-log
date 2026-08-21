import { toggleRenderComponent, updateTemplateString } from "./entry-helpers";
import * as flowCore from "./flow-core";
import "../extension.css";

const componentName = "Nautilus Flow";
const codeBlockUID = "roam-render-Nautilus-Flow-cljs";
const renderStringCore = `{{[[roam/render]]:((${codeBlockUID}))`;
const disabledReplacementString = `{{${componentName}-disabled`;
const version = "v1";
const titleblockUID = "roam-render-Nautilus-Flow";

// The ClojureScript source is stored in a Roam code block at runtime. Expose
// the tested scheduling core as one shared implementation for that renderer.
if (typeof window !== "undefined") {
  window.nautilusFlowCore = flowCore;
}

// Keep the existing argument order for old templates; the new end-hour value
// is appended after the old color trigger argument.
const defaults = {
  "prefix-str": "",
  "desc-length": 22,
  "todo-duration": 15,
  "workday-start": 5,
  "color-1-trigger": "",
  "workday-end": 24,
};

function settingValue(extensionAPI, key) {
  const value = extensionAPI.settings.get(key);
  return value === undefined || value === null ? defaults[key] : value;
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
  const defaultValues = Object.values(defaults);
  const allAreDefault = values.every((value, index) => value === defaultValues[index]);
  if (allAreDefault) return `${renderStringCore}}}`;
  args[3] = args[3] === "" || args[3] === undefined
    ? '""'
    : `"${String(args[3]).replace(/\s/g, "")}"`;
  const normalizedPrefix = String(prefix ?? "").trim();
  return `${normalizedPrefix ? `${normalizedPrefix} ` : ""}${renderStringCore} ${args.join(" ")}}}`;
}

function setDefaultSettings(extensionAPI) {
  Object.keys(defaults).forEach((key) => {
    const current = extensionAPI.settings.get(key);
    if (current === undefined || current === null) extensionAPI.settings.set(key, defaults[key]);
  });
}

function panelConfig(extensionAPI, language) {
  const zh = language === "zh";
  const labels = zh
    ? {
      tabTitle: "Nautilus Flow",
      language: "语言 / Language",
      languageDesc: "选择设置面板显示的语言（切换后立即生效）。",
      start: "图表开始时间",
      startDesc: "螺旋图从每天 5、6、7 或 8 点开始绘制。默认 5 点。",
      end: "图表结束时间",
      endDesc: "螺旋图绘制到每天 18–24 点。24 点表示当天午夜。默认 24 点。",
      prefix: "组件前缀文本",
      prefixDesc: "在新建组件前默认插入的文本前缀（例如：#日程）。",
      length: "最大图例长度",
      lengthDesc: "图表外部标签的最大长度，超出的文本会根据可用宽度截断。",
      duration: "默认待办时长",
      durationDesc: "没有写时长的弹性任务默认占用的分钟数。",
      color: "紧急触发词",
      colorDesc: "使任务显示为紧急红色的关键词（不可包含空格，例如：重要）。",
    }
    : {
      tabTitle: "Nautilus Flow",
      language: "Language",
      languageDesc: "Select the settings language (takes effect immediately).",
      start: "Chart Start Time",
      startDesc: "Draw the spiral from 5, 6, 7, or 8 AM. Defaults to 5 AM.",
      end: "Chart End Time",
      endDesc: "Draw through 6–24:00. 24:00 means midnight at the end of today.",
      prefix: "Component Prefix",
      prefixDesc: "Text inserted before a new component (for example, #schedule).",
      length: "Legend Max Length",
      lengthDesc: "Maximum label length; long text is measured and truncated to fit.",
      duration: "Default Todo Duration",
      durationDesc: "Default minutes for an untimed flexible task.",
      color: "Urgent Trigger Word",
      colorDesc: "Keyword that colors a task urgent red (no spaces, for example urgent).",
    };

  const update = async (key, value) => {
    const next = key === "color-1-trigger" ? String(value).replace(/\s/g, "") : value;
    await extensionAPI.settings.set(key, next);
    updateTemplateString(renderStringCore, await generateUpdatedRenderString(renderStringCore, extensionAPI, key, next));
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
          items: ["zh", "en"],
          onChange: async (value) => {
            await extensionAPI.settings.set("language", value);
            extensionAPI.settings.panel.create(panelConfig(extensionAPI, value));
          },
        },
      },
      {
        id: "workday-start",
        name: labels.start,
        description: labels.startDesc,
        action: { type: "select", default: defaults["workday-start"], items: [5, 6, 7, 8], onChange: (value) => update("workday-start", value) },
      },
      {
        id: "workday-end",
        name: labels.end,
        description: labels.endDesc,
        action: { type: "select", default: defaults["workday-end"], items: [18, 19, 20, 21, 22, 23, 24], onChange: (value) => update("workday-end", value) },
      },
      {
        id: "prefix-str",
        name: labels.prefix,
        description: labels.prefixDesc,
        action: { type: "input", default: defaults["prefix-str"], onChange: (event) => update("prefix-str", event.target.value) },
      },
      {
        id: "desc-length",
        name: labels.length,
        description: labels.lengthDesc,
        action: { type: "select", default: defaults["desc-length"], items: [14, 16, 18, 20, 22, 24, 26, 28], onChange: (value) => update("desc-length", value) },
      },
      {
        id: "todo-duration",
        name: labels.duration,
        description: labels.durationDesc,
        action: { type: "select", default: defaults["todo-duration"], items: [5, 10, 15, 20, 25, 30, 45, 60], onChange: (value) => update("todo-duration", value) },
      },
      {
        id: "color-1-trigger",
        name: labels.color,
        description: labels.colorDesc,
        action: { type: "input", default: defaults["color-1-trigger"], onChange: (event) => update("color-1-trigger", event.target.value) },
      },
    ],
  };
}

async function onload({ extensionAPI }) {
  window.nautilusFlowExtensionData = { running: true };
  setDefaultSettings(extensionAPI);
  const language = extensionAPI.settings.get("language") || "zh";
  if (!extensionAPI.settings.get("language")) await extensionAPI.settings.set("language", language);
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
}

function onunload() {
  if (typeof window !== "undefined" && window.nautilusFlowExtensionData) {
    window.nautilusFlowExtensionData.running = false;
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

export { generateTemplateString, generateUpdatedRenderString, panelConfig, defaults };

export default { onload, onunload };
