import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  BookOpen,
  CalendarCheck,
  ClipboardList,
  IdCard,
  KeyRound,
  Mail,
  ShieldCheck,
  User,
  Users,
} from 'lucide-react'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { roleLabel } from '../utils/roleLabel'
import { Alert } from '../components/Alert'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { FormField } from '../components/FormField'
import { Skeleton } from '../components/Skeleton'
import { useWriteFeedback } from '../hooks/useWriteFeedback'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Everyone's own page: who the system thinks you are, what you are
// responsible for, and the two things about your account you can change
// yourself.
//
// Until now `/my-profile` redirected to `/` — the route existed, the page
// did not. The only account action anyone had was "Change password" in the
// top-bar menu, so a teacher whose surname was misspelt at account creation,
// or who was given the wrong email address, had to ask an admin.
//
// **Assignments come from both endpoints, always.** This is the same bug the
// scoping fix was about, in presentation form: the old UserInfoCard and
// StaffHero each asked `if (role === 'adviser') … else if (role ===
// 'subject_teacher') …`, so a teacher who advises one section and teaches
// another saw exactly half of what they are responsible for. Whether either
// list is empty is now the only thing that decides what is shown.
export function ProfilePage() {
  const { user, applyProfileUpdate } = useAuth()

  const [sections, setSections] = useState(null)
  const [offerings, setOfferings] = useState(null)
  // Set when either assignment request failed. An empty list there used to
  // print "You do not currently advise a section or teach a class" — a
  // statement about the person, made from a request that never answered.
  const [assignmentsError, setAssignmentsError] = useState(null)

  // Identity form. Seeded from the signed-in user rather than a fresh
  // request — AuthContext already re-fetched /auth/me on load, so asking
  // again would be a second request for the same two fields.
  const [fullName, setFullName] = useState(user?.fullName || '')
  const [email, setEmail] = useState(user?.email || '')
  const [currentPassword, setCurrentPassword] = useState('')
  const identity = useWriteFeedback()

  // Password form, kept separate so a failed password change cannot wipe a
  // half-typed name edit, and so each form reports its own outcome next to
  // itself rather than both sharing one Alert at the top of the page.
  const [passwords, setPasswords] = useState({ current: '', next: '', confirm: '' })
  const password = useWriteFeedback()

  // A student holds neither kind of assignment, so both requests would come
  // back empty — and the panel they feed is not shown to them at all.
  const isStudent = user?.role === 'student'

  useEffect(() => {
    if (isStudent) {
      setSections([])
      setOfferings([])
      return
    }
    const failed = (err) => setAssignmentsError(`Couldn't load your assignments: ${err.message}`)
    api
      .get('/sections/mine')
      .then((d) => setSections(d.sections || []))
      .catch((err) => {
        setSections([])
        failed(err)
      })
    api
      .get('/class-offerings/mine')
      .then((d) => setOfferings(d.classOfferings || []))
      .catch((err) => {
        setOfferings([])
        failed(err)
      })
  }, [isStudent])

  // Whether the email field has actually been changed, compared the way the
  // server compares it: addresses are stored lowercased, so re-saving the
  // same address in a different case is not a change and must not demand the
  // current password.
  const emailChanged = email.trim().toLowerCase() !== (user?.email || '').trim().toLowerCase()
  const nameChanged = fullName.trim() !== (user?.fullName || '').trim()

  const nameError = fullName.trim() ? null : 'Your name cannot be empty.'
  const emailError = !email.trim()
    ? 'An email address is required.'
    : EMAIL_PATTERN.test(email.trim())
      ? null
      : 'That does not look like an email address.'

  async function handleIdentitySubmit(e) {
    e.preventDefault()
    if (nameError || emailError) return

    const ok = await identity.runWrite(
      'identity',
      async () => {
        const data = await api.patch('/auth/profile', {
          fullName: fullName.trim(),
          email: email.trim(),
          // Only sent when it is needed, so a name-only edit never asks for it.
          currentPassword: emailChanged ? currentPassword : undefined,
        })
        // The server's copy, not the form's: if it trimmed or lowercased
        // anything, the top bar and the account menu show what was stored.
        applyProfileUpdate(data.user)
        setFullName(data.user.fullName)
        setEmail(data.user.email)
      },
      emailChanged ? `Saved. You now sign in with ${email.trim()}.` : 'Saved.'
    )

    if (ok) setCurrentPassword('')
  }

  async function handlePasswordSubmit(e) {
    e.preventDefault()
    // Checked here as well as by the server, because the server cannot see
    // the confirmation field at all — it only ever receives one new password.
    if (passwords.next !== passwords.confirm) {
      password.setError('The new password and its confirmation do not match.')
      return
    }

    const ok = await password.runWrite(
      'password',
      async () => {
        await api.post('/auth/change-password', {
          currentPassword: passwords.current,
          newPassword: passwords.next,
        })
      },
      'Your password has been changed.'
    )

    if (ok) setPasswords({ current: '', next: '', confirm: '' })
  }

  if (!user) return null

  const loadingAssignments = sections === null || offerings === null
  const hasAssignments = (sections?.length || 0) + (offerings?.length || 0) > 0

  // Whether to draw the responsibilities panel at all.
  //
  // Holding an assignment is the first answer, and it is asked of the data,
  // not of the role column — nothing stops an admin being a section's
  // adviser, and the whole point of the scoping work was that the label
  // does not decide what someone is responsible for.
  //
  // The role is consulted for one narrower question: whether an EMPTY panel
  // is worth showing. "You do not currently advise a section or teach a
  // class" is useful to a teacher, who is waiting for one; to a registrar or
  // an administrator it is a statement of the obvious taking up a panel.
  const expectsAssignment = ['adviser', 'subject_teacher'].includes(user?.role)
  const showAssignments = !isStudent && (loadingAssignments || hasAssignments || expectsAssignment)

  return (
    <div>
      <Breadcrumbs items={[{ label: 'Home', to: '/' }, { label: 'Your profile' }]} />

      <div className="page-header">
        <h1>Your profile</h1>
      </div>

      <div className="profile-page">
        <section className="panel profile-page__panel">
          <h2>
            <IdCard size={18} strokeWidth={1.75} aria-hidden="true" /> Your details
          </h2>

          <form onSubmit={handleIdentitySubmit} className="profile-page__form">
            <FormField
              id="profile-name"
              icon={User}
              label="Full name"
              required
              error={nameChanged ? nameError : null}
            >
              <input id="profile-name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
            </FormField>

            <FormField
              id="profile-email"
              icon={Mail}
              label="Email address"
              required
              error={emailChanged ? emailError : null}
              hint="The address you sign in with, and where a password reset link is sent."
            >
              <input
                id="profile-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </FormField>

            {/* Asked for only when the email is actually being changed.
                Whoever controls the address controls password recovery, so
                this one field is really a credential — without it, a
                borrowed session could repoint recovery to someone else's
                inbox and then take the account permanently through "Forgot
                password". A name change carries no such consequence and
                asks for nothing. */}
            {emailChanged && (
              <FormField
                id="profile-current-password"
                icon={ShieldCheck}
                label="Your current password"
                required
                hint="Required to change the address your sign-in and password resets go to."
              >
                <input
                  id="profile-current-password"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                />
              </FormField>
            )}

            <p className="form-note">
              Your role ({roleLabel(user.role)}) and what you advise or teach are set by the school — ask an
              administrator to change those.
            </p>

            {identity.error && <Alert>{identity.error}</Alert>}

            <div className="profile-page__actions">
              <button
                type="submit"
                className="btn-primary"
                disabled={Boolean(identity.busyKey) || (!nameChanged && !emailChanged)}
              >
                {identity.busyKey ? 'Saving…' : 'Save changes'}
              </button>
              {(nameChanged || emailChanged) && (
                <button
                  type="button"
                  onClick={() => {
                    setFullName(user.fullName)
                    setEmail(user.email)
                    setCurrentPassword('')
                    identity.clearFeedback()
                  }}
                >
                  Discard
                </button>
              )}
            </div>
          </form>
        </section>

        <section className="panel profile-page__panel">
          <h2>
            <KeyRound size={18} strokeWidth={1.75} aria-hidden="true" /> Password
          </h2>

          <form onSubmit={handlePasswordSubmit} className="profile-page__form">
            <FormField id="pw-current" icon={ShieldCheck} label="Current password" required>
              <input
                id="pw-current"
                type="password"
                autoComplete="current-password"
                value={passwords.current}
                onChange={(e) => setPasswords((p) => ({ ...p, current: e.target.value }))}
                required
              />
            </FormField>
            <FormField id="pw-next" icon={KeyRound} label="New password" required hint="At least 8 characters.">
              <input
                id="pw-next"
                type="password"
                autoComplete="new-password"
                minLength={8}
                value={passwords.next}
                onChange={(e) => setPasswords((p) => ({ ...p, next: e.target.value }))}
                required
              />
            </FormField>
            <FormField
              id="pw-confirm"
              icon={KeyRound}
              label="Confirm new password"
              required
              // Only once something has been typed in it: telling someone a
              // field does not match before they have started filling it in
              // is noise, not help.
              error={
                passwords.confirm && passwords.confirm !== passwords.next
                  ? 'This does not match the new password.'
                  : null
              }
            >
              <input
                id="pw-confirm"
                type="password"
                autoComplete="new-password"
                minLength={8}
                value={passwords.confirm}
                onChange={(e) => setPasswords((p) => ({ ...p, confirm: e.target.value }))}
                required
              />
            </FormField>

            {password.error && <Alert>{password.error}</Alert>}

            <div className="profile-page__actions">
              <button type="submit" className="btn-primary" disabled={Boolean(password.busyKey)}>
                {password.busyKey ? 'Changing…' : 'Change password'}
              </button>
            </div>
          </form>
        </section>

        {/* Not shown to a student: they hold no assignment, and their own
            record on file already lives on their home page rather than
            being rendered a second time here. */}
        {showAssignments && (
          <section className="panel profile-page__panel profile-page__panel--wide">
            <h2>
              <ClipboardList size={18} strokeWidth={1.75} aria-hidden="true" /> What you are responsible for
            </h2>

            {loadingAssignments ? (
              <div className="profile-page__assignments">
                <Skeleton h="1.25rem" w="60%" />
                <Skeleton h="1.25rem" w="45%" />
              </div>
            ) : assignmentsError ? (
              <p className="form-note form-note--danger">{assignmentsError}</p>
            ) : !hasAssignments ? (
              <p className="form-note">
                You do not currently advise a section or teach a class. An administrator assigns these in Academic
                Setup, and the attendance and grade pages appear here once they do.
              </p>
            ) : (
              <div className="profile-page__assignments">
                {/* Both lists, every time. A teacher who advises one section
                    and teaches another is normal in this school, and showing
                    only one of the two is what this panel exists to stop
                    doing. */}
                {sections.length > 0 && (
                  <div className="profile-page__assignment">
                    <h3>
                      <Users size={15} strokeWidth={1.75} aria-hidden="true" />
                      {sections.length === 1 ? 'Section you advise' : 'Sections you advise'}
                    </h3>
                    <ul className="profile-page__list">
                      {sections.map((s) => (
                        <li key={s.id}>
                          Grade {s.grade_level} – {s.name}
                        </li>
                      ))}
                    </ul>
                    <p className="profile-page__links">
                      <Link to="/attendance/daily">
                        <CalendarCheck size={14} strokeWidth={1.75} aria-hidden="true" /> Daily attendance
                      </Link>
                      <Link to="/grades/finalize">
                        <BookOpen size={14} strokeWidth={1.75} aria-hidden="true" /> Finalize grades
                      </Link>
                      <Link to="/academic-progress">
                        <ClipboardList size={14} strokeWidth={1.75} aria-hidden="true" /> Academic progress
                      </Link>
                    </p>
                  </div>
                )}

                {offerings.length > 0 && (
                  <div className="profile-page__assignment">
                    <h3>
                      <BookOpen size={15} strokeWidth={1.75} aria-hidden="true" />
                      {offerings.length === 1 ? 'Class you teach' : 'Classes you teach'}
                    </h3>
                    <ul className="profile-page__list">
                      {offerings.map((o) => (
                        <li key={o.id}>
                          {o.subject_name} — Grade {o.grade_level} {o.section_name}
                        </li>
                      ))}
                    </ul>
                    <p className="profile-page__links">
                      <Link to="/grades/entry">
                        <BookOpen size={14} strokeWidth={1.75} aria-hidden="true" /> Enter grades
                      </Link>
                    </p>
                  </div>
                )}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  )
}
