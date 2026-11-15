// Orchestrates the two password-reset paths: self-service (forgot password
// -> a 6-digit code emailed to the account's address, typed back on the
// Forgot Password page) and admin/registrar-triggered (generates a new temp
// password directly, as a fallback when email isn't an option — e.g. the
// user has no access to that inbox anymore).
//
// A code rather than a link (2026-11-15): a link had to be opened on the
// device that received the email, so someone reading mail on their phone
// but using the portal on a laptop had to switch devices. A code is typed
// wherever they already are.
const userModel = require('../models/userModel');
const passwordResetTokenModel = require('../models/passwordResetTokenModel');
const { generateResetCode, hashResetCode, resetCodeMatches, generateTempPassword } = require('../utils/password');
const { RESET_CODE_TTL_MINUTES, RESET_CODE_MAX_ATTEMPTS } = require('../config/auth');
// Imported as a module rather than destructured: what this sends through
// is runtime configuration (Brevo, SMTP, Resend, or the dev console), and a
// destructured copy would freeze that choice at import time and make the
// seam impossible to stand in for under test.
const emailService = require('./emailService');

// Always succeeds from the caller's point of view, even if no account
// exists for the email — see authController.forgotPassword for why
// (avoids confirming/denying which emails have accounts).
async function requestSelfServiceReset(email) {
  const user = await userModel.findByEmail(email);
  if (!user || !user.is_active) return;

  const code = generateResetCode();
  await passwordResetTokenModel.createForUser(user.id, hashResetCode(user.id, code), RESET_CODE_TTL_MINUTES * 60 * 1000);
  await emailService.sendPasswordResetCode(user.email, code, RESET_CODE_TTL_MINUTES);
}

// Returns true/false for "was this code right and the password changed".
// Every failure — unknown email, deactivated account, no active code, wrong
// code — returns the same false, so the controller's single error message
// never reveals which of them it was (and so never whether an account
// exists). A wrong code counts against that code's attempts; the guess that
// reaches the limit burns it.
async function completeSelfServiceReset(email, code, newPassword) {
  const user = await userModel.findByEmail(email);
  if (!user || !user.is_active) return false;

  const tokenRow = await passwordResetTokenModel.findActiveForUser(user.id);
  if (!tokenRow) return false;

  if (!resetCodeMatches(user.id, code, tokenRow.token_hash)) {
    await passwordResetTokenModel.recordFailedAttempt(tokenRow.id, RESET_CODE_MAX_ATTEMPTS);
    return false;
  }

  // updatePassword also stamps password_changed_at, which ends every
  // session signed in before the reset (authMiddleware) — the point of a
  // reset when the old password, or a device, may be in someone else's hands.
  await userModel.updatePassword(user.id, newPassword);
  await passwordResetTokenModel.markUsed(tokenRow.id);
  return true;
}

// The admin/registrar fallback: generates a new temp password immediately,
// no email involved. Returns it once, same one-time-reveal pattern as
// staff account creation and student auto-provisioning.
async function resetUserPasswordToTemp(userId) {
  const tempPassword = generateTempPassword();
  await userModel.resetPasswordToTemp(userId, tempPassword);
  return tempPassword;
}

module.exports = { requestSelfServiceReset, completeSelfServiceReset, resetUserPasswordToTemp };
