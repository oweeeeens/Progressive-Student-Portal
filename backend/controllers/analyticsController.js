// School-wide, read-only rollups for the Analytics module — admin,
// principal, and guidance_counselor only (route-gated in
// routes/analyticsRoutes.js). No per-student actions live here; every
// handler is a GET that aggregates existing grades/attendance/
// risk_assessments/interventions data, never writes anything. Unlike the
// Academic Progress Tracking dashboard, there is no adviser-style section
// ownership check anywhere in this file — all three roles that can reach it
// already have unrestricted, school-wide visibility everywhere else in the
// app (see studentModel.appendScopeClause).
//
// Every handler follows the same three steps, in the same order:
//   1. fetch per-student rows from analyticsModel
//   2. narrow them with analyticsCalculator.filterRows(rows, parseFilters(req))
//   3. roll the survivors up with a pure calculator function
// Because step 2 is the same function everywhere, a filter the user picks
// on the Analytics page means exactly the same thing on all five tabs.
const analyticsModel = require('../models/analyticsModel');
const { ATTENDANCE_RISK_THRESHOLD } = require('../config/riskConfig');
const gradingPeriodModel = require('../models/gradingPeriodModel');
const { buildAnalyticsReportData } = require('../services/analyticsReport');
const { buildAnalyticsReportPdf } = require('../services/analyticsReportPdf');
const { buildAnalyticsReportWorkbook } = require('../services/analyticsReportWorkbook');
const {
  filterRows,
  riskDistribution,
  riskTrend,
  topFactors,
  interventionEffectiveness,
  interventionVolumeByPeriod,
  topAtRiskStudents,
  attendanceByRiskCohort,
  attendanceRateByPeriod,
  sectionAttendanceRates,
  factorTrendByPeriod,
  sectionFactorBreakdown,
} = require('../services/analyticsCalculator');

async function resolveGradingPeriodId(gradingPeriodId) {
  if (gradingPeriodId) return Number(gradingPeriodId);
  const currentPeriod = await gradingPeriodModel.findByDate(new Date().toISOString().slice(0, 10));
  return currentPeriod ? currentPeriod.id : null;
}

// The four page-level filters, read off the query string once per request.
// Anything absent or blank is left undefined, which filterRows treats as
// "don't filter on this dimension" — so a request with no filter params
// behaves exactly as it did before filtering existed.
function parseFilters(req) {
  return {
    sectionId: req.query.sectionId ? Number(req.query.sectionId) : undefined,
    gradeLevel: req.query.gradeLevel ? Number(req.query.gradeLevel) : undefined,
    strand: req.query.strand || undefined,
    riskBand: req.query.riskBand || undefined,
  };
}

async function getRiskDistribution(req, res) {
  const periodId = await resolveGradingPeriodId(req.query.gradingPeriodId);
  if (!periodId) return res.status(400).json({ error: 'No grading period is configured for today. Pass gradingPeriodId explicitly.' });

  const groupBy = ['section', 'gradeLevel'].includes(req.query.groupBy) ? req.query.groupBy : undefined;
  const rows = filterRows(await analyticsModel.getAssessmentsForPeriod(periodId), parseFilters(req));
  res.json({
    gradingPeriodId: periodId,
    ...riskDistribution(rows, groupBy),
    // Reuses the same rows already fetched above — no second query — for
    // the Overview tab's "Students Needing Attention" mini-list.
    topAtRisk: topAtRiskStudents(rows, 5),
  });
}

async function getRiskTrend(req, res) {
  const schoolYearId = req.query.schoolYearId ? Number(req.query.schoolYearId) : undefined;
  const rows = filterRows(await analyticsModel.getAssessmentsForSchoolYear(schoolYearId), parseFilters(req));
  res.json({ periods: riskTrend(rows) });
}

// The Factors tab's "is this factor becoming more or less common" chart —
// separate endpoint from getTopFactors (one period) since this needs every
// period's rows, the same shape getRiskTrend already fetches for the same
// reason.
async function getFactorsTrend(req, res) {
  const schoolYearId = req.query.schoolYearId ? Number(req.query.schoolYearId) : undefined;
  const rows = filterRows(await analyticsModel.getAssessmentsForSchoolYear(schoolYearId), parseFilters(req));
  res.json({ periods: factorTrendByPeriod(rows) });
}

