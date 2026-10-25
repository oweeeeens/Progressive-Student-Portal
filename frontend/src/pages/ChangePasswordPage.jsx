import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
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
      <p className="form-note auth-card__intro">
        {user?.mustChangePassword
          ? 'Your account was created with a temporary password. Set a new one to continue.'
          : 'Choose a new password.'}
      </p>
      {/* This page renders outside the app shell, with no sidebar. When the
          change is forced that is the point — but a student who opened it
          from the account menu must not be stranded here. */}
      {!user?.mustChangePassword && (
        <p className="login-card__footer-link">
          <Link to="/">Back to your portal</Link>
        </p>
      )}

      <form onSubmit={handleSubmit} className="login-card__form">
        <label>
          {/* "temporary" is only true the first time; reaching this page from
              the account menu later is an ordinary password change. */}
          {user?.mustChangePassword ? 'Current (temporary) password' : 'Current password'}{' '}
          <span className="required-mark">*</span>
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
