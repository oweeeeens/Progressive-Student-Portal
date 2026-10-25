// Classifies an already-computed risk assessment into one of three
// performance bands and attaches the rule-based advisory/encouragement/
// recognition text. Deliberately pure (no database access), same
// calculator-vs-DB-facing split as riskCalculator.js vs riskEngine.js —
// and deliberately built ON TOP of riskCalculator.evaluateFactors rather
// than reimplementing factor detection, so the two can never disagree
// about which factors triggered. The risk SCORE/LEVEL themselves are never
// recomputed here — they're read from the already-stored risk_assessments
// row, exactly as before this module existed.
const { evaluateFactors } = require('./riskCalculator');
const {
  BANDS,
  BAND_LABELS,
  PERFORMING_WELL_GRADE_THRESHOLD,
  PERFORMING_WELL_TREND_THRESHOLD,
  ADVISORY_MESSAGES,
  FACTOR_PRIORITY,
  FACTOR_CATEGORIES,
  ENCOURAGEMENT_NOTE,
  RECOGNITION_NOTE,
  STUDENT_ADVISORY_MESSAGES,
  STUDENT_ENCOURAGEMENT_NOTE,
  STUDENT_RECOGNITION_NOTE,
} = require('../config/academicProgress');
// The band-exit targets below quote the SCORING thresholds, so they're read
// from riskConfig itself rather than restated — a target a student is told
// to hit has to be the exact number the formula actually checks, or the
// page is telling them to aim at something that won't clear the flag.
const {
  GRADE_AT_RISK_THRESHOLD,
  ATTENDANCE_RISK_THRESHOLD,
  GRADE_TREND_DECLINE_THRESHOLD,
  ATTENDANCE_TREND_DECLINE_THRESHOLD,
  POINTS_PER_TRIGGERED_FACTOR,
  RISK_LEVEL_BANDS,
} = require('../config/riskConfig');

// Any triggered risk factor means At Risk, full stop — this band's
// membership is identical to "risk_score > 0," never recomputed
// differently here. Among students with zero triggered factors, Performing
// Well requires positive evidence (a high current grade OR a fast-improving
// trend) — simply having "nothing wrong" isn't the same claim as "doing
// well," so that case falls to Average/Steady instead.
function determineBand({ riskScore, averageGrade, gradeTrend }) {
  if (riskScore > 0) return BANDS.AT_RISK;

  const highGrade = averageGrade != null && averageGrade >= PERFORMING_WELL_GRADE_THRESHOLD;
  const improvingFast = gradeTrend != null && gradeTrend >= PERFORMING_WELL_TREND_THRESHOLD;
  if (highGrade || improvingFast) return BANDS.PERFORMING_WELL;

  return BANDS.AVERAGE;
}

// One advisory entry per triggered factor, each carrying both the existing
// factor label (the "why," unchanged) and its matching fixed advisory
// message (the "what to do about it," new).
function getAdvisories(factors) {
  return factors.map((factor) => ({
    factorKey: factor.key,
    factorLabel: factor.label,
    advisory: ADVISORY_MESSAGES[factor.key] || null,
  }));
}

// The single factor to headline on a collapsed/glanceable row — see
// config/academicProgress.js's FACTOR_PRIORITY for the ranking rationale.
// Returns null if nothing triggered (never called for a non-At-Risk band in
// practice, but stays correct rather than throwing if it ever is).
function getTopConcern(advisories) {
  if (advisories.length === 0) return null;
  for (const factorKey of FACTOR_PRIORITY) {
    const match = advisories.find((a) => a.factorKey === factorKey);
    if (match) return match;
  }
  return advisories[0]; // a factor key FACTOR_PRIORITY doesn't know about — fail open, not silent
}

// The single entry point the controllers use: given one student's stored
// assessment numbers, returns everything the UI needs to render their
// Academic Progress Tracking row — band, the existing triggered-factors
// list, per-factor advisories and the single top-concern one (At Risk
// only), and a short note (encouragement for Average/Steady, recognition
// for Performing Well; null for At Risk, where the advisories serve that
// role instead).
function buildAcademicProgress({ riskScore, averageGrade, gradeTrend, attendanceRate, attendanceTrend }) {
  const factors = evaluateFactors({
    currentGrade: averageGrade,
    gradeTrend,
    currentAttendanceRate: attendanceRate,
    attendanceTrend,
  });
  const band = determineBand({ riskScore, averageGrade, gradeTrend });

  let note = null;
  let advisories = [];
  let topConcern = null;
  if (band === BANDS.AT_RISK) {
    advisories = getAdvisories(factors);
    topConcern = getTopConcern(advisories);
  } else if (band === BANDS.PERFORMING_WELL) {
    note = RECOGNITION_NOTE;
  } else {
    note = ENCOURAGEMENT_NOTE;
  }

  return { band, bandLabel: BAND_LABELS[band], factors, advisories, topConcern, note };
}

