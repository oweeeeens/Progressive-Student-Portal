// class_offerings: "this teacher teaches this subject to this section this
// school year." getById/listByTeacher/teacherTeachesSection/
// getActiveStudentsInOffering are the original read-only helpers used by
// attendance and grades — listByTeacher only ever returns active offerings
// in the current school year, so a deactivated offering quietly stops
// appearing for grade/attendance entry. Everything below is the admin CRUD
// surface for the Academic Setup > Class Offerings page.
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
     WHERE co.teacher_id = $1 AND sy.is_current = TRUE AND co.is_active = TRUE
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

async function listClassOfferingsForAdmin({ search, schoolYearId, sectionId, subjectId, includeInactive, page = 1, pageSize = 20 }) {
  const clauses = [];
  const params = [];
  if (!includeInactive) clauses.push('co.is_active = TRUE');
  if (search) {
    params.push(`%${search}%`);
    clauses.push(`(subj.name ILIKE $${params.length} OR sec.name ILIKE $${params.length} OR u.full_name ILIKE $${params.length})`);
  }
  if (schoolYearId) {
    params.push(schoolYearId);
    clauses.push(`co.school_year_id = $${params.length}`);
  }
  if (sectionId) {
    params.push(sectionId);
    clauses.push(`co.section_id = $${params.length}`);
  }
  if (subjectId) {
    params.push(subjectId);
    clauses.push(`co.subject_id = $${params.length}`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const joins = `
     JOIN subjects subj ON subj.id = co.subject_id
     JOIN sections sec ON sec.id = co.section_id
     JOIN users u ON u.id = co.teacher_id
     JOIN school_years sy ON sy.id = co.school_year_id`;

  const countResult = await pool.query(`SELECT COUNT(*) FROM class_offerings co ${joins} ${where}`, params);
  const total = Number(countResult.rows[0].count);

  const limit = Math.max(Number(pageSize) || 20, 1);
  const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;
  const dataParams = [...params, limit, offset];
  const dataResult = await pool.query(
    `SELECT co.id, co.is_active,
            subj.id AS subject_id, subj.name AS subject_name,
            sec.id AS section_id, sec.name AS section_name, sec.grade_level,
            u.id AS teacher_id, u.full_name AS teacher_name,
            sy.id AS school_year_id, sy.label AS school_year_label
     FROM class_offerings co ${joins} ${where}
     ORDER BY sy.is_current DESC, sec.grade_level, sec.name, subj.name
     LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
    dataParams
  );
  return { rows: dataResult.rows, total };
}

async function createClassOffering({ subjectId, sectionId, teacherId, schoolYearId }) {
  const result = await pool.query(
    `INSERT INTO class_offerings (subject_id, section_id, teacher_id, school_year_id)
     VALUES ($1, $2, $3, $4)
     RETURNING id, subject_id, section_id, teacher_id, school_year_id, is_active`,
    [subjectId, sectionId, teacherId, schoolYearId]
  );
  return result.rows[0];
}

async function updateClassOffering(id, { subjectId, sectionId, teacherId, schoolYearId }) {
  const result = await pool.query(
    `UPDATE class_offerings SET subject_id = $2, section_id = $3, teacher_id = $4, school_year_id = $5
     WHERE id = $1
     RETURNING id, subject_id, section_id, teacher_id, school_year_id, is_active`,
    [id, subjectId, sectionId, teacherId, schoolYearId]
  );
  return result.rows[0] || null;
}

async function classOfferingHasHistory(id) {
  const result = await pool.query('SELECT 1 FROM grades WHERE class_offering_id = $1 LIMIT 1', [id]);
  return result.rowCount > 0;
}

async function setClassOfferingActive(id, isActive) {
  const result = await pool.query(
    'UPDATE class_offerings SET is_active = $2 WHERE id = $1 RETURNING id, is_active',
    [id, isActive]
  );
  return result.rows[0] || null;
}

module.exports = {
  getById,
  listByTeacher,
  teacherTeachesSection,
  getActiveStudentsInOffering,
  listClassOfferingsForAdmin,
  createClassOffering,
  updateClassOffering,
  classOfferingHasHistory,
  setClassOfferingActive,
};
