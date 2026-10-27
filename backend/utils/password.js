// Wraps bcrypt so hashing/verification logic lives in exactly one place —
// nothing outside this file should touch a raw password or call bcrypt directly.
const crypto = require('crypto');
const { devOnlyFlag } = require('../config/environment');
const bcrypt = require('bcryptjs');
const { BCRYPT_SALT_ROUNDS } = require('../config/auth');

function hashPassword(plainTextPassword) {
  return bcrypt.hash(plainTextPassword, BCRYPT_SALT_ROUNDS);
}

function verifyPassword(plainTextPassword, passwordHash) {
  return bcrypt.compare(plainTextPassword, passwordHash);
}

// Charset excludes visually-ambiguous characters (0/O, 1/l/I) since this is
// meant to be read off a screen and typed in by hand on first login.
const TEMP_PASSWORD_CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';
const TEMP_PASSWORD_LENGTH = 12;

// Used for admin/registrar-created staff and student accounts — all force a
// password change on first login (see authMiddleware.js), so this only needs
// to get the user in the door once, not be memorable.
//
// DEV_PLACEHOLDER_PASSWORD (optional, backend/.env) returns a fixed string
// instead of a random one, purely so you are not retyping a different random
// string for every account while building or demoing.
//
// It is REFUSED on a production deployment, because the consequence there is
// that every account created and every password reset shares one known
// string — the kind of thing that is only ever discovered afterwards. It used
// to be guarded by a sentence in DEPLOYMENT.md; now config/environment.js
// enforces it and warns at boot either way.
const placeholderPassword = devOnlyFlag('DEV_PLACEHOLDER_PASSWORD', Boolean(process.env.DEV_PLACEHOLDER_PASSWORD))
  ? process.env.DEV_PLACEHOLDER_PASSWORD
  : null;

function generateTempPassword() {
  if (placeholderPassword) {
    return placeholderPassword;
  }

  const bytes = crypto.randomBytes(TEMP_PASSWORD_LENGTH);
  let password = '';
  for (let i = 0; i < TEMP_PASSWORD_LENGTH; i++) {
    password += TEMP_PASSWORD_CHARSET[bytes[i] % TEMP_PASSWORD_CHARSET.length];
  }
  return password;
}

// Forgot-password reset tokens. The raw token goes out in the email link and
// is held only briefly in memory; only its SHA-256 hash is ever persisted
// (see password_reset_tokens table) — same reasoning as never storing a
// plaintext password. SHA-256 (fast, deterministic) rather than bcrypt here
// on purpose: this needs an exact-match DB lookup by hash, not a slow
// per-attempt compare, and the token itself already has 256 bits of entropy
// from crypto.randomBytes, so it doesn't need bcrypt's deliberate slowness.
function generateResetToken() {
  const rawToken = crypto.randomBytes(32).toString('hex');
  return { rawToken, tokenHash: hashResetToken(rawToken) };
}

function hashResetToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

module.exports = { hashPassword, verifyPassword, generateTempPassword, generateResetToken, hashResetToken };
