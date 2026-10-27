import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  KeyRound,
  Pencil,
  UserCheck,
  UserX,
  UserPlus,
  ChevronDown,
  ChevronUp,
  User,
  GraduationCap,
  CalendarCheck,
  HeartHandshake,
  FileDown,
} from 'lucide-react'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { StatusPill } from '../components/StatusPill'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { Tabs } from '../components/Tabs'
import { AttendanceHistory } from '../components/AttendanceHistory'
import { GradeHistory } from '../components/GradeHistory'
import { InterventionHistory } from '../components/InterventionHistory'
import { DataTable, fieldValue } from '../components/table/DataTable'
import { Alert } from '../components/Alert'
import { humanize } from '../utils/humanize'

const canWrite = (role) => role === 'admin' || role === 'registrar'
// Academic standing is more sensitive than a roster entry, so both of
// these are narrower than "can view this student's profile at all".
//
// They used to be the same predicate. They aren't any more: the principal
// can READ a student's standing (they already see the school-wide version
// on Analytics) but has no part in the intervention workflow — logging and
// status changes stay with admin/adviser/guidance_counselor, matching
// routes/interventionRoutes.js. Aliasing them would have surfaced an
// Interventions tab that 403s on open.
const canSeeAcademicProgress = (role) => ['admin', 'principal', 'adviser', 'guidance_counselor'].includes(role)
const canSeeInterventions = (role) => ['admin', 'adviser', 'guidance_counselor'].includes(role)
// The backend is the real gate here (admin, registrar, or whoever actually
// advises this student's section — by assignment, not role label; see
// reportCardController.js). Shown to any non-student role rather than just
// 'adviser'/'registrar' literally, so a person who holds the adviser
// assignment under a different role label still sees the button instead of
// it silently not appearing for them — the backend 403s if they turn out
// not to actually be this section's adviser.
//
// Principal is the one explicit exclusion: it's a single school-wide
// position that is never a section's adviser, so unlike the ambiguous roles
// above the button would 403 for them every single time. A control that can
// only ever fail is worse than no control.
const canSeeReportCard = (role) => Boolean(role) && role !== 'student' && role !== 'principal'

const STATUS_VARIANTS = { enrolled: 'positive', pending: 'warning', dropped: 'negative', transferred: 'neutral', graduated: 'info' }
const RISK_VARIANTS = { low: 'risk-low', medium: 'risk-medium', high: 'risk-high' }
const RISK_LABELS = { low: 'Low Risk', medium: 'Medium Risk', high: 'High Risk' }

function formatDateOnly(isoDateString) {
  const [year, month, day] = isoDateString.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString(undefined, { dateStyle: 'medium' })
}

function formatTimestamp(value) {
  if (!value) return null
  return new Date(value).toLocaleDateString(undefined, { dateStyle: 'medium' })
}

const SEX_LABELS = { M: 'Male', F: 'Female', male: 'Male', female: 'Female' }

// Age is derived, not stored — shown next to the date of birth because
// that's the form the school actually reads it in.
function ageFrom(dateOfBirth) {
  if (!dateOfBirth) return null
  const [year, month, day] = dateOfBirth.split('-').map(Number)
  const today = new Date()
  let age = today.getFullYear() - year
  const hadBirthday = today.getMonth() + 1 > month || (today.getMonth() + 1 === month && today.getDate() >= day)
  if (!hadBirthday) age -= 1
  return age >= 0 && age < 130 ? age : null
}

// The Overview tab's three field groups. Previously this was one flat list
// of seven personal fields, which left the tab looking empty and, worse,
// never showed the things a student most wants confirmed about themselves —
// their section, adviser and enrollment status were only ever implied by a
// pill in the page header. Every column studentModel.findById returns is now
// surfaced in one of these groups.
// label -> API key. Which of these actually arrive depends on the viewer's
// role (backend/config/learnerStatus.js); the group below renders only the
// ones present in the payload.
const LEARNER_STATUS_DISPLAY = [
  ['Person with disability (PWD)', 'is_pwd'],
  ['4Ps recipient', 'is_4ps'],
  ['ALS graduate (Alternative Learning System)', 'is_als_graduate'],
]

