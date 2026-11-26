// Reads for the panel's reports (panel revision, 2026-11-18): the adviser
// gradesheet, the subject teacher's class grade report and the enrolled
// student list. Read-only, and every figure comes from the same tables the
// rest of the system uses — no report keeps a copy of anything.
const { pool } = require('../config/db');
// The one definition of who is on a class roster (models/enrollmentModel.js),
// so every count here matches the rosters the rest of the system shows.
const { ON_ROSTER_SQL } = require('./enrollmentModel');

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

// Every learner who belongs on the section's gradesheet, in roll order:
//   - the active learners in the section now, whatever their enrollment
//     status (a dropped learner's finalized grades are still official);
//   - AND active learners who were enrolled in one of the section's classes
//     and have since moved to another section ('moved' rows). Their
//     finalized grades from this section live on this section's classes, so
//     without them those grades appeared on no gradesheet at all (found
//     2026-11-24).
// Each row carries where the learner is now, their status, and the other
// sections of this school year they moved here FROM — so the report can say
// why a row has blank terms instead of letting a blank read as "not
// finalized yet".
async function listGradesheetStudents(sectionId, schoolYearId) {
  const result = await pool.query(
    `SELECT s.id, s.lrn, s.first_name, s.middle_name, s.last_name, s.sex,
            s.enrollment_status, s.current_section_id, cur.name AS current_section_name,
            (SELECT string_agg(DISTINCT osec.name, ', ')
               FROM class_enrollments oce
               JOIN class_offerings oco ON oco.id = oce.class_offering_id
               JOIN sections osec ON osec.id = oco.section_id
              WHERE oce.student_id = s.id AND oce.status = 'moved'
                AND oco.section_id <> $1 AND oco.school_year_id = $2) AS moved_from
     FROM students s
     LEFT JOIN sections cur ON cur.id = s.current_section_id
     WHERE s.is_active = TRUE AND (
       s.current_section_id = $1
       OR EXISTS (
         SELECT 1 FROM class_enrollments ce
         JOIN class_offerings co ON co.id = ce.class_offering_id
         WHERE ce.student_id = s.id AND co.section_id = $1 AND co.is_active = TRUE
       )
     )
     ORDER BY s.last_name, s.first_name, s.id`,
    [sectionId, schoolYearId]
  );
  return result.rows;
}

// Which of these classes each learner was ever enrolled in (current or
// moved). A class a learner was never in is "not enrolled" on the
// gradesheet, not "not finalized yet", and is left out of their count.
async function listEnrollmentPairs(offeringIds, studentIds) {
  if (offeringIds.length === 0 || studentIds.length === 0) return [];
  const result = await pool.query(
    `SELECT student_id, class_offering_id FROM class_enrollments
     WHERE class_offering_id = ANY($1::int[]) AND student_id = ANY($2::int[])`,
    [offeringIds, studentIds]
  );
  return result.rows;
}

// The sections whose gradesheet a user who is NOT a school-wide reader may
// open: the ones they advise, and the ones they teach an active class in —
// current school year, active sections only, no duplicates. The gradesheet
// page's picker and the server's own check both use this, so they cannot
// disagree (reportController.gradesheet, gradesheetSections).
async function listGradesheetSectionsForUser(userId) {
  const result = await pool.query(
    `SELECT DISTINCT sec.id, sec.name, sec.grade_level, sec.strand, sy.label AS school_year,
            (sec.adviser_id = $1) AS advises
     FROM sections sec
     JOIN school_years sy ON sy.id = sec.school_year_id
     WHERE sy.is_current = TRUE AND sec.is_active = TRUE
       AND (sec.adviser_id = $1 OR EXISTS (
         SELECT 1 FROM class_offerings co
         WHERE co.section_id = sec.id AND co.teacher_id = $1 AND co.is_active = TRUE
       ))
     ORDER BY sec.grade_level, sec.name`,
    [userId]
  );
  return result.rows;
}

// Whether a user teaches an ACTIVE class in a section (any school year) —
// the subject teacher's way into that section's gradesheet.
async function teachesActiveClassInSection(userId, sectionId) {
  const result = await pool.query(
    'SELECT 1 FROM class_offerings WHERE teacher_id = $1 AND section_id = $2 AND is_active = TRUE LIMIT 1',
    [userId, sectionId]
  );
  return result.rowCount > 0;
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
  // Active sections only, matching listCurrentSections below — otherwise a
  // learner in a deactivated section counts in the total but in no
  // per-section row, and the rows stop adding up to the total.
  const clauses = ['s.is_active = TRUE', 'sy.is_current = TRUE', 'sec.is_active = TRUE'];
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
            -- The same classes the registration form lists: current
            -- enrollments in ACTIVE classes of the section's school year.
            (SELECT COUNT(*)::int FROM class_enrollments ce
               JOIN class_offerings co ON co.id = ce.class_offering_id
              WHERE ce.student_id = s.id AND ce.status = 'enrolled'
                AND co.is_active = TRUE AND co.school_year_id = sec.school_year_id) AS subject_count
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
              WHERE s.current_section_id = sec.id AND s.is_active = TRUE
                AND s.enrollment_status = 'enrolled') AS learners,
            (SELECT COUNT(*)::int FROM class_offerings co
              WHERE co.section_id = sec.id AND co.is_active = TRUE) AS classes,
            (SELECT COUNT(*)::int FROM class_enrollments ce
               JOIN class_offerings co ON co.id = ce.class_offering_id
               JOIN students s ON s.id = ce.student_id
              WHERE co.section_id = sec.id AND co.is_active = TRUE
                AND ${ON_ROSTER_SQL}) AS enrollments
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
       WHERE ce.class_offering_id = co.id AND ${ON_ROSTER_SQL}
     ) roster
     LEFT JOIN LATERAL (
       SELECT COUNT(*) FILTER (WHERE gr.status = 'submitted')::int AS submitted,
              COUNT(*) FILTER (WHERE gr.status = 'principal_verified')::int AS principal_verified,
              COUNT(*) FILTER (WHERE gr.status = 'finalized')::int AS finalized,
              COUNT(*) FILTER (WHERE gr.status = 'rejected')::int AS rejected
       FROM grades gr
       JOIN class_enrollments ce ON ce.student_id = gr.student_id AND ce.class_offering_id = gr.class_offering_id
       JOIN students s ON s.id = gr.student_id
       WHERE gr.class_offering_id = co.id AND gr.grading_period_id = $2 AND ${ON_ROSTER_SQL}
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

// A school year's grading periods, in term order — the tables a report draws.
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
  listGradesheetStudents,
  listGradesheetSectionsForUser,
  teachesActiveClassInSection,
  listEnrollmentPairs,
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
