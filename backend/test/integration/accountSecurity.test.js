// Authentication, User Management and the student-record scoping that
// protects minors' data — three areas CLAUDE.md makes explicit commitments
// about and which had no automated coverage at all.
//
// The rest of the suite deliberately bypasses login by signing JWTs directly
// (helpers/auth.js), which is right for testing a grade workflow and wrong
// for testing the door itself. Everything here goes through the real
// endpoints with real passwords.
//
// The registrar-versus-admin tests are the ones that matter most: that hole
// was open until this session, and a single authorization test here would
// have caught it the day it was written.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { startTestServer } = require('./helpers/testServer');
const { createClient } = require('./helpers/client');
const fixtures = require('./helpers/fixtures');
const { pool } = require('../../config/db');

// The password fixtures.createStaffUser sets on every account it makes.
const FIXTURE_PASSWORD = 'IntegrationTest123!';

let server;
let api;
let ctx;

before(async () => {
  server = await startTestServer();
  api = createClient(server.baseUrl);

  const { schoolYearId, periods } = await fixtures.createSchoolYearWithPeriods('SEC', [
    { name: 'Q1', sequenceNumber: 1, startDate: '2035-06-01', endDate: '2035-08-31' },
  ]);

  const [admin, registrar, adviser, otherAdviser, teacher, counselor] = await Promise.all([
    fixtures.createStaffUser('admin', 'sec-admin'),
    fixtures.createStaffUser('registrar', 'sec-registrar'),
    fixtures.createStaffUser('adviser', 'sec-adviser'),
    fixtures.createStaffUser('adviser', 'sec-other-adviser'),
    fixtures.createStaffUser('subject_teacher', 'sec-teacher'),
    fixtures.createStaffUser('guidance_counselor', 'sec-counselor'),
  ]);

  const section = await fixtures.createTestSection({ schoolYearId, adviserId: adviser.id, label: 'sec-own' });
  const otherSection = await fixtures.createTestSection({
    schoolYearId,
    adviserId: otherAdviser.id,
    label: 'sec-other',
  });
  const subject = await fixtures.createTestSubject('sec-subject');
  const offering = await fixtures.createTestOffering({
    subjectId: subject.id,
    sectionId: section.id,
    teacherId: teacher.id,
    schoolYearId,
  });

  const ownStudent = await fixtures.createTestStudent({
    sectionId: section.id,
    label: 'sec-own-student',
    // Needed so the scoping test can provision a real portal account for
    // them and sign in as a student.
    email: `sec-own-student-${Date.now()}@integration.test`,
  });
  const otherStudent = await fixtures.createTestStudent({ sectionId: otherSection.id, label: 'sec-other-student' });

  ctx = {
    schoolYearId,
    periods,
    admin,
    registrar,
    adviser,
    otherAdviser,
    teacher,
    counselor,
    section,
    otherSection,
    subject,
    offering,
    ownStudent,
    otherStudent,
  };
});

after(async () => {
  // Accounts this suite created through the API rather than through
  // fixtures, so teardown's id list would not know about them.
  await pool.query("DELETE FROM users WHERE email LIKE 'sec-api-%@integration.test'");

  await fixtures.teardown({
    schoolYearId: ctx.schoolYearId,
    ownSchoolYear: true,
    userIds: [
      ctx.admin.id,
      ctx.registrar.id,
      ctx.adviser.id,
      ctx.otherAdviser.id,
      ctx.teacher.id,
      ctx.counselor.id,
    ],
    studentIds: [ctx.ownStudent.id, ctx.otherStudent.id],
    subjectIds: [ctx.subject.id],
    sectionIds: [ctx.section.id, ctx.otherSection.id],
    offeringIds: [ctx.offering.id],
  });
  await server.close();
});

// --- Authentication -------------------------------------------------------

test('login issues a token for the right password and refuses the wrong one', async () => {
  const good = await api.post('/api/auth/login', {
    body: { email: ctx.adviser.email, password: FIXTURE_PASSWORD },
  });
  assert.equal(good.status, 200, JSON.stringify(good.body));
  assert.ok(good.body.token);
  assert.equal(good.body.user.email, ctx.adviser.email);
  // Never the hash, on any path.
  assert.equal(good.body.user.passwordHash, undefined);
  assert.equal(good.body.user.password_hash, undefined);

  const bad = await api.post('/api/auth/login', {
    body: { email: ctx.adviser.email, password: 'NotThePassword123!' },
  });
  assert.equal(bad.status, 401);
  // The same message either way: a different one for "no such account"
  // would let anyone enumerate which emails exist.
  const noSuchUser = await api.post('/api/auth/login', {
    body: { email: 'nobody-at-all@integration.test', password: FIXTURE_PASSWORD },
  });
  assert.equal(noSuchUser.status, 401);
  assert.equal(noSuchUser.body.error, bad.body.error);
});

