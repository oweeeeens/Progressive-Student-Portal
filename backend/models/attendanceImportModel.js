// Database work for the attendance grid import: the lookups the validator
// needs, and the commit.
//
// The commit is the one place in this feature that owns a transaction. Every
// other write in the app is a single autocommit statement, which is right
// when a save covers one day — but an import covers a month, and a sheet
// half-written into the official register is worse than one not written at
// all. All dates go in together or none do.
const { pool } = require('../config/db');
const dailyAttendanceModel = require('./dailyAttendanceModel');
const subjectAttendanceModel = require('./subjectAttendanceModel');
const bulkImportModel = require('./bulkImportModel');

// The roster of the section or class offering being imported into, keyed by
// LRN. Reusing the same "who is actually in this group right now" queries the
// marking sheets use means an import can never write a student into a
// register they do not belong to.
async function getRosterByLrn({ mode, sectionId, classOfferingId }) {
  const result = await pool.query(
    mode === 'subject'
      ? `SELECT s.id, s.lrn, s.first_name, s.last_name
         FROM students s
         JOIN class_offerings co ON co.section_id = s.current_section_id
         WHERE co.id = $1 AND s.is_active = TRUE`
      : `SELECT id, lrn, first_name, last_name
         FROM students
         WHERE current_section_id = $1 AND is_active = TRUE`,
    [mode === 'subject' ? classOfferingId : sectionId]
  );

  const byLrn = new Map();
  for (const row of result.rows) {
    byLrn.set(row.lrn, { id: row.id, name: `${row.last_name}, ${row.first_name}` });
  }
  return byLrn;
}

// The school year the chosen section or class offering belongs to. Every
// date in the sheet is resolved to a grading period within THIS year, so a
// sheet of last year's attendance imported against last year's section
// lands in last year's periods — and never silently in another year's,
// which the unscoped lookup could do (see
// gradingPeriodModel.findByDateInSchoolYear).
async function getSchoolYearId({ mode, sectionId, classOfferingId }) {
  const result = await pool.query(
    mode === 'subject'
      ? 'SELECT school_year_id FROM class_offerings WHERE id = $1'
      : 'SELECT school_year_id FROM sections WHERE id = $1',
    [mode === 'subject' ? classOfferingId : sectionId]
  );
  return result.rows[0]?.school_year_id || null;
}

// Attendance already on file for these dates, so the preview can say exactly
// which days an import would overwrite and for how many students.
async function getExistingByDate({ mode, classOfferingId, studentIds, dates }) {
  const byDate = new Map();
  for (const date of dates) byDate.set(date, new Set());
  if (studentIds.length === 0 || dates.length === 0) return byDate;

  const result =
    mode === 'subject'
      ? await pool.query(
          `SELECT student_id, attendance_date
           FROM subject_attendance_records
           WHERE class_offering_id = $1 AND student_id = ANY($2::int[]) AND attendance_date = ANY($3::date[])`,
          [classOfferingId, studentIds, dates]
        )
      : await pool.query(
          `SELECT student_id, attendance_date
           FROM daily_attendance_records
           WHERE student_id = ANY($1::int[]) AND attendance_date = ANY($2::date[])`,
          [studentIds, dates]
        );

  for (const row of result.rows) {
    // attendance_date comes back as a plain YYYY-MM-DD string (see the type
    // parser in config/db.js), so it keys the map directly.
    if (!byDate.has(row.attendance_date)) byDate.set(row.attendance_date, new Set());
    byDate.get(row.attendance_date).add(row.student_id);
  }
  return byDate;
}

// Writes the audit row and every date in one transaction, reusing the exact
// upsert the daily and subject marking sheets use — so the ON CONFLICT
// behaviour cannot drift between the import and the marking sheet.
//
// The audit row is written FIRST, inside the same transaction, because every
// attendance row it is about carries its id (see the import_id migration).
// Its counts are not known until the writes finish, so they are filled in
// just before COMMIT. That ordering also means a failed import leaves no
// audit row at all, rather than the old shape where the log was written
// after the fact and a crash in between produced written data with nothing
// recording it.
async function commitImport({ mode, classOfferingId, groups, recordedBy, log }) {
  const client = await pool.connect();
  const affectedByPeriod = new Map();
  let writtenCount = 0;
  let importId = null;

  try {
    await client.query('BEGIN');

    const auditRow = await bulkImportModel.logImport({
      performedBy: recordedBy,
      fileName: log.fileName,
      totalRows: log.totalRows,
      // Placeholders: the real counts are known only once every date is
      // written, and are set below before this transaction commits.
      successCount: 0,
      errorCount: log.errorCount,
      columnMapping: log.columnMapping,
      importType: log.importType,
      client,
    });
    importId = auditRow.id;

    for (const group of groups) {
      const saved =
        mode === 'subject'
          ? await subjectAttendanceModel.recordAttendance({
              classOfferingId,
              gradingPeriodId: group.gradingPeriodId,
              attendanceDate: group.date,
              recordedBy,
              entries: group.entries,
              client,
              importId,
            })
          : await dailyAttendanceModel.recordAttendance({
              gradingPeriodId: group.gradingPeriodId,
              attendanceDate: group.date,
              recordedBy,
              entries: group.entries,
              client,
              importId,
            });

      writtenCount += saved.length;

      // Collected per grading period, because risk is recalculated once per
      // period at the end rather than once per date — the result depends on
      // a student's whole history, so recalculating per date would compute
      // the same answer over and over.
      if (!affectedByPeriod.has(group.gradingPeriodId)) {
        affectedByPeriod.set(group.gradingPeriodId, new Set());
      }
      const bucket = affectedByPeriod.get(group.gradingPeriodId);
      for (const row of saved) bucket.add(row.student_id);
    }

    await bulkImportModel.updateImportCounts(importId, { successCount: writtenCount }, client);

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return {
    importId,
    writtenCount,
    affectedByPeriod: [...affectedByPeriod.entries()].map(([gradingPeriodId, studentIds]) => ({
      gradingPeriodId,
      studentIds: [...studentIds],
    })),
  };
}

module.exports = { getRosterByLrn, getSchoolYearId, getExistingByDate, commitImport };
