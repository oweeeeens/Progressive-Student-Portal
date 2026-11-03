import { useEffect, useState } from 'react'
import {
  Plus,
  Pencil,
  Trash2,
  Paperclip,
  Users,
  AlertTriangle,
  ClipboardList,
  CheckCircle2,
  ShieldCheck,
  CalendarCheck,
  PenLine,
  UserCog,
  UserPlus,
} from 'lucide-react'
import { api } from '../api/client'
import {
  ANNOUNCEMENT_ROLE_LABELS,
  ANNOUNCEMENT_EDITED_THRESHOLD_MS,
  formatAnnouncementDateTime,
} from '../utils/announcementFormat'
import { useAuth } from '../context/AuthContext'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { StatCard, StatRow } from '../components/StatCard'
import { StatDetail } from '../components/StatDetail'
import { useStatExplainer } from '../hooks/useStatExplainer'
import { StaffHero } from '../components/StaffHero'
import { Pagination } from '../components/Pagination'
import { QuickActions } from '../components/QuickActions'
import { StudentsNeedingAttention } from '../components/StudentsNeedingAttention'
import { ActivityFeed } from '../components/ActivityFeed'
import './DashboardPage.css'
import { Alert } from '../components/Alert'

// What each headline figure on this page actually counts.
//
// Every sentence here is checked against the query that produces the number
// (backend/models/dashboardModel.js), not against what the label implies —
// the label is the thing that was already ambiguous. Two in particular are
// easy to misread and are stated outright: "at risk" deliberately excludes
// the Low band, and both student-facing counts are scoped to what YOU are
// assigned to, which is why two people can sit side by side and see
// different numbers under the same heading.
//
// `period` is the current grading period's name, or null outside one.
function dashboardStatDetails(stats, period) {
  return {
    students: {
      title: 'Active students',
      subtitle: stats.students,
      definition:
        'Learners you can see, whose record is still active. Not the whole school unless your role covers the whole school.',
      rules: [
        'Scoped to what you are assigned to — an adviser sees their advisory section plus any section they teach a class in; admin, registrar, principal and guidance counselors see the school.',
        'A record is excluded once it is deactivated, whatever its enrollment status. Pending, dropped and transferred learners still count here while their record is active — Student Records breaks those out separately.',
      ],
      action: { to: '/students', label: 'Open Student Records' },
    },
    atRiskStudents: {
      title: 'At-risk students',
      subtitle: stats.atRiskStudents,
      definition: period
        ? `Learners whose risk level for ${period} came out Medium or High.`
        : 'Learners whose risk level for the current grading period came out Medium or High.',
      rules: [
        'Low risk is deliberately left out. This card is meant to be the number worth acting on, not a restatement of the roster size.',
        'Counted from the stored risk assessment for the CURRENT grading period only. A learner flagged last quarter who has since recovered is not here.',
        'Risk is recalculated when grades are finalized or attendance is recorded — not continuously — so this can lag the classroom by design (see the approval workflow).',
        'Outside any grading period this reads 0, because there is no period to score against.',
      ],
      action: { to: '/academic-progress', label: 'Open Academic Progress' },
    },
    openInterventions: {
      title: 'Open interventions',
      subtitle: stats.openInterventions,
      definition: 'Support logged against a learner that nobody has closed out yet.',
      rules: [
        'Counts both Open and Monitoring. Resolved and Escalated are finished states and are left out.',
        'Escalated is NOT counted here even though it needs attention — it has already been handed on, so it is no longer waiting on you.',
        'Scoped to the learners you can see, the same way the student count above is.',
      ],
      action: { to: '/interventions', label: 'Open Interventions' },
    },
    gradesAwaitingVerification: {
      title: 'Grades awaiting verification',
      subtitle: stats.gradesAwaitingVerification,
      definition: period
        ? `Grades submitted by subject teachers for ${period} that are waiting on the principal.`
        : 'Grades submitted by subject teachers that are waiting on the principal.',
      rules: [
        'Stage 2 of the three-stage approval chain: a subject teacher submits, the principal verifies, the adviser finalizes into the official record.',
        'School-wide, not scoped — the principal is one person for the whole school, so this is their entire queue.',
        'Only the current grading period. A grade still sitting unverified from an earlier period is not counted.',
        'Already-verified grades move to the adviser and leave this number, so 0 means the principal is caught up, not that no grades exist.',
      ],
      action: { to: '/grades/verify', label: 'Open Verify Grades' },
    },
  }
}

