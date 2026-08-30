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
    'google-calendar-connection': JSON.stringify({ version: 2, id: 'connection-id', secret: 'connection-secret' }),
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

  const legacy = extension.panelConfig(settingsApi({
    language: 'en',
    'google-calendar-enabled': true,
    'google-calendar-connection': JSON.stringify({ version: 1, id: 'legacy-id', secret: 'legacy-secret' }),
  }), 'en');
  const reconnect = legacy.settings.find(
    (setting) => setting.id === 'google-calendar-connection-action',
  );
  assert.equal(reconnect.action.content, 'Reconnect');
  assert.match(reconnect.description, /Google Tasks/i);
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

test('Calendar control keeps its Blueprint calendar glyph and spins only while syncing', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'component.cljs'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'extension.css'), 'utf8');
  assert.match(source, /"bp3-icon-calendar"/);
  const calendarFunction = source.match(/\(defn calendar-button[\s\S]*?\n\(defn /)?.[0] || '';
  assert.match(calendarFunction, /and \(:google-calendar-enabled settings\)[\s\S]*:google-calendar-configured/);
  assert.match(calendarFunction, /bp3-icon-refresh nautilus-log-calendar-spinner/);
  assert.match(calendarFunction, /:aria-busy \(if busy\? "true" "false"\)/);
  assert.match(calendarFunction, /:aria-expanded \(if popover-open\? "true" "false"\)/);
  assert.match(calendarFunction, /:disabled busy\?/);
  assert.match(calendarFunction, /:data-nautilus-tooltip tooltip/);
  assert.match(calendarFunction, /default-tooltip \(str \(:calendar copy\) "\\n" \(:calendarForce copy\)\)/);
  assert.match(calendarFunction, /calendar-result-popover result settings copy/);
  assert.match(calendarFunction, /calendar-error-popover error copy/);
  assert.match(calendarFunction, /:on-mouse-leave #\(swap! calendar-state assoc :hovered false :open false\)/);
  assert.match(calendarFunction, /:open \(boolean \(:hovered @calendar-state\)\)/);
  assert.doesNotMatch(calendarFunction, /:focused|:on-focus|:on-blur/);
  assert.doesNotMatch(calendarFunction, /\[:svg/);
  assert.doesNotMatch(calendarFunction, /calendarSetup/);
  assert.doesNotMatch(source, /calendar-result-title/);
  assert.match(css, /\.nautilus-log-calendar-control\s*\{[^}]*width:\s*32px;/s);
  assert.match(css, /\.nautilus-log-calendar-popover\s*\{[^}]*gap:\s*4px;[^}]*padding:\s*10px 12px;[^}]*width:\s*min\(260px,/s);
  assert.match(css, /\.nautilus-log-calendar-btn\[data-nautilus-tooltip\]::after\s*\{[^}]*white-space:\s*pre-line;/s);
  assert.match(css, /\.nautilus-log-calendar-spinner\s*\{[^}]*animation:\s*nautilus-log-calendar-spin 0\.75s linear infinite;/s);
  assert.match(css, /@keyframes nautilus-log-calendar-spin\s*\{[^}]*rotate\(360deg\)/s);
});
