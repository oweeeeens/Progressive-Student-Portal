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
// The principal reads all of it and changes none of it. They hold the
// school-wide position, so the structure of the school year is theirs to
// see; restructuring it stays with the admin. Mirrors the split in
// routes/schoolYearRoutes.js and the three `/admin` read endpoints.
export function canViewAcademicSetup(role) {
  return ['admin', 'principal'].includes(role)
}

export function canManageAcademicSetup(role) {
  return role === 'admin'
}

// --- Imports (the Import Data page and its sidebar link) -------------------
//
// `has` is AuthContext's assignment counts ({ sections, offerings }), or null
// while they load / if they failed — then the role alone decides, failing
// open exactly like the sidebar does (the server is the real boundary).
const advisesAny = (has) => has == null || has.sections > 0
const teachesAny = (has) => has == null || has.offerings > 0

// The school's student information spreadsheet → student records.
export function canImportStudents(role) {
  return ['admin', 'registrar'].includes(role)
}

// SF2 attendance sheets → the daily register: whoever may mark it.
export function canImportAttendance(role, has) {
  return ['admin', 'registrar'].includes(role) || (['adviser', 'subject_teacher'].includes(role) && advisesAny(has))
}

// A subject's DepEd e-Class Record → its class record: whoever teaches it.
export function canImportClassRecord(role, has) {
  return role === 'admin' || (['adviser', 'subject_teacher'].includes(role) && teachesAny(has))
}

export function canImportAnything(role, has) {
  return canImportStudents(role) || canImportAttendance(role, has) || canImportClassRecord(role, has)
}
