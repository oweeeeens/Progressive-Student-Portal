// Draws the printable Analytics report. Pure presentation, exactly like
// reportCardPdf.js: every figure arrives already computed and already
// filtered from analyticsReport.js, so this file only decides how a page is
// laid out. Shares the letterhead, palette and table with the report card
// via pdfPrimitives.js — one visual language for every document the school
// prints out of this system.
//
// The charts on screen become TABLES here rather than rendered images. A
// printed report is read for exact figures (and often retyped into a DepEd
// submission), a bitmap of a chart can't be, and rendering SVG charts
// server-side would mean a headless browser — a heavy dependency for a
// capstone project to defend. Every number behind every chart is present;
// only the drawing is different.
const {
  NAVY,
  BLACK,
  GRAY,
  PAGE_MARGIN,
  CONTENT_WIDTH,
  createDocument,
  ensureSpace,
  drawTable,
  drawBrandHeader,
  drawSectionHeading,
  drawMutedNote,
  formatDate,
} = require('./pdfPrimitives');
const { BUCKET_KEYS, BUCKET_LABELS, FACTOR_LABELS } = require('./analyticsCalculator');
const { INTERVENTION_TYPE_LABELS } = require('../config/interventions');

// Narrow headers for the tables that put periods or factors in COLUMNS,
// where the full label would have to be truncated to fit.
const SHORT_FACTOR_LABELS = {
  low_grade: 'Low grade',
  declining_grade: 'Grade trend',
  low_attendance: 'Low att.',
  declining_attendance: 'Att. trend',
};
const FACTOR_ORDER = ['low_grade', 'declining_grade', 'low_attendance', 'declining_attendance'];

function formatPercent(value) {
  return value == null ? '—' : `${value}%`;
}

function atRiskTotal(counts) {
  return counts.at_risk_high + counts.at_risk_medium + counts.at_risk_low;
}

// The "what is this report actually showing" box. Printed directly under
// the title because a filtered report quoted without its scope is worse
// than no report.
function drawScopeBox(doc, appliedFilters, generatedAt, schoolYearLabel, y) {
  const rows = [
    ...appliedFilters.map((f) => [f.label, f.value]),
    ['School year', schoolYearLabel || '—'],
    ['Generated on', formatDate(generatedAt)],
  ];
  const boxHeight = 16 + Math.ceil(rows.length / 2) * 20;

  doc.rect(PAGE_MARGIN, y, CONTENT_WIDTH, boxHeight).strokeColor(NAVY).lineWidth(1).stroke();
  const colX = [PAGE_MARGIN + 12, PAGE_MARGIN + CONTENT_WIDTH / 2 + 12];

  rows.forEach((row, i) => {
    const colIndex = i % 2;
    const rowIndex = Math.floor(i / 2);
    const rowY = y + 10 + rowIndex * 20;
    doc
      .fontSize(8)
      .fillColor(GRAY)
      .font('Helvetica')
      .text(String(row[0]).toUpperCase(), colX[colIndex], rowY, { width: CONTENT_WIDTH / 2 - 24 });
    doc
      .fontSize(10)
      .fillColor(BLACK)
      .font('Helvetica-Bold')
      .text(String(row[1]), colX[colIndex], rowY + 10, { width: CONTENT_WIDTH / 2 - 24, ellipsis: true, lineBreak: false });
  });

  return y + boxHeight + 18;
}

