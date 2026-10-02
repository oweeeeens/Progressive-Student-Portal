// Owns all reads/writes against grades. A grade starts 'draft' when a
// subject teacher enters it; it only becomes 'finalized' when that student's
// adviser approves it. The risk engine (see riskEngine.js) must only ever
// read 'finalized' rows — see migration 20261001035311515 for why.
const { pool } = require('../config/db');

async function getActiveStudentsInOffering(classOfferingId) {
  const result = await pool.query(
    `SELECT s.id, s.first_name, s.last_name
     FROM students s
     JOIN class_offerings co ON co.section_id = s.current_section_id
     WHERE co.id = $1 AND s.is_active = TRUE
     ORDER BY s.last_name, s.first_name`,
    [classOfferingId]
  );
  return result.rows;
}

// Upsert: re-submitting a grade always resets it to 'draft', even if it was
// previously finalized — a corrected grade is unreviewed data again and must
// go back through the adviser before it can feed the risk engine.
async function upsertDraftGrades({ classOfferingId, gradingPeriodId, recordedBy, entries }) {
  const columns = ['student_id', 'class_offering_id', 'grading_period_id', 'grade_value', 'recorded_by'];
  const params = [];
  const valueGroups = entries.map((entry) => {
    const row = [entry.studentId, classOfferingId, gradingPeriodId, entry.gradeValue, recordedBy];
    const placeholders = row.map((value) => {
      params.push(value);
      return `$${params.length}`;
    });
    return `(${placeholders.join(', ')})`;
  });

  const result = await pool.query(
    `INSERT INTO grades (${columns.join(', ')})
     VALUES ${valueGroups.join(', ')}
     ON CONFLICT (student_id, class_offering_id, grading_period_id)
     DO UPDATE SET grade_value = EXCLUDED.grade_value, recorded_by = EXCLUDED.recorded_by,
                   recorded_at = now(), status = 'draft', finalized_by = NULL, finalized_at = NULL
     RETURNING id, student_id, grade_value, status`,
    params
  );
  return result.rows;
}

// The adviser's review queue: every draft grade (any subject) for students
// in one section for one grading period.
async function listDraftsForSection(sectionId, gradingPeriodId) {
  const result = await pool.query(
    `SELECT g.id, g.student_id, s.first_name, s.last_name, g.grade_value,
            subj.name AS subject_name, u.full_name AS recorded_by_name
     FROM grades g
     JOIN students s ON s.id = g.student_id
     JOIN class_offerings co ON co.id = g.class_offering_id
     JOIN subjects subj ON subj.id = co.subject_id
     JOIN users u ON u.id = g.recorded_by
     WHERE co.section_id = $1 AND g.grading_period_id = $2 AND g.status = 'draft'
     ORDER BY s.last_name, s.first_name, subj.name`,
    [sectionId, gradingPeriodId]
  );
  return result.rows;
}

// Finalizes every draft grade for a section+period in one action (the
// adviser reviewing a quarter's grades for their whole advisory class at
// once). Returns the distinct student ids affected, so the caller can
// trigger a risk recalculation for exactly those students.
async function finalizeSectionGrades(sectionId, gradingPeriodId, finalizedBy) {
  const result = await pool.query(
    `UPDATE grades g
     SET status = 'finalized', finalized_by = $3, finalized_at = now()
     FROM class_offerings co
     WHERE g.class_offering_id = co.id
       AND co.section_id = $1
       AND g.grading_period_id = $2
       AND g.status = 'draft'
     RETURNING g.student_id`,
    [sectionId, gradingPeriodId, finalizedBy]
  );
  return [...new Set(result.rows.map((r) => r.student_id))]; // one student can have multiple subjects finalized at once
}

async function getHistoryForStudent(studentId) {
  const result = await pool.query(
    `SELECT g.id, g.grade_value, g.status, g.recorded_at, g.finalized_at,
            subj.name AS subject_name, gp.name AS grading_period_name, gp.sequence_number
     FROM grades g
     JOIN class_offerings co ON co.id = g.class_offering_id
     JOIN subjects subj ON subj.id = co.subject_id
     JOIN grading_periods gp ON gp.id = g.grading_period_id
     WHERE g.student_id = $1
     ORDER BY gp.sequence_number DESC, subj.name`,
    [studentId]
  );
  return result.rows;
}

// Per-grading-period average of a student's FINALIZED grades only (across
// all their subjects), ordered oldest-to-newest by the period's
// sequence_number. This is the series the risk engine's trend calculation
// walks — see riskEngine.js.
async function getFinalizedAveragesByPeriod(studentId) {
  const result = await pool.query(
    `SELECT gp.id AS grading_period_id, gp.sequence_number, AVG(g.grade_value)::numeric(5,2) AS average_grade
     FROM grades g
     JOIN grading_periods gp ON gp.id = g.grading_period_id
     WHERE g.student_id = $1 AND g.status = 'finalized'
     GROUP BY gp.id, gp.sequence_number
     ORDER BY gp.sequence_number`,
    [studentId]
  );
  return result.rows;
}

module.exports = {
  getActiveStudentsInOffering,
  upsertDraftGrades,
  listDraftsForSection,
  finalizeSectionGrades,
  getHistoryForStudent,
  getFinalizedAveragesByPeriod,
};
