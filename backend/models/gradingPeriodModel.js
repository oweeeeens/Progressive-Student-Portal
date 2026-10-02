// Attendance (and later grades) are tagged with a grading period, but
// callers shouldn't have to know period IDs — they just pick a date, and we
// resolve which quarter it falls into.
const { pool } = require('../config/db');

async function findByDate(date) {
  const result = await pool.query(
    `SELECT id, school_year_id, name, sequence_number
     FROM grading_periods
     WHERE $1::date BETWEEN start_date AND end_date
     ORDER BY id
     LIMIT 1`,
    [date]
  );
  return result.rows[0] || null;
}

// Same lookup as findByDate, but also carries the school year's label
// (e.g. "2026-2027") for the dashboard's "current period" indicator — no
// existing caller needed both together, so neither function did this join.
async function findCurrentWithSchoolYear(date) {
  const result = await pool.query(
    `SELECT gp.id, gp.name, gp.sequence_number, sy.label AS school_year_label
     FROM grading_periods gp
     JOIN school_years sy ON sy.id = gp.school_year_id
     WHERE $1::date BETWEEN gp.start_date AND gp.end_date
     ORDER BY gp.id
     LIMIT 1`,
    [date]
  );
  return result.rows[0] || null;
}

async function getById(id) {
  const result = await pool.query(
    'SELECT id, school_year_id, name, sequence_number FROM grading_periods WHERE id = $1',
    [id]
  );
  return result.rows[0] || null;
}

// For grade-entry pickers — grades are tagged by period directly, not a
// date, so the frontend needs the list of periods to choose from.
async function listForCurrentSchoolYear() {
  const result = await pool.query(
    `SELECT gp.id, gp.name, gp.sequence_number
     FROM grading_periods gp
     JOIN school_years sy ON sy.id = gp.school_year_id
     WHERE sy.is_current = TRUE
     ORDER BY gp.sequence_number`
  );
  return result.rows;
}

module.exports = { findByDate, findCurrentWithSchoolYear, getById, listForCurrentSchoolYear };
