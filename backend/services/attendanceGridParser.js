// Reads a DepEd SF2-shaped sheet: students down the side, one column per
// school day, a mark in each cell.
//
// This is why the attendance import could not reuse the student importer's
// parser. That one reads a flat table — row 1 is headers, one record per row
// — which is the wrong shape entirely. Here the headers run down a column
// and across a row at the same time, and the data is the rectangle between
// them.
//
// Like bulkImportParser, this file knows nothing about what makes attendance
// valid. It only answers "what is literally in the spreadsheet", and it does
// not guess its way past anything important: it proposes where the LRN
// column and the day row are, and the user confirms or corrects them before
// a single cell is interpreted.
const ExcelJS = require('exceljs');
const { normalizeCellValue } = require('../utils/spreadsheetCell');
const { MAX_STUDENT_ROWS, MAX_DATE_COLUMNS, PREVIEW_ROWS } = require('../config/attendanceImport');

const LRN_PATTERN = /^\d{12}$/;

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

// Loads the sheet into a plain array-of-arrays, 1-indexed to match the row
// and column numbers a person sees in Excel, so every message this import
// produces can point at a real cell.
async function readSheet(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error('The uploaded file has no worksheets.');

  const cells = [];
  worksheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const values = [];
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      values[colNumber] = normalizeCellValue(cell.value);
    });
    cells[rowNumber] = values;
  });

  if (cells.length <= 1) throw new Error('The uploaded sheet is empty.');

  return {
    cells,
    rowCount: cells.length - 1,
    columnCount: cells.reduce((widest, row) => Math.max(widest, row ? row.length - 1 : 0), 0),
    preview: cells.slice(0, PREVIEW_ROWS + 1),
    suggestion: suggestAnchors(cells),
  };
}

// Where the grid probably is. Every one of these is a starting point the
// user can override — an SF2's header block varies by division, and a wrong
// guess silently applied would write a whole month of wrong attendance.
function suggestAnchors(cells) {
  return {
    lrnColumn: findLrnColumn(cells),
    dayRow: findDayRow(cells),
    ...findMonthAndYear(cells),
  };
}

// The column holding 12-digit LRNs. Counted rather than first-match, so a
// stray 12-digit number in the header block cannot win against the real
// column.
function findLrnColumn(cells) {
  const hits = new Map();
  for (const row of cells) {
    if (!row) continue;
    row.forEach((value, colNumber) => {
      if (value && LRN_PATTERN.test(String(value).trim())) {
        hits.set(colNumber, (hits.get(colNumber) || 0) + 1);
      }
    });
  }
  if (hits.size === 0) return null;
  return [...hits.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

// The row holding the day-of-month numbers. Looks for the row with the
// longest run of ascending integers in 1..31 — on an SF2 that is the day
// header, and nothing else in the sheet looks like it.
function findDayRow(cells) {
  let best = { row: null, count: 0 };
  cells.forEach((row, rowNumber) => {
    if (!row) return;
    let count = 0;
    let previous = 0;
    row.forEach((value) => {
      const day = Number(value);
      if (Number.isInteger(day) && day >= 1 && day <= 31 && day > previous) {
        count += 1;
        previous = day;
      }
    });
    if (count > best.count) best = { row: rowNumber, count };
  });
  // Three ascending days is the floor for calling it a day header rather
  // than a coincidence.
  return best.count >= 3 ? best.row : null;
}

// SF2 sheets name their month in the header block ("OCTOBER 2026", "Month:
// October"). Read it if it is there; the user confirms it either way.
function findMonthAndYear(cells) {
  for (const row of cells.slice(0, PREVIEW_ROWS + 1)) {
    if (!row) continue;
    for (const value of row) {
      if (!value) continue;
      const text = String(value).toLowerCase();
      const monthIndex = MONTHS.findIndex((m) => text.includes(m));
      if (monthIndex === -1) continue;
      const yearMatch = text.match(/\b(20\d{2})\b/);
      return {
        month: monthIndex + 1,
        year: yearMatch ? Number(yearMatch[1]) : null,
      };
    }
  }
  return { month: null, year: null };
}

// Turns the confirmed anchors into the actual grid: which students, which
// dates, and every distinct mark found with how many times it appears.
//
// Returns marks keyed by the RAW cell text. Deciding that "x" means absent
// is the validator's job once the user has confirmed it — this function
// never interprets a symbol.
function extractMarks(cells, { lrnColumn, dayRow, month, year }) {
  if (!lrnColumn) throw new Error('Tell the import which column holds the LRN.');
  if (!dayRow) throw new Error('Tell the import which row holds the day numbers.');
  if (!month || !year) throw new Error('Tell the import which month and year this sheet covers.');

  // Which columns are days, and what date each one is.
  const dayHeader = cells[dayRow] || [];
  const dateColumns = [];
  dayHeader.forEach((value, colNumber) => {
    const day = Number(value);
    if (!Number.isInteger(day) || day < 1 || day > 31) return;
    const date = toIsoDate(year, month, day);
    // A day number that does not exist in this month (31 April) means the
    // month or the day row is wrong — better to drop the column than to
    // invent a date.
    if (date) dateColumns.push({ colNumber, day, date });
  });

  if (dateColumns.length === 0) {
    throw new Error('No day columns were found on that row. Check the month and the day row.');
  }
  if (dateColumns.length > MAX_DATE_COLUMNS) {
    throw new Error(`That row has ${dateColumns.length} day columns; the import handles up to ${MAX_DATE_COLUMNS}.`);
  }

  // Which rows are students. Anything below the day row with an LRN in the
  // LRN column — which skips the header block, the male/female subheadings
  // and the subtotal rows an SF2 carries, without having to recognise any
  // of them.
  const students = [];
  const symbolCounts = new Map();

  for (let rowNumber = dayRow + 1; rowNumber < cells.length; rowNumber += 1) {
    const row = cells[rowNumber];
    if (!row) continue;
    const lrn = row[lrnColumn] ? String(row[lrnColumn]).trim() : null;
    if (!lrn || !LRN_PATTERN.test(lrn)) continue;

    if (students.length >= MAX_STUDENT_ROWS) {
      throw new Error(`The sheet has more than ${MAX_STUDENT_ROWS} student rows.`);
    }

    const marks = dateColumns.map(({ date, colNumber }) => {
      const raw = row[colNumber];
      const symbol = raw == null || String(raw).trim() === '' ? null : String(raw).trim();
      const key = symbol === null ? '' : symbol.toLowerCase();
      symbolCounts.set(key, (symbolCounts.get(key) || 0) + 1);
      return { date, symbol };
    });

    students.push({ rowNumber, lrn, marks });
  }

  if (students.length === 0) {
    throw new Error('No student rows were found below the day row. Check the LRN column.');
  }

  return {
    students,
    dates: dateColumns.map((c) => c.date),
    symbols: [...symbolCounts.entries()]
      .map(([symbol, count]) => ({ symbol, count }))
      .sort((a, b) => b.count - a.count),
  };
}

// Builds a YYYY-MM-DD string, and returns null when the day does not exist
// in that month. Assembled from parts rather than via `new Date` so the
// result never shifts by a timezone — the same reason config/db.js keeps
// DATE columns as strings.
function toIsoDate(year, month, day) {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > daysInMonth) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

module.exports = { readSheet, extractMarks, toIsoDate };
