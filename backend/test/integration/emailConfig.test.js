// How the SMTP settings are read out of the environment.
//
// No database and no network: this is configuration parsing, and the only
// reason it needs a test is that one piece of it could silently break a
// WORKING credential.
//
// Google displays an App Password as sixteen lowercase letters in four
// spaced groups (`abcd efgh ijkl mnop`), and people paste what they see.
// Google ignores the spaces; a Railway variable does not, so nodemailer gets
// the spaced string. Stripping them is the fix — but an arbitrary SMTP
// password may legitimately CONTAIN a space, and stripping that would turn a
// working mailbox into an EAUTH nobody can explain.
//
// So the strip is deliberately narrow: Gmail host, and exactly sixteen
// letters once whitespace is removed. These tests pin both halves — that it
// de-spaces what it should, and that it leaves alone everything else.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const nodemailer = require('nodemailer');

const EMAIL_SERVICE = require.resolve('../../services/emailService');
const SMTP_VARS = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'SMTP_PORT', 'SMTP_FROM', 'RESEND_API_KEY', 'BREVO_API_KEY', 'BREVO_SENDER_EMAIL', 'BREVO_SENDER_NAME'];

let originalCreateTransport;
let originalEnv;
let captured;

before(() => {
  originalEnv = Object.fromEntries(SMTP_VARS.map((key) => [key, process.env[key]]));
  // The transport options are the only place the normalised password is
  // observable — emailService never exposes it, which is the point.
  originalCreateTransport = nodemailer.createTransport;
  nodemailer.createTransport = (options) => {
    captured = options;
    return originalCreateTransport.call(nodemailer, options);
  };
});

after(() => {
  nodemailer.createTransport = originalCreateTransport;
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  delete require.cache[EMAIL_SERVICE];
});

// The settings are read once, at module load, so each case reloads the
// module under a different environment.
function loadWith(env) {
  for (const key of SMTP_VARS) delete process.env[key];
  Object.assign(process.env, env);
  captured = null;
  delete require.cache[EMAIL_SERVICE];
  const service = require('../../services/emailService');
  return { service, transport: captured };
}

const GMAIL = { SMTP_HOST: 'smtp.gmail.com', SMTP_USER: 'school@gmail.com' };

test('a Gmail App Password keeps working with the spaces Google shows', () => {
  const { transport } = loadWith({ ...GMAIL, SMTP_PASS: 'abcd efgh ijkl mnop' });
  assert.equal(transport.auth.pass, 'abcdefghijklmnop');
});

test('and when it has already been de-spaced by hand', () => {
  const { transport } = loadWith({ ...GMAIL, SMTP_PASS: 'abcdefghijklmnop' });
  assert.equal(transport.auth.pass, 'abcdefghijklmnop');
});

test('surrounding whitespace is removed from every SMTP setting', () => {
  // The ordinary paste accident: a trailing newline or space picked up from
  // a copied line. Never meaningful in a host, a username or an address.
  const { transport } = loadWith({
    SMTP_HOST: '  smtp.gmail.com\n',
    SMTP_USER: ' school@gmail.com ',
    SMTP_PASS: 'abcd efgh ijkl mnop\n',
    SMTP_FROM: '  school@gmail.com  ',
  });
  assert.equal(transport.host, 'smtp.gmail.com');
  assert.equal(transport.auth.user, 'school@gmail.com');
  assert.equal(transport.auth.pass, 'abcdefghijklmnop');
});

test('a real passphrase containing a space is left intact', () => {
  // The case the narrow rule exists to protect. Stripping here would break a
  // credential that works.
  const { transport } = loadWith({ ...GMAIL, SMTP_PASS: 'correct horse battery staple' });
  assert.equal(transport.auth.pass, 'correct horse battery staple');
});

