const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { installTestHostLocks } = require('./test-host-locks.cjs');

const delay = () => new Promise((resolve) => setTimeout(resolve, 2));

function createRoamMock() {
  const pages = new Map();
  const blocks = new Map();
  let generated = 0;

  const entity = (uid) => blocks.get(uid)
    || [...pages.entries()].find(([, pageUid]) => pageUid === uid)?.[1]
    || null;

  const childrenOf = (parentUid) => [...blocks.values()]
    .filter((block) => block.parentUid === parentUid)
    .sort((a, b) => Number(a.order) - Number(b.order));

  const pageUidOf = (block) => {
    let current = block;
    while (current?.parentUid) {
      if ([...pages.values()].includes(current.parentUid)) return current.parentUid;
      current = blocks.get(current.parentUid);
    }
    return null;
  };

  const roam = {
    graph: { name: 'scaffold-test-graph' },
    util: { generateUID: () => `logtest${++generated}` },
    data: {
      pull: (_pattern, lookup) => entity(lookup?.[1]),
      page: {
        create: async ({ page }) => {
          await delay();
          pages.set(page.title, page.uid);
        },
      },
    },
    createBlock: async ({ location, block }) => {
      await delay();
      const parentUid = location['parent-uid'];
      const parentExists = blocks.has(parentUid) || [...pages.values()].includes(parentUid);
      if (!parentExists) throw new Error(`parent ${parentUid} did not exist before child ${block.uid}`);
      blocks.set(block.uid, {
        uid: block.uid,
        string: block.string,
        order: location.order === 'last' ? childrenOf(parentUid).length : location.order,
        parentUid,
      });
    },
    updateBlock: async ({ block }) => {
      await delay();
      const current = blocks.get(block.uid);
      if (!current) throw new Error(`cannot update missing block ${block.uid}`);
      blocks.set(block.uid, { ...current, string: block.string });
    },
    q: (query) => {
      const pageTitle = query.match(/:node\/title "([^"]+)"/)?.[1];
      if (pageTitle && query.includes('pull ?e [:block/uid]')) {
        const uid = pages.get(pageTitle);
        return uid ? [[{ uid }]] : [];
      }

      if (pageTitle && query.includes('clojure.string/includes?')) {
        const pageUid = pages.get(pageTitle);
        const search = query.match(/clojure\.string\/includes\? \?node-string "([^"]*)"/)?.[1] || '';
        return [...blocks.values()]
          .filter((block) => pageUidOf(block) === pageUid)
          .filter((block) => block.string.includes(search))
          .map((block) => [[block][0]]);
      }

      const parentUid = query.match(/\[\?parent :block\/uid "([^"]+)"\]/)?.[1];
      if (parentUid && query.includes(':block/children')) {
        return childrenOf(parentUid).map((block) => [[block][0]]);
      }

      const uid = query.match(/\[\?e :block\/uid "([^"]+)"\]/)?.[1];
      if (uid) {
        const block = blocks.get(uid);
        return block ? [[block]] : [];
      }
      return [];
    },
  };

  return { roam, pages, blocks };
}

