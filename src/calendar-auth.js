export const GOOGLE_AUTH_SERVICE_URL = 'https://nautilus-auth.kidsseeghosts.art';

const OAUTH_MESSAGE_TYPE = 'nautilus-google-oauth-v1';

function normalizeServiceUrl(value) {
  const url = new URL(String(value || ''));
  if (url.protocol !== 'https:' && url.hostname !== 'localhost') {
    throw new Error('Google Calendar authorization requires HTTPS.');
  }
  return url.href.replace(/\/$/, '');
}

export function parseCalendarConnection(value) {
  if (!value) return null;
  let candidate = value;
  if (typeof candidate === 'string') {
    try {
      candidate = JSON.parse(candidate);
    } catch (_error) {
      return null;
    }
  }
  if (!candidate || typeof candidate !== 'object') return null;
  const id = String(candidate.id || '').trim();
  const secret = String(candidate.secret || '').trim();
  if (!id || !secret) return null;
  return { version: 1, id, secret };
}

function serviceError(payload, response, fallback) {
  const error = new Error(payload?.message || payload?.error || fallback);
  error.code = payload?.code || '';
  error.status = Number(response?.status) || 0;
  return error;
}

function randomNonce(windowImpl) {
  const cryptoImpl = windowImpl?.crypto || globalThis.crypto;
  if (!cryptoImpl?.getRandomValues) throw new Error('Google authorization requires secure randomness.');
  const bytes = new Uint8Array(24);
  cryptoImpl.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

export function createPersistentGoogleAuthClient({
  serviceUrl = GOOGLE_AUTH_SERVICE_URL,
  loadConnection = () => null,
  saveConnection = async () => {},
  clearConnection = async () => {},
  fetchImpl = typeof fetch === 'function' ? fetch.bind(globalThis) : null,
  windowImpl = typeof window !== 'undefined' ? window : null,
  popupOpen = (url) => windowImpl?.open?.(
    url,
    'nautilus-google-calendar-oauth',
    'popup=yes,width=520,height=680,resizable=yes,scrollbars=yes',
  ),
  now = Date.now,
  onConnectionChange = () => {},
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('Google Calendar authorization requires Fetch.');
  const baseUrl = normalizeServiceUrl(serviceUrl);
  let accessToken = '';
  let accessExpiresAt = 0;
  let refreshRequest = null;
  let connectRequest = null;
  let configRequest = null;
  let pendingConnectReject = null;
  let destroyed = false;
  let generation = 0;
  const activeRequests = new Set();

  const assertActive = (expectedGeneration = generation) => {
    if (destroyed || expectedGeneration !== generation) {
      const error = new Error('Google Calendar authorization was cancelled.');
      error.code = 'authorization_cancelled';
      throw error;
    }
  };

  const hasUsableAccessToken = () => (
    Boolean(accessToken) && Number(now()) < accessExpiresAt - 30_000
  );

  const requestJson = async (path, body, { method = 'POST', expectedGeneration = generation } = {}) => {
    assertActive(expectedGeneration);
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    if (controller) activeRequests.add(controller);
    try {
      const headers = { Accept: 'application/json' };
      const options = {
        method,
        headers,
        credentials: 'omit',
        signal: controller?.signal,
      };
      if (method !== 'GET') {
        headers['Content-Type'] = 'application/json';
        headers['X-Requested-With'] = 'XmlHttpRequest';
        options.body = JSON.stringify(body || {});
      }
      const response = await fetchImpl(`${baseUrl}${path}`, options);
      const payload = await response.json().catch(() => ({}));
      assertActive(expectedGeneration);
      if (!response.ok) throw serviceError(payload, response, 'Google Calendar connection failed.');
      return payload;
    } finally {
      if (controller) activeRequests.delete(controller);
    }
  };

  const forgetConnection = async () => {
    accessToken = '';
    accessExpiresAt = 0;
    await clearConnection();
    onConnectionChange(false);
  };

  const prepareIdentity = async () => {
    assertActive();
    if (!configRequest) {
      const expectedGeneration = generation;
      configRequest = requestJson('/config', null, { method: 'GET', expectedGeneration })
        .then((payload) => {
          const authorizeUrl = String(payload?.authorizeUrl || '').trim();
          const parsed = new URL(authorizeUrl);
          if (parsed.protocol !== 'https:') throw new Error('Google authorization is not configured.');
          return { authorizeUrl: parsed.href, serviceOrigin: parsed.origin };
        })
        .catch((error) => {
          configRequest = null;
          throw error;
        });
    }
    const config = await configRequest;
    assertActive();
    return config;
  };

  const connect = async () => {
    assertActive();
    if (connectRequest) return connectRequest;
    const expectedGeneration = generation;
    const request = (async () => {
      const popup = popupOpen('about:blank');
      if (!popup) throw new Error('Google authorization popup was blocked.');
      let config;
      try {
        config = await prepareIdentity();
        assertActive(expectedGeneration);
      } catch (error) {
        popup.close?.();
        throw error;
      }
      return new Promise((resolve, reject) => {
        let settled = false;
        let closeTimer = null;
        const nonce = randomNonce(windowImpl);
        const cleanup = () => {
          windowImpl?.removeEventListener?.('message', onMessage);
          if (closeTimer !== null) {
            (windowImpl?.clearInterval || clearInterval)(closeTimer);
            closeTimer = null;
          }
        };
        const finish = (handler, value) => {
          if (settled) return;
          settled = true;
          cleanup();
          pendingConnectReject = null;
          popup.close?.();
          handler(value);
        };
        pendingConnectReject = (error) => finish(reject, error);

        const onMessage = async (event = {}) => {
          if (settled || event.origin !== config.serviceOrigin) return;
          const response = event.data;
          if (!response || response.type !== OAUTH_MESSAGE_TYPE || response.nonce !== nonce) return;
          if (response.error) return finish(reject, new Error(response.error));
          try {
            assertActive(expectedGeneration);
            const connection = parseCalendarConnection(response.connection);
            if (!connection || !response.accessToken) {
              throw new Error('Google authorization returned an invalid connection.');
            }
            assertActive(expectedGeneration);
            await saveConnection(connection);
            if (destroyed || expectedGeneration !== generation) {
              await clearConnection();
              assertActive(expectedGeneration);
            }
            accessToken = response.accessToken;
            accessExpiresAt = Number(now()) + Math.max(0, Number(response.expiresIn) || 0) * 1000;
            onConnectionChange(true);
            finish(resolve, accessToken);
          } catch (error) {
            finish(reject, error);
          }
        };

        try {
          windowImpl?.addEventListener?.('message', onMessage);
          const authorizeUrl = new URL(config.authorizeUrl);
          authorizeUrl.searchParams.set('origin', windowImpl?.location?.origin || '');
          authorizeUrl.searchParams.set('nonce', nonce);
          if (popup.location?.replace) popup.location.replace(authorizeUrl.href);
          else popup.location = authorizeUrl.href;
          closeTimer = (windowImpl?.setInterval || setInterval)(() => {
            if (popup.closed) finish(reject, new Error('Google authorization was cancelled.'));
          }, 300);
        } catch (error) {
          finish(reject, error);
        }
      });
    })();
    connectRequest = request;
    try {
      return await request;
    } finally {
      if (connectRequest === request) connectRequest = null;
    }
  };

  const refresh = async (connection, expectedGeneration = generation) => {
    const payload = await requestJson('/token', {
      connectionId: connection.id,
      connectionSecret: connection.secret,
    }, { expectedGeneration });
    if (!payload.accessToken) throw new Error('Google authorization returned no access token.');
    accessToken = payload.accessToken;
    accessExpiresAt = Number(now()) + Math.max(0, Number(payload.expiresIn) || 0) * 1000;
    onConnectionChange(true);
    return accessToken;
  };

  const restore = async () => {
    if (refreshRequest) return refreshRequest;
    const expectedGeneration = generation;
    const request = (async () => {
      const connection = parseCalendarConnection(await loadConnection());
      if (!connection) return '';
      try {
        return await refresh(connection, expectedGeneration);
      } catch (error) {
        if (![401, 404].includes(error?.status) && error?.code !== 'reconnect_required') throw error;
        assertActive(expectedGeneration);
        await forgetConnection();
        return '';
      }
    })();
    refreshRequest = request;
    try {
      return await request;
    } finally {
      if (refreshRequest === request) refreshRequest = null;
    }
  };

  const authorize = async ({ interactive = true } = {}) => {
    assertActive();
    if (hasUsableAccessToken()) return accessToken;
    const currentConnection = loadConnection();
    if (!currentConnection?.then && !parseCalendarConnection(currentConnection)) {
      return interactive ? connect() : '';
    }
    const restored = await restore();
    if (restored || !interactive) return restored;
    return connect();
  };

  const prepare = async () => Boolean(await authorize({ interactive: false }));

  const invalidateAccessToken = () => {
    accessToken = '';
    accessExpiresAt = 0;
  };

  const cancelActiveWork = () => {
    generation += 1;
    for (const controller of activeRequests) controller.abort();
    activeRequests.clear();
    const error = new Error('Google Calendar authorization was cancelled.');
    error.code = 'authorization_cancelled';
    pendingConnectReject?.(error);
    pendingConnectReject = null;
    refreshRequest = null;
    connectRequest = null;
  };

  const disconnect = async () => {
    assertActive();
    cancelActiveWork();
    const expectedGeneration = generation;
    const connection = parseCalendarConnection(await loadConnection());
    if (connection) {
      try {
        await requestJson('/disconnect', {
          connectionId: connection.id,
          connectionSecret: connection.secret,
        }, { expectedGeneration });
      } catch (error) {
        if (![401, 404].includes(error?.status)) throw error;
      }
    }
    assertActive(expectedGeneration);
    await forgetConnection();
    return true;
  };

  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    cancelActiveWork();
    accessToken = '';
    accessExpiresAt = 0;
  };

  return {
    authorize,
    connect,
    prepare,
    prepareIdentity,
    disconnect,
    invalidateAccessToken,
    hasConnection: async () => Boolean(parseCalendarConnection(await loadConnection())),
    destroy,
  };
}
