// Handles login, account creation (staff AND student), password changes,
// and "who am I". Accounts are provisioned by admin/registrar (see register
// below) rather than self-signup, since anyone self-registering as e.g.
// "registrar" would be a privilege-escalation hole. A student account is
// linked to an existing Student Record rather than collecting a fresh
// name/email — see the role === 'student' branch below.
const jwt = require('jsonwebtoken');
const { JWT_SECRET, JWT_EXPIRES_IN, CREATABLE_ROLES } = require('../config/auth');
const userModel = require('../models/userModel');
const studentModel = require('../models/studentModel');
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

// Creates an account with a system-generated temporary password and forces
// a change on first login (enforced in authMiddleware.js). The temp
// password is returned exactly once, in this response — it is never stored
// in plaintext and cannot be retrieved again, so the admin/registrar must
// relay it to the new user right now (there's no email-sending
// infrastructure in this system to do it automatically).
//
// Two shapes, by role:
// - Staff (adviser/subject_teacher/guidance_counselor/registrar/principal/
//   ict_faculty): { email, fullName, role } — a fresh account, same as always.
// - Student: { role: 'student', studentId } — no email/fullName from the
//   client; both are derived from the existing Student Record so the
//   account can never drift from what's on file. studentId must point at a
//   student with a personal email already on record (collected when the
//   registrar added them to Student Records) and no account yet.
async function register(req, res) {
  const { role } = req.body;

  if (!role || !CREATABLE_ROLES.includes(role)) {
    return res.status(400).json({ error: `role must be one of: ${CREATABLE_ROLES.join(', ')}` });
  }

  if (role === 'student') {
    const { studentId } = req.body;
    if (!studentId) {
      return res.status(400).json({ error: 'studentId is required to create a student account.' });
    }
    const student = await studentModel.findByIdUnscoped(Number(studentId));
    if (!student) {
      return res.status(400).json({ error: 'studentId does not refer to an existing student record.' });
    }
    if (student.user_id) {
      return res.status(409).json({ error: 'This student already has a portal account.' });
    }
    if (!student.email) {
      return res
        .status(400)
        .json({ error: "This student has no personal email on file — add one to their Student Record first." });
    }

    const existingByEmail = await userModel.findByEmail(student.email);
    if (existingByEmail) {
      return res.status(409).json({ error: 'An account with that email already exists.' });
    }

    const tempPassword = generateTempPassword();
    const user = await userModel.createUser({
      email: student.email,
      password: tempPassword,
      fullName: `${student.first_name} ${student.last_name}`,
      role: 'student',
      mustChangePassword: true,
    });
    await studentModel.linkUserAccount(student.id, user.id);
    return res.status(201).json({ user: toPublicUser(user), tempPassword });
  }

  const { email, fullName } = req.body;
  if (!email || !fullName) {
    return res.status(400).json({ error: 'email and fullName are required.' });
  }
  if (!EMAIL_PATTERN.test(email)) {
    return res.status(400).json({ error: 'That email address does not look valid.' });
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
