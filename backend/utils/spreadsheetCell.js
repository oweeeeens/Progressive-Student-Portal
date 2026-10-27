// Reading a cell out of an .xlsx, independent of what the sheet is for.
//
// This lived inside services/bulkImportParser.js, which is about student
// records. The attendance grid importer needs exactly the same flattening,
// and the alternative — one importer reaching into the other's service — is
// how two copies of a subtle function start to drift.

// A cell's .value can be a plain string/number, a JS Date (Excel date
// cells), a formula result object ({result: ...}), rich text
// ({richText: [{text}, ...]}), or a hyperlink object ({text, hyperlink}).
// Flattening all of these to a plain string (or null) here means nothing
// downstream ever has to know exceljs's cell-value shape.
function normalizeCellValue(value) {
  if (value == null) return null;
  if (value instanceof Date) {
    // Stored as a date-only value for our purposes — see config/db.js's own
    // comment on why a DATE column should never round-trip through a JS
    // Date/timezone.
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text).join('');
    if ('result' in value) return normalizeCellValue(value.result);
    if ('text' in value) return String(value.text);
    return null;
  }
  return String(value).trim();
}

function normalizeHeader(text) {
  return String(text || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

module.exports = { normalizeCellValue, normalizeHeader };
