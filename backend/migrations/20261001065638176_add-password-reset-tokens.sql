-- Up Migration

-- Self-service forgot-password tokens. Stores only a SHA-256 hash of the
-- token, never the raw value — the raw token only ever exists in the email
-- link and the brief request/response around issuing it, same reasoning as
-- never storing a plaintext password. ON DELETE CASCADE here is a
-- deliberate exception to this app's usual ON DELETE RESTRICT convention:
-- unlike academic records, a reset token has no audit-trail value once its
-- user is gone.
CREATE TABLE password_reset_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE, -- sha256 hex digest
  expires_at TIMESTAMP NOT NULL,
  used_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX idx_password_reset_tokens_user_id ON password_reset_tokens(user_id);

-- Down Migration

DROP TABLE password_reset_tokens;
