// How long a subject runs, and which quarters that covers.
//
// All of this is school policy rather than program logic, so it lives here
// in one file the way the risk thresholds do — a panelist (or the client)
// can be pointed at this one screen rather than at six query strings spread
// across the models.
//
// The policy, as the client describes their timetable:
//
//   * Grade 11 subjects run for all three quarters of the school year.
//   * Grade 12 subjects change every semester…
//   * …EXCEPT specialized subjects, which run the whole year in both grade
//     levels.
//
// Note that three quarters do not divide evenly into two semesters. That is
// why `grading_periods.semester` is a stored column the admin fills in and
// not something computed from `sequence_number`: only the school knows where
// their semester boundary falls, and it is not in the middle of a quarter.

// DepEd's grouping for Senior High subjects.
const SUBJECT_CATEGORIES = ['core', 'applied', 'specialized'];
const DEFAULT_SUBJECT_CATEGORY = 'core';

// How long one class offering runs.
//
// An enum with an explicit 'full_year' member rather than a nullable
// "semester" column, deliberately: Postgres treats NULLs as distinct in a
// UNIQUE constraint, so a nullable column meaning "whole year" would let the
// same subject be offered to the same section twice for the whole year
// without the constraint noticing.
const CLASS_TERMS = ['full_year', 'sem1', 'sem2'];
const DEFAULT_CLASS_TERM = 'full_year';

// Which semester number each term covers. `full_year` covers both, which is
// why it is not in this map — see termCoversSemester below.
const TERM_SEMESTER = { sem1: 1, sem2: 2 };

// Reader-facing labels. Kept beside the values so a new term cannot be added
// without someone deciding what it is called.
const SUBJECT_CATEGORY_LABELS = {
  core: 'Core',
  applied: 'Applied',
  specialized: 'Specialized',
};

const CLASS_TERM_LABELS = {
  full_year: 'Whole school year',
  sem1: 'First semester',
  sem2: 'Second semester',
};

/**
 * Does a class running for `term` cover a quarter belonging to `semester`?
 *
 * The two fail-open cases are deliberate and are what keep this safe to
 * deploy onto a database that predates the feature:
 *
 *   * A `full_year` class covers every quarter, whatever the semester says.
 *     Every class offering that existed before this feature defaults to
 *     `full_year`, so nothing already recorded changes meaning.
 *   * A quarter with no semester assigned yet (`semester` is NULL until an
 *     admin fills it in) is treated as covered. The alternative — hiding the
 *     quarter — would make a school that has not finished its Academic Setup
 *     look as though its grades had disappeared.
 */
function termCoversSemester(term, semester) {
  if (term === 'full_year' || !term) return true;
  if (semester === null || semester === undefined) return true;
  return TERM_SEMESTER[term] === Number(semester);
}

/**
 * Does this subject run the whole year regardless of its class offering's
 * term? Specialized subjects do, in both grade levels — they are the
 * strand's through-line, so the school does not break them at the semester.
 *
 * This is why the question is asked of the SUBJECT and not only of the
 * offering: an offering can be recorded as `sem1` by mistake, but a
 * specialized subject is still taught all year.
 */
function subjectRunsAllYear(category) {
  return category === 'specialized';
}

/**
 * The one question the grade views actually ask: should this subject's class
 * appear in this quarter?
 *
 * Takes the pieces rather than a row, so it can be called from the model
 * layer, a controller and the report card without any of them agreeing on a
 * row shape first.
 */
function offeringCoversPeriod({ term, subjectCategory, periodSemester }) {
  if (subjectRunsAllYear(subjectCategory)) return true;
  return termCoversSemester(term, periodSemester);
}

module.exports = {
  SUBJECT_CATEGORIES,
  DEFAULT_SUBJECT_CATEGORY,
  SUBJECT_CATEGORY_LABELS,
  CLASS_TERMS,
  DEFAULT_CLASS_TERM,
  CLASS_TERM_LABELS,
  TERM_SEMESTER,
  termCoversSemester,
  subjectRunsAllYear,
  offeringCoversPeriod,
};