test('a non-Gmail host never has its password de-spaced', () => {
  // Same sixteen letters, different provider: only Gmail displays App
  // Passwords this way, so only Gmail gets the special case.
  const { transport } = loadWith({
    SMTP_HOST: 'mail.deped.gov.ph',
    SMTP_USER: 'school@deped.gov.ph',
    SMTP_PASS: 'abcd efgh ijkl mnop',
  });
  assert.equal(transport.auth.pass, 'abcd efgh ijkl mnop');
});

test('a half-filled set of variables counts as not configured', () => {
  // Rather than being allowed to fail at send time, when somebody is already
  // waiting for a link.
  const { service } = loadWith({ SMTP_HOST: 'smtp.gmail.com', SMTP_USER: 'school@gmail.com' });
  assert.equal(service.activeEmailTransport(), null);
  assert.equal(service.canSendEmail(), false);
});

test('the port decides the TLS mode, and they always agree', () => {
  // 465 is implicit TLS and 587 is STARTTLS; a mismatch makes the connection
  // hang rather than fail cleanly, which is the hardest kind of failure to
  // diagnose from a deploy log.
  const implicit = loadWith({ ...GMAIL, SMTP_PASS: 'abcdefghijklmnop', SMTP_PORT: '465' });
  assert.equal(implicit.transport.port, 465);
  assert.equal(implicit.transport.secure, true);

  const starttls = loadWith({ ...GMAIL, SMTP_PASS: 'abcdefghijklmnop', SMTP_PORT: '587' });
  assert.equal(starttls.transport.port, 587);
  assert.equal(starttls.transport.secure, false);
});

test('the config summary never reveals the password', () => {
  // It reports presence only. There is no safely-masked form of a sixteen
  // character secret — a prefix of one is still four characters of it — so
  // the value must not appear in the summary in any shape.
  const { service } = loadWith({ ...GMAIL, SMTP_PASS: 'abcd efgh ijkl mnop' });
  const summary = service.emailConfigSummary();

  assert.equal(summary.smtp.passwordSet, true);
  assert.equal(summary.transport, 'smtp');
  assert.equal(summary.smtp.from, 'school@gmail.com');

  const serialised = JSON.stringify(summary);
  assert.ok(!serialised.includes('abcd'), 'the password must not appear in the summary');
  assert.ok(!serialised.includes('abcdefghijklmnop'), 'nor its de-spaced form');
});

test('with nothing configured, the flow reports itself unavailable', () => {
  // The deployed state today, and the one the login page handles honestly.
  const { service } = loadWith({});
  assert.equal(service.canSendEmail(), false);
  assert.equal(service.activeEmailTransport(), null);
});

test('an unconfigured transport reports that it cannot be verified', async () => {
  // Rather than reporting a pass that was never tested — the distinction the
  // whole diagnostic rests on.
  const { service } = loadWith({});
  const result = await service.verifyTransport();
  assert.equal(result.ok, null);
  assert.equal(result.transport, null);
  assert.match(result.unverifiable, /No email transport is configured/);
});

// ---------------------------------------------------------------------------
// Brevo — the HTTPS transport that works on Railway, where outbound SMTP is
// blocked. No network here either: global fetch is replaced by a stub that
// records the request and returns a canned response.
// ---------------------------------------------------------------------------
const BREVO = { BREVO_API_KEY: 'xkeysib-test-0123456789', BREVO_SENDER_EMAIL: 'portal.sender@gmail.com' };

function stubFetch(responder) {
  const calls = [];
  const original = global.fetch;
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    const { status = 200, body = {} } = responder(url, options) || {};
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  return { calls, restore: () => (global.fetch = original) };
}

test('Brevo is the transport when its key and sender are both set', () => {
  const { service } = loadWith(BREVO);
  assert.equal(service.activeEmailTransport(), 'brevo');
  assert.equal(service.canSendEmail(), true);
});

test('a Brevo key without a sender (or the reverse) counts as not configured', () => {
  assert.equal(loadWith({ BREVO_API_KEY: BREVO.BREVO_API_KEY }).service.activeEmailTransport(), null);
  assert.equal(loadWith({ BREVO_SENDER_EMAIL: BREVO.BREVO_SENDER_EMAIL }).service.canSendEmail(), false);
});

