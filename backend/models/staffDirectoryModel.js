// The Staff Directory (2026-11-26): the school's people — principal,
// registrar, guidance counselor, advisers and subject teachers — with what
// each of them advises and teaches this school year. Read-only.
//
// Who is listed: ACTIVE accounts whose role is a school position. The admin
// is a system account, not a position, and is left out (the group's choice);
// students are not staff; the removed ICT faculty role never appears.
const { pool } = require('../config/db');
const { ON_ROSTER_SQL } = require('./enrollmentModel');

// The roles listed, in the order the directory shows them.
const DIRECTORY_ROLES = ['principal', 'registrar', 'guidance_counselor', 'adviser', 'subject_teacher'];

// Every listed staff member with their current-year assignments.
//   advises  the active sections of the current school year they advise
//   teaches  the active classes of the current school year they teach
async function listStaff() {
  const result = await pool.query(
    `SELECT u.id, u.full_name, u.role, u.email,
            COALESCE((
              SELECT json_agg(json_build_object('sectionId', sec.id, 'name', sec.name, 'gradeLevel', sec.grade_level)
                              ORDER BY sec.grade_level, sec.name)
              FROM sections sec JOIN school_years sy ON sy.id = sec.school_year_id
              WHERE sec.adviser_id = u.id AND sec.is_active = TRUE AND sy.is_current = TRUE
            ), '[]'::json) AS advises,
            COALESCE((
              SELECT json_agg(json_build_object('classOfferingId', co.id, 'subject', subj.name,
                                                'section', sec.name, 'gradeLevel', sec.grade_level)
                              ORDER BY subj.name, sec.grade_level, sec.name)
              FROM class_offerings co
              JOIN subjects subj ON subj.id = co.subject_id
              JOIN sections sec ON sec.id = co.section_id
              JOIN school_years sy ON sy.id = co.school_year_id
              WHERE co.teacher_id = u.id AND co.is_active = TRUE AND sy.is_current = TRUE
            ), '[]'::json) AS teaches
     FROM users u
     WHERE u.is_active = TRUE AND u.role::text = ANY($1::text[])
     ORDER BY array_position($1::text[], u.role::text), u.full_name`,
    [DIRECTORY_ROLES]
  );
  return result.rows;
}

// For a learner's own account: who their adviser is, and who teaches the
// classes they are on the roster of — so the directory can say "Your
// adviser" / "Your teacher". Empty if the account has no student record.
async function getLearnerContacts(userId) {
  const student = (await pool.query('SELECT id, current_section_id FROM students WHERE user_id = $1 AND is_active = TRUE', [userId])).rows[0];
  if (!student) return { adviserIds: [], teacherIds: [] };
  const adviser = await pool.query('SELECT adviser_id FROM sections WHERE id = $1', [student.current_section_id]);
  const teachers = await pool.query(
    `SELECT DISTINCT co.teacher_id
     FROM class_enrollments ce
     JOIN students s ON s.id = ce.student_id
     JOIN class_offerings co ON co.id = ce.class_offering_id
     WHERE ce.student_id = $1 AND co.is_active = TRUE AND co.teacher_id IS NOT NULL AND ${ON_ROSTER_SQL}`,
    [student.id]
  );
  return {
    adviserIds: adviser.rows.map((r) => r.adviser_id).filter(Boolean),
    teacherIds: teachers.rows.map((r) => r.teacher_id),
  };
}

module.exports = { DIRECTORY_ROLES, listStaff, getLearnerContacts };
