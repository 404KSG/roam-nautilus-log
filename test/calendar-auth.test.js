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

test('persistent Google authorization restores a saved connection without loading Google Identity', async () => {
  const extension = await loadExtension('calendar-auth-restore');
  const requests = [];
  let identityLoads = 0;
  let now = 1_000;
  const auth = extension.createPersistentGoogleAuthClient({
    serviceUrl: 'https://auth.example.com',
    loadConnection: () => ({ id: 'saved-id', secret: 'saved-secret' }),
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return jsonResponse({ accessToken: 'access-1', expiresIn: 3600 });
    },
    identityLoader: async () => { identityLoads += 1; return {}; },
    now: () => now,
  });

  assert.equal(await auth.prepare(), true);
  assert.equal(await auth.authorize(), 'access-1');
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /\/token$/);
  assert.equal(JSON.parse(requests[0].options.body).connectionId, 'saved-id');
  assert.equal(identityLoads, 0);

  now += 3_700_000;
  assert.equal(await auth.authorize({ interactive: false }), 'access-1');
  assert.equal(requests.length, 2);
});

test('first Calendar action uses Google popup code model, saves an opaque credential, and continues', async () => {
  const extension = await loadExtension('calendar-auth-connect');
  let saved = null;
  let googleConfig = null;
  const requests = [];
  const oauth2 = {
    initCodeClient(config) {
      googleConfig = config;
      return { requestCode: () => config.callback({ code: 'one-time-google-code' }) };
    },
  };
  const auth = extension.createPersistentGoogleAuthClient({
    serviceUrl: 'https://auth.example.com',
    loadConnection: () => saved,
    saveConnection: async (connection) => { saved = connection; },
    clearConnection: async () => { saved = null; },
    identityLoader: async () => oauth2,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      if (url.endsWith('/config')) return jsonResponse({ clientId: 'public-client-id' });
      if (url.endsWith('/exchange')) {
        return jsonResponse({
          connection: { id: 'new-id', secret: 'new-secret' },
          accessToken: 'new-access',
          expiresIn: 3600,
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
  });

  assert.equal(await auth.authorize(), 'new-access');
  assert.equal(googleConfig.client_id, 'public-client-id');
  assert.equal(googleConfig.ux_mode, 'popup');
  assert.match(googleConfig.scope, /calendar\.events\.readonly/);
  assert.deepEqual(saved, { version: 1, id: 'new-id', secret: 'new-secret' });
  const exchange = requests.find((request) => request.url.endsWith('/exchange'));
  assert.equal(exchange.options.headers['X-Requested-With'], 'XmlHttpRequest');
  assert.deepEqual(JSON.parse(exchange.options.body), { code: 'one-time-google-code' });
});

test('revoked persistent connection is cleared without opening Google during restore', async () => {
  const extension = await loadExtension('calendar-auth-revoked');
  let saved = { id: 'revoked-id', secret: 'revoked-secret' };
  let identityLoads = 0;
  const auth = extension.createPersistentGoogleAuthClient({
    serviceUrl: 'https://auth.example.com',
    loadConnection: () => saved,
    clearConnection: async () => { saved = null; },
    fetchImpl: async () => jsonResponse({ code: 'reconnect_required', message: 'Reconnect.' }, 401),
    identityLoader: async () => { identityLoads += 1; return {}; },
  });

  assert.equal(await auth.prepare(), false);
  assert.equal(saved, null);
  assert.equal(identityLoads, 0);
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

test('destroy rejects a pending popup flow and prevents late credential persistence', async () => {
  const extension = await loadExtension('calendar-auth-destroy');
  let callback = null;
  let saved = null;
  const auth = extension.createPersistentGoogleAuthClient({
    serviceUrl: 'https://auth.example.com',
    loadConnection: () => saved,
    saveConnection: async (value) => { saved = value; },
    clearConnection: async () => { saved = null; },
    identityLoader: async () => ({
      initCodeClient(config) {
        callback = config.callback;
        return { requestCode() {} };
      },
    }),
    fetchImpl: async (url) => {
      if (url.endsWith('/config')) return jsonResponse({ clientId: 'public-client-id' });
      if (url.endsWith('/exchange')) {
        return jsonResponse({
          connection: { id: 'late-id', secret: 'late-secret' },
          accessToken: 'late-access',
          expiresIn: 3600,
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
  });

  const pending = auth.authorize();
  while (!callback) await new Promise((resolve) => setImmediate(resolve));
  auth.destroy();
  await assert.rejects(pending, /cancelled/);
  await callback({ code: 'late-code' });
  assert.equal(saved, null);
});

test('an interactive click recovers from a simultaneous revoked silent restore in one action', async () => {
  const extension = await loadExtension('calendar-auth-race');
  let saved = { id: 'revoked-id', secret: 'revoked-secret' };
  let resolveRefresh;
  let popupRequests = 0;
  const auth = extension.createPersistentGoogleAuthClient({
    serviceUrl: 'https://auth.example.com',
    loadConnection: () => saved,
    saveConnection: async (connection) => { saved = connection; },
    clearConnection: async () => { saved = null; },
    identityLoader: async () => ({
      initCodeClient(config) {
        return {
          requestCode() {
            popupRequests += 1;
            config.callback({ code: 'new-code' });
          },
        };
      },
    }),
    fetchImpl: async (url) => {
      if (url.endsWith('/token')) {
        return new Promise((resolve) => { resolveRefresh = () => resolve(jsonResponse({ code: 'reconnect_required' }, 401)); });
      }
      if (url.endsWith('/config')) return jsonResponse({ clientId: 'public-client-id' });
      if (url.endsWith('/exchange')) {
        return jsonResponse({
          connection: { id: 'new-id', secret: 'new-secret' },
          accessToken: 'new-access',
          expiresIn: 3600,
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
  });

  const silent = auth.prepare();
  while (!resolveRefresh) await new Promise((resolve) => setImmediate(resolve));
  const interactive = auth.authorize({ interactive: true });
  resolveRefresh();
  assert.equal(await silent, false);
  assert.equal(await interactive, 'new-access');
  assert.equal(popupRequests, 1);
});