// Plain-language, reworded versions of the triggered factors, meant to be
// read directly by the student — no raw numbers, no internal threshold
// language, framed as "talk to your adviser" rather than an action an
// adviser would take on their behalf. Order follows FACTOR_PRIORITY too, so
// if a student-facing UI only has room for one line, the first one here is
// the same "most urgent" choice getTopConcern would make. Returns objects
// (not plain strings) so the "My Progress" page can group these by
// category (Grades vs Attendance) instead of one flat list.
function getStudentMessages(factors) {
  const byKey = new Map(factors.map((f) => [f.key, f]));
  const toEntry = (key) => ({ factorKey: key, category: FACTOR_CATEGORIES[key] || 'other', message: STUDENT_ADVISORY_MESSAGES[key] });
  const ordered = FACTOR_PRIORITY.filter((key) => byKey.has(key)).map(toEntry);
  // Covers a factor key FACTOR_PRIORITY doesn't list (same fail-open
  // reasoning as getTopConcern) — appended after the ranked ones.
  const unranked = factors.filter((f) => !FACTOR_PRIORITY.includes(f.key)).map((f) => toEntry(f.key));
  return [...ordered, ...unranked].filter((entry) => entry.message);
}

// What this student would concretely have to reach to clear each factor
// they're currently flagged on — the "what would move me out of this band"
// line on My Progress. Without it, a student is told they're At Risk and
// given advice to "talk to your adviser," but never the actual number to
// aim at.
//
// Note these are AND conditions, not alternatives: the band is At Risk
// whenever risk_score > 0, so every triggered factor has to clear before a
// student leaves it. Clearing any single one still lowers their risk LEVEL
// (fewer points), which is why each is listed separately rather than merged
// into one sentence. The caller is responsible for saying so — see
// MyProgressPage's wording.
function buildBandExitTargets({ averageGrade, gradeTrend, attendanceRate, attendanceTrend }) {
  const factors = evaluateFactors({
    currentGrade: averageGrade,
    gradeTrend,
    currentAttendanceRate: attendanceRate,
    attendanceTrend,
  });

  // `currentText` is the phrasing, not the raw number: a TREND of -6 shown
  // as "currently -6" reads like a score, and "-12.5%" reads like a
  // relative drop rather than 12.5 percentage points per period. Both are
  // spelled out here so the wording lives next to the rule it describes
  // instead of being reconstructed in the page.
  const TARGET_BUILDERS = {
    low_grade: () => ({
      measure: 'Average grade',
      current: averageGrade,
      currentText: averageGrade != null ? String(averageGrade) : null,
      target: GRADE_AT_RISK_THRESHOLD,
      text: `Raise your average grade to ${GRADE_AT_RISK_THRESHOLD} or above`,
    }),
    low_attendance: () => ({
      measure: 'Attendance rate',
      current: attendanceRate,
      currentText: attendanceRate != null ? `${attendanceRate}%` : null,
      target: ATTENDANCE_RISK_THRESHOLD,
      text: `Raise your attendance to ${ATTENDANCE_RISK_THRESHOLD}% or above`,
    }),
    declining_grade: () => ({
      measure: 'Grade trend',
      current: gradeTrend,
      currentText: gradeTrend != null ? `falling ${Math.abs(gradeTrend)} points a period` : null,
      target: GRADE_TREND_DECLINE_THRESHOLD,
      text: `Stop your average grade falling by more than ${Math.abs(GRADE_TREND_DECLINE_THRESHOLD)} points a grading period`,
    }),
    declining_attendance: () => ({
      measure: 'Attendance trend',
      current: attendanceTrend,
      currentText: attendanceTrend != null ? `falling ${Math.abs(attendanceTrend)} points a period` : null,
      target: ATTENDANCE_TREND_DECLINE_THRESHOLD,
      text: `Stop your attendance falling by more than ${Math.abs(ATTENDANCE_TREND_DECLINE_THRESHOLD)} points a grading period`,
    }),
  };

  // Ordered by FACTOR_PRIORITY so the most urgent target is listed first,
  // the same ranking every other student-facing list on this page uses.
  return FACTOR_PRIORITY.filter((key) => factors.some((f) => f.key === key) && TARGET_BUILDERS[key]).map((key) => ({
    factorKey: key,
    ...TARGET_BUILDERS[key](),
  }));
}

