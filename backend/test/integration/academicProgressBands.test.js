// The performance bands — the Part-A expansion described in CLAUDE.md, and
// the one layer of the innovation that had no assertion anywhere.
//
// A pure-function suite rather than an HTTP one: academicProgressCalculator
// takes an already-stored risk assessment and classifies it, with no
// database access of its own (the same calculator-vs-engine split as
// riskCalculator vs riskEngine). Testing it directly means the band
// boundaries can be pinned exactly, including the values that sit ON a
// threshold, which is where a spec and an implementation most often part
// company.
//
// Every expected value here is derived from config rather than typed as a
// literal, so if someone changes a threshold the test moves with it and
// keeps checking the RULE instead of a number that used to be true.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  determineBand,
  getAdvisories,
  getTopConcern,
  buildAcademicProgress,
  buildStudentAcademicProgress,
} = require('../../services/academicProgressCalculator');
const {
  BANDS,
  BAND_LABELS,
  PERFORMING_WELL_GRADE_THRESHOLD,
  PERFORMING_WELL_TREND_THRESHOLD,
  ADVISORY_MESSAGES,
  ENCOURAGEMENT_NOTE,
  RECOGNITION_NOTE,
} = require('../../config/academicProgress');
const {
  GRADE_AT_RISK_THRESHOLD,
  ATTENDANCE_RISK_THRESHOLD,
  GRADE_TREND_DECLINE_THRESHOLD,
  ATTENDANCE_TREND_DECLINE_THRESHOLD,
} = require('../../config/riskConfig');

// A healthy student with nothing triggered — the baseline each test varies
// one thing from, so a failure names exactly which input caused it.
const WELL = {
  riskScore: 0,
  averageGrade: 85,
  gradeTrend: 0,
  attendanceRate: 100,
  attendanceTrend: 0,
};

test('any triggered factor means At Risk, whatever the grades look like', () => {
  // riskScore > 0 IS the definition of the band — CLAUDE.md says so, and the
  // calculator must never arrive at its own answer by a different route.
  assert.equal(determineBand({ riskScore: 2, averageGrade: 99, gradeTrend: 10 }), BANDS.AT_RISK);
  assert.equal(determineBand({ riskScore: 8, averageGrade: 50, gradeTrend: -20 }), BANDS.AT_RISK);
});

test('Performing Well needs positive evidence, not merely the absence of problems', () => {
  // "Nothing wrong" is not the same claim as "doing well" — that case is
  // Average, which is the distinction the three-band design exists to make.
  assert.equal(determineBand({ riskScore: 0, averageGrade: 80, gradeTrend: 0 }), BANDS.AVERAGE);
  assert.equal(determineBand({ riskScore: 0, averageGrade: null, gradeTrend: null }), BANDS.AVERAGE);
});

test('the Performing Well grade threshold is inclusive, and one point below it is not', () => {
  const at = PERFORMING_WELL_GRADE_THRESHOLD;
  assert.equal(determineBand({ riskScore: 0, averageGrade: at, gradeTrend: 0 }), BANDS.PERFORMING_WELL);
  assert.equal(determineBand({ riskScore: 0, averageGrade: at - 1, gradeTrend: 0 }), BANDS.AVERAGE);
});

test('the Performing Well trend threshold is inclusive, and qualifies on its own', () => {
  const at = PERFORMING_WELL_TREND_THRESHOLD;
  // A middling average that is climbing fast still earns the band — the rule
  // is grade OR trend, not both.
  assert.equal(determineBand({ riskScore: 0, averageGrade: 78, gradeTrend: at }), BANDS.PERFORMING_WELL);
  assert.equal(determineBand({ riskScore: 0, averageGrade: 78, gradeTrend: at - 0.01 }), BANDS.AVERAGE);
});

test('a null grade or trend never counts as meeting a threshold', () => {
  // The comparison `null >= 90` is false in JavaScript, but `null >= 0` is
  // TRUE — so a null trend with a zero-ish threshold would silently qualify
  // if the code compared without an explicit null check.
  assert.equal(determineBand({ riskScore: 0, averageGrade: null, gradeTrend: 0 }), BANDS.AVERAGE);
  assert.equal(determineBand({ riskScore: 0, averageGrade: 95, gradeTrend: null }), BANDS.PERFORMING_WELL);
});

test('each band carries the right note, and At Risk carries advisories instead', () => {
  const wellBand = buildAcademicProgress({ ...WELL, averageGrade: PERFORMING_WELL_GRADE_THRESHOLD });
  assert.equal(wellBand.band, BANDS.PERFORMING_WELL);
  assert.equal(wellBand.bandLabel, BAND_LABELS[BANDS.PERFORMING_WELL]);
  assert.equal(wellBand.note, RECOGNITION_NOTE);
  assert.deepEqual(wellBand.advisories, []);
  assert.equal(wellBand.topConcern, null);

  const averageBand = buildAcademicProgress(WELL);
  assert.equal(averageBand.band, BANDS.AVERAGE);
  assert.equal(averageBand.note, ENCOURAGEMENT_NOTE);
  assert.deepEqual(averageBand.advisories, []);

  const atRisk = buildAcademicProgress({
    ...WELL,
    riskScore: 2,
    averageGrade: GRADE_AT_RISK_THRESHOLD - 1,
  });
  assert.equal(atRisk.band, BANDS.AT_RISK);
  // No encouragement note for At Risk: the advisories are what that band
  // says instead, and a cheerful line beside them would read badly.
  assert.equal(atRisk.note, null);
  assert.ok(atRisk.advisories.length > 0);
  assert.ok(atRisk.topConcern);
});