function buildFieldGroups(student) {
  const dob = student.date_of_birth
  const age = ageFrom(dob)

  return [
    {
      title: 'Personal Information',
      fields: [
        ['LRN', student.lrn],
        ['Full name', [student.last_name, student.first_name, student.middle_name].filter(Boolean).join(', ')],
        ['Sex', SEX_LABELS[student.sex] || student.sex],
        ['Date of birth', dob ? `${formatDateOnly(dob)}${age != null ? ` (age ${age})` : ''}` : null],
        ['Address', student.address],
        ['Personal email', student.email],
      ],
    },
    {
      title: 'Enrollment',
      fields: [
        ['Enrollment status', humanize(student.enrollment_status)],
        ['Record status', student.is_active ? 'Active' : 'Inactive'],
        ['Grade level', student.grade_level != null ? `Grade ${student.grade_level}` : null],
        ['Section', student.section_name],
        ['Strand', student.strand],
        ['Adviser', student.adviser_name],
        ['Portal account', student.user_id ? 'Active' : 'Not yet created'],
        ['Record added', formatTimestamp(student.created_at)],
      ],
    },
    // Only rendered at all when the viewer's role was allowed to receive at
    // least one of these — the API strips the rest, so an absent key here
    // genuinely means "not permitted", not "false".
    {
      title: 'Learner Status',
      note: 'For DepEd reporting. Not used in risk scoring.',
      fields: LEARNER_STATUS_DISPLAY.filter(([, key]) => key in student).map(([label, key]) => [
        label,
        student[key] ? 'Yes' : 'No',
      ]),
    },
    {
      title: 'Guardian',
      fields: [
        ['Guardian', student.guardian_name],
        ['Guardian contact', student.guardian_contact_number],
      ],
    },
  ]
}

// Formerly RiskBadge — now covers all three Academic Progress Tracking
// bands, not just At Risk. The At Risk case keeps the existing expandable
// "Why?" pattern (unchanged Low/Medium/High pill + triggered factors), now
// paired with each factor's fixed advisory message. Average/Steady and
// Performing Well are a single pill plus a short note — there's nothing to
// expand since there's no factor list for either.
function AcademicProgressBadge({ progress }) {
  const [expanded, setExpanded] = useState(false)

  if (progress.band === 'at_risk') {
    return (
      <div className="risk-badge">
        <button type="button" className="risk-badge__toggle" onClick={() => setExpanded((e) => !e)}>
          <StatusPill label={RISK_LABELS[progress.riskLevel]} variant={RISK_VARIANTS[progress.riskLevel]} />
          <span className="risk-badge__why">
            Why? {expanded ? <ChevronUp size={14} strokeWidth={1.75} /> : <ChevronDown size={14} strokeWidth={1.75} />}
          </span>
        </button>
        {expanded && (
          <ul className="risk-badge__factors">
            {progress.advisories.length === 0 ? (
              <li>No specific factors flagged — risk score is driven by an overall trend.</li>
            ) : (
              progress.advisories.map((a) => (
                <li key={a.factorKey}>
                  {a.factorLabel}
                  {a.advisory && (
                    <>
                      {' — '}
                      <em>{a.advisory}</em>
                    </>
                  )}
                </li>
              ))
            )}
          </ul>
        )}
      </div>
    )
  }

  const isPerformingWell = progress.band === 'performing_well'
  return (
    <div className="risk-badge" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
      <StatusPill label={progress.bandLabel} variant={isPerformingWell ? 'positive' : 'neutral'} />
      {progress.note && (
        <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>{progress.note}</span>
      )}
    </div>
  )
}

