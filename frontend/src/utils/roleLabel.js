// How a role is written when it is shown to a person.
//
// Three places used to render it as `role.replace(/_/g, ' ')` plus a CSS
// `text-transform: capitalize`, which cannot spell a role whose words a
// stylesheet would capitalise wrongly (an acronym, "Administrator" rather
// than "Admin"). Capitalisation is a property of the word, not something a
// stylesheet can derive.
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
  student: 'Student',
}

// Falls back to the underscored value made readable, so a role added to the
// database before it is added here still displays as words rather than
// breaking or showing a raw enum.
export function roleLabel(role) {
  if (!role) return ''
  return ROLE_LABELS[role] || String(role).replace(/_/g, ' ')
}
