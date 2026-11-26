// The Staff Directory (2026-11-26): every signed-in user may read it,
// students included; a student never receives staff emails; the admin, the
// learners and inactive accounts are not listed; each person's assignments
// are the current year's, from the database; and a learner's own adviser and
// teachers are marked.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { startTestServer } = require('./helpers/testServer');
const { createClient } = require('./helpers/client');
const fixtures = require('./helpers/fixtures');
const { pool } = require('../../config/db');
const { signTestToken } = require('./helpers/auth');

let server;
let api;
const ctx = {};

before(async () => {
  server = await startTestServer();
  api = createClient(server.baseUrl);
  ctx.yearId = (await pool.query('SELECT id FROM school_years WHERE is_current = TRUE LIMIT 1')).rows[0].id;
  const users = await Promise.all([
    fixtures.createStaffUser('admin', 'dir-admin'),
    fixtures.createStaffUser('principal', 'dir-principal'),
    fixtures.createStaffUser('registrar', 'dir-registrar'),
    fixtures.createStaffUser('adviser', 'dir-adviser'),
    fixtures.createStaffUser('subject_teacher', 'dir-teacher'),
    fixtures.createStaffUser('subject_teacher', 'dir-gone'),
    fixtures.createStaffUser('student', 'dir-student-user'),
  ]);
  [ctx.admin, ctx.principal, ctx.registrar, ctx.adviser, ctx.teacher, ctx.gone, ctx.studentUser] = users;
  ctx.userIds = users.map((u) => u.id);
  await pool.query('UPDATE users SET is_active = FALSE WHERE id = $1', [ctx.gone.id]);

  ctx.section = await fixtures.createTestSection({ schoolYearId: ctx.yearId, adviserId: ctx.adviser.id, label: 'dir-sec' });
  const subj = await fixtures.createTestSubject('dir-subj');
  ctx.subjectId = subj.id;
  ctx.offering = await fixtures.createTestOffering({ subjectId: subj.id, sectionId: ctx.section.id, teacherId: ctx.teacher.id, schoolYearId: ctx.yearId });
  // A learner in that section, linked to the student account.
  ctx.learner = await fixtures.createTestStudent({ sectionId: ctx.section.id, label: 'dir-learner' });
  await pool.query('UPDATE students SET user_id = $1 WHERE id = $2', [ctx.studentUser.id, ctx.learner.id]);
});

after(async () => {
  await server.close();
  await pool.query('UPDATE students SET user_id = NULL WHERE id = $1', [ctx.learner.id]);
  await fixtures.teardown({
    schoolYearId: ctx.yearId,
    ownSchoolYear: false,
    userIds: ctx.userIds,
    studentIds: [ctx.learner.id],
    offeringIds: [ctx.offering.id],
    subjectIds: [ctx.subjectId],
    sectionIds: [ctx.section.id],
  });
});

const directory = (token) => api.get('/api/staff-directory', { token });
const entry = (body, user) => body.staff.find((s) => s.id === user.id);

test('every role may read it, students included', async () => {
  for (const who of ['admin', 'principal', 'registrar', 'adviser', 'teacher', 'studentUser']) {
    assert.equal((await directory(ctx[who].token)).status, 200, who);
  }
  assert.equal((await api.get('/api/staff-directory')).status, 401, 'but not signed out');
});

test('it lists the school\'s staff, never the admin, a learner or an inactive account', async () => {
  const { body } = await directory(ctx.registrar.token);
  for (const who of ['principal', 'registrar', 'adviser', 'teacher']) assert.ok(entry(body, ctx[who]), `${who} listed`);
  assert.ok(!entry(body, ctx.admin), 'the admin is a system account, not listed');
  assert.ok(!entry(body, ctx.studentUser), 'learners are not staff');
  assert.ok(!entry(body, ctx.gone), 'an inactive account is not listed');
  assert.ok(!body.staff.some((s) => ['admin', 'student', 'ict_faculty'].includes(s.role)));
});

test('each person\'s assignments are the current year\'s, from the database', async () => {
  const { body } = await directory(ctx.principal.token);
  assert.deepEqual(entry(body, ctx.adviser).advises.map((a) => a.sectionId), [ctx.section.id]);
  const taught = entry(body, ctx.teacher).teaches;
  assert.deepEqual(taught.map((c) => c.classOfferingId), [ctx.offering.id]);
  assert.equal(taught[0].section, ctx.section.name);
  // A deactivated class no longer counts.
  await pool.query('UPDATE class_offerings SET is_active = FALSE WHERE id = $1', [ctx.offering.id]);
  try {
    const after = await directory(ctx.principal.token);
    assert.deepEqual(entry(after.body, ctx.teacher).teaches, []);
  } finally {
    await pool.query('UPDATE class_offerings SET is_active = TRUE WHERE id = $1', [ctx.offering.id]);
  }
});

test('staff see work emails; a student never receives them', async () => {
  const staff = await directory(ctx.adviser.token);
  assert.equal(staff.body.showsEmail, true);
  assert.equal(entry(staff.body, ctx.teacher).email, ctx.teacher.email);

  const learner = await directory(signTestToken(ctx.studentUser));
  assert.equal(learner.body.showsEmail, false);
  assert.ok(learner.body.staff.every((s) => !('email' in s)), 'no email field at all, not just hidden');
});

test('a learner sees which staff are their adviser and their teacher', async () => {
  const { body } = await directory(ctx.studentUser.token);
  assert.equal(entry(body, ctx.adviser).isYourAdviser, true);
  assert.equal(entry(body, ctx.teacher).isYourTeacher, true);
  assert.equal(entry(body, ctx.principal).isYourAdviser, false);
  assert.equal(entry(body, ctx.principal).isYourTeacher, false);
  // Staff are not told who is "theirs".
  const staff = await directory(ctx.adviser.token);
  assert.ok(!('isYourAdviser' in entry(staff.body, ctx.teacher)));
});
