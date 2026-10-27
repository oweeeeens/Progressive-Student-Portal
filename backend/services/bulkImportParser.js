// Turns an uploaded .xlsx Buffer into plain {columns, rows} data, guesses
// which of our fields each uploaded column probably is, and generates the
// downloadable template workbook. Deliberately has zero knowledge of what
// "valid" means for a student record (see bulkImportValidator.js for that)
// — this file only ever deals with "what's literally in the spreadsheet."
const ExcelJS = require('exceljs');
const { IMPORTABLE_FIELDS, COLUMN_SYNONYMS, MAX_ROWS } = require('../config/bulkImport');
// Shared with the attendance grid importer — see utils/spreadsheetCell.js.
const { normalizeCellValue, normalizeHeader } = require('../utils/spreadsheetCell');

// Reads the first worksheet's first row as headers and every subsequent
// non-empty row as data, keyed by those headers. Throws a plain Error (the
// controller turns it into a 400) for anything that makes the file
// unusable — no header row, no data rows, or too many rows to process.
async function parseWorkbook(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error('The uploaded file has no worksheets.');
  }

  const headerRow = worksheet.getRow(1);
  const columns = [];
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const header = normalizeCellValue(cell.value);
    if (header) columns.push({ index: colNumber, header });
  });
  if (columns.length === 0) {
    throw new Error('The first row must contain column headers.');
  }

  const rows = [];
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return; // header, already handled
    if (rows.length >= MAX_ROWS) return; // guarded below with a clear error instead of silently truncating

    const rowData = {};
    let hasAnyValue = false;
    for (const { index, header } of columns) {
      const value = normalizeCellValue(row.getCell(index).value);
      rowData[header] = value;
      if (value) hasAnyValue = true;
    }
    if (hasAnyValue) rows.push({ rowNumber, data: rowData });
  });

  if (rows.length === 0) {
    throw new Error('No data rows were found below the header row.');
  }
  if (worksheet.rowCount - 1 > MAX_ROWS) {
    throw new Error(`This file has more than ${MAX_ROWS} data rows — split it into smaller files and import them separately.`);
  }

  return { columns: columns.map((c) => c.header), rows };
}

// Guesses which uploaded column maps to each of our fields, using
// config/bulkImport.js's synonym list. Exact normalized-text match wins;
// falls back to "uploaded header contains the synonym" (e.g. "Student LRN"
// matches "lrn"). Returns { fieldKey: matchedColumnHeader | null }.
function suggestMapping(columns) {
  const normalizedColumns = columns.map((header) => ({ header, normalized: normalizeHeader(header) }));
  const suggestion = {};

  for (const field of IMPORTABLE_FIELDS) {
    const synonyms = COLUMN_SYNONYMS[field.key] || [];
    const exact = normalizedColumns.find((c) => synonyms.includes(c.normalized));
    if (exact) {
      suggestion[field.key] = exact.header;
      continue;
    }
    const partial = normalizedColumns.find((c) => synonyms.some((syn) => c.normalized.includes(syn)));
    suggestion[field.key] = partial ? partial.header : null;
  }

  return suggestion;
}

// Builds the downloadable template: one header row (our field labels, LRN
// first) styled bold, one example row showing the expected format per
// field, and reasonable column widths. Admins/registrars aren't required to
// use this exact template (see the column-mapping step), but it's the
// easiest starting point for a school with no existing digital roster.
async function generateTemplateWorkbook() {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Students');

  worksheet.columns = IMPORTABLE_FIELDS.map((field) => ({ header: field.label, key: field.key, width: 22 }));
  worksheet.getRow(1).font = { bold: true };

  worksheet.addRow({
    lrn: '123456789012',
    firstName: 'Juan',
    middleName: 'Dela',
    lastName: 'Cruz',
    sex: 'M',
    dateOfBirth: '2009-05-01',
    address: '123 Rizal St., Bacoor City, Cavite',
    email: 'juan.delacruz@example.com',
    guardianName: 'Maria Dela Cruz',
    guardianContactNumber: '09171234567',
    section: 'STEM A',
  });

  return workbook.xlsx.writeBuffer();
}

module.exports = { parseWorkbook, suggestMapping, generateTemplateWorkbook };
