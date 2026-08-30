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
- the Worker's exact `/oauth/callback` URL registered as an authorized redirect
  URI on the Google Web OAuth client;
- Google Calendar API enabled and the two read-only Calendar scopes configured
  on the consent screen;
- `ALLOWED_ORIGINS=https://roamresearch.com`;
- `GOOGLE_OAUTH_REDIRECT_URI` set to the same exact Worker callback URL.

Browser Roam opens the Worker's `/authorize` endpoint in a popup and receives
the result through origin-bound `postMessage`. Roam Desktop creates a
secret-bound `/desktop/session`, opens the real Google URL in the system
browser, and polls `/desktop/session/result` only while authorization is in
progress. Desktop handoff results are encrypted, expire after ten minutes, and
are deleted as soon as Roam retrieves them. Calendar event data never passes
through the Worker.

Use separate Google Cloud projects, Worker deployments, D1 databases, and
encryption keys for preview and production. Never commit secret values.

Typical deployment order:

1. Create the D1 database and replace the placeholder database ID in
   `wrangler.toml`.
2. Apply `wrangler d1 migrations apply nautilus-log-auth --remote`.
3. Add all four Worker secrets with `wrangler secret put`.
4. Deploy the Worker and attach the production custom domain.
5. Verify `/health`, `/config` from an allowed origin, a real browser popup,
   Roam Desktop, reload restoration, and disconnect before publishing.

Keep D1 read replication disabled for this small credential database. If it is
enabled later, the Worker must adopt D1 Sessions/bookmarks so token restore and
disconnect retain read-your-writes semantics.
