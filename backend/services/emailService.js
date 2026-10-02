// Thin wrapper around Resend so nothing else in the app touches the email
// provider's SDK directly — if this ever needs to switch providers, this is
// the only file that changes.
//
// DEV FALLBACK: if RESEND_API_KEY isn't set (e.g. this is a local dev/demo
// environment with no real Resend account configured), emails are logged to
// the console instead of actually sent. This keeps the forgot-password flow
// fully testable without needing real email infrastructure — same reasoning
// as DEV_PLACEHOLDER_PASSWORD in utils/password.js. Set RESEND_API_KEY in
// backend/.env to send real emails.
const { Resend } = require('resend');

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';

async function sendPasswordResetEmail(toEmail, resetUrl) {
  const subject = 'Reset your Student Portal password';
  const html = `
    <p>A password reset was requested for your Student Portal account.</p>
    <p><a href="${resetUrl}">Reset your password</a></p>
    <p>This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
  `;

  if (!resend) {
    console.log(`[emailService] RESEND_API_KEY not set — logging instead of sending.`);
    console.log(`[emailService] To: ${toEmail}`);
    console.log(`[emailService] Reset link: ${resetUrl}`);
    return;
  }

  await resend.emails.send({ from: FROM_EMAIL, to: toEmail, subject, html });
}

module.exports = { sendPasswordResetEmail };
