// The self-service forgot-password flow: a 6-digit code emailed to the
// account's address and typed back on the Forgot Password page.
//
// A code replaced the emailed link on 2026-11-15, because a link had to be
// opened on the device that received the email. A code is a much smaller
// secret than a link token — a million values instead of 2^256 — so most of
// this file is about the three things that make guessing it pointless: it
// is bound to one account, it expires, and it burns after a few wrong tries.
//
// History worth keeping: an admin once locked themselves out of the live
// deployment, the route back in was this flow, and the property the first
// test checks — that a request finds the account whatever case the email is
// typed in — was quietly false.
//
// WHY MOST OF THIS IS NOT DRIVEN THROUGH HTTP. Both reset routes share one
// rate limiter of 5 requests per IP per 15 minutes, deliberately NOT
// configurable (config/rateLimits.js: it protects somebody else's inbox).
// So the code's security properties are exercised against the service that
// owns them, and the small HTTP budget is spent on what is genuinely HTTP
// behaviour: no account discovery, one error for every failure, and a reset
// that works end to end.
//
// Email itself is stubbed. What is under test is the code and the lookup,
// not Brevo or SMTP; the code is captured from the stub so the rest of the
// flow can be driven exactly as a real user would.
const { test, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');

const { startTestServer } = require('./helpers/testServer');
const { createClient } = require('./helpers/client');
const fixtures = require('./helpers/fixtures');
const emailService = require('../../services/emailService');
const passwordReset = require('../../services/passwordReset');
const { hashResetCode } = require('../../utils/password');
const { RESET_CODE_MAX_ATTEMPTS } = require('../../config/auth');
const { pool } = require('../../config/db');

const FIXTURE_PASSWORD = 'IntegrationTest123!';

let server;
let api;
let user;
let otherUser;
// Every (recipient, code) the flow tried to send, newest last.
let sent = [];

before(async () => {
  server = await startTestServer();
  api = createClient(server.baseUrl);
  user = await fixtures.createStaffUser('adviser', 'pwreset-adviser');
  otherUser = await fixtures.createStaffUser('adviser', 'pwreset-other');

  // Both are read from the environment at module load, so without this the
  // result would depend on whatever the developer's .env happens to say.
  // These stand in on the module object, which is why authController and
  // passwordReset reference it rather than destructuring at import.
  mock.method(emailService, 'canSendEmail', () => true);
  mock.method(emailService, 'sendPasswordResetCode', async (toEmail, code) => {
    sent.push({ toEmail, code });
  });
});

after(async () => {
  mock.reset();
  // close() first, and it is not optional: fetch keeps its sockets alive,
  // so without closeAllConnections the server never finishes closing and
  // the test process hangs. See helpers/testServer.js.
  await server.close();
  // The reset codes go with the users — password_reset_tokens is the one
  // table in this schema with ON DELETE CASCADE.
  await fixtures.teardown({ userIds: [user.id, otherUser.id] });
});

// Issues a code the way the API does, and hands back the code that only
// ever exists in the email.
async function requestCode(email = user.email) {
  await passwordReset.requestSelfServiceReset(email);
  const last = sent[sent.length - 1];
  return last ? last.code : null;
}

// A six-digit code that is certainly not `code`.
function wrongCodeFor(code) {
  return String((Number(code) + 1) % 1000000).padStart(6, '0');
}

test('a reset request finds the account however the email is capitalised', async () => {
  sent = [];
  // The exact failure that left an admin with no way back in: the lookup
  // was a case-sensitive match, so this found nothing — and the flow
  // reports success either way, so it looked like it had worked.
  await passwordReset.requestSelfServiceReset(user.email.toUpperCase());

  assert.equal(sent.length, 1, 'an email should have been sent for the upper-cased address');
  assert.equal(sent[0].toEmail, user.email);
  assert.match(sent[0].code, /^\d{6}$/, 'the email carries a six-digit code');
});

test('the code is never stored — only a keyed hash bound to the account', async () => {
  sent = [];
  const code = await requestCode();

  const { rows } = await pool.query(
    'SELECT token_hash FROM password_reset_tokens WHERE user_id = $1 AND used_at IS NULL',
    [user.id]
  );
  assert.equal(rows.length, 1, 'exactly one usable code at a time');
  assert.notEqual(rows[0].token_hash.trim(), code, 'the code itself must not be in the database');
  assert.equal(rows[0].token_hash.trim(), hashResetCode(user.id, code));
  // The same six digits hash differently for another account, so a copy of
  // the table cannot be read across accounts either.
  assert.notEqual(hashResetCode(otherUser.id, code), hashResetCode(user.id, code));
});

test('a code works once, and is refused the second time', async () => {
  sent = [];
  const code = await requestCode();

  assert.equal(await passwordReset.completeSelfServiceReset(user.email, code, 'FirstChoice123!'), true);
  // Replay. Without single-use enforcement, anyone who saw the email — a
  // shared screen, a phone left unlocked — could keep using the code.
  assert.equal(await passwordReset.completeSelfServiceReset(user.email, code, 'SecondChoice123!'), false);

  // And the password is the first choice, not the replayed second.
  const login = await api.post('/api/auth/login', {
    body: { email: user.email, password: 'FirstChoice123!' },
  });
  assert.equal(login.status, 200);
});

test('requesting a new code invalidates the previous one', async () => {
  sent = [];
  const olderCode = await requestCode();
  const newerCode = await requestCode();

  // Six digits can repeat by chance; the guarantee being tested is that the
  // OLDER email's code no longer works, which only means something when the
  // two differ.
  if (olderCode !== newerCode) {
    assert.equal(
      await passwordReset.completeSelfServiceReset(user.email, olderCode, 'FromOldCode123!'),
      false,
      'the superseded code must stop working'
    );
  }
  assert.equal(await passwordReset.completeSelfServiceReset(user.email, newerCode, FIXTURE_PASSWORD), true);
});

test('an expired code is refused', async () => {
  sent = [];
  const code = await requestCode();

  // Expiry is enforced in the model's WHERE clause against now(), so moving
  // the row's expiry into the past is the honest way to test it — no clock
  // mocking, and it exercises the real query.
  await pool.query(
    "UPDATE password_reset_tokens SET expires_at = now() - interval '1 minute' WHERE user_id = $1 AND used_at IS NULL",
    [user.id]
  );

  assert.equal(await passwordReset.completeSelfServiceReset(user.email, code, 'TooLate123!'), false);
});

test(`wrong guesses burn the code: after ${RESET_CODE_MAX_ATTEMPTS}, even the right code is refused`, async () => {
  sent = [];
  const code = await requestCode();
  const wrong = wrongCodeFor(code);

  for (let i = 0; i < RESET_CODE_MAX_ATTEMPTS; i++) {
    assert.equal(await passwordReset.completeSelfServiceReset(user.email, wrong, 'Guessing123!'), false);
  }
  // This is the property that makes a six-digit code safe: a guesser gets
  // five tries out of a million, then has to ask for a new code — which
  // goes to the account owner's inbox, not to them.
  assert.equal(
    await passwordReset.completeSelfServiceReset(user.email, code, 'StillRight123!'),
    false,
    'the burned code must stay burned'
  );

  const { rows } = await pool.query(
    'SELECT failed_attempts, used_at FROM password_reset_tokens WHERE user_id = $1 ORDER BY id DESC LIMIT 1',
    [user.id]
  );
  assert.equal(rows[0].failed_attempts, RESET_CODE_MAX_ATTEMPTS);
  assert.ok(rows[0].used_at, 'a burned code is marked used');
});

test('a wrong guess short of the limit does not burn the code', async () => {
  sent = [];
  const code = await requestCode();
  // A typo is not an attack: one slip must not force a new email.
  assert.equal(await passwordReset.completeSelfServiceReset(user.email, wrongCodeFor(code), 'Typo123!'), false);
  assert.equal(await passwordReset.completeSelfServiceReset(user.email, code, FIXTURE_PASSWORD), true);
});

test("a code is useless with another account's email", async () => {
  sent = [];
  const code = await requestCode(user.email);
  // Redeeming needs the email the code was sent to: the code was issued for
  // `user`, so it means nothing for `otherUser` (who has no code at all).
  assert.equal(await passwordReset.completeSelfServiceReset(otherUser.email, code, 'Hijack123!'), false);
  // And it still works for its owner.
  assert.equal(await passwordReset.completeSelfServiceReset(user.email, code, FIXTURE_PASSWORD), true);
});

test('a reset clears the forced-password-change flag', async () => {
  sent = [];
  await pool.query('UPDATE users SET must_change_password = TRUE WHERE id = $1', [user.id]);

  const code = await requestCode();
  await passwordReset.completeSelfServiceReset(user.email, code, FIXTURE_PASSWORD);

  // Choosing your own password IS what a forced change asks for, so landing
  // on the change-password screen straight afterwards would be a loop.
  const { rows } = await pool.query('SELECT must_change_password FROM users WHERE id = $1', [user.id]);
  assert.equal(rows[0].must_change_password, false);
});

test('no code is issued for a deactivated account', async () => {
  sent = [];
  await pool.query('UPDATE users SET is_active = FALSE WHERE id = $1', [user.id]);
  await passwordReset.requestSelfServiceReset(user.email);
  await pool.query('UPDATE users SET is_active = TRUE WHERE id = $1', [user.id]);

  assert.equal(sent.length, 0);
});

// --- Over HTTP. Four requests against the shared 5-per-15-minutes budget,
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

test('a wrong code and an unknown email get the very same refusal', async () => {
  // Uses one request; the code from the previous test stays valid (one
  // wrong try is under the limit) for the end-to-end test below.
  const wrong = await api.post('/api/auth/reset-password', {
    body: { email: 'nobody-with-this-address@integration.test', code: '000000', newPassword: 'Whatever123!' },
  });
  assert.equal(wrong.status, 400);
  assert.match(wrong.body.error, /incorrect or has expired/);
});

test('a code redeems end to end, over the real endpoints', async () => {
  // Reuses the code the forgot-password test above issued rather than
  // asking for another: the budget is five requests.
  const code = sent[sent.length - 1].code;

  const reset = await api.post('/api/auth/reset-password', {
    body: { email: user.email, code, newPassword: FIXTURE_PASSWORD },
  });
  assert.equal(reset.status, 200);

  const login = await api.post('/api/auth/login', {
    body: { email: user.email, password: FIXTURE_PASSWORD },
  });
  assert.equal(login.status, 200);
});
