# Nautilus Log OAuth service

This Cloudflare Worker exchanges Google authorization codes and refreshes
short-lived access tokens for Nautilus Log. Calendar event data never passes
through this service.

Required Worker secrets:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `TOKEN_ENCRYPTION_KEY` (32 random bytes encoded as base64url)

Required configuration:

- a D1 database bound as `NAUTILUS_AUTH_DB`, with the checked-in migrations
  applied;
- `https://roamresearch.com` registered as an authorized JavaScript origin on
  the Google Web OAuth client;
- Google Calendar API enabled and the two read-only Calendar scopes configured
  on the consent screen;
- `ALLOWED_ORIGINS=https://roamresearch.com`.

The popup code model returns the one-time code to the initiating Roam page.
`POST /exchange` uses the validated request origin as Google's `redirect_uri`;
there is no public callback or polling endpoint.

Use separate Google Cloud projects, Worker deployments, D1 databases, and
encryption keys for preview and production. Never commit secret values.

Typical deployment order:

1. Create the D1 database and replace the placeholder database ID in
   `wrangler.toml`.
2. Apply `wrangler d1 migrations apply nautilus-log-auth --remote`.
3. Add all three Worker secrets with `wrangler secret put`.
4. Deploy the Worker and attach the production custom domain.
5. Verify `/health`, `/config` from an allowed origin, a real browser popup,
   Roam Desktop, reload restoration, and disconnect before publishing.

Keep D1 read replication disabled for this small credential database. If it is
enabled later, the Worker must adopt D1 Sessions/bookmarks so token restore and
disconnect retain read-your-writes semantics.
