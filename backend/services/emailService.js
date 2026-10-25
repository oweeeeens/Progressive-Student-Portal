// Thin wrapper around Resend so nothing else in the app touches the email
// provider's SDK directly — if this ever needs to switch providers, this is
// the only file that changes.
//
// DEV FALLBACK: with EMAIL_DEV_FALLBACK=true and no API key, emails are
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
const { Resend } = require('resend');

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const devFallbackEnabled = process.env.EMAIL_DEV_FALLBACK === 'true';
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';

// Whether a reset email can reach a person at all: a real provider is
// configured, or this is a developer machine that has opted into the console
// fallback.
function canSendEmail() {
  return Boolean(resend) || devFallbackEnabled;
}

async function sendPasswordResetEmail(toEmail, resetUrl) {
  const subject = 'Reset your Student Portal password';
  const html = `
    <p>A password reset was requested for your Student Portal account.</p>
    <p><a href="${resetUrl}">Reset your password</a></p>
    <p>This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
  `;

  if (!resend) {
    if (!devFallbackEnabled) {
      // Reached only if a caller skipped canSendEmail(). Refuse loudly
      // rather than pretend: a silently dropped password reset is how a
      // user gets locked out with no explanation.
      throw new Error('Email is not configured, so no reset email can be sent.');
    }
    console.log('[emailService] EMAIL_DEV_FALLBACK is on — logging instead of sending.');
    console.log(`[emailService] To: ${toEmail}`);
    console.log(`[emailService] Reset link: ${resetUrl}`);
    return;
  }

  await resend.emails.send({ from: FROM_EMAIL, to: toEmail, subject, html });
}

module.exports = { sendPasswordResetEmail, canSendEmail };
