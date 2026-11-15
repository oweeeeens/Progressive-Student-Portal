// The one place in the app that talks to an email provider. Everything else
// calls sendPasswordResetEmail / canSendEmail and never learns which
// transport is in use.
//
// FOUR TRANSPORTS, tried in this order:
//
//   1. Brevo (HTTPS API) — the one that works on the Railway deployment.
//      Railway's Hobby/Free plans block outgoing SMTP entirely (see
//      CLAUDE.md, "Forgot Password"), but not HTTPS, and Brevo's free plan
//      sends 300 emails a day to ANY recipient from one sender address
//      verified by clicking a confirmation email — no domain needed.
//      Caveat: a free-mail sender such as a gmail.com address cannot be
//      authenticated, so Brevo rewrites it to something@<id>.brevosend.com.
//      The email still arrives, but may be filtered to spam until the school
//      sends from a domain of its own.
//   2. SMTP (nodemailer) — any mailbox with SMTP credentials; for a Gmail
//      account that means an App Password, which requires 2-Step
//      Verification on that account. Works anywhere outbound SMTP is open.
//   3. Resend — kept because it was here first and is genuinely simpler to
//      set up. See the warning below about who it can reach.
//   4. The development console fallback.
//
// WHY BREVO IS PREFERRED WHEN BOTH IT AND SMTP ARE SET. Both reach any
// recipient, but only one of them can leave a Railway container: an SMTP
// connection there times out after two minutes. Putting the HTTPS transport
// first means a deployment that happens to carry leftover SMTP variables
// still sends.
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

// Brevo, over its HTTPS API with Node's built-in fetch (no SDK dependency).
// Configured only when both the key and the sender are set, for the same
// reason as SMTP: a half-filled set should switch the flow off, not fail
// while someone waits for a link. The sender must be one verified in the
// Brevo account (Senders), or Brevo refuses the send.
const BREVO_API = 'https://api.brevo.com/v3';
const BREVO_API_KEY = trimmed(process.env.BREVO_API_KEY);
const BREVO_SENDER_EMAIL = trimmed(process.env.BREVO_SENDER_EMAIL);
const BREVO_SENDER_NAME = trimmed(process.env.BREVO_SENDER_NAME) || 'DepEd Progressive SHS Student Portal';
const brevoConfigured = Boolean(BREVO_API_KEY && BREVO_SENDER_EMAIL);
// Long enough for a slow day at Brevo, short enough that a person on the
// Forgot Password page gets an answer instead of a spinner.
const BREVO_TIMEOUT_MS = 15000;

// A Brevo failure with a stable `code`, so scripts/checkEmail.js can name
// the fix the way it already does for SMTP's EAUTH / ETIMEDOUT.
class BrevoError extends Error {
  constructor(message, code, status = null) {
    super(message);
    this.name = 'BrevoError';
    this.code = code;
    this.status = status;
  }
}

// One call to Brevo's API. The key travels only in the `api-key` header and
// is never part of an error message, a log line or a return value.
async function brevoRequest(path, { method = 'GET', body } = {}) {
  let response;
  try {
    response = await fetch(`${BREVO_API}${path}`, {
      method,
      headers: {
        'api-key': BREVO_API_KEY,
        accept: 'application/json',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(BREVO_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error.name === 'TimeoutError' || error.name === 'AbortError';
    throw new BrevoError(
      timedOut ? `Brevo did not answer within ${BREVO_TIMEOUT_MS / 1000} seconds.` : `Could not reach Brevo: ${error.message}`,
      timedOut ? 'BREVO_TIMEOUT' : 'BREVO_UNREACHABLE'
    );
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload.message === 'string' ? payload.message : '';
    let code = `BREVO_HTTP_${response.status}`;
    if (response.status === 401) code = 'BREVO_UNAUTHORIZED';
    else if (response.status === 400 && /sender/i.test(message)) code = 'BREVO_SENDER_INVALID';
    throw new BrevoError(`Brevo answered ${response.status}${message ? `: ${message}` : ''}`, code, response.status);
  }
  return payload;
}

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
  return brevoConfigured || Boolean(smtpTransport) || Boolean(resend) || devFallbackEnabled;
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
  if (brevoConfigured) return 'brevo';
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

  if (brevoConfigured) {
    try {
      // Two real HTTPS calls: /account proves the key works (a wrong or
      // revoked key answers 401), /senders proves the configured sender is
      // one Brevo will actually send as.
      await brevoRequest('/account');
      const { senders } = await brevoRequest('/senders');
      if (Array.isArray(senders)) {
        const match = senders.find((s) => String(s.email || '').toLowerCase() === BREVO_SENDER_EMAIL.toLowerCase());
        if (!match) {
          return { ok: false, transport, error: new BrevoError(`${BREVO_SENDER_EMAIL} is not a sender in this Brevo account.`, 'BREVO_SENDER_UNKNOWN') };
        }
        if (match.active === false) {
          return { ok: false, transport, error: new BrevoError(`${BREVO_SENDER_EMAIL} is in Brevo but not yet verified.`, 'BREVO_SENDER_INACTIVE') };
        }
      }
      return { ok: true, transport };
    } catch (error) {
      return { ok: false, transport, error };
    }
  }

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
// SMTP_PASS and BREVO_API_KEY are reported only as present or absent and are
// never returned, logged or printed in any form, including partially masked:
// a prefix of a secret is still part of it.
function emailConfigSummary() {
  return {
    transport: activeEmailTransport(),
    brevo: {
      senderEmail: BREVO_SENDER_EMAIL || null,
      senderName: BREVO_SENDER_EMAIL ? BREVO_SENDER_NAME : null,
      keySet: Boolean(BREVO_API_KEY),
    },
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

  if (brevoConfigured) {
    // Plain-text alternative included for the same spam-folder reason as
    // SMTP below — doubly worth it when Brevo has rewritten a free-mail
    // sender to a brevosend.com address.
    await brevoRequest('/smtp/email', {
      method: 'POST',
      body: {
        sender: { name: BREVO_SENDER_NAME, email: BREVO_SENDER_EMAIL },
        to: [{ email: toEmail }],
        subject,
        htmlContent: html,
        textContent: text,
      },
    });
    return;
  }

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
