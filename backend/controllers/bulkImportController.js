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

// Step 3: insert exactly the rows the user confirmed (normally "every
// currently-valid row," but the frontend may let them deselect individual
// ones first) — invalid rows are never sent here at all, per CLAUDE.md's
// chosen behavior of importing what's valid now rather than blocking the
// whole batch on a few bad rows.
async function commitImport(req, res) {
  const { rows, mapping, fileName, totalRows } = req.body;
  if (!Array.isArray(rows)) {
    return res.status(400).json({ error: 'rows is required.' });
  }

  const { insertedCount, insertedIds, failures } = await bulkImportModel.insertStudentsBatch(rows);

  const effectiveTotal = Number.isInteger(totalRows) ? totalRows : rows.length;
  await bulkImportModel.logImport({
    performedBy: req.user.id,
    fileName: fileName || 'unknown.xlsx',
    totalRows: effectiveTotal,
    successCount: insertedCount,
    errorCount: effectiveTotal - insertedCount,
    columnMapping: mapping || {},
  });

  res.status(201).json({ insertedCount, insertedIds, failures });
}

module.exports = { downloadTemplate, parseFile, validateMapping, commitImport };
