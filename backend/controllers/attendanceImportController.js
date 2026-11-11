// The four steps of an attendance grid import: read the sheet, extract the
// grid the user pointed at, validate it, write it.
//
// Stateless between steps, like the student importer: the browser holds the
// extracted grid and sends it back, so there is no staging table and nothing
// to clean up if someone closes the tab halfway through.
//
// The one deliberate difference from the student importer is that `commit`
// re-validates everything server-side instead of trusting what comes back.
// Creating a bad student record is recoverable; silently overwriting a month
// of the official DepEd register is not.
const { readSheet, extractMarks } = require('../services/attendanceGridParser');
const { validateGrid, findUnmappedSymbols } = require('../services/attendanceImportValidator');
const attendanceImportModel = require('../models/attendanceImportModel');
const gradingPeriodModel = require('../models/gradingPeriodModel');
const riskEngine = require('../services/riskEngine');
const { assertCanWriteSection } = require('./dailyAttendanceController');
const { SYMBOL_GUESSES, BLANK_SYMBOL, BLANK_DEFAULT_STATUS, PREVIEW_ROWS } = require('../config/attendanceImport');

// What the review step may decide about a date that already has attendance
// recorded. Anything else (including nothing) is treated as undecided.
const CONFLICT_DECISIONS = ['overwrite', 'skip'];

// Only the daily (SF2) register is importable: the subject-level register
// was removed on 2026-11-11 to keep the System to its title. Who may write
// it is the marking sheet's own rule (the section's adviser, or the admin or
// registrar), reused so the two paths cannot drift apart.
async function assertCanWrite(req, res, { sectionId }) {
  if (!sectionId) {
    res.status(400).json({ error: 'sectionId is required for an attendance import.' });
    return false;
  }
  return Boolean(await assertCanWriteSection(req, res, Number(sectionId)));
}