test('a deactivated account loses access immediately, mid-session', async () => {
  const victim = await fixtures.createStaffUser('adviser', 'sec-deactivated');
  try {
    const login = await api.post('/api/auth/login', {
      body: { email: victim.email, password: FIXTURE_PASSWORD },
    });
    assert.equal(login.status, 200);
    const token = login.body.token;

    const before = await api.get('/api/auth/me', { token });
    assert.equal(before.status, 200);

    await api.patch(`/api/users/${victim.id}/active`, {
      token: ctx.admin.token,
      body: { isActive: false },
    });

    // The token is still cryptographically valid — is_active is re-checked
    // on every request, which is what makes deactivation take effect at
    // once rather than whenever the token happens to expire.
    const afterDeactivation = await api.get('/api/auth/me', { token });
    assert.equal(afterDeactivation.status, 401);
  } finally {
    await pool.query('DELETE FROM users WHERE id = $1', [victim.id]);
  }
});

test('an account on a temporary password cannot use the app until it changes it', async () => {
  // How every account starts: created by an admin, forced to change.
  const created = await api.post('/api/auth/register', {
    token: ctx.admin.token,
    body: {
      fullName: 'Forced Change',
      email: `sec-api-forced-${Date.now()}@integration.test`,
      role: 'guidance_counselor',
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.ok(created.body.tempPassword, 'the temp password is revealed exactly once, here');

  const login = await api.post('/api/auth/login', {
    body: { email: created.body.user.email, password: created.body.tempPassword },
  });
  assert.equal(login.status, 200);
  const token = login.body.token;

  // Blocked everywhere except the auth routes it needs to fix itself.
  const blocked = await api.get('/api/students', { token });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.mustChangePassword, true);

  const changed = await api.post('/api/auth/change-password', {
    token,
    body: { currentPassword: created.body.tempPassword, newPassword: 'ARealPassword123!' },
  });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));

  const allowed = await api.get('/api/students', { token });
  assert.equal(allowed.status, 200);
});

// --- User Management: the admin-takeover guard ----------------------------

test('a registrar cannot reset an admin account\'s password', async () => {
  // This was a one-request account takeover: the handler had no check on the
  // target and returned the new password in the response body.
  const res = await api.post(`/api/users/${ctx.admin.id}/reset-password`, { token: ctx.registrar.token });
  assert.equal(res.status, 403);
  assert.equal(res.body.tempPassword, undefined);

  // The admin's own password still works.
  const stillWorks = await api.post('/api/auth/login', {
    body: { email: ctx.admin.email, password: FIXTURE_PASSWORD },
  });
  assert.equal(stillWorks.status, 200);
});

test('a registrar cannot repoint an admin account\'s email', async () => {
  // The other half of the takeover: change the address, then use
  // forgot-password to receive the reset link.
  const res = await api.patch(`/api/users/${ctx.admin.id}`, {
    token: ctx.registrar.token,
    body: { email: 'attacker@integration.test' },
  });
  assert.equal(res.status, 403);

  const unchanged = await pool.query('SELECT email FROM users WHERE id = $1', [ctx.admin.id]);
  assert.equal(unchanged.rows[0].email, ctx.admin.email);
});

test('a registrar cannot deactivate an admin account', async () => {
  const res = await api.patch(`/api/users/${ctx.admin.id}/active`, {
    token: ctx.registrar.token,
    body: { isActive: false },
  });
  assert.equal(res.status, 403);

  const stillActive = await pool.query('SELECT is_active FROM users WHERE id = $1', [ctx.admin.id]);
  assert.equal(stillActive.rows[0].is_active, true);
});

