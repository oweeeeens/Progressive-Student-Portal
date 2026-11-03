import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import { ToastStack } from '../components/Toast'

// Receipts for things you just did, shown where you are rather than at the
// top of the page.
//
// WHY THIS EXISTS ALONGSIDE Alert, NOT INSTEAD OF IT. Alert.jsx says it is
// "deliberately NOT a toast", and for what it was describing that is right:
// a message explaining why the page in front of you is wrong or incomplete
// has to stay until the state changes. But that reasoning got applied to a
// second, different job — confirming an action — and those have opposite
// requirements. "Could not load this page" must persist. "Mathematics
// deactivated" must be SEEN, which is not the same thing, and it was failing
// at exactly that: deactivate a row at the bottom of a fifteen-row table and
// the confirmation appeared at the top of the page, where nobody was looking.
//
// So the split is by job, not by severity:
//   - a receipt for something you did    -> toast, here
//   - the state of what you are reading  -> Alert, unchanged, inline
//
// Failures stay inline. Nothing that needs acting on is ever only in a toast.
const ToastContext = createContext(null)

// Long enough to notice and read a short sentence, short enough not to sit
// over the page. The timer pauses on hover and focus, so this is a floor
// rather than a hard limit.
const DEFAULT_DURATION_MS = 5000

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  // Ids come from a counter, not Date.now(): two writes finishing in the
  // same millisecond would otherwise collide and React would reuse one row
  // for both.
  const nextId = useRef(0)

  const dismiss = useCallback((id) => {
    setToasts((current) => current.filter((t) => t.id !== id))
  }, [])

  const showToast = useCallback((message, variant = 'success') => {
    if (!message) return
    nextId.current += 1
    const id = nextId.current
    setToasts((current) => {
      // A cap, because a bulk action can finish several writes at once and a
      // column of toasts taller than the screen is its own problem. Oldest
      // goes first — the newest is the one the person is waiting on.
      const next = [...current, { id, message, variant }]
      return next.slice(-3)
    })
  }, [])

  const value = useMemo(() => ({ showToast }), [showToast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastStack toasts={toasts} onDismiss={dismiss} duration={DEFAULT_DURATION_MS} />
    </ToastContext.Provider>
  )
}

// Returns a no-op outside a provider rather than throwing. A missing toast
// is a missing confirmation; it must never be the reason a save appears to
// fail, and it must never break a test that renders a page in isolation.
export function useToast() {
  const context = useContext(ToastContext)
  return context || { showToast: () => {} }
}
