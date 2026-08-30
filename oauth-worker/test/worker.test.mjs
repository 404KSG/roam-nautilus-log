import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest, encryptRefreshToken, decryptRefreshToken } from '../src/worker.mjs';

class MemoryD1 {
  constructor() {
    this.rows = new Map();
    this.sessions = new Map();
  }

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
        } else if (normalized.startsWith('INSERT INTO OAUTH_SESSIONS')) {
          const [
            id,
            secretHash,
            origin,
            nonce,
            verifierIv,
            verifierCiphertext,
            expiresAt,
            createdAt,
          ] = this.args;
          database.sessions.set(id, {
            id,
            secret_hash: secretHash,
            origin,
            nonce,
            result_iv: null,
            result_ciphertext: null,
            connection_id: null,
            pkce_verifier_iv: verifierIv,
            pkce_verifier_ciphertext: verifierCiphertext,
            consumed_at: null,
            expires_at: expiresAt,
            created_at: createdAt,
          });
        } else if (normalized.startsWith('UPDATE OAUTH_SESSIONS SET CONSUMED_AT')) {
          const [consumedAt, id, minimumExpiry] = this.args;
          const session = database.sessions.get(id);
          if (!session || session.consumed_at !== null || session.expires_at < minimumExpiry) {
            return { success: true, meta: { changes: 0 } };
          }
          session.consumed_at = consumedAt;
          return { success: true, meta: { changes: 1 } };
        } else if (normalized.startsWith('UPDATE OAUTH_SESSIONS SET RESULT_IV')) {
          const [resultIv, resultCiphertext, connectionId, id] = this.args;
          const session = database.sessions.get(id);
          if (session) {
            session.result_iv = resultIv;
            session.result_ciphertext = resultCiphertext;
            session.connection_id = connectionId;
          }
        } else if (normalized.startsWith('DELETE FROM OAUTH_CONNECTIONS')) {
          if (normalized.includes('SELECT CONNECTION_ID FROM OAUTH_SESSIONS')) {
            const cutoff = this.args[0];
            for (const session of database.sessions.values()) {
              if (session.expires_at < cutoff && session.connection_id) {
                database.rows.delete(session.connection_id);
              }
            }
          } else {
            database.rows.delete(this.args[0]);
          }
        } else if (normalized.startsWith('DELETE FROM OAUTH_SESSIONS')) {
          if (normalized.includes('WHERE EXPIRES_AT <')) {
            const cutoff = this.args[0];
            for (const [id, session] of database.sessions) {
              if (session.expires_at < cutoff) database.sessions.delete(id);
            }
          } else {
            database.sessions.delete(this.args[0]);
          }
        } else {
          throw new Error(`Unexpected D1 run: ${normalized}`);
        }
        return { success: true, meta: { changes: 1 } };
      },
      async first() {
        if (normalized.includes('FROM OAUTH_CONNECTIONS')) {
          return database.rows.get(this.args[0]) || null;
        }
        if (normalized.includes('FROM OAUTH_SESSIONS')) {
          return database.sessions.get(this.args[0]) || null;
        }
        throw new Error(`Unexpected D1 first: ${normalized}`);
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
    OAUTH_STATE_SECRET: base64Url(new Uint8Array(32).fill(11)),
    TOKEN_ENCRYPTION_KEY: base64Url(new Uint8Array(32).fill(7)),
    NAUTILUS_AUTH_DB: new MemoryD1(),
  };
}

async function beginAuthorization(bindings, nonce = 'n'.repeat(32)) {
  const response = await handleRequest(new Request(
    `https://auth.example.com/authorize?origin=${encodeURIComponent('https://roamresearch.com')}&nonce=${nonce}`,
  ), bindings);
  assert.equal(response.status, 302);
  return { nonce, googleUrl: new URL(response.headers.get('Location')) };
}

