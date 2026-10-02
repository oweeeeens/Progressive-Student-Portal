// =============================================================================
// Risk Scoring Engine
// =============================================================================
// Implements CLAUDE.md's Trend-Based Academic Risk formula. This file is
// intentionally pure — it takes plain numbers in and returns plain objects
// out, with ZERO database access. riskEngine.js is the layer that fetches
// data from the DB and hands it to the functions here; keeping that
// separation means the formula itself can be read, reasoned about, and
// tested (see scripts/testRiskCalculator.js) completely independently of
// how the numbers were produced.
//
// All thresholds/weights referenced below live in config/riskConfig.js, not
// as bare numbers in this file — see that file for what each one means and
// which one (the attendance threshold) is still a client-pending placeholder.
// =============================================================================

const riskConfig = require('../config/riskConfig');

// -----------------------------------------------------------------------------
// Trend calculation
// -----------------------------------------------------------------------------
// CLAUDE.md's formula, applied literally:
//   Trend = (Most Recent Value − Earliest Value) / Number of Periods
//
// `orderedValues` must already be sorted oldest-to-newest (one value per
// grading period that has data — periods with no data yet are simply absent
// from the array, not zero). A negative trend means declining.
//
// With fewer than 2 data points there is nothing to compare, so we return
// null rather than 0 — null means "trend not yet measurable," which the
// scoring step below treats as "don't penalize," whereas 0 would mean "flat,
// no change," a different and false claim to make from a single data point.
function calculateTrend(orderedValues) {
  if (orderedValues.length < 2) {
    return null;
  }
  const earliest = orderedValues[0];
  const mostRecent = orderedValues[orderedValues.length - 1];
  const numberOfPeriods = orderedValues.length;
  return (mostRecent - earliest) / numberOfPeriods;
}

// -----------------------------------------------------------------------------
// Factor evaluation
// -----------------------------------------------------------------------------
// Each of the four inputs below can independently trigger a risk factor.
// A null/undefined input (no finalized grade yet this period, or no
// attendance recorded yet) never triggers a factor — missing data is not
// evidence of risk, it's just data we don't have yet.
//
// Returns an array (possibly empty) of the factors that triggered, each
// carrying a machine-readable `key`, a human-readable `label` (used directly
// by the dashboard to explain "why" a student was flagged), and the points
// it contributes.
function evaluateFactors({ currentGrade, gradeTrend, currentAttendanceRate, attendanceTrend }) {
  const factors = [];
  const points = riskConfig.POINTS_PER_TRIGGERED_FACTOR;

  if (currentGrade != null && currentGrade < riskConfig.GRADE_AT_RISK_THRESHOLD) {
    factors.push({
      key: 'low_grade',
      label: `Current grade (${currentGrade}) is below the at-risk threshold of ${riskConfig.GRADE_AT_RISK_THRESHOLD}`,
      points,
    });
  }

  if (gradeTrend != null && gradeTrend <= riskConfig.GRADE_TREND_DECLINE_THRESHOLD) {
    factors.push({
      key: 'declining_grade',
      label: `Grade is declining by ${Math.abs(gradeTrend).toFixed(1)} points per period`,
      points,
    });
  }

  if (currentAttendanceRate != null && currentAttendanceRate < riskConfig.ATTENDANCE_RISK_THRESHOLD) {
    factors.push({
      key: 'low_attendance',
      label: `Attendance rate (${currentAttendanceRate}%) is below the at-risk threshold of ${riskConfig.ATTENDANCE_RISK_THRESHOLD}%`,
      points,
    });
  }

  if (attendanceTrend != null && attendanceTrend <= riskConfig.ATTENDANCE_TREND_DECLINE_THRESHOLD) {
    factors.push({
      key: 'declining_attendance',
      label: `Attendance is declining by ${Math.abs(attendanceTrend).toFixed(1)} percentage points per period`,
      points,
    });
  }

  return factors;
}

// -----------------------------------------------------------------------------
// Risk level banding
// -----------------------------------------------------------------------------
function determineRiskLevel(score) {
  const band = riskConfig.RISK_LEVEL_BANDS.find((b) => score >= b.minScore && score <= b.maxScore);
  // RISK_LEVEL_BANDS' last band extends to Infinity, so this should always
  // match — this fallback only exists so a future misconfigured bands list
  // fails loudly instead of returning undefined.
  if (!band) throw new Error(`No risk level band covers score ${score} — check config/riskConfig.js`);
  return band.level;
}

// -----------------------------------------------------------------------------
// Top-level entry point
// -----------------------------------------------------------------------------
// Given one student's current-period numbers, returns the full risk
// assessment: the triggered factors (for the dashboard's "why" column), the
// total score, and the resulting low/medium/high level.
function calculateRiskScore(inputs) {
  const factors = evaluateFactors(inputs);
  const score = factors.reduce((total, factor) => total + factor.points, 0);
  const level = determineRiskLevel(score);
  return { score, level, factors };
}

// -----------------------------------------------------------------------------
// Intervention outcome comparison (CLAUDE.md Part B — the closed loop)
// -----------------------------------------------------------------------------
// "On next grading period's risk recalculation, auto-compare new risk level
// to the risk level at time of intervention: Improved -> Resolved; Same or
// worse -> Escalated." This is the single place that decides what
// "improved" means (moved to a strictly lower-ranked level), so
// riskEngine.js never has to know the low < medium < high ordering itself.
function compareRiskLevels(levelAtIntervention, newLevel) {
  const oldRank = riskConfig.RISK_LEVEL_RANK[levelAtIntervention];
  const newRank = riskConfig.RISK_LEVEL_RANK[newLevel];
  return newRank < oldRank ? 'improved' : 'same_or_worse';
}

module.exports = {
  calculateTrend,
  evaluateFactors,
  determineRiskLevel,
  calculateRiskScore,
  compareRiskLevels,
};
