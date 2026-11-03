// PATCH /api/auth/profile — the person editing their OWN name and email.
//
// There was no such endpoint until now: the only self-service account action
// was changing a password, so a staff member whose surname was misspelt at
// account creation, or who was given the wrong address, had to ask an admin.
//
// The reason this needs tests rather than just a handler is the email field.
// Whoever controls the address controls password recovery, so an email
// change is a credential change wearing a profile field's clothes: without
// the current-password check, a borrowed session or a stolen token could
// repoint recovery to an attacker's inbox and then take the account
// permanently through "Forgot password". Four of the cases below exist only
// to hold that check in place. The rest assert that nothing ELSE about the
// account is reachable from this endpoint — above all the role column.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { startTestServer } = require('./helpers/testServer');
const { createClient } = require('./helpers/client');
const fixtures = require('./helpers/fixtures');

// The password fixtures.createStaffUser gives every account it makes.
const FIXTURE_PASSWORD = 'IntegrationTest123!';

let server;
let api;
let ctx;

before(async () => {
  server = await startTestServer();
  api = createClient(server.baseUrl);

  const [teacher, other] = await Promise.all([
    fixtures.createStaffUser('subject_teacher', 'profile-self'),
    // A second account, purely so there is an address already taken.
    fixtures.createStaffUser('adviser', 'profile-other'),
  ]);

  ctx = { teacher, other };
});

after(async () => {
  await server.close();
  await fixtures.teardown({ userIds: [ctx.teacher.id, ctx.other.id] });
});

test('a name-only change needs no password', async () => {
  const res = await api.patch('/api/auth/profile', {
    token: ctx.teacher.token,
    body: { fullName: '  Renamed Teacher  ' },
  });
  assert.equal(res.status, 200);
  // Trimmed by the server, and the server's copy is what comes back — the
  // frontend seeds its form from this response rather than its own input.
  assert.equal(res.body.user.fullName, 'Renamed Teacher');
});

test('a blank name is refused', async () => {
  const res = await api.patch('/api/auth/profile', {
    token: ctx.teacher.token,
    body: { fullName: '   ' },
  });
  assert.equal(res.status, 400);
});

test('an email change without the current password is refused', async () => {
  const res = await api.patch('/api/auth/profile', {
    token: ctx.teacher.token,
    body: { email: 'moved-to-attacker@integration.test' },
  });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /current password/i);
});

test('an email change with the wrong current password is refused', async () => {
  const res = await api.patch('/api/auth/profile', {
    token: ctx.teacher.token,
    body: { email: 'moved-to-attacker@integration.test', currentPassword: 'not-the-password' },
  });
  assert.equal(res.status, 401);
});

test('neither refusal changed the stored address', async () => {
  // The point of the two cases above: a refused email change must leave the
  // account reachable at the address it had. Checked through /auth/me rather
  // than the database, so this asserts what the app itself would report.
  const me = await api.get('/api/auth/me', { token: ctx.teacher.token });
  assert.equal(me.status, 200);
  assert.equal(me.body.user.email, ctx.teacher.email.toLowerCase());
});

test('re-saving the same address in a different case is not a change', async () => {
  // Emails are stored lowercased, so the server has to compare
  // case-insensitively — otherwise simply pressing Save on an unchanged
  // profile would demand the current password for a no-op.
  const res = await api.patch('/api/auth/profile', {
    token: ctx.teacher.token,
    body: { email: ctx.teacher.email.toUpperCase() },
  });
  assert.equal(res.status, 200);
});

test('an address another account already uses is refused', async () => {
  const res = await api.patch('/api/auth/profile', {
    token: ctx.teacher.token,
    body: { email: ctx.other.email, currentPassword: FIXTURE_PASSWORD },
  });
  assert.equal(res.status, 409);
});

test('the role cannot be changed through this endpoint', async () => {
  // Not a 400 — `role` is simply not a field this handler reads. The
  // assertion is that the account comes back unchanged, which is the
  // property that matters: there is no body that makes this a way to
  // promote yourself.
  const res = await api.patch('/api/auth/profile', {
    token: ctx.teacher.token,
    body: { fullName: 'Renamed Teacher', role: 'admin' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.user.role, 'subject_teacher');

  const me = await api.get('/api/auth/me', { token: ctx.teacher.token });
  assert.equal(me.body.user.role, 'subject_teacher');
});

test('an email change with the correct password takes effect, and sign-in follows it', async () => {
  const newEmail = `profile-moved-${Date.now()}@integration.test`;

  const res = await api.patch('/api/auth/profile', {
    token: ctx.teacher.token,
    body: { email: newEmail, currentPassword: FIXTURE_PASSWORD },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.user.email, newEmail);

  // The real consequence of the change, asserted end to end: the account is
  // now reached at the new address with the same password. One login only —
  // the login limiter is 10 per IP per 15 minutes and is not configurable.
  const login = await api.post('/api/auth/login', {
    body: { email: newEmail, password: FIXTURE_PASSWORD },
  });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.email, newEmail);
});
