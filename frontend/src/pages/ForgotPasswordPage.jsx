import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { Alert } from '../components/Alert'
import { AuthCard } from '../components/AuthCard'
import { PasswordInput } from '../components/PasswordInput'

// Forgot password, in two steps on one page:
//
//   1. Email  -> "Send code". The server emails a 6-digit code.
//   2. Code + new password -> "Reset password".
//
// A code rather than a link (2026-11-15): a link had to be opened on the
// device that received the email, so someone reading their mail on a phone
// but using the portal on a laptop had to switch devices. A code is read
// anywhere and typed here.
//
// Step 1 always moves on to step 2, whether or not the email has an account
// — matching the backend's deliberate non-enumeration (authController.
// forgotPassword). Step 2's one error message is likewise the same for a
// wrong code, an expired one, and an address with no account.
//
// It also asks the server, first, whether reset-by-email works on this
// deployment at all. If it doesn't, the worst thing this page could do is
// take an address, say a code has been sent, and send nothing. Instead it
// says so and names the people who CAN reset a password.
export function ForgotPasswordPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState('email') // 'email' | 'code'
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [expiresInMinutes, setExpiresInMinutes] = useState(15)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  // null while unknown: the form stays hidden until the answer arrives
  // rather than appearing and then disappearing.
  const [selfServiceAvailable, setSelfServiceAvailable] = useState(null)
  const codeInputRef = useRef(null)

  useEffect(() => {
    api
      .get('/auth/password-reset-availability')
      .then((data) => setSelfServiceAvailable(data.selfService))
      // If even this call fails the server is unreachable, so offering the
      // form would be optimistic. Fall back to the honest message.
      .catch(() => setSelfServiceAvailable(false))
  }, [])

  // Put the cursor in the code box as soon as step 2 appears: the next thing
  // the person does is type the digits from their email.
  useEffect(() => {
    if (step === 'code') codeInputRef.current?.focus()
  }, [step])

  async function sendCode({ resend = false } = {}) {
    setError(null)
    setNotice(null)
    setSubmitting(true)
    try {
      const data = await api.post('/auth/forgot-password', { email })
      if (data?.codeExpiresInMinutes) setExpiresInMinutes(data.codeExpiresInMinutes)
      setStep('code')
      if (resend) {
        setCode('')
        setNotice('A new code is on its way. Only the newest code works.')
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  function handleEmailSubmit(e) {
    e.preventDefault()
    sendCode()
  }

  async function handleResetSubmit(e) {
    e.preventDefault()
    setError(null)
    setNotice(null)

    if (!/^\d{6}$/.test(code)) {
      setError('Enter the 6-digit code from the email.')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.')
      return
    }

    setSubmitting(true)
    try {
      await api.post('/auth/reset-password', { email, code, newPassword })
      navigate('/login', { state: { resetComplete: true } })
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  function changeEmail() {
    setStep('email')
    setCode('')
    setNewPassword('')
    setConfirmPassword('')
    setError(null)
    setNotice(null)
  }

  return (
    <AuthCard heading="Forgot password">
      {selfServiceAvailable === null && <p className="form-note auth-card__intro">Checking…</p>}

      {selfServiceAvailable === false && (
        <>
          <Alert variant="info" title="Reset by email isn't available">
            {/* Only admin and registrar can actually reset a password (see
                canWrite in backend/routes/userRoutes.js), and with email
                unconfigured this is the only recovery route there is. */}
            Your school hasn't set up password reset emails. Ask the registrar or a system administrator to reset your
            password — they can issue you a temporary one, and you'll be asked to choose a new password when you next
            log in.
          </Alert>
          <p className="login-card__footer-link">
            <Link to="/login">Back to log in</Link>
          </p>
        </>
      )}

      {selfServiceAvailable === true && step === 'email' && (
        <>
          <p className="form-note auth-card__intro">
            Enter your email and we&apos;ll send you a 6-digit code. You can read it on any device and type it here.
          </p>
          <form onSubmit={handleEmailSubmit} className="login-card__form">
            <label>
              Email <span className="required-mark">*</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
                autoFocus
              />
            </label>
            {error && <Alert>{error}</Alert>}
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? 'Sending…' : 'Send code'}
            </button>
          </form>
          <p className="login-card__footer-link">
            <Link to="/login">Back to log in</Link>
          </p>
        </>
      )}

      {selfServiceAvailable === true && step === 'code' && (
        <>
          <p className="form-note auth-card__intro">
            If an account uses <strong>{email}</strong>, we sent it a 6-digit code. It expires in {expiresInMinutes}{' '}
            minutes. Check your spam folder if it isn&apos;t in your inbox.
          </p>
          <form onSubmit={handleResetSubmit} className="login-card__form">
            <label>
              6-digit code <span className="required-mark">*</span>
              <input
                ref={codeInputRef}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                value={code}
                // Digits only, so a pasted "482 913" or "Code: 482913" still works.
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="6 digits from the email"
                required
              />
            </label>
            <label>
              New password <span className="required-mark">*</span>
              <PasswordInput
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </label>
            <label>
              Confirm new password <span className="required-mark">*</span>
              <PasswordInput
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </label>
            {notice && <Alert variant="info">{notice}</Alert>}
            {error && <Alert>{error}</Alert>}
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? 'Resetting…' : 'Reset password'}
            </button>
          </form>
          <p className="login-card__footer-link">
            <button type="button" className="link-button" onClick={() => sendCode({ resend: true })} disabled={submitting}>
              Send a new code
            </button>
            {' · '}
            <button type="button" className="link-button" onClick={changeEmail} disabled={submitting}>
              Use a different email
            </button>
          </p>
          <p className="login-card__footer-link">
            <Link to="/login">Back to log in</Link>
          </p>
        </>
      )}
    </AuthCard>
  )
}
