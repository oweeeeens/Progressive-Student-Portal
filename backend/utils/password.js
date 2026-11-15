// Wraps bcrypt so hashing/verification logic lives in exactly one place —
// nothing outside this file should touch a raw password or call bcrypt directly.
const crypto = require('crypto');
const { devOnlyFlag } = require('../config/environment');
const bcrypt = require('bcryptjs');
const { BCRYPT_SALT_ROUNDS, JWT_SECRET } = require('../config/auth');

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

// Forgot-password reset CODES — six digits, emailed, typed on whatever
// device the person is using (a link had to be opened where the email was).
//
// crypto.randomInt, not Math.random: the code is a credential.
function generateResetCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

// Only this hash is stored (password_reset_tokens.token_hash), never the
// code. A plain SHA-256 of a six-digit code would be useless protection —
// anyone with the table could hash all million values in a second — so it is
// an HMAC keyed with the server secret, which a copy of the database alone
// does not contain. The user id is part of the message, so a code is bound
// to the account it was issued for and means nothing for any other.
function hashResetCode(userId, code) {
  return crypto.createHmac('sha256', JWT_SECRET).update(`${userId}:${code}`).digest('hex');
}

// Constant-time comparison, so response timing cannot reveal how many
// leading characters of a guess were right.
function resetCodeMatches(userId, code, storedHash) {
  const expected = Buffer.from(String(storedHash || ''), 'hex');
  const actual = Buffer.from(hashResetCode(userId, code), 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

module.exports = { hashPassword, verifyPassword, generateTempPassword, generateResetCode, hashResetCode, resetCodeMatches };
