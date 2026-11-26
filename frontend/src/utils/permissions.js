// Who may do what, as the SERVER answers it — kept here so the sidebar and
// the pages cannot drift apart from each other or from the routes.
//
// This file exists because of a regression that has already happened once:
// a sidebar predicate was widened to include the principal without the
// matching change to `requireRole`, which handed them a link the server
// answered 403. The note at the top of Sidebar.jsx records it. One shared
// answer per question is the fix.
//
// These are presentation decisions only. The real boundary is always the
// server; nothing here is a security control.

// Academic Setup — school years, sections, subjects, class offerings,
// grading periods.
//
// The admin and the REGISTRAR change it (the registrar since 2026-11-26, at
// the group's request: the registrar keeps the school's records, and the
// sections and classes are where those records are placed). The principal
// reads all of it and changes none of it. Mirrors the split in the setup
// routes (routes/schoolYearRoutes.js and the `/admin` read endpoints).
export function canViewAcademicSetup(role) {
  return ['admin', 'principal', 'registrar'].includes(role)
}

export function canManageAcademicSetup(role) {
  return ['admin', 'registrar'].includes(role)
}

// Roles that read the grade reports for EVERY section and class, not only
// their own: the admin, and the registrar (2026-11-26), who keeps the
// school's records. Mirrors reportController's guards. Read-only — a report
// has no write path.
export function seesAllGradeReports(role) {
  return ['admin', 'registrar'].includes(role)
}

// --- Imports (the Import Data page and its sidebar link) -------------------
//
// `has` is AuthContext's assignment counts ({ sections, offerings }), or null
// while they load / if they failed — then the role alone decides, failing
// open exactly like the sidebar does (the server is the real boundary).
const advisesAny = (has) => has == null || has.sections > 0
const teachesAny = (has) => has == null || has.offerings > 0

// --- Advising and teaching work (sidebar links, import cards) --------------
//
// Assignment decides, never the label — EXCEPT that a role's own half of the
// menu always shows. An adviser always sees the advising pages and a subject
// teacher the teaching pages, even before an admin has linked them to a
// section or class. Hiding them made a brand-new account look broken (found
// in the group's demo); now each such page says "no section assigned yet"
// instead (components/NoAssignmentNotice.jsx). The OTHER half still appears
// only when actually assigned: a teaching adviser earns the teaching pages
// by teaching. The server refuses anything not assigned either way.
export function showsAdvisingWork(role, has) {
  return role === 'adviser' || (role === 'subject_teacher' && advisesAny(has))
}

export function showsTeachingWork(role, has) {
  return role === 'subject_teacher' || (role === 'adviser' && teachesAny(has))
}

// The school's student information spreadsheet → student records.
export function canImportStudents(role) {
  return ['admin', 'registrar'].includes(role)
}

// SF2 attendance sheets → the daily register: whoever may mark it — the
// section's adviser or the admin. Not the registrar since 2026-11-26.
export function canImportAttendance(role, has) {
  return role === 'admin' || showsAdvisingWork(role, has)
}

// A subject's DepEd e-Class Record → its class record: whoever teaches it.
export function canImportClassRecord(role, has) {
  return role === 'admin' || showsTeachingWork(role, has)
}

export function canImportAnything(role, has) {
  return canImportStudents(role) || canImportAttendance(role, has) || canImportClassRecord(role, has)
}
