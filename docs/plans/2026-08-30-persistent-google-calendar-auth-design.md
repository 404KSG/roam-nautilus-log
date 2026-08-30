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

The extension uses Google Identity Services `initCodeClient` in popup mode.
Google returns a one-time authorization code only to the callback running in
the initiating Roam origin. The extension sends that code to the Nautilus
authorization service with an AJAX-only cross-origin request. The service owns
the OAuth client secret, exchanges the code using the validated Roam origin as
`redirect_uri`, encrypts the refresh token at rest, and returns an opaque
connection ID and secret. The extension stores only that opaque credential in
extension settings.

This origin-bound code delivery is the authentication boundary. A public link,
spoofable polling session, or CORS header alone is never treated as proof that
the request came from the initiating Roam client.

On load or before a sync, the extension presents the opaque credential to the
service. The service validates it, refreshes Google access, and returns only a
short-lived access token. Calendar REST calls continue directly from the Roam
client; event data never passes through the authorization service.

The service exposes only:

- `GET /config`: return the public Google OAuth client ID to an approved Roam
  origin;
- `POST /exchange`: exchange one GIS popup code and create a connection;
- `POST /token`: obtain a short-lived Google access token;
- `POST /disconnect`: revoke and delete one connection;
- `GET /health`: deployment diagnostics without secrets.

Connection secrets are high entropy and compared by SHA-256 hash. Refresh
tokens are AES-GCM encrypted with a deployment secret and stored in D1 rather
than eventually consistent KV. CORS is limited to approved Roam origins, and
code exchange requires the custom header recommended by Google's popup code
model.

## Failure and privacy contract

- Popup cancellation leaves the graph and prior connection unchanged.
- Extension unload or disconnect aborts in-flight network work and prevents a
  late popup callback from persisting a connection.
- A failed silent refresh does not read Calendar data and surfaces a reconnect
  title on the existing Calendar control.
- No OAuth client secret, refresh token, access token, account email, or hidden
  Calendar ID is written into Roam blocks. Imported event content is written
  only by the explicit sync described in the product contract.
- The authorization service logs no tokens, authorization codes, descriptions,
  titles, attendees, or locations.
- Disconnect revokes the Google refresh token when possible and deletes the
  service-side connection even if revocation is unavailable.
- Temporary Google 429/5xx failures preserve the connection. Only a revoked or
  invalid grant returns to the disconnected state.
- The service URL is a build-owned constant, not a user setting.

## Performance contract

- Disabled: zero network work and no Google script.
- Enabled but never connected: one public config request and one cached Google
  Identity script load so the first user click can open the popup reliably.
- Connected startup: one token refresh request.
- Calendar reads: only on an explicit Calendar click.
- No interval, calendar polling, DOM observer, or render-loop work is added.

## Verification

- Unit-test token encryption, connection authentication, CORS, code exchange,
  transient refresh, invalid-grant cleanup, and disconnect.
- Unit-test extension credential migration, GIS popup flow, silent restore,
  startup/click races, unload cancellation, revoked fallback, and the absence
  of public Client ID fields.
- Run the full extension build and test suite.
- Deploy with separate Google OAuth and service environments for test and
  production, then exercise browser and Roam Desktop popup flows.
- Keep the Roam Depot PR in Draft until Google production credentials, privacy
  policy, deployment health, and real-account regression all pass.
