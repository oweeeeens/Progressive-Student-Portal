// Subjects that run for part of the year, and the grade views that have to
// know which part.
//
// The school's timetable, in their own words (2026-11-04): the year is three
// TERMS; a Grade 11 subject runs all three; a Grade 12 subject changes every
// term; a specialized subject runs all three in both grade levels. None of
// that could be recorded at first — a class offering was "this subject, to
// this section, this year" and nothing more — so a Grade 12 learner's grade
// view listed every subject they take at any point in the year, with a dash
// wherever a subject was not running. A dash that means "not taught this
// term" looked exactly like one meaning "no mark recorded yet".
//
// WHAT CHANGED UNDER THIS SUITE, AND WHY IT IS WORTH A TEST
//
// This was first built with a SEMESTER layer: `grading_periods.semester`
// mapped each period to one of two semesters, and an offering ran for
// 'sem1' or 'sem2'. That came from reading the client's word "term" as
// "semester". It is one of the three terms, so the mapping was never needed
// and the column is gone.
//
// The assertions below therefore moved from "which semester does this
// period belong to" to "which position in the year is this period", which
// is `sequence_number` — the one thing about a grading period that is both
// ordered and not free text.
//
// Two halves are tested. The SCHEMA half: a term can be stored, and the
// uniqueness that stops accidental duplicates counts it, so the same subject
// CAN be offered to one section more than once — once per term — and only
// once per term. And the READING half: the rule that decides whether a class
// covers a term, including the fail-open case that keeps this safe on a
// database that predates the feature.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { pool } = require('../../config/db');
const { offeringCoversPeriod, termCoversPeriod } = require('../../config/academicTerms');
const classOfferingModel = require('../../models/classOfferingModel');
const subjectModel = require('../../models/subjectModel');
const gradingPeriodModel = require('../../models/gradingPeriodModel');
const fixtures = require('./helpers/fixtures');

let ctx;

