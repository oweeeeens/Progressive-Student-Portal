import { useCallback, useRef, useState } from 'react'
import { Modal } from '../components/Modal'

// Ask before doing something that cannot be quietly undone.
//
// WHY THIS EXISTS. Resetting a password, deactivating an account and
// deactivating a section, subject or class offering all used to happen on a
// single click of a row menu item, with nothing between the click and the
// request. A password reset stops the person's current password working
// IMMEDIATELY; a deactivation signs them out on their next request. A slip
// of the finger on the wrong row of a fifteen-row table did either to the
// wrong person, and the first anyone knew was a toast saying it was done.
//
// WHY NOT window.confirm. It works, but it is the browser's box — headed
// "localhost says", unstyled, and unable to say which person or which
// consequence in anything but one run-on sentence. This is the app's own
// Modal (native <dialog>: focus trap, Escape, inert background), so the
// question looks like the rest of the product and can name the object.
//
// USAGE — the page awaits a yes/no, so the guard is one line where the
// action already lives:
//
//   const [confirm, confirmDialog] = useConfirm()
//   if (!(await confirm({ title, message, confirmLabel, danger: true }))) return
//   ...
//   return <>{page}{confirmDialog}</>
//
// The safe choice is the default: Cancel is first in the tab order after the
// message and Escape or a backdrop click answers "no".
export function useConfirm() {
  const [request, setRequest] = useState(null)
  // The pending promise's resolver. A ref: it is read in handlers, and
  // nothing renders from it.
  const resolverRef = useRef(null)

  const confirm = useCallback((options) => {
    return new Promise((resolve) => {
      resolverRef.current = resolve
      setRequest(options)
    })
  }, [])

  // Every way out ends here, so the promise is always settled exactly once.
  const answer = useCallback((value) => {
    resolverRef.current?.(value)
    resolverRef.current = null
    setRequest(null)
  }, [])

  const dialog = (
    <Modal open={Boolean(request)} onClose={() => answer(false)} title={request?.title || ''} size="narrow">
      {request && (
        <div className="confirm-dialog">
          <p className="confirm-dialog__message">{request.message}</p>
          {/* Optional summary under the sentence — counts, the class and
              term, the note being sent. A <div>, not inside the <p>, so it
              can hold a list. */}
          {request.details && <div className="confirm-dialog__details">{request.details}</div>}
          <div className="button-row confirm-dialog__actions">
            <button type="button" onClick={() => answer(false)} autoFocus>
              Cancel
            </button>
            <button type="button" className={request.danger ? 'btn-danger' : 'btn-primary'} onClick={() => answer(true)}>
              {request.confirmLabel || 'Confirm'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )

  return [confirm, dialog]
}
