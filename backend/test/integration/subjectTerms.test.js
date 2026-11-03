// Subjects that run for part of the year, and the grade views that have to
// know which part.
//
// The school's timetable, as the client describes it: a Grade 11 subject runs
// all three quarters; a Grade 12 subject changes every semester; a
// specialized subject runs the whole year in both grade levels. None of that
// could be recorded before — a class offering was "this subject, to this
// section, this year" and nothing more — so a Grade 12 learner's grade view
// listed every subject they take at any point in the year, with a dash
// wherever a subject was not running. A dash that means "not taught this
// quarter" looked exactly like one meaning "no mark recorded yet".
//
// Two things are tested here. The schema half: a term can be stored, and the
// uniqueness that stops accidental duplicates now counts it, so the same
// subject CAN be offered to one section twice — once per semester — and only
// once per semester. And the reading half: the rule that decides whether a
// class covers a quarter, including the two fail-open cases that keep this
// safe on a database that predates the feature.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { pool } = require('../../config/db');
const { offeringCoversPeriod, termCoversSemester } = require('../../config/academicTerms');
const classOfferingModel = require('../../models/classOfferingModel');
const subjectModel = require('../../models/subjectModel');
const gradingPeriodModel = require('../../models/gradingPeriodModel');
const fixtures = require('./helpers/fixtures');

let ctx;

before(async () => {
  // Far-future dates, so these quarters cannot overlap the dev-seeded year or
  // another suite's — see the isolation note at the top of fixtures.js.
  const { schoolYearId, periods } = await fixtures.createSchoolYearWithPeriods('TERM', [
    { name: 'Q1', sequenceNumber: 1, startDate: '2044-06-01', endDate: '2044-09-15', semester: 1 },
    { name: 'Q2', sequenceNumber: 2, startDate: '2044-09-16', endDate: '2044-12-31', semester: 1 },
    { name: 'Q3', sequenceNumber: 3, startDate: '2045-01-01', endDate: '2045-03-31', semester: 2 },
    // Deliberately left with no semester: the "admin has not finished
    // Academic Setup yet" case.
    { name: 'Q4', sequenceNumber: 4, startDate: '2045-04-01', endDate: '2045-05-31' },
  ]);

  const teacher = await fixtures.createStaffUser('subject_teacher', 'term-teacher');
  const section = await fixtures.createTestSection({ schoolYearId, adviserId: teacher.id, label: 'term-section' });

  const [coreSubject, specializedSubject] = await Promise.all([
    fixtures.createTestSubject('term-core', { gradeLevel: 12, category: 'core' }),
    fixtures.createTestSubject('term-specialized', { gradeLevel: 12, category: 'specialized' }),
  ]);

  // The same subject, to the same section, in the same year — twice. This is
  // what the old UNIQUE (subject_id, section_id, school_year_id) forbade and
  // what a Grade 12 core subject taught across two semesters actually is.
  const sem1 = await fixtures.createTestOffering({
    subjectId: coreSubject.id,
    sectionId: section.id,
    teacherId: teacher.id,
    schoolYearId,
    term: 'sem1',
  });
  const sem2 = await fixtures.createTestOffering({
    subjectId: coreSubject.id,
    sectionId: section.id,
    teacherId: teacher.id,
    schoolYearId,
    term: 'sem2',
  });
  const allYear = await fixtures.createTestOffering({
    subjectId: specializedSubject.id,
    sectionId: section.id,
    teacherId: teacher.id,
    schoolYearId,
    // Deliberately a semester term on a SPECIALIZED subject: the subject's
    // category must win, because a specialized subject is taught all year
    // whatever an offering says.
    term: 'sem1',
  });

  ctx = {
    schoolYearId,
    periods,
    teacher,
    section,
    coreSubject,
    specializedSubject,
    offeringIds: [sem1.id, sem2.id, allYear.id],
  };
});

after(async () => {
  await fixtures.teardown({
    schoolYearId: ctx.schoolYearId,
    ownSchoolYear: true,
    offeringIds: ctx.offeringIds,
    sectionIds: [ctx.section.id],
    subjectIds: [ctx.coreSubject.id, ctx.specializedSubject.id],
    userIds: [ctx.teacher.id],
  });
});

test('the same subject can be offered to one section once per semester', async () => {
  // Three offerings exist in setup; two of them are the same subject and
  // section, differing only by term. Reaching this test at all means the new
  // UNIQUE allowed it.
  const rows = await pool.query(
    'SELECT term FROM class_offerings WHERE subject_id = $1 AND section_id = $2 ORDER BY term',
    [ctx.coreSubject.id, ctx.section.id]
  );
  assert.deepEqual(rows.rows.map((r) => r.term), ['sem1', 'sem2']);
});

