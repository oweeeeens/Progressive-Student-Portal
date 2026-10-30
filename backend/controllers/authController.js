// Handles login, account creation (staff AND student), password changes,
// and "who am I". Accounts are provisioned by admin/registrar (see register
// below) rather than self-signup, since anyone self-registering as e.g.
// "registrar" would be a privilege-escalation hole. A student account is
// linked to an existing Student Record rather than collecting a fresh
// name/email — see the role === 'student' branch below.
const jwt = require('jsonwebtoken');
const { JWT_SECRET, JWT_EXPIRES_IN, CREATABLE_ROLES, MIN_PASSWORD_LENGTH } = require('../config/auth');
const userModel = require('../models/userModel');
const { verifyPassword, generateTempPassword } = require('../utils/password');
const passwordReset = require('../services/passwordReset');
const emailService = require('../services/emailService');
const { createStudentAccount } = require('../services/accountCreation');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

    const result = await createStudentAccount(Number(studentId));
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }
    return res.status(201).json({ user: toPublicUser(result.user), tempPassword: result.tempPassword });
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
  // the password hash to verify the current password. By id, not by email:
  // this is the same row requireAuth just loaded, so the id is the direct
  // key, and a miss here would have dereferenced null and turned a wrong
  // password into a bare 500.
  const userWithHash = await userModel.findByIdWithHash(req.user.id);
  if (!userWithHash) {
    return res.status(401).json({ error: 'Account not found.' });
  }
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
// Whether "Forgot password" can do anything at all on this deployment.
// Public and deliberately account-independent: it reports a property of the
// SYSTEM (is email configured), never of any user, so it tells an attacker
// nothing about who has an account. The login page asks this before
// offering the flow.
function passwordResetAvailability(req, res) {
  res.json({ selfService: emailService.canSendEmail() });
}

async function forgotPassword(req, res) {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'email is required.' });
  }

  // Checked here too, not just in the UI: a request that cannot possibly
  // result in an email must not be answered with "a reset link has been
  // sent." 503 rather than 400 — the request is fine, the capability is
  // missing.
  if (!emailService.canSendEmail()) {
    return res.status(503).json({
      error:
        'Password reset by email is not set up for this school. Ask the registrar or a system administrator to reset your password for you.',
    });
  }

  try {
    await passwordReset.requestSelfServiceReset(email);
  } catch (error) {
    // A provider failure used to propagate to the global error handler and
    // come back as a bare 500 "Internal server error." — indistinguishable
    // from any other crash, to someone who is already locked out and has no
    // other way in. Name the problem and name the way round it.
    //
    // This does reveal that an account exists, where the success path
    // deliberately does not: a send is only attempted for a real account, so
    // only a real account can produce a send failure. That is a conscious
    // trade. The endpoint is rate-limited to 5 requests per IP per 15
    // minutes, the signal only appears while mail delivery is actually
    // broken, and the alternative is the exact failure this feature exists
    // to prevent — telling someone a link is on its way when it is not.
    console.error(
      `[forgotPassword] ${emailService.activeEmailTransport()} transport failed to send a reset email:`,
      error
    );
    return res.status(502).json({
      error:
        'We could not send the reset email just now. Please try again in a few minutes, or ask the registrar or a system administrator for a temporary password.',
    });
  }
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

module.exports = {
  login,
  register,
  changePassword,
  passwordResetAvailability,
  forgotPassword,
  resetPassword,
  me,
};
