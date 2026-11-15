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
// It never prints SMTP_PASS or BREVO_API_KEY, in whole or in part.
require('dotenv').config();

const emailService = require('../services/emailService');

// The failures that actually happen, in the words of someone who has to fix
// them. nodemailer surfaces these as `err.code`; anything not listed falls
// through to the raw message rather than being guessed at.
const ERROR_HINTS = {
  // CONFIRMED CAUSE, not a guess: Railway's Hobby, Free and Trial plans
  // block outbound SMTP at the network level — only Pro and above allow it.
  // The giveaway is this exact shape: no EAUTH, no ECONNREFUSED, just
  // silence until nodemailer's own 2-minute clock runs out. A real
  // credential problem fails fast (EAUTH); this fails slow, because nothing
  // on the other end is reachable at all for a connection to be refused by.
  //
  // This is reported via `error.timeoutType`, not `error.code` — see
  // TIMEOUT_TYPE_HINTS below, which is what actually fires for this case.
  // Kept here too so the lookup finds it however the error is shaped in a
  // future nodemailer version.
  CONNECT_TIMEOUT:
    'No response at all to the connection attempt — on Railway this almost always means\n' +
    '      the Hobby/Free/Trial plan, which blocks outbound SMTP entirely. Wrong credentials\n' +
    '      fail immediately (EAUTH); this fails only after nodemailer\'s own 2-minute clock\n' +
    '      runs out, which is the signature of the network silently dropping the connection\n' +
    '      rather than your SMTP_* values being wrong. Pro and above allow outbound SMTP;\n' +
    '      switching to an HTTPS-based email API (Resend, SendGrid, Brevo) is the other way\n' +
    '      round it, and does not depend on the plan tier.',
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

  // Brevo (HTTPS API). Codes set by emailService's BrevoError.
  BREVO_UNAUTHORIZED:
    'Brevo rejected the API key (401). It is mistyped, was revoked, or has a stray space.\n' +
    '      Create a new one in Brevo: SMTP & API -> API Keys -> Generate a new API key,\n' +
    '      and paste it into BREVO_API_KEY exactly.',
  BREVO_SENDER_UNKNOWN:
    'BREVO_SENDER_EMAIL is not one of the senders in this Brevo account.\n' +
    '      Add it in Brevo under Senders (Senders, Domains & Dedicated IPs), click the link in\n' +
    '      the confirmation email Brevo sends to that address, then run this again.',
  BREVO_SENDER_INACTIVE:
    'The sender exists in Brevo but has not been verified yet.\n' +
    '      Open the confirmation email Brevo sent to that address and click its link.',
  BREVO_SENDER_INVALID:
    'Brevo refused the sender address on send. It must be a verified sender in this\n' +
    '      Brevo account (Senders), spelled exactly as in BREVO_SENDER_EMAIL.',
  BREVO_TIMEOUT: 'Brevo did not answer in time. Usually temporary: try again in a minute.',
  BREVO_UNREACHABLE:
    "Could not reach api.brevo.com at all. Check this machine's internet connection;\n" +
    '      Railway allows outbound HTTPS, so on the deployment this should not happen.',
};

// nodemailer's own connection-phase timeouts (checked in
// node_modules/nodemailer/dist/cjs/smtp-connection/index.js for v10.3.1)
// carry `.timeoutType`, not `.code` — so a lookup keyed on `.code` alone
// missed every one of these and fell through to a bare "Reason: undefined",
// a stack trace standing in for an answer on the one case (CONNECT_TIMEOUT)
// that is the most common real-world failure this script will ever see.
//
// SOCKET_TIMEOUT is deliberately absent: nodemailer gives that one BOTH a
// code (ETIMEDOUT, already in ERROR_HINTS above) and a timeoutType, so the
// `.code` lookup already finds it and this table would only ever duplicate
// that entry.
const TIMEOUT_TYPE_HINTS = {
  CONNECT_TIMEOUT: ERROR_HINTS.CONNECT_TIMEOUT,
  GREETING_TIMEOUT:
    'The connection opened, but the server never sent its SMTP greeting.\n' +
    '      The host answered at the TCP level, so this is less likely to be a platform-wide\n' +
    '      block and more likely a server that is up but not behaving as an SMTP server on\n' +
    '      this port — double-check SMTP_HOST and SMTP_PORT.',
  UPGRADE_TIMEOUT:
    'Connected, but the TLS handshake (STARTTLS) never completed.\n' +
    '      SMTP_PORT and the TLS mode usually disagree — 465 expects implicit TLS from the\n' +
    '      start, 587 expects a plain connection that then upgrades via STARTTLS.',
};