function drawOverview(doc, data, y) {
  y = drawSectionHeading(doc, '1. Overview', y);

  const counts = data.distribution.overall.counts;
  const total = data.distribution.overall.total;
  const latestAttendance = [...data.attendanceByPeriod].reverse().find((p) => p.attendanceRate != null);

  y = drawTable(doc, {
    x: PAGE_MARGIN,
    y,
    columnWidths: Array(4).fill(CONTENT_WIDTH / 4),
    headerRow: ['Students in View', 'At Risk (all levels)', 'Interventions Logged', 'Latest Attendance Rate'],
    bodyRows: [[total, atRiskTotal(counts), data.interventions.overall.total, formatPercent(latestAttendance?.attendanceRate ?? null)]],
  });
  y += 20;

  y = drawSectionHeading(doc, 'Risk Distribution', y, { spaceBelow: 16 });
  const distributionRows = BUCKET_KEYS.map((key) => [
    BUCKET_LABELS[key],
    counts[key],
    total > 0 ? `${Math.round((counts[key] / total) * 1000) / 10}%` : '—',
  ]);
  distributionRows.push(['Total', total, '100%']);

  y = drawTable(doc, {
    x: PAGE_MARGIN,
    y,
    columnWidths: [CONTENT_WIDTH * 0.5, CONTENT_WIDTH * 0.25, CONTENT_WIDTH * 0.25],
    headerRow: ['Band', 'Students', 'Share'],
    bodyRows: distributionRows,
    emphasizeLastRow: true,
  });
  y += 20;

  // The optional Overview breakdown, only when the viewer had one selected.
  if (data.distribution.breakdown) {
    y = drawSectionHeading(doc, data.groupBy === 'section' ? 'By Section' : 'By Grade Level', y, { spaceBelow: 16 });
    const labelWidth = CONTENT_WIDTH * 0.28;
    const cellWidth = (CONTENT_WIDTH - labelWidth) / (BUCKET_KEYS.length + 1);
    y = drawTable(doc, {
      x: PAGE_MARGIN,
      y,
      columnWidths: [labelWidth, ...BUCKET_KEYS.map(() => cellWidth), cellWidth],
      headerRow: [data.groupBy === 'section' ? 'Section' : 'Grade', 'High', 'Med', 'Low', 'Avg', 'Perf', 'N/C', 'Total'],
      bodyRows: data.distribution.breakdown.map((row) => [
        row.group,
        ...BUCKET_KEYS.map((key) => row.counts[key]),
        row.total,
      ]),
      fontSize: 8,
      ellipsis: true,
    });
    y += 20;
  }

  y = drawSectionHeading(doc, `Students Needing Attention (top ${data.topAtRisk.length})`, y, { spaceBelow: 16 });
  if (data.topAtRisk.length === 0) {
    return drawMutedNote(doc, 'No students are currently flagged at medium or high risk for this selection.', y) + 10;
  }
  return (
    drawTable(doc, {
      x: PAGE_MARGIN,
      y,
      columnWidths: [CONTENT_WIDTH * 0.45, CONTENT_WIDTH * 0.2, CONTENT_WIDTH * 0.35],
      headerRow: ['Student', 'Risk Level', 'Top Factor'],
      bodyRows: data.topAtRisk.map((s) => [`${s.lastName}, ${s.firstName}`, s.riskLevel, s.topFactorLabel || '—']),
      ellipsis: true,
    }) + 24
  );
}

// Periods go in COLUMNS and bands in rows: a school has only a handful of
// grading periods but always six bands, so this way round stays readable
// instead of squeezing six long band names into column headers.
function drawTrends(doc, data, y) {
  y = drawSectionHeading(doc, '2. Trends — Risk Distribution Over Time', y);

  if (data.riskTrend.length === 0) {
    return drawMutedNote(doc, 'No grading periods with assessment data yet for this selection.', y) + 10;
  }

  const periods = data.riskTrend;
  const labelWidth = CONTENT_WIDTH * 0.32;
  const cellWidth = (CONTENT_WIDTH - labelWidth) / periods.length;

  const bodyRows = BUCKET_KEYS.map((key) => [BUCKET_LABELS[key], ...periods.map((p) => p.counts[key])]);
  bodyRows.push(['Total assessed', ...periods.map((p) => p.total)]);
  bodyRows.push([
    'At-risk share',
    ...periods.map((p) => (p.total > 0 ? `${Math.round((atRiskTotal(p.counts) / p.total) * 1000) / 10}%` : '—')),
  ]);

  return (
    drawTable(doc, {
      x: PAGE_MARGIN,
      y,
      columnWidths: [labelWidth, ...periods.map(() => cellWidth)],
      headerRow: ['Band', ...periods.map((p) => p.periodName)],
      bodyRows,
      emphasizeLastRow: true,
      ellipsis: true,
    }) + 24
  );
}

