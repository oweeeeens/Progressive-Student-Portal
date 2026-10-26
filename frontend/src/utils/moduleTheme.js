// Which area of the school's work a route belongs to.
//
// The answer becomes a `data-module` attribute on the scroll container, and
// index.css turns that into --module / --module-soft / --module-ink for
// everything inside. One attribute, set once, is what lets a page header,
// an icon tile and a table header all agree on the colour of where you are
// without a single page component knowing a colour exists.
//
// Keep this list in the same order the sidebar groups them, so the two
// cannot drift apart without it being obvious.

const ROUTE_MODULES = [
  // Student-facing first: a student's grades page is still Grades, and
  // their attendance page is still Attendance, so their portal is coloured
  // by the same scheme the staff side uses.
  ['/my-grades', 'grades'],
  ['/my-attendance', 'attendance'],

  ['/students', 'records'],
  ['/attendance', 'attendance'],
  ['/grades', 'grades'],
  ['/academic-progress', 'progress'],
  ['/interventions', 'progress'],
  ['/analytics', 'progress'],
  ['/users', 'admin'],
  ['/academic-setup', 'admin'],
]

// Home deliberately has no module hue: it is the one screen that belongs to
// the whole school rather than to one area, so it keeps the brand navy and
// lets the coloured areas be the thing you notice when you leave it.
const DEFAULT_MODULE = 'home'

export function moduleForPath(pathname) {
  const match = ROUTE_MODULES.find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`))
  return match ? match[1] : DEFAULT_MODULE
}