test('built extension creates Log scaffolding sequentially and unload is graph-safe', async (t) => {
  const { roam, pages, blocks } = createRoamMock();
  const dispatchedEvents = [];
  global.window = {
    roamAlphaAPI: roam,
    dispatchEvent: (event) => dispatchedEvents.push(event),
  };
  installTestHostLocks(global.window);
  t.after(() => { delete global.window; });

  const bundle = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}#${Date.now()}`;
  const extensionModule = await import(moduleUrl);
  const extension = extensionModule.default;
  const settings = new Map();
  settings.set('language', 'en');
  settings.set('workday-end', 21);
  let latestPanel;
  const extensionAPI = {
    settings: {
      get: (key) => settings.get(key),
      set: async (key, value) => settings.set(key, value),
      panel: { create: (config) => { latestPanel = config; } },
    },
  };

  await extension.onload({ extensionAPI });

  assert.ok(pages.has('roam/render'));
  assert.equal(blocks.get('roam-render-Nautilus-Log').string, 'Nautilus Log');
  assert.match(blocks.get('roam-render-Nautilus-Log-cljs').string, /nautilus-log-v1/);
  assert.equal(window.nautilusLogExtensionData.settings['workday-end'], 21);
  assert.equal(window.nautilusLogExtensionData.settings.language, 'en');

  const shouldSuppressRenderContext = window.nautilusLogExtensionData.shouldSuppressRenderContext;
  const isRightSidebarRenderContext = window.nautilusLogExtensionData.isRightSidebarRenderContext;
  const contextNode = (matchedSelector) => ({
    closest: (selector) => (selector.includes(matchedSelector) ? {} : null),
  });
  assert.equal(typeof shouldSuppressRenderContext, 'function');
  assert.equal(shouldSuppressRenderContext({ closest: () => null }), false);
  assert.equal(shouldSuppressRenderContext(contextNode('.parent-path-wrapper')), true);
  assert.equal(shouldSuppressRenderContext(contextNode('.rm-zoom.zoom-path-view')), true);
  assert.equal(shouldSuppressRenderContext(contextNode('.rm-zoom-item-content.rm-zoom-collapsed-item')), true);
  assert.equal(typeof isRightSidebarRenderContext, 'function');
  assert.equal(isRightSidebarRenderContext({ closest: () => null }), false);
  assert.equal(isRightSidebarRenderContext(contextNode('#roam-right-sidebar-content')), true);

  const languageSetting = latestPanel.settings.find(({ id }) => id === 'language');
  await languageSetting.action.onChange('zh');
  assert.equal(window.nautilusLogExtensionData.settings.language, 'zh');

  const endSetting = latestPanel.settings.find(({ id }) => id === 'workday-end');
  assert.equal(endSetting.action.default, '21:00');
  await endSetting.action.onChange('20:00');
  assert.equal(window.nautilusLogExtensionData.settings['workday-end'], 20);
  assert.ok(dispatchedEvents.some(({ type }) => type === 'nautilus-log:settings-changed'));
  const blockCount = blocks.size;

  await extension.onunload();
  assert.equal(blocks.size, blockCount);
  assert.equal(window.nautilusLogExtensionData.running, false);
  assert.equal(window.nautilusLogCore, undefined);
});

