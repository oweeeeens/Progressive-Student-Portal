// How long a subject runs, and which terms that covers.
//
// All of this is school policy rather than program logic, so it lives here
// in one file the way the risk thresholds do — a panelist (or the client)
// can be pointed at this one screen rather than at six query strings spread
// across the models.
//
// THE POLICY, in the school's own words (2026-11-04):
//
//   "sa grade 11 ngayon new curriculum buong term 1 to 3 same subj lang.
//    sa grade 12 nag iiba iba kada term ung subject maliban sa mga
//    specialized — na dyan sa Babbage ung Computer System Servicing buong
//    term 1-3 un."
//
//   * The school year is THREE TERMS. There are no semesters.
//   * A Grade 11 subject runs all three terms.
//   * A Grade 12 subject changes EVERY TERM.
//   * A specialized subject runs all three terms in both grade levels
//     (their example: Computer Systems Servicing).
//
// WHAT THIS REPLACED, AND WHY IT IS WORTH KNOWING
//
// This file used to carry a SEMESTER layer: `grading_periods.semester` said
// which of two semesters each period belonged to, and a class offering ran
// for 'sem1' or 'sem2'. That was a misreading of one word. The client said
// a Grade 12 subject changes each "term", and "term" was taken to mean a
// semester; it means one of the three terms above.
//
// The whole indirection existed only to bridge that mistake — three terms
// do not divide evenly into two semesters, so the boundary had to be stored
// by hand. With an offering naming its term directly there is nothing left
// to map, and the column is gone. The correction made the model smaller.

// DepEd's grouping for Senior High subjects.
const SUBJECT_CATEGORIES = ['core', 'applied', 'specialized'];
const DEFAULT_SUBJECT_CATEGORY = 'core';

// How long one class offering runs: the whole year, or exactly one term.
//
// An enum with an explicit 'full_year' member rather than a nullable
// reference to a grading period, deliberately: Postgres treats NULLs as
// DISTINCT in a UNIQUE constraint, so a nullable column meaning "whole
// year" would let the same subject be offered to the same section twice for
// the whole year without the constraint noticing.
//
// SIZED TO THIS SCHOOL'S THREE TERMS, and that is a real limit rather than
// an oversight. A school year configured with four grading periods would
// leave nothing able to say "the fourth one", and an offering marked
// 'term3' in a two-period year matches no period at all. Progressive SHS
// runs three terms; if that ever changes this list and TERM_SEQUENCE below
// are the two places to change.
const CLASS_TERMS = ['full_year', 'term1', 'term2', 'term3'];
const DEFAULT_CLASS_TERM = 'full_year';

// Which grading period each term IS. Matched on `sequence_number`, which is
// the only thing about a grading period that is both stable and ordered —
// `name` is free text the school sets ("Term 1", "Q1", anything), and ids
// differ per school year.
const TERM_SEQUENCE = { term1: 1, term2: 2, term3: 3 };

// Reader-facing labels. Kept beside the values so a new term cannot be added
// without someone deciding what it is called.
const SUBJECT_CATEGORY_LABELS = {
  core: 'Core',
  applied: 'Applied',
  specialized: 'Specialized',
};

const CLASS_TERM_LABELS = {
  full_year: 'Whole school year',
  term1: 'Term 1 only',
  term2: 'Term 2 only',
  term3: 'Term 3 only',
};

/**
 * Does a class running for `term` cover the period at `sequenceNumber`?
 *
 * One fail-open rule, and it is the one that matters: a `full_year` class
 * covers every term, whatever else is true. Every class offering recorded
 * before any of this existed defaults to `full_year`, so nothing already in
 * the database changes meaning.
 *
 * The second fail-open this file used to carry — "a period with no semester
 * assigned yet is treated as covered" — is GONE, because there is nothing
 * left to leave unset. `sequence_number` is NOT NULL on every grading
 * period, so a school part-way through its Academic Setup can no longer
 * produce a period that silently matches everything.
 */
function termCoversPeriod(term, sequenceNumber) {
  if (term === 'full_year' || !term) return true;
  return TERM_SEQUENCE[term] === Number(sequenceNumber);
}

/**
 * Does this subject run the whole year regardless of its class offering's
 * term? Specialized subjects do, in both grade levels — they are the
 * strand's through-line, so the school does not break them at a term
 * boundary.
 *
 * This is why the question is asked of the SUBJECT and not only of the
 * offering: an offering can be recorded as 'term1' by mistake, but a
 * specialized subject is still taught all year.
 */
function subjectRunsAllYear(category) {
  return category === 'specialized';
}

/**
 * The one question the grade views actually ask: should this subject's class
 * appear in this term?
 *
 * Takes the pieces rather than a row, so it can be called from the model
 * layer and a controller without either of them agreeing on a row shape
 * first.
 *
 * THE PARAMETER NAMES MATTER. frontend/src/utils/academicTerms.js mirrors
 * this function and must keep the identical shape: the two used to disagree
 * (`subjectCategory`/`periodSequenceNumber` here against `category`/
 * `semester` there), which meant handing either one the other's object
 * returned `true` for everything — a fail-open with nothing to catch it.
 */
function offeringCoversPeriod({ term, subjectCategory, periodSequenceNumber }) {
  if (subjectRunsAllYear(subjectCategory)) return true;
  return termCoversPeriod(term, periodSequenceNumber);
}

module.exports = {
  SUBJECT_CATEGORIES,
  DEFAULT_SUBJECT_CATEGORY,
  SUBJECT_CATEGORY_LABELS,
  CLASS_TERMS,
  DEFAULT_CLASS_TERM,
  CLASS_TERM_LABELS,
  TERM_SEQUENCE,
  termCoversPeriod,
  subjectRunsAllYear,
  offeringCoversPeriod,
};