function drawAttendance(doc, data, y) {
  y = drawSectionHeading(doc, '3. Attendance', y);

  if (data.attendanceByPeriod.length === 0) {
    y = drawMutedNote(doc, 'No daily attendance records for this selection.', y);
  } else {
    y = drawTable(doc, {
      x: PAGE_MARGIN,
      y,
      columnWidths: [CONTENT_WIDTH * 0.34, CONTENT_WIDTH * 0.22, CONTENT_WIDTH * 0.22, CONTENT_WIDTH * 0.22],
      headerRow: ['Grading Period', 'Overall Rate', 'At Risk', 'Everyone Else'],
      bodyRows: data.attendanceByPeriod.map((p) => {
        const cohort = data.attendanceByCohort.find((c) => c.periodId === p.periodId);
        return [
          p.periodName,
          formatPercent(p.attendanceRate),
          formatPercent(cohort?.atRiskAttendanceRate ?? null),
          formatPercent(cohort?.notAtRiskAttendanceRate ?? null),
        ];
      }),
    });
    y += 20;
  }

  y = drawSectionHeading(doc, 'Lowest-Attendance Sections', y, { spaceBelow: 16 });
  if (data.lowestAttendanceSections.length === 0) {
    return drawMutedNote(doc, 'No section attendance to rank for this selection.', y) + 10;
  }
  return (
    drawTable(doc, {
      x: PAGE_MARGIN,
      y,
      columnWidths: [CONTENT_WIDTH * 0.65, CONTENT_WIDTH * 0.35],
      headerRow: ['Section', 'Attendance Rate'],
      bodyRows: data.lowestAttendanceSections.map((s) => [
        s.gradeLevel != null ? `Grade ${s.gradeLevel} - ${s.sectionName}` : s.sectionName,
        formatPercent(s.attendanceRate),
      ]),
      ellipsis: true,
    }) + 24
  );
}

function drawInterventions(doc, data, y) {
  y = drawSectionHeading(doc, '4. Interventions', y);

  const { overall, byType } = data.interventions;
  if (overall.total === 0) {
    return drawMutedNote(doc, 'No interventions have been logged for this selection.', y) + 10;
  }

  const typeRows = byType.map((row) => [
    INTERVENTION_TYPE_LABELS[row.interventionType] || row.interventionType,
    row.counts.resolved,
    row.counts.escalated,
    row.counts.open + row.counts.monitoring,
    formatPercent(row.resolutionRate),
  ]);
  typeRows.push([
    'All types',
    overall.counts.resolved,
    overall.counts.escalated,
    overall.counts.open + overall.counts.monitoring,
    formatPercent(overall.resolutionRate),
  ]);

  y = drawTable(doc, {
    x: PAGE_MARGIN,
    y,
    columnWidths: [CONTENT_WIDTH * 0.32, CONTENT_WIDTH * 0.15, CONTENT_WIDTH * 0.15, CONTENT_WIDTH * 0.2, CONTENT_WIDTH * 0.18],
    headerRow: ['Intervention Type', 'Resolved', 'Escalated', 'Open / Monitoring', 'Resolution Rate'],
    bodyRows: typeRows,
    emphasizeLastRow: true,
    fontSize: 8,
    ellipsis: true,
  });
  y += 8;
  y = drawMutedNote(doc, 'Resolution rate counts closed interventions only (resolved / resolved + escalated).', y);
  y += 4;

  y = drawSectionHeading(doc, 'Volume Over Time', y, { spaceBelow: 16 });
  if (data.interventionVolume.length === 0) {
    return drawMutedNote(doc, 'No interventions to chart over time.', y) + 10;
  }
  return (
    drawTable(doc, {
      x: PAGE_MARGIN,
      y,
      columnWidths: [CONTENT_WIDTH * 0.65, CONTENT_WIDTH * 0.35],
      headerRow: ['Grading Period', 'Interventions Logged'],
      bodyRows: data.interventionVolume.map((p) => [p.periodName, p.count]),
    }) + 24
  );
}