test('a fresh install defaults the settings panel and rendered UI to English', async (t) => {
  const { roam } = createRoamMock();
  global.window = {
    roamAlphaAPI: roam,
    dispatchEvent: () => {},
  };
  installTestHostLocks(global.window);
  t.after(() => { delete global.window; });

  const bundle = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}#fresh-${Date.now()}`;
  const extensionModule = await import(moduleUrl);
  const extension = extensionModule.default;
  const settings = new Map();
  let latestPanel;
  const extensionAPI = {
    settings: {
      get: (key) => settings.get(key),
      set: async (key, value) => settings.set(key, value),
      panel: { create: (config) => { latestPanel = config; } },
    },
  };

  await extension.onload({ extensionAPI });

  assert.equal(settings.get('language'), 'en');
  assert.equal(settings.get('workday-start'), 5);
  assert.equal(settings.get('workday-end'), 21);
  assert.equal(settings.get('prefix-str'), '[[Nautilus Log]]');
  assert.equal(settings.get('actual-time-tracking'), false);
  assert.equal(settings.get('energy-bar-enabled'), false);
  assert.equal(settings.get('timing-line-sidebar'), true);
  assert.equal(settings.get('recent-retention-minutes'), 45);
  assert.equal(settings.get('forgotten-timer-minutes'), 120);
  assert.equal(window.nautilusLogExtensionData.settings.language, 'en');
  assert.equal(latestPanel.settings.find(({ id }) => id === 'language').action.default, 'en');
  assert.equal(latestPanel.settings.find(({ id }) => id === 'workday-start').name, 'Chart Start Time');
  const startSetting = latestPanel.settings.find(({ id }) => id === 'workday-start');
  const endSetting = latestPanel.settings.find(({ id }) => id === 'workday-end');
  assert.equal(startSetting.action.default, '05:00');
  assert.ok(startSetting.action.items.includes('00:00'));
  assert.ok(startSetting.action.items.includes('09:00'));
  assert.equal(endSetting.action.default, '21:00');
  await startSetting.action.onChange('21:00');
  const overnightEndSetting = latestPanel.settings.find(({ id }) => id === 'workday-end');
  assert.ok(overnightEndSetting.action.items.includes('02:00 · next day'));
  await overnightEndSetting.action.onChange('02:00 · next day');
  assert.equal(settings.get('workday-start'), 21);
  assert.equal(settings.get('workday-end'), 2);
  assert.equal(window.nautilusLogExtensionData.settings['workday-end'], 2);
  const executionEntry = latestPanel.settings.find(({ id }) => id === 'actual-time-tracking');
  assert.equal(executionEntry.name, 'Execution Layer · Advanced');
  assert.match(executionEntry.description, /Enable to reveal execution settings/);
  assert.equal(executionEntry.action.defaultValue, false);
  for (const id of ['energy-bar-enabled', 'timing-line-sidebar', 'pomodoro-minutes', 'recent-retention-minutes', 'forgotten-timer-minutes']) {
    assert.equal(latestPanel.settings.some((setting) => setting.id === id), false);
  }

  settings.set('actual-time-tracking', true);
  const expandedPanel = extensionModule.panelConfig(extensionAPI, 'en');
  const energySetting = expandedPanel.settings.find(({ id }) => id === 'energy-bar-enabled');
  assert.equal(energySetting.name, 'Show capacity as an energy bar');
  assert.match(energySetting.description, /solid reserve/);
  assert.equal(energySetting.action.defaultValue, false);
  await energySetting.action.onChange(true);
  assert.equal(settings.get('energy-bar-enabled'), true);
  assert.equal(window.nautilusLogExtensionData.settings['energy-bar-enabled'], true);
  assert.equal(expandedPanel.settings.find(({ id }) => id === 'timing-line-sidebar').action.defaultValue, true);
  assert.equal(expandedPanel.settings.find(({ id }) => id === 'recent-retention-minutes').action.default, 45);
  assert.equal(expandedPanel.settings.find(({ id }) => id === 'forgotten-timer-minutes').action.default, 120);
  await expandedPanel.settings.find(({ id }) => id === 'recent-retention-minutes').action.onChange({ target: { value: '30' } });
  await expandedPanel.settings.find(({ id }) => id === 'forgotten-timer-minutes').action.onChange({ target: { value: '0' } });
  assert.equal(settings.get('recent-retention-minutes'), 30);
  assert.equal(settings.get('forgotten-timer-minutes'), 0);
  const zhPanel = extensionModule.panelConfig(extensionAPI, 'zh');
  assert.equal(zhPanel.settings.find(({ id }) => id === 'actual-time-tracking').name, '执行层 · 进阶');
  assert.equal(zhPanel.settings.find(({ id }) => id === 'energy-bar-enabled').name, '用精力槽显示剩余容量');
  assert.equal(global.document, undefined);

  await extension.onunload();
});

test('legacy preview installs migrate the old automatic Chinese default once', async (t) => {
  const { roam } = createRoamMock();
  global.window = {
    roamAlphaAPI: roam,
    dispatchEvent: () => {},
  };
  installTestHostLocks(global.window);
  t.after(() => { delete global.window; });

  const bundle = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}#migration-${Date.now()}`;
  const extension = (await import(moduleUrl)).default;
  const settings = new Map([['language', 'zh']]);
  let latestPanel;
  const extensionAPI = {
    settings: {
      get: (key) => settings.get(key),
      set: async (key, value) => settings.set(key, value),
      panel: { create: (config) => { latestPanel = config; } },
    },
  };

  await extension.onload({ extensionAPI });

  assert.equal(settings.get('language'), 'en');
  assert.equal(settings.get('language-default-version'), 'en-v1');
  assert.equal(window.nautilusLogExtensionData.settings.language, 'en');

  await latestPanel.settings.find(({ id }) => id === 'language').action.onChange('zh');
  await extension.onunload();
  await extension.onload({ extensionAPI });

  assert.equal(settings.get('language'), 'zh');
  assert.equal(window.nautilusLogExtensionData.settings.language, 'zh');

  await extension.onunload();
});

test('preview defaults migrate once from an empty prefix and midnight end', async (t) => {
  const { roam } = createRoamMock();
  global.window = { roamAlphaAPI: roam, dispatchEvent: () => {} };
  t.after(() => { delete global.window; });

  const bundle = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
  const extension = (await import(`data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}#defaults-${Date.now()}`)).default;
  const settings = new Map([
    ['language', 'en'],
    ['language-default-version', 'en-v1'],
    ['prefix-str', ''],
    ['workday-end', 24],
  ]);
  const extensionAPI = {
    settings: {
      get: (key) => settings.get(key),
      set: async (key, value) => settings.set(key, value),
      panel: { create: () => {} },
    },
  };
  installTestHostLocks(global.window);

  await extension.onload({ extensionAPI });
  assert.equal(settings.get('prefix-str'), '[[Nautilus Log]]');
  assert.equal(settings.get('workday-end'), 21);
  assert.equal(settings.get('product-defaults-version'), 'timing-v1');
  await extension.onunload();
});

