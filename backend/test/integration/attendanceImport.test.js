// Integration coverage for the bulk attendance import (the SF2 grid
// importer). This writes the official DepEd daily register, so most of what
// is tested here is what must NOT happen: a half-written month, a silent
// overwrite, a date filed under no grading period, a student written into a
// section they are not in, or a 500 from Postgres on a duplicated row.
//
// Runs against the real Express app and the real database. Uses its own
// far-future school year (2032) — isolated from the dev seed data,
// gradeApproval's 2030 and riskRecalculation's 2031 — because
// gradingPeriodModel.findByDate searches every period in the table (see the
// isolation note in helpers/fixtures.js).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');

const { startTestServer } = require('./helpers/testServer');
const { createClient } = require('./helpers/client');
const fixtures = require('./helpers/fixtures');
const { pool } = require('../../config/db');
const riskEngine = require('../../services/riskEngine');
const dailyAttendanceModel = require('../../models/dailyAttendanceModel');

const BASE = '/api/attendance/bulk-import';

let server;
let api;
let ctx;

// Builds an .xlsx shaped like the SF2 forms the school actually keeps: a
// header block naming the month, then a day-number row, then one row per
// learner with a mark per day. Deliberately NOT a tidy table — the header
// block above the grid and the name column beside the LRN are exactly what
// the parser has to find its way past.
async function buildGridWorkbook({ month, year, days, rows }) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('SF2');

  sheet.addRow(['School Form 2 (SF2) Daily Attendance Report of Learners']);
  sheet.addRow([`Month: ${month} ${year}`]);
  sheet.addRow([]);
  sheet.addRow(['LRN', "LEARNER'S NAME", ...days]);
  for (const row of rows) {
    sheet.addRow([row.lrn, row.name, ...row.marks]);
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

// Walks the first steps (inspect -> validate) the way the page does, so each
// test can start from a real validation plan rather than a hand-written one.
async function runToValidate({ token, buffer, anchors, target, symbolMap }) {
  const inspectRes = await api.upload(`${BASE}/inspect`, { token, buffer, fields: anchors });
  assert.equal(inspectRes.status, 200, JSON.stringify(inspectRes.body));

  const effectiveMap = symbolMap || inspectRes.body.suggestedSymbolMap;
  const validate = await api.post(`${BASE}/validate`, {
    token,
    body: {
      ...target,
      students: inspectRes.body.students,
      symbols: inspectRes.body.symbols,
      symbolMap: effectiveMap,
    },
  });
  return { inspect: inspectRes.body, validate, symbolMap: effectiveMap };
}

async function getDailyRows(studentIds) {
  const result = await pool.query(
    `SELECT student_id, attendance_date, status, grading_period_id
     FROM daily_attendance_records
     WHERE student_id = ANY($1::int[])
     ORDER BY attendance_date, student_id`,
    [studentIds]
  );
  return result.rows;
}

before(async () => {
  server = await startTestServer();
  api = createClient(server.baseUrl);

  // Two periods, so the "recalculate once per grading period" assertion has
  // something to count: October is Q1, November is Q2.
  const { schoolYearId, periods } = await fixtures.createSchoolYearWithPeriods('IMP', [
    { name: 'Q1', sequenceNumber: 1, startDate: '2032-10-01', endDate: '2032-10-31' },
    { name: 'Q2', sequenceNumber: 2, startDate: '2032-11-01', endDate: '2032-11-30' },
  ]);

  const [adviser, otherAdviser, teacher, registrar] = await Promise.all([
    fixtures.createStaffUser('adviser', 'imp-adviser'),
    fixtures.createStaffUser('adviser', 'imp-other-adviser'),
    fixtures.createStaffUser('subject_teacher', 'imp-teacher'),
    fixtures.createStaffUser('registrar', 'imp-registrar'),
  ]);

  const section = await fixtures.createTestSection({ schoolYearId, adviserId: adviser.id, label: 'imp-section' });
  const otherSection = await fixtures.createTestSection({
    schoolYearId,
    adviserId: otherAdviser.id,
    label: 'imp-other-section',
  });
  const subject = await fixtures.createTestSubject('imp-subject');
  const offering = await fixtures.createTestOffering({
    subjectId: subject.id,
    sectionId: section.id,
    teacherId: teacher.id,
    schoolYearId,
  });

  const studentA = await fixtures.createTestStudent({ sectionId: section.id, label: 'imp-a' });
  const studentB = await fixtures.createTestStudent({ sectionId: section.id, label: 'imp-b' });
  // In the school, but in a different section — so the roster check has
  // something real to reject rather than an invented LRN.
  const outsider = await fixtures.createTestStudent({ sectionId: otherSection.id, label: 'imp-out' });

  // A SECOND school year that covers December 2032 — a month the first year
  // has no period for. Nothing is imported into it; it exists so the
  // cross-year test below can prove the importer does not reach into another
  // year's periods when its own year has none for a date. Before the
  // school-year scoping, gradingPeriodModel.findByDate would have found this
  // one and filed a whole month under it.
  const other = await fixtures.createSchoolYearWithPeriods('IMP2', [
    { name: 'Q1', sequenceNumber: 1, startDate: '2032-12-01', endDate: '2032-12-31' },
  ]);

  ctx = {
    schoolYearId,
    otherSchoolYearId: other.schoolYearId,
    periods,
    adviser,
    otherAdviser,
    teacher,
    registrar,
    section,
    otherSection,
    subject,
    offering,
    studentA,
    studentB,
    outsider,
  };
});

after(async () => {
  // The decoy year owns no data, so it comes out with a direct delete before
  // the shared teardown (which ends the pool and handles only one year).
  await pool.query('DELETE FROM grading_periods WHERE school_year_id = $1', [ctx.otherSchoolYearId]);
  await pool.query('DELETE FROM school_years WHERE id = $1', [ctx.otherSchoolYearId]);

  await fixtures.teardown({
    schoolYearId: ctx.schoolYearId,
    ownSchoolYear: true,
    userIds: [ctx.adviser.id, ctx.otherAdviser.id, ctx.teacher.id, ctx.registrar.id],
    studentIds: [ctx.studentA.id, ctx.studentB.id, ctx.outsider.id],
    subjectIds: [ctx.subject.id],
    sectionIds: [ctx.section.id, ctx.otherSection.id],
    offeringIds: [ctx.offering.id],
  });
  await server.close();
});

test('parse finds the grid inside an SF2 header block without being told where it is', async () => {
  const buffer = await buildGridWorkbook({
    month: 'OCTOBER',
    year: 2032,
    days: [1, 2, 3],
    rows: [{ lrn: ctx.studentA.lrn, name: 'A', marks: ['P', 'A', ''] }],
  });

  const res = await api.upload(`${BASE}/parse`, { token: ctx.adviser.token, buffer });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  // Column 1 holds the LRNs; row 4 holds the day numbers (title, month, one
  // blank, then the header). Both 1-indexed, to match what a person sees in
  // Excel.
  assert.equal(res.body.suggestion.lrnColumn, 1);
  assert.equal(res.body.suggestion.dayRow, 4);
  assert.equal(res.body.suggestion.month, 10);
  assert.equal(res.body.suggestion.year, 2032);
});

test('a two-date import writes exactly the expected rows, blank cells read as present', async () => {
  const buffer = await buildGridWorkbook({
    month: 'OCTOBER',
    year: 2032,
    days: [1, 2],
    rows: [
      { lrn: ctx.studentA.lrn, name: 'A', marks: ['P', 'A'] },
      // Second cell left blank: the DepEd convention of marking only
      // exceptions, which the import reads as present.
      { lrn: ctx.studentB.lrn, name: 'B', marks: ['L', ''] },
    ],
  });

  const target = { mode: 'daily', sectionId: ctx.section.id };
  const { inspect, validate, symbolMap } = await runToValidate({
    token: ctx.adviser.token,
    buffer,
    anchors: { lrnColumn: 1, dayRow: 4, month: 10, year: 2032 },
    target,
  });

  assert.equal(validate.status, 200, JSON.stringify(validate.body));
  assert.equal(validate.body.summary.studentCount, 2);
  assert.equal(validate.body.summary.dateCount, 2);
  assert.equal(validate.body.summary.entryCount, 4);
  assert.deepEqual(validate.body.conflicts, []);

  const commitRes = await api.post(`${BASE}/commit`, {
    token: ctx.adviser.token,
    body: { ...target, students: inspect.students, symbolMap, fileName: 'october.xlsx' },
  });
  assert.equal(commitRes.status, 201, JSON.stringify(commitRes.body));
  assert.equal(commitRes.body.writtenCount, 4);
  assert.equal(commitRes.body.dateCount, 2);

  const rows = await getDailyRows([ctx.studentA.id, ctx.studentB.id]);
  assert.equal(rows.length, 4);
  const byKey = new Map(rows.map((r) => [`${r.student_id}|${r.attendance_date}`, r.status]));
  assert.equal(byKey.get(`${ctx.studentA.id}|2032-10-01`), 'present');
  assert.equal(byKey.get(`${ctx.studentA.id}|2032-10-02`), 'absent');
  assert.equal(byKey.get(`${ctx.studentB.id}|2032-10-01`), 'late');
  assert.equal(byKey.get(`${ctx.studentB.id}|2032-10-02`), 'present');
  // Every row filed under Q1, resolved from its own date — never from
  // anything the browser sent.
  assert.ok(rows.every((r) => r.grading_period_id === ctx.periods[0].id));
});

test('the import leaves the risk picture correct: attendance rate reflects what was written', async () => {
  // Carries on from the previous test's four rows. Student A: present +
  // absent = 50%.
  const result = await pool.query(
    'SELECT attendance_rate, risk_score, risk_level FROM risk_assessments WHERE student_id = $1 AND grading_period_id = $2',
    [ctx.studentA.id, ctx.periods[0].id]
  );
  const assessment = result.rows[0];
  assert.ok(assessment, 'a daily import must trigger a risk assessment, same as marking attendance by hand');
  assert.equal(Number(assessment.attendance_rate), 50);
  // 50% is below the configured threshold, so the low-attendance factor
  // fires: +2. Nothing else can (no grades, one period of history, so no
  // measurable trend).
  assert.equal(assessment.risk_score, 2);
  assert.equal(assessment.risk_level, 'low');
});

test('a date already recorded is a conflict, and commit refuses until it is decided', async () => {
  // 1 October was written by an earlier test; 3 October is new.
  const buffer = await buildGridWorkbook({
    month: 'OCTOBER',
    year: 2032,
    days: [1, 3],
    rows: [{ lrn: ctx.studentA.lrn, name: 'A', marks: ['A', 'A'] }],
  });

  const target = { mode: 'daily', sectionId: ctx.section.id };
  const { inspect, validate, symbolMap } = await runToValidate({
    token: ctx.adviser.token,
    buffer,
    anchors: { lrnColumn: 1, dayRow: 4, month: 10, year: 2032 },
    target,
  });

  assert.equal(validate.status, 200, JSON.stringify(validate.body));
  assert.deepEqual(validate.body.conflicts, [{ date: '2032-10-01', studentCount: 1 }]);

  const refused = await api.post(`${BASE}/commit`, {
    token: ctx.adviser.token,
    body: { ...target, students: inspect.students, symbolMap },
  });
  assert.equal(refused.status, 409);
  assert.deepEqual(refused.body.dates, ['2032-10-01']);

  // Nothing was written — not even 3 October, which had no conflict of its
  // own. An undecided conflict stops the whole sheet.
  const untouched = await pool.query(
    'SELECT status FROM daily_attendance_records WHERE student_id = $1 AND attendance_date = $2',
    [ctx.studentA.id, '2032-10-01']
  );
  assert.equal(untouched.rows[0].status, 'present');
  const notWritten = await pool.query(
    'SELECT 1 FROM daily_attendance_records WHERE student_id = $1 AND attendance_date = $2',
    [ctx.studentA.id, '2032-10-03']
  );
  assert.equal(notWritten.rowCount, 0);

  // Skipping the conflict imports everything else and leaves the recorded
  // day exactly as the adviser marked it.
  const skipped = await api.post(`${BASE}/commit`, {
    token: ctx.adviser.token,
    body: { ...target, students: inspect.students, symbolMap, conflictDecisions: { '2032-10-01': 'skip' } },
  });
  assert.equal(skipped.status, 201, JSON.stringify(skipped.body));
  assert.deepEqual(skipped.body.skippedDates, ['2032-10-01']);
  assert.equal(skipped.body.writtenCount, 1); // 3 October only
  const stillPresent = await pool.query(
    'SELECT status FROM daily_attendance_records WHERE student_id = $1 AND attendance_date = $2',
    [ctx.studentA.id, '2032-10-01']
  );
  assert.equal(stillPresent.rows[0].status, 'present');

  // Choosing to overwrite does overwrite it. Both dates are decided this
  // time: the skipped commit above wrote 3 October, so re-importing the same
  // sheet now conflicts on that date too — which is the conflict check
  // working, recomputed server-side on every commit rather than taken from
  // the plan the browser is holding.
  const overwrote = await api.post(`${BASE}/commit`, {
    token: ctx.adviser.token,
    body: {
      ...target,
      students: inspect.students,
      symbolMap,
      conflictDecisions: { '2032-10-01': 'overwrite', '2032-10-03': 'overwrite' },
    },
  });
  assert.equal(overwrote.status, 201, JSON.stringify(overwrote.body));
  assert.deepEqual(overwrote.body.skippedDates, []);
  const overwritten = await pool.query(
    'SELECT status FROM daily_attendance_records WHERE student_id = $1 AND attendance_date = $2',
    [ctx.studentA.id, '2032-10-01']
  );
  assert.equal(overwritten.rows[0].status, 'absent');
});

test('a student listed twice is reported, never sent to Postgres as a doubled conflict key', async () => {
  const buffer = await buildGridWorkbook({
    month: 'OCTOBER',
    year: 2032,
    days: [10],
    rows: [
      { lrn: ctx.studentA.lrn, name: 'A', marks: ['P'] },
      { lrn: ctx.studentA.lrn, name: 'A again', marks: ['A'] },
    ],
  });

  const target = { mode: 'daily', sectionId: ctx.section.id };
  const { inspect, validate, symbolMap } = await runToValidate({
    token: ctx.adviser.token,
    buffer,
    anchors: { lrnColumn: 1, dayRow: 4, month: 10, year: 2032 },
    target,
  });

  assert.equal(validate.status, 200, JSON.stringify(validate.body));
  assert.equal(validate.body.skipped.duplicateStudents.length, 1);
  assert.equal(validate.body.skipped.duplicateStudents[0].lrn, ctx.studentA.lrn);
  assert.equal(validate.body.summary.studentCount, 1);

  // A 201, not a 500 — which is what the raw multi-row upsert would give
  // ("ON CONFLICT DO UPDATE command cannot affect row a second time").
  const commitRes = await api.post(`${BASE}/commit`, {
    token: ctx.adviser.token,
    body: { ...target, students: inspect.students, symbolMap },
  });
  assert.equal(commitRes.status, 201, JSON.stringify(commitRes.body));
  assert.equal(commitRes.body.writtenCount, 1);

  // The first occurrence won.
  const written = await pool.query(
    'SELECT status FROM daily_attendance_records WHERE student_id = $1 AND attendance_date = $2',
    [ctx.studentA.id, '2032-10-10']
  );
  assert.equal(written.rows[0].status, 'present');
});

test('an LRN that is not in this section is reported and never written into it', async () => {
  const buffer = await buildGridWorkbook({
    month: 'OCTOBER',
    year: 2032,
    days: [15],
    rows: [
      { lrn: ctx.studentA.lrn, name: 'A', marks: ['P'] },
      { lrn: ctx.outsider.lrn, name: 'Outsider', marks: ['A'] },
    ],
  });

  const target = { mode: 'daily', sectionId: ctx.section.id };
  const { inspect, validate, symbolMap } = await runToValidate({
    token: ctx.adviser.token,
    buffer,
    anchors: { lrnColumn: 1, dayRow: 4, month: 10, year: 2032 },
    target,
  });

  assert.equal(validate.status, 200, JSON.stringify(validate.body));
  assert.deepEqual(
    validate.body.skipped.unknownStudents.map((s) => s.lrn),
    [ctx.outsider.lrn]
  );

  const commitRes = await api.post(`${BASE}/commit`, {
    token: ctx.adviser.token,
    body: { ...target, students: inspect.students, symbolMap },
  });
  assert.equal(commitRes.status, 201, JSON.stringify(commitRes.body));
  const outsiderRows = await getDailyRows([ctx.outsider.id]);
  assert.equal(outsiderRows.length, 0);
});

test('a date in no grading period is reported, and nothing is written', async () => {
  // December 2032 falls outside both configured periods.
  const buffer = await buildGridWorkbook({
    month: 'DECEMBER',
    year: 2032,
    days: [1, 2],
    rows: [{ lrn: ctx.studentA.lrn, name: 'A', marks: ['P', 'P'] }],
  });

  const target = { mode: 'daily', sectionId: ctx.section.id };
  const { inspect, validate, symbolMap } = await runToValidate({
    token: ctx.adviser.token,
    buffer,
    anchors: { lrnColumn: 1, dayRow: 4, month: 12, year: 2032 },
    target,
  });

  assert.equal(validate.status, 200, JSON.stringify(validate.body));
  assert.deepEqual(validate.body.skipped.datesWithoutPeriod, ['2032-12-01', '2032-12-02']);
  assert.equal(validate.body.groups.length, 0);
  assert.equal(validate.body.summary.entryCount, 0);

  const before = await getDailyRows([ctx.studentA.id]);
  const commitRes = await api.post(`${BASE}/commit`, {
    token: ctx.adviser.token,
    body: { ...target, students: inspect.students, symbolMap },
  });
  // Nothing importable gets a clear 400 pointing back at the review step,
  // not a 201 claiming success with zero rows written.
  assert.equal(commitRes.status, 400);
  const afterRows = await getDailyRows([ctx.studentA.id]);
  assert.equal(afterRows.length, before.length);
});

test('risk is recalculated once per grading period, not once per date', async () => {
  // Nine dates across two periods. Done per date, that would be nine
  // recalculations of the same answer; the import must collapse them to one
  // call per period.
  const octoberBuffer = await buildGridWorkbook({
    month: 'OCTOBER',
    year: 2032,
    days: [20, 21, 22, 23],
    rows: [{ lrn: ctx.studentA.lrn, name: 'A', marks: ['P', 'P', 'P', 'A'] }],
  });
  const novemberBuffer = await buildGridWorkbook({
    month: 'NOVEMBER',
    year: 2032,
    days: [3, 4, 5, 6, 7],
    rows: [{ lrn: ctx.studentA.lrn, name: 'A', marks: ['P', 'A', 'A', 'A', 'A'] }],
  });

  const target = { mode: 'daily', sectionId: ctx.section.id };
  const calls = [];
  const original = riskEngine.recalculateRiskForStudents;
  riskEngine.recalculateRiskForStudents = async (studentIds, gradingPeriodId) => {
    calls.push({ studentIds: [...studentIds], gradingPeriodId });
    return original(studentIds, gradingPeriodId);
  };

  try {
    for (const [buffer, month] of [
      [octoberBuffer, 10],
      [novemberBuffer, 11],
    ]) {
      const { inspect, validate, symbolMap } = await runToValidate({
        token: ctx.adviser.token,
        buffer,
        anchors: { lrnColumn: 1, dayRow: 4, month, year: 2032 },
        target,
      });
      assert.equal(validate.status, 200, JSON.stringify(validate.body));

      const commitRes = await api.post(`${BASE}/commit`, {
        token: ctx.adviser.token,
        body: {
          ...target,
          students: inspect.students,
          symbolMap,
          conflictDecisions: Object.fromEntries(validate.body.conflicts.map((c) => [c.date, 'overwrite'])),
        },
      });
      assert.equal(commitRes.status, 201, JSON.stringify(commitRes.body));
      assert.equal(commitRes.body.recalculatedPeriods, 1);
    }
  } finally {
    riskEngine.recalculateRiskForStudents = original;
  }

  // Two imports, two periods, nine dates -> exactly two calls.
  assert.equal(calls.length, 2);
  assert.deepEqual(
    calls.map((c) => c.gradingPeriodId),
    [ctx.periods[0].id, ctx.periods[1].id]
  );
  assert.ok(calls.every((c) => c.studentIds.length === 1 && c.studentIds[0] === ctx.studentA.id));
});

test('a failure partway through a commit leaves no partial rows', async () => {
  const buffer = await buildGridWorkbook({
    month: 'NOVEMBER',
    year: 2032,
    days: [20, 21],
    rows: [{ lrn: ctx.studentA.lrn, name: 'A', marks: ['P', 'P'] }],
  });

  const target = { mode: 'daily', sectionId: ctx.section.id };
  const { inspect, validate, symbolMap } = await runToValidate({
    token: ctx.adviser.token,
    buffer,
    anchors: { lrnColumn: 1, dayRow: 4, month: 11, year: 2032 },
    target,
  });
  assert.equal(validate.status, 200, JSON.stringify(validate.body));

  // Fail on the second date only. The first has already been written inside
  // the transaction by then, which is precisely the half-written month the
  // transaction exists to prevent.
  const original = dailyAttendanceModel.recordAttendance;
  let dateCount = 0;
  dailyAttendanceModel.recordAttendance = async (args) => {
    dateCount += 1;
    if (dateCount === 2) throw new Error('simulated failure partway through the import');
    return original(args);
  };

  let status;
  try {
    const res = await api.post(`${BASE}/commit`, {
      token: ctx.adviser.token,
      body: { ...target, students: inspect.students, symbolMap },
    });
    status = res.status;
  } finally {
    dailyAttendanceModel.recordAttendance = original;
  }

  assert.equal(status, 500);
  const rows = await pool.query(
    'SELECT 1 FROM daily_attendance_records WHERE student_id = $1 AND attendance_date = ANY($2::date[])',
    [ctx.studentA.id, ['2032-11-20', '2032-11-21']]
  );
  assert.equal(rows.rowCount, 0, 'the first date must have been rolled back with the second');
});

test("an adviser cannot import into another adviser's section", async () => {
  const buffer = await buildGridWorkbook({
    month: 'OCTOBER',
    year: 2032,
    days: [28],
    rows: [{ lrn: ctx.outsider.lrn, name: 'Outsider', marks: ['P'] }],
  });

  const { validate } = await runToValidate({
    token: ctx.adviser.token,
    buffer,
    anchors: { lrnColumn: 1, dayRow: 4, month: 10, year: 2032 },
    target: { mode: 'daily', sectionId: ctx.otherSection.id },
  });
  assert.equal(validate.status, 403);
});

test('a registrar can import the daily register but not subject attendance', async () => {
  const buffer = await buildGridWorkbook({
    month: 'OCTOBER',
    year: 2032,
    days: [29],
    rows: [{ lrn: ctx.studentA.lrn, name: 'A', marks: ['P'] }],
  });
  const anchors = { lrnColumn: 1, dayRow: 4, month: 10, year: 2032 };

  // Daily is the registrar's to write, same as on the marking sheet.
  const daily = await runToValidate({
    token: ctx.registrar.token,
    buffer,
    anchors,
    target: { mode: 'daily', sectionId: ctx.section.id },
  });
  assert.equal(daily.validate.status, 200, JSON.stringify(daily.validate.body));

  // Subject attendance belongs to whoever teaches the class — registrar is
  // deliberately not privileged there.
  const asRegistrar = await runToValidate({
    token: ctx.registrar.token,
    buffer,
    anchors,
    target: { mode: 'subject', classOfferingId: ctx.offering.id },
  });
  assert.equal(asRegistrar.validate.status, 403);

  // The teacher who does teach it can.
  const asTeacher = await runToValidate({
    token: ctx.teacher.token,
    buffer,
    anchors,
    target: { mode: 'subject', classOfferingId: ctx.offering.id },
  });
  assert.equal(asTeacher.validate.status, 200, JSON.stringify(asTeacher.validate.body));

  const commitRes = await api.post(`${BASE}/commit`, {
    token: ctx.teacher.token,
    body: {
      mode: 'subject',
      classOfferingId: ctx.offering.id,
      students: asTeacher.inspect.students,
      symbolMap: asTeacher.symbolMap,
    },
  });
  assert.equal(commitRes.status, 201, JSON.stringify(commitRes.body));
  // Subject attendance never feeds the risk formula, so nothing is
  // recalculated for it (CLAUDE.md: "supplementary, not used in risk
  // scoring").
  assert.equal(commitRes.body.recalculatedPeriods, 0);

  const written = await pool.query(
    'SELECT status FROM subject_attendance_records WHERE student_id = $1 AND class_offering_id = $2 AND attendance_date = $3',
    [ctx.studentA.id, ctx.offering.id, '2032-10-29']
  );
  assert.equal(written.rows[0].status, 'present');
});

test('every mark in the file must be given a meaning before anything is written', async () => {
  const buffer = await buildGridWorkbook({
    month: 'OCTOBER',
    year: 2032,
    days: [30],
    rows: [{ lrn: ctx.studentA.lrn, name: 'A', marks: ['??'] }],
  });

  const inspectRes = await api.upload(`${BASE}/inspect`, {
    token: ctx.adviser.token,
    buffer,
    fields: { lrnColumn: 1, dayRow: 4, month: 10, year: 2032 },
  });
  assert.equal(inspectRes.status, 200, JSON.stringify(inspectRes.body));
  // An unrecognised mark is surfaced with no guess attached — the user has
  // to say what it means.
  assert.equal(inspectRes.body.suggestedSymbolMap['??'], null);

  const res = await api.post(`${BASE}/validate`, {
    token: ctx.adviser.token,
    body: {
      mode: 'daily',
      sectionId: ctx.section.id,
      students: inspectRes.body.students,
      symbols: inspectRes.body.symbols,
      symbolMap: inspectRes.body.suggestedSymbolMap,
    },
  });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /\?\?/);
});

