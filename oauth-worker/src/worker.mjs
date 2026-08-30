const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_READONLY_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events.readonly',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/tasks.readonly',
].join(' ');
const OAUTH_MESSAGE_TYPE = 'nautilus-google-oauth-v1';
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const OAUTH_SESSION_TTL_MS = 10 * 60 * 1000;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value) {
  const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function base64UrlToText(value) {
  return decoder.decode(base64UrlToBytes(value));
}

function randomToken(size = 32) {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(String(value)));
  return bytesToBase64Url(new Uint8Array(digest));
}

async function oauthStateKey(env) {
  const bytes = base64UrlToBytes(env.OAUTH_STATE_SECRET || '');
  if (bytes.length !== 32) throw new Error('OAUTH_STATE_SECRET must contain 32 bytes.');
  return crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

async function signOAuthState(payload, env) {
  const body = bytesToBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign('HMAC', await oauthStateKey(env), encoder.encode(body));
  return `${body}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

async function verifyOAuthState(value, env) {
  const [body, signature, extra] = String(value || '').split('.');
  if (!body || !signature || extra) return null;
  const expected = await crypto.subtle.sign('HMAC', await oauthStateKey(env), encoder.encode(body));
  if (!constantTimeEqual(bytesToBase64Url(new Uint8Array(expected)), signature)) return null;
  return parseUnsignedOAuthState(value);
}

function parseUnsignedOAuthState(value) {
  const text = String(value || '');
  if (!text || text.length > 4096) return null;
  const [body, signature, extra] = text.split('.');
  if (!body || !signature || extra) return null;
  try {
    const payload = JSON.parse(base64UrlToText(body));
    const issuedAt = Number(payload?.issuedAt);
    if (!Number.isFinite(issuedAt) || issuedAt > Date.now() + 60_000) return null;
    if (Date.now() - issuedAt > OAUTH_STATE_TTL_MS) return null;
    return payload;
  } catch (_error) {
    return null;
  }
}

function statePayload(payload, env) {
  const issuer = String(env.OAUTH_ISSUER || '').trim();
  return issuer ? { ...payload, issuer } : payload;
}

function constantTimeEqual(left, right) {
  const a = encoder.encode(String(left));
  const b = encoder.encode(String(right));
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

function parseAllowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || 'https://roamresearch.com')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function requestOrigin(request, env) {
  const origin = request.headers.get('Origin') || '';
  return parseAllowedOrigins(env).includes(origin) ? origin : '';
}

function corsHeaders(origin) {
  return origin ? {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type, X-Requested-With',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  } : {};
}

function json(payload, status = 200, origin = '') {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...corsHeaders(origin),
    },
  });
}

function html(document, status = 200) {
  return new Response(document, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function validOpaque(value, min = 20, max = 160) {
  const text = String(value || '');
  return text.length >= min && text.length <= max && /^[A-Za-z0-9_-]+$/.test(text);
}

async function aesKey(env) {
  const bytes = base64UrlToBytes(env.TOKEN_ENCRYPTION_KEY || '');
  if (bytes.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must contain 32 bytes.');
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptRefreshToken(token, env) {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await aesKey(env),
    encoder.encode(String(token)),
  );
  return { iv: bytesToBase64Url(iv), ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)) };
}

export async function decryptRefreshToken(payload, env) {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64UrlToBytes(payload.iv) },
    await aesKey(env),
    base64UrlToBytes(payload.ciphertext),
  );
  return decoder.decode(plaintext);
}

async function readJson(request) {
  try {
    return await request.json();
  } catch (_error) {
    return null;
  }
}

async function googleToken(body) {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

function database(env) {
  if (!env.NAUTILUS_AUTH_DB?.prepare) throw new Error('NAUTILUS_AUTH_DB is not configured.');
  return env.NAUTILUS_AUTH_DB;
}

async function createConnection({ refreshToken, env }) {
  const connectionId = randomToken(24);
  const connectionSecret = randomToken(32);
  const encrypted = await encryptRefreshToken(refreshToken, env);
  await database(env).prepare(`
    INSERT INTO oauth_connections
      (id, secret_hash, refresh_token_iv, refresh_token_ciphertext, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind(
    connectionId,
    await sha256(connectionSecret),
    encrypted.iv,
    encrypted.ciphertext,
    Date.now(),
  ).run();
  return { version: 2, id: connectionId, secret: connectionSecret };
}

async function readConnection(connectionId, env) {
  return database(env).prepare(`
    SELECT id, secret_hash, refresh_token_iv, refresh_token_ciphertext
    FROM oauth_connections
    WHERE id = ?
  `).bind(connectionId).first();
}

async function deleteConnection(connectionId, env) {
  await database(env).prepare('DELETE FROM oauth_connections WHERE id = ?')
    .bind(connectionId)
    .run();
}

async function cleanupExpiredSessions(env) {
  const expiredBefore = Date.now();
  await database(env).prepare(`
    DELETE FROM oauth_connections
    WHERE id IN (
      SELECT connection_id FROM oauth_sessions
      WHERE expires_at < ? AND connection_id IS NOT NULL
    )
  `).bind(expiredBefore).run();
  await database(env).prepare('DELETE FROM oauth_sessions WHERE expires_at < ?')
    .bind(expiredBefore)
    .run();
}

async function createOAuthSession({ origin, nonce, env }) {
  await cleanupExpiredSessions(env);
  const sessionId = randomToken(24);
  const sessionSecret = randomToken(32);
  const now = Date.now();
  await database(env).prepare(`
    INSERT INTO oauth_sessions
      (id, secret_hash, origin, nonce, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(
    sessionId,
    await sha256(sessionSecret),
    origin,
    nonce,
    now + OAUTH_SESSION_TTL_MS,
    now,
  ).run();
  return { sessionId, sessionSecret };
}

async function readOAuthSession(sessionId, env) {
  return database(env).prepare(`
    SELECT id, secret_hash, origin, nonce, result_iv, result_ciphertext,
           connection_id, expires_at
    FROM oauth_sessions
    WHERE id = ?
  `).bind(sessionId).first();
}

async function deleteOAuthSession(sessionId, env) {
  await database(env).prepare('DELETE FROM oauth_sessions WHERE id = ?')
    .bind(sessionId)
    .run();
}

async function completeOAuthSession(sessionId, payload, env) {
  const session = await readOAuthSession(sessionId, env);
  if (!session || Number(session.expires_at) < Date.now()) {
    if (session) await deleteOAuthSession(sessionId, env);
    throw new Error('Google authorization session expired.');
  }
  const encrypted = await encryptRefreshToken(JSON.stringify(payload), env);
  await database(env).prepare(`
    UPDATE oauth_sessions
    SET result_iv = ?, result_ciphertext = ?, connection_id = ?
    WHERE id = ?
  `).bind(
    encrypted.iv,
    encrypted.ciphertext,
    payload?.connection?.id || null,
    sessionId,
  ).run();
}

async function verifyConnection(payload, env) {
  if (!validOpaque(payload?.connectionId) || !validOpaque(payload?.connectionSecret)) return null;
  const connection = await readConnection(payload.connectionId, env);
  if (!connection) return null;
  const secretHash = await sha256(payload.connectionSecret);
  return constantTimeEqual(secretHash, connection.secret_hash) ? connection : null;
}

function encryptedTokenFromRow(connection) {
  return {
    iv: connection.refresh_token_iv,
    ciphertext: connection.refresh_token_ciphertext,
  };
}

function oauthRedirectUri(request, env) {
  const candidate = String(env.GOOGLE_OAUTH_REDIRECT_URI || '').trim()
    || new URL('/oauth/callback', request.url).href;
  const redirect = new URL(candidate);
  if (redirect.protocol !== 'https:') throw new Error('Google OAuth callback must use HTTPS.');
  return redirect.href;
}

function googleAuthorizationUrl(request, env, state) {
  const clientId = String(env.GOOGLE_CLIENT_ID || '').trim();
  if (!clientId) throw new Error('Google authorization is not configured.');
  const googleUrl = new URL(GOOGLE_AUTHORIZE_URL);
  googleUrl.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: oauthRedirectUri(request, env),
    response_type: 'code',
    scope: GOOGLE_READONLY_SCOPES,
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'consent',
    state,
  }).toString();
  return googleUrl;
}

function popupDocument(payload, targetOrigin) {
  const serializedPayload = JSON.stringify(payload).replace(/</g, '\\u003c');
  const serializedOrigin = JSON.stringify(targetOrigin).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nautilus Log</title></head>
<body style="font:14px system-ui,sans-serif;color:#5f6b7a;padding:24px">You can close this window.</body>
<script>
const payload = ${serializedPayload};
if (window.opener) window.opener.postMessage(payload, ${serializedOrigin});
window.close();
</script>
</html>`;
}

function desktopDocument(success) {
  const title = success ? 'Google Calendar connected' : 'Google Calendar connection failed';
  const message = success
    ? 'Return to Roam Research. This tab can now be closed.'
    : 'Return to Roam Research and try the connection again.';
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="font:14px system-ui,sans-serif;color:#5f6b7a;padding:24px"><strong>${title}</strong><p>${message}</p></body>
</html>`;
}

function publicPage({ title, heading, description, sections }) {
  const sectionHtml = sections.map(({ title: sectionTitle, body }) => (
    `<section><h2>${sectionTitle}</h2>${body}</section>`
  )).join('');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
  <style>
    :root{color-scheme:light;background:#fbfcfd;color:#232b35;font:16px/1.6 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    body{margin:0}main{width:min(720px,calc(100% - 40px));margin:64px auto}header{border-bottom:1px solid #dfe4ea;padding-bottom:24px;margin-bottom:32px}
    h1{font-size:2rem;line-height:1.2;margin:0 0 12px}h2{font-size:1.08rem;margin:32px 0 8px}p,ul{color:#596575}a{color:#1769aa}footer{border-top:1px solid #dfe4ea;margin-top:48px;padding-top:20px;color:#7b8794;font-size:.9rem}
  </style>
</head>
<body><main><header><div>Nautilus Log</div><h1>${heading}</h1><p>${description}</p></header>${sectionHtml}<footer>Effective August 30, 2026 · <a href="mailto:animeshawtylovemealot@gmail.com">Contact</a></footer></main></body>
</html>`;
}

function homepageDocument() {
  return publicPage({
    title: 'Nautilus Log · Google Calendar connection',
    heading: 'Give every minute a job.',
    description: 'Nautilus Log is a read-only Google Calendar and Tasks connection for the Nautilus Log extension in Roam Research.',
    sections: [
      {
        title: 'What the connection does',
        body: '<p>It lets you explicitly sync fixed Calendar events and dated Google Tasks into the Nautilus plan for the date you are viewing. Your Google data is never edited.</p>',
      },
      {
        title: 'Control stays with you',
        body: '<p>Sync runs only when you use the Calendar control in Nautilus Log. You can disconnect at any time from the extension settings.</p>',
      },
      {
        title: 'Policies',
        body: '<p><a href="/privacy">Privacy Policy</a> · <a href="/terms">Terms of Service</a> · <a href="https://github.com/404KSG/roam-nautilus-log">Source code</a></p>',
      },
    ],
  });
}

function privacyDocument() {
  return publicPage({
    title: 'Nautilus Log · Privacy Policy',
    heading: 'Privacy Policy',
    description: 'This policy explains the Google data used by Nautilus Log and how the hosted authorization service handles it.',
    sections: [
      {
        title: 'Data accessed',
        body: '<p>Nautilus Log requests read-only access to your calendar list, calendar events, and Google Tasks. It cannot create, edit, or delete Google data.</p>',
      },
      {
        title: 'How data is used',
        body: '<p>The extension reads the items needed for an explicit sync and writes the selected date’s imported blocks into your Roam Research graph. Google event and task content is not stored by the hosted authorization service.</p>',
      },
      {
        title: 'Authorization storage and retention',
        body: '<p>A Google refresh token is encrypted at rest and stored only to maintain the connection you requested. Short-lived authorization sessions expire after ten minutes. Disconnecting Nautilus Log deletes the stored connection and asks Google to revoke the token. Google may also revoke access under its own policies.</p>',
      },
      {
        title: 'Sharing and advertising',
        body: '<p>Your Google data is not sold, used for advertising, or shared with third parties. Cloudflare provides the infrastructure used to run the authorization service and encrypted token store.</p>',
      },
      {
        title: 'Your choices',
        body: '<p>You may disconnect from Nautilus Log settings or remove Nautilus Log from your Google Account permissions at any time. For privacy questions, use the contact address below.</p>',
      },
    ],
  });
}

function termsDocument() {
  return publicPage({
    title: 'Nautilus Log · Terms of Service',
    heading: 'Terms of Service',
    description: 'These terms apply to the optional Google Calendar and Tasks connection provided with Nautilus Log.',
    sections: [
      {
        title: 'Service',
        body: '<p>The connection provides read-only import into a user-controlled Roam Research graph. It does not modify Google data or promise that every external item will fit into a Nautilus plan.</p>',
      },
      {
        title: 'Your responsibility',
        body: '<p>You are responsible for reviewing imported blocks, maintaining access to your Google and Roam accounts, and following the terms that apply to those services.</p>',
      },
      {
        title: 'Availability',
        body: '<p>The service is provided as available and may change as Google, Roam Research, or its infrastructure changes. You should not rely on it as the sole record for a meeting, deadline, or task.</p>',
      },
      {
        title: 'Ending the connection',
        body: '<p>You may stop using the connection and disconnect it at any time. Access may also be suspended to protect users or the service from abuse.</p>',
      },
    ],
  });
}

async function oauthCompletion(state, payload, env, status = 200) {
  if (state.sessionId) {
    await completeOAuthSession(state.sessionId, payload, env);
    return html(desktopDocument(!payload.error), status);
  }
  return html(popupDocument(payload, state.origin), status);
}

async function authorize(request, env) {
  const url = new URL(request.url);
  const origin = String(url.searchParams.get('origin') || '');
  const nonce = String(url.searchParams.get('nonce') || '');
  if (!parseAllowedOrigins(env).includes(origin) || !validOpaque(nonce)) {
    return json({ code: 'invalid_authorization_request', message: 'Authorization request was rejected.' }, 400);
  }
  const clientId = String(env.GOOGLE_CLIENT_ID || '').trim();
  if (!clientId) return json({ code: 'not_configured', message: 'Google authorization is not configured.' }, 503);
  const state = await signOAuthState(statePayload({ origin, nonce, issuedAt: Date.now() }, env), env);
  const googleUrl = googleAuthorizationUrl(request, env, state);
  return new Response(null, {
    status: 302,
    headers: {
      Location: googleUrl.href,
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

async function createDesktopAuthorization(request, env, origin) {
  const payload = await readJson(request);
  const nonce = String(payload?.nonce || '');
  if (!validOpaque(nonce)) {
    return json({ code: 'invalid_authorization_request', message: 'Authorization request was rejected.' }, 400, origin);
  }
  if (!String(env.GOOGLE_CLIENT_ID || '').trim()) {
    return json({ code: 'not_configured', message: 'Google authorization is not configured.' }, 503, origin);
  }
  const session = await createOAuthSession({ origin, nonce, env });
  const state = await signOAuthState(statePayload({
    origin,
    nonce,
    sessionId: session.sessionId,
    issuedAt: Date.now(),
  }, env), env);
  return json({
    authorizeUrl: googleAuthorizationUrl(request, env, state).href,
    ...session,
  }, 200, origin);
}

async function desktopAuthorizationResult(request, env, origin) {
  const payload = await readJson(request);
  if (!validOpaque(payload?.sessionId) || !validOpaque(payload?.sessionSecret)) {
    return json({ code: 'invalid_session', message: 'Google authorization session is invalid.' }, 401, origin);
  }
  const session = await readOAuthSession(payload.sessionId, env);
  const secretHash = await sha256(payload.sessionSecret);
  if (!session || session.origin !== origin || !constantTimeEqual(secretHash, session.secret_hash)) {
    return json({ code: 'invalid_session', message: 'Google authorization session is invalid.' }, 401, origin);
  }
  if (Number(session.expires_at) < Date.now()) {
    if (session.connection_id) await deleteConnection(session.connection_id, env);
    await deleteOAuthSession(session.id, env);
    return json({ code: 'session_expired', message: 'Google authorization timed out. Try again.' }, 410, origin);
  }
  if (!session.result_iv || !session.result_ciphertext) {
    return json({ status: 'pending' }, 200, origin);
  }
  const result = JSON.parse(await decryptRefreshToken({
    iv: session.result_iv,
    ciphertext: session.result_ciphertext,
  }, env));
  await deleteOAuthSession(session.id, env);
  return json({ status: 'complete', ...result }, 200, origin);
}

async function oauthCallback(request, env) {
  const url = new URL(request.url);
  const state = await verifyOAuthState(url.searchParams.get('state'), env);
  if (!state || !parseAllowedOrigins(env).includes(state.origin) || !validOpaque(state.nonce)) {
    return json({ code: 'invalid_state', message: 'Google authorization expired or was rejected.' }, 400);
  }
  const error = String(url.searchParams.get('error') || '');
  if (error) {
    return oauthCompletion(state, {
      type: OAUTH_MESSAGE_TYPE,
      nonce: state.nonce,
      error: error === 'access_denied' ? 'Google authorization was cancelled.' : 'Google authorization failed.',
    }, env);
  }
  const code = String(url.searchParams.get('code') || '').trim();
  if (!code || code.length > 4096) {
    return oauthCompletion(state, {
      type: OAUTH_MESSAGE_TYPE,
      nonce: state.nonce,
      error: 'Google returned no valid authorization code.',
    }, env, 400);
  }

  let result;
  try {
    result = await googleToken({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: oauthRedirectUri(request, env),
      grant_type: 'authorization_code',
    });
  } catch (_error) {
    return oauthCompletion(state, {
      type: OAUTH_MESSAGE_TYPE,
      nonce: state.nonce,
      error: 'Google authorization is temporarily unavailable.',
    }, env, 503);
  }
  if (!result.response.ok || !result.payload.access_token || !result.payload.refresh_token) {
    return oauthCompletion(state, {
      type: OAUTH_MESSAGE_TYPE,
      nonce: state.nonce,
      error: result.payload.refresh_token
        ? 'Google could not complete authorization.'
        : 'Google did not return a persistent connection. Remove Nautilus Log from Google permissions and try again.',
    }, env, 400);
  }

  const connection = await createConnection({ refreshToken: result.payload.refresh_token, env });
  try {
    return await oauthCompletion(state, {
      type: OAUTH_MESSAGE_TYPE,
      nonce: state.nonce,
      connection,
      accessToken: result.payload.access_token,
      expiresIn: Number(result.payload.expires_in) || 0,
      tokenType: result.payload.token_type || 'Bearer',
    }, env);
  } catch (_error) {
    await deleteConnection(connection.id, env);
    return html(desktopDocument(false), 500);
  }
}

function forwardProductionCallback(request, env) {
  const forwardUrl = String(env.OAUTH_CALLBACK_FORWARD_URL || '').trim();
  if (!forwardUrl) return null;
  const incoming = new URL(request.url);
  const state = parseUnsignedOAuthState(incoming.searchParams.get('state'));
  if (state?.issuer !== 'production') return null;

  const target = new URL(forwardUrl);
  if (target.protocol !== 'https:' || target.pathname !== '/oauth/callback') {
    throw new Error('OAuth callback forward URL is invalid.');
  }
  target.search = '';
  for (const key of ['code', 'state', 'error']) {
    const value = incoming.searchParams.get(key);
    if (value !== null) target.searchParams.set(key, value);
  }
  return new Response(null, {
    status: 302,
    headers: {
      Location: target.href,
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

async function config(request, env, origin) {
  const clientId = String(env.GOOGLE_CLIENT_ID || '').trim();
  if (!clientId) return json({ code: 'not_configured', message: 'Google authorization is not configured.' }, 503, origin);
  return json({ authorizeUrl: new URL('/authorize', request.url).href }, 200, origin);
}

async function refreshToken(request, env, origin) {
  const payload = await readJson(request);
  const connection = await verifyConnection(payload, env);
  if (!connection) {
    return json({ code: 'reconnect_required', message: 'Google Calendar must be reconnected.' }, 401, origin);
  }
  const refreshTokenValue = await decryptRefreshToken(encryptedTokenFromRow(connection), env);
  let result;
  try {
    result = await googleToken({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshTokenValue,
      grant_type: 'refresh_token',
    });
  } catch (_error) {
    return json({ code: 'google_unavailable', message: 'Google Calendar is temporarily unavailable.' }, 503, origin);
  }
  if (!result.response.ok || !result.payload.access_token) {
    if (result.payload.error === 'invalid_grant') {
      await deleteConnection(payload.connectionId, env);
      return json({ code: 'reconnect_required', message: 'Google Calendar must be reconnected.' }, 401, origin);
    }
    const status = result.response.status === 429 || result.response.status >= 500 ? 503 : 502;
    return json({ code: 'google_unavailable', message: 'Google Calendar is temporarily unavailable.' }, status, origin);
  }
  return json({
    accessToken: result.payload.access_token,
    expiresIn: Number(result.payload.expires_in) || 0,
    tokenType: result.payload.token_type || 'Bearer',
  }, 200, origin);
}

async function disconnect(request, env, origin) {
  const payload = await readJson(request);
  const connection = await verifyConnection(payload, env);
  if (!connection) return json({ disconnected: true }, 200, origin);
  const refreshTokenValue = await decryptRefreshToken(encryptedTokenFromRow(connection), env);
  await deleteConnection(payload.connectionId, env);
  try {
    await fetch(GOOGLE_REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: refreshTokenValue }),
    });
  } catch (_error) {
    // The local deletion is authoritative even when Google is unavailable.
  }
  return json({ disconnected: true }, 200, origin);
}

export async function handleRequest(request, env) {
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname === '/') return html(homepageDocument());
  if (request.method === 'GET' && url.pathname === '/privacy') return html(privacyDocument());
  if (request.method === 'GET' && url.pathname === '/terms') return html(termsDocument());
  if (request.method === 'GET' && url.pathname === '/health') {
    return json({ ok: true, service: 'nautilus-google-auth' });
  }
  try {
    if (request.method === 'GET' && url.pathname === '/authorize') return authorize(request, env);
    if (request.method === 'GET' && url.pathname === '/oauth/callback') {
      return forwardProductionCallback(request, env) || oauthCallback(request, env);
    }
  } catch (_error) {
    return json({ code: 'service_error', message: 'Google Calendar connection failed.' }, 500);
  }

  const origin = requestOrigin(request, env);
  if (request.method === 'OPTIONS') {
    return origin
      ? new Response(null, { status: 204, headers: corsHeaders(origin) })
      : new Response(null, { status: 403 });
  }
  if (!origin) return json({ code: 'origin_not_allowed', message: 'Origin is not allowed.' }, 403);

  try {
    if (request.method === 'GET' && url.pathname === '/config') return config(request, env, origin);
    if (request.method === 'POST' && url.pathname === '/desktop/session') return createDesktopAuthorization(request, env, origin);
    if (request.method === 'POST' && url.pathname === '/desktop/session/result') return desktopAuthorizationResult(request, env, origin);
    if (request.method === 'POST' && url.pathname === '/token') return refreshToken(request, env, origin);
    if (request.method === 'POST' && url.pathname === '/disconnect') return disconnect(request, env, origin);
    return json({ code: 'not_found', message: 'Not found.' }, 404, origin);
  } catch (_error) {
    return json({ code: 'service_error', message: 'Google Calendar connection failed.' }, 500, origin);
  }
}

export default { fetch: handleRequest };