// The Attendance tab's two charts, off one query: the plain rate-per-period
// line and the At-Risk-vs-everyone-else comparison are the same rows
// grouped two different ways, so they're served together and can never
// disagree about a period's numbers.
async function getAttendanceTrend(req, res) {
  const schoolYearId = req.query.schoolYearId ? Number(req.query.schoolYearId) : undefined;
  const rows = filterRows(await analyticsModel.getAttendanceWithRiskByPeriod(schoolYearId), parseFilters(req));
  res.json({
    // Same reason as myProgressController's trend response: the Attendance
    // Trend chart draws its reference line at the risk formula's own
    // threshold, so the chart can't contradict the engine once the client
    // confirms the real figure. Also colours the Lowest-Attendance Sections
    // bars on the same tab, which used to hardcode 90 in the frontend.
    attendanceThreshold: ATTENDANCE_RISK_THRESHOLD,
    periods: attendanceRateByPeriod(rows),
    byRiskCohort: attendanceByRiskCohort(rows),
  });
}

// The Attendance tab's "which sections need the most follow-up right now"
// table — worst-first, for one period (defaults to today's, same
// convenience every other per-period endpoint here already has).
async function getLowestAttendanceSections(req, res) {
  const periodId = await resolveGradingPeriodId(req.query.gradingPeriodId);
  if (!periodId) return res.status(400).json({ error: 'No grading period is configured for today. Pass gradingPeriodId explicitly.' });

  const limit = Math.min(Number(req.query.limit) || 5, 20);
  const rows = filterRows(await analyticsModel.getStudentAttendanceForPeriod(periodId), parseFilters(req));
  res.json({
    gradingPeriodId: periodId,
    sections: sectionAttendanceRates(rows).slice(0, limit),
  });
}

// The Interventions tab, off one query: the effectiveness rollup and the
// volume-over-time chart are the same filtered rows counted two ways.
async function getInterventionEffectiveness(req, res) {
  const rows = filterRows(await analyticsModel.getInterventionRows(), parseFilters(req));
  res.json({
    ...interventionEffectiveness(rows),
    volumeByPeriod: interventionVolumeByPeriod(rows),
  });
}

async function getTopFactors(req, res) {
  const periodId = await resolveGradingPeriodId(req.query.gradingPeriodId);
  if (!periodId) return res.status(400).json({ error: 'No grading period is configured for today. Pass gradingPeriodId explicitly.' });

  const rows = filterRows(await analyticsModel.getAssessmentsForPeriod(periodId), parseFilters(req));
  res.json({
    gradingPeriodId: periodId,
    factors: topFactors(rows),
    // Same rows, grouped by section instead of tallied once overall — "which
    // section does a given factor concentrate in."
    bySection: sectionFactorBreakdown(rows),
  });
}

// A filename that says what the file is scoped to, so a folder of exports
// taken at different filter settings doesn't become a pile of
// indistinguishable "analytics-report" files.
function buildExportFilename(data, extension) {
  const scope = data.appliedFilters
    .map((f) => f.value)
    .join('-')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '');
  const date = data.generatedAt.toISOString().slice(0, 10);
  return `Analytics-${scope}-${date}.${extension}`;
}

// Both exports run the SAME gather step as each other and as the page's own
// endpoints — same filters, same calculators — so a downloaded report always
// matches what the person was looking at when they clicked Export.
async function gatherReport(req) {
  const periodId = await resolveGradingPeriodId(req.query.gradingPeriodId);
  if (!periodId) return null;
  const groupBy = ['section', 'gradeLevel'].includes(req.query.groupBy) ? req.query.groupBy : undefined;
  return buildAnalyticsReportData({ periodId, filters: parseFilters(req), groupBy });
}

async function exportPdf(req, res) {
  const data = await gatherReport(req);
  if (!data) return res.status(400).json({ error: 'No grading period is configured for today. Pass gradingPeriodId explicitly.' });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${buildExportFilename(data, 'pdf')}"`);

  const doc = buildAnalyticsReportPdf(data);
  doc.pipe(res);
  doc.end();
}

async function exportExcel(req, res) {
  const data = await gatherReport(req);
  if (!data) return res.status(400).json({ error: 'No grading period is configured for today. Pass gradingPeriodId explicitly.' });

  const buffer = await buildAnalyticsReportWorkbook(data);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${buildExportFilename(data, 'xlsx')}"`);
  res.send(buffer);
}

module.exports = {
  getRiskDistribution,
  getRiskTrend,
  getInterventionEffectiveness,
  getAttendanceTrend,
  getTopFactors,
  getFactorsTrend,
  getLowestAttendanceSections,
  exportPdf,
  exportExcel,
};
