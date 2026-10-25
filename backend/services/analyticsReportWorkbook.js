// Builds the Analytics export workbook — the data BEHIND each chart, as
// spreadsheet rows the school can pivot, chart themselves, or attach to a
// DepEd submission.
//
// Pure presentation, same contract as analyticsReportPdf.js: it receives the
// already-filtered snapshot from analyticsReport.js and only decides how to
// lay it out. Uses ExcelJS, the same library the Bulk Import template
// generator already uses (services/bulkImportParser.js) — no second
// spreadsheet dependency.
//
// One sheet per chart rather than one wide sheet: each chart's data has its
// own natural grain (per band, per period, per section, per factor), and
// flattening those into a single table would mean a sheet full of blank
// cells that nobody can pivot cleanly.
const ExcelJS = require('exceljs');
const { BUCKET_KEYS, BUCKET_LABELS, FACTOR_LABELS } = require('./analyticsCalculator');
const { INTERVENTION_TYPE_LABELS } = require('../config/interventions');

const NAVY_ARGB = 'FF1A3A6B'; // brand navy, in ExcelJS's AARRGGBB form
const FACTOR_ORDER = ['low_grade', 'declining_grade', 'low_attendance', 'declining_attendance'];

// Adds a sheet with a styled header row and sensible column widths.
// `columns`: [{ header, key, width }]. `rows`: array of plain objects.
function addSheet(workbook, name, columns, rows) {
  const sheet = workbook.addWorksheet(name);
  sheet.columns = columns;

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY_ARGB } };
  headerRow.alignment = { vertical: 'middle' };

  rows.forEach((row) => sheet.addRow(row));

  // Freeze the header so a long sheet stays readable while scrolling.
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  return sheet;
}

// A null percentage/rate is MISSING, not zero (e.g. a cohort with no
// students in that period) — written as an empty cell rather than a 0 that
// would silently skew any average the school calculates over the column.
function orBlank(value) {
  return value == null ? null : value;
}

// Sheet 1: what this file is scoped to. A workbook detached from the app
// has to carry its own provenance, or a filtered figure gets quoted as if
// it were school-wide.
function addReportInfoSheet(workbook, data) {
  const rows = [
    ...data.appliedFilters.map((f) => ({ item: f.label, value: f.value })),
    { item: 'School year', value: data.schoolYearLabel || '—' },
    { item: 'Generated on', value: data.generatedAt.toISOString().slice(0, 10) },
    { item: 'Students in view', value: data.distribution.overall.total },
  ];
  addSheet(
    workbook,
    'Report Info',
    [
      { header: 'Item', key: 'item', width: 26 },
      { header: 'Value', key: 'value', width: 48 },
    ],
    rows
  );
}

function addRiskDistributionSheet(workbook, data) {
  const { counts, total } = data.distribution.overall;
  addSheet(
    workbook,
    'Risk Distribution',
    [
      { header: 'Band', key: 'band', width: 24 },
      { header: 'Students', key: 'students', width: 12 },
      { header: 'Share (%)', key: 'share', width: 12 },
    ],
    BUCKET_KEYS.map((key) => ({
      band: BUCKET_LABELS[key],
      students: counts[key],
      share: total > 0 ? Math.round((counts[key] / total) * 1000) / 10 : null,
    }))
  );
}

// Only present when the viewer had a "Break down by" selected — the sheet
// mirrors what was actually on screen rather than always shipping a
// breakdown they didn't ask for.
function addBreakdownSheet(workbook, data) {
  if (!data.distribution.breakdown) return;
  addSheet(
    workbook,
    data.groupBy === 'section' ? 'Risk by Section' : 'Risk by Grade',
    [
      { header: data.groupBy === 'section' ? 'Section' : 'Grade Level', key: 'group', width: 24 },
      ...BUCKET_KEYS.map((key) => ({ header: BUCKET_LABELS[key], key, width: 18 })),
      { header: 'Total', key: 'total', width: 10 },
    ],
    data.distribution.breakdown.map((row) => ({
      group: row.group,
      ...Object.fromEntries(BUCKET_KEYS.map((key) => [key, row.counts[key]])),
      total: row.total,
    }))
  );
}

function addStudentsNeedingAttentionSheet(workbook, data) {
  addSheet(
    workbook,
    'Students Needing Attention',
    [
      { header: 'Last Name', key: 'lastName', width: 18 },
      { header: 'First Name', key: 'firstName', width: 18 },
      { header: 'Risk Level', key: 'riskLevel', width: 14 },
      { header: 'Top Factor', key: 'topFactor', width: 26 },
    ],
    data.topAtRisk.map((s) => ({
      lastName: s.lastName,
      firstName: s.firstName,
      riskLevel: s.riskLevel,
      topFactor: s.topFactorLabel || '—',
    }))
  );
}

function addRiskOverTimeSheet(workbook, data) {
  addSheet(
    workbook,
    'Risk Over Time',
    [
      { header: 'Grading Period', key: 'period', width: 18 },
      ...BUCKET_KEYS.map((key) => ({ header: BUCKET_LABELS[key], key, width: 18 })),
      { header: 'Total Assessed', key: 'total', width: 15 },
      { header: 'At-Risk Share (%)', key: 'atRiskShare', width: 17 },
    ],
    data.riskTrend.map((p) => {
      const atRisk = p.counts.at_risk_high + p.counts.at_risk_medium + p.counts.at_risk_low;
      return {
        period: p.periodName,
        ...Object.fromEntries(BUCKET_KEYS.map((key) => [key, p.counts[key]])),
        total: p.total,
        atRiskShare: p.total > 0 ? Math.round((atRisk / p.total) * 1000) / 10 : null,
      };
    })
  );
}