// Step 1 — what is literally in the sheet, plus where the grid probably is.
// Nothing is interpreted here; the user confirms the anchors next.
async function parseFile(req, res) {
  // Checked here too, not just on validate/commit. These first two steps
  // take a 5 MB upload and run it through the spreadsheet parser, so leaving
  // them on requireAuth alone let any account in the school — a student
  // included — drive that parser against a section they have nothing to do
  // with. Reading someone else's roster shape is not a write, but it is not
  // theirs to read either.
  if (!(await assertCanWrite(req, res, { sectionId: req.body.sectionId }))) return;

  let sheet;
  try {
    sheet = await readSheet(req.file.buffer);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  res.json({
    fileName: req.file.originalname,
    preview: sheet.preview,
    previewRows: PREVIEW_ROWS,
    rowCount: sheet.rowCount,
    columnCount: sheet.columnCount,
    suggestion: sheet.suggestion,
  });
}

// Step 2 — the user has pointed at the LRN column, the day row and the
// month. Pull out the students, the dates and every distinct mark, so the
// next step can ask what each mark means.
async function inspectGrid(req, res) {
  const { lrnColumn, dayRow, month, year } = req.body;

  if (!(await assertCanWrite(req, res, { sectionId: req.body.sectionId }))) return;

  let sheet;
  try {
    sheet = await readSheet(req.file.buffer);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  let grid;
  try {
    grid = extractMarks(sheet.cells, {
      lrnColumn: Number(lrnColumn),
      dayRow: Number(dayRow),
      month: Number(month),
      year: Number(year),
    });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  // A first guess at what each mark means, which the user confirms. The
  // blank cell is called out separately because it is the assumption that
  // decides the most cells.
  const suggestedSymbolMap = {};
  for (const { symbol } of grid.symbols) {
    suggestedSymbolMap[symbol] = symbol === '' ? BLANK_DEFAULT_STATUS : SYMBOL_GUESSES[symbol] || null;
  }

  res.json({
    students: grid.students,
    dates: grid.dates,
    symbols: grid.symbols.map((s) => ({ ...s, label: s.symbol === '' ? BLANK_SYMBOL : s.symbol })),
    suggestedSymbolMap,
  });
}

// Shared by validate and commit, so the preview and the write can never
// disagree about what would happen.
async function buildPlan({ sectionId, students, symbolMap }) {
  const studentsByLrn = await attendanceImportModel.getRosterByLrn({ sectionId });

  // Every distinct date in the sheet, resolved to its grading period. A date
  // in no period cannot be stored (grading_period_id is NOT NULL) and is
  // reported rather than dropped.
  //
  // Resolved against ONE school year's periods — the year the chosen section
  // belongs to — rather than by asking the database once
  // per date. Two reasons, and the first is the important one:
  //
  //   1. The unscoped gradingPeriodModel.findByDate searches every year's
  //      periods and breaks ties by lowest id. Nothing in the schema stops
  //      two school years' date ranges overlapping, so importing a previous
  //      year's SF2 could file a whole month under the wrong year, with no
  //      column on the attendance row to reveal it afterwards.
  //   2. A month-long sheet has up to 40 distinct dates; this was 40 queries
  //      per preview, and the preview runs again on every commit.
  //
  // Dates are plain YYYY-MM-DD strings on both sides (see the DATE type
  // parser in config/db.js), so the range check is a string comparison with
  // no timezone in play. Periods with no dates configured yet cannot contain
  // anything and are skipped.
  const allDates = [...new Set(students.flatMap((s) => s.marks.map((m) => m.date)))].sort();
  const schoolYearId = await attendanceImportModel.getSchoolYearId({ sectionId });
  const periods = schoolYearId ? await gradingPeriodModel.listBySchoolYear(schoolYearId) : [];
  const periodByDate = new Map();
  for (const date of allDates) {
    const period = periods.find((p) => p.start_date && p.end_date && date >= p.start_date && date <= p.end_date);
    periodByDate.set(date, period ? period.id : null);
  }

  const studentIds = [...studentsByLrn.values()].map((s) => s.id);
  const existingByDate = await attendanceImportModel.getExistingByDate({ studentIds, dates: allDates });

  return validateGrid({ students, symbolMap }, { studentsByLrn, periodByDate, existingByDate });
}

// Step 3 — what would be written, and everything that would not be.
async function validateImport(req, res) {
  const { students, symbolMap, symbols } = req.body;

  if (!Array.isArray(students) || students.length === 0) {
    return res.status(400).json({ error: 'No student rows were sent.' });
  }
  if (!symbolMap || typeof symbolMap !== 'object') {
    return res.status(400).json({ error: 'Tell the import what each mark means first.' });
  }

  const unmapped = findUnmappedSymbols(symbols || [], symbolMap);
  if (unmapped.length > 0) {
    return res.status(400).json({
      error: `These marks still need a meaning: ${unmapped.map((s) => (s === '' ? 'blank cells' : `"${s}"`)).join(', ')}`,
    });
  }

  const { sectionId } = req.body;
  if (!(await assertCanWrite(req, res, { sectionId }))) return;

  const plan = await buildPlan({ sectionId, students, symbolMap });
  res.json(plan);
}

// Step 4 — write it. Re-validates from the same inputs rather than trusting
// the plan the browser sends back, then writes every date in one
// transaction.
async function commitImport(req, res) {
  const { students, symbolMap, conflictDecisions, fileName } = req.body;
  const sectionId = req.body.sectionId;

  if (!Array.isArray(students) || students.length === 0) {
    return res.status(400).json({ error: 'No student rows were sent.' });
  }
  if (!(await assertCanWrite(req, res, { sectionId }))) return;

  const plan = await buildPlan({ sectionId, students, symbolMap });

  if (plan.groups.length === 0) {
    return res.status(400).json({ error: 'Nothing in this sheet can be imported. See the review step for why.' });
  }

  // Every date that would overwrite attendance already on file needs an
  // explicit decision from the review step: 'overwrite' or 'skip'. Re-checked
  // here rather than trusted, because making that decision is the whole
  // reason the review step exists and the browser is not where it can be
  // enforced. A date with no decision stops the import — silently picking
  // either answer is the one outcome that is never acceptable.
  const decisions = conflictDecisions && typeof conflictDecisions === 'object' ? conflictDecisions : {};
  const undecided = plan.conflicts
    .filter((conflict) => !CONFLICT_DECISIONS.includes(decisions[conflict.date]))
    .map((conflict) => conflict.date);
  if (undecided.length > 0) {
    return res.status(409).json({
      error: 'Some dates already have attendance recorded. Choose whether to overwrite or skip each one.',
      dates: undecided,
    });
  }

  const skippedDates = plan.conflicts
    .filter((conflict) => decisions[conflict.date] === 'skip')
    .map((conflict) => conflict.date);
  const groupsToWrite = plan.groups.filter((group) => !skippedDates.includes(group.date));

  if (groupsToWrite.length === 0) {
    return res.status(400).json({ error: 'Every date in this sheet was skipped, so there is nothing to import.' });
  }

  // The audit row is created inside commitImport's transaction rather than
  // logged here afterwards: every attendance row written carries its id, so
  // it has to exist first, and a failed import must leave neither.
  const { importId, writtenCount, affectedByPeriod } = await attendanceImportModel.commitImport({
    groups: groupsToWrite,
    recordedBy: req.user.id,
    log: {
      fileName: fileName || 'attendance.xlsx',
      totalRows: students.length,
      errorCount:
        plan.skipped.unknownStudents.length +
        plan.skipped.duplicateStudents.length +
        plan.skipped.datesWithoutPeriod.length,
      columnMapping: symbolMap || {},
      importType: 'attendance_daily',
    },
  });

  // Daily attendance is what the risk formula reads, so an import of it has
  // to leave the risk picture correct. Once per grading period, after every
  // date is written — not once per date, which would recompute the same
  // answer from the same history over and over.
  for (const { gradingPeriodId, studentIds } of affectedByPeriod) {
    await riskEngine.recalculateRiskForStudents(studentIds, gradingPeriodId);
  }

  res.status(201).json({
    importId,
    writtenCount,
    dateCount: groupsToWrite.length,
    studentCount: plan.summary.studentCount,
    recalculatedPeriods: affectedByPeriod.length,
    skippedDates,
    skipped: plan.skipped,
  });
}

module.exports = { parseFile, inspectGrid, validateImport, commitImport };
