import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, KeyRound } from 'lucide-react'
import { api } from '../api/client'
import { StatusPill } from '../components/StatusPill'
import { Breadcrumbs } from '../components/Breadcrumbs'

const ROLE_LABELS = {
  admin: 'Admin',
  adviser: 'Adviser',
  subject_teacher: 'Subject Teacher',
  guidance_counselor: 'Guidance Counselor',
  registrar: 'Registrar',
  principal: 'Principal',
  ict_faculty: 'ICT Faculty',
}

// The admin/registrar-triggered password reset fallback (for when a staff
// member can't use the self-service forgot-password email flow) needs an
// existing user to target — this list page is what makes that reachable,
// and doubles as visibility into who's been created via "New Staff Account."
export function StaffAccountsPage() {
  const [users, setUsers] = useState(null)
  const [error, setError] = useState(null)
  const [resetResult, setResetResult] = useState(null) // { email, tempPassword } | null
  const [resettingId, setResettingId] = useState(null)

  function load() {
    api
      .get('/users')
      .then((data) => setUsers(data.users))
      .catch((err) => setError(err.message))
  }

  useEffect(load, [])

  async function handleReset(user) {
    setError(null)
    setResetResult(null)
    setResettingId(user.id)
    try {
      const result = await api.post(`/users/${user.id}/reset-password`)
      setResetResult({ email: user.email, tempPassword: result.tempPassword })
    } catch (err) {
      setError(err.message)
    } finally {
      setResettingId(null)
    }
  }

  return (
    <div>
      <Breadcrumbs items={[{ label: 'Home', to: '/' }, { label: 'Staff Accounts' }]} />

      <div className="page-header">
        <h1>Staff Accounts</h1>
        <div className="page-header__actions">
          <Link to="/staff/new" className="btn-primary">
            <Plus size={16} strokeWidth={1.75} />
            New Staff Account
          </Link>
        </div>
      </div>

      {error && <p style={{ color: 'var(--color-danger)' }}>{error}</p>}

      {resetResult && (
        <div className="alert alert--success">
          <p>
            Password reset for <strong>{resetResult.email}</strong>.
          </p>
          <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>
            Share this temporary password with them now — it will not be shown again. They'll be
            required to change it on next login.
          </p>
          <code className="alert__code">{resetResult.tempPassword}</code>
        </div>
      )}

      {!users ? (
        <p>Loading…</p>
      ) : users.length === 0 ? (
        <div className="empty-state">
          <p>No staff accounts yet.</p>
          <p>
            <Link to="/staff/new">Create the first one</Link> to get started.
          </p>
        </div>
      ) : (
        <div className="table-card">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.full_name}</td>
                  <td>{u.email}</td>
                  <td>{ROLE_LABELS[u.role] || u.role}</td>
                  <td>
                    {!u.is_active && <StatusPill label="inactive" variant="neutral" />}
                    {u.must_change_password && <StatusPill label="pending first login" variant="warning" />}
                    {u.is_active && !u.must_change_password && <StatusPill label="active" variant="positive" />}
                  </td>
                  <td>
                    <button type="button" onClick={() => handleReset(u)} disabled={resettingId === u.id}>
                      <KeyRound size={16} strokeWidth={1.75} />
                      {resettingId === u.id ? 'Resetting…' : 'Reset Password'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
