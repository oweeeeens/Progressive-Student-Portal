import { useCallback, useEffect, useState } from 'react'
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
  Megaphone,
} from 'lucide-react'
import { api } from '../api/client'
import {
  ANNOUNCEMENT_ROLE_LABELS,
  ANNOUNCEMENT_EDITED_THRESHOLD_MS,
  formatAnnouncementDateTime,
} from '../utils/announcementFormat'
import { useAuth } from '../context/AuthContext'
import { useWriteFeedback } from '../hooks/useWriteFeedback'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { StatCard, StatRow } from '../components/StatCard'
import { StatDetail } from '../components/StatDetail'
import { useStatExplainer } from '../hooks/useStatExplainer'
import { StaffHero } from '../components/StaffHero'
import { Pagination } from '../components/Pagination'
import { QuickActions } from '../components/QuickActions'
import { TaskQueue } from '../components/TaskQueue'
import { BandDistribution } from '../components/BandDistribution'
import { StudentsNeedingAttention } from '../components/StudentsNeedingAttention'
import { ActivityFeed } from '../components/ActivityFeed'
import { Skeleton } from '../components/Skeleton'
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
        'The task list above counts differently on purpose: "Log support for flagged learners" includes Low risk, because a Low-risk learner nobody has spoken to is exactly what the closed loop exists to catch.',
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
//
// These are the "I already know what I came here for" path, and they are
// deliberately kept alongside the task queue rather than replaced by it:
// the queue says what is waiting, these say what this person does often
// whether anything is waiting or not. A registrar whose queue is empty
// still needs to add a student record.
//
function getQuickActions(role) {
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
    // ICT faculty get no chips at all, and that is right: their one action
    // is posting a notice, and the noticeboard below carries its own "New
    // Announcement" button directly above the feed it adds to. Two controls
    // for one action, eight centimetres apart, is not a shortcut.
    case 'ict_faculty':
      return []
    case 'admin':
      return [{ label: 'Manage User Accounts', to: '/users', icon: UserCog }]
    default:
      return []
  }
}

const AUTHOR_ROLES = ['admin', 'registrar', 'guidance_counselor', 'ict_faculty']
// Five, not ten. The announcements feed used to be the largest thing on this
// page — three full articles, in a column twice the width of the only block
// about learners. It is still first-class, but it is a noticeboard, and a
// noticeboard is scanned rather than read end to end.
const PAGE_SIZE = 5
// Longer than this and the body is collapsed behind "Read more". A character
// count rather than a measured height on purpose: measuring means a layout
// pass per item and a reflow the first time the page paints, and the exact
// cut-off matters far less than the page not being three screens of text.
const BODY_CLAMP_CHARS = 220

function canAuthor(role) {
  return AUTHOR_ROLES.includes(role)
}
function canModify(user, announcement) {
  return user.role === 'admin' || user.id === announcement.posted_by
}

// `onSubmit` returns true on success and false on failure — the page runs
// the write (so it gets the toast and the double-click guard that every
// other write in the app has) and passes the message back down through
// `error`, which renders here beside the buttons rather than at the top of
// the page where nobody is looking.
function AnnouncementForm({ initial, onCancel, onSubmit, submitLabel, error }) {
  const [title, setTitle] = useState(initial?.title || '')
  const [body, setBody] = useState(initial?.body || '')
  const [file, setFile] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitting(true)
    const ok = await onSubmit({ title, body, file })
    // On success this form is unmounted by the page; only a failure needs
    // the button released again.
    if (!ok) setSubmitting(false)
  }

  return (
    <form onSubmit={handleSubmit} className="announcement-form">
      <label>
        Title
        <input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={255} />
      </label>
      <label>
        Body
        <textarea value={body} onChange={(e) => setBody(e.target.value)} required rows={4} />
      </label>
      <label>
        Attachment {initial?.original_filename && '(leave blank to keep the current one)'}
        <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => setFile(e.target.files[0])} />
      </label>
      {error && <Alert>{error}</Alert>}
      <div className="announcement-form__actions">
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

