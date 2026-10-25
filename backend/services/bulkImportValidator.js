// Applies a confirmed column mapping to parsed spreadsheet rows and
// validates each one, field by field. Deliberately pure (no database
// access of its own) — existing LRNs/emails and the section name->id
// lookup are all pre-fetched by the caller (bulkImportController.js, via
// bulkImportModel.js) and passed in, the same pure-calculator-vs-DB-facing
// split used throughout this app (see services/riskCalculator.js vs
// services/riskEngine.js). That split is what makes this file easy to
// reason about and test without a database.
const { IMPORTABLE_FIELDS } = require('../config/bulkImport');
const { EMAIL_PATTERN, LRN_PATTERN } = require('../utils/studentValidation');

// Real-world spreadsheets rarely write sex as a bare "M"/"F" consistently —
// accept the common variants and normalize to what the database expects.
const SEX_ALIASES = { m: 'M', male: 'M', f: 'F', female: 'F' };

// Spreadsheet booleans are written every imaginable way. Anything not
// recognised is treated as FALSE rather than rejected: these are optional
// reporting flags, and failing an entire student row because someone typed
// "n/a" in a PWD column would block the import over a field the school can
// correct afterwards on the student's own page.
const TRUE_VALUES = new Set(['yes', 'y', 'true', 't', '1', 'oo']);

function parseBoolean(value) {
  if (value === true) return true;
  if (value === null || value === undefined || value === '') return false;
  return TRUE_VALUES.has(String(value).trim().toLowerCase());
}

// The free-text "Last School Attended" match that pre-fills isAlsGraduate.
// Substring, case-insensitive, word-bounded so "Alsace High School" or a
// surname containing "als" doesn't trip it — but still only a guess, which
// is why the caller marks these rows for confirmation.
const ALS_PATTERN = /\bALS\b|alternative learning system/i;

function detectAlsGraduate(lastSchoolAttended) {
  if (!lastSchoolAttended) return false;
  return ALS_PATTERN.test(String(lastSchoolAttended));
}

function normalizeSex(value) {
  if (!value) return { value: null, valid: true };
  const alias = SEX_ALIASES[String(value).trim().toLowerCase()];
  return alias ? { value: alias, valid: true } : { value: String(value).trim(), valid: false };
}

// Accepts an already-ISO date string as-is (the common case — see
// bulkImportParser.js's normalizeCellValue, which converts native Excel
// date cells to YYYY-MM-DD before this ever runs); otherwise tries to parse
// whatever text the cell actually contained (e.g. a date typed as plain
// text in a different format) and reformats it.
function normalizeDateOfBirth(value) {
  if (!value) return { value: null, valid: false };
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = new Date(`${value}T00:00:00Z`);
    return { value, valid: !Number.isNaN(parsed.getTime()) && parsed <= new Date() };
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed > new Date()) {
    return { value, valid: false };
  }
  return { value: parsed.toISOString().slice(0, 10), valid: true };
}

// Maps { columnHeader: cellValue } (one parsed row) to { fieldKey: cellValue }
// using the confirmed mapping ({ fieldKey: columnHeader | null }). A field
// left unmapped (or whose mapped column is empty for this row) comes
// through as null.
function applyMapping(rowData, mapping) {
  const mapped = {};
  for (const field of IMPORTABLE_FIELDS) {
    const header = mapping[field.key];
    mapped[field.key] = header ? rowData[header] ?? null : null;
  }
  return mapped;
}

