// Config for the Academic Progress Tracking module's three performance
// bands and their advisory/encouragement/recognition text. Deliberately
// separate from config/riskConfig.js — that file's weights/thresholds are
// the existing, unchanged risk-SCORING logic; everything here is new
// presentation layered on top of an already-computed risk_score/risk_level,
// never fed back into the score itself.
//
// Advisory text is rule-based (one fixed message per triggered factor), not
// AI-generated — same reasoning as the rest of this app's risk logic:
// deterministic and explainable under questioning, no new external service
// dependency, and no minors' academic data going to a third-party API. See
// services/academicProgressCalculator.js for how these get selected.

// A student with zero triggered risk factors still needs a grade signal to
// be called "Performing Well" rather than merely "Average/Steady" — DepEd's
// own "Outstanding" band starts at 90 on the transmuted 60-100 scale, the
// same convention CLAUDE.md already anchors GRADE_AT_RISK_THRESHOLD (75) to.
const PERFORMING_WELL_GRADE_THRESHOLD = 90;

// An "improving fast" trend, symmetric to riskConfig.js's
// GRADE_TREND_DECLINE_THRESHOLD (-5) — a student doesn't have to already be
// in the 90s to count as performing well if their grades are climbing this
// quickly period over period.
const PERFORMING_WELL_TREND_THRESHOLD = 5;

const BANDS = {
  AT_RISK: 'at_risk',
  AVERAGE: 'average',
  PERFORMING_WELL: 'performing_well',
};

const BAND_LABELS = {
  [BANDS.AT_RISK]: 'At Risk',
  [BANDS.AVERAGE]: 'Average / Steady',
  [BANDS.PERFORMING_WELL]: 'Performing Well',
};

// One fixed action per risk factor key (see services/riskCalculator.js's
// evaluateFactors) — shown alongside that factor on an At Risk student's
// row. Deliberately just the recommended next step, not a restatement of
// the condition — riskCalculator's own factor.label already states the
// condition with its actual numbers (e.g. "Current grade (62) is below the
// at-risk threshold of 75"), so repeating "current grade is below
// threshold" here would just be the same fact said twice in one line.
const ADVISORY_MESSAGES = {
  low_grade: 'Consider a tutoring referral.',
  declining_grade: 'Consider a tutoring referral or a parent conference.',
  low_attendance: 'Consider an attendance follow-up.',
  declining_attendance: 'Consider an attendance follow-up or a parent conference.',
};

// Which triggered factor counts as a student's single "top concern" for the
// collapsed/glanceable row — an already-realized problem (a grade or
// attendance rate currently below threshold) ranks above an early-warning
// trend (still declining, but not yet below threshold on its own), since
// the former is the more urgent, already-true fact. Within each tier, grade
// comes before attendance as the primary academic measure. Only used to
// pick ONE factor to headline; the full list is still shown on expand.
const FACTOR_PRIORITY = ['low_grade', 'low_attendance', 'declining_grade', 'declining_attendance'];

// Which of the two groupings a triggered factor belongs under — used by the
// "My Progress" student view to show advisory messages grouped by Grades vs
// Attendance instead of one flat list, so a student can tell at a glance
// which area needs attention.
const FACTOR_CATEGORIES = {
  low_grade: 'grades',
  declining_grade: 'grades',
  low_attendance: 'attendance',
  declining_attendance: 'attendance',
};

const ENCOURAGEMENT_NOTE = 'Maintaining steady performance.';
const RECOGNITION_NOTE = 'Consistently strong academic performance — consider recognition.';

// Student-facing versions of the above — second person, no numbers, no
// internal threshold language, and no "refer this student" framing (that's
// an adviser action, not something to say to the student themselves). See
// services/academicProgressCalculator.js's buildStudentAcademicProgress,
// used only by the "My Progress" student self-view
// (controllers/myProgressController.js) — the adviser-facing dashboard and
// Student Detail badge keep using ADVISORY_MESSAGES/ENCOURAGEMENT_NOTE/
// RECOGNITION_NOTE above, unchanged.
const STUDENT_ADVISORY_MESSAGES = {
  low_grade: 'Your current grade is below passing — consider talking to your adviser about tutoring support.',
  declining_grade: 'Your grades have been declining — consider talking to your adviser about tutoring support.',
  low_attendance: 'Your attendance has been below the required level — try to attend more consistently, and talk to your adviser if something is getting in the way.',
  declining_attendance: 'Your attendance has been declining — consider talking to your adviser.',
};
const STUDENT_ENCOURAGEMENT_NOTE = "You're maintaining steady performance. Keep it up!";
const STUDENT_RECOGNITION_NOTE = "Great work! You're performing well — keep it up.";

module.exports = {
  PERFORMING_WELL_GRADE_THRESHOLD,
  PERFORMING_WELL_TREND_THRESHOLD,
  BANDS,
  BAND_LABELS,
  ADVISORY_MESSAGES,
  FACTOR_PRIORITY,
  FACTOR_CATEGORIES,
  ENCOURAGEMENT_NOTE,
  RECOGNITION_NOTE,
  STUDENT_ADVISORY_MESSAGES,
  STUDENT_ENCOURAGEMENT_NOTE,
  STUDENT_RECOGNITION_NOTE,
};
