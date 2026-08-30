const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function loadExtension(label) {
  const bundle = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}#${label}-${Date.now()}`);
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function fakeOAuthWindow() {
  const listeners = new Set();
  const popup = {
    closed: false,
    url: '',
    location: { replace(url) { popup.url = url; } },
    close() { popup.closed = true; },
  };
  return {
    popup,
    windowImpl: {
      crypto: globalThis.crypto,
      location: { origin: 'https://roamresearch.com' },
      addEventListener(type, listener) { if (type === 'message') listeners.add(listener); },
      removeEventListener(type, listener) { if (type === 'message') listeners.delete(listener); },
      setInterval() { return 1; },
      clearInterval() {},
    },
    emit(data, origin = 'https://auth.example.com') {
      for (const listener of [...listeners]) listener({ data, origin });
    },
  };
}

test('persistent Google authorization restores a saved connection without opening a popup', async () => {
  const extension = await loadExtension('calendar-auth-restore');
  const requests = [];
  let popupOpens = 0;
  let now = 1_000;
  const auth = extension.createPersistentGoogleAuthClient({
    serviceUrl: 'https://auth.example.com',
    loadConnection: () => ({ id: 'saved-id', secret: 'saved-secret' }),
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return jsonResponse({ accessToken: 'access-1', expiresIn: 3600 });
    },
    popupOpen: () => { popupOpens += 1; return null; },
    now: () => now,
  });

  assert.equal(await auth.prepare(), true);
  assert.equal(await auth.authorize(), 'access-1');
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /\/token$/);
  assert.equal(JSON.parse(requests[0].options.body).connectionId, 'saved-id');
  assert.equal(popupOpens, 0);

  now += 3_700_000;
  assert.equal(await auth.authorize({ interactive: false }), 'access-1');
  assert.equal(requests.length, 2);
});

test('first Calendar action uses the hosted OAuth popup, saves an opaque credential, and continues', async () => {
  const extension = await loadExtension('calendar-auth-connect');
  let saved = null;
  const requests = [];
  const browser = fakeOAuthWindow();
  const auth = extension.createPersistentGoogleAuthClient({
    serviceUrl: 'https://auth.example.com',
    loadConnection: () => saved,
    saveConnection: async (connection) => { saved = connection; },
    clearConnection: async () => { saved = null; },
    windowImpl: browser.windowImpl,
    popupOpen: () => browser.popup,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      if (url.endsWith('/config')) return jsonResponse({ authorizeUrl: 'https://auth.example.com/authorize' });
      throw new Error(`Unexpected URL: ${url}`);
    },
  });

  const pending = auth.authorize();
  while (!browser.popup.url) await new Promise((resolve) => setImmediate(resolve));
  const authorizeUrl = new URL(browser.popup.url);
  assert.equal(authorizeUrl.searchParams.get('origin'), 'https://roamresearch.com');
  const nonce = authorizeUrl.searchParams.get('nonce');
  browser.emit({
    type: 'nautilus-google-oauth-v1',
    nonce,
    connection: { version: 2, id: 'new-id', secret: 'new-secret' },
    accessToken: 'new-access',
    expiresIn: 3600,
  });
  assert.equal(await pending, 'new-access');
  assert.deepEqual(saved, { version: 2, id: 'new-id', secret: 'new-secret' });
  assert.equal(requests.some((request) => request.url.endsWith('/exchange')), false);
});

