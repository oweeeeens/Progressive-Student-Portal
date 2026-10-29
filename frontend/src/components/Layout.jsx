import { useEffect, useRef, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { moduleForPath } from '../utils/moduleTheme'
import { useMediaQuery, PHONE_QUERY } from '../hooks/useMediaQuery'
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
  // Deliberately separate state from `sidebarCollapsed`, not a reuse of it.
  // They are different ideas: collapsed is a remembered preference about how
  // wide a permanently-visible panel should be, open is a transient overlay
  // that covers the page. Conflating them is exactly why the toggle button
  // used to do nothing on a phone — the CSS forced the rail at that width
  // whatever the stored preference said, so the only control over
  // navigation was a no-op.
  const [drawerOpen, setDrawerOpen] = useState(false)
  const isPhone = useMediaQuery(PHONE_QUERY)
  const { pathname } = useLocation()
  const contentRef = useRef(null)
  const menuButtonRef = useRef(null)

  // The shell, not the window, is the scroll container (see Layout.css), so
  // nothing resets it on navigation: arriving at a new page while scrolled
  // halfway down the previous one used to land the reader in the middle of
  // the new one, past its heading.
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 })
  }, [pathname])

  // Navigating is the whole reason the drawer was opened, so arriving
  // somewhere closes it. Without this the new page loads behind a drawer
  // still covering it.
  useEffect(() => {
    setDrawerOpen(false)
  }, [pathname])

  // Growing past the phone breakpoint while the drawer is open would leave
  // the page inert behind a panel that is no longer an overlay.
  useEffect(() => {
    if (!isPhone) setDrawerOpen(false)
  }, [isPhone])

  function closeDrawer() {
    setDrawerOpen(false)
    // Send focus back where it came from, rather than to the top of the
    // document — the standard close behaviour for anything modal.
    menuButtonRef.current?.focus()
  }

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
      <Sidebar
        // The icon rail is a DESKTOP affordance. Below the phone breakpoint
        // the sidebar is a full-label drawer, so a collapse preference
        // remembered from a desktop session must not follow the user onto
        // their phone and hand them an icon-only drawer — which would be
        // the one layout with neither the space saving nor the labels.
        collapsed={isPhone ? false : sidebarCollapsed}
        isDrawer={isPhone}
        open={drawerOpen}
        onClose={closeDrawer}
      />
      {/* The backdrop. Also the large, obvious way out: tapping anywhere on
          the page closes the drawer, which is what most people reach for
          before they look for a close button. */}
      {isPhone && drawerOpen && (
        <div className="app-shell__scrim" onClick={closeDrawer} aria-hidden="true" />
      )}
      {/* data-module colours everything below it — the page's header wash,
          its icon tiles, its table header. Set here, once, from the route,
          so no page component has to know which hue it belongs to. */}
      {/* `inert` while the drawer covers the page: it takes the whole page
          out of the tab order and away from assistive tech, which is what
          keeps focus inside the drawer without hand-written key handling. */}
      <main
        className="app-shell__content"
        ref={contentRef}
        data-module={moduleForPath(pathname)}
        inert={isPhone && drawerOpen}
      >
        <TopBar
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={isPhone ? () => setDrawerOpen(true) : toggleSidebar}
          isPhone={isPhone}
          drawerOpen={drawerOpen}
          menuButtonRef={menuButtonRef}
        />
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
