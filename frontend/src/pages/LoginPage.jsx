import { useEffect, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { SESSION_ENDED_KEY, getRememberedEmail, setRememberedEmail } from '../api/client'
import { Alert } from '../components/Alert'
import { AuthCard } from '../components/AuthCard'
import { PasswordInput } from '../components/PasswordInput'
import './LoginPage.css'

export function LoginPage() {
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  // "Remember me" keeps the email on this device (api/client.js), so a
  // remembered person finds it filled in — even after logging out — and
  // only has to type the password.
  const [rememberedEmail] = useState(getRememberedEmail)
  const [email, setEmail] = useState(rememberedEmail)
  const [password, setPassword] = useState('')
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
      // Remember who signed in here, or forget them when the box is
      // unticked — the shared-computer case.
      setRememberedEmail(remember ? email.trim() : '')
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
          {/* autoComplete="username" + "current-password" let the browser's
              own password manager offer to save and fill this sign-in. */}
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
            autoFocus={!rememberedEmail}
          />
        </label>
        <label>
          Password <span className="required-mark">*</span>
          <PasswordInput
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            // With the email already filled in, the next thing to type is
            // the password.
            autoFocus={Boolean(rememberedEmail)}
          />
        </label>
        <label className="login-card__remember">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Remember me on this device
        </label>
        {/* Said once, plainly, because "remember me" means different things
            on different sites: here it keeps you signed in for 30 days and
            keeps your email. Untick it on a shared computer. */}
        <p className="login-card__remember-note">
          {remember
            ? 'Stays signed in for 30 days and keeps your email here. Untick on a shared computer.'
            : 'You will be signed out when you close the browser, and your email will not be kept.'}
        </p>
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
