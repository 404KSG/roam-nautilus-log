# Nautilus Log OAuth service

This Cloudflare Worker exchanges Google authorization codes and refreshes
short-lived access tokens for Nautilus Log. Calendar event data never passes
through this service.

Required Worker secrets:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `OAUTH_STATE_SECRET` (32 random bytes encoded as base64url)
- `TOKEN_ENCRYPTION_KEY` (32 random bytes encoded as base64url)

Required configuration:

- a D1 database bound as `NAUTILUS_AUTH_DB`, with the checked-in migrations
  applied;
- one exact `/oauth/callback` URL registered as an authorized redirect URI on
  the Google Web OAuth client;
- Google Calendar API and Google Tasks API enabled, with the two Calendar
  read-only scopes plus `tasks.readonly` configured on the consent screen;
- `ALLOWED_ORIGINS=https://roamresearch.com`;
- `GOOGLE_OAUTH_REDIRECT_URI` set to that same exact registered callback URL.

The current production rollout keeps the already registered Preview callback
as a narrow migration alias. Production signs its state with
`OAUTH_ISSUER=production`; Preview recognizes only that routing marker and
forwards `code`, `state`, or `error` to the fixed production callback configured
by `OAUTH_CALLBACK_FORWARD_URL`. Production then performs the normal HMAC state
verification and token exchange. The marker never supplies a destination, and
ordinary Preview callbacks stay in Preview. Users and the extension connect
only to the production service URL.

Browser Roam opens the Worker's `/authorize` endpoint in a popup and receives
the result through origin-bound `postMessage`. Roam Desktop creates a
secret-bound `/desktop/session`, opens the real Google URL in the system
browser, and polls `/desktop/session/result` only while authorization is in
progress. Desktop handoff results are encrypted, expire after ten minutes, and
are deleted as soon as Roam retrieves them. Calendar event data never passes
through the Worker.

Use separate Worker deployments, D1 databases, and encryption keys for Preview
and production. A callback-domain migration may temporarily share one Google
OAuth client, but the credential stores and connection services remain
isolated. Never commit secret values.

Production also serves the public app homepage, privacy policy, and terms at
`/`, `/privacy`, and `/terms`. These documents describe the deployed data flow
and provide stable Google OAuth branding URLs without adding another runtime.

Typical deployment order:

1. Create the D1 database and replace the placeholder database ID in
   `wrangler.toml`.
2. Apply `wrangler d1 migrations apply nautilus-log-auth --remote`.
3. Add all four Worker secrets with `wrangler secret put`.
4. Deploy the Worker and publish the production OAuth app. If a callback alias
   is used during a domain migration, deploy and test both ends before switching
   the extension service URL.
5. Verify `/health`, `/config` from an allowed origin, a real browser popup,
   Roam Desktop, reload restoration, and disconnect before publishing.

Keep D1 read replication disabled for this small credential database. If it is
enabled later, the Worker must adopt D1 Sessions/bookmarks so token restore and
disconnect retain read-your-writes semantics.