test('a registrar can still manage every non-admin account', async () => {
  // The guard has to be narrow: blocking the registrar from their actual job
  // would be its own bug.
  //
  // A disposable target, because a reset sets must_change_password on that
  // account — doing it to a shared fixture would 403 every later test that
  // uses its token.
  const target = await fixtures.createStaffUser('subject_teacher', 'sec-reset-target');
  try {
    const reset = await api.post(`/api/users/${target.id}/reset-password`, { token: ctx.registrar.token });
    assert.equal(reset.status, 200, JSON.stringify(reset.body));
    assert.ok(reset.body.tempPassword);

    const renamed = await api.patch(`/api/users/${target.id}`, {
      token: ctx.registrar.token,
      body: { fullName: 'Renamed By Registrar' },
    });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.user.fullName ?? renamed.body.user.full_name, 'Renamed By Registrar');
  } finally {
    await pool.query('DELETE FROM users WHERE id = $1', [target.id]);
  }
});

test('an admin can still manage their own account', async () => {
  // The guard is "only that admin", not "no one" — otherwise the single
  // admin could never reset their own password through the UI.
  const res = await api.post(`/api/users/${ctx.admin.id}/reset-password`, { token: ctx.admin.token });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(res.body.tempPassword);

  // Put it back so the rest of the suite can still sign in as the admin.
  const { hashPassword } = require('../../utils/password');
  await pool.query('UPDATE users SET password_hash = $1, must_change_password = FALSE WHERE id = $2', [
    await hashPassword(FIXTURE_PASSWORD),
    ctx.admin.id,
  ]);
});

test('admin is never a role handed out or assigned through the API', async () => {
  const created = await api.post('/api/auth/register', {
    token: ctx.admin.token,
    body: { fullName: 'Should Not Exist', email: `sec-api-admin-${Date.now()}@integration.test`, role: 'admin' },
  });
  assert.equal(created.status, 400);

  const promoted = await api.patch(`/api/users/${ctx.counselor.id}`, {
    token: ctx.admin.token,
    body: { role: 'admin' },
  });
  // 400, not a silent no-op — CREATABLE_ROLES excludes admin on both paths.
  assert.equal(promoted.status, 400);
});

test('nobody can deactivate themselves into a lockout', async () => {
  const res = await api.patch(`/api/users/${ctx.admin.id}/active`, {
    token: ctx.admin.token,
    body: { isActive: false },
  });
  assert.equal(res.status, 400);
});

test('a role cannot be reassigned out from under an active assignment', async () => {
  // The teacher still teaches a class offering, which references them by id
  // and assumes their role still matches.
  const res = await api.patch(`/api/users/${ctx.teacher.id}`, {
    token: ctx.admin.token,
    body: { role: 'guidance_counselor' },
  });
  assert.equal(res.status, 409);
});

// --- Student record scoping: the privacy boundary -------------------------

test('an adviser sees their own section and not another adviser\'s', async () => {
  const own = await api.get(`/api/students/${ctx.ownStudent.id}`, { token: ctx.adviser.token });
  assert.equal(own.status, 200);

  // 404, not 403: a record outside your scope should not even confirm that
  // the id exists.
  const other = await api.get(`/api/students/${ctx.otherStudent.id}`, { token: ctx.adviser.token });
  assert.equal(other.status, 404);

  const list = await api.get('/api/students', { token: ctx.adviser.token });
  assert.equal(list.status, 200);
  const ids = list.body.students.map((s) => s.id);
  assert.ok(ids.includes(ctx.ownStudent.id));
  assert.ok(!ids.includes(ctx.otherStudent.id));
});

test('a subject teacher sees only students in the classes they teach', async () => {
  const taught = await api.get(`/api/students/${ctx.ownStudent.id}`, { token: ctx.teacher.token });
  assert.equal(taught.status, 200);

  const notTaught = await api.get(`/api/students/${ctx.otherStudent.id}`, { token: ctx.teacher.token });
  assert.equal(notTaught.status, 404);
});

