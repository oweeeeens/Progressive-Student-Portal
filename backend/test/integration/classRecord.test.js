// Integration coverage for the Class Record — the rule that a term grade is
// COMPUTED from recorded scores (DepEd Order No. 015, s. 2026, Annex D),
// never typed, and the guards around who may record those scores.
//
// Runs against the real app and database, like the other suites.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { startTestServer } = require('./helpers/testServer');
const { createClient } = require('./helpers/client');
const fixtures = require('./helpers/fixtures');

let server;
let api;
let ctx;
const items = {};

before(async () => {
  server = await startTestServer();
  api = createClient(server.baseUrl);

  const { schoolYearId, periods } = await fixtures.createSchoolYearWithPeriods('CR', [
    { name: 'Term 1', sequenceNumber: 1, startDate: '2031-06-01', endDate: '2031-09-15' },
  ]);
  const [teacher, otherTeacher, adviser, principal, student] = await Promise.all([
    fixtures.createStaffUser('subject_teacher', 'cr-teacher'),
    fixtures.createStaffUser('subject_teacher', 'cr-other-teacher'),
    fixtures.createStaffUser('adviser', 'cr-adviser'),
    fixtures.createStaffUser('principal', 'cr-principal'),
    fixtures.createStaffUser('student', 'cr-student'),
  ]);
  const section = await fixtures.createTestSection({ schoolYearId, adviserId: adviser.id, label: 'cr-section' });
  const subject = await fixtures.createTestSubject('cr-subject');
  const offering = await fixtures.createTestOffering({ subjectId: subject.id, sectionId: section.id, teacherId: teacher.id, schoolYearId });
  const [learnerA, learnerB] = await Promise.all([
    fixtures.createTestStudent({ sectionId: section.id, label: 'cr-a' }),
    fixtures.createTestStudent({ sectionId: section.id, label: 'cr-b' }),
  ]);
  ctx = { schoolYearId, period: periods[0], teacher, otherTeacher, adviser, principal, student, section, subject, offering, learnerA, learnerB };
});

after(async () => {
  await fixtures.teardown({
    schoolYearId: ctx.schoolYearId,
    ownSchoolYear: true,
    userIds: [ctx.teacher.id, ctx.otherTeacher.id, ctx.adviser.id, ctx.principal.id, ctx.student.id],
    studentIds: [ctx.learnerA.id, ctx.learnerB.id],
    subjectIds: [ctx.subject.id],
    sectionIds: [ctx.section.id],
    offeringIds: [ctx.offering.id],
  });
  await server.close();
});

const scope = () => ({ classOfferingId: ctx.offering.id, gradingPeriodId: ctx.period.id });
const recordUrl = () => `/api/class-record?classOfferingId=${ctx.offering.id}&gradingPeriodId=${ctx.period.id}`;

test('typing a grade directly is no longer possible', async () => {
  const res = await api.post('/api/grades', {
    token: ctx.teacher.token,
    body: { ...scope(), entries: [{ studentId: ctx.learnerA.id, gradeValue: 90 }] },
  });
  assert.equal(res.status, 404, 'POST /api/grades must not exist any more');
});

test('only people assigned to the class can open its record', async () => {
  for (const who of ['teacher', 'adviser', 'principal']) {
    const res = await api.get(recordUrl(), { token: ctx[who].token });
    assert.equal(res.status, 200, `${who} can read`);
  }
  assert.equal((await api.get(recordUrl(), { token: ctx.otherTeacher.token })).status, 403, 'another teacher cannot');
  assert.equal((await api.get(recordUrl(), { token: ctx.student.token })).status, 403, 'a student cannot');

  const asAdviser = await api.get(recordUrl(), { token: ctx.adviser.token });
  assert.equal(asAdviser.body.canEdit, false, 'the adviser reads it but does not edit it');
  assert.equal(asAdviser.body.policy.weights.ww, 0.2, 'a core subject is weighted 20/50/30 (DO 015, Table 2)');
});

