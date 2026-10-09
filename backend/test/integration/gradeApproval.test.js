// Integration coverage for CLAUDE.md's 3-stage grade approval chain:
// subject teacher submits -> principal verifies/rejects -> adviser
// finalizes, including the reject-and-resubmit loop and the
// assignment-based ownership checks (see gradeController.js).
//
// Runs against the real Express app (routes -> middleware -> controllers ->
// models) and the real database — not mocked. Needs the dev backend's
// database already running (`npm run dev` once, in another terminal, or
// simply have the backend up as usual) before `npm run test:integration`.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { startTestServer } = require('./helpers/testServer');
const { createClient } = require('./helpers/client');
const fixtures = require('./helpers/fixtures');

let server;
let api;
let ctx;

before(async () => {
  server = await startTestServer();
  api = createClient(server.baseUrl);

  // A dedicated, far-future school year (2030) that can never overlap the
  // real dev-seeded "2026-2027" year or any other test file's date range —
  // see fixtures.js's isolation note.
  const { schoolYearId, periods } = await fixtures.createSchoolYearWithPeriods('GA', [
    { name: 'Q1', sequenceNumber: 1, startDate: '2030-01-01', endDate: '2030-03-31' },
  ]);
  const period = periods[0];

  const [teacherOwner, teacherOther, adviserOwner, adviserOther, principal] = await Promise.all([
    fixtures.createStaffUser('subject_teacher', 'teacher-owner'),
    fixtures.createStaffUser('subject_teacher', 'teacher-other'),
    fixtures.createStaffUser('adviser', 'adviser-owner'),
    fixtures.createStaffUser('adviser', 'adviser-other'),
    fixtures.createStaffUser('principal', 'principal'),
  ]);

  const section = await fixtures.createTestSection({
    schoolYearId,
    adviserId: adviserOwner.id,
    label: 'section',
  });
  const subject = await fixtures.createTestSubject('subject');
  const offering = await fixtures.createTestOffering({
    subjectId: subject.id,
    sectionId: section.id,
    teacherId: teacherOwner.id,
    schoolYearId,
  });

  const [studentX, studentY] = await Promise.all([
    fixtures.createTestStudent({ sectionId: section.id, label: 'student-x' }),
    fixtures.createTestStudent({ sectionId: section.id, label: 'student-y' }),
  ]);

  ctx = {
    schoolYearId,
    period,
    teacherOwner,
    teacherOther,
    adviserOwner,
    adviserOther,
    principal,
    section,
    subject,
    offering,
    studentX,
    studentY,
  };
});

after(async () => {
  await fixtures.teardown({
    schoolYearId: ctx.schoolYearId,
    ownSchoolYear: true,
    userIds: [
      ctx.teacherOwner.id,
      ctx.teacherOther.id,
      ctx.adviserOwner.id,
      ctx.adviserOther.id,
      ctx.principal.id,
    ],
    studentIds: [ctx.studentX.id, ctx.studentY.id],
    subjectIds: [ctx.subject.id],
    sectionIds: [ctx.section.id],
    offeringIds: [ctx.offering.id],
  });
  await server.close();
});

test('a teacher who does not teach this offering cannot submit grades for it', async () => {
  const res = await api.post('/api/grades', {
    token: ctx.teacherOther.token,
    body: {
      classOfferingId: ctx.offering.id,
      gradingPeriodId: ctx.period.id,
      entries: [{ studentId: ctx.studentX.id, gradeValue: 85 }],
    },
  });
  assert.equal(res.status, 403);
});

let gradeXId;
let gradeYId;

