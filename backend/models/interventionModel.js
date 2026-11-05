// Owns reads/writes against interventions. Implements CLAUDE.md Part B (the
// closed loop): an intervention is logged against a specific risk_assessment
// so "the risk level at the time it was logged" is captured permanently —
// see findOpenOrMonitoringBeforePeriod, which the risk engine uses to decide
// whether to auto-resolve/escalate on a later recalculation.
const { pool } = require('../config/db');
// Reused so "which interventions can this user see" follows the exact same
// rule as "which students can this user see" — an adviser's list is
// narrowed to their own section the same way the roster and dashboard are.
const { appendScopeClause, BASE_FROM } = require('./studentModel');

// The vocabulary itself lives in config/interventions.js, alongside the
// display labels the Analytics export renders — re-exported here unchanged
// so interventionController's existing interventionModel.VALID_TYPES /
// .VALID_STATUSES checks keep working against a single source of truth.
const { INTERVENTION_TYPES, INTERVENTION_STATUSES } = require('../config/interventions');

const VALID_TYPES = INTERVENTION_TYPES;
const VALID_STATUSES = INTERVENTION_STATUSES;
// Both outcomes are "closed" states — resolved_at marks when either was reached.
const CLOSED_STATUSES = ['resolved', 'escalated'];

async function create({ studentId, riskAssessmentId, loggedBy, interventionType, notes, dateLogged }) {
  const result = await pool.query(
    `INSERT INTO interventions (student_id, risk_assessment_id, logged_by, intervention_type, notes, date_logged)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6, CURRENT_DATE))
     RETURNING *`,
    [studentId, riskAssessmentId, loggedBy, interventionType, notes || null, dateLogged || null]
  );
  return result.rows[0];
}

async function getById(id) {
  const result = await pool.query('SELECT * FROM interventions WHERE id = $1', [id]);
  return result.rows[0] || null;
}

async function listForStudent(studentId) {
  const result = await pool.query(
    `SELECT i.id, i.intervention_type, i.notes, i.status, i.date_logged, i.resolved_at, i.created_at,
            u.full_name AS logged_by_name, ra.risk_level AS risk_level_at_intervention, gp.name AS grading_period_name
     FROM interventions i
     JOIN users u ON u.id = i.logged_by
     JOIN risk_assessments ra ON ra.id = i.risk_assessment_id
     JOIN grading_periods gp ON gp.id = ra.grading_period_id
     WHERE i.student_id = $1
     ORDER BY i.created_at DESC`,
    [studentId]
  );
  return result.rows;
}

async function updateStatus(id, status) {
  const isClosing = CLOSED_STATUSES.includes(status);
  const result = await pool.query(
    `UPDATE interventions
     SET status = $1, updated_at = now(), resolved_at = CASE WHEN $2 THEN now() ELSE resolved_at END
     WHERE id = $3
     RETURNING *`,
    [status, isClosing, id]
  );
  return result.rows[0] || null;
}

// The auto-transition's query: every still-open-or-monitoring intervention
// for this student whose logged-against grading period is strictly earlier
// than the one that was just recalculated. "Strictly earlier" (not
// "immediately previous") so an intervention isn't left stuck open forever
// if a period in between happens to get no new data.
async function findOpenOrMonitoringBeforePeriod(studentId, gradingPeriodSequenceNumber) {
  const result = await pool.query(
    `SELECT i.id, ra.risk_level AS risk_level_at_intervention
     FROM interventions i
     JOIN risk_assessments ra ON ra.id = i.risk_assessment_id
     JOIN grading_periods gp ON gp.id = ra.grading_period_id
     WHERE i.student_id = $1 AND i.status IN ('open', 'monitoring') AND gp.sequence_number < $2`,
    [studentId, gradingPeriodSequenceNumber]
  );
  return result.rows;
}

