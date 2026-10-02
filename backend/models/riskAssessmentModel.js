// Owns reads/writes against risk_assessments — the stored snapshot produced
// by riskEngine.js for one student in one grading period. Deliberately
// stores only numbers (average_grade, trends, score, level), not the
// human-readable "why" — the dashboard re-derives triggered factors from
// those numbers at read time via riskCalculator.evaluateFactors, so there is
// exactly one place (riskCalculator.js) that knows what a "triggered factor" is.
const { pool } = require('../config/db');

async function upsert({ studentId, gradingPeriodId, averageGrade, gradeTrend, attendanceRate, attendanceTrend, riskScore, riskLevel }) {
  const result = await pool.query(
    `INSERT INTO risk_assessments
       (student_id, grading_period_id, average_grade, grade_trend, attendance_rate, attendance_trend, risk_score, risk_level, calculated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
     ON CONFLICT (student_id, grading_period_id)
     DO UPDATE SET average_grade = EXCLUDED.average_grade, grade_trend = EXCLUDED.grade_trend,
                   attendance_rate = EXCLUDED.attendance_rate, attendance_trend = EXCLUDED.attendance_trend,
                   risk_score = EXCLUDED.risk_score, risk_level = EXCLUDED.risk_level, calculated_at = now()
     RETURNING *`,
    [studentId, gradingPeriodId, averageGrade, gradeTrend, attendanceRate, attendanceTrend, riskScore, riskLevel]
  );
  return result.rows[0];
}

// For the risk dashboard: every student in a section (or, with no section
// filter, every active student) alongside their latest assessment for one
// grading period. LEFT JOIN so a student with no assessment yet (no
// finalized grades or attendance recorded this period) still appears.
async function listForDashboard({ sectionId, gradingPeriodId }) {
  const clauses = ['s.is_active = TRUE'];
  const params = [gradingPeriodId];
  clauses.push('(ra.grading_period_id = $1 OR ra.grading_period_id IS NULL)');

  if (sectionId) {
    params.push(sectionId);
    clauses.push(`s.current_section_id = $${params.length}`);
  }

  const result = await pool.query(
    `SELECT s.id AS student_id, s.first_name, s.last_name, sec.name AS section_name, sec.grade_level,
            ra.average_grade, ra.grade_trend, ra.attendance_rate, ra.attendance_trend,
            ra.risk_score, ra.risk_level, ra.calculated_at
     FROM students s
     LEFT JOIN sections sec ON sec.id = s.current_section_id
     LEFT JOIN risk_assessments ra ON ra.student_id = s.id AND ra.grading_period_id = $1
     WHERE ${clauses.join(' AND ')}
     ORDER BY
       CASE ra.risk_level WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 ELSE 3 END,
       s.last_name, s.first_name`,
    params
  );
  return result.rows;
}

// Used when logging an intervention: "the risk level right now" for this
// student, so interventions.risk_assessment_id captures the correct snapshot.
async function getForStudentAndPeriod(studentId, gradingPeriodId) {
  const result = await pool.query(
    'SELECT * FROM risk_assessments WHERE student_id = $1 AND grading_period_id = $2',
    [studentId, gradingPeriodId]
  );
  return result.rows[0] || null;
}

module.exports = { upsert, listForDashboard, getForStudentAndPeriod };
