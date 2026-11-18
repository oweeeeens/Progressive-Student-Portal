// One source of truth for a learner's name and email (found while checking
// the panel's "no duplicated copies of student data", 2026-11-18).
//
// A learner's portal account used to receive a COPY of their name and email
// when it was created, and nothing kept the two in step afterwards. These
// tests prove the record and the account now change together, both ways.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { startTestServer } = require('./helpers/testServer');
const { createClient } = require('./helpers/client');
const { signTestToken } = require('./helpers/auth');
const fixtures = require('./helpers/fixtures');
const { pool } = require('../../config/db');

let server;
let api;
const ctx = {};
const tag = Date.now().toString().slice(-7);
const account = async () => (await pool.query('SELECT full_name, email FROM users WHERE id = $1', [ctx.userId])).rows[0];
const record = async () => (await pool.query('SELECT first_name, last_name, email FROM students WHERE id = $1', [ctx.student.id])).rows[0];

before(async () => {
  server = await startTestServer();
  api = createClient(server.baseUrl);
  const { schoolYearId } = await fixtures.createSchoolYearWithPeriods('SYNC', [
    { name: 'T1', sequenceNumber: 1, startDate: '2044-06-01', endDate: '2044-08-31' },
  ]);
  ctx.schoolYearId = schoolYearId;
  const [registrar, adviser, other] = await Promise.all([
    fixtures.createStaffUser('registrar', 'sync-registrar'),
    fixtures.createStaffUser('adviser', 'sync-adviser'),
    fixtures.createStaffUser('subject_teacher', 'sync-other'),
  ]);
  Object.assign(ctx, { registrar, adviser, other });
  ctx.userIds = [registrar.id, adviser.id, other.id];
  ctx.section = await fixtures.createTestSection({ schoolYearId, adviserId: adviser.id, label: 'sync-section' });
  ctx.student = await fixtures.createTestStudent({ sectionId: ctx.section.id, label: 'sync-learner', email: `sync.learner.${tag}@integration.test` });

  // The account through the real path: the registrar creates it from the record.
  const created = await api.post('/api/auth/register', { token: registrar.token, body: { role: 'student', studentId: ctx.student.id } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  ctx.userId = created.body.user.id;
  ctx.userIds.push(ctx.userId);
  // The learner's first sign-in: change the temporary password.
  const changed = await api.post('/api/auth/change-password', {
    token: signTestToken(created.body.user),
    body: { currentPassword: created.body.tempPassword, newPassword: 'SyncLearner123!' },
  });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  ctx.learnerToken = changed.body.token;
});

after(async () => {
  await server.close();
  await pool.query('UPDATE students SET user_id = NULL WHERE id = $1', [ctx.student.id]);
  await fixtures.teardown({
    schoolYearId: ctx.schoolYearId,
    ownSchoolYear: true,
    userIds: ctx.userIds,
    studentIds: [ctx.student.id],
    sectionIds: [ctx.section.id],
  });
});

test('a registrar\'s correction to the record reaches the learner\'s account (name and login email)', async () => {
  const res = await api.patch(`/api/students/${ctx.student.id}`, {
    token: ctx.registrar.token,
    body: { firstName: 'Corrected', email: `corrected.${tag}@integration.test` },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const a = await account();
  const r = await record();
  assert.equal(a.full_name, `Corrected ${r.last_name}`);
  assert.equal(a.email, `corrected.${tag}@integration.test`);
});

test('an email another account already uses is refused, and NOTHING changes (one transaction)', async () => {
  const before = { a: await account(), r: await record() };
  const res = await api.patch(`/api/students/${ctx.student.id}`, {
    token: ctx.registrar.token,
    body: { firstName: 'ShouldNotStick', email: ctx.other.email },
  });
  assert.equal(res.status, 409, JSON.stringify(res.body));
  assert.deepEqual(await account(), before.a);
  assert.deepEqual(await record(), before.r, 'the record edit was rolled back with the account');
});

test('a learner changing their email in Profile updates their record too', async () => {
  const res = await api.patch('/api/auth/profile', {
    token: ctx.learnerToken,
    body: { email: `learner.own.${tag}@integration.test`, currentPassword: 'SyncLearner123!' },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal((await account()).email, `learner.own.${tag}@integration.test`);
  assert.equal((await record()).email, `learner.own.${tag}@integration.test`);
});

test('a learner cannot rename themselves in Profile — the name is the registrar\'s record', async () => {
  const current = (await account()).full_name;
  const refused = await api.patch('/api/auth/profile', { token: ctx.learnerToken, body: { fullName: 'Someone Else' } });
  assert.equal(refused.status, 400);
  assert.match(refused.body.error, /registrar/);
  assert.equal((await account()).full_name, current);
  // Sending the unchanged name (the form always sends it) is fine.
  const same = await api.patch('/api/auth/profile', { token: ctx.learnerToken, body: { fullName: current } });
  assert.equal(same.status, 200);
});

test('a staff member can still change their own name', async () => {
  const res = await api.patch('/api/auth/profile', { token: ctx.adviser.token, body: { fullName: 'Renamed Adviser' } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.user.fullName, 'Renamed Adviser');
});
