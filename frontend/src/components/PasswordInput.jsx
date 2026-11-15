import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import './PasswordInput.css'

// A password box with a show/hide button inside it — used by every password
// field in the app (log in, forced change, profile, forgot password), so the
// control looks and behaves the same everywhere.
//
// Why it matters on a change-password form especially: the new password is
// typed twice blind, and on a phone keyboard a single slip means the two
// boxes disagree and the person cannot see why. Showing it lets them check.
//
// Each field gets its own toggle (current, new and confirm are independent),
// and the field starts hidden every time the form is shown.
//
// Every prop goes to the <input> itself — id, value, onChange, autoComplete,
// required, minLength — including the aria-invalid / aria-describedby that
// FormField adds by cloning its child, so validation messages stay attached
// to the real input. `type` is the one prop it owns.
//
// The toggle is a real, keyboard-reachable button (the login page's old one
// was tabIndex -1, so a keyboard user could never reveal what they typed).
// aria-pressed tells a screen reader its state; the label says what pressing
// it will do.
export function PasswordInput({ ref, type: _ignoredType, ...inputProps }) {
  const [visible, setVisible] = useState(false)
  const label = visible ? 'Hide password' : 'Show password'

  return (
    <span className="password-input">
      <input ref={ref} {...inputProps} type={visible ? 'text' : 'password'} />
      <button
        type="button"
        className="password-input__toggle"
        onClick={() => setVisible((v) => !v)}
        aria-label={label}
        aria-pressed={visible}
        title={label}
      >
        {visible ? <EyeOff size={17} strokeWidth={1.75} aria-hidden="true" /> : <Eye size={17} strokeWidth={1.75} aria-hidden="true" />}
      </button>
    </span>
  )
}
