import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { api } from '../api/client'
import { Alert } from '../components/Alert'
import { useAuth } from '../context/AuthContext'
import { useConfirm } from '../hooks/useConfirm'
import { AssignmentPicker, EMPTY_ASSIGNMENT, describeTakeovers, assignmentPayload } from '../components/AssignmentPicker'

const ROLE_LABELS = {
  adviser: 'Adviser',
  subject_teacher: 'Subject Teacher',
  guidance_counselor: 'Guidance Counselor',
  registrar: 'Registrar',
  principal: 'Principal',
  student: 'Student',
}

// Admin/registrar create every account here — staff (name, email, role) and,
// since enrollment moved to paper (see CLAUDE.md), students too: a student
// account is linked to an existing Student Record instead of collecting a
// fresh name/email, so it can never drift from what's already on file (the
// email was captured when the registrar added the record). There is no
// email-sending infrastructure in this system, so the generated temporary
// password is shown exactly once, right after creation — it cannot be
// retrieved again after leaving this page, so the admin/registrar must relay
// it to the new user right now.
// Linking roles: an adviser or subject teacher is given its section and
// classes here, in the same request, so the account has its features the
// first time it signs in (components/AssignmentPicker.jsx).
const LINKABLE_ROLES = ['adviser', 'subject_teacher']

