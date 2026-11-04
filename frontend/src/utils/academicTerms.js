// The reader-facing half of backend/config/academicTerms.js.
//
// Deliberately a mirror rather than a fetch: these are a handful of fixed
// words that change only when the school's policy does, and a round trip to
// learn that "term1" is called "Term 1 only" would be a request on every
// form load for something that cannot vary at runtime. The SERVER still
// validates every value it is sent — nothing here is a control.
//
// The policy, for orientation, in the school's own words (2026-11-04): the
// year is three terms; a Grade 11 subject runs all three; a Grade 12 subject
// changes every term; a specialized subject runs all three in both grade
// levels. There are no semesters — see the backend file for what that
// replaced and why.

export const SUBJECT_CATEGORIES = [
  { value: 'core', label: 'Core' },
  { value: 'applied', label: 'Applied' },
  { value: 'specialized', label: 'Specialized' },
]

export const SUBJECT_CATEGORY_LABELS = Object.fromEntries(
  SUBJECT_CATEGORIES.map((c) => [c.value, c.label])
)

export const CLASS_TERMS = [
  { value: 'full_year', label: 'Whole school year' },
  { value: 'term1', label: 'Term 1 only' },
  { value: 'term2', label: 'Term 2 only' },
  { value: 'term3', label: 'Term 3 only' },
]

export const CLASS_TERM_LABELS = Object.fromEntries(CLASS_TERMS.map((t) => [t.value, t.label]))

// Short forms, for a table cell or a badge where the full phrase would wrap.
export const CLASS_TERM_SHORT = {
  full_year: 'Whole year',
  term1: 'Term 1',
  term2: 'Term 2',
  term3: 'Term 3',
}

const TERM_SEQUENCE = { term1: 1, term2: 2, term3: 3 }

/**
 * Should this subject's class appear in this term?
 *
 * THE PARAMETER NAMES ARE THE SERVER'S, exactly. This function and
 * backend/config/academicTerms.js's copy used to take different names for
 * the same three things (`category`/`semester` here against
 * `subjectCategory`/`periodSemester` there), which meant that handing
 * either one the other's object returned `true` for everything — a silent
 * fail-open, in the one place in this app that decides whether a learner's
 * grade is shown to them. They match now, so a copy-paste between layers is
 * either correct or an obvious error.
 *
 * One fail-open rule, matching the server's: a `full_year` class covers
 * every term, which is what every offering recorded before this feature
 * existed means.
 */
export function offeringCoversPeriod({ term, subjectCategory, periodSequenceNumber }) {
  if (subjectCategory === 'specialized') return true
  if (!term || term === 'full_year') return true
  return TERM_SEQUENCE[term] === Number(periodSequenceNumber)
}
