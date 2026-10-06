// School years are the root of the academic hierarchy (sections, grading
// periods, and class offerings all hang off one). getCurrentSchoolYear is
// the original read-only helper other modules rely on; the rest is the
// admin CRUD surface for the Academic Setup > School Years page. No
// deactivate here — see the is-active migration's comment for why.
const { pool } = require('../config/db');

async function getCurrentSchoolYear() {
  const result = await pool.query('SELECT id, label FROM school_years WHERE is_current = TRUE LIMIT 1');
  return result.rows[0] || null;
}

async function listSchoolYears() {
  const result = await pool.query(
    'SELECT id, label, start_date, end_date, is_current FROM school_years ORDER BY start_date DESC'
  );
  return result.rows;
}

async function createSchoolYear({ label, startDate, endDate }) {
  const result = await pool.query(
    `INSERT INTO school_years (label, start_date, end_date, is_current)
     VALUES ($1, $2, $3, FALSE)
     RETURNING id, label, start_date, end_date, is_current`,
    [label, startDate, endDate]
  );
  return result.rows[0];
}

async function updateSchoolYear(id, { label, startDate, endDate }) {
  const result = await pool.query(
    `UPDATE school_years SET label = $2, start_date = $3, end_date = $4 WHERE id = $1
     RETURNING id, label, start_date, end_date, is_current`,
    [id, label, startDate, endDate]
  );
  return result.rows[0] || null;
}

// Exactly one school year is ever "current" — flipping it is a two-step
// update done as one transaction so there's never a moment with zero or two
// current years.
async function setCurrentSchoolYear(id) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE school_years SET is_current = FALSE WHERE is_current = TRUE');
    const result = await client.query(
      'UPDATE school_years SET is_current = TRUE WHERE id = $1 RETURNING id, label, start_date, end_date, is_current',
      [id]
    );
    await client.query('COMMIT');
    return result.rows[0] || null;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { getCurrentSchoolYear, listSchoolYears, createSchoolYear, updateSchoolYear, setCurrentSchoolYear };
