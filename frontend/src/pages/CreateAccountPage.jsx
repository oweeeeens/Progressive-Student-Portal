import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { api } from '../api/client'
import { Alert } from '../components/Alert'

const ROLE_LABELS = {
  adviser: 'Adviser',
  subject_teacher: 'Subject Teacher',
  guidance_counselor: 'Guidance Counselor',
  registrar: 'Registrar',
  principal: 'Principal',
  ict_faculty: 'ICT Faculty',
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
export function CreateAccountPage() {
  const [searchParams] = useSearchParams()
  const preselectedStudentId = searchParams.get('studentId')

  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState(preselectedStudentId ? 'student' : 'adviser')
  const [studentSearch, setStudentSearch] = useState('')
  const [studentOptions, setStudentOptions] = useState([])
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
      return
    }
    const params = new URLSearchParams({ search: studentSearch, pageSize: 10 })
    api
      .get(`/students?${params.toString()}`)
      .then((data) => setStudentOptions(data.students.filter((s) => !s.user_id)))
      .catch(() => setStudentOptions([]))
  }, [role, studentSearch])

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const payload =
        role === 'student' ? { role: 'student', studentId: selectedStudent.id } : { email, fullName, role }
      const result = await api.post('/auth/register', payload)
      setCreated(result)
      setEmail('')
      setFullName('')
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
  const canSubmit = isStudentRole ? Boolean(selectedStudent && selectedStudent.email) : Boolean(email && fullName)

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
          </>
        )}

        {error && <Alert>{error}</Alert>}
        <button type="submit" className="btn-primary" disabled={submitting || !canSubmit}>
          {submitting ? 'Creating Account...' : 'Create Account'}
        </button>
      </form>
    </div>
  )
}
