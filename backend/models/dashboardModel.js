// Cross-module summary counts for the home dashboard's stat cards. Every
// student-derived count reuses studentModel's appendScopeClause, so an
// adviser's numbers cover only their own advisory section and a student's
// cover only themselves — the dashboard can't become a side channel that
// leaks totals a role isn't allowed to see on the pages themselves.
const { pool } = require('../config/db');
const { appendScopeClause, BASE_FROM } = require('./studentModel');
const gradingPeriodModel = require('./gradingPeriodModel');
const sectionModel = require('./sectionModel');
const riskAssessmentModel = require('./riskAssessmentModel');
const riskCalculator = require('../services/riskCalculator');

const ATTENTION_WIDGET_ROLES = ['admin', 'adviser', 'guidance_counselor'];

async function countVisibleStudents(user) {
  const clauses = ['s.is_active = TRUE'];
  const params = [];
  appendScopeClause(user, clauses, params);

  const result = await pool.query(`SELECT COUNT(*)::int AS count ${BASE_FROM} WHERE ${clauses.join(' AND ')}`, params);
  return result.rows[0].count;
}

// "At risk" = medium or high for the given grading period. Low risk is
// deliberately excluded — this card is meant to be the number worth acting
// on, not a restatement of the roster size.
async function countAtRiskStudents(user, gradingPeriodId) {
  if (!gradingPeriodId) return 0;

  const clauses = ['s.is_active = TRUE', 'ra.grading_period_id = $1', "ra.risk_level IN ('medium', 'high')"];
  const params = [gradingPeriodId];
  appendScopeClause(user, clauses, params);

  const result = await pool.query(
    `SELECT COUNT(*)::int AS count
     ${BASE_FROM}
     JOIN risk_assessments ra ON ra.student_id = s.id
     WHERE ${clauses.join(' AND ')}`,
    params
  );
  return result.rows[0].count;
}

async function countPendingDocuments() {
  const result = await pool.query("SELECT COUNT(*)::int AS count FROM enrollment_documents WHERE status = 'pending'");
  return result.rows[0].count;
}

async function countOpenInterventions(user) {
  const clauses = ['s.is_active = TRUE', "i.status IN ('open', 'monitoring')"];
  const params = [];
  appendScopeClause(user, clauses, params);

  const result = await pool.query(
    `SELECT COUNT(*)::int AS count
     ${BASE_FROM}
     JOIN interventions i ON i.student_id = s.id
     WHERE ${clauses.join(' AND ')}`,
    params
  );
  return result.rows[0].count;
}

// Returns only the stats this role has any business seeing — the frontend
// renders a card per key present, so an ICT faculty member or principal
// simply gets fewer cards rather than zeros for things they can't access.
async function getStats(user) {
  const currentPeriod = await gradingPeriodModel.findByDate(new Date().toISOString().slice(0, 10));
  const stats = {};

  const seesStudents = ['admin', 'registrar', 'guidance_counselor', 'adviser', 'subject_teacher'].includes(user.role);
  if (seesStudents) {
    stats.students = await countVisibleStudents(user);
  }

  const seesRisk = ['admin', 'adviser', 'guidance_counselor'].includes(user.role);
  if (seesRisk) {
    stats.atRiskStudents = await countAtRiskStudents(user, currentPeriod?.id);
    stats.openInterventions = await countOpenInterventions(user);
  }

  const seesEnrollment = ['admin', 'registrar'].includes(user.role);
  if (seesEnrollment) {
    stats.pendingDocuments = await countPendingDocuments();
  }

  return stats;
}

// "Students Needing Attention" widget — the top N highest-risk students in
// this user's scope, each with its single most significant contributing
// factor. Reuses riskAssessmentModel.listForDashboard and
// riskCalculator.evaluateFactors exactly as riskDashboardController does,
// rather than re-deriving risk factors a second time.
async function getTopAtRiskStudents(user, limit = 5) {
  if (!ATTENTION_WIDGET_ROLES.includes(user.role)) return [];

  const currentPeriod = await gradingPeriodModel.findByDate(new Date().toISOString().slice(0, 10));
  if (!currentPeriod) return [];

  // listForDashboard takes a single sectionId (or none, for unrestricted
  // roles) — an adviser's own section, same as every other adviser-scoped
  // view in this app assumes one advisory section per adviser.
  let sectionId = null;
  if (user.role === 'adviser') {
    const sections = await sectionModel.listSectionsByAdviser(user.id);
    if (sections.length === 0) return [];
    sectionId = sections[0].id;
  }

  const rows = await riskAssessmentModel.listForDashboard({ sectionId, gradingPeriodId: currentPeriod.id });
  const atRisk = rows.filter((r) => r.risk_level === 'high' || r.risk_level === 'medium').slice(0, limit);

  return atRisk.map((r) => {
    const factors = riskCalculator.evaluateFactors({
      currentGrade: r.average_grade != null ? Number(r.average_grade) : null,
      gradeTrend: r.grade_trend != null ? Number(r.grade_trend) : null,
      currentAttendanceRate: r.attendance_rate != null ? Number(r.attendance_rate) : null,
      attendanceTrend: r.attendance_trend != null ? Number(r.attendance_trend) : null,
    });
    return {
      studentId: r.student_id,
      firstName: r.first_name,
      lastName: r.last_name,
      riskLevel: r.risk_level,
      primaryFactor: factors[0]?.label || null,
    };
  });
}

module.exports = { getStats, getTopAtRiskStudents };
