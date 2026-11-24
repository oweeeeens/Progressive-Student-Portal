// Subject enrollment: which learners are enrolled in which class offering
// (table class_enrollments, migration 20261118100000000).
//
// THE single definition of a class roster. Before this a roster was worked
// out on the fly as "students whose current section is the class's section"
// in about fifteen places; each of those now asks this model instead, so
// the rule lives in one file.
//
// Rows are created and moved by database triggers (see the migration) —
// whenever a learner gets or changes a section, or a class is added to a
// section — so nothing here writes enrollments. This file only reads them.
//   status 'enrolled'  on the class roster now
//   status 'moved'     was in the class, left it; kept as history, because
//                      the learner's grades and scores stay on that class
const { pool } = require('../config/db');

// Who is ON a class roster, as SQL (aliases: ce = class_enrollments,
// s = students). Three conditions, all needed:
//   - the enrollment row is current ('enrolled', not 'moved');
//   - the learner's record is active;
//   - the learner's enrollment status is 'enrolled'. A learner the registrar
//     marks dropped, transferred or graduated keeps their section and their
//     enrollment rows (their grades stay on the class), but is no longer
//     enrolled — found 2026-11-24: until then they stayed on every roster,
//     could still be graded, and counted as "missing" grades on Monitoring
//     while the Enrolled Student List (rightly) left them out.
// Exported so the reports count exactly the learners the rosters list.
const ON_ROSTER_SQL = "ce.status = 'enrolled' AND s.is_active = TRUE AND s.enrollment_status = 'enrolled'"

// The roster of one class: the learners on it now (ON_ROSTER_SQL).
async function getEnrolledStudents(classOfferingId) {
  const result = await pool.query(
    `SELECT s.id, s.lrn, s.first_name, s.middle_name, s.last_name, s.sex
     FROM class_enrollments ce
     JOIN students s ON s.id = ce.student_id
     WHERE ce.class_offering_id = $1 AND ${ON_ROSTER_SQL}
     ORDER BY s.last_name, s.first_name, s.id`,
    [classOfferingId]
  );
  return result.rows;
}

// Of the given learners, the ones NOT enrolled in the class now. Used to
// refuse grade writes for anyone outside the roster.
async function findNotEnrolled(classOfferingId, studentIds) {
  const ids = [...new Set(studentIds.map(Number))];
  if (ids.length === 0) return [];
  const result = await pool.query(
    `SELECT wanted.id
     FROM unnest($2::int[]) AS wanted(id)
     WHERE NOT EXISTS (
       SELECT 1 FROM class_enrollments ce
       JOIN students s ON s.id = ce.student_id
       WHERE ce.class_offering_id = $1 AND ce.student_id = wanted.id
         AND ${ON_ROSTER_SQL}
     )`,
    [classOfferingId, ids]
  );
  return result.rows.map((r) => r.id);
}

// The classes a learner is enrolled in, with subject, teacher and term.
//   schoolYearId   limit to one school year (null = the current one)
//   includeMoved   also return classes the learner has LEFT ('moved') —
//                  their grades and scores are still there, so the
//                  learner's own record must keep showing them. A
//                  deactivated class is never returned as current: the app
//                  refuses to deactivate a class with grades, so it has
//                  nothing to show.
async function listOfferingsForStudent(studentId, { schoolYearId = null, includeMoved = false } = {}) {
  const result = await pool.query(
    `SELECT co.id, co.term, co.section_id, ce.status AS enrollment_status,
            subj.id AS subject_id, subj.name AS subject_name, subj.code AS subject_code,
            subj.weight_group, subj.category AS subject_category,
            u.full_name AS teacher_name, sec.name AS section_name
     FROM class_enrollments ce
     JOIN class_offerings co ON co.id = ce.class_offering_id
     JOIN subjects subj ON subj.id = co.subject_id
     JOIN sections sec ON sec.id = co.section_id
     JOIN school_years sy ON sy.id = co.school_year_id
     LEFT JOIN users u ON u.id = co.teacher_id
     WHERE ce.student_id = $1
       AND (($2::int IS NULL AND sy.is_current = TRUE) OR co.school_year_id = $2::int)
       AND ((ce.status = 'enrolled' AND co.is_active = TRUE) OR ($3::boolean AND ce.status = 'moved'))
     ORDER BY subj.name, co.term`,
    [studentId, schoolYearId, includeMoved]
  );
  return result.rows;
}

module.exports = { ON_ROSTER_SQL, getEnrolledStudents, findNotEnrolled, listOfferingsForStudent };
