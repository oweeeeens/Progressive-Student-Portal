// The one place in the app that talks to an email provider. Everything else
// calls sendPasswordResetEmail / canSendEmail and never learns which
// transport is in use.
//
// THREE TRANSPORTS, tried in this order:
//
//   1. SMTP (nodemailer) — the one the school actually runs on. Any mailbox
//      with SMTP credentials will do; for a Gmail account that means an App
//      Password, which requires 2-Step Verification on that account.
//   2. Resend — kept because it was here first and is genuinely simpler to
//      set up. See the warning below about who it can reach.
//   3. The development console fallback.
//
// WHY SMTP IS PREFERRED WHEN BOTH ARE SET. Resend's free sending identity,
// onboarding@resend.dev, only delivers to the address that owns the Resend
// account; anything else is refused with a 403. On this system that is a
// trap rather than a limitation, because the people who most need a reset
// link are students, at their own personal addresses. Reaching arbitrary
// recipients through Resend needs a verified sending domain, which this
// school does not have. SMTP has no such restriction, so when both are
// configured the one that can actually reach a student wins.
//
// DEV FALLBACK: with EMAIL_DEV_FALLBACK=true and no provider, emails are
// written to the console instead of sent, which keeps the forgot-password
// flow testable locally without real email infrastructure — same reasoning
// as DEV_PLACEHOLDER_PASSWORD in utils/password.js.
//
// It is OPT-IN, and that matters. Previously the console fallback was what
// happened whenever the key was missing, so a deployment that simply forgot
// to set RESEND_API_KEY still told every user "a reset link has been sent"
// and then wrote the link to a server log they will never read. Silence
// dressed as success is worse than a plain "this isn't available" — hence
// canSendEmail() below, which the API and the UI both ask before offering
// the flow at all.
const nodemailer = require('nodemailer');
const { Resend } = require('resend');
const { devOnlyFlag } = require('../config/environment');

// SMTP is configured only when there is enough to actually connect and
// authenticate. A half-filled set of variables is treated as "not
// configured" rather than being allowed to fail at send time, when the
// person is already waiting for a link.
const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
// 465 is implicit TLS, 587 is STARTTLS; `secure` has to agree with the port
// or the connection hangs rather than failing cleanly.
const SMTP_PORT = Number(process.env.SMTP_PORT) || 465;
const smtpConfigured = Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS);

const smtpTransport = smtpConfigured
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    })
  : null;

// Defaults to the authenticating account, because for most providers —
// Gmail among them — sending as anyone else is refused anyway.
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER;

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
// Refused in production: there, "the link went to a log nobody reads" is
// indistinguishable to the user from "the link was sent", which is the exact
// failure this file's header says canSendEmail() exists to prevent.
const devFallbackEnabled = devOnlyFlag('EMAIL_DEV_FALLBACK', process.env.EMAIL_DEV_FALLBACK === 'true');
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';

// Whether a reset email can reach a person at all: a real provider is
// configured, or this is a developer machine that has opted into the console
// fallback. The API and the UI both ask this before offering the flow.
function canSendEmail() {
  return Boolean(smtpTransport) || Boolean(resend) || devFallbackEnabled;
}

// Which transport a send would use. Logged at boot and reported by the
// availability endpoint, so "why did nothing arrive?" is answerable without
// reading the code.
function activeEmailTransport() {
  if (smtpTransport) return 'smtp';
  if (resend) return 'resend';
  if (devFallbackEnabled) return 'console';
  return null;
}

function resetEmailBody(resetUrl) {
  return {
    subject: 'Reset your Student Portal password',
    html: `
    <p>A password reset was requested for your Student Portal account.</p>
    <p><a href="${resetUrl}">Reset your password</a></p>
    <p>This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
  `,
    text: `A password reset was requested for your Student Portal account.\n\nReset your password: ${resetUrl}\n\nThis link expires in 1 hour. If you didn't request this, you can safely ignore this email.`,
  };
}

async function sendPasswordResetEmail(toEmail, resetUrl) {
  const { subject, html, text } = resetEmailBody(resetUrl);

  if (smtpTransport) {
    // `text` as well as `html`: a plain-text alternative keeps the message
    // out of spam folders that penalise HTML-only mail, which matters for a
    // link someone is waiting on.
    await smtpTransport.sendMail({ from: SMTP_FROM, to: toEmail, subject, html, text });
    return;
  }

  if (resend) {
    await resend.emails.send({ from: RESEND_FROM_EMAIL, to: toEmail, subject, html, text });
    return;
  }

  if (!devFallbackEnabled) {
    // Reached only if a caller skipped canSendEmail(). Refuse loudly
    // rather than pretend: a silently dropped password reset is how a
    // user gets locked out with no explanation.
    throw new Error('Email is not configured, so no reset email can be sent.');
  }

  console.log('[emailService] EMAIL_DEV_FALLBACK is on — logging instead of sending.');
  console.log(`[emailService] To: ${toEmail}`);
  console.log(`[emailService] Reset link: ${resetUrl}`);
}

module.exports = { sendPasswordResetEmail, canSendEmail, activeEmailTransport };