test('a new shorthand reuses one customized legacy template without rewriting historical Logs', async (t) => {
  const { roam, pages, blocks } = createRoamMock();
  pages.set('roam/render', 'render-page');
  pages.set('September 1st, 2026', 'daily-page');

  blocks.set('legacy-title', {
    uid: 'legacy-title',
    string: 'Nautilus Flow',
    order: 0,
    parentUid: 'render-page',
  });
  blocks.set('legacy-template', {
    uid: 'legacy-template',
    string: 'Nautilus Flow [[roam/templates]]',
    order: 0,
    parentUid: 'legacy-title',
  });
  blocks.set('legacy-template-render', {
    uid: 'legacy-template-render',
    string: '[[log]] {{[[roam/render]]:((roam-render-Nautilus-Flow-cljs)) 28 30 9 "" 2}}',
    order: 0,
    parentUid: 'legacy-template',
  });
  blocks.set('legacy-code-header', {
    uid: 'legacy-code-header',
    string: 'code',
    order: 1,
    parentUid: 'legacy-title',
  });
  blocks.set('roam-render-Nautilus-Flow-cljs', {
    uid: 'roam-render-Nautilus-Flow-cljs',
    string: 'old legacy code',
    order: 0,
    parentUid: 'legacy-code-header',
  });
  blocks.set('enhanced-title', {
    uid: 'enhanced-title',
    string: 'Nautilus',
    order: 1,
    parentUid: 'render-page',
  });
  blocks.set('enhanced-template', {
    uid: 'enhanced-template',
    string: 'Nautilus Enhanced [[roam/templates]]',
    order: 0,
    parentUid: 'enhanced-title',
  });
  blocks.set('enhanced-template-render', {
    uid: 'enhanced-template-render',
    string: '[[older-log]] {{[[roam/render]]:((roam-render-Nautilus-cljs)) 20 20 8 "" 24}}',
    order: 0,
    parentUid: 'enhanced-template',
  });

  blocks.set('roam-render-Nautilus-Log', {
    uid: 'roam-render-Nautilus-Log',
    string: 'Nautilus Log',
    order: 1,
    parentUid: 'render-page',
  });
  blocks.set('duplicate-template', {
    uid: 'duplicate-template',
    string: 'Nautilus Log [[roam/templates]]',
    order: 0,
    parentUid: 'roam-render-Nautilus-Log',
  });
  blocks.set('duplicate-template-render', {
    uid: 'duplicate-template-render',
    string: '[[Nautilus Log]] {{[[roam/render]]:((roam-render-Nautilus-Log-cljs)) 22 15 5 "" 21}}',
    order: 0,
    parentUid: 'duplicate-template',
  });
  blocks.set('current-code-header', {
    uid: 'current-code-header',
    string: 'code',
    order: 1,
    parentUid: 'roam-render-Nautilus-Log',
  });
  blocks.set('roam-render-Nautilus-Log-cljs', {
    uid: 'roam-render-Nautilus-Log-cljs',
    string: 'old code',
    order: 0,
    parentUid: 'current-code-header',
  });
  blocks.set('weekly-title', {
    uid: 'weekly-title',
    string: 'User templates',
    order: 2,
    parentUid: 'render-page',
  });
  blocks.set('weekly-template', {
    uid: 'weekly-template',
    string: 'Weekly Planning [[roam/templates]]',
    order: 0,
    parentUid: 'weekly-title',
  });
  blocks.set('weekly-template-render', {
    uid: 'weekly-template-render',
    string: 'Agenda + {{[[roam/render]]:((roam-render-Nautilus-Log-cljs))}}',
    order: 0,
    parentUid: 'weekly-template',
  });

  const historicalString = '[[log]] {{[[roam/render]]:((roam-render-Nautilus-Flow-cljs)) 28 30 9 "" 2}}';
  blocks.set('historical-log', {
    uid: 'historical-log',
    string: historicalString,
    order: 0,
    parentUid: 'daily-page',
  });

  global.window = { roamAlphaAPI: roam, dispatchEvent: () => {} };
  t.after(() => { delete global.window; });

  const bundle = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}#template-reuse-${Date.now()}`;
  const extension = (await import(moduleUrl)).default;
  let latestPanel;
  const settings = new Map([
    ['language', 'en'],
    ['language-default-version', 'en-v1'],
    ['product-defaults-version', 'timing-v1'],
    ['prefix-str', '[[Nautilus Log]]'],
    ['desc-length', 22],
    ['todo-duration', 15],
    ['workday-start', 5],
    ['color-1-trigger', ''],
    ['workday-end', 21],
  ]);
  const extensionAPI = {
    settings: {
      get: (key) => settings.get(key),
      set: async (key, value) => settings.set(key, value),
      panel: { create: (config) => { latestPanel = config; } },
    },
  };
  installTestHostLocks(global.window);

  await extension.onload({ extensionAPI });

  assert.equal(settings.get('prefix-str'), '[[log]]');
  assert.equal(settings.get('desc-length'), 28);
  assert.equal(settings.get('todo-duration'), 30);
  assert.equal(settings.get('workday-start'), 9);
  assert.equal(settings.get('workday-end'), 2);

  const activeTemplates = [...blocks.values()]
    .filter((block) => pageUidOfForTest(blocks, pages, block) === 'render-page')
    .filter((block) => block.string === 'Nautilus Log [[roam/templates]]');
  assert.equal(activeTemplates.length, 1);
  assert.equal(activeTemplates[0].string, 'Nautilus Log [[roam/templates]]');
  assert.match(
    blocks.get('legacy-template-render').string,
    /^\[\[log\]\] \{\{\[\[roam\/render\]\]:\(\(roam-render-Nautilus-Flow-cljs\)\) 28 30 9 "" 2\}\}$/,
  );
  assert.match(blocks.get('roam-render-Nautilus-Flow-cljs').string, /nautilus-log-v1/);
  assert.match(blocks.get('roam-render-Nautilus-Log-cljs').string, /nautilus-log-v1/);
  assert.equal(blocks.get('historical-log').string, historicalString);
  assert.equal(blocks.get('duplicate-template').string, 'Nautilus Log · Previous template');
  assert.equal(blocks.get('enhanced-template').string, 'Nautilus Log · Previous template');
  assert.equal(blocks.get('weekly-template').string, 'Weekly Planning [[roam/templates]]');
  assert.equal(
    blocks.get('weekly-template-render').string,
    'Agenda + {{[[roam/render]]:((roam-render-Nautilus-Log-cljs))}}',
  );

  const weeklyTemplateBeforeSettingsChange = blocks.get('weekly-template-render').string;
  const prefixSetting = latestPanel.settings.find(({ id }) => id === 'prefix-str');
  await prefixSetting.action.onChange({ target: { value: '[[changed-log]]' } });
  assert.match(blocks.get('legacy-template-render').string, /^\[\[changed-log\]\]/);
  assert.equal(blocks.get('weekly-template-render').string, weeklyTemplateBeforeSettingsChange);
  assert.equal(blocks.get('historical-log').string, historicalString);

  const blockCountAfterUpgrade = blocks.size;
  await extension.onunload();
  await extension.onload({ extensionAPI });

  const templatesAfterReload = [...blocks.values()]
    .filter((block) => pageUidOfForTest(blocks, pages, block) === 'render-page')
    .filter((block) => block.string === 'Nautilus Log [[roam/templates]]');
  assert.equal(templatesAfterReload.length, 1);
  assert.equal(blocks.size, blockCountAfterUpgrade);
  assert.equal(blocks.get('historical-log').string, historicalString);

  await extension.onunload();
});

