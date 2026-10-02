// Read-only for now — just enough to populate a section picker in the
// Student Records form. Full section management (creating/editing sections,
// assigning advisers) isn't part of this module's scope yet.
const { pool } = require('../config/db');

async function listSections() {
  const result = await pool.query(
    `SELECT sec.id, sec.name, sec.grade_level, sec.strand, sy.label AS school_year
     FROM sections sec
     JOIN school_years sy ON sy.id = sec.school_year_id
     ORDER BY sy.is_current DESC, sec.grade_level, sec.name`
  );
  return result.rows;
}

// Used by the attendance module to check "does this adviser actually own
// this section" before letting them submit daily attendance for it.
async function getSectionById(id) {
  const result = await pool.query('SELECT id, adviser_id, name, grade_level FROM sections WHERE id = $1', [id]);
  return result.rows[0] || null;
}

// Every section a given adviser advises — used to list "my sections" when
// they're marking daily attendance.
async function listSectionsByAdviser(adviserId) {
  const result = await pool.query(
    `SELECT sec.id, sec.name, sec.grade_level, sec.strand
     FROM sections sec
     JOIN school_years sy ON sy.id = sec.school_year_id
     WHERE sec.adviser_id = $1 AND sy.is_current = TRUE
     ORDER BY sec.grade_level, sec.name`,
    [adviserId]
  );
  return result.rows;
}

module.exports = { listSections, getSectionById, listSectionsByAdviser };
