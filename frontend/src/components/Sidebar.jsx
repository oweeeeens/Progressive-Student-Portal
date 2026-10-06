import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import {
  Home,
  Users,
  UserPlus,
  CalendarCheck,
  ClipboardList,
  PenLine,
  ShieldCheck,
  CheckCircle2,
  FileCheck2,
  AlertTriangle,
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
const canReviewEnrollment = (role) => role === 'admin' || role === 'registrar'
const canEnterGrades = isStaffRole
const canFinalizeGrades = isStaffRole
// Verify Grades stays role-based on purpose: there's no "principal
// assignment" table, it's a single school-wide position, so a literal role
// check is the correct and only boundary (unlike the four above).
const canVerifyGrades = (role) => ['admin', 'principal'].includes(role)
const canSeeRiskDashboard = (role) => ['admin', 'adviser', 'guidance_counselor'].includes(role)
const canManageAcademicSetup = (role) => role === 'admin'

// Each section groups related pages under a short, sentence-case label (not
// all-caps — see design guidelines). A section with no visible items for the
// current role simply renders nothing. Plain function, not a hook — it just
// maps a role to a list, no React state involved.
function getNavSections(role) {
  return [
    {
      label: 'Students',
      items: [
        { to: '/students', label: 'Students', icon: Users, show: true },
        { to: '/students/new', label: 'New Student', icon: UserPlus, show: canWrite(role) },
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
      label: 'Enrollment',
      items: [{ to: '/enrollment', label: 'Enrollment Review', icon: FileCheck2, show: canReviewEnrollment(role) }],
    },
    {
      label: 'Risk & Interventions',
      items: [
        { to: '/risk-dashboard', label: 'Risk Dashboard', icon: AlertTriangle, show: canSeeRiskDashboard(role) },
        { to: '/interventions', label: 'Interventions', icon: HeartHandshake, show: canSeeRiskDashboard(role) },
      ],
    },
    {
      label: 'Accounts',
      items: [
        { to: '/staff', label: 'Staff Accounts', icon: UserCog, show: canWrite(role) },
        { to: '/staff/new', label: 'New Staff Account', icon: UserPlus, show: canWrite(role) },
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

export function Sidebar() {
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
    <aside className="sidebar">
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

          return (
            <div className="sidebar__section" key={section.label}>
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
              <div className={`sidebar__section-items${isCollapsed ? ' sidebar__section-items--collapsed' : ''}`}>
                <div>
                  {section.items
                    .filter((item) => item.show)
                    .map((item) => (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        end={['/students', '/staff'].includes(item.to)}
                        onClick={(e) => {
                          if (!confirmLeave()) e.preventDefault()
                        }}
                        className={({ isActive }) => `sidebar__link${isActive ? ' sidebar__link--active' : ''}`}
                        title={item.label}
                      >
                        <item.icon size={18} strokeWidth={1.75} className="sidebar__link-icon" />
                        <span className="sidebar__link-label">{item.label}</span>
                      </NavLink>
                    ))}
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
