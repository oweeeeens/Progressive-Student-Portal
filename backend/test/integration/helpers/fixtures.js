// Builds and tears down isolated test data for the integration suite,
// reusing the app's own model functions (not hand-rolled INSERTs) wherever
// practical, so fixture setup exercises the same code paths the rest of the
// app relies on rather than a parallel, possibly-drifting copy of them.
//
// IMPORTANT ISOLATION NOTE: grading_periods has no school-year scoping on
// lookup (gradingPeriodModel.findByDate searches every period in the table,
// not just one school year's), so a test's date ranges must never overlap
// the real dev-seeded "2026-2027" school year's quarters (or another test
// file's ranges) — otherwise a date-based lookup could silently resolve to
// the WRONG period. gradeApproval/riskRecalculation tests dodge this by
// using their own dedicated, far-future school years (2030/2031) that don't
// overlap anything. The intervention test can't do that (see its own
// comments) and instead borrows whichever period genuinely covers today.
require('dotenv').config();

const { pool } = require('../../../config/db');
const userModel = require('../../../models/userModel');
const studentModel = require('../../../models/studentModel');
const schoolYearModel = require('../../../models/schoolYearModel');
const gradingPeriodModel = require('../../../models/gradingPeriodModel');
const sectionModel = require('../../../models/sectionModel');
const subjectModel = require('../../../models/subjectModel');
const classOfferingModel = require('../../../models/classOfferingModel');
const { signTestToken } = require('./auth');

let counter = 0;
// A short, call-unique suffix so every fixture this suite creates (emails,
// LRNs, school-year labels) is guaranteed not to collide with real dev/seed
// data or another test file's fixtures, even run back-to-back.
function nextTag(prefix) {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}`;
}

// school_years.label is VARCHAR(20) — nextTag's full timestamp form doesn't
// fit, so labels get a compact base36 variant instead: a few characters of
// the current time plus the call counter, which is still enough to avoid
// collisions within one test run.
function shortTag(prefix) {
  counter += 1;
  const compact = `${Date.now().toString(36).slice(-6)}${counter.toString(36)}`;
  return `${prefix}-${compact}`.slice(0, 20);
}

function uniqueLrn() {
  counter += 1;
  // '9' marks it as obviously-synthetic test data, never a real DepEd LRN.
  return `9${Date.now().toString().slice(-7)}${String(counter).padStart(4, '0')}`.slice(0, 12);
}

async function createStaffUser(role, label) {
  const tag = nextTag(label);
  const user = await userModel.createUser({
    email: `${tag}@integration.test`,
    password: 'IntegrationTest123!',
    fullName: `Test ${label} ${tag}`,
    role,
  });
  return { ...user, token: signTestToken(user) };
}

async function createSchoolYearWithPeriods(label, periodSpecs) {
  const schoolYear = await schoolYearModel.createSchoolYear({
    label: shortTag(label),
    startDate: periodSpecs[0].startDate,
    endDate: periodSpecs[periodSpecs.length - 1].endDate,
  });
  const periods = [];
  for (const spec of periodSpecs) {
    const period = await gradingPeriodModel.createGradingPeriod({
      schoolYearId: schoolYear.id,
      name: spec.name,
      sequenceNumber: spec.sequenceNumber,
      startDate: spec.startDate,
      endDate: spec.endDate,
    });
    periods.push(period);
  }
  return { schoolYearId: schoolYear.id, periods };
}

async function createTestSection({ schoolYearId, adviserId, gradeLevel = 11, label = 'section' }) {
  return sectionModel.createSection({
    schoolYearId,
    gradeLevel,
    strand: 'TEST',
    name: nextTag(label),
    adviserId,
  });
}

async function createTestSubject(label = 'subject') {
  // code is left null (nullable + UNIQUE) so repeated test runs never fight
  // over a code value.
  return subjectModel.createSubject({ name: nextTag(label), code: null, gradeLevel: 11 });
}

async function createTestOffering({ subjectId, sectionId, teacherId, schoolYearId }) {
  return classOfferingModel.createClassOffering({ subjectId, sectionId, teacherId, schoolYearId });
}

async function createTestStudent({ sectionId, label = 'student' }) {
  const tag = nextTag(label);
  const id = await studentModel.createStudent({
    lrn: uniqueLrn(),
    firstName: 'Test',
    lastName: tag,
    dateOfBirth: '2009-05-01',
    currentSectionId: sectionId,
  });
  return studentModel.findByIdUnscoped(id);
}

// The intervention flow resolves "the current grading period" from today's
// real wall-clock date (see interventionController.createIntervention) —
// there is no way to pass it a fixed test date. So instead of creating a
// competing period (which would collide with whichever real period already
// covers today), this finds the real one and reuses it. If none exists
// (e.g. this suite is ever run well outside the seeded school year's
// range), it falls back to creating a small dedicated one, and says so via
// `ownSchoolYear` so the caller's teardown knows to remove that too.
async function resolveOrCreateCurrentPeriod() {
  const todayIso = new Date().toISOString().slice(0, 10);
  const existing = await gradingPeriodModel.findByDate(todayIso);
  if (existing) {
    // gradingPeriodModel.getById doesn't select start_date/end_date (its
    // existing callers never need them) — query directly here rather than
    // widening a shared app model's column list just for test convenience.
    const result = await pool.query('SELECT * FROM grading_periods WHERE id = $1', [existing.id]);
    return { ...result.rows[0], ownSchoolYear: false };
  }

  // Covers the suite ever running well outside the seeded school year's
  // range (e.g. long after this capstone's defense date) — a small,
  // fully-owned school year covering a wide window around today, so it
  // still works even if run a day either side of "today" across a
  // timezone boundary.
  const { schoolYearId, periods } = await createSchoolYearWithPeriods('FB', [
    { name: 'Fallback', sequenceNumber: 1, startDate: todayIso, endDate: todayIso },
  ]);
  return { ...periods[0], school_year_id: schoolYearId, ownSchoolYear: true };
}

// Adds one more grading period to an EXISTING school year — both its date
// range AND its sequence_number are derived from whatever's already in that
// school year (re-queried on every call, so repeated calls within one test
// naturally chain correctly), never from the borrowed "current" period's own
// numbers alone — the school year may already define later periods (e.g. a
// real Q3/Q4) whose sequence_number a relative offset could collide with
// (UNIQUE(school_year_id, sequence_number)). Used by the intervention test
// to simulate "the next grading period" after borrowing the real current one.
async function appendFollowingPeriod(schoolYearId, { name, lengthDays = 14 }) {
  const existingPeriods = await gradingPeriodModel.listBySchoolYear(schoolYearId);
  const latestEnd = existingPeriods.reduce((latest, p) => (p.end_date > latest ? p.end_date : latest), '0001-01-01');
  const maxSequenceNumber = existingPeriods.reduce((max, p) => Math.max(max, p.sequence_number), 0);

  const start = new Date(`${latestEnd}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() + 1);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + lengthDays - 1);

  return gradingPeriodModel.createGradingPeriod({
    schoolYearId,
    name,
    sequenceNumber: maxSequenceNumber + 1,
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  });
}

