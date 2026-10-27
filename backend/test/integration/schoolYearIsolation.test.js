// Regression coverage for the defect that ran through this whole system:
// grading_periods.sequence_number is unique only WITHIN a school year
// (UNIQUE (school_year_id, sequence_number)), but the per-period series
// queries behind the risk score, the report card and the student's own
// progress view all keyed on it with no year filter.
//
// A student who has been in the school for two years therefore had two rows
// numbered 1, two numbered 2, and so on. riskEngine picks "this period" with
// `.find(row => row.sequence_number === target)`, which returns the FIRST
// match — last year's. The trend then walked a series interleaving both
// years.
//
// None of this is visible on a freshly seeded database with one school year,
// which is exactly why it needs a test: every assertion here passes
// trivially until a second year exists, and the whole point is what happens
// then.
//
// So this suite gives one student a complete PRIOR year of deliberately
// extreme data, and then asserts that none of it reaches the current year's
// figures.
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

  // Two school years, far future and non-overlapping, so nothing here can
  // collide with the dev seed or the other suites (2030/2031/2032 are taken
  // — see the isolation note in helpers/fixtures.js).
  const prior = await fixtures.createSchoolYearWithPeriods('SY-A', [
    { name: 'Q1', sequenceNumber: 1, startDate: '2033-06-01', endDate: '2033-08-31' },
    { name: 'Q2', sequenceNumber: 2, startDate: '2033-09-01', endDate: '2033-11-30' },
  ]);
  const current = await fixtures.createSchoolYearWithPeriods('SY-B', [
    { name: 'Q1', sequenceNumber: 1, startDate: '2034-06-01', endDate: '2034-08-31' },
    { name: 'Q2', sequenceNumber: 2, startDate: '2034-09-01', endDate: '2034-11-30' },
  ]);

  const [teacher, adviser, principal] = await Promise.all([
    fixtures.createStaffUser('subject_teacher', 'sy-teacher'),
    fixtures.createStaffUser('adviser', 'sy-adviser'),
    fixtures.createStaffUser('principal', 'sy-principal'),
  ]);

  // One section per year, the same adviser and teacher in both — which is
  // how a real promotion looks: the learner moves to a new section in the
  // new year, and the old section still exists with last year's records.
  const priorSection = await fixtures.createTestSection({
    schoolYearId: prior.schoolYearId,
    adviserId: adviser.id,
    label: 'sy-prior',
  });
  const currentSection = await fixtures.createTestSection({
    schoolYearId: current.schoolYearId,
    adviserId: adviser.id,
    label: 'sy-current',
  });

  const subject = await fixtures.createTestSubject('sy-subject');
  const priorOffering = await fixtures.createTestOffering({
    subjectId: subject.id,
    sectionId: priorSection.id,
    teacherId: teacher.id,
    schoolYearId: prior.schoolYearId,
  });
  const currentOffering = await fixtures.createTestOffering({
    subjectId: subject.id,
    sectionId: currentSection.id,
    teacherId: teacher.id,
    schoolYearId: current.schoolYearId,
  });

  // The student starts in the prior year's section; before() finishes by
  // promoting them, so their prior-year records stay behind exactly as a
  // real learner's would.
  const student = await fixtures.createTestStudent({ sectionId: priorSection.id, label: 'sy-student' });

  ctx = {
    prior,
    current,
    teacher,
    adviser,
    principal,
    priorSection,
    currentSection,
    subject,
    priorOffering,
    currentOffering,
    student,
  };

  // --- A full prior year, deliberately extreme in both directions ---
  // Grades 98 then 60: a 38-point collapse. Attendance 100% then 20%.
  // If any of it leaks into the current year, the assertions below cannot
  // pass by accident.
  await finalizeGrade(ctx.priorOffering.id, ctx.prior.periods[0].id, 98);
  await finalizeGrade(ctx.priorOffering.id, ctx.prior.periods[1].id, 60);
  await markDays(ctx.priorSection.id, ['2033-06-01', '2033-06-02'], ['present', 'present']);
  await markDays(ctx.priorSection.id, ['2033-09-01', '2033-09-02'], ['absent', 'absent']);

  await pool.query('UPDATE students SET current_section_id = $1 WHERE id = $2', [
    currentSection.id,
    student.id,
  ]);
});

