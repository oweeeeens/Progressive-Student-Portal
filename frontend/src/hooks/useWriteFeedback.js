import { useCallback, useRef, useState } from 'react'
import { useToast } from '../context/ToastContext'

// The three things every write on a list page needs, in one place: what went
// wrong, what went right, and whether one is already in flight.
//
// Two gaps this closes, both of which were real on all four Academic Setup
// pages and on Interventions.
//
// **Silence meant success.** A failed write showed an Alert; a successful one
// closed the modal and refetched, and that was the only signal. So the page
// taught people that no message means it worked — which is exactly backwards
// from how every other kind of software behaves, and leaves a deactivation
// (the one irreversible-looking action on these pages) completely unconfirmed.
//
// **A double-click fired two writes.** The row actions had no in-flight
// guard at all. Deactivate twice is harmless; create twice is a duplicate
// row, and on a slow connection — which a school on municipal wifi is —
// clicking again because nothing happened yet is the natural thing to do.
//
// `busyKey` is a key rather than a boolean so a page can disable the one row
// being acted on instead of freezing the whole table.
//
// SUCCESS GOES TO A TOAST, FAILURE STAYS INLINE. The confirmation used to
// render as an Alert at the top of the page, which had the same flaw as the
// edit forms did: act on a row at the bottom of a fifteen-row table and the
// receipt appeared somewhere you were not looking. A toast follows the
// reader. Errors deliberately do NOT move — "this did not save, and here is
// why" has to stay on screen until something changes, which is exactly what
// Alert.jsx was built for and exactly what a timer would ruin.
export function useWriteFeedback() {
  const { showToast } = useToast()
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [busyKey, setBusyKey] = useState(null)

  // The gate has to be a ref, not the state above. A double-click fires both
  // handlers before React re-renders, so both would still read `busyKey` as
  // null and both writes would go out. The ref updates synchronously.
  const inFlight = useRef(false)

  // Runs one write and reports it. Returns true only if it succeeded, so a
  // caller can close its form on success and leave it open with the error on
  // failure.
  const runWrite = useCallback(async (key, action, successMessage) => {
    if (inFlight.current) return false
    inFlight.current = true
    setBusyKey(key)
    setError(null)
    setNotice(null)
    try {
      await action()
      if (successMessage) {
        setNotice(successMessage)
        showToast(successMessage)
      }
      return true
    } catch (err) {
      setError(err.message)
      return false
    } finally {
      inFlight.current = false
      setBusyKey(null)
    }
  }, [showToast])

  // For the page's own reads, which report failures through the same Alert
  // but are not writes and take no in-flight gate.
  const clearFeedback = useCallback(() => {
    setError(null)
    setNotice(null)
  }, [])

  return { error, setError, notice, setNotice, busyKey, runWrite, clearFeedback }
}