test('an imported mark points at the import that wrote it, and the audit row matches', async () => {
  const buffer = await buildGridWorkbook({
    month: 'OCTOBER',
    year: 2032,
    days: [25, 26],
    rows: [{ lrn: ctx.studentA.lrn, name: 'A', marks: ['P', 'A'] }],
  });

  const target = { mode: 'daily', sectionId: ctx.section.id };
  const { inspect, symbolMap } = await runToValidate({
    token: ctx.adviser.token,
    buffer,
    anchors: { lrnColumn: 1, dayRow: 4, month: 10, year: 2032 },
    target,
  });

  const commitRes = await api.post(`${BASE}/commit`, {
    token: ctx.adviser.token,
    body: { ...target, students: inspect.students, symbolMap, fileName: 'provenance.xlsx' },
  });
  assert.equal(commitRes.status, 201, JSON.stringify(commitRes.body));
  assert.ok(commitRes.body.importId, 'the commit must report the import it created');

  const rows = await pool.query(
    'SELECT attendance_date, import_id FROM daily_attendance_records WHERE student_id = $1 AND attendance_date = ANY($2::date[]) ORDER BY attendance_date',
    [ctx.studentA.id, ['2032-10-25', '2032-10-26']]
  );
  assert.equal(rows.rowCount, 2);
  assert.ok(rows.rows.every((r) => r.import_id === commitRes.body.importId));

  // The audit row the marks point at describes this run: the file, who ran
  // it, and how many rows it actually wrote (filled in after the writes,
  // inside the same transaction).
  const audit = await pool.query('SELECT * FROM bulk_imports WHERE id = $1', [commitRes.body.importId]);
  assert.equal(audit.rows[0].file_name, 'provenance.xlsx');
  assert.equal(audit.rows[0].performed_by, ctx.adviser.id);
  assert.equal(audit.rows[0].import_type, 'attendance_daily');
  assert.equal(audit.rows[0].success_count, 2);
});

