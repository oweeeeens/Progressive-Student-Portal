import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MoreVertical } from 'lucide-react'

// The ONE row-action pattern: a kebab menu at the right end of every row
// that has actions. Before this, one table used inline text links, another
// used icon buttons and a third had nothing — so "where do I act on a row"
// had a different answer per page.
//
// `actions`: [{ key, label, icon, onSelect, danger, disabled, title }].
// A page passes what the row can do; it never decides how that looks.
//
// The sheet is rendered through a PORTAL, which is the whole reason this
// component is more than a div. Anchored inside its own cell it was invisible:
// a row's <td> is 56x44px with `overflow: hidden` (the rule that truncates a
// long name with an ellipsis), and the sheet is drawn below and wider than
// that, so it was clipped out of existence — the menu opened, the items
// rendered, and nothing appeared. Two more ancestors would have clipped or
// buried it even then: .table-card's own overflow, which keeps the table's
// rounded corners, and .app-shell__page's stacking context, which caps page
// content beneath the sticky top bar. A portal to document.body escapes all
// three at once.

const GAP = 2

export function RowMenu({ actions, label = 'Row actions' }) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState(null)
  const wrapRef = useRef(null)
  const triggerRef = useRef(null)
  const sheetRef = useRef(null)

  // Anchor the sheet to the trigger in viewport coordinates. Called on open
  // and again whenever anything moves underneath it.
  const place = useCallback(() => {
    const trigger = triggerRef.current
    const sheet = sheetRef.current
    if (!trigger || !sheet) return

    const anchor = trigger.getBoundingClientRect()
    const { offsetWidth: width, offsetHeight: height } = sheet

    // Below the trigger by default; above it when that would cross the
    // bottom of the viewport, which is the common case for the last rows of
    // a long table.
    const below = anchor.bottom + GAP
    const flip = below + height > window.innerHeight && anchor.top - height - GAP > 0
    const top = flip ? anchor.top - height - GAP : below

    // Right-aligned to the trigger, then clamped so a narrow screen can
    // never push it off either edge.
    const ideal = anchor.right - width
    const left = Math.max(GAP, Math.min(ideal, window.innerWidth - width - GAP))

    setPosition({ top, left })
  }, [])

  // useLayoutEffect, not useEffect: measure and place before the browser
  // paints, or the sheet is visible for one frame at the top-left corner.
  useLayoutEffect(() => {
    if (open) place()
  }, [open, place])

  useEffect(() => {
    if (!open) return undefined

    // A click inside the sheet is NOT inside the wrapper any more — the
    // sheet lives at the end of <body>. Checking only the wrapper would
    // treat picking an item as an outside click, and because this listens
    // on pointerdown (which precedes click) the sheet would unmount before
    // the item's own handler ever ran: a menu that opens correctly and does
    // nothing.
    function onDocPointerDown(e) {
      const inWrap = wrapRef.current?.contains(e.target)
      const inSheet = sheetRef.current?.contains(e.target)
      if (!inWrap && !inSheet) setOpen(false)
    }
    function onKeyDown(e) {
      if (e.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    // Capture phase: the page scrolls inside .app-shell__content, not the
    // window, and a scroll event on an element does not bubble.
    function onReflow() {
      place()
    }

    document.addEventListener('pointerdown', onDocPointerDown)
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('scroll', onReflow, true)
    window.addEventListener('resize', onReflow)
    return () => {
      document.removeEventListener('pointerdown', onDocPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('scroll', onReflow, true)
      window.removeEventListener('resize', onReflow)
    }
  }, [open, place])

  const available = actions.filter(Boolean)
  if (available.length === 0) return null

  function close() {
    setOpen(false)
    setPosition(null)
  }

  return (
    <div className="row-menu" ref={wrapRef}>
      <button
        type="button"
        ref={triggerRef}
        className="row-menu__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        // Rows are clickable, so every control inside one has to stop the
        // click reaching the row or opening the menu would also navigate.
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
      >
        <MoreVertical size={16} strokeWidth={1.75} />
      </button>

      {open &&
        createPortal(
          <div
            className="row-menu__sheet"
            role="menu"
            ref={sheetRef}
            // Hidden until measured, so it is never painted at 0,0 first.
            style={position ? { top: position.top, left: position.left } : { visibility: 'hidden' }}
          >
            {available.map((action) => (
              <button
                key={action.key}
                type="button"
                role="menuitem"
                className={`row-menu__item${action.danger ? ' is-danger' : ''}`}
                disabled={action.disabled}
                title={action.title}
                onClick={(e) => {
                  e.stopPropagation()
                  close()
                  action.onSelect()
                }}
              >
                {action.icon && <action.icon size={14} strokeWidth={1.75} />}
                {action.label}
              </button>
            ))}
          </div>,
          document.body
        )}
    </div>
  )
}
