import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  KeyRound,
  Pencil,
  UserCheck,
  UserX,
  ChevronDown,
  ChevronUp,
  User,
  GraduationCap,
  CalendarCheck,
  FileCheck2,
  HeartHandshake,
} from 'lucide-react'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { StatusPill } from '../components/StatusPill'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { Tabs } from '../components/Tabs'
import { AttendanceHistory } from '../components/AttendanceHistory'
import { GradeHistory } from '../components/GradeHistory'
import { EnrollmentDocuments } from '../components/EnrollmentDocuments'
import { InterventionHistory } from '../components/InterventionHistory'

const canWrite = (role) => role === 'admin' || role === 'registrar'
const canSeeEnrollment = (role) => ['student', 'admin', 'registrar'].includes(role)
// Same audience as the Risk Dashboard and Interventions — risk standing is
// more sensitive than a roster entry, so this is narrower than "can view
// this student's profile at all".
const canSeeRisk = (role) => ['admin', 'adviser', 'guidance_counselor'].includes(role)
const canSeeInterventions = canSeeRisk

const STATUS_VARIANTS = { enrolled: 'positive', pending: 'warning', dropped: 'negative', transferred: 'neutral', graduated: 'info' }
const RISK_VARIANTS = { low: 'risk-low', medium: 'risk-medium', high: 'risk-high' }
const RISK_LABELS = { low: 'Low Risk', medium: 'Medium Risk', high: 'High Risk' }

const FIELD_LABELS = {
  lrn: 'LRN',
  sex: 'Sex',
  date_of_birth: 'Date of birth',
  address: 'Address',
  email: 'Personal email',
  guardian_name: 'Guardian',
  guardian_contact_number: 'Guardian contact',
}

function formatDateOnly(isoDateString) {
  const [year, month, day] = isoDateString.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString(undefined, { dateStyle: 'medium' })
}

function fieldDisplayValue(key, student) {
  const raw = student[key]
  if (raw === null || raw === undefined || raw === '') return null
  return key === 'date_of_birth' ? formatDateOnly(raw) : raw
}

function RiskBadge({ risk }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="risk-badge">
      <button type="button" className="risk-badge__toggle" onClick={() => setExpanded((e) => !e)}>
        <StatusPill label={RISK_LABELS[risk.riskLevel]} variant={RISK_VARIANTS[risk.riskLevel]} />
        <span className="risk-badge__why">
          Why? {expanded ? <ChevronUp size={14} strokeWidth={1.75} /> : <ChevronDown size={14} strokeWidth={1.75} />}
        </span>
      </button>
      {expanded && (
        <ul className="risk-badge__factors">
          {risk.factors.length === 0 ? (
            <li>No specific factors flagged — risk score is driven by an overall trend.</li>
          ) : (
            risk.factors.map((f) => <li key={f.key}>{f.label}</li>)
          )}
        </ul>
      )}
    </div>
  )
}

export function StudentDetailPage() {
  const { id } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [student, setStudent] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [resetResult, setResetResult] = useState(null)
  const [resetting, setResetting] = useState(false)
  const [risk, setRisk] = useState(null)

  function load() {
    api
      .get(`/students/${id}`)
      .then((data) => setStudent(data.student))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }

  useEffect(load, [id])

  useEffect(() => {
    if (!canSeeRisk(user?.role)) return
    api
      .get(`/students/${id}/risk`)
      .then((data) => setRisk(data.risk))
      .catch(() => setRisk(null))
  }, [id, user?.role])

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

  if (loading) return <p>Loading…</p>
  if (error) return <p style={{ color: 'var(--color-danger)' }}>{error}</p>
  if (!student) return null

  const initials = `${student.first_name[0] || ''}${student.last_name[0] || ''}`.toUpperCase()

  const overviewTab = (
    <div>
      <div className="panel" style={{ marginBottom: 'var(--space-5)' }}>
        <dl className="field-grid field-grid--two-col">
          {Object.entries(FIELD_LABELS).map(([key, label]) => {
            const value = fieldDisplayValue(key, student)
            return (
              <div key={key}>
                <dt>{label}</dt>
                <dd className={value ? '' : 'is-empty'}>{value || 'Not provided'}</dd>
              </div>
            )
          })}
        </dl>
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
          <button type="button" onClick={handleResetPassword} disabled={resetting}>
            <KeyRound size={16} strokeWidth={1.75} />
            {resetting ? 'Resetting…' : 'Reset Password'}
          </button>
        </div>
      )}

      {resetResult && (
        <div className="alert alert--success" style={{ marginTop: 'var(--space-4)', marginBottom: 0 }}>
          <p>Password reset for this student's portal account.</p>
          <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>
            Share this temporary password with them now — it will not be shown again. They'll be
            required to change it on next login.
          </p>
          <code className="alert__code">{resetResult}</code>
        </div>
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
  if (canSeeEnrollment(user?.role)) {
    tabs.push({
      key: 'enrollment',
      label: 'Enrollment Documents',
      icon: FileCheck2,
      content: <EnrollmentDocuments studentId={id} onStudentUpdated={load} />,
    })
  }
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
          {risk && <RiskBadge risk={risk} />}
        </div>
      </div>

      <Tabs tabs={tabs} />
    </div>
  )
}
