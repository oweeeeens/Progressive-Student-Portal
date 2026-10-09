// Integration coverage for the risk engine's recalculation trigger (see
// riskEngine.js / CLAUDE.md: "recalculated whenever new grades/attendance
// are entered, not real-time"). Confirms BOTH trigger points independently
// fire a recalculation — grade finalization and daily-attendance submission
// — and that a real multi-period grade history, run through the actual
// finalize endpoint period by period, produces the mathematically correct
// trend and risk score/level at each step (not just in the pure-function
// unit test — see scripts/testRiskCalculator.js for that).
//
// Runs against the real Express app and the real database.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { startTestServer } = require('./helpers/testServer');
const { createClient } = require('./helpers/client');
const fixtures = require('./helpers/fixtures');
const { pool } = require('../../config/db');

let server;
let api;
let ctx;

before(async () => {
  server = await startTestServer();
  api = createClient(server.baseUrl);

  // A dedicated, far-future school year (2031) — isolated from both the
  // real dev-seeded year and gradeApproval.test.js's 2030 year.
  const { schoolYearId, periods } = await fixtures.createSchoolYearWithPeriods('RISK', [
    { name: 'Q1', sequenceNumber: 1, startDate: '2031-01-01', endDate: '2031-03-31' },
    { name: 'Q2', sequenceNumber: 2, startDate: '2031-04-01', endDate: '2031-06-30' },
    { name: 'Q3', sequenceNumber: 3, startDate: '2031-07-01', endDate: '2031-09-30' },
    { name: 'Q4', sequenceNumber: 4, startDate: '2031-10-01', endDate: '2031-12-31' },
  ]);

  const [teacher, adviser, principal] = await Promise.all([
    fixtures.createStaffUser('subject_teacher', 'teacher'),
    fixtures.createStaffUser('adviser', 'adviser'),
    fixtures.createStaffUser('principal', 'principal'),
  ]);

  const section = await fixtures.createTestSection({ schoolYearId, adviserId: adviser.id, label: 'section' });
  const subject = await fixtures.createTestSubject('subject');
  const offering = await fixtures.createTestOffering({
    subjectId: subject.id,
    sectionId: section.id,
    teacherId: teacher.id,
    schoolYearId,
  });
  const student = await fixtures.createTestStudent({ sectionId: section.id, label: 'student' });

  ctx = { schoolYearId, periods, teacher, adviser, principal, section, subject, offering, student };
});

after(async () => {
  await fixtures.teardown({
    schoolYearId: ctx.schoolYearId,
    ownSchoolYear: true,
    userIds: [ctx.teacher.id, ctx.adviser.id, ctx.principal.id],
    studentIds: [ctx.student.id],
    subjectIds: [ctx.subject.id],
    sectionIds: [ctx.section.id],
    offeringIds: [ctx.offering.id],
  });
  await server.close();
});

// Drives one grading period's grade all the way through the real approval
// chain (submit -> verify -> finalize) via the real HTTP endpoints, exactly
// like gradeApproval.test.js does — finalizing is what triggers the risk
// recalculation under test.
async function finalizeOneGrade(periodId, gradeValue) {
  const submitRes = await api.post('/api/grades', {
    token: ctx.teacher.token,
    body: {
      classOfferingId: ctx.offering.id,
      gradingPeriodId: periodId,
      entries: [{ studentId: ctx.student.id, gradeValue }],
    },
  });
  assert.equal(submitRes.status, 201);
  const gradeId = submitRes.body.grades[0].id;

  const verifyRes = await api.post('/api/grades/verify', {
    token: ctx.principal.token,
    body: { gradeIds: [gradeId] },
  });
  assert.equal(verifyRes.status, 200);

  const finalizeRes = await api.post('/api/grades/finalize', {
    token: ctx.adviser.token,
    body: { sectionId: ctx.section.id, gradingPeriodId: periodId },
  });
  assert.equal(finalizeRes.status, 200);
  assert.deepEqual(finalizeRes.body.studentIds, [ctx.student.id]);
}

async function getAssessment(periodId) {
  const result = await pool.query(
    'SELECT * FROM risk_assessments WHERE student_id = $1 AND grading_period_id = $2',
    [ctx.student.id, periodId]
  );
  return result.rows[0] || null;
}

test('before any data exists, no risk assessment exists for the student yet', async () => {
  const assessment = await getAssessment(ctx.periods[0].id);
  assert.equal(assessment, null);
});