// Cross-student list for the standalone Interventions page — same scoping,
// search, and pagination shape as studentModel.listStudents, so the two
// list pages behave identically from a user's point of view.
async function listAll(user, { search, status, interventionType, page = 1, pageSize = 20 } = {}) {
  const clauses = ['s.is_active = TRUE'];
  const params = [];
  appendScopeClause(user, clauses, params);

  if (search) {
    params.push(`%${search}%`);
    clauses.push(`(s.first_name ILIKE $${params.length} OR s.last_name ILIKE $${params.length})`);
  }
  if (status) {
    params.push(status);
    clauses.push(`i.status = $${params.length}`);
  }
  if (interventionType) {
    params.push(interventionType);
    clauses.push(`i.intervention_type = $${params.length}`);
  }

  const whereSql = `WHERE ${clauses.join(' AND ')}`;
  const joinSql = `${BASE_FROM} JOIN interventions i ON i.student_id = s.id`;

  const countResult = await pool.query(`SELECT COUNT(*)::int AS count ${joinSql} ${whereSql}`, params);
  const total = countResult.rows[0].count;

  const limit = Math.min(Number(pageSize) || 20, 100);
  const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;
  const dataParams = [...params, limit, offset];

  // WHERE THE LEARNER STANDS NOW, alongside where they stood when the
  // intervention was logged.
  //
  // The page is the closed loop (CLAUDE.md Part B) and it could not show
  // it: "Risk at logging" was there, the current level was not, so nothing
  // on screen said whether anything had worked. That is the one comparison
  // the module exists to make, and it is the same comparison
  // riskEngine.closeOutInterventions performs when it auto-resolves or
  // escalates a case.
  //
  // The period IDs travel with both levels so the reader can tell "the
  // learner has not been reassessed since" from "reassessed, no change".
  // Compared on id rather than on name because `grading_periods.name`
  // repeats across school years — every year has a "Term 1" — and only the
  // id is unique.
  //
  // ORDERED BY SCHOOL YEAR AND THEN SEQUENCE, not by sequence alone.
  // `grading_periods.sequence_number` is unique only WITHIN a school year,
  // so a learner in their second year has two periods numbered 1 and
  // ordering by sequence alone can return a previous year's last term as
  // "latest". Scoped per student with a LATERAL + LIMIT 1 so this stays one
  // row per intervention rather than a GROUP BY over the whole join.
  const dataResult = await pool.query(
    `SELECT i.id, i.intervention_type, i.notes, i.status, i.date_logged, i.resolved_at, i.created_at,
            s.id AS student_id, s.first_name AS student_first_name, s.last_name AS student_last_name,
            u.full_name AS logged_by_name, ra.risk_level AS risk_level_at_intervention, gp.name AS grading_period_name,
            ra.grading_period_id AS risk_period_id,
            latest.risk_level AS current_risk_level, latest.period_name AS current_risk_period,
            latest.period_id AS current_risk_period_id
     ${joinSql}
     JOIN users u ON u.id = i.logged_by
     JOIN risk_assessments ra ON ra.id = i.risk_assessment_id
     JOIN grading_periods gp ON gp.id = ra.grading_period_id
     LEFT JOIN LATERAL (
       SELECT ra2.risk_level, gp2.id AS period_id, gp2.name AS period_name
       FROM risk_assessments ra2
       JOIN grading_periods gp2 ON gp2.id = ra2.grading_period_id
       JOIN school_years sy2 ON sy2.id = gp2.school_year_id
       WHERE ra2.student_id = s.id
       ORDER BY sy2.start_date DESC, gp2.sequence_number DESC
       LIMIT 1
     ) latest ON TRUE
     ${whereSql}
     ORDER BY i.created_at DESC
     LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
    dataParams
  );

  return { interventions: dataResult.rows, total, page: Math.max(Number(page) || 1, 1), pageSize: limit };
}

// Summary counts for the Interventions page's stat cards — scoped the same
// way the list itself is.
async function countsByStatus(user) {
  const clauses = ['s.is_active = TRUE'];
  const params = [];
  appendScopeClause(user, clauses, params);

  const result = await pool.query(
    `SELECT i.status, COUNT(*)::int AS count
     ${BASE_FROM}
     JOIN interventions i ON i.student_id = s.id
     WHERE ${clauses.join(' AND ')}
     GROUP BY i.status`,
    params
  );

  const counts = { open: 0, monitoring: 0, resolved: 0, escalated: 0 };
  for (const row of result.rows) {
    counts[row.status] = row.count;
  }
  return counts;
}

module.exports = {
  VALID_TYPES,
  VALID_STATUSES,
  create,
  getById,
  listForStudent,
  listAll,
  updateStatus,
  countsByStatus,
  findOpenOrMonitoringBeforePeriod,
};
