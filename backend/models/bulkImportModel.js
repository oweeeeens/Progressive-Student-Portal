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

async function logImport({ performedBy, fileName, totalRows, successCount, errorCount, columnMapping }) {
  const result = await pool.query(
    `INSERT INTO bulk_imports (performed_by, file_name, total_rows, success_count, error_count, column_mapping)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, created_at`,
    [performedBy, fileName, totalRows, successCount, errorCount, JSON.stringify(columnMapping)]
  );
  return result.rows[0];
}

// The most recent import's column mapping — used as the "remember my last
// mapping" default on the mapping screen (see bulkImportController.parseFile).
// Not scoped per-user: this app has exactly one school, so "whatever the
// last import at this school used" is the same thing as "whatever this
// admin/registrar used last," and sharing it means a second staff member
// doing the next import also benefits from the first one's mapping.
async function getLastMapping() {
  const result = await pool.query('SELECT column_mapping FROM bulk_imports ORDER BY created_at DESC LIMIT 1');
  return result.rows[0]?.column_mapping || null;
}

module.exports = {
  getExistingLrns,
  getExistingEmails,
  getSectionNameMap,
  insertStudentsBatch,
  logImport,
  getLastMapping,
};
