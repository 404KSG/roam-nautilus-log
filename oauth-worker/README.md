# Nautilus Log OAuth service

This Cloudflare Worker exchanges Google authorization codes and refreshes
short-lived access tokens for Nautilus Log. Calendar event data never passes
through this service.

Required Worker secrets:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `TOKEN_ENCRYPTION_KEY` (32 random bytes encoded as base64url)

Required configuration:

- a KV namespace bound as `NAUTILUS_AUTH`;
- `PUBLIC_BASE_URL` matching the Worker custom domain;
- the same `PUBLIC_BASE_URL/oauth/callback` registered as the Google Web OAuth
  redirect URI;
- `ALLOWED_ORIGINS=https://roamresearch.com`.

Use separate Google Cloud projects, Worker deployments, KV namespaces, and
encryption keys for preview and production. Never commit secret values.