test('correcting an imported day by hand clears the import attribution', async () => {
  // Carries on from the previous test: 25 October was imported.
  const before = await pool.query(
    'SELECT import_id FROM daily_attendance_records WHERE student_id = $1 AND attendance_date = $2',
    [ctx.studentA.id, '2032-10-25']
  );
  assert.ok(before.rows[0].import_id, 'precondition: the day should still be attributed to the import');

  const res = await api.post('/api/attendance/daily', {
    token: ctx.adviser.token,
    body: {
      sectionId: ctx.section.id,
      attendanceDate: '2032-10-25',
      entries: [{ studentId: ctx.studentA.id, status: 'excused' }],
    },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));

  // The row is now hand-entered, so it must stop claiming it came from a
  // file. This is what the import_id line in the upsert's DO UPDATE SET
  // clause buys — without it the corrected row would keep the old pointer.
  const after = await pool.query(
    'SELECT status, import_id FROM daily_attendance_records WHERE student_id = $1 AND attendance_date = $2',
    [ctx.studentA.id, '2032-10-25']
  );
  assert.equal(after.rows[0].status, 'excused');
  assert.equal(after.rows[0].import_id, null);
});

test('attendance marked by hand carries no import attribution', async () => {
  const res = await api.post('/api/attendance/daily', {
    token: ctx.adviser.token,
    body: {
      sectionId: ctx.section.id,
      attendanceDate: '2032-10-27',
      entries: [{ studentId: ctx.studentA.id, status: 'present' }],
    },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));

  const row = await pool.query(
    'SELECT import_id FROM daily_attendance_records WHERE student_id = $1 AND attendance_date = $2',
    [ctx.studentA.id, '2032-10-27']
  );
  assert.equal(row.rows[0].import_id, null);
});

