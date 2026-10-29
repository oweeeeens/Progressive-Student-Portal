// How a role is written when it is shown to a person.
//
// Three places used to render it as `role.replace(/_/g, ' ')` plus a CSS
// `text-transform: capitalize` — which works for every role except the one
// that is an acronym: ICT faculty came out as "Ict Faculty" in the sidebar,
// the top bar and the profile card, on an account whose whole purpose is
// being the ICT staff. Capitalisation is a property of the word, not
// something a stylesheet can derive.
//
// Deliberately NOT merged with the role maps in CreateAccountPage and
// UserManagementPage: those are pickers listing the roles that may be
// *assigned*, which is a different (and deliberately shorter) list — admin
// is absent from them on purpose. This one answers "what do we call this
// role on screen", and so it covers every role including admin.
const ROLE_LABELS = {
  admin: 'Administrator',
  principal: 'Principal',
  registrar: 'Registrar',
  adviser: 'Adviser',
  subject_teacher: 'Subject Teacher',
  guidance_counselor: 'Guidance Counselor',
  ict_faculty: 'ICT Faculty',
  student: 'Student',
}

// Falls back to the underscored value made readable, so a role added to the
// database before it is added here still displays as words rather than
// breaking or showing a raw enum.
export function roleLabel(role) {
  if (!role) return ''
  return ROLE_LABELS[role] || String(role).replace(/_/g, ' ')
}
