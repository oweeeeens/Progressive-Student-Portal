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
const { todayInSchoolTimezone } = require('../utils/schoolDate');
const { ATTENDANCE_RISK_THRESHOLD } = require('../config/riskConfig');
const gradingPeriodModel = require('../models/gradingPeriodModel');
const outlookModel = require('../models/outlookModel');
const outlookConfig = require('../config/outlookConfig');
const { computeTermGrade } = require('../services/gradeCalculator');
const { GRADING_MODE } = require('../config/gradingPolicy');
const { offeringCoversPeriod } = require('../config/academicTerms');
const {
  promotionOutlook,
  subjectsCausingFailure,
  componentProfile,
  earlyWarning,
  absenceAlert,
} = require('../services/outlookCalculator');
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
  const currentPeriod = await gradingPeriodModel.findByDate(todayInSchoolTimezone());
  return currentPeriod ? currentPeriod.id : null;
}

// The four page-level filters, read off the query string once per request.
// Anything absent or blank is left undefined, which filterRows treats as
// "don't filter on this dimension" — so a request with no filter params
// behaves exactly as it did before filtering existed.
function parseFilters(req) {
  return {
    // Set only for an adviser (middleware/analyticsScope.js): the sections
    // they advise. School-wide roles leave it undefined — no restriction.
    sectionIds: req.analyticsScope ? req.analyticsScope.sectionIds : undefined,
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

// The "Learner Outlook" tab: who is at risk of failing, in what, and why —
// promotion outlook (DO 015 ¶67), subjects causing failure, where learners
// lose points and the early warning from the class record (¶68), and the
// absence alert (¶70). One request, so the five views always describe the
// same learners under the same filters.
async function getLearnerOutlook(req, res) {
  const periodId = await resolveGradingPeriodId(req.query.gradingPeriodId);
  if (!periodId) return res.status(400).json({ error: 'No grading period is configured for today. Pass gradingPeriodId explicitly.' });
  const period = await gradingPeriodModel.getById(periodId);
  // The risk-band filter describes a risk assessment, which these rows are
  // not; the other filters and the adviser scope apply as everywhere else.
  const filters = { ...parseFilters(req), riskBand: undefined };

  const gradeRows = filterRows(await outlookModel.getFinalizedGradesForYear(period.school_year_id), filters);
  const absenceRows = filterRows(await outlookModel.getAbsenceCountsForYear(period.school_year_id), filters);

  // Every learner's class record for this term, computed with the DepEd
  // formula — the source of the early warning and where-points-are-lost.
  const data = await outlookModel.getClassRecordDataForPeriod(periodId);
  const itemsByOffering = new Map();
  for (const row of data.items) {
    if (!itemsByOffering.has(row.class_offering_id)) itemsByOffering.set(row.class_offering_id, []);
    itemsByOffering.get(row.class_offering_id).push({
      id: row.id,
      component: row.component,
      examPart: row.exam_part,
      title: row.title,
      highestPossibleScore: Number(row.highest_possible_score),
    });
  }
  const scores = new Map(data.scores.map((r) => [`${r.student_id}|${r.assessment_item_id}`, Number(r.raw_score)]));
  const finalizedPairs = new Set(data.finalized.map((r) => `${r.student_id}|${r.class_offering_id}`));
  const computations = [];
  for (const offering of data.offerings) {
    const items = itemsByOffering.get(offering.id);
    if (!items) continue;
    if (!offeringCoversPeriod({ term: offering.term, subjectCategory: offering.subject_category, periodSequenceNumber: period.sequence_number })) continue;
    const roster = filterRows(data.students.filter((st) => st.current_section_id === offering.section_id), filters);
    for (const student of roster) {
      const studentScores = new Map();
      for (const item of items) {
        const key = `${student.student_id}|${item.id}`;
        if (scores.has(key)) studentScores.set(item.id, scores.get(key));
      }
      computations.push({
        studentId: student.student_id,
        name: `${student.last_name}, ${student.first_name}`,
        sectionName: offering.section_name,
        classOfferingId: offering.id,
        subjectName: offering.subject_name,
        computed: computeTermGrade({ items, scores: studentScores, weightGroup: offering.weight_group, mode: GRADING_MODE }),
      });
    }
  }

  res.json({
    gradingPeriodId: periodId,
    periodName: period.name,
    thresholds: outlookConfig,
    promotion: promotionOutlook(gradeRows),
    subjects: subjectsCausingFailure(gradeRows),
    components: componentProfile(computations),
    // Provisional only: a grade already finalized this term is official and
    // is counted in the promotion outlook instead.
    earlyWarning: earlyWarning(computations.filter((c) => !finalizedPairs.has(`${c.studentId}|${c.classOfferingId}`))),
    absences: absenceAlert(absenceRows),
  });
}

module.exports = {
  getLearnerOutlook,
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
