import { useEffect, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Eye, EyeOff } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { SESSION_ENDED_KEY } from '../api/client'
import { Alert } from '../components/Alert'
import { AuthCard } from '../components/AuthCard'
import './LoginPage.css'

export function LoginPage() {
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [remember, setRemember] = useState(true)
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  // Read on mount, cleared in an effect — NOT in the initializer. React's
  // StrictMode double-invokes a useState initializer in development, so a
  // side effect in there runs twice: the first call read the flag and
  // removed it, the second found nothing, and the notice never appeared.
  // The initializer is now a pure read; the removal happens once, after the
  // value has been captured, so the notice shows for this arrival only.
  const [sessionEnded] = useState(() => {
    try {
      return sessionStorage.getItem(SESSION_ENDED_KEY) === '1'
    } catch {
      return false
    }
  })

  useEffect(() => {
    try {
      sessionStorage.removeItem(SESSION_ENDED_KEY)
    } catch {
      // Blocked storage — nothing to clean up.
    }
  }, [])

  if (user) return <Navigate to="/" replace />

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await login(email, password, remember)
      navigate('/')
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthCard heading="Log in">
      {location.state?.resetComplete && (
        <Alert variant="success">Password reset. Log in with your new password.</Alert>
      )}

      {/* Set by api/client.js when the server rejects the stored token —
          an 8-hour session that ran out, or an account that was
          deactivated. Without it, being signed out mid-task looked like
          the app had simply stopped working. */}
      {sessionEnded && (
        <Alert variant="info">Your session has ended. Please log in again to continue.</Alert>
      )}

      <form onSubmit={handleSubmit} className="login-card__form">
        <label>
          Email <span className="required-mark">*</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </label>
        <label>
          Password <span className="required-mark">*</span>
          <div className="login-card__password-field">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button
              type="button"
              className="login-card__password-toggle"
              onClick={() => setShowPassword((v) => !v)}
              tabIndex={-1}
              title={showPassword ? 'Hide password' : 'Show password'}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff size={16} strokeWidth={1.75} /> : <Eye size={16} strokeWidth={1.75} />}
            </button>
          </div>
        </label>
        <label className="login-card__remember">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Remember me on this device
        </label>
        {error && <Alert>{error}</Alert>}
        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? 'Logging in…' : 'Log in'}
        </button>
      </form>

      <p className="login-card__footer-link">
        <Link to="/forgot-password">Forgot your password?</Link>
      </p>
    </AuthCard>
  )
}