test('shorthand migration preserves an existing intentionally empty prefix', async (t) => {
  const { roam, pages, blocks } = createRoamMock();
  pages.set('roam/render', 'render-page');
  blocks.set('legacy-title', {
    uid: 'legacy-title', string: 'Nautilus Flow', order: 0, parentUid: 'render-page',
  });
  blocks.set('legacy-template', {
    uid: 'legacy-template',
    string: 'Nautilus Flow [[roam/templates]]',
    order: 0,
    parentUid: 'legacy-title',
  });
  blocks.set('legacy-template-render', {
    uid: 'legacy-template-render',
    string: '{{[[roam/render]]:((roam-render-Nautilus-Flow-cljs)) 22 15 5 "" 24}}',
    order: 0,
    parentUid: 'legacy-template',
  });
  blocks.set('roam-render-Nautilus-Flow-cljs', {
    uid: 'roam-render-Nautilus-Flow-cljs',
    string: 'old legacy code',
    order: 1,
    parentUid: 'legacy-title',
  });

  global.window = { roamAlphaAPI: roam, dispatchEvent: () => {} };
  t.after(() => { delete global.window; });
  const bundle = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}#empty-prefix-${Date.now()}`;
  const extension = (await import(moduleUrl)).default;
  const settings = new Map([
    ['language', 'en'],
    ['language-default-version', 'en-v1'],
  ]);
  const extensionAPI = {
    settings: {
      get: (key) => settings.get(key),
      set: async (key, value) => settings.set(key, value),
      panel: { create: () => {} },
    },
  };
  installTestHostLocks(global.window);

  await extension.onload({ extensionAPI });

  assert.equal(settings.get('prefix-str'), '');
  assert.equal(settings.get('workday-end'), 24);
  assert.equal(settings.get('product-defaults-version'), 'timing-v1');
  assert.equal(blocks.get('legacy-template-render').string.startsWith('{{[[roam/render]]'), true);

  await extension.onunload();
});

