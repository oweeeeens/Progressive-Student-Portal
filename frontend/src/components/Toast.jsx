import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2, Info, X } from 'lucide-react'

const VARIANT_ICONS = { success: CheckCircle2, info: Info }

// One receipt. Owns its own dismissal timer so that hovering or focusing it
// pauses only that toast, not the whole stack.
function Toast({ toast, onDismiss, duration }) {
  const [paused, setPaused] = useState(false)
  const Icon = VARIANT_ICONS[toast.variant] || CheckCircle2
  useEffect(() => {
    if (paused) return undefined
    const timer = setTimeout(() => onDismiss(toast.id), duration)
    return () => clearTimeout(timer)
  }, [toast.id, duration, paused, onDismiss])

  return (
    <div
      className={`toast toast--${toast.variant}`}
      // Paused while being read, or while a keyboard user is on the dismiss
      // button — a message that vanishes mid-sentence is worse than one that
      // outstays slightly.
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <Icon className="toast__icon" size={18} strokeWidth={2} aria-hidden="true" />
      <span className="toast__message">{toast.message}</span>
      <button type="button" className="toast__close" onClick={() => onDismiss(toast.id)} aria-label="Dismiss">
        <X size={14} strokeWidth={2} />
      </button>
    </div>
  )
}

// The stack, portalled to document.body.
//
// Same reasoning as RowMenu.jsx: `.app-shell__content` is `overflow-x: clip`
// and the app's scroll container, and `.app-shell__page` creates a stacking
// context — so a fixed-position element rendered inside the page tree is on
// unreliable ground here. Rendering at the end of <body> sidesteps the
// question entirely.
export function ToastStack({ toasts, onDismiss, duration }) {
  if (typeof document === 'undefined') return null

  return createPortal(
    // aria-live on the CONTAINER, which is always mounted — announcements
    // only work if the live region exists before the message is put into it.
    // "polite", because a confirmation should wait for a screen reader to
    // finish its sentence; these are receipts, not alarms.
    <div className="toast-stack" role="status" aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onDismiss={onDismiss} duration={duration} />
      ))}
    </div>,
    document.body
  )
}
