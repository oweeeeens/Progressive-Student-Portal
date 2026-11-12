import { Link } from 'react-router-dom'
import { ClipboardList, Users, CalendarCheck, ArrowRight } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { canImportStudents, canImportAttendance, canImportClassRecord } from '../utils/permissions'

// Import Data — every spreadsheet the school already keeps, brought into the
// System from one place.
//
// The school does not start from a blank System: its records already live in
// spreadsheets. Three kinds, three imports, in the order the study's flow
// uses them:
//   1. the DepEd e-Class Record — each subject's quizzes, tasks and exams,
//      from which the System computes the grades (DepEd DO 015);
//   2. the student information spreadsheet — the learners themselves;
//   3. the SF2 attendance sheets — the daily register, which feeds the risk
//      score's attendance rate and the absence alert. Kept separate on
//      purpose: DepEd's e-Class Record holds no attendance at all.
// Each card appears only for someone allowed to use that import
// (utils/permissions.js); the server checks again on every request.

const IMPORTS = [
  {
    key: 'class-record',
    to: '/grades/entry/import',
    icon: ClipboardList,
    title: 'e-Class Record (class scores)',
    file: "The subject's DepEd e-Class Record workbook (.xlsx) — the one with the INPUT DATA and Term 1–3 sheets.",
    fills:
      'Every written work, performance task, summative test and term exam score, for every learner. The System computes each term grade from them, and you check them against the workbook before anything is saved.',
    who: 'The teacher of the class',
    allowed: canImportClassRecord,
  },
  {
    key: 'students',
    to: '/students/bulk-import',
    icon: Users,
    title: 'Student records',
    file: "The school's student information spreadsheet (.xlsx).",
    fills: "Each learner's record — LRN, name, birthdate, section, guardian — matched column by column, with a review before anything is saved.",
    who: 'Admin and registrar',
    allowed: (role) => canImportStudents(role),
  },
  {
    key: 'attendance',
    to: '/attendance/bulk-import',
    icon: CalendarCheck,
    title: 'Attendance (SF2)',
    file: "The section's DepEd School Form 2 attendance sheet (.xlsx).",
    fills: "The daily register: present, absent, late or excused per learner per day. It feeds the attendance rate in the risk score and the 12-absence alert.",
    who: 'The section adviser, admin and registrar',
    allowed: canImportAttendance,
  },
]

export function ImportHubPage() {
  const { user, assignments } = useAuth()
  const available = IMPORTS.filter((imp) => imp.allowed(user?.role, assignments))

  return (
    <div>
      <Breadcrumbs items={[{ label: 'Home', to: '/' }, { label: 'Import Data' }]} />
      <div className="page-header">
        <h1>Import Data</h1>
      </div>
      <p className="help-text mb-3">
        Bring in the spreadsheets the school already keeps instead of re-typing them. Each import shows a review first —
        nothing is saved until you confirm.
      </p>

      {available.length === 0 ? (
        <div className="empty-state">
          <p>There is nothing for you to import.</p>
          <p>Imports are for the teacher of a class, the section adviser, and the registrar.</p>
        </div>
      ) : (
        <div className="import-hub">
          {available.map((imp) => {
            const Icon = imp.icon
            return (
              <section key={imp.key} className="panel import-hub__card">
                <div className="import-hub__head">
                  <span className="import-hub__icon" aria-hidden="true">
                    <Icon size={22} strokeWidth={1.75} />
                  </span>
                  <h2>{imp.title}</h2>
                </div>
                <dl className="import-hub__facts">
                  <dt>File</dt>
                  <dd>{imp.file}</dd>
                  <dt>Fills in</dt>
                  <dd>{imp.fills}</dd>
                  <dt>Who</dt>
                  <dd>{imp.who}</dd>
                </dl>
                <Link to={imp.to} className="btn-primary import-hub__go">
                  Start import <ArrowRight size={16} strokeWidth={1.75} />
                </Link>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