// Deletes everything this suite created, in FK-safe order (children before
// parents — every FK in this schema is ON DELETE RESTRICT, so parents must
// go last). Every table is scoped by EXPLICIT ids this test created, never
// by school_year_id alone — the intervention test borrows the real current
// school year (see resolveOrCreateCurrentPeriod), which also holds real
// seed-data sections/offerings a school_year_id-scoped DELETE would wipe out.
// `schoolYearId`/`ownSchoolYear` are used only for the final step: the
// school_years row (and its original periods) is deleted only when this
// suite created that school year itself.
async function teardown({
  schoolYearId,
  ownSchoolYear = true,
  gradingPeriodIds = [],
  userIds = [],
  studentIds = [],
  subjectIds = [],
  sectionIds = [],
  offeringIds = [],
}) {
  if (studentIds.length > 0) {
    await pool.query('DELETE FROM interventions WHERE student_id = ANY($1::int[])', [studentIds]);
    await pool.query('DELETE FROM risk_assessments WHERE student_id = ANY($1::int[])', [studentIds]);
    await pool.query('DELETE FROM grades WHERE student_id = ANY($1::int[])', [studentIds]);
    await pool.query('DELETE FROM daily_attendance_records WHERE student_id = ANY($1::int[])', [studentIds]);
    await pool.query('DELETE FROM subject_attendance_records WHERE student_id = ANY($1::int[])', [studentIds]);
    await pool.query('DELETE FROM students WHERE id = ANY($1::int[])', [studentIds]);
  }
  if (offeringIds.length > 0) {
    await pool.query('DELETE FROM class_offerings WHERE id = ANY($1::int[])', [offeringIds]);
  }
  if (sectionIds.length > 0) {
    await pool.query('DELETE FROM sections WHERE id = ANY($1::int[])', [sectionIds]);
  }
  // subjects aren't scoped to a school_year_id, so they need their own list
  // — safe to delete now that every class_offering referencing them (above)
  // is gone.
  if (subjectIds.length > 0) {
    await pool.query('DELETE FROM subjects WHERE id = ANY($1::int[])', [subjectIds]);
  }
  // Periods this suite created directly (e.g. the intervention test's
  // synthetic "next period(s)" appended onto a borrowed school year) — safe
  // to delete by id regardless of whether the whole school year is ours.
  if (gradingPeriodIds.length > 0) {
    await pool.query('DELETE FROM grading_periods WHERE id = ANY($1::int[])', [gradingPeriodIds]);
  }
  if (schoolYearId && ownSchoolYear) {
    await pool.query('DELETE FROM grading_periods WHERE school_year_id = $1', [schoolYearId]);
    await pool.query('DELETE FROM school_years WHERE id = $1', [schoolYearId]);
  }
  if (userIds.length > 0) {
    await pool.query('DELETE FROM users WHERE id = ANY($1::int[])', [userIds]);
  }

  // config/db.js's pool is never explicitly closed by the running app (it's
  // meant to live for the server process's whole lifetime) — but a pg.Pool
  // with open/idle connections keeps Node's event loop alive forever, which
  // otherwise hangs this test file's process after its last test finishes.
  // Ending it here, once, as the final teardown step is what lets `node
  // --test` actually exit.
  await pool.end();
}

module.exports = {
  createStaffUser,
  createSchoolYearWithPeriods,
  createTestSection,
  createTestSubject,
  createTestOffering,
  createTestStudent,
  resolveOrCreateCurrentPeriod,
  appendFollowingPeriod,
  teardown,
};
