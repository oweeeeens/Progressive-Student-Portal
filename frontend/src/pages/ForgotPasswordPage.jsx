import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { Alert } from '../components/Alert'
import { AuthCard } from '../components/AuthCard'

// Always shows the same success message whether or not the email has an
// account — matches the backend's deliberate non-enumeration behavior (see
// authController.forgotPassword), so the UI shouldn't contradict that by
// e.g. showing a different state for "email not found."
//
// It also asks the server, first, whether reset-by-email works on this
// deployment at all. The school has no mail domain of its own, so a
// deployment may legitimately run without an email provider configured —
// and in that case the worst thing this page could do is take an address,
// say "a reset link has been sent," and send nothing. Instead it says so and
// names the people who CAN reset a password (User Management has a manual
// reset built for exactly this).
export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  // null while unknown: the form stays hidden until the answer arrives
  // rather than appearing and then disappearing.
  const [selfServiceAvailable, setSelfServiceAvailable] = useState(null)

  useEffect(() => {
    api
      .get('/auth/password-reset-availability')
      .then((data) => setSelfServiceAvailable(data.selfService))
      // If even this call fails the server is unreachable, so offering the
      // form would be optimistic. Fall back to the honest message.
      .catch(() => setSelfServiceAvailable(false))
  }, [])

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
      {selfServiceAvailable === null && <p className="form-note auth-card__intro">Checking…</p>}

      {selfServiceAvailable === false && (
        <>
          <Alert variant="info" title="Reset by email isn't available">
            {/* Only admin and registrar can actually reset a password (see
                canWrite in backend/routes/userRoutes.js). The earlier
                wording also named advisers and ICT staff, who would both be
                turned away — and with email unconfigured this is the only
                recovery route there is. */}
            Your school hasn't set up password reset emails. Ask the registrar or a system administrator to reset your
            password — they can issue you a temporary one, and you'll be asked to choose a new password when you next
            log in.
          </Alert>
          <p className="login-card__footer-link">
            <Link to="/login">Back to log in</Link>
          </p>
        </>
      )}

      {selfServiceAvailable === true && (
        <>
          <p className="form-note auth-card__intro">Enter your email and we'll send you a reset link.</p>

          {submitted ? (
            <Alert variant="success">
              If an account exists for that email, a password reset link has been sent. The link expires in 1 hour.
            </Alert>
          ) : (
            <form onSubmit={handleSubmit} className="login-card__form">
              <label>
                Email <span className="required-mark">*</span>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
              </label>
              {error && <Alert>{error}</Alert>}
              <button type="submit" className="btn-primary" disabled={submitting}>
                {submitting ? 'Sending…' : 'Send reset link'}
              </button>
            </form>
          )}

          <p className="login-card__footer-link">
            <Link to="/login">Back to log in</Link>
          </p>
        </>
      )}
    </AuthCard>
  )
}
