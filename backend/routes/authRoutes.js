const express = require('express');
const rateLimit = require('express-rate-limit');
const {
  login,
  register,
  changePassword,
  passwordResetAvailability,
  forgotPassword,
  resetPassword,
  me,
} = require('../controllers/authController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');
const rateLimits = require('../config/rateLimits');

const router = express.Router();

// Slows down password-guessing. The ceiling defaults to 10 attempts per IP
// per 15 minutes and can only be raised by setting LOGIN_RATE_LIMIT_MAX on
// the machine running the server — see config/rateLimits.js for why, and
// DEPLOYMENT.md for why that variable must not exist on a deployment.
const loginLimiter = rateLimit({
  windowMs: rateLimits.login.windowMs,
  max: rateLimits.login.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again later.' },
});

// Slows down both email-bombing a target inbox and brute-forcing the
// request side of the flow: 5 requests per IP per 15 minutes. Not
// configurable — this one protects someone else's inbox.
const forgotPasswordLimiter = rateLimit({
  windowMs: rateLimits.forgotPassword.windowMs,
  max: rateLimits.forgotPassword.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many password reset requests. Please try again later.' },
});

router.post('/login', loginLimiter, login);
// Unauthenticated and unrated on purpose: it returns one boolean about the
// deployment's own configuration, no user data, and the login page needs it
// before anyone has typed anything.
router.get('/password-reset-availability', passwordResetAvailability);
router.post('/forgot-password', forgotPasswordLimiter, forgotPassword);
// Rate-limited with the same bucket as forgot-password: this endpoint takes
// a token straight from the request, so without a limit it is an open
// guessing surface against the one-hour window. It was the only unlimited
// endpoint in this file.
router.post('/reset-password', forgotPasswordLimiter, resetPassword);

// Account creation — staff and students alike (see authController.register's
// role === 'student' branch). There is no public self-registration; every
// account is created here by an admin/registrar, or in bulk via
// POST /api/users/bulk-create-student-accounts for existing Student Records.
router.post('/register', requireAuth, requireRole('admin', 'registrar'), register);

// Every route below requires requireAuth, which is exactly what allows a
// must_change_password account to still reach these two — see the
// /api/auth/ allowlist in authMiddleware.js.
router.post('/change-password', requireAuth, changePassword);
router.get('/me', requireAuth, me);

module.exports = router;
