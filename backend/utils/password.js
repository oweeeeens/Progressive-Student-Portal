// Wraps bcrypt so hashing/verification logic lives in exactly one place —
// nothing outside this file should touch a raw password or call bcrypt directly.
const crypto = require('crypto');
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

// Used for admin/registrar-created staff accounts and auto-created student
// accounts — both force a password change on first login (see
// authMiddleware.js), so this only needs to get the user in the door once,
// not be memorable.
//
// DEV_PLACEHOLDER_PASSWORD (optional, set in backend/.env) overrides this
// with a fixed string instead of a random one — purely a development/testing
// convenience so you're not retyping a different random string for every
// account while building/demoing. The account still forces a password
// change on first login either way, so this doesn't weaken anything at
// rest — but it does mean every new account briefly shares a known
// password, so make sure this is UNSET before any real/shared deployment.
function generateTempPassword() {
  if (process.env.DEV_PLACEHOLDER_PASSWORD) {
    return process.env.DEV_PLACEHOLDER_PASSWORD;
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
