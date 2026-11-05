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
const analyticsCalculator = require('../services/analyticsCalculator');

const ATTENTION_WIDGET_ROLES = ['admin', 'principal', 'adviser', 'guidance_counselor'];
// Of those, the ones whose widget covers the whole school. Everyone else is
// narrowed to the sections they actually advise.
const SCHOOL_WIDE_ATTENTION_ROLES = ['admin', 'principal', 'guidance_counselor'];

// May this person be shown risk figures at all?
//
// Anyone who advises a section qualifies, whatever their role label says.
// This used to be a bare role list inline in getStats, so a teacher who
// advised a section saw no at-risk count for their own advisees — the same
// assignment-versus-label bug CLAUDE.md records across the rest of the app.
// It is a named function now because the band chart below asks exactly the
// same question, and two copies of this test would eventually disagree
// about who sees what.
//
// `||` short-circuits, so the roles that already qualify never pay for the
// lookup — only someone outside the list is asked what they advise.
async function hasRiskScope(user) {
  if (['admin', 'adviser', 'guidance_counselor'].includes(user.role)) return true;
  if (user.role === 'student') return false;
  return (await sectionModel.listSectionsByAdviser(user.id)).length > 0;
}

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

  const seesRisk = await hasRiskScope(user);
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
// Exported as well as used here: dashboardQueueModel shows the same figure
// as a task ("Verify submitted grades, 12 grades"), and the card and the
// task must be the same number or one of them is lying.
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

// Who may read a band rollup for their own scope.
//
// hasRiskScope above answers "do the at-risk and open-intervention CARDS
// apply to you", and the principal is deliberately outside it: the
// per-learner follow-up is not theirs (CLAUDE.md). A read-only distribution
// of the whole school IS theirs — it is the same figure Analytics and
// Academic Progress Tracking already show them — so the chart asks a
// slightly wider question than the cards do, and says why here rather than
// quietly widening the shared predicate and changing the cards with it.
async function canReadBandRollup(user) {
  return user.role === 'principal' || (await hasRiskScope(user));
}

// The band distribution for this person's scope, one tally per grading
// period of the current school year, oldest first.
//
// This is the dashboard's one chart, and it is built from the SAME two
// pieces Analytics uses — the row shape of analyticsModel's school-year
// query, and analyticsCalculator.riskTrend to tally it — rather than a
// third implementation of "which band is this". classifyRow inside
// riskTrend calls academicProgressCalculator.determineBand, so a learner
// counted here as At Risk - Medium is in exactly the band their own row
// shows on Academic Progress Tracking.
//
// The ONE thing that differs from Analytics is the WHERE clause: scoped
// through appendScopeClause, so an adviser's chart covers the sections they
// advise plus any they teach into, and nobody's home page becomes a side
// channel to school-wide numbers they cannot see on the pages themselves.
//
// Students with no assessment for a period are absent rather than counted
// as "not yet calculated": this chart starts from risk_assessments, so a
// period nobody has been assessed in is an empty period, which the frontend
// shows as such. (Analytics LEFT JOINs instead, because its distribution
// chart is explicitly about how much of the roster is still unassessed.)
async function getBandTrend(user, { sectionId } = {}) {
  if (!(await canReadBandRollup(user))) return { periods: [] };

  const clauses = ['s.is_active = TRUE', 'sy.is_current = TRUE'];
  const params = [];
  appendScopeClause(user, clauses, params);

  // An optional NARROWING, applied on top of the scope clause and never
  // instead of it. That ordering is the whole safety argument: whatever
  // section is asked for, the reader still only sees learners
  // appendScopeClause already allows them, so this needs no permission
  // check of its own and cannot be used to reach another adviser's
  // section. It exists so Academic Progress Tracking can draw this chart
  // for the section its own tables are showing — a chart describing a
  // different set of learners from the list underneath it is worse than no
  // chart.
  if (sectionId) {
    params.push(Number(sectionId));
    clauses.push(`s.current_section_id = $${params.length}`);
  }

  const result = await pool.query(
    `SELECT ra.student_id, gp.id AS grading_period_id, gp.name AS period_name, gp.sequence_number,
            ra.average_grade, ra.grade_trend, ra.risk_score, ra.risk_level
     ${BASE_FROM}
     JOIN risk_assessments ra ON ra.student_id = s.id
     JOIN grading_periods gp ON gp.id = ra.grading_period_id
     JOIN school_years sy ON sy.id = gp.school_year_id
     WHERE ${clauses.join(' AND ')}
     ORDER BY gp.sequence_number`,
    params
  );

  return { periods: analyticsCalculator.riskTrend(result.rows) };
}

module.exports = { getStats, getTopAtRiskStudents, getBandTrend, countSubmittedGrades };
