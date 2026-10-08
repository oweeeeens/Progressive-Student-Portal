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
  CalendarCheck,
  PenLine,
  UserCog,
  UserPlus,
} from 'lucide-react'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { StatCard, StatRow } from '../components/StatCard'
import { TopBar } from '../components/TopBar'
import { UserInfoCard } from '../components/UserInfoCard'
import { Pagination } from '../components/Pagination'
import { QuickActions } from '../components/QuickActions'
import { StudentsNeedingAttention } from '../components/StudentsNeedingAttention'
import { ActivityFeed } from '../components/ActivityFeed'
import './DashboardPage.css'

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
        { label: 'Create Account', to: '/staff/new', icon: UserCog },
      ]
    case 'guidance_counselor':
      return [{ label: 'View Flagged Students', to: '/risk-dashboard', icon: AlertTriangle }]
    case 'admin':
      return [
        { label: 'Manage Staff Accounts', to: '/staff', icon: UserCog },
        { label: 'Post Announcement', onClick: onPostAnnouncement, icon: Plus },
      ]
    default:
      return []
  }
}

const AUTHOR_ROLES = ['admin', 'registrar', 'guidance_counselor', 'ict_faculty']
// Only the roles in AUTHOR_ROLES can ever appear as posted_by_role — no
// entries for roles that can't post, so this can't silently drift from them.
const ROLE_LABELS = {
  admin: 'Admin',
  guidance_counselor: 'Guidance Counselor',
  registrar: 'Registrar',
  ict_faculty: 'ICT Faculty',
}
const PAGE_SIZE = 10
// A new post counts as "edited" only once the gap is large enough to rule
// out normal request/processing latency between the create and its first read.
const EDITED_THRESHOLD_MS = 5000

function canAuthor(role) {
  return AUTHOR_ROLES.includes(role)
}
function canModify(user, announcement) {
  return user.role === 'admin' || user.id === announcement.posted_by
}
function formatDateTime(isoString) {
  return new Date(isoString).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
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
      {error && <p style={{ color: 'var(--color-danger)' }}>{error}</p>}
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
  const { user } = useAuth()
  const [announcements, setAnnouncements] = useState(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [error, setError] = useState(null)
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [stats, setStats] = useState(null)
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
    <div>
      <TopBar />
      <Breadcrumbs items={[{ label: 'Home' }]} />

      <div className="page-header">
        <div>
          <h1 className="dashboard-greeting">Welcome, {user.fullName.split(' ')[0]}</h1>
          <p className="dashboard-greeting__subtitle">School announcements and a quick overview of your account.</p>
        </div>
        {canAuthor(user.role) && !creating && (
          <div className="page-header__actions">
            <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
              <Plus size={16} strokeWidth={1.75} />
              New Announcement
            </button>
          </div>
        )}
      </div>

      <QuickActions actions={quickActions} />

      {stats && Object.keys(stats).length > 0 && (
        <StatRow>
          {stats.students !== undefined && (
            <StatCard icon={Users} value={stats.students} label="Active students" />
          )}
          {stats.atRiskStudents !== undefined && (
            <StatCard icon={AlertTriangle} value={stats.atRiskStudents} label="At-risk students" variant="negative" />
          )}
          {stats.openInterventions !== undefined && (
            <StatCard icon={ClipboardList} value={stats.openInterventions} label="Open interventions" variant="accent" />
          )}
        </StatRow>
      )}

      {error && <p style={{ color: 'var(--color-danger)' }}>{error}</p>}

      <div className="dashboard-main">
        <div className="dashboard-primary">
          <div className="panel">
            <h2>Announcements</h2>

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
                          Posted by {a.posted_by_name} ({ROLE_LABELS[a.posted_by_role] || a.posted_by_role}) on{' '}
                          {formatDateTime(a.created_at)}
                          {new Date(a.updated_at) - new Date(a.created_at) > EDITED_THRESHOLD_MS && ' (edited)'}
                        </p>
                        <p className="feed-item__body">{a.body}</p>
                        {a.original_filename && (
                          <button type="button" onClick={() => handleDownload(a)}>
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

          <ActivityFeed />
        </div>

        <div className="dashboard-side">
          <UserInfoCard stats={stats} />
          <StudentsNeedingAttention />
        </div>
      </div>
    </div>
  )
}
