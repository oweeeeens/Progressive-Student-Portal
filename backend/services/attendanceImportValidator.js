// Decides what an extracted grid actually means, and what cannot be
// imported. Pure — no database access, no knowledge of exceljs — so the
// rules can be read and tested on their own. Same split as
// bulkImportValidator.js next door.
const { VALID_STATUSES, IGNORE_STATUS } = require('../config/attendanceImport');

// Turns the grid into the per-date entry lists the attendance models expect,
// and collects everything that could not be imported with a reason attached.
//
// `symbolMap` maps a normalized symbol ('' for a blank cell) to a status or
// to IGNORE_STATUS. The caller has already shown the user every symbol in
// the file and its count — nothing here guesses.
//
// Lookups the caller supplies:
//   studentsByLrn  Map(lrn -> { id, name })  the roster of the chosen
//                  section or class offering, so an LRN that belongs to the
//                  school but not to THIS group is rejected rather than
//                  written into the wrong register.
//   periodByDate   Map(date -> gradingPeriodId | null)
//   existingByDate Map(date -> Set(studentId)) attendance already recorded
function validateGrid({ students, symbolMap }, { studentsByLrn, periodByDate, existingByDate }) {
  const byDate = new Map();
  const unknownStudents = [];
  const duplicateStudents = [];
  const datesWithoutPeriod = new Set();
  const seenLrnRows = new Map();

  let ignoredCells = 0;

  for (const student of students) {
    const match = studentsByLrn.get(student.lrn);
    if (!match) {
      unknownStudents.push({ rowNumber: student.rowNumber, lrn: student.lrn });
      continue;
    }

    // The same student twice in one sheet. Caught here because the attendance
    // upsert is a single multi-row INSERT ... ON CONFLICT, and Postgres
    // rejects a statement that would touch the same conflict key twice
    // ("cannot affect row a second time") — which would surface as a 500
    // rather than something the user could fix.
    const firstRow = seenLrnRows.get(student.lrn);
    if (firstRow) {
      duplicateStudents.push({ rowNumber: student.rowNumber, lrn: student.lrn, firstRow, name: match.name });
      continue;
    }
    seenLrnRows.set(student.lrn, student.rowNumber);

    for (const mark of student.marks) {
      const key = mark.symbol === null ? '' : mark.symbol.toLowerCase();
      const status = symbolMap[key];

      if (!status || status === IGNORE_STATUS) {
        ignoredCells += 1;
        continue;
      }
      if (!VALID_STATUSES.includes(status)) {
        ignoredCells += 1;
        continue;
      }

      // A date outside every configured grading period cannot be stored:
      // grading_period_id is NOT NULL and is resolved from the date.
      const gradingPeriodId = periodByDate.get(mark.date);
      if (!gradingPeriodId) {
        datesWithoutPeriod.add(mark.date);
        continue;
      }

      if (!byDate.has(mark.date)) {
        byDate.set(mark.date, { date: mark.date, gradingPeriodId, entries: [] });
      }
      byDate.get(mark.date).entries.push({ studentId: match.id, status });
    }
  }

  // Which dates would overwrite something, and how much. Surfaced so the
  // user confirms each one — an import must never quietly replace a day an
  // adviser marked by hand.
  const conflicts = [];
  for (const [date, group] of byDate) {
    const already = existingByDate.get(date);
    if (!already || already.size === 0) continue;
    const overlapping = group.entries.filter((e) => already.has(e.studentId)).length;
    if (overlapping > 0) conflicts.push({ date, studentCount: overlapping });
  }

  const dates = [...byDate.keys()].sort();
  const entryCount = [...byDate.values()].reduce((sum, g) => sum + g.entries.length, 0);

  return {
    // Sorted so the write order matches the calendar, which makes the
    // progress and any error message readable.
    groups: dates.map((date) => byDate.get(date)),
    summary: {
      studentCount: seenLrnRows.size,
      dateCount: dates.length,
      entryCount,
      ignoredCells,
      firstDate: dates[0] || null,
      lastDate: dates[dates.length - 1] || null,
    },
    conflicts: conflicts.sort((a, b) => a.date.localeCompare(b.date)),
    skipped: {
      unknownStudents,
      duplicateStudents,
      datesWithoutPeriod: [...datesWithoutPeriod].sort(),
    },
  };
}

// Every symbol in the file must have been given a meaning before anything is
// written. Returns the symbols still undecided, so the UI can say which.
function findUnmappedSymbols(symbols, symbolMap) {
  return symbols.filter(({ symbol }) => !symbolMap[symbol]).map(({ symbol }) => symbol);
}

module.exports = { validateGrid, findUnmappedSymbols };
