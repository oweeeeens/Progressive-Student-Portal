import { useCallback, useEffect, useRef } from 'react'
import { X } from 'lucide-react'

// A form that opens where you are looking, instead of at the top of the page.
//
// THE PROBLEM THIS FIXES. Every create/edit form on the list pages rendered
// inline ABOVE its table. Click Edit on the last row of a fifteen-row table
// and the form appeared off-screen: you scrolled up to find what you had
// just opened, filled it in, saved, and scrolled back down to see whether it
// worked. On a phone that is most of the page's height each way.
//
// WHY THE NATIVE <dialog> AND NOT A DIV. `showModal()` gives focus trapping,
// Escape, a background made `inert`, and a `::backdrop` — all correct, none
// of it hand-written. Layout.jsx had to derive the same behaviour by hand for
// the navigation drawer; there is no reason to do it twice.
//
// But the decisive reason is the TOP LAYER. This app is an awkward place to
// float anything: `.app-shell__content` is `overflow-x: clip` AND the scroll
// container, `.table-card` has its own overflow, and `.app-shell__page`
// creates a stacking context. RowMenu.jsx records what that does to an
// ordinary absolutely-positioned element — "the menu opened, the items
// rendered, and nothing appeared" — and escapes it by portalling to
// document.body. A modal dialog is promoted to the browser's top layer, which
// escapes all three at once, and needs no z-index picked against the layers
// already in use (RowMenu's sheet at 60, the drawer scrim at 40, the top bar
// at 15).
//
// DIRTINESS IS THIS COMPONENT'S OWN BUSINESS. It watches for input inside
// itself rather than asking every page to track and pass a flag. That is
// seven fewer pieces of per-page state, and it answers the question actually
// being asked — "has anything been typed since this opened" — rather than
// seven separate approximations of it.
export function Modal({ open, onClose, title, description, children, size = 'default' }) {
  const dialogRef = useRef(null)
  // Whether anything has been typed since this opened. A ref, not state:
  // nothing renders differently because of it, and it is read inside event
  // handlers where a stale state value would be wrong.
  const dirtyRef = useRef(false)

  // One way out, whatever triggered it — Escape, the backdrop, the X, or
  // Cancel. Keeping it single means the unsaved-work question cannot be
  // asked on one route out and skipped on another.
  const requestClose = useCallback(() => {
    if (dirtyRef.current) {
      // Deliberately the same prompt the app already uses for unsaved work
      // (utils/unsavedChangesGuard.js) rather than a second, differently
      // worded idea of the same question.
      const leave = window.confirm('You have unsaved changes. Close this form without saving?')
      if (!leave) return
    }
    dirtyRef.current = false
    onClose()
  }, [onClose])

  // The <dialog> ELEMENT stays mounted while only its contents come and go.
  // That keeps a stable node for showModal()/close() to drive, while giving
  // each opening a fresh render of the form — so an autofocused field fires
  // and nothing is inherited from the last time it was open.
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return undefined

    if (open && !dialog.open) {
      dirtyRef.current = false
      dialog.showModal()
    } else if (!open && dialog.open) {
      dialog.close()
    }
    return undefined
  }, [open])

  // Escape fires `cancel` before `close`. Intercepting it here routes the key
  // through the same unsaved-work check as every other way out.
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return undefined

    function onCancel(event) {
      event.preventDefault()
      requestClose()
    }
    dialog.addEventListener('cancel', onCancel)
    return () => dialog.removeEventListener('cancel', onCancel)
  }, [requestClose])

  // The page scrolls inside `.app-shell__content`, not the window — so
  // locking `<body>` would do nothing at all here. `showModal()` already
  // makes the background inert to clicks and the keyboard; this stops the
  // page sliding around behind the dialog on a trackpad or a phone.
  useEffect(() => {
    if (!open) return undefined
    const shell = document.querySelector('.app-shell__content')
    if (!shell) return undefined
    const previous = shell.style.overflow
    shell.style.overflow = 'hidden'
    return () => {
      shell.style.overflow = previous
    }
  }, [open])

  // A click lands on the <dialog> itself only when it was outside the panel —
  // the backdrop is part of the dialog's own box, so anything inside the
  // content hits a child instead and this never fires.
  function handleDialogClick(event) {
    if (event.target === dialogRef.current) requestClose()
  }

  return (
    <dialog
      ref={dialogRef}
      className={`modal modal--${size}`}
      onClick={handleDialogClick}
      aria-labelledby="modal-title"
      aria-describedby={description ? 'modal-description' : undefined}
    >
      {/* Marks the form dirty on the first keystroke or selection. `input`
          covers typing, `change` covers selects, checkboxes and file
          pickers — between them, every control these forms use. */}
      {open && (
      <div
        className="modal__panel"
        onInput={() => {
          dirtyRef.current = true
        }}
        onChange={() => {
          dirtyRef.current = true
        }}
      >
        <header className="modal__head">
          <div>
            <h2 className="modal__title" id="modal-title">
              {title}
            </h2>
            {description && (
              <p className="modal__description" id="modal-description">
                {description}
              </p>
            )}
          </div>
          <button type="button" className="btn-icon" onClick={requestClose} aria-label="Close">
            <X size={18} strokeWidth={1.75} />
          </button>
        </header>

        {/* The scrolling part. Only this scrolls, so the heading and the
            save/cancel buttons stay put on a long form at phone height. */}
        <div className="modal__body">{children}</div>
      </div>
      )}
    </dialog>
  )
}