after(async () => {
  await fixtures.teardown({
    schoolYearId: ctx.current.schoolYearId,
    ownSchoolYear: true,
    // The prior year goes through teardown too, so it is removed only once
    // the grades and attendance referencing its periods are gone.
    extraSchoolYearIds: [ctx.prior.schoolYearId],
    userIds: [ctx.teacher.id, ctx.adviser.id, ctx.principal.id],
    studentIds: [ctx.student.id],
    subjectIds: [ctx.subject.id],
    sectionIds: [ctx.priorSection.id, ctx.currentSection.id],
    offeringIds: [ctx.priorOffering.id, ctx.currentOffering.id],
  });
  await server.close();
});

// Submit -> verify -> finalize through the real endpoints, since only a
// finalized grade feeds the risk formula.
async function finalizeGrade(offeringId, periodId, gradeValue) {
  const submitRes = await api.post('/api/grades', {
    token: ctx.teacher.token,
    body: {
      classOfferingId: offeringId,
      gradingPeriodId: periodId,
      entries: [{ studentId: ctx.student.id, gradeValue }],
    },
  });
  assert.equal(submitRes.status, 201, JSON.stringify(submitRes.body));

  const verifyRes = await api.post('/api/grades/verify', {
    token: ctx.principal.token,
    body: { gradingPeriodId: periodId, gradeIds: [submitRes.body.grades[0].id] },
  });
  assert.equal(verifyRes.status, 200, JSON.stringify(verifyRes.body));

  const sectionId = offeringId === ctx.priorOffering.id ? ctx.priorSection.id : ctx.currentSection.id;
  const finalizeRes = await api.post('/api/grades/finalize', {
    token: ctx.adviser.token,
    body: { sectionId, gradingPeriodId: periodId },
  });
  assert.equal(finalizeRes.status, 200, JSON.stringify(finalizeRes.body));
}

