// Assembles the ENTIRE Analytics page — all five tabs — into one filtered
// snapshot, for the PDF and Excel exports to render.
//
// Why one gatherer instead of each exporter fetching its own: the exports
// have to agree with the screen and with each other. Every figure here comes
// from the same analyticsModel query + the same filterRows() + the same
// pure calculator function the corresponding API endpoint uses, so an
// exported report is the same numbers the viewer was looking at, not a
// second implementation that can drift.
//
// This is the only file in the Analytics module that does DB access AND
// composition; the calculators stay pure and the PDF/workbook builders stay
// pure presentation (same split as reportCardController -> reportCardPdf).
const analyticsModel = require('./../models/analyticsModel');
const gradingPeriodModel = require('./../models/gradingPeriodModel');
const sectionModel = require('./../models/sectionModel');
const schoolYearModel = require('./../models/schoolYearModel');
const {
  BUCKET_LABELS,
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
} = require('./analyticsCalculator');

const SCHOOL = {
  name: 'DepEd Progressive Senior High School — Bacoor City',
  address: 'Bacoor City, Cavite, Philippines',
};

// How many at-risk students the report lists by name. Deliberately more
// than the dashboard's 5-row teaser — an exported report is something a
// counselor works from offline, where the extra rows are the point.
const AT_RISK_LIST_LIMIT = 10;

// Turns the raw filter values into the human-readable "what this report is
// scoped to" lines printed at the top of the PDF and on the workbook's
// Report Info sheet. A detached file has to state its own scope — otherwise
// a filtered export is indistinguishable from a whole-school one, which is
// exactly how a number ends up quoted out of context in a DepEd submission.
async function describeFilters({ periodId, filters }) {
  const described = [];

  const period = periodId ? await gradingPeriodModel.getById(periodId) : null;
  described.push({ label: 'Grading period', value: period ? period.name : 'Current' });

  if (filters.sectionId) {
    const section = await sectionModel.getSectionById(filters.sectionId);
    described.push({
      label: 'Section',
      value: section ? `Grade ${section.grade_level} - ${section.name}` : String(filters.sectionId),
    });
  }
  if (filters.gradeLevel) described.push({ label: 'Grade level', value: `Grade ${filters.gradeLevel}` });
  if (filters.strand) described.push({ label: 'Strand', value: filters.strand });
  if (filters.riskBand) {
    const value = filters.riskBand === 'at_risk_any' ? 'At Risk (any level)' : BUCKET_LABELS[filters.riskBand] || filters.riskBand;
    described.push({ label: 'Risk band', value });
  }

  return described;
}

// filters: the parsed {sectionId, gradeLevel, strand, riskBand} the API
// endpoints already use. periodId: the single grading period the
// snapshot-style sections are scoped to. groupBy: optional 'section' |
// 'gradeLevel' breakdown, same as the Overview tab's.
async function buildAnalyticsReportData({ periodId, filters, groupBy }) {
  const [
    periodAssessmentRows,
    schoolYearAssessmentRows,
    attendanceRows,
    periodAttendanceRows,
    interventionRows,
    schoolYear,
    appliedFilters,
  ] = await Promise.all([
    analyticsModel.getAssessmentsForPeriod(periodId),
    analyticsModel.getAssessmentsForSchoolYear(),
    analyticsModel.getAttendanceWithRiskByPeriod(),
    analyticsModel.getStudentAttendanceForPeriod(periodId),
    analyticsModel.getInterventionRows(),
    schoolYearModel.getCurrentSchoolYear(),
    describeFilters({ periodId, filters }),
  ]);

  // Every dataset goes through the same filter, once, before any rollup.
  const assessments = filterRows(periodAssessmentRows, filters);
  const schoolYearAssessments = filterRows(schoolYearAssessmentRows, filters);
  const attendance = filterRows(attendanceRows, filters);
  const periodAttendance = filterRows(periodAttendanceRows, filters);
  const interventions = filterRows(interventionRows, filters);

  const distribution = riskDistribution(assessments, groupBy);

  return {
    school: SCHOOL,
    schoolYearLabel: schoolYear?.label || null,
    periodName: appliedFilters[0].value,
    appliedFilters,
    generatedAt: new Date(),
    groupBy: groupBy || null,

    // Overview
    distribution,
    topAtRisk: topAtRiskStudents(assessments, AT_RISK_LIST_LIMIT),

    // Trends
    riskTrend: riskTrend(schoolYearAssessments),

    // Attendance
    attendanceByPeriod: attendanceRateByPeriod(attendance),
    attendanceByCohort: attendanceByRiskCohort(attendance),
    lowestAttendanceSections: sectionAttendanceRates(periodAttendance),

    // Interventions
    interventions: interventionEffectiveness(interventions),
    interventionVolume: interventionVolumeByPeriod(interventions),

    // Factors
    topFactors: topFactors(assessments),
    factorsTrend: factorTrendByPeriod(schoolYearAssessments),
    factorsBySection: sectionFactorBreakdown(assessments),
  };
}

module.exports = { buildAnalyticsReportData, SCHOOL, AT_RISK_LIST_LIMIT };