// Role-specific shortcuts, placed prominently near the top of the page.
// Admin's "Post Announcement" opens the inline form already on this page
// (via the onClick callback passed in) rather than navigating away.
function getQuickActions(role, onPostAnnouncement) {
  switch (role) {
    case 'adviser':
      return [
        { label: 'Finalize Grades', to: '/grades/finalize', icon: CheckCircle2 },
        { label: 'Mark Daily Attendance', to: '/attendance/daily', icon: CalendarCheck },
      ]
    case 'subject_teacher':
      return [
        { label: 'Submit Grades', to: '/grades/entry', icon: PenLine },
        { label: 'Mark Subject Attendance', to: '/attendance/subject', icon: ClipboardList },
      ]
    case 'registrar':
      // Enrollment is paper-based now (see CLAUDE.md) — a registrar's main
      // portal-side job once a student has enrolled off-system is adding
      // their Student Record and, from there, creating their portal account.
      return [
        { label: 'New Student', to: '/students/new', icon: UserPlus },
        { label: 'Create Account', to: '/users/new', icon: UserCog },
      ]
    case 'guidance_counselor':
      return [
        { label: 'View Flagged Students', to: '/academic-progress', icon: AlertTriangle },
        { label: 'Interventions', to: '/interventions', icon: ClipboardList },
      ]
    // These two roles previously fell through to no actions at all, which
    // left them with a greeting and an announcement feed as their entire
    // home page. Both have real work to come back to.
    case 'principal':
      return [
        { label: 'Verify Grades', to: '/grades/verify', icon: CheckCircle2 },
        { label: 'Analytics', to: '/analytics', icon: AlertTriangle },
      ]
    case 'ict_faculty':
      return [{ label: 'Post Announcement', onClick: onPostAnnouncement, icon: Plus }]
    case 'admin':
      return [
        { label: 'Manage User Accounts', to: '/users', icon: UserCog },
        { label: 'Post Announcement', onClick: onPostAnnouncement, icon: Plus },
      ]
    default:
      return []
  }
}

const AUTHOR_ROLES = ['admin', 'registrar', 'guidance_counselor', 'ict_faculty']
const PAGE_SIZE = 10

function canAuthor(role) {
  return AUTHOR_ROLES.includes(role)
}
function canModify(user, announcement) {
  return user.role === 'admin' || user.id === announcement.posted_by
}

function AnnouncementForm({ initial, onCancel, onSubmit, submitLabel }) {
  const [title, setTitle] = useState(initial?.title || '')
  const [body, setBody] = useState(initial?.body || '')
  const [file, setFile] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await onSubmit({ title, body, file })
    } catch (err) {
      setError(err.message)
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', marginBottom: 'var(--space-5)' }}>
      <label>
        Title
        <input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={255} style={{ width: '100%' }} />
      </label>
      <label>
        Body
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          required
          rows={4}
          style={{ width: '100%', fontFamily: 'inherit', fontSize: 'var(--font-size-base)', padding: 'var(--space-2) var(--space-3)' }}
        />
      </label>
      <label>
        Attachment {initial?.original_filename && '(leave blank to keep the current one)'}
        <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => setFile(e.target.files[0])} />
      </label>
      {error && <Alert>{error}</Alert>}
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? 'Saving…' : submitLabel}
        </button>
        <button type="button" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
      </div>
    </form>
  )
}

