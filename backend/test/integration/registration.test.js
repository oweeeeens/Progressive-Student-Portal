// The student registration form (GET /api/students/:id/registration) —
// panel item 2. The registrar and admin open and edit it; the learner sees
// their own copy read-only; nobody else opens it. Its subject list is the
// learner's enrollments (class_enrollments) with each teacher.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { startTestServer } = require('./helpers/testServer');
const { createClient } = require('./helpers/client');
const fixtures = require('./helpers/fixtures');
const { pool } = require('../../config/db');

let server;
let api;
const ctx = { userIds: [], studentIds: [], offeringIds: [], subjectIds: [] };

before(async () => {
  server = await startTestServer();
  api = createClient(server.baseUrl);

  const { schoolYearId } = await fixtures.createSchoolYearWithPeriods('REG', [
    { name: 'T1', sequenceNumber: 1, startDate: '2042-06-01', endDate: '2042-08-31' },
  ]);
  ctx.schoolYearId = schoolYearId;
  ctx.schoolYearLabel = (await pool.query('SELECT label FROM school_years WHERE id = $1', [schoolYearId])).rows[0].label;

  const [admin, registrar, adviser, teacher, learnerUser, otherLearnerUser] = await Promise.all([
    fixtures.createStaffUser('admin', 'reg-admin'),
    fixtures.createStaffUser('registrar', 'reg-registrar'),
    fixtures.createStaffUser('adviser', 'reg-adviser'),
    fixtures.createStaffUser('subject_teacher', 'reg-teacher'),
    fixtures.createStaffUser('student', 'reg-learner'),
    fixtures.createStaffUser('student', 'reg-other-learner'),
  ]);
  Object.assign(ctx, { admin, registrar, adviser, teacher, learnerUser, otherLearnerUser });
  ctx.userIds.push(admin.id, registrar.id, adviser.id, teacher.id, learnerUser.id, otherLearnerUser.id);

  ctx.section = await fixtures.createTestSection({ schoolYearId, adviserId: adviser.id, label: 'reg-section' });
  for (const label of ['reg-math', 'reg-science']) {
    const subject = await fixtures.createTestSubject(label);
    ctx.subjectIds.push(subject.id);
    const offering = await fixtures.createTestOffering({ subjectId: subject.id, sectionId: ctx.section.id, teacherId: teacher.id, schoolYearId });
    ctx.offeringIds.push(offering.id);
  }

  ctx.student = await fixtures.createTestStudent({ sectionId: ctx.section.id, label: 'reg-student' });
  ctx.other = await fixtures.createTestStudent({ sectionId: ctx.section.id, label: 'reg-other' });
  ctx.studentIds.push(ctx.student.id, ctx.other.id);
  await pool.query('UPDATE students SET user_id = $1 WHERE id = $2', [learnerUser.id, ctx.student.id]);
  await pool.query('UPDATE students SET user_id = $1 WHERE id = $2', [otherLearnerUser.id, ctx.other.id]);
});

after(async () => {
  await server.close();
  await pool.query('UPDATE students SET user_id = NULL WHERE id = ANY($1::int[])', [ctx.studentIds]);
  await fixtures.teardown({
    schoolYearId: ctx.schoolYearId,
    ownSchoolYear: true,
    userIds: ctx.userIds,
    studentIds: ctx.studentIds,
    offeringIds: ctx.offeringIds,
    subjectIds: ctx.subjectIds,
    sectionIds: [ctx.section.id],
  });
});

const formOf = (token, id = ctx.student.id) => api.get(`/api/students/${id}/registration`, { token });

test('the registrar sees the full form, matching the database, and may edit it', async () => {
  const res = await formOf(ctx.registrar.token);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const reg = res.body.registration;
  assert.equal(res.body.canEdit, true);
  assert.equal(reg.lrn, ctx.student.lrn);
  assert.equal(reg.last_name, ctx.student.last_name);
  assert.equal(reg.grade_level, 11);
  assert.equal(reg.section_name, ctx.section.name);
  assert.equal(reg.strand, 'TEST');
  assert.equal(reg.school_year, ctx.schoolYearLabel);
  assert.match(reg.adviser_name, /reg-adviser/);
  assert.equal(reg.has_portal_account, true);
  // Subjects are the learner's enrollments, each with its teacher.
  assert.equal(reg.subjects.length, 2);
  assert.deepEqual(reg.subjects.map((s) => s.id).sort(), [...ctx.offeringIds].sort());
  assert.ok(reg.subjects.every((s) => /reg-teacher/.test(s.teacher_name)));
  // Not part of a registration form.
  assert.equal(reg.is_pwd, undefined);
  assert.equal(reg.is_4ps, undefined);
  assert.equal(reg.user_id, undefined);
});

test('the admin may open and edit it too', async () => {
  const res = await formOf(ctx.admin.token);
  assert.equal(res.status, 200);
  assert.equal(res.body.canEdit, true);
});

test('the learner sees their own copy, read-only, and no one else\'s', async () => {
  const own = await formOf(ctx.learnerUser.token);
  assert.equal(own.status, 200, JSON.stringify(own.body));
  assert.equal(own.body.canEdit, false);
  assert.equal(own.body.registration.id, ctx.student.id);

  const someoneElse = await formOf(ctx.learnerUser.token, ctx.other.id);
  assert.equal(someoneElse.status, 403);

  // Read-only means the edit route refuses them as well.
  const edit = await api.patch(`/api/students/${ctx.student.id}`, { token: ctx.learnerUser.token, body: { address: 'Changed by learner' } });
  assert.equal(edit.status, 403);
});

test('an adviser or a teacher cannot open the registration form', async () => {
  assert.equal((await formOf(ctx.adviser.token)).status, 403);
  assert.equal((await formOf(ctx.teacher.token)).status, 403);
});

test('an unknown learner is 404 for the registrar, and a bad id is 400', async () => {
  assert.equal((await formOf(ctx.registrar.token, 99999999)).status, 404);
  assert.equal((await api.get('/api/students/abc/registration', { token: ctx.registrar.token })).status, 400);
});

test('an edit saved through the student form appears on the registration form', async () => {
  const saved = await api.patch(`/api/students/${ctx.student.id}`, {
    token: ctx.registrar.token,
    body: { address: 'Molino IV, Bacoor City', guardianName: 'Maria Reg Test' },
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const reg = (await formOf(ctx.learnerUser.token)).body.registration;
  assert.equal(reg.address, 'Molino IV, Bacoor City');
  assert.equal(reg.guardian_name, 'Maria Reg Test');
});
