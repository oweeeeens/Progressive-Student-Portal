// The Student Registration Form as a PDF (2026-11-26, at the group's request)
// — the same data the on-screen form shows (studentController.loadRegistration),
// drawn with the shared letterhead, table and page numbers (pdfPrimitives.js),
// so it reads as one family with the reports. Ends with signature lines,
// because a printed registration form is signed by the learner, a parent or
// guardian, and the registrar.
//
// The learner-status flags (PWD / 4Ps / ALS) are never on it: the loader
// does not carry them, exactly as on the page.
const {
  PAGE_MARGIN,
  NAVY,
  createDocument,
  contentWidth,
  ensureSpace,
  drawTable,
  drawBrandHeader,
  drawSectionHeading,
  drawMutedNote,
  drawPageNumbers,
  formatDate,
} = require('./pdfPrimitives');
const { SCHOOL } = require('./analyticsReport');
const { CLASS_TERM_LABELS, SUBJECT_CATEGORY_LABELS } = require('../config/academicTerms');

const SEX_LABELS = { M: 'Male', F: 'Female' };
const GRAY = '#5B6472';
const show = (v) => (v === null || v === undefined || v === '' ? '—' : String(v));
const titleCase = (text) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : '—');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// "2009-05-01" → "May 1, 2009". Read from the string's own parts: a DATE
// column comes back as plain YYYY-MM-DD (config/db.js), and turning it into
// a Date would shift it by the server's timezone.
function formatBirthDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  if (!m) return show(value);
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

// What "Runs" says for a class: the whole year, or one term. Shortened to
// fit the column ("Whole year", "Term 2").
function runsLabel(s) {
  const label = s.subject_category === 'specialized' ? CLASS_TERM_LABELS.full_year : CLASS_TERM_LABELS[s.term] || CLASS_TERM_LABELS.full_year;
  return label.replace(' school year', ' year').replace(' only', '');
}

// Learner name as on the form: "LAST, First Middle".
const formName = (r) => `${r.last_name}, ${[r.first_name, r.middle_name].filter(Boolean).join(' ')}`;

// A form's fields in two columns, label over value, in a ruled box. The
// shared drawScopeBox is sized for a report's one-line summary; a form a
// family reads on paper needs more air between rows, so it has its own.
function drawFieldGrid(doc, rows, y) {
  const width = contentWidth(doc);
  const ROW = 30;
  const boxHeight = 12 + Math.ceil(rows.length / 2) * ROW;
  doc.rect(PAGE_MARGIN, y, width, boxHeight).strokeColor(NAVY).lineWidth(1).stroke();
  const colX = [PAGE_MARGIN + 12, PAGE_MARGIN + width / 2 + 12];
  rows.forEach(([label, value], i) => {
    const x = colX[i % 2];
    const rowY = y + 9 + Math.floor(i / 2) * ROW;
    doc.fontSize(7.5).fillColor(GRAY).font('Helvetica').text(String(label).toUpperCase(), x, rowY, { width: width / 2 - 24 });
    doc.fontSize(10).fillColor('#000000').font('Helvetica-Bold').text(String(value), x, rowY + 11, { width: width / 2 - 24, ellipsis: true, lineBreak: false });
  });
  return y + boxHeight + 16;
}

// Builds the form; returns a PDFDocument (the caller pipes it and calls end()).
function buildRegistrationPdf(registration, generatedAt = new Date()) {
  const r = registration;
  const doc = createDocument();
  const width = contentWidth(doc);
  let y = drawBrandHeader(doc, SCHOOL, `STUDENT REGISTRATION FORM — SY ${show(r.school_year)}`);

  y = drawSectionHeading(doc, 'Learner information', y);
  y = drawFieldGrid(
    doc,
    [
      ['Name (last, first middle)', formName(r)],
      ['LRN', show(r.lrn)],
      ['Sex', SEX_LABELS[r.sex] || '—'],
      ['Date of birth', formatBirthDate(r.date_of_birth)],
      ['Address', show(r.address)],
      ['Personal email', show(r.email)],
    ],
    y
  );

  y = drawSectionHeading(doc, 'Enrollment', y);
  y = drawFieldGrid(
    doc,
    [
      ['School year', show(r.school_year)],
      ['Grade level', r.grade_level ? `Grade ${r.grade_level}` : '—'],
      ['Section', show(r.section_name)],
      ['Strand', show(r.strand)],
      ['Adviser', show(r.adviser_name)],
      ['Enrollment status', titleCase(r.enrollment_status)],
    ],
    y
  );

  y = drawSectionHeading(doc, 'Parent / guardian', y);
  y = drawFieldGrid(
    doc,
    [
      ['Name', show(r.guardian_name)],
      ['Contact number', show(r.guardian_contact_number)],
    ],
    y
  );

  y = drawSectionHeading(doc, `Enrolled subjects (${r.subjects.length})`, y);
  if (r.subjects.length === 0) {
    y = drawMutedNote(doc, 'No enrolled subjects for this school year yet.', y) + 6;
  } else {
    // The subject name gets the slack: it is the longest text here.
    const fixed = [20, 64, 62, 118, 66];
    y =
      drawTable(doc, {
        x: PAGE_MARGIN,
        y,
        columnWidths: [fixed[0], width - fixed.reduce((a, b) => a + b, 0), ...fixed.slice(1)],
        headerRow: ['#', 'Subject', 'Code', 'Type', 'Teacher', 'Runs'],
        bodyRows: r.subjects.map((s, i) => [
          String(i + 1),
          s.subject_name,
          show(s.subject_code),
          SUBJECT_CATEGORY_LABELS[s.subject_category] || titleCase(s.subject_category),
          show(s.teacher_name),
          runsLabel(s),
        ]),
        fontSize: 8.5,
        rowHeight: 20,
        ellipsis: true,
        leftAlign: [0, 1, 4],
      }) + 18;
  }

  // Signature lines — three across, the role under each, one shared note.
  y = ensureSpace(doc, y, 100);
  y += 36;
  const gap = 24;
  const lineWidth = (width - gap * 2) / 3;
  ['Learner', 'Parent / guardian', 'Registrar'].forEach((label, i) => {
    const x = PAGE_MARGIN + i * (lineWidth + gap);
    doc.moveTo(x, y).lineTo(x + lineWidth, y).strokeColor(NAVY).lineWidth(0.8).stroke();
    doc.fontSize(9).fillColor('#000000').font('Helvetica-Bold').text(label, x, y + 4, { width: lineWidth, align: 'center' });
  });
  y += 18;
  doc.fontSize(7.5).fillColor(GRAY).font('Helvetica').text('Signature over printed name', PAGE_MARGIN, y, { width, align: 'center' });
  y += 22;
  drawMutedNote(doc, `Generated on ${formatDate(generatedAt)} from the school's student records. Learner status details are not printed on this form.`, y);

  drawPageNumbers(doc);
  return doc;
}

module.exports = { buildRegistrationPdf, formatBirthDate };