test('every triggered factor produces exactly one advisory, with its own message', () => {
  // All four factors at once: below the passing grade, falling fast, below
  // the attendance threshold, and attendance falling fast.
  const progress = buildAcademicProgress({
    riskScore: 8,
    averageGrade: GRADE_AT_RISK_THRESHOLD - 5,
    gradeTrend: GRADE_TREND_DECLINE_THRESHOLD - 1,
    attendanceRate: ATTENDANCE_RISK_THRESHOLD - 10,
    attendanceTrend: ATTENDANCE_TREND_DECLINE_THRESHOLD - 1,
  });

  assert.equal(progress.band, BANDS.AT_RISK);
  assert.equal(progress.advisories.length, progress.factors.length);
  assert.equal(progress.advisories.length, 4, 'all four factors should trigger here');

  for (const advisory of progress.advisories) {
    // The message is the configured one for that factor, not a generic
    // string — this is the rule-based advisory CLAUDE.md asks for, and the
    // reason it is deterministic rather than generated.
    assert.equal(advisory.advisory, ADVISORY_MESSAGES[advisory.factorKey]);
    assert.ok(advisory.factorLabel, 'an advisory keeps the factor label that explains why');
  }

  // The top concern is one of the advisories, not a fifth thing invented
  // alongside them.
  assert.ok(progress.advisories.some((a) => a.factorKey === progress.topConcern.factorKey));
});

test('the factors behind a band come from the risk calculator, not a second implementation', () => {
  // The threshold values themselves are exercised here: one point either
  // side of the passing grade must change whether the factor appears.
  const below = buildAcademicProgress({
    ...WELL,
    riskScore: 2,
    averageGrade: GRADE_AT_RISK_THRESHOLD - 1,
  });
  assert.ok(below.factors.some((f) => f.key === 'low_grade'));

  // Exactly ON the threshold is NOT at risk — CLAUDE.md's rule is
  // "grade < 75", a strict comparison.
  const exactly = buildAcademicProgress({ ...WELL, riskScore: 0, averageGrade: GRADE_AT_RISK_THRESHOLD });
  assert.ok(!exactly.factors.some((f) => f.key === 'low_grade'));
});

test('the student-facing view says the same thing in different words', () => {
  const input = {
    riskScore: 4,
    averageGrade: GRADE_AT_RISK_THRESHOLD - 3,
    gradeTrend: 0,
    attendanceRate: ATTENDANCE_RISK_THRESHOLD - 5,
    attendanceTrend: 0,
  };
  const staff = buildAcademicProgress(input);
  const student = buildStudentAcademicProgress(input);

  // Same band, and one student message per triggered factor — the two views
  // must never disagree about a student's standing, only about the wording.
  assert.equal(student.band, staff.band);
  assert.deepEqual(
    student.messages.map((m) => m.factorKey).sort(),
    staff.factors.map((f) => f.key).sort()
  );

  // But the student's wording is its own set, not the staff advisories,
  // which are written as instructions TO an adviser.
  const studentText = JSON.stringify(student.messages);
  for (const advisory of staff.advisories) {
    assert.ok(
      !studentText.includes(advisory.advisory),
      `the staff advisory "${advisory.advisory}" must not be shown to the student verbatim`
    );
  }

  // Each student message is grouped so the page can split Grades from
  // Attendance rather than showing one flat list.
  assert.ok(student.messages.every((m) => m.category));
});

test('an At Risk student is told the number they would have to reach', () => {
  const student = buildStudentAcademicProgress({
    riskScore: 2,
    averageGrade: GRADE_AT_RISK_THRESHOLD - 10,
    gradeTrend: 0,
    attendanceRate: 100,
    attendanceTrend: 0,
  });

  assert.equal(student.exitTargets.length, 1, 'one target per triggered factor');
  const gradeTarget = student.exitTargets[0];
  assert.equal(gradeTarget.factorKey, 'low_grade');
  // The target quotes the threshold the formula actually checks. Telling a
  // student to aim at a number that would not clear the flag is worse than
  // telling them nothing.
  assert.equal(gradeTarget.target, GRADE_AT_RISK_THRESHOLD);
  assert.equal(gradeTarget.current, GRADE_AT_RISK_THRESHOLD - 10);
});

test('getAdvisories and getTopConcern behave on an empty factor list', () => {
  // Reachable whenever a student is banded from a stored risk score while
  // the live factors come back empty — a real possibility, since the score
  // is read from the row and the factors are re-derived.
  assert.deepEqual(getAdvisories([]), []);
  assert.equal(getTopConcern([]), null);
});
