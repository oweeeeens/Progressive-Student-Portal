// Read-only helpers for class_offerings — used by the attendance module to
// check "does this subject teacher actually teach this class" and to list
// "my classes" for the subject-attendance input UI.
const { pool } = require('../config/db');

async function getById(id) {
  const result = await pool.query(
    'SELECT id, subject_id, section_id, teacher_id, school_year_id FROM class_offerings WHERE id = $1',
    [id]
  );
  return result.rows[0] || null;
}

async function listByTeacher(teacherId) {
  const result = await pool.query(
    `SELECT co.id, subj.name AS subject_name, sec.name AS section_name, sec.grade_level
     FROM class_offerings co
     JOIN subjects subj ON subj.id = co.subject_id
     JOIN sections sec ON sec.id = co.section_id
     JOIN school_years sy ON sy.id = co.school_year_id
     WHERE co.teacher_id = $1 AND sy.is_current = TRUE
     ORDER BY sec.grade_level, sec.name, subj.name`,
    [teacherId]
  );
  return result.rows;
}

async function teacherTeachesSection(teacherId, sectionId) {
  const result = await pool.query(
    'SELECT 1 FROM class_offerings WHERE teacher_id = $1 AND section_id = $2 LIMIT 1',
    [teacherId, sectionId]
  );
  return result.rowCount > 0;
}

// Active students currently in the section a class_offering teaches — used
// by the grade-entry UI to build its input sheet (grades aren't date-bound
// the way attendance is, so there's no "roster for a date" to piggyback on).
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

module.exports = { getById, listByTeacher, teacherTeachesSection, getActiveStudentsInOffering };