test('the assigned teacher can submit grades for both students (status: submitted)', async () => {
  const res = await api.post('/api/grades', {
    token: ctx.teacherOwner.token,
    body: {
      classOfferingId: ctx.offering.id,
      gradingPeriodId: ctx.period.id,
      entries: [
        { studentId: ctx.studentX.id, gradeValue: 70 },
        { studentId: ctx.studentY.id, gradeValue: 92 },
      ],
    },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.grades.length, 2);
  for (const grade of res.body.grades) {
    assert.equal(grade.status, 'submitted');
  }
  gradeXId = res.body.grades.find((g) => g.student_id === ctx.studentX.id).id;
  gradeYId = res.body.grades.find((g) => g.student_id === ctx.studentY.id).id;
});

test('an adviser who does not own the section cannot finalize its grades', async () => {
  const res = await api.post('/api/grades/finalize', {
    token: ctx.adviserOther.token,
    body: { sectionId: ctx.section.id, gradingPeriodId: ctx.period.id },
  });
  assert.equal(res.status, 403);
});

test('a non-admin, non-principal role cannot verify or reject grades', async () => {
  const verifyRes = await api.post('/api/grades/verify', {
    token: ctx.adviserOwner.token,
    body: { gradeIds: [gradeXId] },
  });
  assert.equal(verifyRes.status, 403);

  const rejectRes = await api.post('/api/grades/reject', {
    token: ctx.teacherOwner.token,
    body: { gradeIds: [gradeXId], note: 'nope' },
  });
  assert.equal(rejectRes.status, 403);
});

test('the principal rejects one grade with a note (status: rejected)', async () => {
  const res = await api.post('/api/grades/reject', {
    token: ctx.principal.token,
    body: { gradeIds: [gradeXId], note: 'Please recheck the quiz scores.' },
  });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.gradeIds, [gradeXId]);

  // The principal's "submitted" queue should no longer list the rejected row.
  const submitted = await api.get(`/api/grades/submitted?gradingPeriodId=${ctx.period.id}`, {
    token: ctx.principal.token,
  });
  const stillSubmitted = submitted.body.rows.some((r) => r.id === gradeXId);
  assert.equal(stillSubmitted, false);
});

test('the principal verifies the other grade (status: principal_verified)', async () => {
  const res = await api.post('/api/grades/verify', {
    token: ctx.principal.token,
    body: { gradeIds: [gradeYId] },
  });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.gradeIds, [gradeYId]);
});

test('finalizing too early only finalizes the verified grade, not the rejected one', async () => {
  const res = await api.post('/api/grades/finalize', {
    token: ctx.adviserOwner.token,
    body: { sectionId: ctx.section.id, gradingPeriodId: ctx.period.id },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.finalizedCount, 1);
  assert.deepEqual(res.body.studentIds, [ctx.studentY.id]);
});

test('the teacher resubmits the rejected grade — it returns to submitted and the rejection note clears', async () => {
  const res = await api.post('/api/grades', {
    token: ctx.teacherOwner.token,
    body: {
      classOfferingId: ctx.offering.id,
      gradingPeriodId: ctx.period.id,
      entries: [{ studentId: ctx.studentX.id, gradeValue: 95 }],
    },
  });
  assert.equal(res.status, 201);

  const submissions = await api.get(
    `/api/grades/by-offering?classOfferingId=${ctx.offering.id}&gradingPeriodId=${ctx.period.id}`,
    { token: ctx.teacherOwner.token }
  );
  assert.equal(submissions.status, 200);
  const row = submissions.body.submissions.find((s) => s.student_id === ctx.studentX.id);
  assert.equal(row.status, 'submitted');
  assert.equal(row.grade_value, '95.00');
  assert.equal(row.rejection_note, null);
});

test('the resubmitted grade goes through verify -> finalize and completes the chain', async () => {
  const verifyRes = await api.post('/api/grades/verify', {
    token: ctx.principal.token,
    body: { gradeIds: [gradeXId] },
  });
  assert.equal(verifyRes.status, 200);

  const finalizeRes = await api.post('/api/grades/finalize', {
    token: ctx.adviserOwner.token,
    body: { sectionId: ctx.section.id, gradingPeriodId: ctx.period.id },
  });
  assert.equal(finalizeRes.status, 200);
  assert.equal(finalizeRes.body.finalizedCount, 1);
  assert.deepEqual(finalizeRes.body.studentIds, [ctx.studentX.id]);

  const history = await api.get(`/api/students/${ctx.studentX.id}/grades`, { token: ctx.adviserOwner.token });
  assert.equal(history.status, 200);
  const finalGrade = history.body.grades.find((g) => g.id === gradeXId);
  assert.equal(finalGrade.status, 'finalized');
  assert.equal(finalGrade.grade_value, '95.00');
});