function createMiniDom() {
  const byId = new Map();
  const node = (tag, className = '') => {
    const element = {
      tagName: String(tag).toUpperCase(),
      className,
      _id: '',
      children: [],
      parentNode: null,
      parentElement: null,
      hidden: false,
      disabled: false,
      style: {},
      dataset: {},
      textContent: '',
      type: '',
      title: '',
      isConnected: true,
      classList: {
        add() {},
        remove() {},
        toggle() {},
        contains: () => false,
      },
      setAttribute(name, value) {
        if (name === 'id') element.id = value;
      },
      getAttribute() { return null; },
      removeAttribute() {},
      append(...kids) {
        for (const kid of kids) {
          if (!kid || typeof kid === 'string') continue;
          kid.parentNode = element;
          kid.parentElement = element;
          element.children.push(kid);
        }
      },
      replaceChildren(...kids) {
        element.children = [];
        element.append(...kids);
      },
      addEventListener() {},
      removeEventListener() {},
      contains(candidate) {
        return element === candidate || element.children.some((child) => child === candidate || child.contains?.(candidate));
      },
      remove() {
        if (!element.parentNode) return;
        element.parentNode.children = element.parentNode.children.filter((child) => child !== element);
        element.parentNode = null;
        element.parentElement = null;
        element.isConnected = false;
        if (element.id) byId.delete(element.id);
      },
      insertBefore(child) {
        element.append(child);
        return child;
      },
      querySelector(selector) {
        if (selector?.startsWith('#')) {
          if (element.id === selector.slice(1)) return element;
          for (const child of element.children) {
            const hit = child.querySelector(selector);
            if (hit) return hit;
          }
          return null;
        }
        if (selector?.startsWith('.')) {
          const cls = selector.split(',')[0].trim().slice(1);
          if (String(element.className).includes(cls)) return element;
          for (const child of element.children) {
            const hit = child.querySelector(selector);
            if (hit) return hit;
          }
        }
        return null;
      },
      querySelectorAll: () => [],
      getBoundingClientRect: () => ({ left: 10, right: 40, top: 0, bottom: 30, width: 30, height: 30 }),
      closest: () => null,
    };
    Object.defineProperty(element, 'id', {
      get() { return element._id || ''; },
      set(value) {
        if (element._id) byId.delete(element._id);
        element._id = String(value || '');
        if (element._id) byId.set(element._id, element);
      },
    });
    Object.defineProperty(element, 'firstChild', { get() { return element.children[0] || null; } });
    Object.defineProperty(element, 'nextSibling', {
      get() {
        if (!element.parentNode) return null;
        const index = element.parentNode.children.indexOf(element);
        return element.parentNode.children[index + 1] || null;
      },
    });
    return element;
  };
  const topbar = node('div', 'rm-topbar');
  const search = node('div', 'rm-find-or-create-wrapper');
  topbar.append(search);
  const body = node('body', '');
  body.append(topbar);
  const document = {
    body,
    visibilityState: 'visible',
    querySelector(selector) {
      if (selector === '.rm-topbar') return topbar;
      if (selector?.startsWith('#')) return byId.get(selector.slice(1)) || null;
      return topbar.querySelector(selector);
    },
    querySelectorAll: () => [],
    getElementById: (id) => byId.get(id) || null,
    createElement: (tag) => node(tag, ''),
    addEventListener() {},
    removeEventListener() {},
  };
  return { document, topbar, byId };
}