export function CreateAccountPage() {
  const { user: currentUser } = useAuth()
  const isAdmin = currentUser?.role === 'admin'
  const [assignment, setAssignment] = useState(EMPTY_ASSIGNMENT)
  const [targets, setTargets] = useState(null)
  const [confirm, confirmDialog] = useConfirm()
  const [searchParams] = useSearchParams()
  const preselectedStudentId = searchParams.get('studentId')

  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState(preselectedStudentId ? 'student' : 'adviser')
  const [studentSearch, setStudentSearch] = useState('')
  const [studentOptions, setStudentOptions] = useState([])
  // 'idle' (nothing typed) | 'searching' | 'done' | 'failed'
  const [searchState, setSearchState] = useState('idle')
  const [selectedStudent, setSelectedStudent] = useState(null)
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [created, setCreated] = useState(null) // { user, tempPassword }
  const [copied, setCopied] = useState(false)

  // Pre-select the student passed in via ?studentId= (the "Create Portal
  // Account" button on StudentDetailPage) so the admin/registrar doesn't
  // have to search for someone they're already looking at.
  useEffect(() => {
    if (!preselectedStudentId) return
    api
      .get(`/students/${preselectedStudentId}`)
      .then((data) => setSelectedStudent(data.student))
      .catch((err) => setError(err.message))
  }, [preselectedStudentId])

  // Search-as-you-type picker — reuses the same /students endpoint the
  // Student List page uses. Students who already have a portal account
  // (user_id set) are filtered out client-side: they're not valid targets
  // for this form, and hiding them is clearer than letting one be picked
  // and then rejected by the server.
  useEffect(() => {
    if (role !== 'student' || !studentSearch.trim()) {
      setStudentOptions([])
      setSearchState('idle')
      return
    }
    // Typing a name used to give no feedback at all: results appeared only
    // when there were some, so "still searching", "nobody matched" and "the
    // search failed" all looked the same — an empty space under the box.
    let cancelled = false
    setSearchState('searching')
    const params = new URLSearchParams({ search: studentSearch, pageSize: 10 })
    api
      .get(`/students?${params.toString()}`)
      .then((data) => {
        if (cancelled) return
        setStudentOptions(data.students.filter((s) => !s.user_id))
        setSearchState('done')
      })
      .catch(() => {
        if (cancelled) return
        setStudentOptions([])
        setSearchState('failed')
      })
    // A slower, older search must not overwrite a newer one's answer.
    return () => {
      cancelled = true
    }
  }, [role, studentSearch])

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    const linking = isAdmin && LINKABLE_ROLES.includes(role)
    // Taking a section or class away from someone else is not a quiet
    // change: their menu loses it. Name who, and ask first.
    const takeovers = linking ? describeTakeovers(targets, assignment, null) : []
    if (takeovers.length > 0) {
      const ok = await confirm({
        title: 'Move these to the new account?',
        message: 'A section has one adviser and a class has one teacher, so these will be taken from the person who has them now.',
        details: (
          <ul>
            {takeovers.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ),
        confirmLabel: 'Create and move',
        danger: true,
      })
      if (!ok) return
    }
    setSubmitting(true)
    try {
      const payload =
        role === 'student'
          ? { role: 'student', studentId: selectedStudent.id }
          : { email, fullName, role, ...(linking ? assignmentPayload(assignment) : {}) }
      const result = await api.post('/auth/register', payload)
      setCreated(result)
      setEmail('')
      setFullName('')
      setAssignment(EMPTY_ASSIGNMENT)
      setRole('adviser')
      setSelectedStudent(null)
      setStudentSearch('')
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  function handleCopy() {
    navigator.clipboard.writeText(created.tempPassword).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const isStudentRole = role === 'student'

  // Why the button is disabled, in the same expression that disables it.
  //
  // It used to be a bare boolean, so the submit button went grey with no
  // explanation anywhere on the page — for a student the reason is usually
  // "you have not picked one yet", which is not obvious when the roster
  // above is long enough to scroll past the selection. A disabled control
  // that does not say why is a dead end: the reader can see that the form
  // will not submit and has nothing to act on.
  const blockedReason = isStudentRole
    ? !selectedStudent
      ? 'Choose a student from the list above to create their account.'
      : !selectedStudent.email
        ? 'This student has no personal email on file, so there is no address to sign in with.'
        : null
    : !fullName
      ? 'Enter the staff member’s full name.'
      : !email
        ? 'Enter the email address this person will sign in with.'
        : null
  const canSubmit = !blockedReason

  return (
    <div className="account-form-page">
      <Breadcrumbs items={[{ label: 'Home', to: '/' }, { label: 'User Management', to: '/users' }, { label: 'New' }]} />
      <div className="page-header">
        <h1>{isStudentRole ? 'New Student Account' : 'New Staff Account'}</h1>
      </div>

      {/* The Alert component rather than a bare .alert div: .alert is a flex
          row, so loose block children lay out side by side. This is a
          temporary password someone has to read and copy — it needs to sit
          under its heading, not beside it. */}
      {created && (
        <Alert
          variant="success"
          title={`Account created for ${created.user.fullName} (${ROLE_LABELS[created.user.role]}).`}
        >
          <p className="form-note">
            Share this temporary password with them now — it will not be shown again. They'll be
            required to change it on first login.
          </p>
          <div className="account-form__password">
            <code className="alert__code">{created.tempPassword}</code>
            <button type="button" onClick={handleCopy}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          {created.linked && (created.linked.section || created.linked.offerings.length > 0) ? (
            <ul className="form-note">
              {created.linked.section && (
                <li>
                  Advises Grade {created.linked.section.gradeLevel} – {created.linked.section.name}
                  {created.linked.section.previousAdviser ? ` (moved from ${created.linked.section.previousAdviser})` : ''}
                </li>
              )}
              {created.linked.offerings.map((o) => (
                <li key={o.id}>
                  Teaches {o.sectionName} – {o.subjectName}
                  {o.previousTeacher ? ` (moved from ${o.previousTeacher})` : ''}
                </li>
              ))}
            </ul>
          ) : (
            LINKABLE_ROLES.includes(created.user.role) && (
              <p className="form-note">
                Not linked to a section or class yet, so their attendance and grade pages will say so until the admin
                links them (User Management → Edit).
              </p>
            )
          )}
        </Alert>
      )}

      <form onSubmit={handleSubmit} className="panel account-form">
        <label>
          Role
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            {Object.entries(ROLE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        {isStudentRole ? (
          <>
            <label>
              Student Record
              {selectedStudent ? (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: 'var(--space-2) var(--space-3)',
                    border: '1px solid var(--color-border-strong)',
                    borderRadius: 'var(--radius-sm)',
                    marginTop: 'var(--space-1)',
                  }}
                >
                  <span>
                    {selectedStudent.last_name}, {selectedStudent.first_name} — LRN {selectedStudent.lrn}
                  </span>
                  <button type="button" onClick={() => setSelectedStudent(null)}>
                    Change
                  </button>
                </div>
              ) : (
                <input
                  type="search"
                  value={studentSearch}
                  onChange={(e) => setStudentSearch(e.target.value)}
                  placeholder="Search by name or LRN"
                  style={{ width: '100%' }}
                />
              )}
            </label>
            {!selectedStudent && studentSearch.trim() && searchState !== 'done' && searchState !== 'idle' && (
              <p className={`form-note${searchState === 'failed' ? ' form-note--danger' : ''}`} role="status">
                {searchState === 'failed' ? "The search couldn't be completed. Try again." : 'Searching…'}
              </p>
            )}
            {!selectedStudent && studentSearch.trim() && searchState === 'done' && studentOptions.length === 0 && (
              <p className="form-note" role="status">
                No student without an account matches "{studentSearch.trim()}". A student who already has a portal
                account does not appear here.
              </p>
            )}
            {!selectedStudent && studentOptions.length > 0 && (
              <div className="table-card account-form__results">
                <table>
                  <tbody>
                    {studentOptions.map((s) => (
                      <tr
                        key={s.id}
                        className="is-clickable-row"
                        onClick={() => {
                          setSelectedStudent(s)
                          setStudentSearch('')
                        }}
                      >
                        <td>
                          {s.last_name}, {s.first_name}
                        </td>
                        <td>{s.lrn}</td>
                        <td>{s.section_name ? `Grade ${s.grade_level} - ${s.section_name}` : 'No section'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {selectedStudent && !selectedStudent.email && (
              <p className="form-note form-note--danger">
                This student has no personal email on file — add one via their Student Record first.
              </p>
            )}
            {selectedStudent && selectedStudent.email && (
              <p className="form-note">
                Portal account email: <strong>{selectedStudent.email}</strong> (from their Student Record)
              </p>
            )}
          </>
        ) : (
          <>
            <label>
              Full name
              <input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
            </label>
            <label>
              Email
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
            {LINKABLE_ROLES.includes(role) &&
              (isAdmin ? (
                <AssignmentPicker value={assignment} onChange={setAssignment} onTargetsLoaded={setTargets} />
              ) : (
                <p className="form-note">
                  An admin links this account to the section it advises and the classes it teaches (User Management →
                  Edit, or Academic Setup). Until then its attendance and grade pages say there is nothing assigned.
                </p>
              ))}
          </>
        )}

        {error && <Alert>{error}</Alert>}
        <button type="submit" className="btn-primary" disabled={submitting || !canSubmit}>
          {submitting ? 'Creating Account…' : 'Create Account'}
        </button>
        {/* Below the button rather than above it, so it reads as the answer
            to "why can't I press this". aria-live so it is announced when
            the reason changes — a screen reader user otherwise only finds
            out by tabbing back to a button that is still disabled. */}
        {blockedReason && !submitting && (
          <p className="form-note" aria-live="polite">
            {blockedReason}
          </p>
        )}
      </form>
      {confirmDialog}
    </div>
  )
}
