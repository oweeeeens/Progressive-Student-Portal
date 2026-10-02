import { NavLink } from 'react-router-dom'
import {
  Home,
  Users,
  UserPlus,
  CalendarCheck,
  ClipboardList,
  PenLine,
  CheckCircle2,
  FileCheck2,
  AlertTriangle,
  HeartHandshake,
  UserCog,
  LogOut,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import './Sidebar.css'

const canWrite = (role) => role === 'admin' || role === 'registrar'
const canMarkDaily = (role) => ['admin', 'registrar', 'adviser'].includes(role)
const canMarkSubject = (role) => ['admin', 'subject_teacher'].includes(role)
const canReviewEnrollment = (role) => role === 'admin' || role === 'registrar'
const canEnterGrades = (role) => ['admin', 'subject_teacher'].includes(role)
const canFinalizeGrades = (role) => ['admin', 'adviser'].includes(role)
const canSeeRiskDashboard = (role) => ['admin', 'adviser', 'guidance_counselor'].includes(role)

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
  ]
}

export function Sidebar() {
  const { user, logout } = useAuth()
  const sections = getNavSections(user?.role).filter((section) => section.items.some((item) => item.show))

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
          className={({ isActive }) => `sidebar__link${isActive ? ' sidebar__link--active' : ''}`}
          title="Home"
          style={{ marginBottom: 'var(--space-5)' }}
        >
          <Home size={18} strokeWidth={1.75} className="sidebar__link-icon" />
          <span className="sidebar__link-label">Home</span>
        </NavLink>

        {sections.map((section) => (
          <div className="sidebar__section" key={section.label}>
            <div className="sidebar__section-label">{section.label}</div>
            {section.items
              .filter((item) => item.show)
              .map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={['/students', '/staff'].includes(item.to)}
                  className={({ isActive }) => `sidebar__link${isActive ? ' sidebar__link--active' : ''}`}
                  title={item.label}
                >
                  <item.icon size={18} strokeWidth={1.75} className="sidebar__link-icon" />
                  <span className="sidebar__link-label">{item.label}</span>
                </NavLink>
              ))}
          </div>
        ))}
      </nav>

      <div className="sidebar__footer">
        <div className="sidebar__user" title={`${user?.fullName} (${user?.role})`}>
          <div className="sidebar__user-name">{user?.fullName}</div>
          <div className="sidebar__user-role">{user?.role?.replace(/_/g, ' ')}</div>
        </div>
        <button type="button" onClick={logout} className="sidebar__logout" title="Log out">
          <LogOut size={18} strokeWidth={1.75} />
          <span className="sidebar__link-label">Log out</span>
        </button>
      </div>
    </aside>
  )
}
