// The reader-facing half of backend/config/academicTerms.js.
//
// Deliberately a mirror rather than a fetch: these are four fixed words that
// change only when the school's policy does, and a round trip to learn that
// "sem1" is called "First semester" would be a request on every form load
// for something that cannot vary at runtime. The SERVER still validates
// every value it is sent — nothing here is a control.
//
// The policy itself, for orientation: Grade 11 subjects run all three
// quarters; Grade 12 subjects change each semester; specialized subjects run
// the whole year in both grade levels.

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
  { value: 'sem1', label: 'First semester' },
  { value: 'sem2', label: 'Second semester' },
]

export const CLASS_TERM_LABELS = Object.fromEntries(CLASS_TERMS.map((t) => [t.value, t.label]))

// Short forms, for a table cell or a badge where the full phrase would wrap.
export const CLASS_TERM_SHORT = { full_year: 'Whole year', sem1: '1st sem', sem2: '2nd sem' }

const TERM_SEMESTER = { sem1: 1, sem2: 2 }

/**
 * Should this subject's class appear in this quarter?
 *
 * Two fail-open cases, matching the server's rule exactly:
 *
 *  - A specialized subject runs the whole year in both grade levels, whatever
 *    its offering says.
 *  - A quarter with no semester assigned yet is treated as covered. Hiding it
 *    instead would make a school that has not finished its Academic Setup
 *    look as though its grades had vanished.
 */
export function offeringCoversPeriod({ term, category, semester }) {
  if (category === 'specialized') return true
  if (!term || term === 'full_year') return true
  if (semester === null || semester === undefined) return true
  return TERM_SEMESTER[term] === Number(semester)
}
