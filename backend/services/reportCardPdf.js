// Draws the report card PDF itself. Deliberately pure presentation: every
// number/string it needs arrives already computed (see
// reportCardController.js for the data-fetching and subject/period
// pivoting) — this file only knows how to lay a page out, not how to query
// the database. PDFKit is a low-level drawing API (no built-in HTML/CSS),
// so tables here are hand-drawn cell by cell via the small drawTable()
// helper below, not a library table component.
const PDFDocument = require('pdfkit');
const path = require('path');

// CLAUDE.md's brand colors — the same navy/gold used everywhere else in the
// app, so a printed report card still reads as "this school's system".
const NAVY = '#1A3A6B';
const GOLD = '#F7C600';
const BLACK = '#000000';
const GRAY = '#5B6472';
const LIGHT_GRAY = '#E2E5EA';

const PAGE_MARGIN = 40;
const CONTENT_WIDTH = 612 - PAGE_MARGIN * 2; // Letter width minus left+right margins

// The frontend's own logo — the backend has no static-asset folder of its
// own (see CLAUDE.md dev notes), and duplicating the file would just be two
// copies to keep in sync, so this reads it directly from the frontend's
// public/ folder. Acceptable coupling in a monorepo; if the two apps are
// ever split into separate repos, this path becomes the one thing to fix.
const LOGO_PATH = path.join(__dirname, '..', '..', 'frontend', 'public', 'logo.png');