async function markDays(sectionId, dates, statuses) {
  for (let i = 0; i < dates.length; i += 1) {
    const res = await api.post('/api/attendance/daily', {
      token: ctx.adviser.token,
      body: {
        sectionId,
        attendanceDate: dates[i],
        entries: [{ studentId: ctx.student.id, status: statuses[i] }],
      },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
  }
}

function assessmentFor(periodId) {
  return pool
    .query('SELECT * FROM risk_assessments WHERE student_id = $1 AND grading_period_id = $2', [
      ctx.student.id,
      periodId,
    ])
    .then((r) => r.rows[0] || null);
}

test('the prior year really is set up to break things if it leaks', async () => {
  // Guards the rest of the suite: if this fixture ever stops producing two
  // years of data, every assertion below would pass for the wrong reason.
  const priorAssessment = await assessmentFor(ctx.prior.periods[1].id);
  assert.ok(priorAssessment, 'the prior year should have its own assessment');
  assert.equal(Number(priorAssessment.average_grade), 60);
  assert.equal(Number(priorAssessment.attendance_rate), 0);

  const periods = await pool.query(
    'SELECT sequence_number, COUNT(*) AS n FROM grading_periods WHERE school_year_id = ANY($1::int[]) GROUP BY 1 ORDER BY 1',
    [[ctx.prior.schoolYearId, ctx.current.schoolYearId]]
  );
  // Two rows numbered 1 and two numbered 2 — the exact ambiguity the fix is
  // about.
  assert.deepEqual(
    periods.rows.map((r) => Number(r.n)),
    [2, 2]
  );
});

test('the current year\'s risk score uses only the current year\'s grade', async () => {
  await finalizeGrade(ctx.currentOffering.id, ctx.current.periods[0].id, 88);

  const assessment = await assessmentFor(ctx.current.periods[0].id);
  assert.ok(assessment, 'finalizing should produce an assessment for the current year');
  // 88, not 98 — which is what the prior year's Q1 would have supplied if
  // the series were still matched on sequence_number alone.
  assert.equal(Number(assessment.average_grade), 88);
  // One data point IN THIS YEAR, so the trend is unmeasurable. Unscoped, the
  // series would have been [98, 60, 88] and produced a real number here.
  assert.equal(assessment.grade_trend, null);
});

test('the grade trend is computed within the year, not across the promotion', async () => {
  await finalizeGrade(ctx.currentOffering.id, ctx.current.periods[1].id, 84);

  const assessment = await assessmentFor(ctx.current.periods[1].id);
  assert.equal(Number(assessment.average_grade), 84);
  // (84 - 88) / 2 = -2. Across both years it would have been
  // (84 - 98) / 4 = -3.5, which crosses no threshold either but is simply
  // not this student's current-year trend.
  assert.equal(Number(assessment.grade_trend), -2);
  // -2 does not reach the -5 decline threshold, so no factor fires from it.
  assert.equal(assessment.risk_score, 0);
  assert.equal(assessment.risk_level, 'low');
});

test('the attendance rate ignores the prior year entirely', async () => {
  await markDays(ctx.currentSection.id, ['2034-06-02', '2034-06-03'], ['present', 'present']);

  const assessment = await assessmentFor(ctx.current.periods[0].id);
  // 100%: two present days this year. The prior year's two absences would
  // have dragged this to 50% if the series were unscoped.
  assert.equal(Number(assessment.attendance_rate), 100);
});

test('the report card covers one school year, matching the year it names', async () => {
  const res = await fetch(`${server.baseUrl}/api/students/${ctx.student.id}/report-card`, {
    headers: { Authorization: `Bearer ${ctx.adviser.token}` },
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/pdf');

  // The PDF itself is not parsed here — what matters is the data behind it,
  // which pivots on sequence_number and so would collide a prior-year Q1
  // with a current-year Q1 in the same cell.
  const gradeModel = require('../../models/gradeModel');
  const studentModel = require('../../models/studentModel');
  const schoolYearId = await studentModel.resolveSchoolYearId(ctx.student.id);
  assert.equal(schoolYearId, ctx.current.schoolYearId, 'a promoted student resolves to their new year');

  const rows = await gradeModel.getFinalizedHistoryForStudent(ctx.student.id, schoolYearId);
  assert.equal(rows.length, 2, 'two periods this year, not four across both');
  assert.deepEqual(
    rows.map((r) => Number(r.grade_value)).sort((a, b) => a - b),
    [84, 88]
  );
});

test("a teacher cannot un-finalize a grade by resubmitting it", async () => {
  // The current year's Q1 grade is finalized by now.
  const before = await pool.query(
    `SELECT id, status, grade_value, finalized_by FROM grades
     WHERE student_id = $1 AND grading_period_id = $2`,
    [ctx.student.id, ctx.current.periods[0].id]
  );
  assert.equal(before.rows[0].status, 'finalized');
  assert.ok(before.rows[0].finalized_by, 'precondition: it carries who finalized it');

  const res = await api.post('/api/grades', {
    token: ctx.teacher.token,
    body: {
      classOfferingId: ctx.currentOffering.id,
      gradingPeriodId: ctx.current.periods[0].id,
      entries: [{ studentId: ctx.student.id, gradeValue: 70 }],
    },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  // Accepted as a request, but the finalized row is refused and said so.
  assert.deepEqual(res.body.grades, []);
  assert.deepEqual(res.body.skippedFinalizedStudentIds, [ctx.student.id]);
  assert.match(res.body.message, /already finalized/i);

  const afterRow = await pool.query(
    `SELECT status, grade_value, finalized_by FROM grades
     WHERE student_id = $1 AND grading_period_id = $2`,
    [ctx.student.id, ctx.current.periods[0].id]
  );
  // Untouched: still official, still the adviser's value, still carrying who
  // made it official.
  assert.equal(afterRow.rows[0].status, 'finalized');
  assert.equal(Number(afterRow.rows[0].grade_value), 88);
  assert.equal(afterRow.rows[0].finalized_by, before.rows[0].finalized_by);
});

test('a rejected grade can still be resubmitted — the guard is only about finalized', async () => {
  // Q2 of the current year: take it back to submitted via a rejection, then
  // resubmit. This is the path the guard must NOT break.
  const submitRes = await api.post('/api/grades', {
    token: ctx.teacher.token,
    body: {
      classOfferingId: ctx.currentOffering.id,
      gradingPeriodId: ctx.current.periods[1].id,
      entries: [{ studentId: ctx.student.id, gradeValue: 84 }],
    },
  });
  // Q2 was finalized by an earlier test, so this one is refused too —
  // confirming the guard holds across periods, and leaving Q2 alone.
  assert.deepEqual(submitRes.body.skippedFinalizedStudentIds, [ctx.student.id]);

  // A fresh, never-finalized grade: submit, reject, resubmit.
  const freshPeriod = ctx.current.periods[0];
  const other = await fixtures.createTestStudent({ sectionId: ctx.currentSection.id, label: 'sy-fresh' });
  try {
    const first = await api.post('/api/grades', {
      token: ctx.teacher.token,
      body: {
        classOfferingId: ctx.currentOffering.id,
        gradingPeriodId: freshPeriod.id,
        entries: [{ studentId: other.id, gradeValue: 77 }],
      },
    });
    assert.equal(first.body.grades.length, 1);

    const rejectRes = await api.post('/api/grades/reject', {
      token: ctx.principal.token,
      body: {
        gradingPeriodId: freshPeriod.id,
        gradeIds: [first.body.grades[0].id],
        note: 'Please recheck.',
      },
    });
    assert.equal(rejectRes.status, 200, JSON.stringify(rejectRes.body));

    const resubmit = await api.post('/api/grades', {
      token: ctx.teacher.token,
      body: {
        classOfferingId: ctx.currentOffering.id,
        gradingPeriodId: freshPeriod.id,
        entries: [{ studentId: other.id, gradeValue: 80 }],
      },
    });
    assert.equal(resubmit.body.grades.length, 1, 'a rejected grade must still be resubmittable');
    assert.equal(resubmit.body.grades[0].status, 'submitted');
    assert.equal(Number(resubmit.body.grades[0].grade_value), 80);
  } finally {
    await pool.query('DELETE FROM risk_assessments WHERE student_id = $1', [other.id]);
    await pool.query('DELETE FROM grades WHERE student_id = $1', [other.id]);
    await pool.query('DELETE FROM students WHERE id = $1', [other.id]);
  }
});

test('a bulk verify cannot reach outside the grading period it was given', async () => {
  // A grade in the PRIOR year, re-submitted so it is verifiable again.
  const other = await fixtures.createTestStudent({ sectionId: ctx.currentSection.id, label: 'sy-scope' });
  try {
    const mine = await api.post('/api/grades', {
      token: ctx.teacher.token,
      body: {
        classOfferingId: ctx.currentOffering.id,
        gradingPeriodId: ctx.current.periods[0].id,
        entries: [{ studentId: other.id, gradeValue: 90 }],
      },
    });
    const gradeId = mine.body.grades[0].id;

    // Named with the WRONG period: the id is real and submitted, but it does
    // not belong to the queue the caller claims to be acting on.
    const wrongPeriod = await api.post('/api/grades/verify', {
      token: ctx.principal.token,
      body: { gradingPeriodId: ctx.current.periods[1].id, gradeIds: [gradeId] },
    });
    assert.equal(wrongPeriod.status, 200);
    assert.equal(wrongPeriod.body.verifiedCount, 0, 'nothing outside the named period may be touched');

    const still = await pool.query('SELECT status FROM grades WHERE id = $1', [gradeId]);
    assert.equal(still.rows[0].status, 'submitted');

    // And a non-integer id is a 400, not an unhandled 500 from the int cast.
    const bad = await api.post('/api/grades/verify', {
      token: ctx.principal.token,
      body: { gradingPeriodId: ctx.current.periods[0].id, gradeIds: ['not-an-id'] },
    });
    assert.equal(bad.status, 400);
  } finally {
    await pool.query('DELETE FROM risk_assessments WHERE student_id = $1', [other.id]);
    await pool.query('DELETE FROM grades WHERE student_id = $1', [other.id]);
    await pool.query('DELETE FROM students WHERE id = $1', [other.id]);
  }
});
