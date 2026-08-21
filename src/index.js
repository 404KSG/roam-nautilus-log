import { toggleRenderComponent } from "./entry-helpers";
import { updateTemplateString } from "./entry-helpers";
import "../extension.css";

const componentName = 'Nautilus' 
const codeBlockUID = `roam-render-${componentName}-cljs`;
const renderStringCore = `{{[[roam/render]]:((${codeBlockUID}))`;
const disabledStr = `-disabled`;
const disabledReplacementString = `{{${componentName}${disabledStr}`;

const version = 'v5';
const titleblockUID = `roam-render-${componentName}`;

const defaults = {'prefix-str': '', 'desc-length': 22, 'todo-duration': 15, 'workday-start': 8, 'color-1-trigger': ''};

async function generateUpdatedRenderString(renderStringCore, extensionAPI, replacementKey, newValue) {
  const keys = Object.keys(defaults);
  let values = [];

    for (let key of keys) {
      if (key === replacementKey) {
          values.push(newValue);
      } else {
          let value = await extensionAPI.settings.get(key) || defaults[key];
          values.push(value);
      }
  }
  // console.log("values are ", values);
  return values[0] + ' ' + renderStringCore + ' ' + values.slice(1).join(' ') + '}}';
}

async function generateTemplateString(extensionAPI) { // returns the whole template string for the render block (if all settings are not default else returns the default string)
  const keys = Object.keys(defaults);
  let values = [];
  let allAreDefault = true;
  for (let key of keys) {
          let value = await extensionAPI.settings.get(key);
          switch(value) {
            case defaults[key]: {
              if (key === 'color-1-trigger') { value = '\"' + value.replace(/ /g, '') + '\"'; };
              values.push(value);
              break; 
            }
            case undefined: {
              values.push(value); 
              break;
            }
            case null: {
              values.push(value); 
              break;
            }
            default: { 
              allAreDefault = false;
              if (key === 'color-1-trigger') { value = '\"' + value.replace(/ /g, '') + '\"'; };
              values.push(value);
          }
        }
      }
  // console.log("values are ", values, " and allAreDefault is ", allAreDefault);
  if (allAreDefault) { 
    return renderStringCore + '}}'; } 
  else {
    let trimmedValue = values[0].trim();
    let finalString = trimmedValue ? trimmedValue + ' ' : trimmedValue;
    return finalString + renderStringCore + ' ' + values.slice(1).join(' ') + '}}';
  }
}