// Every check the formula makes, flagged or not, each with the rule it
// applies and where the student currently stands against it.
//
// Why ALL four and not just the triggered ones: a student looking at "High"
// cannot tell from a list of problems whether that is four problems out of
// four or four out of ten. Showing the checks that are NOT flagged is what
// turns the figure from a verdict into something they can reason about.
//
// Thresholds appear here in plain language, which is the same line
// buildBandExitTargets already draws: the numbers the formula checks are
// published DepEd-style thresholds and are safe to show a student; the risk
// SCORE and the per-factor weights remain internal and are still never sent.
function buildRiskChecks({ factors, averageGrade, gradeTrend, attendanceRate, attendanceTrend }) {
  const triggered = new Set(factors.map((f) => f.key));

  // These strings are read by a student, not by the formula. The values
  // behind them are Postgres NUMERICs carrying their full declared scale,
  // so a trend arrives as 5.885 and an average as "60.80" — printed
  // verbatim that reads as a readout from a database rather than a report
  // about a person, and implies a precision the measurement does not have.
  // Rounded for DISPLAY only: every comparison in the scoring above still
  // uses the full value.
  const forDisplay = (value) => String(Math.round(Number(value) * 10) / 10);

  const describeFall = (value, unit) => {
    if (value == null) return 'Needs two grading periods';
    if (value < 0) return `Falling ${forDisplay(Math.abs(value))} ${unit} a period`;
    if (value > 0) return `Rising ${forDisplay(value)} ${unit} a period`;
    return 'Holding steady';
  };

  const SPECS = {
    low_grade: {
      measure: 'Average grade',
      rule: `Flagged when it is below ${GRADE_AT_RISK_THRESHOLD}`,
      currentText: averageGrade != null ? forDisplay(averageGrade) : 'No finalized grades yet',
    },
    low_attendance: {
      measure: 'Attendance rate',
      rule: `Flagged when it is below ${ATTENDANCE_RISK_THRESHOLD}%`,
      currentText: attendanceRate != null ? `${forDisplay(attendanceRate)}%` : 'No attendance recorded yet',
    },
    declining_grade: {
      measure: 'Grade trend',
      rule: `Flagged when it falls by more than ${Math.abs(GRADE_TREND_DECLINE_THRESHOLD)} points a grading period`,
      currentText: describeFall(gradeTrend, 'points'),
    },
    declining_attendance: {
      measure: 'Attendance trend',
      rule: `Flagged when it falls by more than ${Math.abs(ATTENDANCE_TREND_DECLINE_THRESHOLD)} points a grading period`,
      currentText: describeFall(attendanceTrend, 'points'),
    },
  };

  // Same FACTOR_PRIORITY order as every other student-facing list here, so
  // the most urgent check is always read first.
  return FACTOR_PRIORITY.filter((key) => SPECS[key]).map((key) => ({
    factorKey: key,
    ...SPECS[key],
    triggered: triggered.has(key),
  }));
}

// The three risk levels restated as "how many checks are flagged", derived
// from the scoring config rather than written out again: each flagged check
// contributes POINTS_PER_TRIGGERED_FACTOR points, so a band's score range
// maps straight onto a count. If the client ever re-weights the formula,
// this sentence changes with it instead of quietly going out of date.
function buildLevelsByTriggeredCount() {
  return RISK_LEVEL_BANDS.map((band) => ({
    level: band.level,
    minTriggered: Math.ceil(band.minScore / POINTS_PER_TRIGGERED_FACTOR),
    maxTriggered: Number.isFinite(band.maxScore) ? Math.floor(band.maxScore / POINTS_PER_TRIGGERED_FACTOR) : null,
  }));
}

// The student-facing counterpart to buildAcademicProgress — same band
// classification (never recomputed differently), and a deliberately
// smaller response shape than the adviser-facing one: no risk score, no
// factor labels with embedded thresholds. It DOES include the plain
// average grade/attendance figures and their trends — unlike the score and
// thresholds, a student's own grade and attendance rate aren't internal
// numbers to withhold, and the "My Progress" stat tiles need them. Used
// only by controllers/myProgressController.js.
function buildStudentAcademicProgress({ riskScore, averageGrade, gradeTrend, attendanceRate, attendanceTrend }) {
  const factors = evaluateFactors({
    currentGrade: averageGrade,
    gradeTrend,
    currentAttendanceRate: attendanceRate,
    attendanceTrend,
  });
  const band = determineBand({ riskScore, averageGrade, gradeTrend });

  let note = null;
  let messages = [];
  let exitTargets = [];
  if (band === BANDS.AT_RISK) {
    messages = getStudentMessages(factors);
    exitTargets = buildBandExitTargets({ averageGrade, gradeTrend, attendanceRate, attendanceTrend });
  } else if (band === BANDS.PERFORMING_WELL) {
    note = STUDENT_RECOGNITION_NOTE;
  } else {
    note = STUDENT_ENCOURAGEMENT_NOTE;
  }

  return {
    band,
    bandLabel: BAND_LABELS[band],
    messages,
    note,
    exitTargets,
    averageGrade,
    gradeTrend,
    attendanceRate,
    attendanceTrend,
    // What the headline figures on the student's page are actually made of
    // — see buildRiskChecks. Sent for every band, not just At Risk: a
    // student who is doing fine should be able to see that all four checks
    // are clear, which is the same question asked from the other side.
    checks: buildRiskChecks({ factors, averageGrade, gradeTrend, attendanceRate, attendanceTrend }),
    levelsByTriggeredCount: buildLevelsByTriggeredCount(),
  };
}

module.exports = {
  determineBand,
  getAdvisories,
  getTopConcern,
  buildBandExitTargets,
  buildAcademicProgress,
  buildStudentAcademicProgress,
};
