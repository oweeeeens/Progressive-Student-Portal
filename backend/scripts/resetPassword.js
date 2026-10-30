// Sets a user's password from the server, for when nobody can do it through
// the app.
//
// WHY THIS HAS TO EXIST. An admin account is deliberately unreachable from
// the UI: a registrar cannot reset one (controllers/userController.js's
// assertCanActOnTarget — otherwise a registrar could reset the admin's
// password, read it out of the response and sign in as admin), a second
// admin cannot either, and scripts/seedAdmin.js is a no-op once the row
// exists. If self-service reset by email is not configured, or the admin no
// longer has the mailbox on file, there is no way back in at all. That
// happened on the live deployment once; this is the answer, and it has to
// live on the server because that is the one place the rule can be relaxed
// safely — reaching it already requires deploy access.
//
// Usage, from the repository root or inside the Railway shell:
//
//   npm run reset:password -- someone@example.com
//   npm run reset:password -- someone@example.com 'a-password-they-chose'
//
// Omit the password and a strong one is generated and printed once.
require('dotenv').config();

const { pool } = require('../config/db');
const userModel = require('../models/userModel');
const { generateTempPassword } = require('../utils/password');
const { MIN_PASSWORD_LENGTH } = require('../config/auth');

async function resetPassword() {
  const [email, providedPassword] = process.argv.slice(2);

  if (!email) {
    throw new Error('Usage: npm run reset:password -- <email> [newPassword]');
  }
  if (providedPassword && providedPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`A password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }

  // Every row that matches ignoring case, not just the one findByEmail would
  // settle on. Before the normalising migration, two accounts differing only
  // in capitalisation could both exist — and resetting the wrong one looks
  // exactly like the reset not working, which is its own afternoon lost.
  const { rows: matches } = await pool.query(
    `SELECT id, email, role, is_active, must_change_password, updated_at
       FROM users WHERE lower(email) = lower(btrim($1)) ORDER BY id`,
    [email]
  );

  if (matches.length === 0) {
    throw new Error(`No account found for ${email}.`);
  }
  if (matches.length > 1) {
    console.error(`\n${matches.length} accounts match that email, differing only by capitalisation:`);
    matches.forEach((row) => console.error(`  id=${row.id}  ${row.email}  role=${row.role}`));
    throw new Error('Refusing to guess which one you meant. Resolve the duplicate first.');
  }

  // Printed BEFORE anything changes, because two of these fields explain
  // failures that look identical to a wrong password from the login page:
  // an inactive account is refused with the same "invalid email or
  // password" message, and must_change_password lets a login succeed and
  // then blocks every page behind it.
  const [user] = matches;
  console.log('\nAccount found:');
  console.log(`  id                   ${user.id}`);
  console.log(`  email                ${user.email}`);
  console.log(`  role                 ${user.role}`);
  console.log(`  is_active            ${user.is_active}`);
  console.log(`  must_change_password ${user.must_change_password}`);
  console.log(`  updated_at           ${user.updated_at.toISOString()}`);

  if (!user.is_active) {
    console.warn('\n  WARNING: this account is deactivated. The new password will be set, but');
    console.warn('  sign-in stays refused until it is reactivated in User Management.');
  }

  const newPassword = providedPassword || generateTempPassword();

  // Through the model, never a hand-written UPDATE: hashing lives in exactly
  // one place (utils/password.js, bcrypt cost 10) and this script must not
  // become a second one. Writing a plaintext value into password_hash by
  // hand is a real way people have broken this account — the column holds a
  // hash, and bcrypt.compare against a plain string can never match.
  //
  // updatePassword also clears must_change_password, so there is no forced-
  // change prompt waiting on the other side of the next sign-in.
  await userModel.updatePassword(user.id, newPassword);

  console.log(`\nPassword updated for ${user.email}.`);
  if (!providedPassword) {
    console.log(`\n  New password: ${newPassword}`);
    console.log('\n  Shown once and not stored anywhere in plaintext. Copy it now, sign in,');
    console.log('  and change it to something you have chosen.');
  }
}

resetPassword()
  .catch((error) => {
    console.error(`\nFailed to reset password: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
