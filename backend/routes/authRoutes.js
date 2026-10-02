const express = require('express');
const rateLimit = require('express-rate-limit');
const { login, register, changePassword, forgotPassword, resetPassword, me } = require('../controllers/authController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');

const router = express.Router();

// Slows down password-guessing: 10 attempts per IP per 15 minutes.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again later.' },
});

// Slows down both email-bombing a target inbox and brute-forcing the
// request side of the flow: 5 requests per IP per 15 minutes.
const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many password reset requests. Please try again later.' },
});

router.post('/login', loginLimiter, login);
router.post('/forgot-password', forgotPasswordLimiter, forgotPassword);
router.post('/reset-password', resetPassword);

// Staff account creation — there is no public self-registration, and
// student accounts are never created through this endpoint (auto-
// provisioned at enrollment instead — see services/accountProvisioning.js).
router.post('/register', requireAuth, requireRole('admin', 'registrar'), register);

// Every route below requires requireAuth, which is exactly what allows a
// must_change_password account to still reach these two — see the
// /api/auth/ allowlist in authMiddleware.js.
router.post('/change-password', requireAuth, changePassword);
router.get('/me', requireAuth, me);

module.exports = router;
