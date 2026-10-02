import { useState } from 'react'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { api } from '../api/client'

const ROLE_LABELS = {
  adviser: 'Adviser',
  subject_teacher: 'Subject Teacher',
  guidance_counselor: 'Guidance Counselor',
  registrar: 'Registrar',
  principal: 'Principal',
  ict_faculty: 'ICT Faculty',
}

// Admin/registrar create staff accounts here. There is no email-sending
// infrastructure in this system, so the generated temporary password is
// shown exactly once, right after creation — it cannot be retrieved again
// after leaving this page, so the admin/registrar must relay it to the new
// user right now.
export function CreateStaffAccountPage() {
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState('adviser')
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [created, setCreated] = useState(null) // { user, tempPassword }
  const [copied, setCopied] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const result = await api.post('/auth/register', { email, fullName, role })
      setCreated(result)
      setEmail('')
      setFullName('')
      setRole('adviser')
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

  return (
    <div style={{ maxWidth: 480 }}>
      <Breadcrumbs items={[{ label: 'Home', to: '/' }, { label: 'Staff Accounts', to: '/staff' }, { label: 'New' }]} />
      <h1>New Staff Account</h1>

      {created && (
        <div className="alert alert--success">
          <p style={{ fontWeight: 500 }}>
            Account created for {created.user.fullName} ({ROLE_LABELS[created.user.role]}).
          </p>
          <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>
            Share this temporary password with them now — it will not be shown again. They'll be
            required to change it on first login.
          </p>
          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
            <code className="alert__code">{created.tempPassword}</code>
            <button type="button" onClick={handleCopy}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <label>
          Full name
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} required style={{ width: '100%' }} />
        </label>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required style={{ width: '100%' }} />
        </label>
        <label>
          Role
          <select value={role} onChange={(e) => setRole(e.target.value)} style={{ width: '100%' }}>
            {Object.entries(ROLE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        {error && <p style={{ color: 'var(--color-danger)' }}>{error}</p>}
        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? 'Creating Account...' : 'Create Account'}
        </button>
      </form>
    </div>
  )
}
