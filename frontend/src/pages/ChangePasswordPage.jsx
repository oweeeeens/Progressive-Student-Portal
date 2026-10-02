import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { AuthCard } from '../components/AuthCard'

// Shown instead of the normal app (no sidebar — every other route would
// just redirect back here anyway) whenever the account has a forced
// password change pending. See ProtectedRoute and backend authMiddleware.js.
export function ChangePasswordPage() {
  const { user, markPasswordChanged } = useAuth()
  const navigate = useNavigate()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)

    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.')
      return
    }

    setSubmitting(true)
    try {
      await api.post('/auth/change-password', { currentPassword, newPassword })
      markPasswordChanged()
      navigate('/')
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthCard heading="Change your password">
      <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)', marginTop: 'calc(-1 * var(--space-2))' }}>
        {user?.mustChangePassword
          ? 'Your account was created with a temporary password. Set a new one to continue.'
          : 'Choose a new password.'}
      </p>

      <form onSubmit={handleSubmit} className="login-card__form">
        <label>
          Current (temporary) password <span className="required-mark">*</span>
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
            autoFocus
          />
        </label>
        <label>
          New password <span className="required-mark">*</span>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            minLength={8}
            required
          />
        </label>
        <label>
          Confirm new password <span className="required-mark">*</span>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            minLength={8}
            required
          />
        </label>
        {error && <p className="login-card__error">{error}</p>}
        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? 'Changing Password...' : 'Change Password'}
        </button>
      </form>
    </AuthCard>
  )
}