test('tracking off mounts the lite launcher host and never starts CLOCK queries', async (t) => {
  const { roam } = createRoamMock();
  const queries = [];
  const originalQ = roam.q;
  roam.q = (query, ...args) => {
    queries.push(query);
    return originalQ(query, ...args);
  };
  const { document } = createMiniDom();
  global.window = {
    roamAlphaAPI: roam,
    dispatchEvent: () => {},
    addEventListener() {},
    removeEventListener() {},
    setTimeout: () => 1,
    clearTimeout() {},
    setInterval: () => 1,
    clearInterval() {},
  };
  installTestHostLocks(global.window);
  global.document = document;
  global.MutationObserver = class { observe() {} disconnect() {} };
  t.after(() => {
    delete global.window;
    delete global.document;
    delete global.MutationObserver;
  });

  const bundle = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
  const extension = (await import(`data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}#launcher-${Date.now()}`)).default;
  const settings = new Map();
  const extensionAPI = {
    settings: {
      get: (key) => settings.get(key),
      set: async (key, value) => settings.set(key, value),
      panel: { create: () => {} },
    },
    ui: {
      commandPalette: {
        addCommand() {},
        removeCommand() {},
      },
    },
  };

  await extension.onload({ extensionAPI });
  assert.equal(window.nautilusLogExtensionData.timingEnabled, undefined);
  assert.equal(Boolean(document.getElementById('nautilus-log-timing-topbar')), true);
  assert.equal(queries.some((query) => query.includes('?clock-uid ?clock-string')), false);
  await extension.onunload();
  assert.equal(document.getElementById('nautilus-log-timing-topbar'), null);
});

test('tracking on still starts the timing runtime; unload writes no graph rows', async (t) => {
  const { roam, blocks } = createRoamMock();
  const { document } = createMiniDom();
  global.window = {
    roamAlphaAPI: roam,
    dispatchEvent: () => {},
    addEventListener() {},
    removeEventListener() {},
    setTimeout: () => 1,
    clearTimeout() {},
    setInterval: () => 1,
    clearInterval() {},
    requestIdleCallback: (fn) => { fn(); return 1; },
    cancelIdleCallback() {},
  };
  installTestHostLocks(global.window);
  global.document = document;
  global.MutationObserver = class { observe() {} disconnect() {} };
  t.after(() => {
    delete global.window;
    delete global.document;
    delete global.MutationObserver;
  });

  const bundle = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
  const extension = (await import(`data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}#runtime-${Date.now()}`)).default;
  const settings = new Map([['actual-time-tracking', true]]);
  const extensionAPI = {
    settings: {
      get: (key) => settings.get(key),
      set: async (key, value) => settings.set(key, value),
      panel: { create: () => {} },
    },
    ui: {
      commandPalette: {
        addCommand() {},
        removeCommand() {},
      },
    },
  };

  await extension.onload({ extensionAPI });
  assert.equal(window.nautilusLogExtensionData.timingEnabled, true);
  const blockCount = blocks.size;
  await extension.onunload();
  assert.equal(blocks.size, blockCount);
  assert.equal(window.nautilusLogExtensionData.timingEnabled, false);
});

