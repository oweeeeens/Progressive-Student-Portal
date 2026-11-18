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

// --- Enrolled student list -----------------------------------------------------

// Active learners placed in a section of the CURRENT school year, with the
// number of classes each is enrolled in (class_enrollments). Filters are
// optional and combine; each is a query parameter, never interpolated.
async function listEnrolledStudents({ gradeLevel, sectionId, strand, status } = {}) {
  const clauses = ['s.is_active = TRUE', 'sy.is_current = TRUE'];
  const params = [];
  // Enrollment status (enrolled / dropped / transferred / ...). The report
  // defaults to 'enrolled' in the controller; null means every status.
  if (status) {
    params.push(status);
    clauses.push(`s.enrollment_status = $${params.length}`);
  }
  if (gradeLevel) {
    params.push(gradeLevel);
    clauses.push(`sec.grade_level = $${params.length}`);
  }
  if (sectionId) {
    params.push(sectionId);
    clauses.push(`sec.id = $${params.length}`);
  }
  if (strand) {
    params.push(strand);
    clauses.push(`sec.strand = $${params.length}`);
  }
  const result = await pool.query(
    `SELECT s.id, s.lrn, s.first_name, s.middle_name, s.last_name, s.sex, s.enrollment_status,
            sec.id AS section_id, sec.name AS section_name, sec.grade_level, sec.strand,
            sy.label AS school_year, u.full_name AS adviser_name,
            (SELECT COUNT(*)::int FROM class_enrollments ce
              WHERE ce.student_id = s.id AND ce.status = 'enrolled') AS subject_count
     FROM students s
     JOIN sections sec ON sec.id = s.current_section_id
     JOIN school_years sy ON sy.id = sec.school_year_id
     LEFT JOIN users u ON u.id = sec.adviser_id
     WHERE ${clauses.join(' AND ')}
     ORDER BY sec.grade_level, sec.name, s.last_name, s.first_name, s.id`,
    params
  );
  return result.rows;
}

// What the filters can offer: the current year's active sections, each with
// its grade level, strand and the year's label.
async function listCurrentSections() {
  const result = await pool.query(
    `SELECT sec.id, sec.name, sec.grade_level, sec.strand, sy.label AS school_year
     FROM sections sec JOIN school_years sy ON sy.id = sec.school_year_id
     WHERE sy.is_current = TRUE AND sec.is_active = TRUE
     ORDER BY sec.grade_level, sec.name`
  );
  return result.rows;
}

// --- Admin monitoring (the Monitoring tab on Analytics) ------------------------

// One grading period with its school year's label.
async function getPeriod(periodId) {
  const result = await pool.query(
    `SELECT gp.id, gp.name, gp.sequence_number, gp.school_year_id, sy.label AS school_year
     FROM grading_periods gp JOIN school_years sy ON sy.id = gp.school_year_id
     WHERE gp.id = $1`,
    [periodId]
  );
  return result.rows[0] || null;
}

// Enrollment per section in a school year: learners in the section, its
// active classes, and the class enrollments those add up to.
async function listSectionEnrollment(schoolYearId) {
  const result = await pool.query(
    `SELECT sec.id, sec.name, sec.grade_level, sec.strand, u.full_name AS adviser_name,
            (SELECT COUNT(*)::int FROM students s
              WHERE s.current_section_id = sec.id AND s.is_active = TRUE) AS learners,
            (SELECT COUNT(*)::int FROM class_offerings co
              WHERE co.section_id = sec.id AND co.is_active = TRUE) AS classes,
            (SELECT COUNT(*)::int FROM class_enrollments ce
               JOIN class_offerings co ON co.id = ce.class_offering_id
               JOIN students s ON s.id = ce.student_id
              WHERE co.section_id = sec.id AND co.is_active = TRUE
                AND ce.status = 'enrolled' AND s.is_active = TRUE) AS enrollments
     FROM sections sec
     LEFT JOIN users u ON u.id = sec.adviser_id
     WHERE sec.school_year_id = $1 AND sec.is_active = TRUE
     ORDER BY sec.grade_level, sec.name`,
    [schoolYearId]
  );
  return result.rows;
}

// Grade status per class for one period, counted over the learners ENROLLED
// in the class now (so "missing" = enrolled − graded is meaningful).
async function listClassGradeStatus(schoolYearId, periodId) {
  const result = await pool.query(
    `SELECT co.id, co.term, subj.name AS subject_name, subj.code AS subject_code, subj.category AS subject_category,
            sec.name AS section_name, sec.grade_level, u.full_name AS teacher_name,
            roster.enrolled, COALESCE(g.submitted, 0) AS submitted, COALESCE(g.principal_verified, 0) AS principal_verified,
            COALESCE(g.finalized, 0) AS finalized, COALESCE(g.rejected, 0) AS rejected
     FROM class_offerings co
     JOIN subjects subj ON subj.id = co.subject_id
     JOIN sections sec ON sec.id = co.section_id
     LEFT JOIN users u ON u.id = co.teacher_id
     CROSS JOIN LATERAL (
       SELECT COUNT(*)::int AS enrolled FROM class_enrollments ce
       JOIN students s ON s.id = ce.student_id
       WHERE ce.class_offering_id = co.id AND ce.status = 'enrolled' AND s.is_active = TRUE
     ) roster
     LEFT JOIN LATERAL (
       SELECT COUNT(*) FILTER (WHERE gr.status = 'submitted')::int AS submitted,
              COUNT(*) FILTER (WHERE gr.status = 'principal_verified')::int AS principal_verified,
              COUNT(*) FILTER (WHERE gr.status = 'finalized')::int AS finalized,
              COUNT(*) FILTER (WHERE gr.status = 'rejected')::int AS rejected
       FROM grades gr
       JOIN class_enrollments ce ON ce.student_id = gr.student_id AND ce.class_offering_id = gr.class_offering_id AND ce.status = 'enrolled'
       JOIN students s ON s.id = gr.student_id AND s.is_active = TRUE
       WHERE gr.class_offering_id = co.id AND gr.grading_period_id = $2
     ) g ON TRUE
     WHERE co.school_year_id = $1 AND co.is_active = TRUE
     ORDER BY sec.grade_level, sec.name, subj.name`,
    [schoolYearId, periodId]
  );
  return result.rows;
}

// At-risk learners per section for one period, by Analytics' definition: a
// risk score above 0 (any factor triggered), split by risk level.
async function listAtRiskBySection(periodId) {
  const result = await pool.query(
    `SELECT s.current_section_id AS section_id,
            COUNT(*)::int AS assessed,
            COUNT(*) FILTER (WHERE ra.risk_score > 0 AND ra.risk_level = 'high')::int AS high,
            COUNT(*) FILTER (WHERE ra.risk_score > 0 AND ra.risk_level = 'medium')::int AS medium,
            COUNT(*) FILTER (WHERE ra.risk_score > 0 AND ra.risk_level = 'low')::int AS low
     FROM risk_assessments ra
     JOIN students s ON s.id = ra.student_id AND s.is_active = TRUE
     WHERE ra.grading_period_id = $1 AND s.current_section_id IS NOT NULL
     GROUP BY s.current_section_id`,
    [periodId]
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
  listEnrolledStudents,
  listCurrentSections,
  getPeriod,
  listSectionEnrollment,
  listClassGradeStatus,
  listAtRiskBySection,
};
