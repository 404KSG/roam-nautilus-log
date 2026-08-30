const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

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

function randomToken(size = 32) {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(String(value)));
  return bytesToBase64Url(new Uint8Array(digest));
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
  return { version: 1, id: connectionId, secret: connectionSecret };
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

function requireAjax(request) {
  return String(request.headers.get('X-Requested-With') || '').toLowerCase() === 'xmlhttprequest';
}

async function config(_request, env, origin) {
  const clientId = String(env.GOOGLE_CLIENT_ID || '').trim();
  if (!clientId) return json({ code: 'not_configured', message: 'Google authorization is not configured.' }, 503, origin);
  return json({ clientId }, 200, origin);
}

async function exchange(request, env, origin) {
  if (!requireAjax(request)) {
    return json({ code: 'invalid_request', message: 'Authorization request was rejected.' }, 400, origin);
  }
  const payload = await readJson(request);
  const code = String(payload?.code || '').trim();
  if (!code || code.length > 4096) {
    return json({ code: 'invalid_code', message: 'Google returned no valid authorization code.' }, 400, origin);
  }

  let result;
  try {
    result = await googleToken({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: origin,
      grant_type: 'authorization_code',
    });
  } catch (_error) {
    return json({ code: 'google_unavailable', message: 'Google authorization is temporarily unavailable.' }, 503, origin);
  }
  if (!result.response.ok || !result.payload.access_token) {
    return json({ code: 'exchange_failed', message: 'Google could not complete authorization.' }, 400, origin);
  }
  if (!result.payload.refresh_token) {
    return json({
      code: 'persistent_connection_unavailable',
      message: 'Google did not return a persistent connection. Remove Nautilus Log from Google permissions and try again.',
    }, 409, origin);
  }

  const connection = await createConnection({ refreshToken: result.payload.refresh_token, env });
  return json({
    connection,
    accessToken: result.payload.access_token,
    expiresIn: Number(result.payload.expires_in) || 0,
    tokenType: result.payload.token_type || 'Bearer',
  }, 200, origin);
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
  if (request.method === 'GET' && url.pathname === '/health') {
    return json({ ok: true, service: 'nautilus-google-auth' });
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
    if (request.method === 'POST' && url.pathname === '/exchange') return exchange(request, env, origin);
    if (request.method === 'POST' && url.pathname === '/token') return refreshToken(request, env, origin);
    if (request.method === 'POST' && url.pathname === '/disconnect') return disconnect(request, env, origin);
    return json({ code: 'not_found', message: 'Not found.' }, 404, origin);
  } catch (_error) {
    return json({ code: 'service_error', message: 'Google Calendar connection failed.' }, 500, origin);
  }
}

export default { fetch: handleRequest };
