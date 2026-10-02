// Orchestrates the two password-reset paths: self-service (forgot password
// -> emailed time-limited link) and admin/registrar-triggered (generates a
// new temp password directly, as a fallback when email isn't an option —
// e.g. the user has no access to that inbox anymore).
const userModel = require('../models/userModel');
const passwordResetTokenModel = require('../models/passwordResetTokenModel');
const { generateResetToken, hashResetToken, generateTempPassword } = require('../utils/password');
const { sendPasswordResetEmail } = require('./emailService');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// Always succeeds from the caller's point of view, even if no account
// exists for the email — see authController.forgotPassword for why
// (avoids confirming/denying which emails have accounts).
async function requestSelfServiceReset(email) {
  const user = await userModel.findByEmail(email);
  if (!user || !user.is_active) return;

  const { rawToken, tokenHash } = generateResetToken();
  await passwordResetTokenModel.createForUser(user.id, tokenHash);

  const resetUrl = `${FRONTEND_URL}/reset-password?token=${rawToken}`;
  await sendPasswordResetEmail(user.email, resetUrl);
}

// Returns true/false for "was this token valid and the password changed,"
// so the controller can respond 400 vs 200 without duplicating the
// validity check itself.
async function completeSelfServiceReset(rawToken, newPassword) {
  const tokenHash = hashResetToken(rawToken);
  const tokenRow = await passwordResetTokenModel.findValidByHash(tokenHash);
  if (!tokenRow) return false;

  await userModel.updatePassword(tokenRow.user_id, newPassword);
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
