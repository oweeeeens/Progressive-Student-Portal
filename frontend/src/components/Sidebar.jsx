import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import {
  Home,
  Users,
  UserPlus,
  FileUp,
  CalendarCheck,
  GraduationCap,
  ClipboardList,
  PenLine,
  ShieldCheck,
  CheckCircle2,
  TrendingUp,
  BarChart3,
  HeartHandshake,
  UserCog,
  CalendarRange,
  Layers,
  BookOpen,
  BookMarked,
  ChevronDown,
  LogOut,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { confirmLeave } from '../utils/unsavedChangesGuard'
import './Sidebar.css'

const canWrite = (role) => role === 'admin' || role === 'registrar'
// These four are gated by actual assignment on the backend (sections.
// adviser_id / class_offerings.teacher_id), not by role — a person labeled
// 'adviser' can also be assigned to teach a class, and vice versa, since
// those columns don't require the role column to match. The sidebar can't
// know someone's actual assignments without fetching them (not worth a
// network round-trip just to decide nav visibility), so it shows the link
// to anyone who could plausibly hold one — every staff role — and lets the
// page itself be an empty picker if they turn out to have no assignment
// there. Only 'student' is excluded: nothing in this system assigns a
// student account as a section's adviser or a class's teacher.
const isStaffRole = (role) => role && role !== 'student'
const canMarkDaily = isStaffRole
const canMarkSubject = isStaffRole
const canEnterGrades = isStaffRole
const canFinalizeGrades = isStaffRole
// Verify Grades stays role-based on purpose: there's no "principal
// assignment" table, it's a single school-wide position, so a literal role
// check is the correct and only boundary (unlike the four above).
const canVerifyGrades = (role) => ['admin', 'principal'].includes(role)
const canSeeAcademicProgress = (role) => ['admin', 'adviser', 'guidance_counselor'].includes(role)
// Deliberately NOT advisers — they keep the per-section Academic Progress
// Tracking view above; this is the school-wide rollup, admin/principal/
// guidance_counselor only, matching routes/analyticsRoutes.js's server-side gate.
const canSeeAnalytics = (role) => ['admin', 'principal', 'guidance_counselor'].includes(role)
const canManageAcademicSetup = (role) => role === 'admin'

// Each section groups related pages under a short, sentence-case label (not
// all-caps — see design guidelines). A section with no visible items for the
// current role simply renders nothing. Plain function, not a hook — it just
// maps a role to a list, no React state involved.
function getNavSections(role) {
  return [
    {
      // Unlabelled on purpose: a student's two pages are their own record,
      // not a category of the school's data, and a header above two items
      // called "My Grades" and "My Attendance" would only repeat them.
      key: 'own-record',
      label: null,
      items: [
        { to: '/my-grades', label: 'My Grades', icon: GraduationCap, show: role === 'student' },
        { to: '/my-attendance', label: 'My Attendance', icon: CalendarCheck, show: role === 'student' },
      ],
    },
    {
      label: 'Students',
      items: [
        // A student only ever sees their own single record in this list
        // anyway (studentModel's appendScopeClause self-scopes it) — an
        // extra list + click for something the Home page already gives them
        // directly, so it's hidden for that role rather than just scoped.
        // A student's nav is Home and nothing else: their whole record,
        // advice, charts and tables scroll on that one page (see
        // pages/StudentHomePage.jsx), so this section renders nothing at
        // all for them.
        { to: '/students', label: 'Students', icon: Users, show: role !== 'student' },
        { to: '/students/new', label: 'New Student', icon: UserPlus, show: canWrite(role) },
        { to: '/students/bulk-import', label: 'Bulk Import', icon: FileUp, show: canWrite(role) },
      ],
    },
    {
      label: 'Attendance',
      items: [
        { to: '/attendance/daily', label: 'Daily Attendance', icon: CalendarCheck, show: canMarkDaily(role) },
        { to: '/attendance/subject', label: 'Subject Attendance', icon: ClipboardList, show: canMarkSubject(role) },
      ],
    },
    {
      label: 'Grades',
      items: [
        { to: '/grades/entry', label: 'Enter Grades', icon: PenLine, show: canEnterGrades(role) },
        { to: '/grades/verify', label: 'Verify Grades', icon: ShieldCheck, show: canVerifyGrades(role) },
        { to: '/grades/finalize', label: 'Finalize Grades', icon: CheckCircle2, show: canFinalizeGrades(role) },
      ],
    },
    {
      label: 'Progress & Interventions',
      items: [
        // "Progress Tracking", not the module's full name: the group header
        // directly above already carries the rest of it, and at the full
        // name this item truncated to "Academic Progres..." — a nav item
        // that cannot say what it is. The page title still shows the full
        // name the client and the manuscript use.
        { to: '/academic-progress', label: 'Progress Tracking', icon: TrendingUp, show: canSeeAcademicProgress(role) },
        { to: '/interventions', label: 'Interventions', icon: HeartHandshake, show: canSeeAcademicProgress(role) },
        { to: '/analytics', label: 'Analytics', icon: BarChart3, show: canSeeAnalytics(role) },
      ],
    },
    {
      label: 'Accounts',
      items: [
        { to: '/users', label: 'User Management', icon: UserCog, show: canWrite(role) },
        { to: '/users/new', label: 'New Account', icon: UserPlus, show: canWrite(role) },
      ],
    },
    {
      label: 'Academic Setup',
      items: [
        { to: '/academic-setup/school-years', label: 'School Years', icon: CalendarRange, show: canManageAcademicSetup(role) },
        { to: '/academic-setup/sections', label: 'Sections', icon: Layers, show: canManageAcademicSetup(role) },
        { to: '/academic-setup/subjects', label: 'Subjects', icon: BookOpen, show: canManageAcademicSetup(role) },
        { to: '/academic-setup/class-offerings', label: 'Class Offerings', icon: BookMarked, show: canManageAcademicSetup(role) },
      ],
    },
  ]
}

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

export function Sidebar({ collapsed = false }) {
  const { user, logout } = useAuth()
  const { pathname } = useLocation()
  const sections = getNavSections(user?.role).filter((section) => section.items.some((item) => item.show))

  // Sections the user has explicitly collapsed. This is plain component
  // state, not localStorage — Sidebar lives in Layout, which stays mounted
  // across client-side navigation (only the routed page inside it swaps),
  // so this already "remembers" expanded/collapsed state while navigating
  // without needing to persist anywhere. Every section starts expanded
  // (an empty set here), matching the sidebar's one-and-only look before
  // this feature existed.
  const [collapsedLabels, setCollapsedLabels] = useState(() => new Set())

  function toggleSection(label) {
    setCollapsedLabels((prev) => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })
  }

  return (
    <aside className={`sidebar${collapsed ? ' sidebar--collapsed' : ''}`}>
      <div className="sidebar__brand">
        <img src="/logo.png" alt="" className="sidebar__logo" />
        <div className="sidebar__brand-text">
          <strong>Progressive SHS</strong>
          <span>Student Portal</span>
        </div>
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
        <div className="sidebar__user" title={`${user?.fullName} (${user?.role})`}>
          <div className="sidebar__user-name">{user?.fullName}</div>
          <div className="sidebar__user-role">{user?.role?.replace(/_/g, ' ')}</div>
        </div>
        <button
          type="button"
          onClick={() => {
            if (confirmLeave()) logout()
          }}
          className="sidebar__logout"
          title="Log out"
        >
          <LogOut size={18} strokeWidth={1.75} />
          <span className="sidebar__link-label">Log out</span>
        </button>
      </div>
    </aside>
  )
}
