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
