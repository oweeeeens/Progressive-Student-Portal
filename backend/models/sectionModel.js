// Sections (advisory classes). listSections/getSectionById/listSectionsByAdviser
// are the original read-only helpers used throughout the app (daily
// attendance, student records, grade entry) to populate pickers and check
// adviser ownership — they only ever return active sections, so a
// deactivated section quietly stops being offered anywhere new. Everything
// below listSectionsByAdviser is the admin CRUD surface for the Academic
// Setup > Sections page.
const { pool } = require('../config/db');

async function listSections() {
  const result = await pool.query(
    `SELECT sec.id, sec.name, sec.grade_level, sec.strand, sy.label AS school_year
     FROM sections sec
     JOIN school_years sy ON sy.id = sec.school_year_id
     WHERE sec.is_active = TRUE
     ORDER BY sy.is_current DESC, sec.grade_level, sec.name`
  );
  return result.rows;
}

// Used by the attendance module to check "does this adviser actually own
// this section" before letting them submit daily attendance for it, and by
// the report card feature for the same ownership check (who may generate
// one for a student in this section).
async function getSectionById(id) {
  const result = await pool.query('SELECT id, adviser_id, name, grade_level FROM sections WHERE id = $1', [id]);
  return result.rows[0] || null;
}

// For the report card's "Prepared by" line — the student's current
// section's own adviser, by name rather than id. Nothing else in this
// model needs the adviser's name (getSectionById only needs their id, for
// the ownership checks above), so this is its own small query rather than
// widening getSectionById's columns for one caller.
async function getAdviserName(sectionId) {
  if (!sectionId) return null;
  const result = await pool.query(
    `SELECT u.full_name FROM sections sec JOIN users u ON u.id = sec.adviser_id WHERE sec.id = $1`,
    [sectionId]
  );
  return result.rows[0]?.full_name || null;
}

// Every section a given adviser advises — used to list "my sections" when
// they're marking daily attendance.
async function listSectionsByAdviser(adviserId) {
  const result = await pool.query(
    `SELECT sec.id, sec.name, sec.grade_level, sec.strand
     FROM sections sec
     JOIN school_years sy ON sy.id = sec.school_year_id
     WHERE sec.adviser_id = $1 AND sy.is_current = TRUE AND sec.is_active = TRUE
     ORDER BY sec.grade_level, sec.name`,
    [adviserId]
  );
  return result.rows;
}

// Admin list for the Academic Setup > Sections page — unlike listSections()
// above, this includes inactive rows (so an admin can find and reactivate
// one) and supports the search/pagination the UI standard requires.
async function listSectionsForAdmin({ search, gradeLevel, schoolYearId, includeInactive, page = 1, pageSize = 20 }) {
  const clauses = [];
  const params = [];
  if (!includeInactive) clauses.push('sec.is_active = TRUE');
  if (search) {
    params.push(`%${search}%`);
    clauses.push(`(sec.name ILIKE $${params.length} OR sec.strand ILIKE $${params.length})`);
  }
  if (gradeLevel) {
    params.push(gradeLevel);
    clauses.push(`sec.grade_level = $${params.length}`);
  }
  if (schoolYearId) {
    params.push(schoolYearId);
    clauses.push(`sec.school_year_id = $${params.length}`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const countResult = await pool.query(`SELECT COUNT(*) FROM sections sec ${where}`, params);
  const total = Number(countResult.rows[0].count);

  const limit = Math.max(Number(pageSize) || 20, 1);
  const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;
  const dataParams = [...params, limit, offset];
  const dataResult = await pool.query(
    `SELECT sec.id, sec.name, sec.grade_level, sec.strand, sec.is_active,
            sy.id AS school_year_id, sy.label AS school_year_label,
            u.id AS adviser_id, u.full_name AS adviser_name
     FROM sections sec
     JOIN school_years sy ON sy.id = sec.school_year_id
     JOIN users u ON u.id = sec.adviser_id
     ${where}
     ORDER BY sy.is_current DESC, sec.grade_level, sec.name
     LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
    dataParams
  );
  return { rows: dataResult.rows, total };
}

async function createSection({ schoolYearId, gradeLevel, strand, name, adviserId }) {
  const result = await pool.query(
    `INSERT INTO sections (school_year_id, grade_level, strand, name, adviser_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, grade_level, strand, is_active, school_year_id, adviser_id`,
    [schoolYearId, gradeLevel, strand || null, name, adviserId]
  );
  return result.rows[0];
}

async function updateSection(id, { schoolYearId, gradeLevel, strand, name, adviserId }) {
  const result = await pool.query(
    `UPDATE sections
     SET school_year_id = $2, grade_level = $3, strand = $4, name = $5, adviser_id = $6
     WHERE id = $1
     RETURNING id, name, grade_level, strand, is_active, school_year_id, adviser_id`,
    [id, schoolYearId, gradeLevel, strand || null, name, adviserId]
  );
  return result.rows[0] || null;
}

// A section can't be deactivated once real academic history exists against
// it — grades (via any class offering in the section) or daily attendance
// (via any student currently assigned to it). Checked before deactivating,
// never before reactivating (reactivating is always safe).
async function sectionHasHistory(id) {
  const grades = await pool.query(
    `SELECT 1 FROM grades g JOIN class_offerings co ON co.id = g.class_offering_id
     WHERE co.section_id = $1 LIMIT 1`,
    [id]
  );
  if (grades.rowCount > 0) return true;

  const attendance = await pool.query(
    `SELECT 1 FROM daily_attendance_records dar
     JOIN students s ON s.id = dar.student_id
     WHERE s.current_section_id = $1 LIMIT 1`,
    [id]
  );
  return attendance.rowCount > 0;
}

async function setSectionActive(id, isActive) {
  const result = await pool.query(
    'UPDATE sections SET is_active = $2 WHERE id = $1 RETURNING id, is_active',
    [id, isActive]
  );
  return result.rows[0] || null;
}

module.exports = {
  listSections,
  getSectionById,
  getAdviserName,
  listSectionsByAdviser,
  listSectionsForAdmin,
  createSection,
  updateSection,
  sectionHasHistory,
  setSectionActive,
};
