// The navigation, as data: every page link, the group it sits in, and the
// rule that decides whether this person sees it. Kept out of Sidebar.jsx so
// the Help page (pages/HelpPage.jsx) lists exactly the pages the sidebar
// shows — one definition, so the two can never disagree.
import {
  Users,
  UserPlus,
  FileUp,
  CalendarCheck,
  GraduationCap,
  IdCard,
  FileText,
  Sheet,
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
  Contact,
} from 'lucide-react'
import { canViewAcademicSetup, canImportAnything, showsAdvisingWork, showsTeachingWork, seesAllGradeReports, canOpenGradesheet } from './permissions'

const canWrite = (role) => role === 'admin' || role === 'registrar'

// The four links below are gated on the backend by actual assignment
// (sections.adviser_id / class_offerings.teacher_id), not by role — so role
// alone cannot answer whether a page has anything to show.
//
// The sidebar used to show them to every staff role and let the page be an
// empty picker if the person held nothing. That meant a principal and a
// guidance counselor — school-wide positions that by definition advise no
// section and teach no class — each got dead ends. It also hit real advisers
// and teachers: an adviser who teaches nothing still saw Enter Grades.
//
// So there are two filters, applied in order:
//
//   1. the role list — what the server would let through at all, including
//      the blanket grants: admin everywhere, registrar on the daily register
//      (an administrative record they may correct);
//   2. the assignment count — whether this particular person holds anything
//      for that page to show (AuthContext counts /sections/mine and
//      /class-offerings/mine once per session).
//
// `has` is AuthContext's `navAssignments`: zero counts while the requests
// are on their way (so links only ever appear, never vanish, as the page
// loads), and null if they FAILED. Null means only the role filter applies:
// the menu is as cluttered as it used to be, rather than hiding a teacher's
// own grade sheet because a request timed out. Failing open here is safe —
// the server is the actual boundary, this is only a menu.
const advises = (has) => has === null || has.sections > 0

// A role's own half always shows, even before the account is linked to a
// section or class: an adviser's advising pages, a subject teacher's
// teaching pages. Each of those pages then says "nothing assigned yet"
// rather than the link silently vanishing (utils/permissions.js,
// showsAdvisingWork / showsTeachingWork, explains why).
// The daily register is the homeroom's: the section's adviser, or the admin.
// The registrar lost it on 2026-11-26 (they advise no section; the server
// refuses their writes too) but still reads attendance on a student record.
const canMarkDaily = (role, has) => role === 'admin' || showsAdvisingWork(role, has)
const canEnterGrades = (role, has) => role === 'admin' || showsTeachingWork(role, has)
const canFinalizeGrades = (role, has) => role === 'admin' || showsAdvisingWork(role, has)
// Verify Grades stays role-based on purpose: there's no "principal
// assignment" table, it's a single school-wide position, so a literal role
// check is the correct and only boundary (unlike the four above).
const canVerifyGrades = (role) => ['admin', 'principal'].includes(role)
const canSeeAcademicProgress = (role) => ['admin', 'principal', 'adviser', 'guidance_counselor'].includes(role)
// Interventions belong to the learner's ADVISER only (2026-11-12, "no third
// parties" — see backend/controllers/interventionController.js). That is an
// assignment, not a role, so the link is earned by advising a section,
// exactly like Finalize Grades — plus the admin (full access, restored
// 2026-11-13). No principal or guidance counselor link.
const canSeeInterventions = (role, has) =>
  role === 'admin' || showsAdvisingWork(role, has) || (role !== 'student' && advises(has))
// Deliberately NOT advisers — they keep the per-section Academic Progress
// Tracking view above; this is the school-wide rollup, admin/principal/
// guidance_counselor only, matching routes/analyticsRoutes.js's server-side gate.
// Advisers too since 2026-11-12, scoped to their own sections on the server
// (middleware/analyticsScope.js) — the person who acts on "who is at risk of
// failing" is the learner's adviser. Earned by advising, like Finalize Grades.
const canSeeAnalytics = (role, has) => ['admin', 'principal', 'guidance_counselor'].includes(role) || (role !== 'student' && has !== null && has.sections > 0)
// Imported rather than written here, so this cannot drift from what the
// routes allow — a sidebar predicate widened on its own once handed the
// principal a link the server answered 403. The principal reads
// Academic Setup; the pages hide their write controls for them.
const canSeeAcademicSetup = canViewAcademicSetup

// Each section groups related pages under a short, sentence-case label (not
// all-caps — see design guidelines). A section with no visible items for the
// current role simply renders nothing. Plain function, not a hook — it just
// maps a role to a list, no React state involved.
export function getNavSections(role, has) {
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
        { to: '/my-record', label: 'My Record', icon: IdCard, show: role === 'student' },
        { to: '/my-registration', label: 'Registration Form', icon: FileText, show: role === 'student' },
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
        // ONE link for every spreadsheet import — the e-Class Record (scores),
        // student records, and SF2 attendance — on the Import Data page
        // (pages/ImportHubPage.jsx). There used to be two identical "Bulk
        // Import" links, and the most important import (the class record)
        // was only a button on the Class Record page, where nobody found it.
        { to: '/import', label: 'Import Data', icon: FileUp, show: canImportAnything(role, has) },
      ],
    },
    {
      label: 'Attendance',
      items: [
        { to: '/attendance/daily', label: 'Daily Attendance', icon: CalendarCheck, show: canMarkDaily(role, has) },
      ],
    },
    {
      label: 'Grades',
      items: [
        { to: '/grades/entry', label: 'Class Record', icon: PenLine, show: canEnterGrades(role, has) },
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
        { to: '/interventions', label: 'Interventions', icon: HeartHandshake, show: canSeeInterventions(role, has) },
        { to: '/analytics', label: 'Analytics', icon: BarChart3, show: canSeeAnalytics(role, has) },
      ],
    },
    // The school's people, for everyone — students included, so a learner
    // knows who their adviser and teachers are (2026-11-26). A learner never
    // receives staff emails (staffDirectoryController).
    {
      label: 'School',
      items: [{ to: '/staff', label: 'Staff Directory', icon: Contact, show: Boolean(role) }],
    },
    // The panel's reports (2026-11-18). Each link follows the same rule as
    // the server: the gradesheet is for whoever advises or teaches in a
    // section, plus the principal, guidance, registrar and admin for every
    // section (canOpenGradesheet); the class report for whoever teaches a
    // class, plus the admin and registrar; the enrolled list for the
    // registrar and admin.
    {
      label: 'Reports',
      items: [
        // Since 2026-11-26 also the principal, guidance and subject teachers
        // (the sections they teach into) — permissions.canOpenGradesheet.
        { to: '/reports/gradesheet', label: 'Gradesheet', icon: Sheet, show: canOpenGradesheet(role, has) },
        { to: '/reports/class-grades', label: 'Class Grades', icon: ClipboardList, show: seesAllGradeReports(role) || showsTeachingWork(role, has) },
        { to: '/reports/enrolled-students', label: 'Enrolled Students', icon: Users, show: ['admin', 'registrar'].includes(role) },
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
        { to: '/academic-setup/school-years', label: 'School Years', icon: CalendarRange, show: canSeeAcademicSetup(role) },
        { to: '/academic-setup/sections', label: 'Sections', icon: Layers, show: canSeeAcademicSetup(role) },
        { to: '/academic-setup/subjects', label: 'Subjects', icon: BookOpen, show: canSeeAcademicSetup(role) },
        { to: '/academic-setup/class-offerings', label: 'Class Offerings', icon: BookMarked, show: canSeeAcademicSetup(role) },
      ],
    },
  ]
}
