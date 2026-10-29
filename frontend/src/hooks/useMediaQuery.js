import { useEffect, useState } from 'react'

// Lets a component know about a breakpoint that CSS alone cannot express.
//
// Most responsive work in this app belongs in CSS and stays there. This is
// for the cases where the BEHAVIOUR changes, not just the appearance: below
// the phone breakpoint the sidebar stops being a panel that collapses and
// becomes a drawer that opens over the page, and a drawer has to trap focus,
// close on Escape and mark the page behind it inert. None of that is a
// stylesheet's job, so the component has to actually know.
//
// Reads the match immediately rather than starting false and correcting on
// the first effect: that correction is a second render, and on a drawer it
// would briefly show the wrong chrome on load.
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => {
    // Guard for a non-browser render (tests, any future SSR) — matchMedia
    // does not exist there and must not throw the whole shell.
    if (typeof window === 'undefined' || !window.matchMedia) return false
    return window.matchMedia(query).matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined
    const list = window.matchMedia(query)
    const onChange = (event) => setMatches(event.matches)
    // Re-read on subscribe: the viewport can change between the initial
    // state above and this effect running, and the listener only fires on
    // CHANGES after it is attached — it would never tell us about one we
    // already missed.
    setMatches(list.matches)
    list.addEventListener('change', onChange)
    return () => list.removeEventListener('change', onChange)
  }, [query])

  return matches
}

// The one phone breakpoint the shell switches behaviour at. Written here, as
// a string, because CSS custom properties cannot be used inside an @media
// condition — so the number genuinely does have to be repeated between this
// file and the stylesheet. Keeping the JS copy in one place is the next best
// thing to a shared token; Sidebar.css names this constant where it repeats
// the value.
export const PHONE_QUERY = '(max-width: 720px)'