// One notice. Long bodies collapse so the noticeboard can be scanned; the
// toggle is a real button, so the full text is reachable by keyboard and is
// announced as expandable.
function Announcement({ announcement, canEdit, onEdit, onDelete, onDownload, isDeleting, confirming, onConfirm, onCancelConfirm }) {
  const [expanded, setExpanded] = useState(false)
  const isLong = announcement.body.length > BODY_CLAMP_CHARS
  const edited =
    new Date(announcement.updated_at) - new Date(announcement.created_at) > ANNOUNCEMENT_EDITED_THRESHOLD_MS

  return (
    <article className="feed-item">
      <div className="feed-item__header">
        <h3 className="feed-item__title">{announcement.title}</h3>
        {canEdit && (
          <div className="feed-item__actions">
            {confirming ? (
              <>
                <button type="button" className="btn-danger" disabled={isDeleting} onClick={onDelete}>
                  {isDeleting ? 'Deleting…' : 'Confirm Delete'}
                </button>
                <button type="button" disabled={isDeleting} onClick={onCancelConfirm}>
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button type="button" onClick={onEdit}>
                  <Pencil size={14} strokeWidth={1.75} /> Edit
                </button>
                <button type="button" className="btn-danger-subtle" onClick={onConfirm}>
                  <Trash2 size={14} strokeWidth={1.75} /> Delete
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <p className="feed-item__byline">
        Posted by {announcement.posted_by_name} (
        {ANNOUNCEMENT_ROLE_LABELS[announcement.posted_by_role] || announcement.posted_by_role}) on{' '}
        {formatAnnouncementDateTime(announcement.created_at)}
        {edited && ' (edited)'}
      </p>

      <p className={`feed-item__body${isLong && !expanded ? ' feed-item__body--clamped' : ''}`}>{announcement.body}</p>

      {isLong && (
        <button type="button" className="btn-subtle" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Show less' : 'Read more'}
        </button>
      )}

      {/* btn-subtle, matching AnnouncementsPanel's copy of this same control
          — it had no class at all, so it rendered as a default browser
          button here and a quiet text button everywhere else. */}
      {announcement.original_filename && (
        <button type="button" className="btn-subtle" onClick={onDownload}>
          <Paperclip size={14} strokeWidth={1.75} /> {announcement.original_filename}
        </button>
      )}
    </article>
  )
}

// This is the page every staff role lands on after login (see HomePage's
// split — a student's home is a different page entirely).
//
// HOW THE LAYOUT IS DECIDED
//
// Not by a switch on the role. Each block renders only if its own data came
// back with something in it, and all of that data is already role-scoped by
// the server. That is what shapes the page per role without a role table
// anywhere in it — and it is the only approach that survives the school's
// ordinary case, a teacher who advises one section and teaches into two
// others, because the scoping rule the data was fetched under is
// assignment-based while a role label is not.
//
// Two consequences worth knowing:
//   * ICT faculty hold no assignment and no student scope, so the queue,
//     the stat row and the risk picture all come back empty and their home
//     page IS the noticeboard — which is exactly their job (CLAUDE.md).
//   * The announcements column goes full width whenever the activity feed
//     has nothing in it, instead of leaving a 300px gap beside it.
export function DashboardPage() {
  const { user } = useAuth()
  const [currentPeriod, setCurrentPeriod] = useState(null)
  const [announcements, setAnnouncements] = useState(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [stats, setStats] = useState(null)
  const [queue, setQueue] = useState(null)
  const [bands, setBands] = useState(null)
  const [attention, setAttention] = useState(null)
  const [activity, setActivity] = useState(null)
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  // The page's own read failures, plus every write's outcome: the error
  // inline, the confirmation as a toast, and a gate so a double-click
  // cannot post twice (hooks/useWriteFeedback.js).
  const { error, setError, busyKey, runWrite } = useWriteFeedback()
  // One panel under the stat row, whichever figure is open. See
  // hooks/useStatExplainer.js — the hook owns the aria wiring so it cannot
  // drift between the four cards here and the rows on every other page.
  const { openFor, close: closeStat, cardProps } = useStatExplainer('dashboard-stat-detail')

  // useCallback so the effect below can depend on it honestly rather than
  // on `page` alone — `setError` comes from useWriteFeedback now, not from
  // a plain useState, and a stale closure over it is the kind of thing that
  // only shows up as a message that never appears.
  const load = useCallback(() => {
    api
      .get(`/announcements?page=${page}&pageSize=${PAGE_SIZE}`)
      .then((data) => {
        setAnnouncements(data.announcements)
        setTotal(data.total)
      })
      .catch((err) => setError(err.message))
  }, [page, setError])

  useEffect(() => {
    load()
  }, [load])

  // Everything else on the page, in one effect. All five are role-scoped by
  // the server and all five are independent, so they go out together rather
  // than in a chain — on a school's connection the difference is visible.
  //
  // A failure on any one of them leaves that block in its loading state
  // rather than taking the page down; only the two the reader cannot do
  // without (announcements above, and the stats that drive the figures)
  // report into the page's Alert.
  useEffect(() => {
    api
      .get('/grading-periods/current')
      .then((data) => setCurrentPeriod(data.gradingPeriod))
      .catch(() => setCurrentPeriod(null))
    api
      .get('/dashboard/stats')
      .then((data) => setStats(data.stats))
      .catch((err) => setError(err.message))
    api
      .get('/dashboard/queue')
      .then((data) => setQueue(data))
      .catch(() => setQueue({ tasks: [], gradingPeriodName: null }))
    api
      .get('/dashboard/bands')
      .then((data) => setBands(data))
      .catch(() => setBands({ periods: [] }))
    api
      .get('/dashboard/attention')
      .then((data) => setAttention(data.students))
      .catch(() => setAttention([]))
    api
      .get('/dashboard/activity')
      .then((data) => setActivity(data.activity))
      .catch(() => setActivity([]))
  }, [setError])

  function toFormData({ title, body, file }) {
    const formData = new FormData()
    formData.append('title', title)
    formData.append('body', body)
    if (file) formData.append('file', file)
    return formData
  }

  async function handleCreate(values) {
    const ok = await runWrite(
      'announcement-new',
      () => api.upload('/announcements', toFormData(values)),
      'Announcement posted'
    )
    if (ok) {
      setCreating(false)
      setPage(1)
      load()
    }
    return ok
  }

  async function handleUpdate(id, values) {
    const ok = await runWrite(
      `announcement-${id}`,
      () => api.upload(`/announcements/${id}`, toFormData(values), 'PATCH'),
      'Announcement updated'
    )
    if (ok) {
      setEditingId(null)
      load()
    }
    return ok
  }

  async function handleDelete(id) {
    const ok = await runWrite(`announcement-${id}`, () => api.delete(`/announcements/${id}`), 'Announcement deleted')
    setConfirmDeleteId(null)
    if (ok) load()
  }

  function handleDownload(announcement) {
    api
      .downloadFile(`/announcements/${announcement.id}/file`, announcement.original_filename)
      .catch((err) => setError(err.message))
  }

  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1)
  const quickActions = getQuickActions(user.role)
  const hasStats = stats && Object.keys(stats).length > 0

  // Whether the risk picture belongs on this person's page at all.
  //
  // Read off the STAT RESPONSE rather than off the band data, and that is
  // deliberate: the server gates both with the same predicate (compare
  // dashboardModel's hasRiskScope/canReadBandRollup against where
  // stats.atRiskStudents is set), so the stats answer is available at the
  // same moment and means the same thing. Gating on the band data instead
  // meant four of the seven staff roles watched a chart skeleton appear and
  // then vanish on every page load, which reads as a fault.
  //
  // Once the bands DO arrive, an empty set still removes the block: a school
  // with no finalized grades yet has nothing to draw, and five zero-length
  // bars is not a chart.
  const mayReadBands = Boolean(stats) && stats.atRiskStudents !== undefined
  const showStanding = mayReadBands && !(bands != null && (bands.periods || []).length === 0)

  // The activity column appears only once it has something in it. The
  // principal and ICT faculty are eligible for no event type at all (see
  // backend/models/activityModel.js's ROLES_BY_TYPE), so for them it would
  // otherwise be a permanent 300px gap beside the noticeboard.
  const hasActivity = activity != null && activity.length > 0

  return (
    <div className="dashboard-page">
      <Breadcrumbs items={[{ label: 'Home' }]} />

      <StaffHero user={user} currentPeriod={currentPeriod} />

      <QuickActions actions={quickActions} />

      {/* The lead. Null while loading — the queue's shape is unknown until
          the server says which items this person is eligible for, so this is
          the one place on the page that cannot draw what is coming. */}
      {queue ? (
        <TaskQueue tasks={queue.tasks} gradingPeriodName={queue.gradingPeriodName} />
      ) : (
        <div className="dashboard-queue-skeleton" aria-hidden="true">
          <Skeleton w="14rem" h="1.4375rem" />
          <Skeleton h="4.5rem" radius="var(--radius-card)" />
          <Skeleton h="4.5rem" radius="var(--radius-card)" />
        </div>
      )}

      {hasStats && (
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

      {showStanding && (
        <div className="dashboard-standing">
          <BandDistribution bands={bands} role={user.role} />
          <StudentsNeedingAttention students={attention} />
        </div>
      )}

      <div className={`dashboard-feeds${hasActivity ? '' : ' dashboard-feeds--single'}`}>
        <section className="panel">
          <div className="panel__head">
            <h2>
              <Megaphone size={18} strokeWidth={1.75} aria-hidden="true" />
              Announcements
            </h2>
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
              error={error}
            />
          )}

          {!announcements ? (
            <div aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <div className="feed-item feed-item--loading" key={i}>
                  <Skeleton w="40%" h="1.125rem" />
                  <Skeleton w="30%" h="0.8125rem" />
                  <Skeleton w="100%" h="0.9375rem" />
                  <Skeleton w="75%" h="0.9375rem" />
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
            <div className="announcement-list">
              {announcements.map((a) =>
                editingId === a.id ? (
                  <div className="feed-item" key={a.id}>
                    <AnnouncementForm
                      initial={a}
                      submitLabel="Save Changes"
                      onCancel={() => setEditingId(null)}
                      onSubmit={(values) => handleUpdate(a.id, values)}
                      error={error}
                    />
                  </div>
                ) : (
                  <Announcement
                    key={a.id}
                    announcement={a}
                    canEdit={canModify(user, a)}
                    isDeleting={busyKey === `announcement-${a.id}`}
                    confirming={confirmDeleteId === a.id}
                    onConfirm={() => setConfirmDeleteId(a.id)}
                    onCancelConfirm={() => setConfirmDeleteId(null)}
                    onEdit={() => setEditingId(a.id)}
                    onDelete={() => handleDelete(a.id)}
                    onDownload={() => handleDownload(a)}
                  />
                )
              )}
            </div>
          )}

          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </section>

        {hasActivity && <ActivityFeed activity={activity} />}
      </div>
    </div>
  )
}