async function finishAuthorization(bindings, state, code = 'one-time-google-code', expectPayload = true) {
  const response = await handleRequest(new Request(
    `https://auth.example.com/oauth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
  ), bindings);
  const document = await response.text();
  const match = document.match(/const payload = (.+);/);
  if (expectPayload) assert.ok(match, 'OAuth callback should embed one popup payload.');
  return { response, document, payload: match ? JSON.parse(match[1]) : null };
}

async function beginDesktopAuthorization(bindings, nonce = 'd'.repeat(32)) {
  const response = await handleRequest(roamRequest('/desktop/session', {
    body: { nonce },
  }), bindings);
  assert.equal(response.status, 200);
  const payload = await response.json();
  return { ...payload, nonce, googleUrl: new URL(payload.authorizeUrl) };
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

test('public OAuth pages accurately expose the app, privacy, and terms documents', async () => {
  for (const [path, text] of [
    ['/', 'Give every minute a job.'],
    ['/privacy', 'Privacy Policy'],
    ['/terms', 'Terms of Service'],
  ]) {
    const response = await handleRequest(new Request(`https://auth.example.com${path}`), env());
    assert.equal(response.status, 200);
    assert.match(response.headers.get('Content-Type'), /^text\/html/);
    assert.match(await response.text(), new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('OAuth worker serves the permanent Search Console ownership file', async () => {
  const filename = 'google59f9f68cabb109f4.html';
  const response = await handleRequest(new Request(`https://auth.example.com/${filename}`), env());
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Content-Type'), /^text\/html/);
  assert.equal(await response.text(), `google-site-verification: ${filename}`);
});

test('OAuth worker completes its hosted callback, restores, and disconnects one opaque connection', { concurrency: false }, async () => {
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
    assert.deepEqual(await configResponse.json(), { authorizeUrl: 'https://auth.example.com/authorize' });

    const started = await beginAuthorization(bindings);
    assert.equal(started.googleUrl.origin, 'https://accounts.google.com');
    assert.equal(started.googleUrl.searchParams.get('client_id'), 'google-client-id');
    assert.equal(started.googleUrl.searchParams.get('redirect_uri'), 'https://auth.example.com/oauth/callback');
    assert.equal(started.googleUrl.searchParams.get('access_type'), 'offline');
    assert.equal(started.googleUrl.searchParams.get('prompt'), 'consent');
    assert.equal(started.googleUrl.searchParams.get('code_challenge_method'), 'S256');
    assert.match(started.googleUrl.searchParams.get('code_challenge'), /^[A-Za-z0-9_-]{43}$/);
    assert.match(started.googleUrl.searchParams.get('scope'), /calendar\.events\.readonly/);
    assert.match(started.googleUrl.searchParams.get('scope'), /tasks\.readonly/);

    const exchange = await finishAuthorization(
      bindings,
      started.googleUrl.searchParams.get('state'),
    );
    assert.equal(exchange.response.status, 200);
    assert.equal(exchange.payload.type, 'nautilus-google-oauth-v1');
    assert.equal(exchange.payload.nonce, started.nonce);
    assert.equal(exchange.payload.accessToken, 'first-access');
    assert.equal(Boolean(exchange.payload.connection.id), true);
    assert.equal(Boolean(exchange.payload.connection.secret), true);
    assert.equal(exchange.payload.connection.version, 2);
    assert.match(exchange.document, /postMessage\(payload, "https:\/\/roamresearch\.com"\)/);
    const codeRequest = googleRequests.find((request) => request.url.includes('/token'));
    const codeParams = new URLSearchParams(codeRequest.options.body);
    assert.equal(codeParams.get('redirect_uri'), 'https://auth.example.com/oauth/callback');
    assert.match(codeParams.get('code_verifier'), /^[A-Za-z0-9_-]{64}$/);

    const tokenResponse = await handleRequest(roamRequest('/token', {
      body: {
        connectionId: exchange.payload.connection.id,
        connectionSecret: exchange.payload.connection.secret,
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
        connectionId: exchange.payload.connection.id,
        connectionSecret: exchange.payload.connection.secret,
      },
    }), bindings);
    assert.equal(disconnectResponse.status, 200);
    const afterDisconnect = await handleRequest(roamRequest('/token', {
      body: {
        connectionId: exchange.payload.connection.id,
        connectionSecret: exchange.payload.connection.secret,
      },
    }), bindings);
    assert.equal(afterDisconnect.status, 401);
    assert.equal(googleRequests.some((request) => request.url.includes('/revoke')), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('OAuth worker returns a Desktop callback through one secret-bound polling session', { concurrency: false }, async () => {
  const bindings = env();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const params = new URLSearchParams(options.body);
    assert.equal(params.get('grant_type'), 'authorization_code');
    return new Response(JSON.stringify({
      access_token: 'desktop-access',
      refresh_token: 'desktop-refresh',
      expires_in: 3600,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const started = await beginDesktopAuthorization(bindings);
    assert.equal(started.googleUrl.origin, 'https://accounts.google.com');
    assert.equal(started.googleUrl.searchParams.get('client_id'), 'google-client-id');
    assert.match(started.sessionId, /^[A-Za-z0-9_-]{20,160}$/);
    assert.match(started.sessionSecret, /^[A-Za-z0-9_-]{20,160}$/);
    assert.equal(started.googleUrl.searchParams.get('code_challenge_method'), 'S256');

    const pending = await handleRequest(roamRequest('/desktop/session/result', {
      body: { sessionId: started.sessionId, sessionSecret: started.sessionSecret },
    }), bindings);
    assert.equal(pending.status, 200);
    assert.deepEqual(await pending.json(), { status: 'pending' });

    const callback = await finishAuthorization(
      bindings,
      started.googleUrl.searchParams.get('state'),
      'desktop-code',
      false,
    );
    assert.equal(callback.response.status, 200);
    assert.doesNotMatch(callback.document, /desktop-access|desktop-secret|postMessage/);

    const wrongSecret = await handleRequest(roamRequest('/desktop/session/result', {
      body: { sessionId: started.sessionId, sessionSecret: 'x'.repeat(48) },
    }), bindings);
    assert.equal(wrongSecret.status, 401);

    const completed = await handleRequest(roamRequest('/desktop/session/result', {
      body: { sessionId: started.sessionId, sessionSecret: started.sessionSecret },
    }), bindings);
    assert.equal(completed.status, 200);
    const result = await completed.json();
    assert.equal(result.status, 'complete');
    assert.equal(result.accessToken, 'desktop-access');
    assert.equal(result.connection.id.length > 20, true);
    assert.equal(bindings.NAUTILUS_AUTH_DB.sessions.has(started.sessionId), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('OAuth callback transaction can be consumed only once', { concurrency: false }, async () => {
  const bindings = env();
  const originalFetch = globalThis.fetch;
  let exchangeCount = 0;
  globalThis.fetch = async () => {
    exchangeCount += 1;
    return new Response(JSON.stringify({
      access_token: 'first-access',
      refresh_token: 'refresh-secret',
      expires_in: 3600,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const started = await beginDesktopAuthorization(bindings);
    const state = started.googleUrl.searchParams.get('state');
    const first = await finishAuthorization(bindings, state, 'first-code', false);
    assert.equal(first.response.status, 200);
    const second = await finishAuthorization(bindings, state, 'second-code', false);
    assert.equal(second.response.status, 400);
    assert.match(second.document, /already used/);
    assert.equal(exchangeCount, 1);
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
    const started = await beginAuthorization(bindings);
    const connected = await finishAuthorization(bindings, started.googleUrl.searchParams.get('state'), 'code');
    const { connection } = connected.payload;
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
    const started = await beginAuthorization(bindings);
    const connected = await finishAuthorization(bindings, started.googleUrl.searchParams.get('state'), 'code');
    const { connection } = connected.payload;
    const response = await handleRequest(roamRequest('/token', {
      body: { connectionId: connection.id, connectionSecret: connection.secret },
    }), bindings);
    assert.equal(response.status, 401);
    assert.equal(bindings.NAUTILUS_AUTH_DB.rows.has(connection.id), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('OAuth worker rejects non-Roam origins and invalid callback state', async () => {
  const badOrigin = await handleRequest(new Request('https://auth.example.com/token', {
    method: 'POST',
    headers: { Origin: 'https://attacker.example', 'Content-Type': 'application/json' },
    body: '{}',
  }), env());
  assert.equal(badOrigin.status, 403);
  assert.equal(badOrigin.headers.get('Access-Control-Allow-Origin'), null);

  const badStart = await handleRequest(new Request(
    `https://auth.example.com/authorize?origin=${encodeURIComponent('https://attacker.example')}&nonce=${'n'.repeat(32)}`,
  ), env());
  assert.equal(badStart.status, 400);

  const badCallback = await handleRequest(new Request(
    'https://auth.example.com/oauth/callback?code=code&state=invalid',
  ), env());
  assert.equal(badCallback.status, 400);
});

test('preview callback forwards only production-issued flows to the fixed production callback', async () => {
  const production = env();
  production.OAUTH_ISSUER = 'production';
  production.GOOGLE_OAUTH_REDIRECT_URI = 'https://preview.example.com/oauth/callback';
  const started = await beginAuthorization(production);
  assert.equal(
    started.googleUrl.searchParams.get('redirect_uri'),
    'https://preview.example.com/oauth/callback',
  );

  const preview = env();
  preview.OAUTH_CALLBACK_FORWARD_URL = 'https://production.example.com/oauth/callback';
  const response = await handleRequest(new Request(
    `https://preview.example.com/oauth/callback?code=google-code&state=${encodeURIComponent(started.googleUrl.searchParams.get('state'))}&scope=ignored`,
  ), preview);
  assert.equal(response.status, 302);
  const location = new URL(response.headers.get('Location'));
  assert.equal(location.origin, 'https://production.example.com');
  assert.equal(location.pathname, '/oauth/callback');
  assert.equal(location.searchParams.get('code'), 'google-code');
  assert.equal(location.searchParams.get('state'), started.googleUrl.searchParams.get('state'));
  assert.equal(location.searchParams.has('scope'), false);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');

  const rejectingProduction = env();
  rejectingProduction.OAUTH_STATE_SECRET = base64Url(new Uint8Array(32).fill(12));
  const rejectedAtProduction = await handleRequest(new Request(location), rejectingProduction);
  assert.equal(rejectedAtProduction.status, 400);
});

test('preview callback never forwards ordinary or malformed state', async () => {
  const preview = env();
  preview.OAUTH_CALLBACK_FORWARD_URL = 'https://production.example.com/oauth/callback';
  const ordinary = await beginAuthorization(preview);
  const ordinaryResponse = await handleRequest(new Request(
    `https://preview.example.com/oauth/callback?code=google-code&state=${encodeURIComponent(ordinary.googleUrl.searchParams.get('state'))}`,
  ), preview);
  assert.notEqual(ordinaryResponse.status, 302);

  const malformedResponse = await handleRequest(new Request(
    'https://preview.example.com/oauth/callback?code=google-code&state=invalid',
  ), preview);
  assert.equal(malformedResponse.status, 400);
});