function drawFactors(doc, data, y) {
  y = drawSectionHeading(doc, '5. Risk Factors', y);

  const assessedAny = data.topFactors.some((f) => f.count > 0);
  if (!assessedAny) {
    y = drawMutedNote(doc, 'No risk factors were triggered for this selection in this grading period.', y);
  } else {
    y = drawTable(doc, {
      x: PAGE_MARGIN,
      y,
      columnWidths: [CONTENT_WIDTH * 0.5, CONTENT_WIDTH * 0.25, CONTENT_WIDTH * 0.25],
      headerRow: ['Factor', 'Students', 'Share of Assessed'],
      bodyRows: data.topFactors.map((f) => [f.label, f.count, formatPercent(f.percentage)]),
    });
    y += 20;
  }

  if (data.factorsTrend.length > 1) {
    y = drawSectionHeading(doc, 'Factors Over Time (share of assessed students)', y, { spaceBelow: 16 });
    const labelWidth = CONTENT_WIDTH * 0.34;
    const cellWidth = (CONTENT_WIDTH - labelWidth) / data.factorsTrend.length;
    y = drawTable(doc, {
      x: PAGE_MARGIN,
      y,
      columnWidths: [labelWidth, ...data.factorsTrend.map(() => cellWidth)],
      headerRow: ['Factor', ...data.factorsTrend.map((p) => p.periodName)],
      bodyRows: FACTOR_ORDER.map((key) => [
        FACTOR_LABELS[key],
        ...data.factorsTrend.map((p) => formatPercent(p.factors.find((f) => f.key === key)?.percentage ?? null)),
      ]),
      ellipsis: true,
    });
    y += 20;
  }

  if (data.factorsBySection.length === 0) return y;

  y = drawSectionHeading(doc, 'Factors by Section (share of assessed students)', y, { spaceBelow: 16 });
  const sectionColWidth = CONTENT_WIDTH * 0.32;
  const factorColWidth = (CONTENT_WIDTH - sectionColWidth) / FACTOR_ORDER.length;
  return (
    drawTable(doc, {
      x: PAGE_MARGIN,
      y,
      columnWidths: [sectionColWidth, ...FACTOR_ORDER.map(() => factorColWidth)],
      headerRow: ['Section', ...FACTOR_ORDER.map((key) => SHORT_FACTOR_LABELS[key])],
      bodyRows: data.factorsBySection.map((row) => [
        row.group,
        ...FACTOR_ORDER.map((key) => formatPercent(row.factors.find((f) => f.key === key)?.percentage ?? null)),
      ]),
      fontSize: 8,
      ellipsis: true,
    }) + 24
  );
}

// Page numbers, written after everything else so the total is known. Uses
// PDFKit's buffered-pages mode (set in createDocument).
function drawPageNumbers(doc) {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc
      .fontSize(8)
      .fillColor(GRAY)
      .font('Helvetica')
      .text(`Page ${i + 1} of ${range.count}`, PAGE_MARGIN, 792 - PAGE_MARGIN + 4, {
        width: CONTENT_WIDTH,
        align: 'center',
      });
  }
}

// data: the snapshot from analyticsReport.buildAnalyticsReportData.
// Returns a PDFDocument — the caller pipes it to the HTTP response and
// calls .end(), same contract as buildReportCardPdf.
function buildAnalyticsReportPdf(data) {
  const doc = createDocument();

  let y = drawBrandHeader(doc, data.school, 'ACADEMIC ANALYTICS REPORT');
  y = drawScopeBox(doc, data.appliedFilters, data.generatedAt, data.schoolYearLabel, y);
  y = drawOverview(doc, data, y);
  y = ensureSpace(doc, y, 120);
  y = drawTrends(doc, data, y);
  y = ensureSpace(doc, y, 120);
  y = drawAttendance(doc, data, y);
  y = ensureSpace(doc, y, 120);
  y = drawInterventions(doc, data, y);
  y = ensureSpace(doc, y, 120);
  drawFactors(doc, data, y);

  drawPageNumbers(doc);
  return doc;
}

module.exports = { buildAnalyticsReportPdf };
