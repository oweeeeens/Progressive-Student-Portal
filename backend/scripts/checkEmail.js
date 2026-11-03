// Answers "is password reset by email actually going to work?" — before a
// user finds out that it isn't.
//
// WHY THIS HAS TO EXIST. canSendEmail() checks that SMTP_HOST, SMTP_USER and
// SMTP_PASS are non-empty. It cannot tell a correct App Password from a
// wrong one, so a deployment with a mistyped credential:
//
//   1. reports { selfService: true } from the availability endpoint,
//   2. offers "Forgot password" on the login page,
//   3. tells the user "If an account exists, a link has been sent" — which
//      is said deliberately, so the endpoint cannot be used to discover
//      which addresses have accounts,
//   4. throws on send, leaving one console.error line in a deploy log.
//
// From the user's side that is indistinguishable from a working system that
// is slow. This script closes the gap by opening a real connection and
// authenticating, which is the only way to know.
//
// Usage, from the repository root:
//
//   npm run check:email                      configuration + live connection
//   npm run check:email -- me@example.com    the above, then a real test send
//
// And against the deployment, which is the only way to test Railway's own
// variables rather than a local copy of them:
//
//   railway run npm run check:email
//
// It never prints SMTP_PASS, in whole or in part.
require('dotenv').config();

const emailService = require('../services/emailService');

// The failures that actually happen, in the words of someone who has to fix
// them. nodemailer surfaces these as `err.code`; anything not listed falls
// through to the raw message rather than being guessed at.
const ERROR_HINTS = {
  EAUTH:
    'The server rejected the username or password.\n' +
    '      For Gmail this is almost always one of two things:\n' +
    '        - SMTP_PASS is the account password, not a 16-character App Password; or\n' +
    '        - 2-Step Verification is off, so the App Password was never valid.\n' +
    '      Generate a fresh one at https://myaccount.google.com/apppasswords',
  ETIMEDOUT:
    'The connection timed out before the server answered.\n' +
    '      Usually the port: 465 needs implicit TLS and 587 needs STARTTLS, and the\n' +
    '      two must agree. Some networks also block outbound SMTP entirely.',
  ECONNECTION:
    'Could not open a connection to the server.\n' +
    '      Check SMTP_HOST and SMTP_PORT, and whether this network allows outbound SMTP.',
  ESOCKET:
    'The connection was opened but the TLS handshake failed.\n' +
    '      SMTP_PORT and the TLS mode usually disagree — 465 is implicit TLS, 587 is STARTTLS.',
  // nodemailer reports a failed lookup as EDNS, not ENOTFOUND — the latter
  // appears only inside the message text. Both are mapped so neither falls
  // through to a bare error line.
  EDNS: 'No such host. SMTP_HOST is misspelled (Gmail is exactly smtp.gmail.com).',
  ENOTFOUND: 'No such host. SMTP_HOST is misspelled (Gmail is exactly smtp.gmail.com).',
  EENVELOPE: 'The server refused the sender or recipient address. Check SMTP_FROM.',
};

function line(label, value) {
  console.log(`  ${String(label).padEnd(22)} ${value}`);
}

function describeError(error) {
  const hint = ERROR_HINTS[error?.code];
  console.log(`\n  Reason: ${error?.code || 'unknown'} — ${error?.message || error}`);
  if (hint) console.log(`\n      ${hint}`);
}

