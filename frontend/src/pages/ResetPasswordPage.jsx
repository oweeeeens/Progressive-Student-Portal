import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import { AuthCard } from '../components/AuthCard'

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')
  const navigate = useNavigate()

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
      await api.post('/auth/reset-password', { token, newPassword })
      navigate('/login', { state: { resetComplete: true } })
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  if (!token) {
    return (
      <AuthCard heading="Reset password">
        <p className="login-card__error">
          This link is missing its reset token. Request a new one from the login page.
        </p>
        <p className="login-card__footer-link">
          <Link to="/forgot-password">Request a new reset link</Link>
        </p>
      </AuthCard>
    )
  }

  return (
    <AuthCard heading="Reset password">
      <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)', marginTop: 'calc(-1 * var(--space-2))' }}>
        Choose a new password for your account.
      </p>

      <form onSubmit={handleSubmit} className="login-card__form">
        <label>
          New password <span className="required-mark">*</span>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            minLength={8}
            required
            autoFocus
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
          {submitting ? 'Resetting Password...' : 'Reset Password'}
        </button>
      </form>

      <p className="login-card__footer-link">
        <Link to="/login">Back to log in</Link>
      </p>
    </AuthCard>
  )
}
