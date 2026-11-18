import { useAuth } from '../context/AuthContext'
import { Alert } from './Alert'

// Shown at the top of an advising or teaching page when the signed-in
// adviser or subject teacher is not linked to anything of that kind yet.
//
// The sidebar always offers a role its own pages (utils/permissions.js,
// showsAdvisingWork / showsTeachingWork), so a brand-new account sees a
// menu that matches its role. This is what those pages say until the admin
// links the account — instead of an empty picker that looks like a fault.
//
// kind: 'section' (Daily Attendance, Finalize Grades, Interventions, SF2
// import) or 'class' (Class Record, e-Class Record import).
// Renders nothing while the counts are loading or unknown, and for anyone
// whose access does not depend on an assignment (admin, registrar,
// principal, guidance counselor).
export function NoAssignmentNotice({ kind }) {
  const { user, assignments } = useAuth()
  if (!assignments || !['adviser', 'subject_teacher'].includes(user?.role)) return null

  if (kind === 'section' && assignments.sections === 0) {
    return (
      <Alert variant="info" title="You have no advisory section yet">
        This page works on the section you advise. Ask the admin to link your account to your section (User Management
        → Edit, or Academic Setup → Sections). It appears here as soon as they do.
      </Alert>
    )
  }
  if (kind === 'class' && assignments.offerings === 0) {
    return (
      <Alert variant="info" title="You have no classes assigned yet">
        This page works on the classes you teach. Ask the admin to link your account to your classes (User Management →
        Edit, or Academic Setup → Class Offerings). They appear here as soon as they do.
      </Alert>
    )
  }
  return null
}