function line(label, value) {
  console.log(`  ${String(label).padEnd(22)} ${value}`);
}

function describeError(error) {
  // `.code` first — it's what most failures (EAUTH, EDNS, ...) actually
  // carry — and only then `.timeoutType`, which is how the connection-phase
  // timeouts identify themselves instead.
  const reasonKey = error?.code || error?.timeoutType;
  const hint = ERROR_HINTS[error?.code] || TIMEOUT_TYPE_HINTS[error?.timeoutType];
  console.log(`\n  Reason: ${reasonKey || 'unknown'} — ${error?.message || error}`);
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
    console.log('\n  To switch it on (works on Railway, free): Brevo over HTTPS.');
    console.log('    BREVO_API_KEY=<Brevo: SMTP & API -> API Keys>');
    console.log('    BREVO_SENDER_EMAIL=<an address verified in Brevo -> Senders>');
    console.log('\n  Or, where outbound SMTP is allowed (not on Railway Hobby/Free):');
    console.log('    SMTP_HOST=smtp.gmail.com');
    console.log('    SMTP_PORT=465');
    console.log('    SMTP_USER=<the sending mailbox>');
    console.log('    SMTP_PASS=<a 16-character Google App Password>');
    console.log('    SMTP_FROM=<the same address>');
    console.log('\n  See backend/.env.example for the full notes.\n');
    return false;
  }

  line('Transport', summary.transport);
  if (summary.transport === 'brevo') {
    line('Sending as', `${summary.brevo.senderName} <${summary.brevo.senderEmail}>`);
    // Presence only, never any part of the key.
    line('API key', summary.brevo.keySet ? 'set' : 'MISSING');
    if (/@(gmail|yahoo|outlook|hotmail)\./i.test(summary.brevo.senderEmail || '')) {
      console.log('\n  Note: a free-mail sender cannot be authenticated, so Brevo rewrites it to an');
      console.log('  address like name@<id>.brevosend.com. Mail still arrives, but tell users to');
      console.log("  check their spam folder. A domain of the school's own would remove this.");
    }
  }
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

  // (No FRONTEND_URL check any more: since 2026-11-15 the reset email carries
  // a 6-digit code rather than a link, so there is no address to get wrong.)
  console.log('\nConnection');
  console.log('----------');
  const result = await emailService.verifyTransport();

  if (result.ok === null) {
    console.log(`  ${result.unverifiable}`);
  } else if (result.ok) {
    console.log(summary.transport === 'brevo' ? '  Brevo accepted the API key, and the sender is verified.' : '  Connected and authenticated successfully.');
  } else {
    console.log(summary.transport === 'brevo' ? '  FAILED — Brevo refused the API key or the sender.' : '  FAILED — the server refused the connection or the credentials.');
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
    // Deliberately through the REAL sendPasswordResetCode rather than a
    // send written here: a diagnostic that exercises a parallel path can
    // pass while the path that runs in production is broken.
    const sampleCode = '123456';
    await emailService.sendPasswordResetCode(testRecipient, sampleCode);

    if (summary.transport === 'console') {
      // Say what actually happened. Reporting "sent" here would be the exact
      // thing this script exists to catch, committed by the script itself.
      console.log('  Written to the console above — NOT sent. That is what the console');
      console.log('  transport does; configure Brevo (or SMTP) to send for real.');
    } else {
      console.log('  Sent. Check that inbox (and its spam folder).');
    }

    console.log(`\n  The code in it (${sampleCode}) is a SAMPLE and resets nothing.\n`);
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
    // chain, not only read by a person. exitCode rather than process.exit():
    // exiting abruptly while fetch's connection to Brevo is still closing
    // crashes Node on Windows (a libuv assertion), turning a clean "FAILED"
    // into exit 127. Letting the event loop drain avoids it.
    process.exitCode = ok ? 0 : 1;
  })
  .catch((error) => {
    console.error('\ncheck:email could not run:', error?.message || error, '\n');
    process.exitCode = 1;
  });
