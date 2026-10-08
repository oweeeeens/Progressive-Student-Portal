// Owns all reads/writes against grades. Per CLAUDE.md's confirmed 3-stage
// approval chain, a grade moves: 'submitted' (subject teacher enters it) ->
// 'principal_verified' (principal reviews) -> 'finalized' (adviser inputs it
// into the official record) — or 'rejected' at the principal step, which
// sends it back to the subject teacher to correct and resubmit. The risk
// engine (see riskEngine.js) must only ever read 'finalized' rows — see
// migrations 20261001035311515 and 20261006120000000 for why.
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

// Upsert: (re-)submitting a grade always resets it to 'submitted', even if it
// was previously rejected, verified, or finalized — a corrected grade is
// unreviewed data again and must go back through the full principal ->
// adviser chain before it can feed the risk engine. Clearing the rejection
// note here is deliberate: its job (telling the teacher what to fix) is done
// once they've acted on it and resubmitted.
async function upsertSubmittedGrades({ classOfferingId, gradingPeriodId, recordedBy, entries }) {
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
                   recorded_at = now(), status = 'submitted',
                   verified_by = NULL, verified_at = NULL,
                   rejected_by = NULL, rejected_at = NULL, rejection_note = NULL,
                   finalized_by = NULL, finalized_at = NULL
     RETURNING id, student_id, grade_value, status`,
    params
  );
  return result.rows;
}

// What the subject teacher sees when they reopen a class+period they've
// already submitted — lets the entry page prefill existing values and show
// the current status (and, if rejected, why) per student, instead of always
// starting from a blank sheet.
async function getSubmissionsForOffering(classOfferingId, gradingPeriodId) {
  const result = await pool.query(
    `SELECT student_id, grade_value, status, rejection_note
     FROM grades
     WHERE class_offering_id = $1 AND grading_period_id = $2`,
    [classOfferingId, gradingPeriodId]
  );
  return result.rows;
}

// The principal's review queue. Unlike the adviser (scoped to one advisory
// section) the principal is one person for the whole school, so this lists
// every submitted grade across every section/subject for a period, with an
// optional section filter to make a large queue manageable.
async function listSubmittedGrades({ gradingPeriodId, sectionId, page = 1, pageSize = 20 }) {
  const clauses = ['g.grading_period_id = $1', "g.status = 'submitted'"];
  const params = [gradingPeriodId];
  if (sectionId) {
    params.push(sectionId);
    clauses.push(`co.section_id = $${params.length}`);
  }
  const where = clauses.join(' AND ');

  const countResult = await pool.query(
    `SELECT COUNT(*) FROM grades g JOIN class_offerings co ON co.id = g.class_offering_id WHERE ${where}`,
    params
  );
  const total = Number(countResult.rows[0].count);

  const limit = Math.max(Number(pageSize) || 20, 1);
  const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;
  const dataParams = [...params, limit, offset];
  const dataResult = await pool.query(
    `SELECT g.id, g.student_id, st.first_name, st.last_name, g.grade_value,
            sec.name AS section_name, sec.grade_level, subj.name AS subject_name,
            u.full_name AS recorded_by_name
     FROM grades g
     JOIN students st ON st.id = g.student_id
     JOIN class_offerings co ON co.id = g.class_offering_id
     JOIN sections sec ON sec.id = co.section_id
     JOIN subjects subj ON subj.id = co.subject_id
     JOIN users u ON u.id = g.recorded_by
     WHERE ${where}
     ORDER BY sec.grade_level, sec.name, subj.name, st.last_name, st.first_name
     LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
    dataParams
  );

  return { rows: dataResult.rows, total };
}

// Bulk-verify: only rows currently 'submitted' are affected, so re-selecting
// an already-verified/rejected row by mistake is a harmless no-op rather
// than an error.
async function verifyGrades(gradeIds, verifiedBy) {
  const result = await pool.query(
    `UPDATE grades
     SET status = 'principal_verified', verified_by = $2, verified_at = now()
     WHERE id = ANY($1::int[]) AND status = 'submitted'
     RETURNING id`,
    [gradeIds, verifiedBy]
  );
  return result.rows.map((r) => r.id);
}

// Bulk-reject: one shared note applied to every selected row (reviewing a
// batch together and leaving one explanation, e.g. "recheck attendance-
// adjusted scores for Q2", is the common case — a per-row note would need a
// much heavier review UI for a benefit most rejections don't need).
async function rejectGrades(gradeIds, rejectedBy, note) {
  const result = await pool.query(
    `UPDATE grades
     SET status = 'rejected', rejected_by = $2, rejected_at = now(), rejection_note = $3
     WHERE id = ANY($1::int[]) AND status = 'submitted'
     RETURNING id`,
    [gradeIds, rejectedBy, note]
  );
  return result.rows.map((r) => r.id);
}

// The adviser's review queue: every principal-verified grade (any subject)
// for students in one section for one grading period.
async function listPrincipalVerifiedForSection(sectionId, gradingPeriodId) {
  const result = await pool.query(
    `SELECT g.id, g.student_id, s.first_name, s.last_name, g.grade_value,
            subj.name AS subject_name, u.full_name AS recorded_by_name, v.full_name AS verified_by_name
     FROM grades g
     JOIN students s ON s.id = g.student_id
     JOIN class_offerings co ON co.id = g.class_offering_id
     JOIN subjects subj ON subj.id = co.subject_id
     JOIN users u ON u.id = g.recorded_by
     JOIN users v ON v.id = g.verified_by
     WHERE co.section_id = $1 AND g.grading_period_id = $2 AND g.status = 'principal_verified'
     ORDER BY s.last_name, s.first_name, subj.name`,
    [sectionId, gradingPeriodId]
  );
  return result.rows;
}

// Finalizes every principal-verified grade for a section+period in one
// action (the adviser reviewing a quarter's grades for their whole advisory
// class at once). Returns the distinct student ids affected, so the caller
// can trigger a risk recalculation for exactly those students.
async function finalizeSectionGrades(sectionId, gradingPeriodId, finalizedBy) {
  const result = await pool.query(
    `UPDATE grades g
     SET status = 'finalized', finalized_by = $3, finalized_at = now()
     FROM class_offerings co
     WHERE g.class_offering_id = co.id
       AND co.section_id = $1
       AND g.grading_period_id = $2
       AND g.status = 'principal_verified'
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

// Subject-by-period detail of a student's FINALIZED grades only — the
// report card's source data (official grades only, never a still-pending
// submission). Same shape as getHistoryForStudent, just pre-filtered,
// since the report card has no use for a grade that isn't official yet.
async function getFinalizedHistoryForStudent(studentId) {
  const result = await pool.query(
    `SELECT g.grade_value, subj.name AS subject_name, gp.name AS grading_period_name, gp.sequence_number
     FROM grades g
     JOIN class_offerings co ON co.id = g.class_offering_id
     JOIN subjects subj ON subj.id = co.subject_id
     JOIN grading_periods gp ON gp.id = g.grading_period_id
     WHERE g.student_id = $1 AND g.status = 'finalized'
     ORDER BY gp.sequence_number, subj.name`,
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
  upsertSubmittedGrades,
  getSubmissionsForOffering,
  listSubmittedGrades,
  verifyGrades,
  rejectGrades,
  listPrincipalVerifiedForSection,
  finalizeSectionGrades,
  getHistoryForStudent,
  getFinalizedHistoryForStudent,
  getFinalizedAveragesByPeriod,
};
