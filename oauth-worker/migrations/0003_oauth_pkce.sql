ALTER TABLE oauth_sessions ADD COLUMN pkce_verifier_iv TEXT;
ALTER TABLE oauth_sessions ADD COLUMN pkce_verifier_ciphertext TEXT;
ALTER TABLE oauth_sessions ADD COLUMN consumed_at INTEGER;