test('Roam Desktop opens a real Google URL and polls the hosted result without about:blank', async () => {
  const extension = await loadExtension('calendar-auth-desktop');
  let saved = null;
  const opens = [];
  const requests = [];
  let resultPolls = 0;
  const sessionId = 's'.repeat(32);
  const sessionSecret = 'k'.repeat(48);
  const auth = extension.createPersistentGoogleAuthClient({
    serviceUrl: 'https://auth.example.com',
    loadConnection: () => saved,
    saveConnection: async (connection) => { saved = connection; },
    clearConnection: async () => { saved = null; },
    windowImpl: {
      crypto: globalThis.crypto,
      location: { origin: 'https://roamresearch.com' },
      roamAlphaAPI: { platform: { isDesktop: true } },
      setTimeout(callback) { queueMicrotask(callback); return 1; },
      clearTimeout() {},
    },
    popupOpen: (url, target) => {
      opens.push({ url, target });
      return null;
    },
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      if (url.endsWith('/desktop/session')) {
        return jsonResponse({
          authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=public-id',
          sessionId,
          sessionSecret,
        });
      }
      if (url.endsWith('/desktop/session/result')) {
        resultPolls += 1;
        if (resultPolls === 1) return jsonResponse({ status: 'pending' });
        return jsonResponse({
          status: 'complete',
          connection: { version: 2, id: 'desktop-id', secret: 'desktop-secret' },
          accessToken: 'desktop-access',
          expiresIn: 3600,
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
  });

  assert.equal(await auth.authorize(), 'desktop-access');
  assert.deepEqual(opens, [{
    url: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=public-id',
    target: '_blank',
  }]);
  assert.equal(opens.some(({ url }) => url === 'about:blank'), false);
  assert.deepEqual(saved, { version: 2, id: 'desktop-id', secret: 'desktop-secret' });
  const createBody = JSON.parse(requests[0].options.body);
  assert.match(createBody.nonce, /^[a-f0-9]{48}$/);
  assert.equal(resultPolls, 2);
  assert.deepEqual(JSON.parse(requests[2].options.body), { sessionId, sessionSecret });
});

test('revoked persistent connection is cleared without opening Google during restore', async () => {
  const extension = await loadExtension('calendar-auth-revoked');
  let saved = { id: 'revoked-id', secret: 'revoked-secret' };
  let popupOpens = 0;
  const auth = extension.createPersistentGoogleAuthClient({
    serviceUrl: 'https://auth.example.com',
    loadConnection: () => saved,
    clearConnection: async () => { saved = null; },
    fetchImpl: async () => jsonResponse({ code: 'reconnect_required', message: 'Reconnect.' }, 401),
    popupOpen: () => { popupOpens += 1; return null; },
  });

  assert.equal(await auth.prepare(), false);
  assert.equal(saved, null);
  assert.equal(popupOpens, 0);
});

test('transient token-service errors retain the saved connection', async () => {
  const extension = await loadExtension('calendar-auth-transient');
  let saved = { id: 'saved-id', secret: 'saved-secret' };
  let clears = 0;
  const auth = extension.createPersistentGoogleAuthClient({
    serviceUrl: 'https://auth.example.com',
    loadConnection: () => saved,
    clearConnection: async () => { clears += 1; saved = null; },
    fetchImpl: async () => jsonResponse({ code: 'google_unavailable', message: 'Try again.' }, 503),
  });

  await assert.rejects(auth.prepare(), /Try again/);
  assert.deepEqual(saved, { id: 'saved-id', secret: 'saved-secret' });
  assert.equal(clears, 0);
});

test('failed remote disconnect retains the local connection', async () => {
  const extension = await loadExtension('calendar-auth-disconnect-failure');
  let saved = { id: 'saved-id', secret: 'saved-secret' };
  let clears = 0;
  const auth = extension.createPersistentGoogleAuthClient({
    serviceUrl: 'https://auth.example.com',
    loadConnection: () => saved,
    clearConnection: async () => { clears += 1; saved = null; },
    fetchImpl: async () => jsonResponse({ code: 'service_error', message: 'Try again.' }, 503),
  });

  await assert.rejects(auth.disconnect(), /Try again/);
  assert.deepEqual(saved, { id: 'saved-id', secret: 'saved-secret' });
  assert.equal(clears, 0);
});

test('destroy rejects a pending popup flow and prevents late credential persistence', async () => {
  const extension = await loadExtension('calendar-auth-destroy');
  let saved = null;
  const browser = fakeOAuthWindow();
  const auth = extension.createPersistentGoogleAuthClient({
    serviceUrl: 'https://auth.example.com',
    loadConnection: () => saved,
    saveConnection: async (value) => { saved = value; },
    clearConnection: async () => { saved = null; },
    windowImpl: browser.windowImpl,
    popupOpen: () => browser.popup,
    fetchImpl: async (url) => {
      if (url.endsWith('/config')) return jsonResponse({ authorizeUrl: 'https://auth.example.com/authorize' });
      throw new Error(`Unexpected URL: ${url}`);
    },
  });

  const pending = auth.authorize();
  while (!browser.popup.url) await new Promise((resolve) => setImmediate(resolve));
  const nonce = new URL(browser.popup.url).searchParams.get('nonce');
  auth.destroy();
  await assert.rejects(pending, /cancelled/);
  browser.emit({
    type: 'nautilus-google-oauth-v1',
    nonce,
    connection: { version: 2, id: 'late-id', secret: 'late-secret' },
    accessToken: 'late-access',
    expiresIn: 3600,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(saved, null);
});

test('an interactive click recovers from a simultaneous revoked silent restore in one action', async () => {
  const extension = await loadExtension('calendar-auth-race');
  let saved = { id: 'revoked-id', secret: 'revoked-secret' };
  let resolveRefresh;
  let popupRequests = 0;
  const browser = fakeOAuthWindow();
  const auth = extension.createPersistentGoogleAuthClient({
    serviceUrl: 'https://auth.example.com',
    loadConnection: () => saved,
    saveConnection: async (connection) => { saved = connection; },
    clearConnection: async () => { saved = null; },
    windowImpl: browser.windowImpl,
    popupOpen: () => { popupRequests += 1; return browser.popup; },
    fetchImpl: async (url) => {
      if (url.endsWith('/token')) {
        return new Promise((resolve) => { resolveRefresh = () => resolve(jsonResponse({ code: 'reconnect_required' }, 401)); });
      }
      if (url.endsWith('/config')) return jsonResponse({ authorizeUrl: 'https://auth.example.com/authorize' });
      throw new Error(`Unexpected URL: ${url}`);
    },
  });

  const silent = auth.prepare();
  while (!resolveRefresh) await new Promise((resolve) => setImmediate(resolve));
  const interactive = auth.authorize({ interactive: true });
  resolveRefresh();
  assert.equal(await silent, false);
  while (!browser.popup.url) await new Promise((resolve) => setImmediate(resolve));
  const nonce = new URL(browser.popup.url).searchParams.get('nonce');
  browser.emit({
    type: 'nautilus-google-oauth-v1',
    nonce,
    connection: { version: 2, id: 'new-id', secret: 'new-secret' },
    accessToken: 'new-access',
    expiresIn: 3600,
  });
  assert.equal(await interactive, 'new-access');
  assert.equal(popupRequests, 1);
});