test('only the teacher of the class can add items', async () => {
  const denied = await api.post('/api/class-record/items', {
    token: ctx.otherTeacher.token,
    body: { ...scope(), component: 'ww', title: 'Quiz 1', highestPossibleScore: 20 },
  });
  assert.equal(denied.status, 403);

  const specs = [
    ['ww1', { component: 'ww', title: 'Quiz 1', highestPossibleScore: 20 }],
    ['ww2', { component: 'ww', title: 'Quiz 2', highestPossibleScore: 25 }],
    ['ww3', { component: 'ww', title: 'Quiz 3', highestPossibleScore: 20 }],
    ['ww4', { component: 'ww', title: 'Quiz 4', highestPossibleScore: 20 }],
    ['pt1', { component: 'pt', title: 'Task 1', highestPossibleScore: 25 }],
    ['pt2', { component: 'pt', title: 'Task 2', highestPossibleScore: 25 }],
    ['st1', { component: 'ex', examPart: 'st1', title: 'Summative Test 1', highestPossibleScore: 20 }],
    ['st2', { component: 'ex', examPart: 'st2', title: 'Summative Test 2', highestPossibleScore: 20 }],
    ['te', { component: 'ex', examPart: 'te', title: 'Term Exam', highestPossibleScore: 40 }],
  ];
  for (const [key, body] of specs) {
    const res = await api.post('/api/class-record/items', { token: ctx.teacher.token, body: { ...scope(), ...body } });
    assert.equal(res.status, 201, `${key} created`);
    items[key] = res.body.item.id;
  }

  const badExam = await api.post('/api/class-record/items', {
    token: ctx.teacher.token,
    body: { ...scope(), component: 'ex', title: 'Exam with no part', highestPossibleScore: 50 },
  });
  assert.equal(badExam.status, 400, 'an exam item must say whether it is ST1, ST2 or the Term Exam');
});

test('a score above the highest possible score is refused', async () => {
  const res = await api.put('/api/class-record/scores', {
    token: ctx.teacher.token,
    body: { ...scope(), scores: [{ itemId: items.ww1, studentId: ctx.learnerA.id, rawScore: 21 }] },
  });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /between 0 and 20/);
});

test("DepEd's own worked example computes to 88 (DO 015 Annex D, Table 5)", async () => {
  // Learner A gets exactly the scores printed in the order.
  const a = ctx.learnerA.id;
  const scores = [
    [items.ww1, 17], [items.ww2, 22], [items.ww3, 20], [items.ww4, 15],
    [items.pt1, 20], [items.pt2, 23],
    [items.st1, 15], [items.st2, 18], [items.te, 35],
  ].map(([itemId, rawScore]) => ({ itemId, studentId: a, rawScore }));
  const res = await api.put('/api/class-record/scores', { token: ctx.teacher.token, body: { ...scope(), scores } });
  assert.equal(res.status, 200);

  const learner = res.body.learners.find((l) => l.studentId === a);
  assert.equal(learner.computed.complete, true);
  assert.equal(learner.computed.initialGrade, 85.76);
  assert.equal(learner.computed.termGrade, 88);

  const b = res.body.learners.find((l) => l.studentId === ctx.learnerB.id);
  assert.equal(b.computed.complete, false, 'learner B has no scores yet');
  assert.equal(b.computed.termGrade, null, 'and therefore no grade — a blank is never a zero');
});

test('submitting sends the server-computed grade with its breakdown, and skips incomplete learners', async () => {
  const res = await api.post('/api/class-record/submit', {
    token: ctx.teacher.token,
    // A grade sent by the browser is ignored — there is nowhere to send one.
    body: { ...scope(), gradeValue: 100 },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.submitted, 1);
  assert.equal(Number(res.body.grades[0].grade_value), 88);
  assert.equal(res.body.grades[0].status, 'submitted');
  assert.deepEqual(res.body.skippedIncomplete.map((s) => s.studentId), [ctx.learnerB.id]);

  // The principal's queue carries the snapshot the grade came from.
  const queue = await api.get(`/api/grades/submitted?gradingPeriodId=${ctx.period.id}`, { token: ctx.principal.token });
  const row = queue.body.rows.find((r) => r.student_id === ctx.learnerA.id);
  assert.equal(row.computation.initialGrade, 85.76);
  assert.deepEqual(row.computation.components.map((c) => c.weightedScore), [17.41, 43, 25.35]);
});

test("once finalized, a learner's scores and the items behind them are locked", async () => {
  const queue = await api.get(`/api/grades/submitted?gradingPeriodId=${ctx.period.id}`, { token: ctx.principal.token });
  const gradeId = queue.body.rows.find((r) => r.student_id === ctx.learnerA.id).id;
  assert.equal((await api.post('/api/grades/verify', { token: ctx.principal.token, body: { gradeIds: [gradeId], gradingPeriodId: ctx.period.id } })).status, 200);
  assert.equal((await api.post('/api/grades/finalize', { token: ctx.adviser.token, body: { sectionId: ctx.section.id, gradingPeriodId: ctx.period.id } })).status, 200);

  const edit = await api.put('/api/class-record/scores', {
    token: ctx.teacher.token,
    body: { ...scope(), scores: [{ itemId: items.ww1, studentId: ctx.learnerA.id, rawScore: 20 }] },
  });
  assert.equal(edit.status, 409, 'the official grade cannot be changed from under the adviser');

  const remove = await api.delete(`/api/class-record/items/${items.ww1}`, { token: ctx.teacher.token });
  assert.equal(remove.status, 409, 'an item a finalized grade was computed from cannot be deleted');
});
