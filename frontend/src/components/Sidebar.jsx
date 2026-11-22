import { useRef, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import {
  Home,
  ChevronDown,
  LogOut,
  CircleUser,
  X,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { confirmLeave, hasUnsavedChanges } from '../utils/unsavedChangesGuard'
import { useConfirm } from '../hooks/useConfirm'
import { roleLabel } from '../utils/roleLabel'
import { getNavSections } from '../utils/navigation'
import { useFocusTrap } from '../hooks/useFocusTrap'
import './Sidebar.css'

// Whether the current URL belongs to this section — used to force it open
// even if the user had previously collapsed it, so navigating somewhere
// never leaves the active page hidden inside a collapsed group. Prefix
// matching (not just equality) so a page like /students/42 still counts as
// part of the Students section even though no nav item links to it exactly.
function isSectionActive(section, pathname) {
  return section.items.some((item) => pathname === item.to || pathname.startsWith(`${item.to}/`))
}

// A nav item with children: the parent row plus its indented child links.
// The parent expands when the user clicks its chevron AND whenever one of
// its children is the active route, so navigating to /my-progress/trends
// can never leave the current page hidden inside a collapsed parent — the
// same rule the top-level sections already follow.
function NavItemWithChildren({ item, pathname }) {
  const isBranchActive = pathname === item.to || pathname.startsWith(`${item.to}/`)
  const [manuallyExpanded, setManuallyExpanded] = useState(false)
  const expanded = isBranchActive || manuallyExpanded

  return (
    <div className="sidebar__subnav">
      <div className="sidebar__parent-row">
        <NavLink
          to={item.to}
          onClick={(e) => {
            if (!confirmLeave()) e.preventDefault()
          }}
          className={`sidebar__link${isBranchActive ? ' sidebar__link--active' : ''}`}
          title={item.label}
        >
          <item.icon size={18} strokeWidth={1.75} className="sidebar__link-icon" />
          <span className="sidebar__link-label">{item.label}</span>
        </NavLink>
        <button
          type="button"
          className="sidebar__parent-toggle"
          onClick={() => setManuallyExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${item.label}`}
          title={`${expanded ? 'Collapse' : 'Expand'} ${item.label}`}
        >
          <ChevronDown size={13} strokeWidth={2} className={`sidebar__section-chevron${expanded ? '' : ' sidebar__section-chevron--collapsed'}`} />
        </button>
      </div>

      {expanded && (
        <div className="sidebar__children">
          {item.children.map((child) => (
            <NavLink
              key={child.to}
              to={child.to}
              onClick={(e) => {
                if (!confirmLeave()) e.preventDefault()
              }}
              className={({ isActive }) => `sidebar__child-link${isActive ? ' sidebar__child-link--active' : ''}`}
              title={child.label}
            >
              <span className="sidebar__child-bullet" aria-hidden="true" />
              <span className="sidebar__link-label">{child.label}</span>
            </NavLink>
          ))}
        </div>
      )}
    </div>
  )
}

// `collapsed` is the desktop icon rail. `isDrawer` / `open` / `onClose` are
// the phone overlay — a different thing, deliberately not folded into
// `collapsed` (see the comment at its call site in Layout.jsx).
export function Sidebar({ collapsed = false, isDrawer = false, open = false, onClose = () => {} }) {
  const { user, logout, navAssignments } = useAuth()
  const { pathname } = useLocation()
  const sections = getNavSections(user?.role, navAssignments).filter((section) => section.items.some((item) => item.show))

  // Sections the user has explicitly collapsed. This is plain component
  // state, not localStorage — Sidebar lives in Layout, which stays mounted
  // across client-side navigation (only the routed page inside it swaps),
  // so this already "remembers" expanded/collapsed state while navigating
  // without needing to persist anywhere. Every section starts expanded
  // (an empty set here), matching the sidebar's one-and-only look before
  // this feature existed.
  const [collapsedLabels, setCollapsedLabels] = useState(() => new Set())

  // While the drawer is open it behaves as a modal dialog, so it owns the
  // keyboard: focus stays inside and Escape closes it. On a desktop the
  // sidebar is just a panel and none of this applies.
  const asideRef = useRef(null)
  const isModal = isDrawer && open
  useFocusTrap(asideRef, isModal, onClose)

  // Log out asks first: the button sits directly under the profile link at
  // the bottom of the sidebar, where a slip ends the session and throws away
  // whatever the page had open. Unsaved changes are named in the same dialog
  // rather than in a second browser box.
  const [confirm, confirmDialog] = useConfirm()
  async function handleLogout() {
    const unsaved = hasUnsavedChanges()
    // Close the phone drawer first so the dialog is not opened from inside
    // another modal surface that is trapping focus.
    if (isDrawer && open) onClose()
    const ok = await confirm({
      title: 'Log out?',
      message: unsaved
        ? 'You have unsaved changes on this page. Logging out now will discard them.'
        : 'You will need your email and password to sign in again.',
      confirmLabel: unsaved ? 'Discard and log out' : 'Log out',
      danger: unsaved,
    })
    if (ok) logout()
  }

  function toggleSection(label) {
    setCollapsedLabels((prev) => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })
  }

  return (
    <>
    <aside
      ref={asideRef}
      id="app-sidebar"
      aria-label="Main navigation"
      // A dialog only while it actually behaves like one. Announcing a
      // permanently-docked sidebar as a modal dialog would be a lie on
      // every desktop screen.
      role={isModal ? 'dialog' : undefined}
      aria-modal={isModal || undefined}
      // A closed drawer is off-screen, not hidden: without `inert` its
      // links stay in the tab order and a keyboard user tabs into a panel
      // nobody can see.
      inert={isDrawer && !open}
      className={`sidebar${collapsed ? ' sidebar--collapsed' : ''}${
        isDrawer ? ' sidebar--drawer' : ''
      }${open ? ' sidebar--open' : ''}`}
    >
      <div className="sidebar__brand">
        <img src="/logo.png" alt="" className="sidebar__logo" />
        <div className="sidebar__brand-text">
          <strong>Progressive SHS</strong>
          <span>Student Portal</span>
        </div>
        {/* The drawer covers the left edge of the page — including the top
            bar's menu button that opened it — so without this the only ways
            out are Escape and a backdrop tap. Shown by CSS inside the phone
            breakpoint only. */}
        <button type="button" className="sidebar__close" onClick={onClose} aria-label="Close navigation">
          <X size={18} strokeWidth={1.75} />
        </button>
      </div>

      <nav className="sidebar__nav">
        {/* Home sits alone, above the grouped sections — it's the landing
            page every role lands on, not part of any one module. */}
        <NavLink
          to="/"
          end
          onClick={(e) => {
            if (!confirmLeave()) e.preventDefault()
          }}
          className={({ isActive }) => `sidebar__link${isActive ? ' sidebar__link--active' : ''}`}
          title="Home"
          style={{ marginBottom: 'var(--space-5)' }}
        >
          <Home size={18} strokeWidth={1.75} className="sidebar__link-icon" />
          <span className="sidebar__link-label">Home</span>
        </NavLink>

        {sections.map((section) => {
          // The active section is always rendered expanded regardless of
          // collapsedLabels — see isSectionActive's comment. Toggling it
          // still records the user's preference for when it's no longer
          // the active one.
          const isCollapsed = !isSectionActive(section, pathname) && collapsedLabels.has(section.label)
          // A collapsible group containing exactly one link is chrome with
          // nothing to do: the header can't tell you anything the single
          // item below it doesn't, and collapsing it hides one thing. A
          // general rule, applied to any role that ends up with a one-item
          // group.
          const visibleItems = section.items.filter((item) => item.show)
          // A section with no label never gets a header either — see the
          // student's own-record group, which needs no category above it.
          const showGroupHeader = visibleItems.length > 1 && Boolean(section.label)

          return (
            <div className="sidebar__section" key={section.key || section.label}>
              {showGroupHeader && (
                <button
                  type="button"
                  className="sidebar__section-toggle"
                  onClick={() => toggleSection(section.label)}
                  aria-expanded={!isCollapsed}
                >
                  <span className="sidebar__section-label">{section.label}</span>
                  <ChevronDown
                    size={14}
                    strokeWidth={2}
                    className={`sidebar__section-chevron${isCollapsed ? ' sidebar__section-chevron--collapsed' : ''}`}
                  />
                </button>
              )}
              <div className={`sidebar__section-items${isCollapsed && showGroupHeader ? ' sidebar__section-items--collapsed' : ''}`}>
                <div>
                  {section.items
                    .filter((item) => item.show)
                    .map((item) =>
                      item.children ? (
                        <NavItemWithChildren key={item.to} item={item} pathname={pathname} />
                      ) : (
                        <NavLink
                          key={item.to}
                          to={item.to}
                          end={['/students', '/users'].includes(item.to)}
                          onClick={(e) => {
                            if (!confirmLeave()) e.preventDefault()
                          }}
                          className={({ isActive }) => `sidebar__link${isActive ? ' sidebar__link--active' : ''}`}
                          title={item.label}
                        >
                          <item.icon size={18} strokeWidth={1.75} className="sidebar__link-icon" />
                          <span className="sidebar__link-label">{item.label}</span>
                        </NavLink>
                      )
                    )}
                </div>
              </div>
            </div>
          )
        })}
      </nav>

      <div className="sidebar__footer">
        {/* The identity block IS the profile link — the thing showing who you
            are is the thing that opens your own page. No role gate: everyone
            owns their profile, and /profile already adapts itself (a student
            has no assignments panel).

            It carries its own icon rather than only the name and role,
            because the collapsed rail hides the text: without an icon this
            would vanish from the sidebar entirely at that width, and the
            account menu in the top bar would become the only route to it. */}
        <NavLink
          to="/profile"
          onClick={(e) => {
            if (!confirmLeave()) e.preventDefault()
          }}
          className={({ isActive }) => `sidebar__user${isActive ? ' sidebar__user--active' : ''}`}
          title={`${user?.fullName} (${roleLabel(user?.role)}) — your profile`}
        >
          <CircleUser size={18} strokeWidth={1.75} className="sidebar__user-icon" />
          <span className="sidebar__user-text">
            <span className="sidebar__user-name">{user?.fullName}</span>
            <span className="sidebar__user-role">{roleLabel(user?.role)}</span>
          </span>
        </NavLink>
        <button
          type="button"
          onClick={handleLogout}
          className="sidebar__logout"
          title="Log out"
        >
          <LogOut size={18} strokeWidth={1.75} />
          <span className="sidebar__link-label">Log out</span>
        </button>
      </div>
    </aside>
    {/* Outside the <aside> on purpose: a closed drawer is `inert`, and an
        inert ancestor would make the dialog unclickable. */}
    {confirmDialog}
    </>
  )
}