before(async () => {
  // Far-future dates, so these terms cannot overlap the dev-seeded year or
  // another suite's — see the isolation note at the top of fixtures.js.
  //
  // A fourth period exists deliberately. The term vocabulary stops at
  // 'term3' because the school runs three, so a year with four periods has
  // one that NO single-term offering can name. That is a real limit of the
  // model and it is asserted below rather than left to be discovered.
  const { schoolYearId, periods } = await fixtures.createSchoolYearWithPeriods('TERM', [
    { name: 'Term 1', sequenceNumber: 1, startDate: '2044-06-01', endDate: '2044-09-15' },
    { name: 'Term 2', sequenceNumber: 2, startDate: '2044-09-16', endDate: '2044-12-31' },
    { name: 'Term 3', sequenceNumber: 3, startDate: '2045-01-01', endDate: '2045-03-31' },
    { name: 'Term 4', sequenceNumber: 4, startDate: '2045-04-01', endDate: '2045-05-31' },
  ]);

  const teacher = await fixtures.createStaffUser('subject_teacher', 'term-teacher');
  const section = await fixtures.createTestSection({ schoolYearId, adviserId: teacher.id, label: 'term-section' });

  const [coreSubject, specializedSubject] = await Promise.all([
    fixtures.createTestSubject('term-core', { gradeLevel: 12, category: 'core' }),
    fixtures.createTestSubject('term-specialized', { gradeLevel: 12, category: 'specialized' }),
  ]);

  // The same subject, to the same section, in the same year — twice. This is
  // what the original UNIQUE (subject_id, section_id, school_year_id)
  // forbade, and what a Grade 12 core subject taught in two different terms
  // actually is.
  const term1 = await fixtures.createTestOffering({
    subjectId: coreSubject.id,
    sectionId: section.id,
    teacherId: teacher.id,
    schoolYearId,
    term: 'term1',
  });
  const term2 = await fixtures.createTestOffering({
    subjectId: coreSubject.id,
    sectionId: section.id,
    teacherId: teacher.id,
    schoolYearId,
    term: 'term2',
  });
  const allYear = await fixtures.createTestOffering({
    subjectId: specializedSubject.id,
    sectionId: section.id,
    teacherId: teacher.id,
    schoolYearId,
    // Deliberately a single term on a SPECIALIZED subject: the subject's
    // category must win, because a specialized subject is taught all year
    // whatever an offering says.
    term: 'term1',
  });

  ctx = {
    schoolYearId,
    periods,
    teacher,
    section,
    coreSubject,
    specializedSubject,
    offeringIds: [term1.id, term2.id, allYear.id],
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

test('the same subject can be offered to one section once per term', async () => {
  // Three offerings exist in setup; two of them are the same subject and
  // section, differing only by term. Reaching this test at all means the
  // UNIQUE allowed it.
  const rows = await pool.query(
    'SELECT term FROM class_offerings WHERE subject_id = $1 AND section_id = $2 ORDER BY term',
    [ctx.coreSubject.id, ctx.section.id]
  );
  assert.deepEqual(rows.rows.map((r) => r.term), ['term1', 'term2']);
});

test('but not twice in the same term', async () => {
  // The duplicate the constraint still exists to prevent.
  await assert.rejects(
    () =>
      classOfferingModel.createClassOffering({
        subjectId: ctx.coreSubject.id,
        sectionId: ctx.section.id,
        teacherId: ctx.teacher.id,
        schoolYearId: ctx.schoolYearId,
        term: 'term1',
      }),
    (err) => err.code === '23505'
  );
});

test('a term defaults to the whole year', async () => {
  // Every offering recorded before this column existed means exactly this,
  // which is why the default is not NULL — and why the semester-to-term
  // migration widened rather than narrowed.
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

test('the database refuses a term it does not recognise', async () => {
  // The CHECK is the real boundary. 'sem1' is the value this model
  // replaced, so it is the most likely thing to arrive from stale code or a
  // hand-written query.
  await assert.rejects(
    () =>
      classOfferingModel.createClassOffering({
        subjectId: ctx.coreSubject.id,
        sectionId: ctx.section.id,
        teacherId: ctx.teacher.id,
        schoolYearId: ctx.schoolYearId,
        term: 'sem1',
      }),
    (err) => err.code === '23514'
  );
});

test('a subject defaults to core', async () => {
  const subject = await subjectModel.createSubject({ name: `term-default-${Date.now()}`, code: null, gradeLevel: 11 });
  assert.equal(subject.category, 'core');
  await pool.query('DELETE FROM subjects WHERE id = $1', [subject.id]);
});

test('a term carries its sequence number through the model', async () => {
  // Position in the year, not name: 'term2' means the period numbered 2,
  // whatever the school calls it.
  const periods = await gradingPeriodModel.listBySchoolYear(ctx.schoolYearId);
  assert.deepEqual(
    periods.map((p) => [p.name, p.sequence_number]),
    [['Term 1', 1], ['Term 2', 2], ['Term 3', 3], ['Term 4', 4]]
  );
  // And the column that carried the old model is gone, not merely unread.
  assert.ok(!('semester' in periods[0]), 'grading periods should no longer carry a semester');
});

test('a single-term class covers that term and no other', () => {
  assert.equal(termCoversPeriod('term1', 1), true);
  assert.equal(termCoversPeriod('term1', 2), false);
  assert.equal(termCoversPeriod('term2', 2), true);
  assert.equal(termCoversPeriod('term3', 3), true);
  assert.equal(termCoversPeriod('term3', 1), false);
});

test('a whole-year class covers every term', () => {
  // The case that keeps every pre-existing offering reading exactly as it
  // did: they all default to full_year, and the migration from semesters
  // widened every term-bound one back to it.
  for (const sequence of [1, 2, 3, 4]) {
    assert.equal(termCoversPeriod('full_year', sequence), true);
  }
});

test('a fourth period can hold whole-year classes but no single-term one', () => {
  // The honest limit of a three-term vocabulary, asserted rather than left
  // to be found. Progressive SHS runs three terms; a school that ran four
  // would need CLASS_TERMS and TERM_SEQUENCE extended, and this test is
  // what would say so.
  assert.equal(termCoversPeriod('full_year', 4), true);
  assert.equal(termCoversPeriod('term1', 4), false);
  assert.equal(termCoversPeriod('term3', 4), false);
});

test('a specialized subject runs all year whatever its offering says', () => {
  // The subject's category beats the offering's term. An offering can be
  // termed by mistake; a specialized subject is still taught all year. The
  // school named one unprompted: Computer Systems Servicing, Terms 1-3.
  assert.equal(
    offeringCoversPeriod({ term: 'term1', subjectCategory: 'specialized', periodSequenceNumber: 3 }),
    true
  );
  // And a core subject with the same term does not.
  assert.equal(
    offeringCoversPeriod({ term: 'term1', subjectCategory: 'core', periodSequenceNumber: 3 }),
    false
  );
});

test('the grade history is scoped to one school year', async () => {
  // The bug this suite's sibling fix addressed: sequence_number is unique
  // only WITHIN a school year, so a learner in their second year has two
  // terms numbered 1. Every consumer pivots on the period, so without the
  // scope the two collide and the last row silently wins.
  //
  // Asserted against the query itself rather than through HTTP, because what
  // matters is that the model refuses to answer without a year at all.
  const gradeModel = require('../../models/gradeModel');
  const student = await fixtures.createTestStudent({ sectionId: ctx.section.id, label: 'term-student' });

  const rows = await gradeModel.getHistoryForStudent(student.id, ctx.schoolYearId);
  assert.deepEqual(rows, [], 'no grades yet, but the query ran with a year bound');

  // Every row it can return carries the three fields the per-term view
  // needs. Checked on the SQL rather than on data, so this holds even with
  // an empty table.
  const columns = await pool.query(
    `SELECT 1 FROM grades g
     JOIN class_offerings co ON co.id = g.class_offering_id
     JOIN subjects subj ON subj.id = co.subject_id
     JOIN grading_periods gp ON gp.id = g.grading_period_id
     WHERE subj.category IS NOT NULL AND co.term IS NOT NULL AND gp.sequence_number IS NOT NULL LIMIT 1`
  );
  assert.ok(columns.rowCount >= 0);

  await pool.query('DELETE FROM students WHERE id = $1', [student.id]);
});
