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

test('Calendar settings expose one explicit connection action and visible state', async () => {
  const extension = await loadExtension('calendar-panel');
  const disconnected = extension.panelConfig(settingsApi({
    language: 'en',
    'google-calendar-enabled': false,
    'google-calendar-connection': '',
  }), 'en');
  const connect = disconnected.settings.find(
    (setting) => setting.id === 'google-calendar-connection-action',
  );
  assert.equal(connect.action.type, 'button');
  assert.equal(connect.action.content, 'Connect');
  assert.match(connect.description, /not connected/i);
  assert.match(connect.description, /read-only/i);
  assert.equal(disconnected.settings.some((setting) => setting.id === 'google-calendar-enabled'), false);
  assert.equal(disconnected.settings.some((setting) => setting.id === 'google-oauth-client-id'), false);

  const connected = extension.panelConfig(settingsApi({
    language: 'en',
    'google-calendar-enabled': true,
    'google-calendar-connection': JSON.stringify({ id: 'connection-id', secret: 'connection-secret' }),
    'google-calendar-ids': 'primary',
  }), 'en');
  const disconnect = connected.settings.find(
    (setting) => setting.id === 'google-calendar-connection-action',
  );
  assert.equal(disconnect.action.type, 'button');
  assert.equal(disconnect.action.content, 'Disconnect');
  assert.match(disconnect.description, /connected/i);
  assert.match(disconnect.description, /primary calendar/i);
  assert.equal(connected.settings.some((setting) => setting.id === 'google-oauth-client-id'), false);
  assert.equal(connected.settings.some((setting) => setting.id === 'google-calendar-ids'), false);
});

test('Calendar settings communicate progress and recoverable failure without another surface', async () => {
  const extension = await loadExtension('calendar-panel-state');
  const api = settingsApi({
    language: 'en',
    'google-calendar-enabled': false,
    'google-calendar-connection': '',
  });
  const connecting = extension.panelConfig(api, 'en', { action: 'connecting', error: '' })
    .settings.find((setting) => setting.id === 'google-calendar-connection-action');
  assert.equal(connecting.action.content, 'Connecting…');
  assert.match(connecting.description, /choose your Google account/i);

  const failed = extension.panelConfig(api, 'en', { action: '', error: 'connect' })
    .settings.find((setting) => setting.id === 'google-calendar-connection-action');
  assert.equal(failed.action.content, 'Try again');
  assert.match(failed.description, /could not connect/i);
});

test('Calendar control uses a Blueprint calendar glyph instead of a custom SVG', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'component.cljs'), 'utf8');
  assert.match(source, /bp3-icon bp3-icon-calendar/);
  const calendarFunction = source.match(/\(defn calendar-button[\s\S]*?\n\(defn /)?.[0] || '';
  assert.match(calendarFunction, /and \(:google-calendar-enabled settings\)[\s\S]*:google-calendar-configured/);
  assert.doesNotMatch(calendarFunction, /\[:svg/);
  assert.doesNotMatch(calendarFunction, /calendarSetup/);
});
