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

// Every one of these is trimmed, because all of them arrive by paste — into
// a Railway variable field or a .env file — and a trailing space or newline
// is never part of a hostname, a username or an address.
function trimmed(value) {
  return String(value ?? '').trim();
}

// Google displays an App Password as sixteen lowercase letters in four
// spaced groups (`abcd efgh ijkl mnop`), and people paste exactly what they
// see. Google itself ignores the spaces; a Railway variable does not, so
// what nodemailer sends is the spaced string.
//
// Deliberately narrow. An arbitrary SMTP password MAY legitimately contain a
// space, and stripping it would break a working credential — so the spaces
// come out only when the value is demonstrably a Google App Password: the
// host is Gmail, and removing whitespace leaves exactly sixteen letters.
// Anything else keeps its interior untouched and is only trimmed.
function normalizeSmtpPassword(raw, host) {
  const value = trimmed(raw);
  if (!value) return '';

  const deSpaced = value.replace(/\s+/g, '');
  const isGmail = /(^|\.)gmail\.com$/i.test(trimmed(host));
  if (isGmail && /^[a-z]{16}$/i.test(deSpaced)) return deSpaced;

  return value;
}

// SMTP is configured only when there is enough to actually connect and
// authenticate. A half-filled set of variables is treated as "not
// configured" rather than being allowed to fail at send time, when the
// person is already waiting for a link.
//
// Note what this CANNOT tell you: whether the credentials are correct. Three
// non-empty strings is all it checks, so a wrong App Password still reads as
// "configured" here and fails only at send time. verifyTransport() below is
// the answer to that, and scripts/checkEmail.js is how it gets asked.
const SMTP_HOST = trimmed(process.env.SMTP_HOST);
const SMTP_USER = trimmed(process.env.SMTP_USER);
const SMTP_PASS = normalizeSmtpPassword(process.env.SMTP_PASS, SMTP_HOST);
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
const SMTP_FROM = trimmed(process.env.SMTP_FROM) || SMTP_USER;

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

// Which transport a send would use. Named once at boot (see server.js) and
// reported by `npm run check:email`, so "why did nothing arrive?" is
// answerable without reading the code.
//
// Deliberately NOT returned by /api/auth/password-reset-availability: that
// endpoint is public and unauthenticated, and the transport name is nothing
// a user can act on while telling anyone else a little about how the
// deployment is wired. The diagnostic belongs behind deploy access.
function activeEmailTransport() {
  if (smtpTransport) return 'smtp';
  if (resend) return 'resend';
  if (devFallbackEnabled) return 'console';
  return null;
}

// Does the configured transport actually work, right now?
//
// This is the question canSendEmail() cannot answer. It checks that three
// variables are non-empty; this opens a real connection and authenticates,
// which is the only way to tell a correct App Password from a wrong one.
// Without it, a mistyped credential produces a deployment that reports
// itself ready, tells every user "a reset link has been sent", and silently
// fails — the exact "silence dressed as success" this file's header says
// canSendEmail() exists to prevent, one level down.
//
// Returns rather than throws, because the caller is a diagnostic whose job
// is to print the failure, not to crash on it.
async function verifyTransport() {
  const transport = activeEmailTransport();

  if (smtpTransport) {
    try {
      // nodemailer's verify() is a genuine TCP connect plus AUTH handshake
      // against the server, not a config check.
      await smtpTransport.verify();
      return { ok: true, transport };
    } catch (error) {
      return { ok: false, transport, error };
    }
  }

  // Neither of the other two has a connection to open: Resend is a per-send
  // HTTPS call with no handshake to make in advance, and the console
  // fallback has nowhere to connect to. Say so rather than reporting a pass
  // that was never tested.
  return {
    ok: null,
    transport,
    error: null,
    unverifiable: transport
      ? `The ${transport} transport has no connection to test in advance.`
      : 'No email transport is configured.',
  };
}

// What is set, for a human reading a diagnostic — never what it is set to.
//
// SMTP_PASS is reported only as present or absent and is never returned,
// logged or printed in any form, including partially masked: a prefix of a
// sixteen-character secret is still four characters of it.
function emailConfigSummary() {
  return {
    transport: activeEmailTransport(),
    smtp: {
      host: SMTP_HOST || null,
      port: SMTP_HOST ? SMTP_PORT : null,
      // Named so the reader can confirm the port and the TLS mode agree —
      // disagreeing is what makes a connection hang rather than fail.
      secure: SMTP_HOST ? SMTP_PORT === 465 : null,
      user: SMTP_USER || null,
      from: SMTP_FROM || null,
      passwordSet: Boolean(SMTP_PASS),
    },
    resendKeySet: Boolean(resend),
    devFallbackEnabled,
  };
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

module.exports = {
  sendPasswordResetEmail,
  canSendEmail,
  activeEmailTransport,
  verifyTransport,
  emailConfigSummary,
};
