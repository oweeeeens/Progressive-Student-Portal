const { pool } = require('../config/db');

async function getCurrentSchoolYear() {
  const result = await pool.query('SELECT id, label FROM school_years WHERE is_current = TRUE LIMIT 1');
  return result.rows[0] || null;
}

module.exports = { getCurrentSchoolYear };