async function onload({extensionAPI}) {
  window.nautilusExtensionData = {running: true};

  const i18n = {
    'zh': {
      tabTitle: "Nautilus",
      languageName: "语言 / Language",
      languageDesc: "选择设置面板显示的语言 (切换后立即生效)。",
      workdayStartName: "工作开始时间",
      workdayStartDesc: "默认工作日的开始时间（5点、6点、7点或8点）。",
      prefixStrName: "组件前缀文本",
      prefixStrDesc: "在新建的组件前默认插入的文本前缀（例如：#日程）。",
      descLengthName: "最大图例长度",
      descLengthDesc: "行程图上标记的最大字符长度，超出演示的文本将会被截断。",
      todoDurationName: "默认待办时长",
      todoDurationDesc: "创建未指定时间的待办事项时，默认占用的分钟数。",
      color1TriggerName: "高亮触发词",
      color1TriggerDesc: "导致事项高亮显示为红色的关键词（不可包含空格，例如：重要）。"
    },
    'en': {
      tabTitle: "Nautilus",
      languageName: "Language",
      languageDesc: "Select the language for the settings panel (takes effect immediately).",
      workdayStartName: "Workday Start Time",
      workdayStartDesc: "Default start time of the workday (5, 6, 7, or 8 AM).",
      prefixStrName: "Component Prefix",
      prefixStrDesc: "Prefix text inserted before a new component (e.g., #schedule).",
      descLengthName: "Legend Max Length",
      descLengthDesc: "Maximum length of legend characters. Overflowing text will be truncated.",
      todoDurationName: "Default Todo Duration",
      todoDurationDesc: "Default duration (in minutes) for a newly created todo without a specified time.",
      color1TriggerName: "Highlight Trigger Word",
      color1TriggerDesc: "Keyword to highlight the event block in red (no spaces, e.g., urgent)."
    }
  };

  const currentLang = extensionAPI.settings.get('language') || 'zh';
  if (!extensionAPI.settings.get('language')) {
      extensionAPI.settings.set('language', 'zh');
  }

  function getPanelConfig(lang) {
      const t = i18n[lang];
      return {
          tabTitle: t.tabTitle,
          settings: [
              {
                  id: "language",
                  name: t.languageName,
                  description: t.languageDesc,
                  action: {
                      type: "select",
                      default: lang,
                      items: ["zh", "en"],
                      onChange: (evt) => {
                          extensionAPI.settings.set('language', evt);
                          extensionAPI.settings.panel.create(getPanelConfig(evt));
                      }
                  }
              },
              {id: "workday-start",
               name: t.workdayStartName,
               description: t.workdayStartDesc,
               action: {
                 type: "select",
                 default: defaults['workday-start'],
                 items: [5, 6, 7, 8],
                 onChange: async (evt) => {
                   let newString = await generateUpdatedRenderString(renderStringCore, extensionAPI, 'workday-start', evt);
                   updateTemplateString(renderStringCore, newString);
                 },
               }
              },
              {id:   "prefix-str",
               name:   t.prefixStrName,
               description: t.prefixStrDesc,
               action: {type:  "input",
                        default: defaults['prefix-str'],
                        onChange: async (evt) => {
                          let newString = await generateUpdatedRenderString(renderStringCore, extensionAPI, 'prefix-str', evt.target.value);
                          updateTemplateString(renderStringCore, newString.trim());
                   }
                 }
               },
               {id: "desc-length",
                 name: t.descLengthName,
                 description: t.descLengthDesc,
                 action: {
                   type: "select",
                   default: defaults['desc-length'],
                   items: [14, 16, 18, 20, 22, 24, 26, 28],
                   onChange: async (evt) => {
                     let newString = await generateUpdatedRenderString(renderStringCore, extensionAPI, 'desc-length', evt);
                     updateTemplateString(renderStringCore, newString);
                   },
                 }
               },
               {id: "todo-duration",
                 name: t.todoDurationName,
                 description: t.todoDurationDesc,
                 action: {
                   type: "select",
                   default: defaults['todo-duration'],
                   items: [5, 10, 15, 20, 25, 30],
                   onChange: async (evt) => {
                     let newString = await generateUpdatedRenderString(renderStringCore, extensionAPI, 'todo-duration', evt);
                     updateTemplateString(renderStringCore, newString);
                   },
                 }
               },
               {id:   "color-1-trigger",
               name:   t.color1TriggerName,
               description: t.color1TriggerDesc,
               action: {type:  "input",
                        default: defaults['color-1-trigger'],
                        onChange: async (evt) => {
                          let cleanedValue = evt.target.value.replace(/ /g, '');
                          let newString = await generateUpdatedRenderString(renderStringCore, extensionAPI, 'color-1-trigger', '\"' + cleanedValue + '\"');
                          updateTemplateString(renderStringCore, newString);
                   }
                 }
               }
          ]
      };
  }

  function setDefaultSettings(extensionAPI, defaults) {
    const keys = Object.keys(defaults);
    for (let key of keys) {
      if (!extensionAPI.settings.get(key)) {
          extensionAPI.settings.set(key, defaults[key])};
    }
  }

  setDefaultSettings(extensionAPI, defaults);
  extensionAPI.settings.panel.create(getPanelConfig(currentLang));

  toggleRenderComponent(true, titleblockUID, version, renderStringCore, disabledReplacementString, codeBlockUID, componentName, await generateTemplateString(extensionAPI));
  
}

function onunload() {
  console.log(`unload ${componentName} plugin`)
  window.nautilusExtensionData = null;
  toggleRenderComponent(false, titleblockUID, version, renderStringCore, disabledReplacementString, codeBlockUID, componentName, '');
}

export default {
onload,
onunload
};
