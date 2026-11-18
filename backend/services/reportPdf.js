// PDF exports of the panel's reports, drawn with the same letterhead, scope
// box, table and page numbers as the Analytics report (pdfPrimitives.js), so
// every document from this system reads as one family. Each builder takes the
// data object the page already shows (services/reportBuilder.js) and returns
// a PDFDocument; the caller pipes it to the response and calls .end().
const {
  PAGE_MARGIN,
  createDocument,
  contentWidth,
  ensureSpace,
  drawTable,
  drawBrandHeader,
  drawSectionHeading,
  drawMutedNote,
  drawScopeBox,
  drawPageNumbers,
  formatDate,
} = require('./pdfPrimitives');
const { SCHOOL } = require('./analyticsReport');
const { CLASS_TERM_LABELS } = require('../config/academicTerms');

// The same words the app uses (frontend utils/gradeMatrix.js GRADE_STATUS_LABELS).
const STATUS_LABELS = { submitted: 'Submitted', principal_verified: 'Verified by principal', finalized: 'Finalized', rejected: 'Returned to teacher' };
const runsLabel = (s) => (s.subjectCategory === 'specialized' ? CLASS_TERM_LABELS.full_year : CLASS_TERM_LABELS[s.term] || CLASS_TERM_LABELS.full_year);
const show = (v) => (v === null || v === undefined ? '—' : String(v));

// A short column heading for a subject: its code when it has one.
const subjectLabel = (s) => s.subjectCode || s.subjectName;

// ADVISER GRADESHEET — landscape, one table per grading period.
function buildGradesheetPdf(data) {
  const doc = createDocument({ landscape: true });
  const width = contentWidth(doc);
  let y = drawBrandHeader(doc, SCHOOL, 'ADVISER GRADESHEET — FINALIZED GRADES');
  y = drawScopeBox(
    doc,
    [
      ['Section', `Grade ${data.section.gradeLevel} – ${data.section.name}`],
      ['Strand', data.section.strand || '—'],
      ['School year', data.section.schoolYear || '—'],
      ['Adviser', data.section.adviserName || '—'],
      ['Learners', String(data.studentCount)],
      ['Generated on', formatDate(data.generatedAt)],
    ],
    y
  );
  y = drawMutedNote(doc, 'Only FINALIZED grades (the official record) are shown. — = not finalized yet. Average = the average of the grades finalized so far.', y);

  for (const period of data.periods) {
    y = drawSectionHeading(doc, `${period.periodName} — ${period.finalizedCells} of ${period.cellCount} grades finalized`, y + 6);
    if (period.subjects.length === 0 || period.rows.length === 0) {
      y = drawMutedNote(doc, period.subjects.length === 0 ? 'No subjects run in this grading period.' : 'No learners in this section.', y);
      continue;
    }
    const fixed = [24, 170, 56];
    const each = (width - fixed.reduce((a, b) => a + b, 0)) / period.subjects.length;
    y = drawTable(doc, {
      x: PAGE_MARGIN,
      y,
      columnWidths: [fixed[0], fixed[1], ...period.subjects.map(() => each), fixed[2]],
      headerRow: ['#', 'Learner', ...period.subjects.map(subjectLabel), 'Average'],
      bodyRows: period.rows.map((r, i) => [String(i + 1), r.name, ...r.grades.map(show), show(r.average)]),
      fontSize: 8,
      rowHeight: 18,
      ellipsis: true,
      leftAlign: [0, 1],
    }) + 10;
  }

  // The key to the column headings.
  y = ensureSpace(doc, y, 80);
  y = drawSectionHeading(doc, 'Subjects', y + 4);
  drawTable(doc, {
    x: PAGE_MARGIN,
    y,
    columnWidths: [90, width - 90 - 200 - 110, 200, 110],
    headerRow: ['Code', 'Subject', 'Teacher', 'Runs'],
    bodyRows: data.subjects.map((s) => [s.subjectCode || '—', s.subjectName, s.teacherName || '—', runsLabel(s)]),
    fontSize: 8,
    rowHeight: 18,
    ellipsis: true,
    leftAlign: [0, 1, 2],
  });

  drawPageNumbers(doc);
  return doc;
}

// SUBJECT TEACHER'S CLASS GRADE REPORT — portrait, one table.
function buildClassGradesPdf(data) {
  const doc = createDocument();
  const width = contentWidth(doc);
  const o = data.offering;
  let y = drawBrandHeader(doc, SCHOOL, 'CLASS GRADE REPORT');
  y = drawScopeBox(
    doc,
    [
      ['Subject', o.subjectCode ? `${o.subjectName} (${o.subjectCode})` : o.subjectName],
      ['Section', `Grade ${o.gradeLevel} – ${o.sectionName}`],
      ['School year', o.schoolYear || '—'],
      ['Teacher', o.teacherName || '—'],
      ['Learners enrolled', String(data.studentCount)],
      ['Generated on', formatDate(data.generatedAt)],
    ],
    y
  );
  y = drawMutedNote(doc, 'Each grade with its stage in the approval chain. — = no grade submitted yet. Finalized average = average of finalized grades only.', y);

  if (data.rows.length === 0 || data.periods.length === 0) {
    drawMutedNote(doc, data.periods.length === 0 ? 'This class runs in no grading period.' : 'No learners are enrolled in this class.', y);
  } else {
    const fixed = [24, 190, 70];
    const each = (width - fixed.reduce((a, b) => a + b, 0)) / data.periods.length;
    drawTable(doc, {
      x: PAGE_MARGIN,
      y,
      columnWidths: [fixed[0], fixed[1], ...data.periods.map(() => each), fixed[2]],
      headerRow: ['#', 'Learner', ...data.periods.map((p) => p.periodName), 'Finalized avg.'],
      bodyRows: data.rows.map((r, i) => [
        String(i + 1),
        r.name,
        ...r.cells.map((c) => (c ? `${c.value} · ${STATUS_LABELS[c.status]}` : '—')),
        show(r.finalizedAverage),
      ]),
      fontSize: 8,
      rowHeight: 18,
      ellipsis: true,
      leftAlign: [0, 1],
    });
  }

  drawPageNumbers(doc);
  return doc;
}

module.exports = { buildGradesheetPdf, buildClassGradesPdf, STATUS_LABELS };
