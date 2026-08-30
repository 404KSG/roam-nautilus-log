export const GOOGLE_AUTH_SERVICE_URL = 'https://nautilus-auth.kidsseeghosts.art';

const GOOGLE_IDENTITY_SCRIPT = 'https://accounts.google.com/gsi/client';
const GOOGLE_IDENTITY_PROMISE_KEY = '__nautilusGoogleIdentityPromise';
const GOOGLE_CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events.readonly',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
].join(' ');

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

function loadGoogleIdentity(windowImpl) {
  const oauth2 = windowImpl?.google?.accounts?.oauth2;
  if (oauth2?.initCodeClient) return Promise.resolve(oauth2);
  if (!windowImpl?.document?.head) {
    return Promise.reject(new Error('Google authorization requires a browser window.'));
  }
  if (windowImpl[GOOGLE_IDENTITY_PROMISE_KEY]) {
    return windowImpl[GOOGLE_IDENTITY_PROMISE_KEY];
  }

  windowImpl[GOOGLE_IDENTITY_PROMISE_KEY] = new Promise((resolve, reject) => {
    const existing = windowImpl.document.querySelector?.(`script[src="${GOOGLE_IDENTITY_SCRIPT}"]`);
    const script = existing || windowImpl.document.createElement('script');
    const finish = () => {
      const loaded = windowImpl?.google?.accounts?.oauth2;
      if (loaded?.initCodeClient) resolve(loaded);
      else reject(new Error('Google authorization could not load.'));
    };
    const fail = () => reject(new Error('Google authorization could not load.'));
    script.addEventListener?.('load', finish, { once: true });
    script.addEventListener?.('error', fail, { once: true });
    if (!existing) {
      script.src = GOOGLE_IDENTITY_SCRIPT;
      script.async = true;
      script.defer = true;
      script.referrerPolicy = 'no-referrer';
      windowImpl.document.head.appendChild(script);
    }
  }).catch((error) => {
    delete windowImpl[GOOGLE_IDENTITY_PROMISE_KEY];
    throw error;
  });
  return windowImpl[GOOGLE_IDENTITY_PROMISE_KEY];
}

export function createPersistentGoogleAuthClient({
  serviceUrl = GOOGLE_AUTH_SERVICE_URL,
  loadConnection = () => null,
  saveConnection = async () => {},
  clearConnection = async () => {},
  fetchImpl = typeof fetch === 'function' ? fetch.bind(globalThis) : null,
  windowImpl = typeof window !== 'undefined' ? window : null,
  identityLoader = () => loadGoogleIdentity(windowImpl),
  now = Date.now,
  onConnectionChange = () => {},
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('Google Calendar authorization requires Fetch.');
  const baseUrl = normalizeServiceUrl(serviceUrl);
  let accessToken = '';
  let accessExpiresAt = 0;
  let refreshRequest = null;
  let connectRequest = null;
  let identityRequest = null;
  let clientIdRequest = null;
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
    if (!clientIdRequest) {
      const expectedGeneration = generation;
      clientIdRequest = requestJson('/config', null, { method: 'GET', expectedGeneration })
        .then((payload) => {
          const clientId = String(payload?.clientId || '').trim();
          if (!clientId) throw new Error('Google authorization is not configured.');
          return clientId;
        })
        .catch((error) => {
          clientIdRequest = null;
          throw error;
        });
    }
    if (!identityRequest) {
      identityRequest = Promise.resolve().then(identityLoader).catch((error) => {
        identityRequest = null;
        throw error;
      });
    }
    const [clientId, oauth2] = await Promise.all([clientIdRequest, identityRequest]);
    assertActive();
    return { clientId, oauth2 };
  };

  const connect = async () => {
    assertActive();
    if (connectRequest) return connectRequest;
    const expectedGeneration = generation;
    connectRequest = (async () => {
      const { clientId, oauth2 } = await prepareIdentity();
      assertActive(expectedGeneration);
      return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (handler, value) => {
          if (settled) return;
          settled = true;
          pendingConnectReject = null;
          handler(value);
        };
        pendingConnectReject = (error) => finish(reject, error);

        const callback = async (response = {}) => {
          if (settled) return;
          if (response.error || !response.code) {
            finish(reject, new Error(response.error_description || response.error || 'Google authorization was cancelled.'));
            return;
          }
          try {
            assertActive(expectedGeneration);
            const result = await requestJson('/exchange', { code: response.code }, { expectedGeneration });
            const connection = parseCalendarConnection(result.connection);
            if (!connection || !result.accessToken) {
              throw new Error('Google authorization returned an invalid connection.');
            }
            assertActive(expectedGeneration);
            await saveConnection(connection);
            if (destroyed || expectedGeneration !== generation) {
              await clearConnection();
              assertActive(expectedGeneration);
            }
            accessToken = result.accessToken;
            accessExpiresAt = Number(now()) + Math.max(0, Number(result.expiresIn) || 0) * 1000;
            onConnectionChange(true);
            finish(resolve, accessToken);
          } catch (error) {
            finish(reject, error);
          }
        };

        try {
          const codeClient = oauth2.initCodeClient({
            client_id: clientId,
            scope: GOOGLE_CALENDAR_SCOPES,
            ux_mode: 'popup',
            callback,
            error_callback: (error = {}) => {
              const message = error.type === 'popup_failed_to_open'
                ? 'Google authorization popup was blocked.'
                : 'Google authorization was cancelled.';
              finish(reject, new Error(message));
            },
          });
          codeClient.requestCode();
        } catch (error) {
          finish(reject, error);
        }
      });
    })();
    try {
      return await connectRequest;
    } finally {
      connectRequest = null;
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
    refreshRequest = (async () => {
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
    try {
      return await refreshRequest;
    } finally {
      refreshRequest = null;
    }
  };

  const authorize = async ({ interactive = true } = {}) => {
    assertActive();
    if (hasUsableAccessToken()) return accessToken;
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
