// Request handlers for the bulk student import wizard: download the
// template, upload+parse a file, validate a confirmed column mapping, and
// commit the valid rows. Deliberately stateless across these four steps —
// the frontend holds the parsed row data in memory between steps and sends
// it back on each request — so nothing here needs a staging table or
// temp-file cleanup (see services/bulkImportParser.js's header comment).
const { TEMPLATE_FILENAME, IMPORTABLE_FIELDS } = require('../config/bulkImport');
const { parseWorkbook, suggestMapping, generateTemplateWorkbook } = require('../services/bulkImportParser');
const { validateRows } = require('../services/bulkImportValidator');
const bulkImportModel = require('../models/bulkImportModel');
const { stripUnwritableLearnerStatusFields } = require('../utils/learnerStatusVisibility');

async function downloadTemplate(req, res) {
  const buffer = await generateTemplateWorkbook();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${TEMPLATE_FILENAME}"`);
  res.send(buffer);
}

// Step 1: upload the file, get back its columns/rows plus a best-guess
// mapping (auto-detected synonyms, falling back to whatever mapping the
// last import used for any field the synonyms didn't catch — but only for
// columns that still exist in THIS file; a header from a previous school's
// different file format shouldn't be suggested if it isn't actually here).
async function parseFile(req, res) {
  let parsed;
  try {
    parsed = await parseWorkbook(req.file.buffer);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  const autoDetected = suggestMapping(parsed.columns);
  const lastUsedMapping = await bulkImportModel.getLastMapping();

  const suggestedMapping = {};
  for (const field of IMPORTABLE_FIELDS) {
    const lastUsedColumn = lastUsedMapping?.[field.key];
    const lastUsedStillPresent = lastUsedColumn && parsed.columns.includes(lastUsedColumn);
    suggestedMapping[field.key] = autoDetected[field.key] || (lastUsedStillPresent ? lastUsedColumn : null);
  }

  res.json({
    fileName: req.file.originalname,
    columns: parsed.columns,
    rows: parsed.rows,
    suggestedMapping,
    fields: IMPORTABLE_FIELDS,
  });
}

// Step 2: given the user-confirmed mapping, validate every row.
async function validateMapping(req, res) {
  const { rows, mapping } = req.body;
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'rows is required.' });
  }
  if (!mapping || typeof mapping !== 'object') {
    return res.status(400).json({ error: 'mapping is required.' });
  }

  const requiredFields = IMPORTABLE_FIELDS.filter((f) => f.required);
  const missingRequired = requiredFields.filter((f) => !mapping[f.key]);
  if (missingRequired.length > 0) {
    return res.status(400).json({
      error: `These required fields must be mapped to a column: ${missingRequired.map((f) => f.label).join(', ')}`,
    });
  }

  const [existingLrns, existingEmails, sectionsByName] = await Promise.all([
    bulkImportModel.getExistingLrns(),
    bulkImportModel.getExistingEmails(),
    bulkImportModel.getSectionNameMap(),
  ]);

  const { validRows, invalidRows } = validateRows({ rows, mapping }, { existingLrns, existingEmails, sectionsByName });

  res.json({
    validRows,
    invalidRows,
    summary: { total: rows.length, validCount: validRows.length, invalidCount: invalidRows.length },
  });
}

// Step 3: insert the rows the user confirmed (normally "every currently-valid
// row," but the frontend may let them deselect individual ones first) —
// invalid rows are never sent here at all, per CLAUDE.md's chosen behavior of
// importing what's valid now rather than blocking the whole batch on a few
// bad rows.
//
// Everything is re-validated here rather than taken on trust. Step 2 checked
// a payload the browser then held and could freely alter before sending it
// back, so without this the LRN format, the date-of-birth sanity check, the
// section lookup and the duplicate checks were all enforced only by whatever
// database constraints happened to exist. The attendance importer makes the
// same point in its own header; this is the other half of it.
//
// The learner-status gate is the sharpest reason. is_pwd / is_4ps /
// is_als_graduate are restricted fields — studentController runs every
// single-student write through stripUnwritableLearnerStatus so a caller who
// may not see them cannot set them either. This path used to skip that
// entirely, which made bulk import a way around the restriction.
async function commitImport(req, res) {
  const { rows, mapping, fileName, totalRows } = req.body;
  if (!Array.isArray(rows)) {
    return res.status(400).json({ error: 'rows is required.' });
  }
  if (!mapping || typeof mapping !== 'object') {
    return res.status(400).json({ error: 'mapping is required.' });
  }

  // Re-read the same lookups step 2 used: they are a moment older now, so a
  // row that was unique when previewed may collide with one imported since.
  const [existingLrns, existingEmails, sectionsByName] = await Promise.all([
    bulkImportModel.getExistingLrns(),
    bulkImportModel.getExistingEmails(),
    bulkImportModel.getSectionNameMap(),
  ]);

  const { validRows, invalidRows } = validateRows({ rows, mapping }, { existingLrns, existingEmails, sectionsByName });

  // Whatever the browser sent, only fields this caller is allowed to write
  // survive.
  const writableRows = validRows.map((row) => ({
    ...row,
    data: stripUnwritableLearnerStatusFields(req.user, row.data),
  }));

  const { insertedCount, insertedIds, failures } = await bulkImportModel.insertStudentsBatch(writableRows);

  const effectiveTotal = Number.isInteger(totalRows) ? totalRows : rows.length;
  await bulkImportModel.logImport({
    performedBy: req.user.id,
    fileName: fileName || 'unknown.xlsx',
    totalRows: effectiveTotal,
    successCount: insertedCount,
    errorCount: effectiveTotal - insertedCount,
    columnMapping: mapping || {},
  });

  res.status(201).json({
    insertedCount,
    insertedIds,
    // Rows the server-side re-check rejected, on top of any that failed at
    // insert time — so a row dropped here is reported rather than vanishing.
    failures: [
      ...failures,
      ...invalidRows.map((row) => ({
        rowNumber: row.rowNumber,
        message: row.errors.map((e) => `${e.field}: ${e.message}`).join('; '),
      })),
    ],
  });
}

module.exports = { downloadTemplate, parseFile, validateMapping, commitImport };