// This is the page every logged-in user lands on after login (see App.jsx's
// "/" route) — the announcements feed is its main content, per the brief.
export function DashboardPage() {
  const [currentPeriod, setCurrentPeriod] = useState(null)
  const { user } = useAuth()
  const [announcements, setAnnouncements] = useState(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [error, setError] = useState(null)
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [stats, setStats] = useState(null)
  // One panel under the stat row, whichever figure is open. See
  // hooks/useStatExplainer.js — the hook owns the aria wiring so it cannot
  // drift between the four cards here and the rows on every other page.
  const { openFor, close: closeStat, cardProps } = useStatExplainer('dashboard-stat-detail')
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [deletingId, setDeletingId] = useState(null)

  function load() {
    api
      .get(`/announcements?page=${page}&pageSize=${PAGE_SIZE}`)
      .then((data) => {
        setAnnouncements(data.announcements)
        setTotal(data.total)
      })
      .catch((err) => setError(err.message))
  }

  useEffect(load, [page])

  // Role-scoped — the backend returns only the figures this role is already
  // allowed to see elsewhere, so roles like student get an empty object and
  // simply render no stat row.
  // The term the greeting names. Same endpoint the top bar already uses.
  useEffect(() => {
    api
      .get('/grading-periods/current')
      .then((data) => setCurrentPeriod(data.gradingPeriod))
      .catch(() => setCurrentPeriod(null))
  }, [])

  useEffect(() => {
    api
      .get('/dashboard/stats')
      .then((data) => setStats(data.stats))
      .catch((err) => setError(err.message))
  }, [])

  function toFormData({ title, body, file }) {
    const formData = new FormData()
    formData.append('title', title)
    formData.append('body', body)
    if (file) formData.append('file', file)
    return formData
  }

  async function handleCreate(values) {
    await api.upload('/announcements', toFormData(values))
    setCreating(false)
    setPage(1)
    load()
  }

  async function handleUpdate(id, values) {
    await api.upload(`/announcements/${id}`, toFormData(values), 'PATCH')
    setEditingId(null)
    load()
  }

  async function handleDelete(id) {
    setDeletingId(id)
    try {
      await api.delete(`/announcements/${id}`)
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setConfirmDeleteId(null)
      setDeletingId(null)
    }
  }

  function handleDownload(a) {
    api.downloadFile(`/announcements/${a.id}/file`, a.original_filename).catch((err) => setError(err.message))
  }

  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1)
  const quickActions = getQuickActions(user.role, () => setCreating(true))

  return (
    <div className="dashboard-page">
      <Breadcrumbs items={[{ label: 'Home' }]} />

      <StaffHero user={user} currentPeriod={currentPeriod} />

      <QuickActions actions={quickActions} />

      {stats && Object.keys(stats).length > 0 && (
        <>
          <StatRow compact>
            {stats.students !== undefined && (
              <StatCard icon={Users} value={stats.students} label="Active students" {...cardProps('students')} />
            )}
            {stats.atRiskStudents !== undefined && (
              <StatCard
                icon={AlertTriangle}
                value={stats.atRiskStudents}
                label="At-risk students"
                variant="negative"
                {...cardProps('atRiskStudents')}
              />
            )}
            {stats.openInterventions !== undefined && (
              <StatCard
                icon={ClipboardList}
                value={stats.openInterventions}
                label="Open interventions"
                variant="accent"
                {...cardProps('openInterventions')}
              />
            )}
            {/* The principal's own queue. Shown to them and to admin only —
                nobody else can act on it. */}
            {stats.gradesAwaitingVerification !== undefined && (
              <StatCard
                icon={ShieldCheck}
                value={stats.gradesAwaitingVerification}
                label="Grades awaiting verification"
                variant={stats.gradesAwaitingVerification > 0 ? 'warning' : 'positive'}
                {...cardProps('gradesAwaitingVerification')}
              />
            )}
          </StatRow>

          <StatDetail
            id="dashboard-stat-detail"
            detail={dashboardStatDetails(stats, currentPeriod?.name)[openFor()]}
            onClose={closeStat}
          />
        </>
      )}

      {error && <Alert>{error}</Alert>}

      <div className="dashboard-main">
        <div className="dashboard-primary">
          <div className="panel">
            <div className="panel__head">
              <h2>Announcements</h2>
              {canAuthor(user.role) && !creating && (
                <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
                  <Plus size={16} strokeWidth={1.75} />
                  New Announcement
                </button>
              )}
            </div>

            {creating && (
              <AnnouncementForm
                submitLabel="Post Announcement"
                onCancel={() => setCreating(false)}
                onSubmit={handleCreate}
              />
            )}

            {!announcements ? (
              <div aria-hidden="true">
                {[0, 1, 2].map((i) => (
                  <div className="feed-item" key={i}>
                    <div className="skeleton" style={{ width: '40%', height: '1.125rem', marginBottom: 'var(--space-2)' }} />
                    <div className="skeleton" style={{ width: '30%', height: '0.8125rem', marginBottom: 'var(--space-3)' }} />
                    <div className="skeleton" style={{ width: '100%', height: '0.9375rem', marginBottom: 'var(--space-2)' }} />
                    <div className="skeleton" style={{ width: '75%', height: '0.9375rem' }} />
                  </div>
                ))}
              </div>
            ) : announcements.length === 0 ? (
              <div className="empty-state">
                <p>No announcements yet.</p>
                <p>
                  {canAuthor(user.role)
                    ? 'Post the first one to share something with the school.'
                    : "Check back later — nothing's been posted yet."}
                </p>
              </div>
            ) : (
              <div>
                {announcements.map((a) => (
                  <div className="feed-item" key={a.id}>
                    {editingId === a.id ? (
                      <AnnouncementForm
                        initial={a}
                        submitLabel="Save Changes"
                        onCancel={() => setEditingId(null)}
                        onSubmit={(values) => handleUpdate(a.id, values)}
                      />
                    ) : (
                      <>
                        <div className="feed-item__header">
                          <h3 className="feed-item__title">{a.title}</h3>
                          {canModify(user, a) && (
                            <div className="feed-item__actions">
                              {confirmDeleteId === a.id ? (
                                <>
                                  <button
                                    type="button"
                                    className="btn-danger"
                                    disabled={deletingId === a.id}
                                    onClick={() => handleDelete(a.id)}
                                  >
                                    {deletingId === a.id ? 'Deleting…' : 'Confirm Delete'}
                                  </button>
                                  <button type="button" disabled={deletingId === a.id} onClick={() => setConfirmDeleteId(null)}>
                                    Cancel
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button type="button" onClick={() => setEditingId(a.id)}>
                                    <Pencil size={14} strokeWidth={1.75} /> Edit
                                  </button>
                                  <button type="button" className="btn-danger-subtle" onClick={() => setConfirmDeleteId(a.id)}>
                                    <Trash2 size={14} strokeWidth={1.75} /> Delete
                                  </button>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                        <p className="feed-item__byline">
                          Posted by {a.posted_by_name} (
                          {ANNOUNCEMENT_ROLE_LABELS[a.posted_by_role] || a.posted_by_role}) on{' '}
                          {formatAnnouncementDateTime(a.created_at)}
                          {new Date(a.updated_at) - new Date(a.created_at) > ANNOUNCEMENT_EDITED_THRESHOLD_MS &&
                            ' (edited)'}
                        </p>
                        <p className="feed-item__body">{a.body}</p>
                        {/* btn-subtle, matching AnnouncementsPanel's copy of
                            this same control — it had no class at all, so it
                            rendered as a default browser button here and a
                            quiet text button everywhere else. */}
                        {a.original_filename && (
                          <button type="button" className="btn-subtle" onClick={() => handleDownload(a)}>
                            <Paperclip size={14} strokeWidth={1.75} /> {a.original_filename}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}

            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
          </div>

        </div>

        <div className="dashboard-side">
          <StudentsNeedingAttention />
          <ActivityFeed />
        </div>
      </div>
    </div>
  )
}
