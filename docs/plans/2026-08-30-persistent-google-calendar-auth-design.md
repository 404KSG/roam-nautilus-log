# Persistent Google Calendar authorization

## Outcome

Nautilus Log owns the Google OAuth application. A user enables the optional
calendar feature, clicks the Blueprint Calendar control once, chooses a Google
account, and normally remains connected across Roam reloads. Users never create
or paste OAuth client IDs or calendar IDs.

Calendar sync remains read-only, user initiated, and scoped to the date of the
clicked Nautilus Plan. Persisting authorization must not introduce background
calendar polling.

## User flow

1. Google Calendar is disabled by default.
2. Enabling it reveals the existing Calendar control, but no developer fields.
3. The first Calendar click opens Google's account/consent flow and then
   continues the requested sync automatically.
4. A later Roam load exchanges the saved opaque connection credential for a
   short-lived access token once. The token remains in memory.
5. Calendar API calls still happen only when the user clicks sync.
6. Revoked or invalid credentials return the control to the disconnected state;
   the next click reconnects. Option-click retains the current Google-first
   managed-field refresh semantics.

Primary Calendar is the safe default. Existing hidden calendar selections are
preserved for migration, but the public settings panel no longer exposes raw
IDs. Named multi-calendar selection can be added as a separate lightweight
manager after the connection flow is verified.

## Architecture

The extension opens a same-purpose Nautilus authorization service. The service
uses Google's authorization-code flow with offline access and owns the OAuth
client secret. It exchanges the callback code, encrypts the refresh token at
rest, and returns an opaque connection ID and secret to the extension. The
extension stores only that opaque credential in extension settings.

On load or before a sync, the extension presents the opaque credential to the
service. The service validates it, refreshes Google access, and returns only a
short-lived access token. Calendar REST calls continue directly from the Roam
client; event data never passes through the authorization service.

The service exposes only:

- `GET /connect`: create an expiring OAuth session and redirect to Google;
- `GET /oauth/callback`: exchange the code and finish the session;
- `POST /session`: poll an expiring session from the initiating Roam client;
- `POST /token`: obtain a short-lived Google access token;
- `POST /disconnect`: revoke and delete one connection;
- `GET /health`: deployment diagnostics without secrets.

Session and connection secrets are high entropy and compared by SHA-256 hash.
Refresh tokens are AES-GCM encrypted with a deployment secret. CORS is limited
to approved Roam origins. Session records expire after ten minutes.

## Failure and privacy contract

- Popup cancellation leaves the graph and prior connection unchanged.
- A failed silent refresh does not read Calendar data and surfaces a reconnect
  title on the existing Calendar control.
- No OAuth client secret, refresh token, access token, calendar event, email, or
  Calendar ID is written into Roam blocks.
- The authorization service logs no tokens, authorization codes, descriptions,
  titles, attendees, or locations.
- Disconnect revokes the Google refresh token when possible and deletes the
  service-side connection even if revocation is unavailable.
- The service URL is a build-owned constant, not a user setting.

## Performance contract

- Disabled: zero network work and no Google script.
- Enabled but never connected: zero startup network work.
- Connected startup: one token refresh request.
- Calendar reads: only on an explicit Calendar click.
- No interval, calendar polling, DOM observer, or render-loop work is added.

## Verification

- Unit-test session proof validation, token encryption, connection
  authentication, CORS, callback failure, refresh, and disconnect.
- Unit-test extension credential migration, popup/poll flow, silent restore,
  revoked-session fallback, and the absence of public Client ID fields.
- Run the full extension build and test suite.
- Deploy with separate Google OAuth and service environments for test and
  production, then exercise browser and Roam Desktop popup flows.
- Keep the Roam Depot PR in Draft until Google production credentials, privacy
  policy, deployment health, and real-account regression all pass.
