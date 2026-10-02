import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { AuthCard } from '../components/AuthCard'

// Always shows the same success message whether or not the email has an
// account — matches the backend's deliberate non-enumeration behavior (see
// authController.forgotPassword), so the UI shouldn't contradict that by
// e.g. showing a different state for "email not found."
export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await api.post('/auth/forgot-password', { email })
      setSubmitted(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthCard heading="Forgot password">
      <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)', marginTop: 'calc(-1 * var(--space-2))' }}>
        Enter your email and we'll send you a reset link.
      </p>

      {submitted ? (
        <p className="login-card__success">
          If an account exists for that email, a password reset link has been sent. The link
          expires in 1 hour.
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="login-card__form">
          <label>
            Email <span className="required-mark">*</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </label>
          {error && <p className="login-card__error">{error}</p>}
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? 'Sending...' : 'Send Reset Link'}
          </button>
        </form>
      )}

      <p className="login-card__footer-link">
        <Link to="/login">Back to log in</Link>
      </p>
    </AuthCard>
  )
}
