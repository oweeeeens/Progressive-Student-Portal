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

const SEX_LABELS = { M: 'Male', F: 'Female' };
const titleCase = (text) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : '—');

// The filters a list was made with, as scope-box rows ("All" when unset).
function filterRows(data) {
  const sectionName = data.filters.sectionId ? data.options.sections.find((s) => s.id === data.filters.sectionId)?.name : null;
  return [
    ['Grade level', data.filters.gradeLevel ? `Grade ${data.filters.gradeLevel}` : 'All'],
    ['Section', sectionName || 'All'],
    ['Strand', data.filters.strand || 'All'],
    ['Enrollment status', data.filters.status === 'all' ? 'All statuses' : titleCase(data.filters.status)],
  ];
}

// ENROLLED STUDENT LIST — portrait: the count per section, then the list.
function buildEnrolledListPdf(data) {
  const doc = createDocument();
  const width = contentWidth(doc);
  let y = drawBrandHeader(doc, SCHOOL, 'ENROLLED STUDENT LIST');
  y = drawScopeBox(
    doc,
    [
      ...filterRows(data),
      ['School year', data.schoolYear || '—'],
      ['Learners', `${data.total} (${data.bySex.M} male, ${data.bySex.F} female)`],
      ['Generated on', formatDate(data.generatedAt)],
    ],
    y
  );

  y = drawSectionHeading(doc, 'Learners per section', y);
  y = drawTable(doc, {
    x: PAGE_MARGIN,
    y,
    columnWidths: [width - 240, 120, 120],
    headerRow: ['Section', 'Strand', 'Learners'],
    bodyRows: [
      ...data.bySection.map((s) => [`Grade ${s.gradeLevel} – ${s.sectionName}`, s.strand || '—', String(s.count)]),
      ['Total', '', String(data.total)],
    ],
    emphasizeLastRow: true,
    fontSize: 9,
    rowHeight: 20,
  }) + 16;

  y = drawSectionHeading(doc, 'Learners', y);
  if (data.students.length === 0) {
    drawMutedNote(doc, 'No learner matches these filters.', y);
  } else {
    drawTable(doc, {
      x: PAGE_MARGIN,
      y,
      columnWidths: [24, 82, width - 24 - 82 - 50 - 120 - 60 - 70, 50, 120, 60, 70],
      headerRow: ['#', 'LRN', 'Learner', 'Sex', 'Grade & section', 'Strand', 'Status'],
      bodyRows: data.students.map((s, i) => [
        String(i + 1),
        s.lrn,
        s.name,
        SEX_LABELS[s.sex] || '—',
        `${s.gradeLevel} – ${s.sectionName}`,
        s.strand || '—',
        titleCase(s.enrollmentStatus),
      ]),
      fontSize: 8,
      rowHeight: 18,
      ellipsis: true,
      leftAlign: [0, 1, 2, 4],
    });
  }
  drawPageNumbers(doc);
  return doc;
}

module.exports = { buildGradesheetPdf, buildClassGradesPdf, buildEnrolledListPdf, STATUS_LABELS, SEX_LABELS, filterRows };
