// Subjects (e.g. "General Mathematics"). listActiveSubjects is the
// read-only picker used by the Academic Setup > Class Offerings form; the
// rest is the admin CRUD surface for the Subjects page itself.
const { pool } = require('../config/db');

async function listActiveSubjects() {
  const result = await pool.query(
    'SELECT id, name, code, grade_level FROM subjects WHERE is_active = TRUE ORDER BY name'
  );
  return result.rows;
}

async function listSubjectsForAdmin({ search, gradeLevel, includeInactive, page = 1, pageSize = 20 }) {
  const clauses = [];
  const params = [];
  if (!includeInactive) clauses.push('is_active = TRUE');
  if (search) {
    params.push(`%${search}%`);
    clauses.push(`(name ILIKE $${params.length} OR code ILIKE $${params.length})`);
  }
  if (gradeLevel) {
    params.push(gradeLevel);
    clauses.push(`grade_level = $${params.length}`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const countResult = await pool.query(`SELECT COUNT(*) FROM subjects ${where}`, params);
  const total = Number(countResult.rows[0].count);

  const limit = Math.max(Number(pageSize) || 20, 1);
  const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;
  const dataParams = [...params, limit, offset];
  const dataResult = await pool.query(
    `SELECT id, name, code, grade_level, is_active FROM subjects ${where}
     ORDER BY name LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
    dataParams
  );
  return { rows: dataResult.rows, total };
}

async function createSubject({ name, code, gradeLevel }) {
  const result = await pool.query(
    `INSERT INTO subjects (name, code, grade_level) VALUES ($1, $2, $3)
     RETURNING id, name, code, grade_level, is_active`,
    [name, code || null, gradeLevel || null]
  );
  return result.rows[0];
}

async function updateSubject(id, { name, code, gradeLevel }) {
  const result = await pool.query(
    `UPDATE subjects SET name = $2, code = $3, grade_level = $4 WHERE id = $1
     RETURNING id, name, code, grade_level, is_active`,
    [id, name, code || null, gradeLevel || null]
  );
  return result.rows[0] || null;
}

// A subject can't be deactivated once it has been taught — any class
// offering for it with grades, or any class offering for it at all that's
// still active (deactivate those offerings first).
async function subjectHasHistory(id) {
  const grades = await pool.query(
    `SELECT 1 FROM grades g JOIN class_offerings co ON co.id = g.class_offering_id
     WHERE co.subject_id = $1 LIMIT 1`,
    [id]
  );
  if (grades.rowCount > 0) return true;

  const activeOfferings = await pool.query(
    'SELECT 1 FROM class_offerings WHERE subject_id = $1 AND is_active = TRUE LIMIT 1',
    [id]
  );
  return activeOfferings.rowCount > 0;
}

async function setSubjectActive(id, isActive) {
  const result = await pool.query(
    'UPDATE subjects SET is_active = $2 WHERE id = $1 RETURNING id, is_active',
    [id, isActive]
  );
  return result.rows[0] || null;
}

module.exports = {
  listActiveSubjects,
  listSubjectsForAdmin,
  createSubject,
  updateSubject,
  subjectHasHistory,
  setSubjectActive,
};
