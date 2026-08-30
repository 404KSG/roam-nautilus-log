CREATE TABLE IF NOT EXISTS oauth_connections (
  id TEXT PRIMARY KEY NOT NULL,
  secret_hash TEXT NOT NULL,
  refresh_token_iv TEXT NOT NULL,
  refresh_token_ciphertext TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
