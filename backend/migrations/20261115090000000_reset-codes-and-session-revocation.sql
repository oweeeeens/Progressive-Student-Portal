-- Up Migration

-- 1. Password reset by a 6-digit emailed CODE instead of a link.
--
-- A link had to be opened on the device that received the email; a code is
-- typed on whichever device the person is already using. The same table
-- holds it (only a keyed hash, never the code itself — utils/password.js),
-- with two changes:
--
--   failed_attempts  A 6-digit code has a million possible values, so it is
--                    only safe if guessing is cut off. The code is burned
--                    (used_at set) after RESET_CODE_MAX_ATTEMPTS wrong tries
--                    — see passwordResetTokenModel.recordFailedAttempt.
--   token_hash UNIQUE dropped. A 256-bit link token never repeats; a code
--                    may legitimately come round again over time, and its
--                    hash is looked up by user_id, never on its own.
--
-- Every link token still outstanding is retired: the reset page no longer
-- accepts links, so leaving them "unused" would only mislead.
ALTER TABLE password_reset_tokens ADD COLUMN failed_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE password_reset_tokens DROP CONSTRAINT IF EXISTS password_reset_tokens_token_hash_key;
UPDATE password_reset_tokens SET used_at = now() WHERE used_at IS NULL;

-- 2. "Remember me" now issues a 30-day sign-in token, so a password change
-- must be able to end older sessions — otherwise a session on a lost phone
-- would outlive the very password reset meant to lock it out.
-- authMiddleware refuses any token issued before this moment. TIMESTAMPTZ
-- (an absolute instant) because it is compared with a JWT's `iat`, which is
-- UTC seconds; NULL for every existing account, so nobody is signed out by
-- deploying this.
ALTER TABLE users ADD COLUMN password_changed_at TIMESTAMPTZ;

-- Down Migration

ALTER TABLE users DROP COLUMN password_changed_at;
-- Codes cannot satisfy the old UNIQUE (they may repeat), and none of them is
-- redeemable as a link anyway.
DELETE FROM password_reset_tokens;
ALTER TABLE password_reset_tokens ADD CONSTRAINT password_reset_tokens_token_hash_key UNIQUE (token_hash);
ALTER TABLE password_reset_tokens DROP COLUMN failed_attempts;