test('a commit that fails partway leaves no audit row either', async () => {
  const buffer = await buildGridWorkbook({
    month: 'OCTOBER',
    year: 2032,
    days: [17, 18],
    rows: [{ lrn: ctx.studentA.lrn, name: 'A', marks: ['P', 'P'] }],
  });

  const target = { mode: 'daily', sectionId: ctx.section.id };
  const { inspect, symbolMap } = await runToValidate({
    token: ctx.adviser.token,
    buffer,
    anchors: { lrnColumn: 1, dayRow: 4, month: 10, year: 2032 },
    target,
  });

  const original = dailyAttendanceModel.recordAttendance;
  let dateCount = 0;
  dailyAttendanceModel.recordAttendance = async (args) => {
    dateCount += 1;
    if (dateCount === 2) throw new Error('simulated failure after the audit row was written');
    return original(args);
  };

  try {
    const res = await api.post(`${BASE}/commit`, {
      token: ctx.adviser.token,
      body: { ...target, students: inspect.students, symbolMap, fileName: 'never-finished.xlsx' },
    });
    assert.equal(res.status, 500);
  } finally {
    dailyAttendanceModel.recordAttendance = original;
  }

  // The audit row is written first, inside the transaction, so a failure
  // rolls it back with the data. An import that did not finish must not
  // leave a record claiming it did.
  const audit = await pool.query('SELECT 1 FROM bulk_imports WHERE file_name = $1', ['never-finished.xlsx']);
  assert.equal(audit.rowCount, 0);
  const rows = await pool.query(
    'SELECT 1 FROM daily_attendance_records WHERE student_id = $1 AND attendance_date = ANY($2::date[])',
    [ctx.studentA.id, ['2032-10-17', '2032-10-18']]
  );
  assert.equal(rows.rowCount, 0);
});

