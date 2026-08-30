import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest, encryptRefreshToken, decryptRefreshToken } from '../src/worker.mjs';

class MemoryD1 {
  constructor() { this.rows = new Map(); }

  prepare(sql) {
    const database = this;
    const normalized = String(sql).replace(/\s+/g, ' ').trim().toUpperCase();
    return {
      args: [],
      bind(...args) { this.args = args; return this; },
      async run() {
        if (normalized.startsWith('INSERT INTO OAUTH_CONNECTIONS')) {
          const [id, secretHash, iv, ciphertext, createdAt] = this.args;
          database.rows.set(id, {
            id,
            secret_hash: secretHash,
            refresh_token_iv: iv,
            refresh_token_ciphertext: ciphertext,
            created_at: createdAt,
          });
        } else if (normalized.startsWith('DELETE FROM OAUTH_CONNECTIONS')) {
          database.rows.delete(this.args[0]);
        } else {
          throw new Error(`Unexpected D1 run: ${normalized}`);
        }
        return { success: true };
      },
      async first() {
        if (!normalized.startsWith('SELECT ID, SECRET_HASH')) {
          throw new Error(`Unexpected D1 first: ${normalized}`);
        }
        return database.rows.get(this.args[0]) || null;
      },
    };
  }
}

function base64Url(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

function env() {
  return {
    ALLOWED_ORIGINS: 'https://roamresearch.com',
    GOOGLE_CLIENT_ID: 'google-client-id',
    GOOGLE_CLIENT_SECRET: 'google-client-secret',
    TOKEN_ENCRYPTION_KEY: base64Url(new Uint8Array(32).fill(7)),
    NAUTILUS_AUTH_DB: new MemoryD1(),
  };
}

function roamRequest(path, { method = 'POST', body, ajax = true } = {}) {
  const headers = { Origin: 'https://roamresearch.com' };
  if (method !== 'GET') headers['Content-Type'] = 'application/json';
  if (ajax) headers['X-Requested-With'] = 'XmlHttpRequest';
  return new Request(`https://auth.example.com${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test('refresh token encryption round-trips and uses a random IV', async () => {
  const bindings = env();
  const first = await encryptRefreshToken('refresh-secret', bindings);
  const second = await encryptRefreshToken('refresh-secret', bindings);
  assert.notEqual(first.iv, second.iv);
  assert.equal(await decryptRefreshToken(first, bindings), 'refresh-secret');
});

test('OAuth worker exchanges a GIS popup code, restores, and disconnects one opaque connection', { concurrency: false }, async () => {
  const bindings = env();
  const originalFetch = globalThis.fetch;
  const googleRequests = [];
  globalThis.fetch = async (url, options) => {
    googleRequests.push({ url: String(url), options });
    if (String(url).includes('/token')) {
      const params = new URLSearchParams(options.body);
      const payload = params.get('grant_type') === 'authorization_code'
        ? { access_token: 'first-access', refresh_token: 'refresh-secret', expires_in: 3600 }
        : { access_token: 'restored-access', expires_in: 3600, token_type: 'Bearer' };
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('', { status: 200 });
  };

  try {
    const configResponse = await handleRequest(roamRequest('/config', { method: 'GET' }), bindings);
    assert.equal(configResponse.status, 200);
    assert.deepEqual(await configResponse.json(), { clientId: 'google-client-id' });

    const exchangeResponse = await handleRequest(roamRequest('/exchange', {
      body: { code: 'one-time-google-code' },
    }), bindings);
    assert.equal(exchangeResponse.status, 200);
    const exchange = await exchangeResponse.json();
    assert.equal(exchange.accessToken, 'first-access');
    assert.equal(Boolean(exchange.connection.id), true);
    assert.equal(Boolean(exchange.connection.secret), true);
    const codeRequest = googleRequests.find((request) => request.url.includes('/token'));
    const codeParams = new URLSearchParams(codeRequest.options.body);
    assert.equal(codeParams.get('redirect_uri'), 'https://roamresearch.com');

    const tokenResponse = await handleRequest(roamRequest('/token', {
      body: {
        connectionId: exchange.connection.id,
        connectionSecret: exchange.connection.secret,
      },
    }), bindings);
    assert.equal(tokenResponse.status, 200);
    assert.deepEqual(await tokenResponse.json(), {
      accessToken: 'restored-access',
      expiresIn: 3600,
      tokenType: 'Bearer',
    });

    const disconnectResponse = await handleRequest(roamRequest('/disconnect', {
      body: {
        connectionId: exchange.connection.id,
        connectionSecret: exchange.connection.secret,
      },
    }), bindings);
    assert.equal(disconnectResponse.status, 200);
    const afterDisconnect = await handleRequest(roamRequest('/token', {
      body: {
        connectionId: exchange.connection.id,
        connectionSecret: exchange.connection.secret,
      },
    }), bindings);
    assert.equal(afterDisconnect.status, 401);
    assert.equal(googleRequests.some((request) => request.url.includes('/revoke')), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('transient Google refresh failures preserve the connection', { concurrency: false }, async () => {
  const bindings = env();
  const originalFetch = globalThis.fetch;
  let exchangeCount = 0;
  globalThis.fetch = async (_url, options) => {
    const params = new URLSearchParams(options.body);
    if (params.get('grant_type') === 'authorization_code') {
      exchangeCount += 1;
      return new Response(JSON.stringify({
        access_token: 'first-access',
        refresh_token: 'refresh-secret',
        expires_in: 3600,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ error: 'temporarily_unavailable' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const connected = await handleRequest(roamRequest('/exchange', { body: { code: 'code' } }), bindings);
    const { connection } = await connected.json();
    const first = await handleRequest(roamRequest('/token', {
      body: { connectionId: connection.id, connectionSecret: connection.secret },
    }), bindings);
    const second = await handleRequest(roamRequest('/token', {
      body: { connectionId: connection.id, connectionSecret: connection.secret },
    }), bindings);
    assert.equal(exchangeCount, 1);
    assert.equal(first.status, 503);
    assert.equal(second.status, 503);
    assert.equal(bindings.NAUTILUS_AUTH_DB.rows.has(connection.id), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('invalid_grant deletes the unusable connection', { concurrency: false }, async () => {
  const bindings = env();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const params = new URLSearchParams(options.body);
    const response = params.get('grant_type') === 'authorization_code'
      ? { status: 200, payload: { access_token: 'first', refresh_token: 'refresh', expires_in: 3600 } }
      : { status: 400, payload: { error: 'invalid_grant' } };
    return new Response(JSON.stringify(response.payload), {
      status: response.status,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const connected = await handleRequest(roamRequest('/exchange', { body: { code: 'code' } }), bindings);
    const { connection } = await connected.json();
    const response = await handleRequest(roamRequest('/token', {
      body: { connectionId: connection.id, connectionSecret: connection.secret },
    }), bindings);
    assert.equal(response.status, 401);
    assert.equal(bindings.NAUTILUS_AUTH_DB.rows.has(connection.id), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('OAuth worker rejects non-Roam origins and non-AJAX code delivery', async () => {
  const badOrigin = await handleRequest(new Request('https://auth.example.com/token', {
    method: 'POST',
    headers: { Origin: 'https://attacker.example', 'Content-Type': 'application/json' },
    body: '{}',
  }), env());
  assert.equal(badOrigin.status, 403);
  assert.equal(badOrigin.headers.get('Access-Control-Allow-Origin'), null);

  const missingAjax = await handleRequest(roamRequest('/exchange', {
    body: { code: 'code' },
    ajax: false,
  }), env());
  assert.equal(missingAjax.status, 400);
});
