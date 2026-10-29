import { useRef, useState } from 'react'
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
  X,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { confirmLeave } from '../utils/unsavedChangesGuard'
import { roleLabel } from '../utils/roleLabel'
import { useFocusTrap } from '../hooks/useFocusTrap'
import './Sidebar.css'

const canWrite = (role) => role === 'admin' || role === 'registrar'

// The five links below are gated on the backend by actual assignment
// (sections.adviser_id / class_offerings.teacher_id), not by role — so role
// alone cannot answer whether a page has anything to show.
//
// The sidebar used to show all five to every staff role and let the page be
// an empty picker if the person held nothing. That meant a principal, a
// guidance counselor and an ICT faculty member — three school-wide positions
// that by definition advise no section and teach no class — each got five
// dead ends out of nine links. It also hit real advisers and teachers: an
// adviser who teaches nothing still saw Enter Grades.
//
// So there are two filters, applied in order:
//
//   1. the role list — what the server would let through at all, including
//      the blanket grants: admin everywhere, registrar on the daily register
//      (an administrative record they may correct) but NOT on subject
//      attendance, which belongs to the teacher who teaches the class;
//   2. the assignment count — whether this particular person holds anything
//      for that page to show (AuthContext counts /sections/mine and
//      /class-offerings/mine once per session).
//
// `has` is null until those counts arrive, and also if the requests failed.
// Then only the role filter applies, which is exactly the old behaviour: the
// menu is briefly as cluttered as it used to be, rather than hiding a
// teacher's own grade sheet from them because a request timed out. Failing
// open here is safe — the server is the actual boundary, this is only a menu.
const advises = (has) => has === null || has.sections > 0
const teaches = (has) => has === null || has.offerings > 0

const canMarkDaily = (role, has) =>
  ['admin', 'registrar'].includes(role) || (['adviser', 'subject_teacher'].includes(role) && advises(has))
const canImportAttendance = (role, has) =>
  ['admin', 'registrar'].includes(role) ||
  (['adviser', 'subject_teacher'].includes(role) && (advises(has) || teaches(has)))
const canMarkSubject = (role, has) =>
  role === 'admin' || (['adviser', 'subject_teacher'].includes(role) && teaches(has))
const canEnterGrades = (role, has) =>
  role === 'admin' || (['adviser', 'subject_teacher'].includes(role) && teaches(has))
const canFinalizeGrades = (role, has) =>
  role === 'admin' || (['adviser', 'subject_teacher'].includes(role) && advises(has))
// Verify Grades stays role-based on purpose: there's no "principal
// assignment" table, it's a single school-wide position, so a literal role
// check is the correct and only boundary (unlike the four above).
const canVerifyGrades = (role) => ['admin', 'principal'].includes(role)
const canSeeAcademicProgress = (role) => ['admin', 'principal', 'adviser', 'guidance_counselor'].includes(role)
// NOT the same list. The principal reads the progress dashboard but does not
// log interventions — that is the adviser's and the guidance counselor's
// work (CLAUDE.md), and interventionRoutes.js enforces it. These two links
// shared one predicate until the principal was added to the first, which
// silently handed them an Interventions link that the server answers 403.
const canSeeInterventions = (role) => ['admin', 'adviser', 'guidance_counselor'].includes(role)
// Deliberately NOT advisers — they keep the per-section Academic Progress
// Tracking view above; this is the school-wide rollup, admin/principal/
// guidance_counselor only, matching routes/analyticsRoutes.js's server-side gate.
const canSeeAnalytics = (role) => ['admin', 'principal', 'guidance_counselor'].includes(role)
const canManageAcademicSetup = (role) => role === 'admin'

// Each section groups related pages under a short, sentence-case label (not
// all-caps — see design guidelines). A section with no visible items for the
// current role simply renders nothing. Plain function, not a hook — it just
// maps a role to a list, no React state involved.
function getNavSections(role, has) {
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
        // Not ict_faculty either, for the same reason as the five
        // assignment-gated links below: studentModel.appendScopeClause has
        // no case for them, so it falls to its fail-closed default and the
        // roster is empty by construction, not by circumstance. Their job
        // is the noticeboard (CLAUDE.md), which lives on Home — so Home is
        // the whole of their nav, and nothing in it is a dead end.
        { to: '/students', label: 'Students', icon: Users, show: !['student', 'ict_faculty'].includes(role) },
        { to: '/students/new', label: 'New Student', icon: UserPlus, show: canWrite(role) },
        { to: '/students/bulk-import', label: 'Bulk Import', icon: FileUp, show: canWrite(role) },
      ],
    },
    {
      label: 'Attendance',
      items: [
        { to: '/attendance/daily', label: 'Daily Attendance', icon: CalendarCheck, show: canMarkDaily(role, has) },
        { to: '/attendance/subject', label: 'Subject Attendance', icon: ClipboardList, show: canMarkSubject(role, has) },
        // Same roles as the daily register above: the importer writes both
        // registers, and registrar may write the daily one.
        { to: '/attendance/bulk-import', label: 'Bulk Import', icon: FileUp, show: canImportAttendance(role, has) },
      ],
    },
    {
      label: 'Grades',
      items: [
        { to: '/grades/entry', label: 'Enter Grades', icon: PenLine, show: canEnterGrades(role, has) },
        { to: '/grades/verify', label: 'Verify Grades', icon: ShieldCheck, show: canVerifyGrades(role) },
        { to: '/grades/finalize', label: 'Finalize Grades', icon: CheckCircle2, show: canFinalizeGrades(role, has) },
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
        { to: '/interventions', label: 'Interventions', icon: HeartHandshake, show: canSeeInterventions(role) },
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

// `collapsed` is the desktop icon rail. `isDrawer` / `open` / `onClose` are
// the phone overlay — a different thing, deliberately not folded into
// `collapsed` (see the comment at its call site in Layout.jsx).
export function Sidebar({ collapsed = false, isDrawer = false, open = false, onClose = () => {} }) {
  const { user, logout, assignments } = useAuth()
  const { pathname } = useLocation()
  const sections = getNavSections(user?.role, assignments).filter((section) => section.items.some((item) => item.show))

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

  function toggleSection(label) {
    setCollapsedLabels((prev) => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })
  }

  return (
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
        <div className="sidebar__user" title={`${user?.fullName} (${user?.role})`}>
          <div className="sidebar__user-name">{user?.fullName}</div>
          <div className="sidebar__user-role">{roleLabel(user?.role)}</div>
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
