// Handles login, staff account creation, password changes, and "who am I".
// Staff accounts are provisioned by admin/registrar (see register below)
// rather than self-signup, since anyone self-registering as e.g. "registrar"
// would be a privilege-escalation hole. Student accounts are never created
// here at all — see services/accountProvisioning.js, triggered when a
// student's enrollment_status reaches 'enrolled'.
const jwt = require('jsonwebtoken');
const { JWT_SECRET, JWT_EXPIRES_IN, CREATABLE_STAFF_ROLES } = require('../config/auth');
const userModel = require('../models/userModel');
const { verifyPassword, generateTempPassword } = require('../utils/password');
const passwordReset = require('../services/passwordReset');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

function signToken(user) {
  return jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function toPublicUser(user) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    role: user.role,
    mustChangePassword: user.must_change_password,
  };
}

async function login(req, res) {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const user = await userModel.findByEmail(email);
  // Same error for "no such user" and "wrong password" so login can't be
  // used to enumerate which emails have accounts.
  const invalidCredentialsError = () => res.status(401).json({ error: 'Invalid email or password.' });

  if (!user || !user.is_active) {
    return invalidCredentialsError();
  }

  const passwordMatches = await verifyPassword(password, user.password_hash);
  if (!passwordMatches) {
    return invalidCredentialsError();
  }

  const token = signToken(user);
  res.json({ token, user: toPublicUser(user) });
}

// Creates a staff account with a system-generated temporary password and
// forces a change on first login (enforced in authMiddleware.js). The
// temp password is returned exactly once, in this response — it is never
// stored in plaintext and cannot be retrieved again, so the admin/registrar
// must relay it to the new user right now (there's no email-sending
// infrastructure in this system to do it automatically).
async function register(req, res) {
  const { email, fullName, role } = req.body;

  if (!email || !fullName || !role) {
    return res.status(400).json({ error: 'email, fullName, and role are all required.' });
  }
  if (!EMAIL_PATTERN.test(email)) {
    return res.status(400).json({ error: 'That email address does not look valid.' });
  }
  if (!CREATABLE_STAFF_ROLES.includes(role)) {
    return res.status(400).json({ error: `role must be one of: ${CREATABLE_STAFF_ROLES.join(', ')}` });
  }

  const existing = await userModel.findByEmail(email);
  if (existing) {
    return res.status(409).json({ error: 'An account with that email already exists.' });
  }

  const tempPassword = generateTempPassword();
  const user = await userModel.createUser({ email, password: tempPassword, fullName, role, mustChangePassword: true });
  res.status(201).json({ user: toPublicUser(user), tempPassword });
}

// The forced first-login flow, and also usable as a general "change my
// password" action any time — both paths require knowing the current
// password, not just a token, since a still-valid JWT alone shouldn't be
// enough to take over an account someone briefly stepped away from.
async function changePassword(req, res) {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'currentPassword and newPassword are required.' });
  }
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `New password must be at least ${MIN_PASSWORD_LENGTH} characters.` });
  }

  // req.user (from requireAuth) only carries PUBLIC_COLUMNS — re-fetch with
  // the password hash to verify the current password.
  const userWithHash = await userModel.findByEmail(req.user.email);
  const currentMatches = await verifyPassword(currentPassword, userWithHash.password_hash);
  if (!currentMatches) {
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }

  await userModel.updatePassword(req.user.id, newPassword);
  res.json({ message: 'Password changed.' });
}

// Always responds with the same generic message whether or not an account
// exists for the email — otherwise this endpoint could be used to find out
// which emails have accounts (same reasoning as login's shared error).
async function forgotPassword(req, res) {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'email is required.' });
  }

  await passwordReset.requestSelfServiceReset(email);
  res.json({ message: 'If an account exists for that email, a password reset link has been sent.' });
}

async function resetPassword(req, res) {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) {
    return res.status(400).json({ error: 'token and newPassword are required.' });
  }
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `New password must be at least ${MIN_PASSWORD_LENGTH} characters.` });
  }

  const succeeded = await passwordReset.completeSelfServiceReset(token, newPassword);
  if (!succeeded) {
    return res.status(400).json({ error: 'That reset link is invalid or has expired. Request a new one.' });
  }

  res.json({ message: 'Password reset. You can now log in with your new password.' });
}

async function me(req, res) {
  res.json({ user: toPublicUser(req.user) });
}

module.exports = { login, register, changePassword, forgotPassword, resetPassword, me };