// Validates one already-mapped row in isolation (no duplicate checking —
// that requires seeing every row together, handled by validateRows below).
// Returns { data: cleanedData, errors: [{field, message}] } — cleanedData
// has sex/dateOfBirth normalized and is what gets inserted if there are no
// errors; section is resolved to sectionId here too.
function validateMappedRow(mapped, sectionsByName) {
  const needsConfirmation = [];
  const errors = [];
  const data = { ...mapped };

  if (!data.lrn || !LRN_PATTERN.test(String(data.lrn).trim())) {
    errors.push({ field: 'lrn', message: 'LRN must be exactly 12 digits.' });
  } else {
    data.lrn = String(data.lrn).trim();
  }

  if (!data.firstName || !String(data.firstName).trim()) {
    errors.push({ field: 'firstName', message: 'First name is required.' });
  } else {
    data.firstName = String(data.firstName).trim();
  }

  if (!data.lastName || !String(data.lastName).trim()) {
    errors.push({ field: 'lastName', message: 'Last name is required.' });
  } else {
    data.lastName = String(data.lastName).trim();
  }

  if (data.middleName) data.middleName = String(data.middleName).trim();

  const dob = normalizeDateOfBirth(data.dateOfBirth);
  if (!dob.valid) {
    errors.push({ field: 'dateOfBirth', message: 'Date of birth must be a valid past date.' });
  }
  data.dateOfBirth = dob.value;

  const sex = normalizeSex(data.sex);
  if (!sex.valid) {
    errors.push({ field: 'sex', message: `Sex must be M/F (or Male/Female) — got "${sex.value}".` });
  }
  data.sex = sex.value;

  if (data.email) {
    data.email = String(data.email).trim();
    if (!EMAIL_PATTERN.test(data.email)) {
      errors.push({ field: 'email', message: 'Email does not look like a valid email address.' });
    }
  }

  // Reporting flags. isAlsGraduate takes an explicitly mapped column if
  // there is one; otherwise it's inferred from the last-school text, and
  // `needsConfirmation` tells the preview to ask rather than assume.
  data.isPwd = parseBoolean(data.isPwd);
  data.is4ps = parseBoolean(data.is4ps);

  const alsColumnMapped = mapped.isAlsGraduate !== null && mapped.isAlsGraduate !== undefined && mapped.isAlsGraduate !== '';
  if (alsColumnMapped) {
    data.isAlsGraduate = parseBoolean(mapped.isAlsGraduate);
  } else {
    data.isAlsGraduate = detectAlsGraduate(mapped.lastSchoolAttended);
    if (data.isAlsGraduate) {
      needsConfirmation.push({
        field: 'isAlsGraduate',
        message: `Detected "ALS" in last school attended ("${String(mapped.lastSchoolAttended).trim()}") — confirm this learner is an ALS graduate.`,
      });
    }
  }
  // Never stored: it exists only to drive the detection above.
  delete data.lastSchoolAttended;

  if (data.address) data.address = String(data.address).trim();
  if (data.guardianName) data.guardianName = String(data.guardianName).trim();
  if (data.guardianContactNumber) data.guardianContactNumber = String(data.guardianContactNumber).trim();

  if (data.section) {
    const match = sectionsByName.get(String(data.section).trim().toLowerCase());
    if (!match) {
      errors.push({ field: 'section', message: `Section "${data.section}" was not found.` });
      data.currentSectionId = null;
    } else {
      data.currentSectionId = match.id;
    }
  } else {
    data.currentSectionId = null;
  }
  delete data.section;

  return { data, errors, needsConfirmation };
}

// The main entry point: validates every row, including the cross-row
// duplicate checks that validateMappedRow alone can't do (an LRN appearing
// twice in the same file, or one that already exists in the database).
// `existingLrns`/`existingEmails` are Sets of values already in the
// database (pre-fetched once by the caller, not per row); `sectionsByName`
// is a Map of lowercased section name -> {id, name}.
function validateRows({ rows, mapping }, { existingLrns, existingEmails, sectionsByName }) {
  const validRows = [];
  const invalidRows = [];
  const seenLrns = new Map(); // lrn -> first rowNumber that used it
  const seenEmails = new Map();

  for (const { rowNumber, data: rawData } of rows) {
    const mapped = applyMapping(rawData, mapping);
    const { data, errors, needsConfirmation } = validateMappedRow(mapped, sectionsByName);

    if (data.lrn) {
      if (existingLrns.has(data.lrn)) {
        errors.push({ field: 'lrn', message: 'A student with this LRN already exists.' });
      } else if (seenLrns.has(data.lrn)) {
        errors.push({ field: 'lrn', message: `Duplicate LRN — also used by row ${seenLrns.get(data.lrn)} in this file.` });
      } else {
        seenLrns.set(data.lrn, rowNumber);
      }
    }

    if (data.email) {
      if (existingEmails.has(data.email.toLowerCase())) {
        errors.push({ field: 'email', message: 'A student with this email already exists.' });
      } else if (seenEmails.has(data.email.toLowerCase())) {
        errors.push({ field: 'email', message: `Duplicate email — also used by row ${seenEmails.get(data.email.toLowerCase())} in this file.` });
      } else {
        seenEmails.set(data.email.toLowerCase(), rowNumber);
      }
    }

    if (errors.length > 0) {
      invalidRows.push({ rowNumber, data, errors });
    } else {
      // A row needing confirmation is still VALID and still imports — the
      // flag travels with it so the preview can surface it for a quick
      // yes/no rather than blocking the whole file on a guess.
      validRows.push({ rowNumber, data, needsConfirmation });
    }
  }

  return { validRows, invalidRows };
}

module.exports = { applyMapping, validateMappedRow, validateRows };
