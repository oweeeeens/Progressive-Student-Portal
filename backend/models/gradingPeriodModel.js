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

// findByDate, but confined to one school year's periods.
//
// findByDate above searches every period in the table and breaks ties with
// ORDER BY id, so when two school years have overlapping date ranges the
// older one silently wins. Nothing in the schema prevents that overlap:
// grading_periods only constrains UNIQUE (school_year_id, sequence_number),
// never the dates. That is harmless for the "what period is today" readers,
// but a write filed under the wrong year is permanent — so every caller
// that STORES a row and already knows its school year (from the section or
// the class offering) resolves the date through here instead.
//
// Periods with no dates configured yet are excluded rather than matched:
// BETWEEN with a NULL bound is never true anyway, and saying so makes the
// intent readable.
async function findByDateInSchoolYear(date, schoolYearId) {
  const result = await pool.query(
    `SELECT id, school_year_id, name, sequence_number
     FROM grading_periods
     WHERE school_year_id = $2
       AND start_date IS NOT NULL AND end_date IS NOT NULL
       AND $1::date BETWEEN start_date AND end_date
     ORDER BY sequence_number
     LIMIT 1`,
    [date, schoolYearId]
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
    // start_date/end_date travel with the period so a caller can say which
    // dates fall inside it — the student attendance page lists the actual
    // days behind "3 days absent" rather than just the number. They come
    // back as plain YYYY-MM-DD strings (see the DATE parser in config/db.js),
    // so a date range is a string comparison with no timezone in play.
    `SELECT gp.id, gp.name, gp.sequence_number, gp.start_date, gp.end_date
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
  findByDateInSchoolYear,
  findCurrentWithSchoolYear,
  getById,
  listForCurrentSchoolYear,
  listBySchoolYear,
  createGradingPeriod,
  updateGradingPeriod,
};
