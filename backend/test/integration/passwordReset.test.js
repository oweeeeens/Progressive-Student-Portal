// The self-service forgot-password flow, which had no automated coverage at
// all — accountSecurity.test.js exercises only the admin-triggered manual
// reset.
//
// The gap mattered. An admin locked themselves out of the live deployment,
// and the route back in was this flow; it was switched off, and the one
// property a test here would have caught — that a reset request finds the
// account whatever case the email is typed in — was quietly false. A
// wrong-case request found nothing and still answered "if an account
// exists, a link has been sent."
//
// WHY MOST OF THIS IS NOT DRIVEN THROUGH HTTP, unlike accountSecurity's
// tests. Both reset routes share one rate limiter of 5 requests per IP per
// 15 minutes, and config/rateLimits.js says in as many words that it is
// deliberately NOT configurable, because unlike the login limit it protects
// somebody else's inbox. That is the right call and this file does not
// weaken it. So the token's security properties — hashing, single use,
// expiry, supersession — are exercised against the service that owns them,
// and the small HTTP budget is spent on the two things that are genuinely
// HTTP behaviour: that the endpoint cannot be used to discover which
// addresses have accounts, and that a link redeems end to end.
//
// Email itself is stubbed. What is under test is the token and the lookup,
// not Resend or SMTP; the reset URL is captured from the stub so the rest
// of the flow can be driven exactly as a real user would.
const { test, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');

const { startTestServer } = require('./helpers/testServer');
const { createClient } = require('./helpers/client');
const fixtures = require('./helpers/fixtures');
const emailService = require('../../services/emailService');
const passwordReset = require('../../services/passwordReset');
const { hashResetToken } = require('../../utils/password');
const { pool } = require('../../config/db');

const FIXTURE_PASSWORD = 'IntegrationTest123!';

let server;
let api;
let user;
// Every (recipient, url) the flow tried to send, newest last.
let sent = [];

before(async () => {
  server = await startTestServer();
  api = createClient(server.baseUrl);
  user = await fixtures.createStaffUser('adviser', 'pwreset-adviser');

  // Both are read from the environment at module load, so without this the
  // result would depend on whatever the developer's .env happens to say.
  // These stand in on the module object, which is why authController and
  // passwordReset reference it rather than destructuring at import.
  mock.method(emailService, 'canSendEmail', () => true);
  mock.method(emailService, 'sendPasswordResetEmail', async (toEmail, resetUrl) => {
    sent.push({ toEmail, resetUrl });
  });
});

after(async () => {
  mock.reset();
  // close() first, and it is not optional: fetch keeps its sockets alive,
  // so without closeAllConnections the server never finishes closing and
  // the test process hangs. See helpers/testServer.js.
  await server.close();
  // The reset tokens go with the user — password_reset_tokens is the one
  // table in this schema with ON DELETE CASCADE.
  await fixtures.teardown({ userIds: [user.id] });
});

// Issues a link the way the API does, and hands back the raw token that
// only ever exists in the email.
async function requestLink(email = user.email) {
  await passwordReset.requestSelfServiceReset(email);
  const last = sent[sent.length - 1];
  return last ? new URL(last.resetUrl).searchParams.get('token') : null;
}

test('a reset request finds the account however the email is capitalised', async () => {
  sent = [];
  // The exact failure that left an admin with no way back in: the lookup
  // was a case-sensitive match, so this found nothing — and the flow
  // reports success either way, so it looked like it had worked.
  await passwordReset.requestSelfServiceReset(user.email.toUpperCase());

  assert.equal(sent.length, 1, 'an email should have been sent for the upper-cased address');
  assert.equal(sent[0].toEmail, user.email);
});

test('the raw token is never stored — only its hash', async () => {
  sent = [];
  const rawToken = await requestLink();

  const { rows } = await pool.query('SELECT token_hash FROM password_reset_tokens WHERE user_id = $1', [
    user.id,
  ]);
  assert.ok(rows.length > 0);
  for (const row of rows) {
    assert.notEqual(row.token_hash, rawToken, 'the raw token must not be in the database');
  }
  assert.ok(
    rows.some((row) => row.token_hash === hashResetToken(rawToken)),
    'the stored hash should be the SHA-256 of the emailed token'
  );
});

test('a reset link works once, and is refused the second time', async () => {
  sent = [];
  const rawToken = await requestLink();

  assert.equal(await passwordReset.completeSelfServiceReset(rawToken, 'FirstChoice123!'), true);
  // Replay. Without single-use enforcement, anyone who ever saw the link —
  // a forwarded email, a shared screen, a browser history — could keep
  // using it for the rest of the hour.
  assert.equal(await passwordReset.completeSelfServiceReset(rawToken, 'SecondChoice123!'), false);

  // And the password is the first choice, not the replayed second.
  const login = await api.post('/api/auth/login', {
    body: { email: user.email, password: 'FirstChoice123!' },
  });
  assert.equal(login.status, 200);
});

test('requesting a new link invalidates the previous one', async () => {
  sent = [];
  const olderToken = await requestLink();
  const newerToken = await requestLink();
  assert.notEqual(olderToken, newerToken);

  assert.equal(
    await passwordReset.completeSelfServiceReset(olderToken, 'FromOldLink123!'),
    false,
    'the superseded link must stop working'
  );
  assert.equal(await passwordReset.completeSelfServiceReset(newerToken, FIXTURE_PASSWORD), true);
});

test('an expired link is refused', async () => {
  sent = [];
  const rawToken = await requestLink();

  // Expiry is enforced in the model's WHERE clause against now(), so moving
  // the row's expiry into the past is the honest way to test it — no clock
  // mocking, and it exercises the real query.
  await pool.query(
    "UPDATE password_reset_tokens SET expires_at = now() - interval '1 minute' WHERE token_hash = $1",
    [hashResetToken(rawToken)]
  );

  assert.equal(await passwordReset.completeSelfServiceReset(rawToken, 'TooLate123!'), false);
});

test('a reset clears the forced-password-change flag', async () => {
  sent = [];
  await pool.query('UPDATE users SET must_change_password = TRUE WHERE id = $1', [user.id]);

  const rawToken = await requestLink();
  await passwordReset.completeSelfServiceReset(rawToken, FIXTURE_PASSWORD);

  // Choosing your own password IS what a forced change asks for, so landing
  // on the change-password screen straight afterwards would be a loop.
  const { rows } = await pool.query('SELECT must_change_password FROM users WHERE id = $1', [user.id]);
  assert.equal(rows[0].must_change_password, false);
});

test('no link is issued for a deactivated account', async () => {
  sent = [];
  await pool.query('UPDATE users SET is_active = FALSE WHERE id = $1', [user.id]);
  await passwordReset.requestSelfServiceReset(user.email);
  await pool.query('UPDATE users SET is_active = TRUE WHERE id = $1', [user.id]);

  assert.equal(sent.length, 0);
});

// --- Over HTTP. Three requests against the shared 5-per-15-minutes budget,
// --- so nothing above may be moved down here without raising that limit.

test('the endpoint cannot be used to discover which addresses have accounts', async () => {
  sent = [];
  const unknown = await api.post('/api/auth/forgot-password', {
    body: { email: 'nobody-with-this-address@integration.test' },
  });
  const known = await api.post('/api/auth/forgot-password', { body: { email: user.email } });

  // Same status and same body: a roster of minors' email addresses is
  // exactly what must not leak out of an unauthenticated endpoint.
  assert.equal(unknown.status, 200);
  assert.equal(unknown.status, known.status);
  assert.deepEqual(unknown.body, known.body);
  // ...and only the real address was actually sent anything.
  assert.equal(sent.length, 1);
  assert.equal(sent[0].toEmail, user.email);
});

test('a link redeems end to end, over the real endpoints', async () => {
  // Reuses the link the previous test issued rather than asking for another
  // one: the budget is five requests and these are the last of them.
  const rawToken = new URL(sent[sent.length - 1].resetUrl).searchParams.get('token');

  const reset = await api.post('/api/auth/reset-password', {
    body: { token: rawToken, newPassword: FIXTURE_PASSWORD },
  });
  assert.equal(reset.status, 200);

  const login = await api.post('/api/auth/login', {
    body: { email: user.email, password: FIXTURE_PASSWORD },
  });
  assert.equal(login.status, 200);
});