async function checkEmail() {
  const [testRecipient] = process.argv.slice(2);

  const summary = emailService.emailConfigSummary();

  console.log('\nEmail configuration');
  console.log('-------------------');

  if (!summary.transport) {
    // Not an error: it is the deployed state today, and the portal handles
    // it honestly rather than pretending. Say what to set, and stop.
    console.log('  No email transport is configured, so "Forgot password" is switched off.');
    console.log('  The login page says so plainly and points users at the registrar instead.');
    console.log('\n  To switch it on, set these on the app service:');
    console.log('    SMTP_HOST=smtp.gmail.com');
    console.log('    SMTP_PORT=465');
    console.log('    SMTP_USER=<the sending mailbox>');
    console.log('    SMTP_PASS=<a 16-character Google App Password>');
    console.log('    SMTP_FROM=<the same address>');
    console.log('    FRONTEND_URL=<the public URL of this deployment>');
    console.log('\n  See backend/.env.example for the full notes.\n');
    return false;
  }

  line('Transport', summary.transport);
  if (summary.transport === 'smtp') {
    line('Host', summary.smtp.host);
    line('Port', `${summary.smtp.port} (${summary.smtp.secure ? 'implicit TLS' : 'STARTTLS'})`);
    line('Username', summary.smtp.user);
    line('Sending as', summary.smtp.from);
    // Presence only. A prefix of a sixteen-character secret is still four
    // characters of it, so there is no masked form worth printing.
    line('Password', summary.smtp.passwordSet ? 'set' : 'MISSING');
  }
  if (summary.transport === 'console') {
    console.log('\n  EMAIL_DEV_FALLBACK is on: reset links are written to this console');
    console.log('  instead of being sent. That is a development convenience and is');
    console.log('  refused in production — it must never be set on the deployment.');
  }

  // The variable that fails silently. The email sends, the link arrives, and
  // it points at a machine the recipient does not have.
  const frontendUrl = process.env.FRONTEND_URL;
  console.log('\nReset links');
  console.log('-----------');
  line('FRONTEND_URL', frontendUrl || '(unset)');
  if (!frontendUrl) {
    console.log('\n  Not set, so links will be built against http://localhost:5173 — fine on a');
    console.log('  development machine, useless in an email to anybody else. Set it to this');
    console.log('  deployment\'s public URL.');
  } else if (/localhost|127\.0\.0\.1/.test(frontendUrl)) {
    console.log('\n  This points at localhost. Correct for local testing; if this is the');
    console.log('  deployment, every emailed link is dead on arrival.');
  }

  console.log('\nConnection');
  console.log('----------');
  const result = await emailService.verifyTransport();

  if (result.ok === null) {
    console.log(`  ${result.unverifiable}`);
  } else if (result.ok) {
    console.log('  Connected and authenticated successfully.');
  } else {
    console.log('  FAILED — the server refused the connection or the credentials.');
    describeError(result.error);
    console.log('');
    return false;
  }

  if (!testRecipient) {
    console.log('\n  Pass an address to send a real test message:');
    console.log('    npm run check:email -- you@example.com\n');
    return true;
  }

  console.log('\nTest send');
  console.log('---------');
  line('To', testRecipient);
  try {
    // Deliberately through the REAL sendPasswordResetEmail rather than a
    // send written here: a diagnostic that exercises a parallel path can
    // pass while the path that runs in production is broken.
    const sampleUrl = `${frontendUrl || 'http://localhost:5173'}/reset-password?token=check-email-test`;
    await emailService.sendPasswordResetEmail(testRecipient, sampleUrl);

    if (summary.transport === 'console') {
      // Say what actually happened. Reporting "sent" here would be the exact
      // thing this script exists to catch, committed by the script itself.
      console.log('  Written to the console above — NOT sent. That is what the console');
      console.log('  transport does; configure SMTP to send for real.');
    } else {
      console.log('  Sent. Check that inbox (and its spam folder).');
    }

    console.log('\n  The link is a SAMPLE and will not work — it carries a dummy token.');
    console.log('  What it shows you is whether the address in the link is right.');
    console.log(`  It should read: ${sampleUrl}\n`);
    return true;
  } catch (error) {
    console.log('  FAILED to send.');
    describeError(error);
    console.log('');
    return false;
  }
}

checkEmail()
  .then((ok) => {
    // A non-zero exit so this is usable in a deploy check or a shell `&&`
    // chain, not only read by a person.
    process.exit(ok ? 0 : 1);
  })
  .catch((error) => {
    console.error('\ncheck:email could not run:', error?.message || error, '\n');
    process.exit(1);
  });
