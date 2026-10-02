// =============================================================================
// Risk Engine — the DB-facing layer around riskCalculator.js
// =============================================================================
// riskCalculator.js knows the formula but nothing about the database. This
// file does the opposite: it fetches a student's finalized-grade and
// daily-attendance history, shapes it into the plain numbers the calculator
// expects, and persists the result. Keeping these separate means the formula
// (the part a panel will ask hard questions about) can be read and tested
// with zero database setup — see scripts/testRiskCalculator.js.
//
// Per CLAUDE.md: risk is "recalculated whenever new grades/attendance are
// entered (not real-time)" — so this is called synchronously right after a
// grade-finalization or daily-attendance write, not on a timer and not on
// every dashboard page load. See dailyAttendanceController.js and
// gradeController.js for the call sites.
// =============================================================================

const gradeModel = require('../models/gradeModel');
const dailyAttendanceModel = require('../models/dailyAttendanceModel');
const gradingPeriodModel = require('../models/gradingPeriodModel');
const riskAssessmentModel = require('../models/riskAssessmentModel');
const interventionModel = require('../models/interventionModel');
const { calculateTrend, calculateRiskScore, compareRiskLevels } = require('./riskCalculator');

// Narrows a [{sequence_number, value}] series down to periods up to and
// including the target period (never look at "future" periods), and splits
// it into the single current-period value plus the ordered series used for
// trend. Shared shape for both grades and attendance.
function extractCurrentAndSeries(periodRows, targetSequenceNumber, valueKey) {
  const upToTarget = periodRows.filter((row) => row.sequence_number <= targetSequenceNumber);
  const currentRow = upToTarget.find((row) => row.sequence_number === targetSequenceNumber);
  return {
    current: currentRow ? Number(currentRow[valueKey]) : null,
    trend: calculateTrend(upToTarget.map((row) => Number(row[valueKey]))),
  };
}

// Recalculates and stores one student's risk assessment for one grading
// period. Safe to call repeatedly (e.g. once per affected student after a
// bulk attendance submission) — each call is an independent upsert.
async function recalculateRiskForStudent(studentId, gradingPeriodId) {
  const targetPeriod = await gradingPeriodModel.getById(gradingPeriodId);
  if (!targetPeriod) {
    throw new Error(`recalculateRiskForStudent: grading period ${gradingPeriodId} does not exist`);
  }

  const [gradeRows, attendanceRows] = await Promise.all([
    gradeModel.getFinalizedAveragesByPeriod(studentId),
    dailyAttendanceModel.getAttendanceRatesByPeriod(studentId),
  ]);

  const grade = extractCurrentAndSeries(gradeRows, targetPeriod.sequence_number, 'average_grade');
  const attendance = extractCurrentAndSeries(attendanceRows, targetPeriod.sequence_number, 'attendance_rate');

  const { score, level } = calculateRiskScore({
    currentGrade: grade.current,
    gradeTrend: grade.trend,
    currentAttendanceRate: attendance.current,
    attendanceTrend: attendance.trend,
  });

  const assessment = await riskAssessmentModel.upsert({
    studentId,
    gradingPeriodId,
    averageGrade: grade.current,
    gradeTrend: grade.trend,
    attendanceRate: attendance.current,
    attendanceTrend: attendance.trend,
    riskScore: score,
    riskLevel: level,
  });

  await closeOutInterventions(studentId, targetPeriod.sequence_number, level);

  return assessment;
}

// CLAUDE.md Part B — the closed loop: any intervention still open/monitoring
// from a period strictly before this one gets auto-compared against the
// level that was just calculated. Improved -> Resolved; same or worse ->
// Escalated. Once closed, an intervention is never reopened by this logic.
async function closeOutInterventions(studentId, newPeriodSequenceNumber, newLevel) {
  const pending = await interventionModel.findOpenOrMonitoringBeforePeriod(studentId, newPeriodSequenceNumber);

  await Promise.all(
    pending.map((intervention) => {
      const outcome = compareRiskLevels(intervention.risk_level_at_intervention, newLevel);
      const newStatus = outcome === 'improved' ? 'resolved' : 'escalated';
      return interventionModel.updateStatus(intervention.id, newStatus);
    })
  );
}

// Convenience for bulk triggers (finalize a section's grades, submit a
// section's daily attendance) — recalculates each affected student
// independently so one student's data issue can't block the rest.
async function recalculateRiskForStudents(studentIds, gradingPeriodId) {
  const results = await Promise.allSettled(
    studentIds.map((studentId) => recalculateRiskForStudent(studentId, gradingPeriodId))
  );
  const failures = results.filter((r) => r.status === 'rejected');
  if (failures.length > 0) {
    console.error('Risk recalculation failed for some students:', failures.map((f) => f.reason));
  }
  return results;
}

module.exports = { recalculateRiskForStudent, recalculateRiskForStudents };
