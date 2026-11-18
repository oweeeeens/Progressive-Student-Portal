// Reads for the panel's reports (panel revision, 2026-11-18): the adviser
// gradesheet, the subject teacher's class grade report and the enrolled
// student list. Read-only, and every figure comes from the same tables the
// rest of the system uses — no report keeps a copy of anything.
const { pool } = require('../config/db');

// --- Adviser gradesheet -----------------------------------------------------

// The section, its school year and adviser.
async function getSectionHeader(sectionId) {
  const result = await pool.query(
    `SELECT sec.id, sec.name, sec.grade_level, sec.strand, sec.adviser_id, sec.school_year_id,
            sy.label AS school_year, u.full_name AS adviser_name
     FROM sections sec
     JOIN school_years sy ON sy.id = sec.school_year_id
     LEFT JOIN users u ON u.id = sec.adviser_id
     WHERE sec.id = $1`,
    [sectionId]
  );
  return result.rows[0] || null;
}

// The section's active classes, with subject, term and teacher.
async function listSectionOfferings(sectionId) {
  const result = await pool.query(
    `SELECT co.id, co.term, subj.id AS subject_id, subj.name AS subject_name, subj.code AS subject_code,
            subj.category AS subject_category, u.full_name AS teacher_name
     FROM class_offerings co
     JOIN subjects subj ON subj.id = co.subject_id
     LEFT JOIN users u ON u.id = co.teacher_id
     WHERE co.section_id = $1 AND co.is_active = TRUE
     ORDER BY subj.name, co.term`,
    [sectionId]
  );
  return result.rows;
}

// The learners in the section now (active), in roll order.
async function listSectionStudents(sectionId) {
  const result = await pool.query(
    `SELECT id, lrn, first_name, middle_name, last_name, sex
     FROM students
     WHERE current_section_id = $1 AND is_active = TRUE
     ORDER BY last_name, first_name, id`,
    [sectionId]
  );
  return result.rows;
}

// FINALIZED grades only — the official record — for these classes and
// learners. Grades still in the approval chain are deliberately excluded.
async function listFinalizedGrades(offeringIds, studentIds) {
  if (offeringIds.length === 0 || studentIds.length === 0) return [];
  const result = await pool.query(
    `SELECT student_id, class_offering_id, grading_period_id, grade_value
     FROM grades
     WHERE status = 'finalized' AND class_offering_id = ANY($1::int[]) AND student_id = ANY($2::int[])`,
    [offeringIds, studentIds]
  );
  return result.rows;
}

// --- Subject teacher's class grade report -----------------------------------

// One class with its subject, section, school year and teacher.
async function getOfferingHeader(offeringId) {
  const result = await pool.query(
    `SELECT co.id, co.term, co.teacher_id, co.section_id, co.school_year_id,
            subj.name AS subject_name, subj.code AS subject_code, subj.category AS subject_category,
            sec.name AS section_name, sec.grade_level, sec.strand,
            sy.label AS school_year, u.full_name AS teacher_name
     FROM class_offerings co
     JOIN subjects subj ON subj.id = co.subject_id
     JOIN sections sec ON sec.id = co.section_id
     JOIN school_years sy ON sy.id = co.school_year_id
     LEFT JOIN users u ON u.id = co.teacher_id
     WHERE co.id = $1`,
    [offeringId]
  );
  return result.rows[0] || null;
}

// Every grade in a class, at whatever stage of the approval chain it is.
async function listOfferingGrades(offeringId) {
  const result = await pool.query(
    `SELECT student_id, grading_period_id, grade_value, status
     FROM grades WHERE class_offering_id = $1`,
    [offeringId]
  );
  return result.rows;
}

// --- Shared -------------------------------------------------------------------

async function listPeriods(schoolYearId) {
  const result = await pool.query(
    `SELECT id, name, sequence_number, start_date, end_date
     FROM grading_periods WHERE school_year_id = $1 ORDER BY sequence_number`,
    [schoolYearId]
  );
  return result.rows;
}

module.exports = {
  getSectionHeader,
  listSectionOfferings,
  listSectionStudents,
  listFinalizedGrades,
  getOfferingHeader,
  listOfferingGrades,
  listPeriods,
};
