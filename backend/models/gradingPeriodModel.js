// Attendance and grades are tagged with a grading period. findByDate/
// findCurrentWithSchoolYear/getById/listForCurrentSchoolYear are the
// original read-only helpers other modules rely on (callers just pick a
// date or use "the current school year's periods" rather than knowing
// period ids directly). Everything below is the admin CRUD surface for the
// Academic Setup > School Years & Grading Periods page. No deactivate here
// — see the is-active migration's comment for why.
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

// Admin list for a specific school year — the Academic Setup page shows one
// school year's periods at a time.
async function listBySchoolYear(schoolYearId) {
  const result = await pool.query(
    `SELECT id, school_year_id, name, sequence_number, start_date, end_date
     FROM grading_periods WHERE school_year_id = $1 ORDER BY sequence_number`,
    [schoolYearId]
  );
  return result.rows;
}

async function createGradingPeriod({ schoolYearId, name, sequenceNumber, startDate, endDate }) {
  const result = await pool.query(
    `INSERT INTO grading_periods (school_year_id, name, sequence_number, start_date, end_date)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, school_year_id, name, sequence_number, start_date, end_date`,
    [schoolYearId, name, sequenceNumber, startDate, endDate]
  );
  return result.rows[0];
}

async function updateGradingPeriod(id, { name, sequenceNumber, startDate, endDate }) {
  const result = await pool.query(
    `UPDATE grading_periods SET name = $2, sequence_number = $3, start_date = $4, end_date = $5
     WHERE id = $1
     RETURNING id, school_year_id, name, sequence_number, start_date, end_date`,
    [id, name, sequenceNumber, startDate, endDate]
  );
  return result.rows[0] || null;
}

module.exports = {
  findByDate,
  findCurrentWithSchoolYear,
  getById,
  listForCurrentSchoolYear,
  listBySchoolYear,
  createGradingPeriod,
  updateGradingPeriod,
};
