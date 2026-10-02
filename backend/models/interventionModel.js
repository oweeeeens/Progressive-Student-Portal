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

const VALID_TYPES = ['parent_conference', 'tutoring_referral', 'counseling_referral', 'attendance_follow_up', 'other'];
const VALID_STATUSES = ['open', 'monitoring', 'resolved', 'escalated'];
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

  const dataResult = await pool.query(
    `SELECT i.id, i.intervention_type, i.notes, i.status, i.date_logged, i.resolved_at, i.created_at,
            s.id AS student_id, s.first_name AS student_first_name, s.last_name AS student_last_name,
            u.full_name AS logged_by_name, ra.risk_level AS risk_level_at_intervention, gp.name AS grading_period_name
     ${joinSql}
     JOIN users u ON u.id = i.logged_by
     JOIN risk_assessments ra ON ra.id = i.risk_assessment_id
     JOIN grading_periods gp ON gp.id = ra.grading_period_id
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