// Staff-only now. This used to double as the student's own profile via a
// paramless /my-profile route, resolving "my own id" client-side — that
// whole mode is gone, because a student's entire view is their home page
// (pages/StudentHomePage.jsx) rather than this tabbed staff view pointed at
// themselves.
export function StudentDetailPage() {
  const { id } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [student, setStudent] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [resetResult, setResetResult] = useState(null)
  const [resetting, setResetting] = useState(false)
  const [academicProgress, setAcademicProgress] = useState(null)
  const [subjects, setSubjects] = useState(null)
  const [reportCardError, setReportCardError] = useState(null)
  const [downloadingReportCard, setDownloadingReportCard] = useState(false)

  function load() {
    if (!id) return
    setLoading(true)
    api
      .get(`/students/${id}`)
      .then((data) => setStudent(data.student))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }

  useEffect(load, [id])

  useEffect(() => {
    if (!canSeeAcademicProgress(user?.role)) return
    api
      .get(`/students/${id}/academic-progress`)
      .then((data) => setAcademicProgress(data.academicProgress))
      .catch(() => setAcademicProgress(null))
  }, [id, user?.role])

  useEffect(() => {
    if (!id) return
    api
      .get(`/students/${id}/subjects`)
      .then((data) => setSubjects(data.subjects))
      // A missing subject list shouldn't blank out the whole profile — the
      // panel just renders its own empty state.
      .catch(() => setSubjects([]))
  }, [id])

  async function toggleActive() {
    if (student.is_active) {
      await api.delete(`/students/${id}`)
    } else {
      await api.post(`/students/${id}/reactivate`)
    }
    load()
  }

  async function handleResetPassword() {
    setResetting(true)
    try {
      const result = await api.post(`/students/${id}/reset-password`)
      setResetResult(result.tempPassword)
    } finally {
      setResetting(false)
    }
  }

  async function handleDownloadReportCard() {
    setReportCardError(null)
    setDownloadingReportCard(true)
    try {
      await api.downloadFile(`/students/${id}/report-card`, `${student.last_name}_${student.first_name}_ReportCard.pdf`)
    } catch (err) {
      setReportCardError(err.message)
    } finally {
      setDownloadingReportCard(false)
    }
  }

  if (loading) return <p>Loading…</p>
  if (error) return <Alert>{error}</Alert>
  if (!student) return null

  const initials = `${student.first_name[0] || ''}${student.last_name[0] || ''}`.toUpperCase()

  const overviewTab = (
    <div>
      {/* One document, not four cards. These groups are all the same record
          — personal details, enrolment, learner status, guardian — and
          stacking four identically bordered panels made the page read as
          four unrelated things that happened to be about one student.
          Hairline-divided sections inside one container is what the design
          system already uses for exactly this (see .record-section), and a
          record is the most literal case of it there is. */}
      <div className="panel record-document">
        {buildFieldGroups(student)
          .filter((group) => group.fields.length > 0)
          .map((group) => (
            <section key={group.title} className="record-section">
              <h2>{group.title}</h2>
              {group.note && <p className="panel__note">{group.note}</p>}
              <dl className="field-grid field-grid--two-col">
                {group.fields.map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    {/* One spelling for a missing value across the whole app —
                        tables and detail pages alike (see DataTable's
                        fieldValue). This page used to say italic "Not provided"
                        while every table said an em-dash, so the same absent
                        field looked like two different states. */}
                    <dd>{fieldValue(value)}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
      </div>

      {/* The subjects they're actually taking — the schema has no times or
          days on a class offering, so this is a subject list with who
          teaches each, not a period-by-period timetable. */}
      <div className="panel" style={{ marginBottom: 'var(--space-5)' }}>
        <h2>Current Subjects</h2>
        {subjects === null ? (
          <p style={{ color: 'var(--color-text-muted)', margin: 0 }}>Loading…</p>
        ) : subjects.length === 0 ? (
          <p style={{ color: 'var(--color-text-muted)', margin: 0 }}>
            {student.current_section_id
              ? 'No subjects have been set up for this section yet.'
              : 'No section assigned yet, so there are no subjects to show.'}
          </p>
        ) : (
          <DataTable
            columns={[
              { key: 'subject', header: 'Subject', render: (x) => x.subject_name },
              { key: 'teacher', header: 'Teacher', render: (x) => fieldValue(x.teacher_name) },
            ]}
            rows={subjects || []}
            rowKey={(x) => x.id}
            emptyState={
              <p>
                {student.current_section_id
                  ? 'No subjects have been set up for this section yet.'
                  : 'No section assigned yet, so there are no subjects to show.'}
              </p>
            }
          />
        )}
      </div>

      {canWrite(user?.role) && (
        <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <button type="button" onClick={() => navigate(`/students/${id}/edit`)}>
            <Pencil size={16} strokeWidth={1.75} /> Edit Profile
          </button>
          <button type="button" onClick={toggleActive}>
            {student.is_active ? <UserX size={16} strokeWidth={1.75} /> : <UserCheck size={16} strokeWidth={1.75} />}
            {student.is_active ? 'Deactivate Student' : 'Reactivate Student'}
          </button>
          {student.user_id ? (
            <button type="button" onClick={handleResetPassword} disabled={resetting}>
              <KeyRound size={16} strokeWidth={1.75} />
              {resetting ? 'Resetting…' : 'Reset Password'}
            </button>
          ) : (
            // Enrollment is paper-based now — no event auto-creates this
            // student's portal account anymore, so this is how a
            // registrar/admin sets one up, already linked to this record
            // (see CreateAccountPage.jsx's studentId handling).
            <button type="button" onClick={() => navigate(`/users/new?studentId=${id}`)}>
              <UserPlus size={16} strokeWidth={1.75} /> Create Portal Account
            </button>
          )}
        </div>
      )}

      {/* The Alert component rather than a bare .alert div: .alert is a flex
          row, so loose block children lay out side by side. This is a
          temporary password someone has to read and copy — it needs to sit
          under its heading, not beside it. */}
      {resetResult && (
        <Alert variant="success" title="Password reset for this student's portal account.">
          <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)', margin: 0 }}>
            Share this temporary password with them now — it will not be shown again. They'll be
            required to change it on next login.
          </p>
          <code className="alert__code">{resetResult}</code>
        </Alert>
      )}
    </div>
  )

  const tabs = [
    { key: 'overview', label: 'Overview', icon: User, content: overviewTab },
    { key: 'grades', label: 'Grades', icon: GraduationCap, content: <GradeHistory studentId={id} /> },
    {
      key: 'attendance',
      label: 'Attendance',
      icon: CalendarCheck,
      content: (
        <div>
          <AttendanceHistory studentId={id} kind="daily" title="Daily Attendance (SF2)" />
          <AttendanceHistory studentId={id} kind="subject" title="Subject Attendance" />
        </div>
      ),
    },
  ]
  if (canSeeInterventions(user?.role)) {
    tabs.push({
      key: 'interventions',
      label: 'Interventions',
      icon: HeartHandshake,
      content: <InterventionHistory studentId={id} />,
    })
  }

  return (
    <div>
      <Breadcrumbs
        items={[
          { label: 'Home', to: '/' },
          { label: 'Students', to: '/students' },
          { label: `${student.last_name}, ${student.first_name}` },
        ]}
      />

      <div className="profile-header">
        <div className="profile-header__identity">
          <div className="profile-avatar">{initials}</div>
          <div>
            <h1>
              {student.last_name}, {student.first_name} {student.middle_name || ''}
            </h1>
            <p className="profile-header__subtitle">
              {student.section_name ? `Grade ${student.grade_level} – ${student.section_name}` : 'No section assigned'}
            </p>
          </div>
        </div>
        <div className="profile-header__badges">
          <StatusPill label={student.enrollment_status} variant={STATUS_VARIANTS[student.enrollment_status]} />
          {!student.is_active && <StatusPill label="inactive" variant="neutral" />}
          {academicProgress && <AcademicProgressBadge progress={academicProgress} />}
          {canSeeReportCard(user?.role) && (
            <button type="button" onClick={handleDownloadReportCard} disabled={downloadingReportCard}>
              <FileDown size={16} strokeWidth={1.75} />
              {downloadingReportCard ? 'Generating…' : 'Download Report Card'}
            </button>
          )}
        </div>
      </div>

      {reportCardError && <Alert>{reportCardError}</Alert>}

      <Tabs tabs={tabs} />
    </div>
  )
}