test('Brevo wins over SMTP, because only HTTPS gets out of a Railway container', () => {
  const { service } = loadWith({ ...BREVO, ...GMAIL, SMTP_PASS: 'abcdefghijklmnop' });
  assert.equal(service.activeEmailTransport(), 'brevo');
});

test('a reset email goes to Brevo\'s send endpoint with the key in the header only', async () => {
  const { service } = loadWith({ ...BREVO, BREVO_SENDER_NAME: '  Student Portal  ' });
  const stub = stubFetch(() => ({ status: 201, body: { messageId: '<abc@smtp-relay>' } }));
  try {
    await service.sendPasswordResetCode('learner@example.com', '482913', 15);
  } finally {
    stub.restore();
  }
  assert.equal(stub.calls.length, 1);
  const { url, options } = stub.calls[0];
  assert.equal(url, 'https://api.brevo.com/v3/smtp/email');
  assert.equal(options.method, 'POST');
  assert.equal(options.headers['api-key'], BREVO.BREVO_API_KEY);
  const body = JSON.parse(options.body);
  assert.deepEqual(body.sender, { name: 'Student Portal', email: 'portal.sender@gmail.com' });
  assert.deepEqual(body.to, [{ email: 'learner@example.com' }]);
  // The code, not a link: readable on one device, typed on another.
  assert.match(body.subject, /482913 is your Student Portal password reset code/);
  assert.match(body.htmlContent, /482913/);
  assert.match(body.textContent, /Your code: 482913/);
  assert.match(body.textContent, /expires in 15 minutes/);
  assert.ok(!/https?:\/\//.test(body.textContent), 'the email must not depend on a link');
  assert.ok(!options.body.includes(BREVO.BREVO_API_KEY), 'the key must not be in the body');
});

test('a rejected Brevo key becomes a thrown error naming the status, never the key', async () => {
  const { service } = loadWith(BREVO);
  const stub = stubFetch(() => ({ status: 401, body: { code: 'unauthorized', message: 'Key not found' } }));
  try {
    await assert.rejects(
      service.sendPasswordResetCode('learner@example.com', '000111'),
      (error) => {
        assert.equal(error.code, 'BREVO_UNAUTHORIZED');
        assert.match(error.message, /401/);
        assert.ok(!error.message.includes(BREVO.BREVO_API_KEY));
        return true;
      }
    );
  } finally {
    stub.restore();
  }
});

test('verifyTransport checks the key and that the sender is verified in Brevo', async () => {
  const { service } = loadWith(BREVO);
  const ok = stubFetch((url) => (url.endsWith('/senders')
    ? { body: { senders: [{ id: 1, email: 'Portal.Sender@gmail.com', active: true }] } }
    : { body: { email: 'owner@example.com' } }));
  try {
    assert.deepEqual(await service.verifyTransport(), { ok: true, transport: 'brevo' });
  } finally {
    ok.restore();
  }

  const unverified = stubFetch((url) => (url.endsWith('/senders')
    ? { body: { senders: [{ id: 1, email: 'portal.sender@gmail.com', active: false }] } }
    : { body: {} }));
  try {
    const result = await service.verifyTransport();
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'BREVO_SENDER_INACTIVE');
  } finally {
    unverified.restore();
  }

  const unknown = stubFetch((url) => (url.endsWith('/senders') ? { body: { senders: [] } } : { body: {} }));
  try {
    assert.equal((await service.verifyTransport()).error.code, 'BREVO_SENDER_UNKNOWN');
  } finally {
    unknown.restore();
  }
});

test('the config summary never reveals the Brevo key', () => {
  const { service } = loadWith(BREVO);
  const summary = service.emailConfigSummary();
  assert.equal(summary.brevo.keySet, true);
  assert.equal(summary.brevo.senderEmail, 'portal.sender@gmail.com');
  assert.ok(!JSON.stringify(summary).includes('xkeysib'), 'no part of the key may appear');
});
