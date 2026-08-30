CREATE TABLE IF NOT EXISTS oauth_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  secret_hash TEXT NOT NULL,
  origin TEXT NOT NULL,
  nonce TEXT NOT NULL,
  result_iv TEXT,
  result_ciphertext TEXT,
  connection_id TEXT,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS oauth_sessions_expires_at
  ON oauth_sessions (expires_at);
