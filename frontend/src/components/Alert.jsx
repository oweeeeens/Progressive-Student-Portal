import { AlertTriangle, CheckCircle2, Info } from 'lucide-react'

// The ONE way this app reports something to the user in place — a failed
// request, a destructive warning, a confirmation. Before this, every page
// rendered its own bare red <p style={{ color: 'var(--color-danger)' }}>,
// which meant a server error arrived as a loose red sentence floating
// between a stat row and a table, with no icon, no container and no
// relationship to the content it was about.
//
// Deliberately NOT a toast: these messages explain why the thing you are
// looking at is wrong or incomplete, so they belong next to it and must
// stay on screen until the state changes, not disappear on a timer.
//
// `variant` picks the semantic colour (the non-risk status palette, never
// the risk ramp — a failed fetch is not an at-risk student). `title` is
// optional; a one-line message reads better without one.
const VARIANT_ICONS = {
  danger: AlertTriangle,
  warning: AlertTriangle,
  success: CheckCircle2,
  info: Info,
}

export function Alert({ variant = 'danger', title, children, actions }) {
  const Icon = VARIANT_ICONS[variant] || Info

  return (
    // role="alert" only for failures: it interrupts a screen reader
    // mid-sentence, which is right for "this didn't work" and wrong for a
    // success note, which is announced politely instead.
    <div className={`alert alert--${variant}`} role={variant === 'danger' ? 'alert' : 'status'}>
      <Icon className="alert__icon" size={18} strokeWidth={2} aria-hidden="true" />
      <div className="alert__body">
        {title && <p className="alert__title">{title}</p>}
        <div className="alert__message">{children}</div>
      </div>
      {actions && <div className="alert__actions">{actions}</div>}
    </div>
  )
}
