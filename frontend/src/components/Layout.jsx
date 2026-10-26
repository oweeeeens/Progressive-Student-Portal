import { useEffect, useRef, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { moduleForPath } from '../utils/moduleTheme'
import './Layout.css'

const SIDEBAR_COLLAPSED_KEY = 'studentPortal.sidebarCollapsed'

function getInitialCollapsed() {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true'
  } catch {
    // Private browsing / blocked storage — default to expanded rather than
    // let a storage access error break the whole shell.
    return false
  }
}

// The persistent app shell: sidebar + top bar render here, once, and stay
// mounted across every route via <Outlet/> — only the routed page swaps
// below them. Previously TopBar was rendered per-page (only DashboardPage
// actually did), so every other page had no top bar at all and Dashboard's
// own instance remounted on every visit; this is the fix.
export function Layout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(getInitialCollapsed)
  const { pathname } = useLocation()
  const contentRef = useRef(null)

  // The shell, not the window, is the scroll container (see Layout.css), so
  // nothing resets it on navigation: arriving at a new page while scrolled
  // halfway down the previous one used to land the reader in the middle of
  // the new one, past its heading.
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 })
  }, [pathname])

  function toggleSidebar() {
    setSidebarCollapsed((prev) => {
      const next = !prev
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next))
      } catch {
        // Storage can throw (private browsing, quota, blocked) — the
        // toggle still works for this session, it just won't be
        // remembered on the next load.
      }
      return next
    })
  }

  return (
    <div className="app-shell">
      <Sidebar collapsed={sidebarCollapsed} />
      {/* data-module colours everything below it — the page's header wash,
          its icon tiles, its table header. Set here, once, from the route,
          so no page component has to know which hue it belongs to. */}
      <main className="app-shell__content" ref={contentRef} data-module={moduleForPath(pathname)}>
        <TopBar sidebarCollapsed={sidebarCollapsed} onToggleSidebar={toggleSidebar} />
        {/* Keyed by route so the entrance animation replays on navigation —
            without the key this element persists across routes and the
            animation would only ever run once, on first load. */}
        <div className="app-shell__page" key={pathname}>
          <Outlet />
        </div>
      </main>
    </div>
  )
}
