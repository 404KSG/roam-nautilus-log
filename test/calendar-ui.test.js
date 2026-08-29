const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function loadExtension(label) {
  const bundle = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}#${label}-${Date.now()}`);
}

function settingsApi(values) {
  const store = new Map(Object.entries(values));
  return {
    settings: {
      get: (key) => store.get(key),
      set: async (key, value) => store.set(key, value),
      panel: { create: () => {} },
    },
  };
}

test('Calendar settings remain compact until the optional feature is enabled', async () => {
  const extension = await loadExtension('calendar-panel');
  const disabled = extension.panelConfig(settingsApi({
    language: 'en',
    'google-calendar-enabled': false,
  }), 'en');
  assert.ok(disabled.settings.find((setting) => setting.id === 'google-calendar-enabled'));
  assert.equal(disabled.settings.some((setting) => setting.id === 'google-oauth-client-id'), false);

  const enabled = extension.panelConfig(settingsApi({
    language: 'en',
    'google-calendar-enabled': true,
    'google-oauth-client-id': 'client-id.apps.googleusercontent.com',
    'google-calendar-ids': 'primary',
  }), 'en');
  assert.ok(enabled.settings.find((setting) => setting.id === 'google-oauth-client-id'));
  assert.ok(enabled.settings.find((setting) => setting.id === 'google-calendar-ids'));
});

test('Calendar control uses a Blueprint calendar glyph instead of a custom SVG', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'component.cljs'), 'utf8');
  assert.match(source, /bp3-icon bp3-icon-calendar/);
  const calendarFunction = source.match(/\(defn calendar-button[\s\S]*?\n\(defn /)?.[0] || '';
  assert.doesNotMatch(calendarFunction, /\[:svg/);
});
