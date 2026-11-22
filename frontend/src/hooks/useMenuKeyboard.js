import { useEffect, useRef } from 'react'

// Keyboard behaviour for a menu opened from a button — the WAI-ARIA
// Authoring Practices "menu button" pattern, which is what `role="menu"`
// promises a screen-reader or keyboard user:
//
//   opening       focus moves to the first item
//   ↓ / ↑         next / previous item (wrapping)
//   Home / End    first / last item
//   Escape        close, focus back on the button
//   Tab           close, and carry on to whatever follows the button
//
// WHY IT EXISTS (HCI audit, 2026-11-22). Both menus — the row "⋮" menu and
// the account menu — opened with focus left on their button. The row menu
// is portalled to the end of <body> (see RowMenu.jsx for why), so Tab went
// to the next control in the TABLE while the menu stayed open: Edit,
// Deactivate and Reset password were out of reach from the keyboard.
//
// `menuRef` is the element holding the items, `triggerRef` the button that
// opened it, `onClose` closes it. Disabled items are skipped.
export function useMenuKeyboard(menuRef, triggerRef, open, onClose) {
  // Held in a ref: callers pass a fresh function every render, and an effect
  // that re-ran on each render would pull focus back to the first item.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    if (!open) return undefined

    const items = () => [...(menuRef.current?.querySelectorAll('[role="menuitem"]:not(:disabled)') || [])]

    // Focus the first item once it can take focus. RowMenu keeps its sheet
    // `visibility: hidden` until it has measured where to put it, and a
    // hidden element refuses focus — so try again over the next few frames.
    let frame = 0
    let tries = 0
    function focusFirst() {
      const first = items()[0]
      if (first) first.focus()
      if ((!first || document.activeElement !== first) && tries < 10) {
        tries += 1
        frame = requestAnimationFrame(focusFirst)
      }
    }
    frame = requestAnimationFrame(focusFirst)

    function handleKeyDown(event) {
      const list = items()
      if (list.length === 0) return
      const index = list.indexOf(document.activeElement)
      const inMenu = index !== -1
      if (event.key === 'Escape') {
        onCloseRef.current()
        triggerRef.current?.focus()
        return
      }
      if (event.key === 'Tab') {
        // Back on the button first, so the browser's own Tab carries on to
        // whatever follows the button rather than to the end of the page.
        if (inMenu) {
          onCloseRef.current()
          triggerRef.current?.focus()
        }
        return
      }
      let next = null
      if (event.key === 'ArrowDown') next = inMenu ? (index + 1) % list.length : 0
      else if (event.key === 'ArrowUp') next = inMenu ? (index - 1 + list.length) % list.length : list.length - 1
      else if (event.key === 'Home') next = 0
      else if (event.key === 'End') next = list.length - 1
      if (next !== null) {
        event.preventDefault()
        list[next].focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, menuRef, triggerRef])
}
