// Shared PDFKit drawing helpers — the brand palette, page geometry, the
// branded letterhead, and the hand-drawn table used by every PDF this app
// produces (the per-student report card and the Analytics report).
//
// Extracted from reportCardPdf.js when the Analytics report needed the same
// letterhead and the same table: two hand-drawn table implementations that
// have to stay visually identical is exactly the kind of duplication that
// drifts, so there is deliberately only one of each here.
//
// PDFKit is a low-level drawing API (no HTML/CSS, no layout engine), which
// is why tables are drawn cell by cell and why callers track their own `y`
// cursor down the page.
const PDFDocument = require('pdfkit');
const path = require('path');

// CLAUDE.md's brand colors — the same navy/gold used everywhere else in the
// app, so a printed document still reads as "this school's system".
const NAVY = '#1A3A6B';
const GOLD = '#F7C600';
const BLACK = '#000000';
const GRAY = '#5B6472';
const LIGHT_GRAY = '#E2E5EA';
const PALE_GOLD = '#FDF3DA'; // emphasis wash — readable in print, unlike the raw brand gold

const PAGE_MARGIN = 40;
const PAGE_HEIGHT = 792; // Letter
const CONTENT_WIDTH = 612 - PAGE_MARGIN * 2; // Letter width minus left+right margins
// Below this y, start a new page rather than running a table off the sheet.
const PAGE_BOTTOM = PAGE_HEIGHT - PAGE_MARGIN - 20;

// The frontend's own logo — the backend has no static-asset folder of its
// own (see CLAUDE.md dev notes), and duplicating the file would just be two
// copies to keep in sync, so this reads it directly from the frontend's
// public/ folder. Acceptable coupling in a monorepo; if the two apps are
// ever split into separate repos, this path becomes the one thing to fix.
const LOGO_PATH = path.join(__dirname, '..', '..', 'frontend', 'public', 'logo.png');

function formatDate(date) {
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function createDocument() {
  return new PDFDocument({ size: 'LETTER', margin: PAGE_MARGIN, bufferPages: true });
}

// Starts a new page if `needed` points of vertical space aren't left on the
// current one. Returns the y cursor to carry on drawing at — unchanged when
// there was room. Absolute-positioned drawing gets no automatic page breaks
// from PDFKit, so every multi-section document has to ask this itself.
function ensureSpace(doc, y, needed) {
  if (y + needed <= PAGE_BOTTOM) return y;
  doc.addPage();
  return PAGE_MARGIN;
}

// A bordered table with a shaded header row. `columnWidths` and each row's
// cell array must be the same length. Returns the y-coordinate just below
// the table so the caller can keep stacking sections underneath it.
//
// Rows that would run past the bottom of the page continue on a new page,
// with the header row repeated there so a split table is still readable.
function drawTable(doc, {
  x,
  y,
  columnWidths,
  headerRow,
  bodyRows,
  rowHeight = 22,
  emphasizeLastRow = false,
  fontSize = 9,
  ellipsis = false,
}) {
  const tableWidth = columnWidths.reduce((a, b) => a + b, 0);

  // Split the body across pages up front, so each chunk is drawn as a
  // self-contained table (own header, own grid, own border).
  const chunks = [];
  let remaining = bodyRows;
  let cursorY = y;
  while (remaining.length > 0 || chunks.length === 0) {
    const availableRows = Math.max(1, Math.floor((PAGE_BOTTOM - cursorY) / rowHeight) - 1);
    chunks.push({ y: cursorY, rows: remaining.slice(0, availableRows) });
    remaining = remaining.slice(availableRows);
    if (remaining.length > 0) {
      doc.addPage();
      cursorY = PAGE_MARGIN;
    }
  }

  let endY = y;
  chunks.forEach((chunk, chunkIndex) => {
    const allRows = [headerRow, ...chunk.rows];
    const isLastChunk = chunkIndex === chunks.length - 1;

    allRows.forEach((row, rowIndex) => {
      const rowY = chunk.y + rowIndex * rowHeight;
      const isHeader = rowIndex === 0;
      const isEmphasized = emphasizeLastRow && isLastChunk && rowIndex === allRows.length - 1;

      if (isHeader) {
        doc.rect(x, rowY, tableWidth, rowHeight).fill(NAVY);
      } else if (isEmphasized) {
        doc.rect(x, rowY, tableWidth, rowHeight).fill(PALE_GOLD);
      }

      let cellX = x;
      row.forEach((cellText, colIndex) => {
        const colWidth = columnWidths[colIndex];
        doc
          .fontSize(fontSize)
          .fillColor(isHeader ? '#FFFFFF' : isEmphasized ? NAVY : BLACK)
          .font(isHeader || isEmphasized ? 'Helvetica-Bold' : 'Helvetica')
          .text(String(cellText), cellX + 4, rowY + rowHeight / 2 - fontSize / 2 - 1, {
            width: colWidth - 8,
            align: colIndex === 0 ? 'left' : 'center',
            ...(ellipsis ? { ellipsis: true, lineBreak: false } : {}),
          });
        cellX += colWidth;
      });
    });

    // Grid lines drawn last, on top of the fills above.
    doc.strokeColor(LIGHT_GRAY).lineWidth(1);
    for (let i = 0; i <= allRows.length; i++) {
      const lineY = chunk.y + i * rowHeight;
      doc.moveTo(x, lineY).lineTo(x + tableWidth, lineY).stroke();
    }
    let lineX = x;
    columnWidths.forEach((w) => {
      doc.moveTo(lineX, chunk.y).lineTo(lineX, chunk.y + allRows.length * rowHeight).stroke();
      lineX += w;
    });
    doc.moveTo(lineX, chunk.y).lineTo(lineX, chunk.y + allRows.length * rowHeight).stroke();
    doc.rect(x, chunk.y, tableWidth, allRows.length * rowHeight).strokeColor(NAVY).lineWidth(1.5).stroke();

    endY = chunk.y + allRows.length * rowHeight;
  });

  return endY;
}

// The branded letterhead every PDF opens with: logo, school name/address, a
// gold rule, then the document's own centred title.
function drawBrandHeader(doc, school, title) {
  let cursorY = PAGE_MARGIN;
  try {
    doc.image(LOGO_PATH, PAGE_MARGIN, cursorY, { width: 56, height: 56 });
  } catch {
    // Logo is a nice-to-have, not a reason to fail the whole document —
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
    .text(title, PAGE_MARGIN, cursorY, { width: CONTENT_WIDTH, align: 'center' });

  return cursorY + 26;
}

// A navy section heading, e.g. "Attendance". Breaks to a new page first if
// the heading would otherwise be stranded at the very bottom.
function drawSectionHeading(doc, text, y, { spaceBelow = 18 } = {}) {
  const cursorY = ensureSpace(doc, y, 60);
  doc.fontSize(11).fillColor(NAVY).font('Helvetica-Bold').text(text, PAGE_MARGIN, cursorY, { width: CONTENT_WIDTH });
  return cursorY + spaceBelow;
}

function drawMutedNote(doc, text, y) {
  doc.fontSize(9).fillColor(GRAY).font('Helvetica-Oblique').text(text, PAGE_MARGIN, y, { width: CONTENT_WIDTH });
  return y + 20;
}

module.exports = {
  NAVY,
  GOLD,
  BLACK,
  GRAY,
  LIGHT_GRAY,
  PALE_GOLD,
  PAGE_MARGIN,
  PAGE_BOTTOM,
  CONTENT_WIDTH,
  createDocument,
  ensureSpace,
  drawTable,
  drawBrandHeader,
  drawSectionHeading,
  drawMutedNote,
  formatDate,
};
