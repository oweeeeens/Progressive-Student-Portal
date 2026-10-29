import { useEffect, useRef } from 'react'

// Everything inside a container that can take keyboard focus, in document
// order. Kept here, apart from the logic, because the list is a fiddly
// constant that gets copied wrong: `[tabindex]:not([tabindex="-1"])` is the
// part people usually drop, and `:not([disabled])` the part they forget.
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

// Keeps keyboard focus inside `ref` while `active`, and calls `onDismiss` on
// Escape.
//
// Why this exists: once the navigation drawer covers the page, tabbing has
// to stay in the drawer — otherwise focus walks invisibly through the page
// underneath and a keyboard user is typing into something they cannot see.
// The page itself is marked `inert` by Layout, which handles assistive tech
// and most of the tab order; this closes the loop by wrapping at the ends
// and restoring focus to wherever it came from on close.
export function useFocusTrap(ref, active, onDismiss) {
  // Where focus was before the trap opened, so it can go back there — the
  // standard close behaviour for anything modal, and the difference between
  // a drawer that returns you to the menu button and one that dumps you at
  // the top of the document.
  const previouslyFocused = useRef(null)

  useEffect(() => {
    if (!active) return undefined
    const container = ref.current
    if (!container) return undefined

    previouslyFocused.current = document.activeElement
    const first = container.querySelector(FOCUSABLE)
    first?.focus()

    function onKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onDismiss()
        return
      }
      if (event.key !== 'Tab') return
      // Re-queried on every Tab rather than captured once: the nav's
      // collapsible groups mean the focusable list genuinely changes while
      // the drawer is open.
      const focusable = Array.from(container.querySelectorAll(FOCUSABLE))
      if (focusable.length === 0) return
      const firstEl = focusable[0]
      const lastEl = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === firstEl) {
        event.preventDefault()
        lastEl.focus()
      } else if (!event.shiftKey && document.activeElement === lastEl) {
        event.preventDefault()
        firstEl.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      // Only take focus back if it is still somewhere in here — if the
      // reader has already clicked elsewhere, yanking it would be rude.
      if (container.contains(document.activeElement)) {
        previouslyFocused.current?.focus?.()
      }
    }
  }, [ref, active, onDismiss])
}
