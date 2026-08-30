# Persistent Google Calendar authorization

## Outcome

Nautilus Log owns the Google OAuth application. A user clicks **Connect** in
settings, chooses a Google account, and normally remains connected across Roam
reloads. Users never create or paste OAuth client IDs or calendar IDs.

Calendar sync remains read-only, user initiated, and scoped to the date of the
clicked Nautilus Plan. Persisting authorization must not introduce background
calendar polling.

## User flow

1. Google Calendar reports **Not connected** by default.
2. **Connect** opens Google's account/consent flow and changes the settings row
   to a visible connected state on success.
3. The Calendar control appears only after connection and syncs the explicitly
   clicked Nautilus date.
4. A later Roam load exchanges the saved opaque connection credential for a
   short-lived access token once. The token remains in memory.
5. Calendar API calls still happen only when the user clicks sync.
6. Revoked or invalid credentials return settings to the disconnected state;
   **Connect** starts recovery. Option-click retains the current Google-first
   managed-field refresh semantics.

Primary Calendar is the safe default. Existing hidden calendar selections are
preserved for migration, but the public settings panel no longer exposes raw
IDs. Named multi-calendar selection can be added as a separate lightweight
manager after the connection flow is verified.

## Architecture

The extension opens the Nautilus authorization service's `/authorize` endpoint
in a popup. The service validates the initiating Roam origin and nonce, signs a
short-lived state value, and redirects to Google. Google returns its one-time
authorization code only to the service's exact HTTPS `/oauth/callback`. The
service owns the OAuth client secret, exchanges the code, encrypts the refresh
token at rest, and posts an opaque connection ID and secret back to the exact
initiating Roam origin. The extension stores only that opaque credential in
extension settings.

The signed state, exact callback, nonce, and origin-bound `postMessage` delivery
form the authentication boundary. A public link, spoofable polling session, or
CORS header alone is never treated as proof that the request came from the
initiating Roam client.

On load or before a sync, the extension presents the opaque credential to the
service. The service validates it, refreshes Google access, and returns only a
short-lived access token. Calendar REST calls continue directly from the Roam
client; event data never passes through the authorization service.

The service exposes only:

- `GET /config`: return the hosted authorization URL to an approved Roam origin;
- `GET /authorize`: validate and sign one short-lived connection request;
- `GET /oauth/callback`: exchange Google's code and return one opaque connection
  to the initiating Roam origin;
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

- Disconnected: zero network work and no Google script.
- Connect: one public config request followed by the hosted Google popup.
- Connected startup: one token refresh request.
- Calendar reads: only on an explicit Calendar click.
- No interval, calendar polling, DOM observer, or render-loop work is added.

## Verification

- Unit-test token encryption, connection authentication, CORS, code exchange,
  transient refresh, invalid-grant cleanup, and disconnect.
- Unit-test extension credential migration, hosted popup flow, silent restore,
  startup/click races, unload cancellation, revoked fallback, and the absence
  of public Client ID fields.
- Run the full extension build and test suite.
- Deploy with separate Google OAuth and service environments for test and
  production, then exercise browser and Roam Desktop popup flows.
- Keep the Roam Depot PR in Draft until Google production credentials, privacy
  policy, deployment health, and real-account regression all pass.
