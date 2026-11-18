// Shared ExcelJS helpers for every spreadsheet export: a sheet with the
// brand-navy header row frozen in place, and the "Report Info" sheet that
// says what a workbook is scoped to. (Moved out of analyticsReportWorkbook.js
// when the panel's reports needed the same look, so every export from this
// system reads as one family.)
const NAVY_ARGB = 'FF1A3A6B'; // brand navy, in ExcelJS's AARRGGBB form

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

// A null value is MISSING, not zero — written as an empty cell rather than
// a 0 that would silently skew any average calculated over the column.
function orBlank(value) {
  return value == null ? null : value;
}

// Sheet 1 of a report: what it is scoped to. A workbook detached from the
// app has to carry its own provenance. `items`: [{ item, value }].
function addInfoSheet(workbook, items) {
  return addSheet(
    workbook,
    'Report Info',
    [
      { header: 'Item', key: 'item', width: 26 },
      { header: 'Value', key: 'value', width: 48 },
    ],
    items
  );
}

module.exports = { NAVY_ARGB, addSheet, orBlank, addInfoSheet };