test('dates are resolved only within the section\'s own school year', async () => {
  // December 2032 is outside this section's school year, but IS covered by
  // the decoy school year created in before(). The unscoped lookup would
  // have found that period and filed a month of attendance under another
  // year, with nothing on the row to reveal it.
  const decoy = await pool.query('SELECT id FROM grading_periods WHERE school_year_id = $1', [
    ctx.otherSchoolYearId,
  ]);
  assert.equal(decoy.rowCount, 1, 'precondition: the decoy year must have a period covering December');

  const buffer = await buildGridWorkbook({
    month: 'DECEMBER',
    year: 2032,
    days: [7, 8],
    rows: [{ lrn: ctx.studentA.lrn, name: 'A', marks: ['P', 'A'] }],
  });

  const target = { mode: 'daily', sectionId: ctx.section.id };
  const { validate } = await runToValidate({
    token: ctx.adviser.token,
    buffer,
    anchors: { lrnColumn: 1, dayRow: 4, month: 12, year: 2032 },
    target,
  });

  assert.equal(validate.status, 200, JSON.stringify(validate.body));
  assert.deepEqual(validate.body.skipped.datesWithoutPeriod, ['2032-12-07', '2032-12-08']);
  assert.equal(validate.body.groups.length, 0);

  // And nothing landed in the other year's period.
  const leaked = await pool.query('SELECT 1 FROM daily_attendance_records WHERE grading_period_id = $1', [
    decoy.rows[0].id,
  ]);
  assert.equal(leaked.rowCount, 0);
});