test('finalizing Q1 (first-ever period, one data point) triggers recalculation: score 0, trend null', async () => {
  await finalizeOneGrade(ctx.periods[0].id, 90);

  const assessment = await getAssessment(ctx.periods[0].id);
  assert.ok(assessment, 'finalizing a grade must trigger a risk_assessments row to be created');
  assert.equal(Number(assessment.average_grade), 90);
  // Fewer than 2 data points -> trend is unmeasurable (null), per
  // riskCalculator.calculateTrend's explicit rule — not 0 ("flat").
  assert.equal(assessment.grade_trend, null);
  assert.equal(assessment.risk_score, 0);
  assert.equal(assessment.risk_level, 'low');
});

test('finalizing Q2 (90 -> 80) produces a trend of exactly -5, right at the decline threshold', async () => {
  await finalizeOneGrade(ctx.periods[1].id, 80);

  const assessment = await getAssessment(ctx.periods[1].id);
  assert.equal(Number(assessment.average_grade), 80);
  // (80 - 90) / 2 periods = -5 exactly. CLAUDE.md's threshold is "<= -5",
  // so this exact boundary value DOES trigger the declining-grade factor.
  assert.equal(Number(assessment.grade_trend), -5);
  // currentGrade 80 is not below 75, so only the trend factor fires: +2.
  assert.equal(assessment.risk_score, 2);
  assert.equal(assessment.risk_level, 'low'); // 0-2 is still the "low" band
});

test('finalizing Q3 (90, 80, 70) crosses both the grade and trend thresholds: score 4, medium', async () => {
  await finalizeOneGrade(ctx.periods[2].id, 70);

  const assessment = await getAssessment(ctx.periods[2].id);
  assert.equal(Number(assessment.average_grade), 70);
  // (70 - 90) / 3 periods = -6.666... — comfortably past -5.
  assert.ok(Math.abs(Number(assessment.grade_trend) - -6.666666666666667) < 0.001);
  // currentGrade 70 < 75 (+2, low_grade) AND trend <= -5 (+2, declining_grade) = 4.
  assert.equal(assessment.risk_score, 4);
  assert.equal(assessment.risk_level, 'medium');
});

test('submitting daily attendance for Q4 (no grade that period) independently triggers recalculation', async () => {
  const beforeAssessment = await getAssessment(ctx.periods[3].id);
  assert.equal(beforeAssessment, null, 'no assessment should exist for Q4 before any Q4 data is entered');

  // 4 school days in Q4: present, present, present, absent -> 75% attendance.
  const dates = ['2031-10-01', '2031-10-02', '2031-10-03', '2031-10-04'];
  const statuses = ['present', 'present', 'present', 'absent'];
  for (let i = 0; i < dates.length; i += 1) {
    const res = await api.post('/api/attendance/daily', {
      token: ctx.adviser.token,
      body: {
        sectionId: ctx.section.id,
        attendanceDate: dates[i],
        entries: [{ studentId: ctx.student.id, status: statuses[i] }],
      },
    });
    assert.equal(res.status, 201);
  }

  const assessment = await getAssessment(ctx.periods[3].id);
  assert.ok(assessment, 'submitting daily attendance must trigger a risk_assessments row to be created');
  // average_grade itself is null (no grade submitted this period) — proves
  // the attendance trigger ran independently, not as a side effect of the
  // grade-finalize trigger. BUT grade_trend is NOT null: it's carried
  // forward from Q1-Q3's history (90, 80, 70) regardless of whether this
  // specific period has its own new grade — extractCurrentAndSeries in
  // riskEngine.js computes trend from whatever history exists up to the
  // target period, independent of whether the target period itself
  // contributed a data point. So the already-established decline (-6.67,
  // <= -5) still counts this period too.
  assert.equal(assessment.average_grade, null);
  assert.ok(Math.abs(Number(assessment.grade_trend) - -6.666666666666667) < 0.001);
  assert.equal(Number(assessment.attendance_rate), 75);
  // First-ever attendance data point -> attendance_trend is still
  // unmeasurable (null), so only ONE attendance factor can fire this period.
  assert.equal(assessment.attendance_trend, null);
  // declining_grade (carried trend, +2) + low_attendance (75% < 90%, +2) = 4.
  assert.equal(assessment.risk_score, 4);
  assert.equal(assessment.risk_level, 'medium');
});
