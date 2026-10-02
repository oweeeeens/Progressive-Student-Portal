// Single source of truth for the risk formula's weights and thresholds, per
// CLAUDE.md: "Keep the risk formula weights/thresholds in a single config
// file, not hardcoded throughout — the client or adviser may want to adjust
// them later." Nothing in riskCalculator.js should have a bare number in it
// that isn't one of these.

// DepEd's at-risk cutoff for a transmuted grade (60-100 scale).
const GRADE_AT_RISK_THRESHOLD = 75;

// "Declining fast" per CLAUDE.md's formula: trend <= -5 points per grading
// period counts as a risk factor, regardless of the starting grade.
const GRADE_TREND_DECLINE_THRESHOLD = -5;

// *** PLACEHOLDER — NOT YET CONFIRMED BY THE CLIENT ***
// CLAUDE.md flags this explicitly: "Attendance risk threshold is still
// pending confirmation from the client (DepEd Order referenced but not yet
// provided) — use placeholder until confirmed, make this value
// configurable/easy to change." 90% is a commonly-cited DepEd attendance
// expectation, used here only as a reasonable stand-in. Override via the
// ATTENDANCE_RISK_THRESHOLD env var without touching code once the client
// confirms the real number — no redeploy of logic required, just the env var.
const ATTENDANCE_RISK_THRESHOLD = process.env.ATTENDANCE_RISK_THRESHOLD
  ? Number(process.env.ATTENDANCE_RISK_THRESHOLD)
  : 90;

// "Declining fast" for attendance, same -5-per-period shape as grades.
const ATTENDANCE_TREND_DECLINE_THRESHOLD = -5;

// Each triggered factor contributes this many points (CLAUDE.md: "+2" per factor).
const POINTS_PER_TRIGGERED_FACTOR = 2;

// Risk level bands, inclusive at the low end of each range.
const RISK_LEVEL_BANDS = [
  { level: 'low', minScore: 0, maxScore: 2 },
  { level: 'medium', minScore: 3, maxScore: 5 },
  { level: 'high', minScore: 6, maxScore: Infinity },
];

// Ordering of risk levels from best to worst, used by the intervention
// auto-resolve/escalate comparison (CLAUDE.md Part B) to decide whether a
// student's risk "improved" (moved to a lower-ranked level) since an
// intervention was logged. Derived from RISK_LEVEL_BANDS' own order so there
// is exactly one place that defines "low < medium < high."
const RISK_LEVEL_RANK = Object.fromEntries(RISK_LEVEL_BANDS.map((band, index) => [band.level, index]));

module.exports = {
  GRADE_AT_RISK_THRESHOLD,
  GRADE_TREND_DECLINE_THRESHOLD,
  ATTENDANCE_RISK_THRESHOLD,
  ATTENDANCE_TREND_DECLINE_THRESHOLD,
  POINTS_PER_TRIGGERED_FACTOR,
  RISK_LEVEL_BANDS,
  RISK_LEVEL_RANK,
};