function addAttendanceSheet(workbook, data) {
  addSheet(
    workbook,
    'Attendance by Period',
    [
      { header: 'Grading Period', key: 'period', width: 18 },
      { header: 'Overall Rate (%)', key: 'overall', width: 17 },
      { header: 'At Risk (%)', key: 'atRisk', width: 14 },
      { header: 'Everyone Else (%)', key: 'notAtRisk', width: 18 },
    ],
    data.attendanceByPeriod.map((p) => {
      const cohort = data.attendanceByCohort.find((c) => c.periodId === p.periodId);
      return {
        period: p.periodName,
        overall: orBlank(p.attendanceRate),
        atRisk: orBlank(cohort?.atRiskAttendanceRate ?? null),
        notAtRisk: orBlank(cohort?.notAtRiskAttendanceRate ?? null),
      };
    })
  );
}

function addSectionAttendanceSheet(workbook, data) {
  addSheet(
    workbook,
    'Attendance by Section',
    [
      { header: 'Section', key: 'section', width: 24 },
      { header: 'Grade Level', key: 'gradeLevel', width: 13 },
      { header: 'Attendance Rate (%)', key: 'rate', width: 20 },
    ],
    data.lowestAttendanceSections.map((s) => ({
      section: s.sectionName,
      gradeLevel: s.gradeLevel ?? '—',
      rate: s.attendanceRate,
    }))
  );
}

function addInterventionsSheet(workbook, data) {
  const { overall, byType } = data.interventions;
  const toRow = (label, entry) => ({
    type: label,
    open: entry.counts.open,
    monitoring: entry.counts.monitoring,
    resolved: entry.counts.resolved,
    escalated: entry.counts.escalated,
    total: entry.total,
    resolutionRate: orBlank(entry.resolutionRate),
  });

  addSheet(
    workbook,
    'Interventions',
    [
      { header: 'Intervention Type', key: 'type', width: 24 },
      { header: 'Open', key: 'open', width: 10 },
      { header: 'Monitoring', key: 'monitoring', width: 13 },
      { header: 'Resolved', key: 'resolved', width: 11 },
      { header: 'Escalated', key: 'escalated', width: 12 },
      { header: 'Total', key: 'total', width: 10 },
      { header: 'Resolution Rate (%)', key: 'resolutionRate', width: 19 },
    ],
    [...byType.map((row) => toRow(INTERVENTION_TYPE_LABELS[row.interventionType] || row.interventionType, row)), toRow('All types', overall)]
  );

  addSheet(
    workbook,
    'Intervention Volume',
    [
      { header: 'Grading Period', key: 'period', width: 18 },
      { header: 'Interventions Logged', key: 'count', width: 21 },
    ],
    data.interventionVolume.map((p) => ({ period: p.periodName, count: p.count }))
  );
}

function addFactorSheets(workbook, data) {
  addSheet(
    workbook,
    'Top Factors',
    [
      { header: 'Factor', key: 'factor', width: 28 },
      { header: 'Students', key: 'count', width: 12 },
      { header: 'Share of Assessed (%)', key: 'percentage', width: 21 },
    ],
    data.topFactors.map((f) => ({ factor: f.label, count: f.count, percentage: f.percentage }))
  );

  addSheet(
    workbook,
    'Factors Over Time',
    [
      { header: 'Grading Period', key: 'period', width: 18 },
      ...FACTOR_ORDER.map((key) => ({ header: `${FACTOR_LABELS[key]} (%)`, key, width: 26 })),
    ],
    data.factorsTrend.map((p) => ({
      period: p.periodName,
      ...Object.fromEntries(FACTOR_ORDER.map((key) => [key, orBlank(p.factors.find((f) => f.key === key)?.percentage ?? null)])),
    }))
  );

  addSheet(
    workbook,
    'Factors by Section',
    [
      { header: 'Section', key: 'section', width: 24 },
      ...FACTOR_ORDER.map((key) => ({ header: `${FACTOR_LABELS[key]} (%)`, key, width: 26 })),
    ],
    data.factorsBySection.map((row) => ({
      section: row.group,
      ...Object.fromEntries(FACTOR_ORDER.map((key) => [key, orBlank(row.factors.find((f) => f.key === key)?.percentage ?? null)])),
    }))
  );
}

// data: the snapshot from analyticsReport.buildAnalyticsReportData.
// Returns a Buffer the caller sends as the .xlsx response body (same
// contract as bulkImportParser.generateTemplateWorkbook).
async function buildAnalyticsReportWorkbook(data) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'DepEd Progressive SHS Student Portal';
  workbook.created = data.generatedAt;

  addReportInfoSheet(workbook, data);
  addRiskDistributionSheet(workbook, data);
  addBreakdownSheet(workbook, data);
  addStudentsNeedingAttentionSheet(workbook, data);
  addRiskOverTimeSheet(workbook, data);
  addAttendanceSheet(workbook, data);
  addSectionAttendanceSheet(workbook, data);
  addInterventionsSheet(workbook, data);
  addFactorSheets(workbook, data);

  return workbook.xlsx.writeBuffer();
}

module.exports = { buildAnalyticsReportWorkbook };
