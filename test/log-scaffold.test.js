const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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

  const roam = {
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
  for (const id of ['timing-line-sidebar', 'pomodoro-minutes', 'recent-retention-minutes', 'forgotten-timer-minutes']) {
    assert.equal(latestPanel.settings.some((setting) => setting.id === id), false);
  }

  settings.set('actual-time-tracking', true);
  const expandedPanel = extensionModule.panelConfig(extensionAPI, 'en');
  assert.equal(expandedPanel.settings.find(({ id }) => id === 'timing-line-sidebar').action.defaultValue, true);
  assert.equal(expandedPanel.settings.find(({ id }) => id === 'recent-retention-minutes').action.default, 45);
  assert.equal(expandedPanel.settings.find(({ id }) => id === 'forgotten-timer-minutes').action.default, 120);
  await expandedPanel.settings.find(({ id }) => id === 'recent-retention-minutes').action.onChange({ target: { value: '30' } });
  await expandedPanel.settings.find(({ id }) => id === 'forgotten-timer-minutes').action.onChange({ target: { value: '0' } });
  assert.equal(settings.get('recent-retention-minutes'), 30);
  assert.equal(settings.get('forgotten-timer-minutes'), 0);
  const zhPanel = extensionModule.panelConfig(extensionAPI, 'zh');
  assert.equal(zhPanel.settings.find(({ id }) => id === 'actual-time-tracking').name, '执行层 · 进阶');
  assert.equal(global.document, undefined);

  await extension.onunload();
});

test('legacy preview installs migrate the old automatic Chinese default once', async (t) => {
  const { roam } = createRoamMock();
  global.window = {
    roamAlphaAPI: roam,
    dispatchEvent: () => {},
  };
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

  await extension.onload({ extensionAPI });
  assert.equal(settings.get('prefix-str'), '[[Nautilus Log]]');
  assert.equal(settings.get('workday-end'), 21);
  assert.equal(settings.get('product-defaults-version'), 'timing-v1');
  await extension.onunload();
});
