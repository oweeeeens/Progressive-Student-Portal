// Integration coverage for Analytics' Learner Outlook and the adviser scope:
// an adviser opens Analytics but sees only the sections they advise; the
// principal sees the whole school; someone who advises nothing is refused.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { startTestServer } = require('./helpers/testServer');
const { createClient } = require('./helpers/client');
const { submitGrades } = require('./helpers/classRecord');
const fixtures = require('./helpers/fixtures');

let server;
let api;
let ctx;

before(async () => {
  server = await startTestServer();
  api = createClient(server.baseUrl);
  const { schoolYearId, periods } = await fixtures.createSchoolYearWithPeriods('LO', [
    { name: 'Term 1', sequenceNumber: 1, startDate: '2033-06-01', endDate: '2033-09-15' },
  ]);
  const [teacher, adviserA, adviserB, principal] = await Promise.all([
    fixtures.createStaffUser('subject_teacher', 'lo-teacher'),
    fixtures.createStaffUser('adviser', 'lo-adviser-a'),
    fixtures.createStaffUser('adviser', 'lo-adviser-b'),
    fixtures.createStaffUser('principal', 'lo-principal'),
  ]);
  const sectionA = await fixtures.createTestSection({ schoolYearId, adviserId: adviserA.id, label: 'lo-a' });
  const sectionB = await fixtures.createTestSection({ schoolYearId, adviserId: adviserB.id, label: 'lo-b' });
  const subject = await fixtures.createTestSubject('lo-subject');
  const offeringA = await fixtures.createTestOffering({ subjectId: subject.id, sectionId: sectionA.id, teacherId: teacher.id, schoolYearId });
  const offeringB = await fixtures.createTestOffering({ subjectId: subject.id, sectionId: sectionB.id, teacherId: teacher.id, schoolYearId });
  const learnerA = await fixtures.createTestStudent({ sectionId: sectionA.id, label: 'lo-learner-a' });
  const learnerB = await fixtures.createTestStudent({ sectionId: sectionB.id, label: 'lo-learner-b' });
  ctx = { schoolYearId, period: periods[0], teacher, adviserA, adviserB, principal, sectionA, sectionB, subject, offeringA, offeringB, learnerA, learnerB };

  // A failing grade (70) for each learner, through the whole approval chain.
  for (const [offering, learner, adviser, section] of [
    [offeringA, learnerA, adviserA, sectionA],
    [offeringB, learnerB, adviserB, sectionB],
  ]) {
    const submitted = await submitGrades(api, {
      token: teacher.token,
      body: { classOfferingId: offering.id, gradingPeriodId: ctx.period.id, entries: [{ studentId: learner.id, gradeValue: 70 }] },
    });
    await api.post('/api/grades/verify', { token: principal.token, body: { gradeIds: submitted.body.grades.map((g) => g.id), gradingPeriodId: ctx.period.id } });
    await api.post('/api/grades/finalize', { token: adviser.token, body: { sectionId: section.id, gradingPeriodId: ctx.period.id } });
  }
});

after(async () => {
  await fixtures.teardown({
    schoolYearId: ctx.schoolYearId,
    ownSchoolYear: true,
    userIds: [ctx.teacher.id, ctx.adviserA.id, ctx.adviserB.id, ctx.principal.id],
    studentIds: [ctx.learnerA.id, ctx.learnerB.id],
    subjectIds: [ctx.subject.id],
    sectionIds: [ctx.sectionA.id, ctx.sectionB.id],
    offeringIds: [ctx.offeringA.id, ctx.offeringB.id],
  });
  await server.close();
});

const outlookUrl = () => `/api/analytics/learner-outlook?gradingPeriodId=${ctx.period.id}`;
const ids = (body) => body.promotion.learners.map((l) => l.studentId);

test('the principal sees both learners, each with a failing subject (summer remedial, DO 015 ¶67)', async () => {
  const res = await api.get(outlookUrl(), { token: ctx.principal.token });
  assert.equal(res.status, 200);
  assert.ok(ids(res.body).includes(ctx.learnerA.id) && ids(res.body).includes(ctx.learnerB.id));
  const a = res.body.promotion.learners.find((l) => l.studentId === ctx.learnerA.id);
  assert.equal(a.category, 'summer_remedial');
  assert.ok(res.body.subjects.some((s) => s.classOfferingId === ctx.offeringA.id && s.failing === 1));
  assert.ok(res.body.components.some((c) => c.classOfferingId === ctx.offeringA.id), 'class-record components are profiled');
});

test("an adviser's Analytics covers only their own section", async () => {
  const res = await api.get(outlookUrl(), { token: ctx.adviserA.token });
  assert.equal(res.status, 200);
  assert.ok(ids(res.body).includes(ctx.learnerA.id), 'their own learner is there');
  assert.ok(!ids(res.body).includes(ctx.learnerB.id), "another section's learner is not");
  assert.ok(!res.body.subjects.some((s) => s.classOfferingId === ctx.offeringB.id));

  const distribution = await api.get(`/api/analytics/risk-distribution?gradingPeriodId=${ctx.period.id}`, { token: ctx.adviserA.token });
  assert.equal(distribution.status, 200, 'the existing tabs open for an adviser too');
});

test('someone who advises no section cannot open Analytics', async () => {
  const res = await api.get(outlookUrl(), { token: ctx.teacher.token });
  assert.equal(res.status, 403);
});

// --- One learner: GET /students/:id/insights (the Learner Insights tab) ----

test("a learner's insights show their own outlook, scoped like their record", async () => {
  const own = await api.get(`/api/students/${ctx.learnerA.id}/insights`, { token: ctx.adviserA.token });
  assert.equal(own.status, 200);
  assert.equal(own.body.promotion.category, 'summer_remedial', 'one subject below 75 → summer remedial (DO 015 ¶67)');
  assert.deepEqual(own.body.standing.map((s) => s.grade), [70]);
  assert.ok(own.body.overallComponents.length > 0, 'component strengths come from the class record');
  assert.equal(own.body.attendance.untilAlert, 12, 'no absences yet: twelve to go before the ¶70 mark');

  const other = await api.get(`/api/students/${ctx.learnerA.id}/insights`, { token: ctx.adviserB.token });
  assert.equal(other.status, 404, "another section's adviser cannot see this learner, same as the record");
});