test('switching tracking keeps exactly one topbar and a failed start restores the lite launcher', async (t) => {
  const { roam } = createRoamMock();
  const { document, topbar } = createMiniDom();
  const intervals = new Set();
  let intervalId = 0;
  global.window = {
    roamAlphaAPI: roam,
    dispatchEvent() {}, addEventListener() {}, removeEventListener() {},
    setTimeout: () => 1, clearTimeout() {},
    setInterval: () => { const id = ++intervalId; intervals.add(id); return id; },
    clearInterval: (id) => intervals.delete(id),
    requestIdleCallback: (fn) => { fn(); return 1; }, cancelIdleCallback() {},
  };
  installTestHostLocks(global.window);
  global.document = document;
  global.MutationObserver = class { observe() {} disconnect() {} };
  t.after(() => { delete global.window; delete global.document; delete global.MutationObserver; });
  const bundle = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
  const extension = (await import(`data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}#switch-${Date.now()}`)).default;
  const settings = new Map();
  const commands = new Map();
  let panel;
  let failStart = false;
  const extensionAPI = {
    settings: {
      get: (key) => settings.get(key), set: async (key, value) => settings.set(key, value),
      panel: { create: (next) => { panel = next; } },
    },
    ui: { commandPalette: {
      addCommand: (command) => {
        if (failStart && command.label.includes('1. Focus')) throw new Error('test start failure');
        commands.set(command.label, command);
      },
      removeCommand: ({ label }) => commands.delete(label),
    } },
  };
  const hostCount = () => topbar.children.filter((node) => node.id === 'nautilus-log-timing-topbar').length;
  const toggle = (enabled) => panel.settings.find((item) => item.id === 'actual-time-tracking').action.onChange(enabled);
  await extension.onload({ extensionAPI });
  assert.equal(hostCount(), 1);
  assert.equal(intervals.size, 0);
  for (const enabled of [true, false, true, false]) {
    await toggle(enabled);
    assert.equal(hostCount(), 1);
    assert.equal(intervals.size, enabled ? 1 : 0);
    assert.equal(commands.has('Nautilus Log: Create or open today’s plan'), true);
    assert.equal(commands.has('Nautilus Log: 1. Focus current block'), enabled);
  }
  await toggle(true);
  await Promise.all([toggle(false), toggle(true)]);
  assert.equal(settings.get('actual-time-tracking'), true);
  assert.equal(intervals.size, 1, 'a later enable must not be erased by an earlier pending disable');
  assert.equal(hostCount(), 1);
  await toggle(false);
  failStart = true;
  await assert.rejects(toggle(true), /test start failure/);
  assert.equal(settings.get('actual-time-tracking'), false);
  assert.equal(hostCount(), 1);
  assert.equal(intervals.size, 0);
  await extension.onunload();
  assert.equal(hostCount(), 0);
  assert.equal(commands.size, 0);
});

test('unload during runtime initialization cannot resurrect timers, commands, or topbar', async (t) => {
  const {roam} = createRoamMock();
  const {document, topbar} = createMiniDom();
  const intervals = new Set();
  const commands = new Set();
  let nextInterval = 0;
  global.window = {
    roamAlphaAPI: roam, dispatchEvent() {}, addEventListener() {}, removeEventListener() {},
    setTimeout: () => 1, clearTimeout() {},
    setInterval: () => {const id = ++nextInterval; intervals.add(id); return id;},
    clearInterval: (id) => intervals.delete(id),
  };
  installTestHostLocks(global.window);
  global.document = document;
  global.MutationObserver = class {observe() {} disconnect() {}};
  t.after(() => {delete global.window; delete global.document; delete global.MutationObserver;});
  const bundle = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
  const extension = (await import(`data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}#unload-initialize-${Math.random()}`)).default;
  const settings = new Map([['actual-time-tracking', true]]);
  const extensionAPI = {
    settings: {
      get: (key) => settings.get(key), set: async (key, value) => settings.set(key, value),
      panel: {create() {}},
    },
    ui: {commandPalette: {
      addCommand: ({label}) => commands.add(label), removeCommand: ({label}) => commands.delete(label),
    }},
  };
  const originalQ = roam.q;
  let unload = null;
  roam.q = (query, ...args) => {
    if (!unload && query.includes('?clock-uid ?clock-string')) unload = extension.onunload();
    return originalQ(query, ...args);
  };
  await extension.onload({extensionAPI});
  await unload;
  assert.ok(unload, 'the fixture must interrupt the actual timing initialization');
  assert.equal(intervals.size, 0);
  assert.equal(commands.size, 0);
  assert.equal(topbar.children.filter((node) => node.id === 'nautilus-log-timing-topbar').length, 0);
  assert.equal(window.nautilusLogExtensionData.running, false);
  assert.notEqual(window.nautilusLogExtensionData.timingEnabled, true);
  await extension.onunload();
});

function pageUidOfForTest(blocks, pages, block) {
  let current = block;
  while (current?.parentUid) {
    if ([...pages.values()].includes(current.parentUid)) return current.parentUid;
    current = blocks.get(current.parentUid);
  }
  return null;
}