function formatDate(date) {
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function formatGrade(value) {
  return value == null ? '—' : Number(value).toFixed(2);
}

// A bordered table with a shaded header row. `columnWidths` and each row's
// cell array must be the same length. Returns the y-coordinate just below
// the table so the caller can keep stacking sections underneath it.
function drawTable(doc, { x, y, columnWidths, headerRow, bodyRows, rowHeight = 22, emphasizeLastRow = false }) {
  const tableWidth = columnWidths.reduce((a, b) => a + b, 0);
  const allRows = [headerRow, ...bodyRows];

  allRows.forEach((row, rowIndex) => {
    const rowY = y + rowIndex * rowHeight;
    const isHeader = rowIndex === 0;
    const isEmphasized = emphasizeLastRow && rowIndex === allRows.length - 1;

    if (isHeader) {
      doc.rect(x, rowY, tableWidth, rowHeight).fill(NAVY);
    } else if (isEmphasized) {
      doc.rect(x, rowY, tableWidth, rowHeight).fill('#FDF3DA'); // pale gold wash, not the raw brand gold — stays readable as printed text
    }

    let cellX = x;
    row.forEach((cellText, colIndex) => {
      const colWidth = columnWidths[colIndex];
      doc
        .fontSize(9)
        .fillColor(isHeader ? '#FFFFFF' : isEmphasized ? NAVY : BLACK)
        .font(isHeader || isEmphasized ? 'Helvetica-Bold' : 'Helvetica')
        .text(String(cellText), cellX + 4, rowY + rowHeight / 2 - 5, {
          width: colWidth - 8,
          align: colIndex === 0 ? 'left' : 'center',
        });
      cellX += colWidth;
    });
  });

  // Grid lines drawn last, on top of the fills above.
  doc.strokeColor(LIGHT_GRAY).lineWidth(1);
  for (let i = 0; i <= allRows.length; i++) {
    const lineY = y + i * rowHeight;
    doc.moveTo(x, lineY).lineTo(x + tableWidth, lineY).stroke();
  }
  let lineX = x;
  columnWidths.forEach((w) => {
    doc.moveTo(lineX, y).lineTo(lineX, y + allRows.length * rowHeight).stroke();
    lineX += w;
  });
  doc.moveTo(lineX, y).lineTo(lineX, y + allRows.length * rowHeight).stroke();
  doc.rect(x, y, tableWidth, allRows.length * rowHeight).strokeColor(NAVY).lineWidth(1.5).stroke();

  return y + allRows.length * rowHeight;
}

function drawHeader(doc, school) {
  let cursorY = PAGE_MARGIN;
  try {
    doc.image(LOGO_PATH, PAGE_MARGIN, cursorY, { width: 56, height: 56 });
  } catch {
    // Logo is a nice-to-have, not a reason to fail the whole report —
    // carry on without it if the file isn't reachable for any reason.
  }

  doc
    .fontSize(15)
    .fillColor(NAVY)
    .font('Helvetica-Bold')
    .text(school.name, PAGE_MARGIN + 68, cursorY + 2, { width: CONTENT_WIDTH - 68 });
  doc
    .fontSize(9)
    .fillColor(GRAY)
    .font('Helvetica')
    .text(school.address, PAGE_MARGIN + 68, cursorY + 22, { width: CONTENT_WIDTH - 68 });

  cursorY += 64;
  doc.rect(PAGE_MARGIN, cursorY, CONTENT_WIDTH, 3).fill(GOLD);
  cursorY += 14;

  doc
    .fontSize(13)
    .fillColor(BLACK)
    .font('Helvetica-Bold')
    .text('STUDENT REPORT CARD', PAGE_MARGIN, cursorY, { width: CONTENT_WIDTH, align: 'center' });

  return cursorY + 26;
}

function drawStudentInfo(doc, student, schoolYearLabel, y) {
  const boxHeight = 70;
  doc.rect(PAGE_MARGIN, y, CONTENT_WIDTH, boxHeight).strokeColor(NAVY).lineWidth(1).stroke();

  const colX = [PAGE_MARGIN + 12, PAGE_MARGIN + CONTENT_WIDTH / 2 + 12];
  const rows = [
    ['Name', `${student.last_name}, ${student.first_name}${student.middle_name ? ' ' + student.middle_name : ''}`],
    ['LRN', student.lrn],
    ['Grade & Section', student.section_name ? `Grade ${student.grade_level} - ${student.section_name}` : '—'],
    ['Strand', student.strand || '—'],
    ['School Year', schoolYearLabel || '—'],
  ];

  rows.forEach((row, i) => {
    const colIndex = i % 2;
    const rowIndex = Math.floor(i / 2);
    const rowY = y + 10 + rowIndex * 20;
    doc
      .fontSize(8)
      .fillColor(GRAY)
      .font('Helvetica')
      .text(row[0].toUpperCase(), colX[colIndex], rowY, { width: CONTENT_WIDTH / 2 - 24 });
    doc
      .fontSize(10)
      .fillColor(BLACK)
      .font('Helvetica-Bold')
      .text(row[1], colX[colIndex], rowY + 10, { width: CONTENT_WIDTH / 2 - 24 });
  });

  return y + boxHeight + 20;
}

// periods: [{ name, sequenceNumber }], ordered. subjects: [{ name, values: [grade|null, ...], average }]
// aligned 1:1 with `periods`. generalAverage: number | null.
function drawGradesSection(doc, periods, subjects, generalAverage, y) {
  doc
    .fontSize(11)
    .fillColor(NAVY)
    .font('Helvetica-Bold')
    .text('Grades', PAGE_MARGIN, y);
  y += 18;

  if (periods.length === 0) {
    doc
      .fontSize(9)
      .fillColor(GRAY)
      .font('Helvetica-Oblique')
      .text('No finalized grades on record yet for this school year.', PAGE_MARGIN, y);
    return y + 20;
  }

  const subjectColWidth = 180;
  const remaining = CONTENT_WIDTH - subjectColWidth;
  const periodColWidth = remaining / (periods.length + 1); // +1 for the trailing Average column
  const columnWidths = [subjectColWidth, ...periods.map(() => periodColWidth), periodColWidth];

  const headerRow = ['Subject', ...periods.map((p) => p.name), 'Average'];
  const bodyRows = subjects.map((s) => [s.name, ...s.values.map(formatGrade), formatGrade(s.average)]);
  bodyRows.push([
    'General Average',
    ...periods.map((p, i) => {
      const periodValues = subjects.map((s) => s.values[i]).filter((v) => v != null);
      const periodAvg = periodValues.length ? periodValues.reduce((a, b) => a + b, 0) / periodValues.length : null;
      return formatGrade(periodAvg);
    }),
    formatGrade(generalAverage),
  ]);

  return (
    drawTable(doc, {
      x: PAGE_MARGIN,
      y,
      columnWidths,
      headerRow,
      bodyRows,
      emphasizeLastRow: true,
    }) + 20
  );
}

function drawAttendanceSection(doc, attendance, y) {
  doc
    .fontSize(11)
    .fillColor(NAVY)
    .font('Helvetica-Bold')
    .text('Attendance Summary (Daily / SF2)', PAGE_MARGIN, y);
  y += 18;

  const totalDays = attendance.present + attendance.absent + attendance.late + attendance.excused;
  const columnWidths = Array(5).fill(CONTENT_WIDTH / 5);
  const headerRow = ['Present', 'Absent', 'Late', 'Excused', 'Total Days'];
  const bodyRows = [[attendance.present, attendance.absent, attendance.late, attendance.excused, totalDays]];

  return drawTable(doc, { x: PAGE_MARGIN, y, columnWidths, headerRow, bodyRows }) + 30;
}

function drawFooter(doc, adviserName, generatedAt, y) {
  const lineWidth = 200;
  const leftX = PAGE_MARGIN;
  const rightX = PAGE_MARGIN + CONTENT_WIDTH - lineWidth;

  doc.strokeColor(BLACK).lineWidth(1);
  doc.moveTo(leftX, y).lineTo(leftX + lineWidth, y).stroke();
  doc.moveTo(rightX, y).lineTo(rightX + lineWidth, y).stroke();

  doc
    .fontSize(9)
    .fillColor(BLACK)
    .font('Helvetica-Bold')
    .text(adviserName || 'Adviser not yet assigned', leftX, y + 4, { width: lineWidth, align: 'center' });
  doc
    .fontSize(8)
    .fillColor(GRAY)
    .font('Helvetica')
    .text('Prepared by (Adviser)', leftX, y + 18, { width: lineWidth, align: 'center' });

  doc
    .fontSize(9)
    .fillColor(BLACK)
    .font('Helvetica-Bold')
    .text(formatDate(generatedAt), rightX, y + 4, { width: lineWidth, align: 'center' });
  doc
    .fontSize(8)
    .fillColor(GRAY)
    .font('Helvetica')
    .text('Date Generated', rightX, y + 18, { width: lineWidth, align: 'center' });
}

// data: { school: {name, address}, student, schoolYearLabel, periods,
//         subjects, generalAverage, attendance, adviserName, generatedAt }
// Returns a PDFDocument — caller pipes it to the HTTP response (or a file)
// and calls .end() once done.
function buildReportCardPdf(data) {
  const doc = new PDFDocument({ size: 'LETTER', margin: PAGE_MARGIN, bufferPages: true });

  let y = drawHeader(doc, data.school);
  y = drawStudentInfo(doc, data.student, data.schoolYearLabel, y);
  y = drawGradesSection(doc, data.periods, data.subjects, data.generalAverage, y);
  y = drawAttendanceSection(doc, data.attendance, y);
  drawFooter(doc, data.adviserName, data.generatedAt, y);

  return doc;
}

module.exports = { buildReportCardPdf };