test('a student sees their own record and nothing else', async () => {
  // Give the student an account the way the registrar would.
  const provisioned = await api.post('/api/users/bulk-create-student-accounts', {
    token: ctx.admin.token,
    body: { studentIds: [ctx.ownStudent.id] },
  });
  assert.equal(provisioned.status, 201, JSON.stringify(provisioned.body));
  const account = provisioned.body.created[0];
  assert.ok(account, 'the student should have been provisioned');

  const login = await api.post('/api/auth/login', {
    body: { email: account.email, password: account.tempPassword },
  });
  assert.equal(login.status, 200);
  const token = login.body.token;
  await api.post('/api/auth/change-password', {
    token,
    body: { currentPassword: account.tempPassword, newPassword: 'StudentOwnPass123!' },
  });

  // Their own record: visible.
  const own = await api.get(`/api/students/${ctx.ownStudent.id}`, { token });
  assert.equal(own.status, 200);

  // Any other student: not found, not merely hidden in the UI.
  const other = await api.get(`/api/students/${ctx.otherStudent.id}`, { token });
  assert.equal(other.status, 404);

  // The roster is exactly themselves — never a school-wide list.
  const list = await api.get('/api/students', { token });
  assert.equal(list.status, 200);
  assert.deepEqual(
    list.body.students.map((s) => s.id),
    [ctx.ownStudent.id]
  );

  // And no school-wide aggregate anywhere.
  const dashboard = await api.get('/api/dashboard/stats', { token });
  assert.equal(dashboard.status, 200);
  assert.deepEqual(dashboard.body.stats, {});

  const attention = await api.get('/api/dashboard/attention', { token });
  assert.equal(attention.status, 200);
  assert.deepEqual(attention.body.students ?? attention.body, []);

  // Staff-only modules are refused outright.
  for (const path of ['/api/academic-progress?gradingPeriodId=1', '/api/analytics/risk-distribution', '/api/users']) {
    const res = await api.get(path, { token });
    assert.equal(res.status, 403, `${path} should be refused for a student, got ${res.status}`);
  }
});

test('each learner-status field reaches exactly the roles config allows', async () => {
  // Not "hidden from everyone but the registrar" — the policy is per field,
  // and the distinction is the point. A subject teacher needs to know a
  // learner has a disability in order to teach them; whether that learner's
  // household receives 4Ps assistance is none of their business.
  await api.patch(`/api/students/${ctx.ownStudent.id}`, {
    token: ctx.registrar.token,
    body: { isPwd: true, is4ps: true },
  });

  const asRegistrar = await api.get(`/api/students/${ctx.ownStudent.id}`, { token: ctx.registrar.token });
  assert.equal(asRegistrar.status, 200);
  assert.equal(asRegistrar.body.student.is_pwd, true, 'precondition: the registrar sees everything');
  assert.equal(asRegistrar.body.student.is_4ps, true);

  const asTeacher = await api.get(`/api/students/${ctx.ownStudent.id}`, { token: ctx.teacher.token });
  assert.equal(asTeacher.status, 200);
  assert.equal(asTeacher.body.student.is_pwd, true, 'a teacher may know about a disability');
  assert.equal(asTeacher.body.student.is_4ps, undefined, "a teacher may NOT know about household assistance");

  // Whatever a staff role may see, the student never sees any of it about
  // themselves — the config leaves 'student' out of every list.
  const { fieldsVisibleTo } = require('../../config/learnerStatus');
  assert.deepEqual(fieldsVisibleTo('student'), []);
});

test('a role cannot write a learner-status field it cannot see', async () => {
  // The write gate, asserted on the helper both write paths now share.
  //
  // Over HTTP this is currently defence in depth: only admin and registrar
  // may write a student record at all, and both may see all three fields —
  // so no request can reach the gate today. That is exactly why it is worth
  // pinning here: the moment a narrower role gains write access, or a bulk
  // import runs under one, this is what stops a forbidden field being set.
  const { stripUnwritableLearnerStatusFields } = require('../../utils/learnerStatusVisibility');
  const submitted = { firstName: 'X', isPwd: true, is4ps: true, isAlsGraduate: true };

  const asTeacher = stripUnwritableLearnerStatusFields({ role: 'subject_teacher' }, submitted);
  assert.equal(asTeacher.isPwd, true, 'a teacher may see and therefore set is_pwd');
  assert.equal(asTeacher.is4ps, undefined, 'but never is_4ps');
  assert.equal(asTeacher.firstName, 'X', 'ordinary fields pass through untouched');

  const asStudent = stripUnwritableLearnerStatusFields({ role: 'student' }, submitted);
  assert.equal(asStudent.isPwd, undefined);
  assert.equal(asStudent.is4ps, undefined);
  assert.equal(asStudent.isAlsGraduate, undefined);

  const asRegistrar = stripUnwritableLearnerStatusFields({ role: 'registrar' }, submitted);
  assert.equal(asRegistrar.isPwd, true);
  assert.equal(asRegistrar.is4ps, true);
});