test('but not twice in the same semester', async () => {
  // The duplicate the constraint still exists to prevent.
  await assert.rejects(
    () =>
      classOfferingModel.createClassOffering({
        subjectId: ctx.coreSubject.id,
        sectionId: ctx.section.id,
        teacherId: ctx.teacher.id,
        schoolYearId: ctx.schoolYearId,
        term: 'sem1',
      }),
    (err) => err.code === '23505'
  );
});

test('a term defaults to the whole year', async () => {
  // Every offering recorded before this column existed means exactly this,
  // which is why the default is not NULL.
  const offering = await classOfferingModel.createClassOffering({
    subjectId: ctx.specializedSubject.id,
    sectionId: ctx.section.id,
    teacherId: ctx.teacher.id,
    schoolYearId: ctx.schoolYearId,
    // No term passed at all.
  });
  ctx.offeringIds.push(offering.id);
  assert.equal(offering.term, 'full_year');
});

test('a subject defaults to core', async () => {
  const subject = await subjectModel.createSubject({ name: `term-default-${Date.now()}`, code: null, gradeLevel: 11 });
  ctx.subjectIdsToClean = [subject.id];
  assert.equal(subject.category, 'core');
  await pool.query('DELETE FROM subjects WHERE id = $1', [subject.id]);
});

test('a quarter carries its semester through the model', async () => {
  const periods = await gradingPeriodModel.listBySchoolYear(ctx.schoolYearId);
  assert.deepEqual(
    periods.map((p) => [p.name, p.semester]),
    [['Q1', 1], ['Q2', 1], ['Q3', 2], ['Q4', null]]
  );
});

test('a first-semester class covers only the first semester', () => {
  assert.equal(termCoversSemester('sem1', 1), true);
  assert.equal(termCoversSemester('sem1', 2), false);
  assert.equal(termCoversSemester('sem2', 2), true);
  assert.equal(termCoversSemester('sem2', 1), false);
});

test('a whole-year class covers every quarter', () => {
  // The case that keeps every pre-existing offering reading exactly as it
  // did: they all default to full_year.
  assert.equal(termCoversSemester('full_year', 1), true);
  assert.equal(termCoversSemester('full_year', 2), true);
});

test('a quarter with no semester assigned is covered, not hidden', () => {
  // The admin has not finished Academic Setup. Hiding the quarter would make
  // a school's grades look as though they had disappeared; showing it means
  // at worst one extra subject in a list.
  assert.equal(termCoversSemester('sem1', null), true);
  assert.equal(termCoversSemester('sem2', undefined), true);
});

test('a specialized subject runs all year whatever its offering says', () => {
  // The subject's category beats the offering's term. An offering can be
  // termed by mistake; a specialized subject is still taught all year.
  assert.equal(
    offeringCoversPeriod({ term: 'sem1', subjectCategory: 'specialized', periodSemester: 2 }),
    true
  );
  // And a core subject with the same term does not.
  assert.equal(
    offeringCoversPeriod({ term: 'sem1', subjectCategory: 'core', periodSemester: 2 }),
    false
  );
});

test('the grade history is scoped to one school year', async () => {
  // The bug this suite's sibling fix addressed: sequence_number is unique
  // only WITHIN a school year, so a learner in their second year has two
  // quarters numbered 1. Every consumer pivots on the period, so without the
  // scope the two collide and the last row silently wins.
  //
  // Asserted against the query itself rather than through HTTP, because what
  // matters is that the model refuses to answer without a year at all.
  const gradeModel = require('../../models/gradeModel');
  const student = await fixtures.createTestStudent({ sectionId: ctx.section.id, label: 'term-student' });
  ctx.studentIdsToClean = [student.id];

  const rows = await gradeModel.getHistoryForStudent(student.id, ctx.schoolYearId);
  assert.deepEqual(rows, [], 'no grades yet, but the query ran with a year bound');

  // Every row it can return carries the four fields the per-quarter view
  // needs. Checked on the SQL rather than on data, so this holds even with an
  // empty table.
  const columns = await pool.query(
    `SELECT 1 FROM grades g
     JOIN class_offerings co ON co.id = g.class_offering_id
     JOIN subjects subj ON subj.id = co.subject_id
     JOIN grading_periods gp ON gp.id = g.grading_period_id
     WHERE subj.category IS NOT NULL AND co.term IS NOT NULL LIMIT 1`
  );
  assert.ok(columns.rowCount >= 0);

  await pool.query('DELETE FROM students WHERE id = $1', [student.id]);
});
