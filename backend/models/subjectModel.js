// Subjects (e.g. "General Mathematics"). listActiveSubjects is the
// read-only picker used by the Academic Setup > Class Offerings form; the
// rest is the admin CRUD surface for the Subjects page itself.
const { pool } = require('../config/db');
const { DEFAULT_SUBJECT_CATEGORY } = require('../config/academicTerms');

async function listActiveSubjects() {
  const result = await pool.query(
    'SELECT id, name, code, grade_level, category FROM subjects WHERE is_active = TRUE ORDER BY name'
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
    `SELECT id, name, code, grade_level, category, is_active FROM subjects ${where}
     ORDER BY name LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
    dataParams
  );
  return { rows: dataResult.rows, total };
}

// `category` decides whether this subject runs the whole year regardless of
// how its class offerings are termed — see config/academicTerms.js. It
// falls back to the default rather than NULL so the column can stay NOT NULL
// and every read can rely on a value being there.
async function createSubject({ name, code, gradeLevel, category }) {
  const result = await pool.query(
    `INSERT INTO subjects (name, code, grade_level, category) VALUES ($1, $2, $3, $4)
     RETURNING id, name, code, grade_level, category, is_active`,
    [name, code || null, gradeLevel || null, category || DEFAULT_SUBJECT_CATEGORY]
  );
  return result.rows[0];
}

async function updateSubject(id, { name, code, gradeLevel, category }) {
  const result = await pool.query(
    `UPDATE subjects SET name = $2, code = $3, grade_level = $4, category = $5 WHERE id = $1
     RETURNING id, name, code, grade_level, category, is_active`,
    [id, name, code || null, gradeLevel || null, category || DEFAULT_SUBJECT_CATEGORY]
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
