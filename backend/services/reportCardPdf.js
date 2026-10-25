// Draws the report card PDF itself. Deliberately pure presentation: every
// number/string it needs arrives already computed (see
// reportCardController.js for the data-fetching and subject/period
// pivoting) — this file only knows how to lay a page out, not how to query
// the database. The brand palette, the letterhead and the hand-drawn table
// live in pdfPrimitives.js, shared with the Analytics report so both
// documents look like they came from the same system.
const {
  NAVY,
  BLACK,
  GRAY,
  PAGE_MARGIN,
  CONTENT_WIDTH,
  createDocument,
  drawTable,
  drawBrandHeader,
  formatDate,
} = require('./pdfPrimitives');

function formatGrade(value) {
  return value == null ? '—' : Number(value).toFixed(2);
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
  const doc = createDocument();

  let y = drawBrandHeader(doc, data.school, 'STUDENT REPORT CARD');
  y = drawStudentInfo(doc, data.student, data.schoolYearLabel, y);
  y = drawGradesSection(doc, data.periods, data.subjects, data.generalAverage, y);
  y = drawAttendanceSection(doc, data.attendance, y);
  drawFooter(doc, data.adviserName, data.generatedAt, y);

  return doc;
}

module.exports = { buildReportCardPdf };
