// Cross-module summary counts for the home dashboard's stat cards. Every
// student-derived count reuses studentModel's appendScopeClause, so an
// adviser's numbers cover only their own advisory section and a student's
// cover only themselves — the dashboard can't become a side channel that
// leaks totals a role isn't allowed to see on the pages themselves.
const { pool } = require('../config/db');
const { todayInSchoolTimezone } = require('../utils/schoolDate');
const { appendScopeClause, BASE_FROM } = require('./studentModel');
const gradingPeriodModel = require('./gradingPeriodModel');
const sectionModel = require('./sectionModel');
const riskAssessmentModel = require('./riskAssessmentModel');
const riskCalculator = require('../services/riskCalculator');

const ATTENTION_WIDGET_ROLES = ['admin', 'principal', 'adviser', 'guidance_counselor'];
// Of those, the ones whose widget covers the whole school. Everyone else is
// narrowed to the sections they actually advise.
const SCHOOL_WIDE_ATTENTION_ROLES = ['admin', 'principal', 'guidance_counselor'];

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
  const currentPeriod = await gradingPeriodModel.findByDate(todayInSchoolTimezone());
  const stats = {};

  // Counted through studentModel's scope clause, which is assignment-based,
  // so this only has to decide whether the CARD is meaningful — not who may
  // see what.
  //
  // Two roles get no card. ICT faculty hold no assignment and so have no
  // roster to count. A STUDENT is excluded for a different and firmer
  // reason: their scope is themselves, so the count would read "1", and
  // CLAUDE.md is explicit that no school-wide figure of any kind reaches a
  // learner's view. A stat card saying "1 student" is a aggregate shaped
  // like one they should never be shown.
  const seesStudents = !['ict_faculty', 'student'].includes(user.role);
  if (seesStudents) {
    stats.students = await countVisibleStudents(user);
  }

  // Risk figures follow the same rule, with one addition: anyone who advises
  // a section gets them, whatever their role label says. It used to be a
  // bare role list, so a teacher who advised a section saw no at-risk count
  // for their own advisees.
  // `||` short-circuits, so the roles that already qualify never pay for the
  // lookup — only someone outside the list is asked what they advise.
  const seesRisk =
    ['admin', 'adviser', 'guidance_counselor'].includes(user.role) ||
    (user.role !== 'student' && (await sectionModel.listSectionsByAdviser(user.id)).length > 0);
  if (seesRisk) {
    stats.atRiskStudents = await countAtRiskStudents(user, currentPeriod?.id);
    stats.openInterventions = await countOpenInterventions(user);
  }

  // The principal had no figures at all, which left the one role with a
  // school-wide queue looking at a home page with nothing on it. They
  // already see the school-wide risk rollup on Analytics and the per-student
  // drill-down from it, so withholding the headline count here protected
  // nothing — and the grades waiting on them are the single most useful
  // number this person can be shown.
  if (['admin', 'principal'].includes(user.role) && currentPeriod) {
    stats.gradesAwaitingVerification = await countSubmittedGrades(currentPeriod.id);
  }
  if (user.role === 'principal') {
    stats.students = await countVisibleStudents(user);
    stats.atRiskStudents = await countAtRiskStudents(user, currentPeriod?.id);
  }

  return stats;
}

// Grades sitting in `submitted` for the current period — the principal's
// queue, counted the same way VerifyGradesPage's own list counts it.
async function countSubmittedGrades(gradingPeriodId) {
  const result = await pool.query(
    `SELECT COUNT(*) FROM grades WHERE status = 'submitted' AND grading_period_id = $1`,
    [gradingPeriodId]
  );
  return Number(result.rows[0].count);
}

// "Students Needing Attention" widget — the top N highest-risk students in
// this user's scope, each with its single most significant contributing
// factor. Reuses riskAssessmentModel.listForDashboard and
// riskCalculator.evaluateFactors exactly as academicProgressController does,
// rather than re-deriving risk factors a second time.
async function getTopAtRiskStudents(user, limit = 5) {
  if (!ATTENTION_WIDGET_ROLES.includes(user.role)) return [];

  const currentPeriod = await gradingPeriodModel.findByDate(todayInSchoolTimezone());
  if (!currentPeriod) return [];

  // Scoped by what this person ADVISES, not by their role label. Two bugs
  // lived in the old `if (user.role === 'adviser')` version: anyone who
  // advised a section while carrying a different role label fell through
  // with no section filter at all and got the whole school's at-risk list,
  // and `sections[0]` silently dropped every section past the first for
  // anyone advising two.
  let sectionIds;
  if (!SCHOOL_WIDE_ATTENTION_ROLES.includes(user.role)) {
    const sections = await sectionModel.listSectionsByAdviser(user.id);
    if (sections.length === 0) return [];
    sectionIds = sections.map((section) => section.id);
  }

  const rows = await riskAssessmentModel.listForDashboard({ sectionIds, gradingPeriodId: currentPeriod.id });
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
