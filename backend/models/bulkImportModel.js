// DB-facing half of bulk import: what already exists (for duplicate
// checking and section-name resolution), writing the actual student rows,
// and the audit trail (CLAUDE.md: "log who performed the bulk import and
// when").
const { pool } = require('../config/db');
const studentModel = require('./studentModel');
const sectionModel = require('./sectionModel');

async function getExistingLrns() {
  const result = await pool.query('SELECT lrn FROM students');
  return new Set(result.rows.map((r) => r.lrn));
}

async function getExistingEmails() {
  const result = await pool.query('SELECT email FROM students WHERE email IS NOT NULL');
  return new Set(result.rows.map((r) => r.email.toLowerCase()));
}

// Reuses sectionModel.listSections (active sections only, current school
// year first) so "what counts as a valid section to import into" is the
// exact same rule used everywhere else a section picker appears — not a
// second, possibly-drifting definition.
async function getSectionNameMap() {
  const sections = await sectionModel.listSections();
  const map = new Map();
  for (const section of sections) {
    map.set(section.name.toLowerCase(), { id: section.id, name: section.name });
  }
  return map;
}

// Inserts every validated row independently (not one all-or-nothing
// transaction) — pre-validation already screened out duplicates, so a
// per-row failure here is an unexpected edge case (e.g. a genuine race
// against another import), not the common path, and shouldn't be allowed
// to roll back everything else in the batch.
async function insertStudentsBatch(validRows) {
  let insertedCount = 0;
  const insertedIds = [];
  const failures = [];

  for (const { rowNumber, data } of validRows) {
    try {
      const id = await studentModel.createStudent(data);
      insertedCount += 1;
      // Only rows with an email can ever get a portal account — collecting
      // just these up front lets the result screen offer "create accounts
      // for these" without the caller having to re-check who has one.
      if (data.email) insertedIds.push(id);
    } catch (error) {
      const message =
        error.code === '23505'
          ? 'A student with this LRN or email was just created by another request.'
          : 'Unexpected error while saving this row.';
      failures.push({ rowNumber, message });
    }
  }

  return { insertedCount, insertedIds, failures };
}

// `importType` says which importer wrote the row ('students', or one of the
// attendance grid importer's two modes). It defaults to 'students' so the
// original caller in bulkImportController did not have to change.
async function logImport({
  performedBy,
  fileName,
  totalRows,
  successCount,
  errorCount,
  columnMapping,
  importType = 'students',
  client,
}) {
  // The attendance importer passes its transaction client, because the
  // attendance rows it writes reference this row's id — the audit record and
  // the data it describes have to land together or not at all. The student
  // importer passes nothing and runs on the shared pool as before.
  const runner = client || pool;
  const result = await runner.query(
    `INSERT INTO bulk_imports (performed_by, file_name, total_rows, success_count, error_count, column_mapping, import_type)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, created_at`,
    [performedBy, fileName, totalRows, successCount, errorCount, JSON.stringify(columnMapping), importType]
  );
  return result.rows[0];
}

// Fills in an audit row's counts once the work it describes has finished.
// Needed because the attendance importer has to insert its row BEFORE the
// writes (they reference its id) but only knows how many rows succeeded
// afterwards.
async function updateImportCounts(id, { successCount, errorCount }, client) {
  const runner = client || pool;
  await runner.query(
    `UPDATE bulk_imports
     SET success_count = COALESCE($2, success_count), error_count = COALESCE($3, error_count)
     WHERE id = $1`,
    [id, successCount ?? null, errorCount ?? null]
  );
}

// The most recent import's column mapping — used as the "remember my last
// mapping" default on the mapping screen (see bulkImportController.parseFile).
// Not scoped per-user: this app has exactly one school, so "whatever the
// last import at this school used" is the same thing as "whatever this
// admin/registrar used last," and sharing it means a second staff member
// doing the next import also benefits from the first one's mapping.
//
// Filtered by import_type: the attendance grid importer logs to this same
// table but its mapping is symbol -> status, nothing like a column mapping,
// so an attendance row must never be handed back here as a default.
async function getLastMapping(importType = 'students') {
  const result = await pool.query(
    'SELECT column_mapping FROM bulk_imports WHERE import_type = $1 ORDER BY created_at DESC LIMIT 1',
    [importType]
  );
  return result.rows[0]?.column_mapping || null;
}

module.exports = {
  getExistingLrns,
  getExistingEmails,
  getSectionNameMap,
  insertStudentsBatch,
  logImport,
  updateImportCounts,
  getLastMapping,
};
