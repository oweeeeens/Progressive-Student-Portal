// Turns a database enum into something a person reads: `enrollment_status`
// values like `enrolled` and `not_enrolled`, intervention statuses, record
// states.
//
// This existed as a private copy in StudentHomePage and again in
// StudentAttendancePage, and a third was about to be written for the student
// detail page — which is how the same field ends up reading "enrolled" on
// one screen and "Enrolled" on the next. One definition, used everywhere.
//
// Returns the em-dash every table and detail page uses for an absent value
// (see DataTable's EMPTY_VALUE), so a missing enum looks the same as any
// other missing field rather than rendering as "Undefined".
export function humanize(value) {
  if (!value) return '—'
  return String(value)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}
