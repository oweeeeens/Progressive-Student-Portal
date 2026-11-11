import { useEffect, useState } from 'react'
import {
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
import { useAuth } from '../context/AuthContext'
import { useWriteFeedback } from '../hooks/useWriteFeedback'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { StatCard, StatRow } from '../components/StatCard'
import { StatDetail } from '../components/StatDetail'
import { useStatExplainer } from '../hooks/useStatExplainer'
import { StaffHero } from '../components/StaffHero'
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
        'Counted from the stored risk assessment for the CURRENT grading period only. A learner flagged last term who has since recovered is not here.',
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
    // The principal previously fell through to no actions at all, which left
    // a greeting as their entire home page. They have real work to come back
    // to.
    case 'principal':
      return [
        { label: 'Verify Grades', to: '/grades/verify', icon: CheckCircle2 },
        { label: 'Analytics', to: '/analytics', icon: AlertTriangle },
      ]
    case 'admin':
      return [{ label: 'Manage User Accounts', to: '/users', icon: UserCog }]
    default:
      return []
  }
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
// One consequence worth knowing: the activity feed appears only when it
// has something in it, rather than reserving space it cannot fill.
//
// (Until 2026-11-11 the page also carried the school's announcements, and
// ICT faculty — who held no other scope — saw nothing else. Announcements
// were removed to keep the System to its title.)
export function DashboardPage() {
  const { user } = useAuth()
  const [currentPeriod, setCurrentPeriod] = useState(null)
  const [stats, setStats] = useState(null)
  const [queue, setQueue] = useState(null)
  const [bands, setBands] = useState(null)
  const [attention, setAttention] = useState(null)
  const [activity, setActivity] = useState(null)
  // Which home-page blocks failed to load. Each still degrades on its own,
  // but no longer silently: a failed task list used to vanish, and a failed
  // attention list said "nobody needs attention" — both read as good news.
  const [failedBlocks, setFailedBlocks] = useState([])
  const blockFailed = (label) => setFailedBlocks((list) => (list.includes(label) ? list : [...list, label]))
  // The page's own read failure (the stats request), shown inline. The page
  // writes nothing, but useWriteFeedback is still the one place an error
  // state lives (hooks/useWriteFeedback.js).
  const { error, setError } = useWriteFeedback()
  // One panel under the stat row, whichever figure is open. See
  // hooks/useStatExplainer.js — the hook owns the aria wiring so it cannot
  // drift between the four cards here and the rows on every other page.
  const { openFor, close: closeStat, cardProps } = useStatExplainer('dashboard-stat-detail')

  // Everything on the page, in one effect. All are role-scoped by the server
  // and all are independent, so they go out together rather than in a chain
  // — on a school's connection the difference is visible.
  //
  // A failure on any one of them leaves that block in its loading state
  // rather than taking the page down; only the one the reader cannot do
  // without (the stats that drive the figures) reports into the page's
  // Alert.
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
      .catch(() => {
        setQueue({ tasks: [], gradingPeriodName: null })
        blockFailed('your task list')
      })
    api
      .get('/dashboard/bands')
      .then((data) => setBands(data))
      .catch(() => {
        setBands({ periods: [] })
        blockFailed('the band chart')
      })
    api
      .get('/dashboard/attention')
      .then((data) => setAttention(data.students))
      .catch(() => {
        setAttention([])
        blockFailed('the students needing attention')
      })
    api
      .get('/dashboard/activity')
      .then((data) => setActivity(data.activity))
      .catch(() => {
        setActivity([])
        blockFailed('recent activity')
      })
  }, [setError])

  const quickActions = getQuickActions(user.role)
  const hasStats = stats && Object.keys(stats).length > 0

  // Whether the risk picture belongs on this person's page at all.
  //
  // Read off the STAT RESPONSE rather than off the band data, and that is
  // deliberate: the server gates both with the same predicate (compare
  // dashboardModel's hasRiskScope/canReadBandRollup against where
  // stats.atRiskStudents is set), so the stats answer is available at the
  // same moment and means the same thing. Gating on the band data instead
  // meant most staff roles watched a chart skeleton appear and
  // then vanish on every page load, which reads as a fault.
  //
  // Once the bands DO arrive, an empty set still removes the block: a school
  // with no finalized grades yet has nothing to draw, and five zero-length
  // bars is not a chart.
  const mayReadBands = Boolean(stats) && stats.atRiskStudents !== undefined
  const showStanding = mayReadBands && !(bands != null && (bands.periods || []).length === 0)

  // The activity feed appears only once it has something in it. The
  // principal is eligible for no event type at all (see
  // backend/models/activityModel.js's ROLES_BY_TYPE), so for them it would
  // otherwise be a permanently empty block.
  const hasActivity = activity != null && activity.length > 0

  return (
    <div className="dashboard-page">
      <Breadcrumbs items={[{ label: 'Home' }]} />

      <StaffHero user={user} currentPeriod={currentPeriod} />

      <QuickActions actions={quickActions} />

      {failedBlocks.length > 0 && (
        <Alert variant="warning">
          Some of this page couldn't be loaded ({failedBlocks.join(', ')}). What is shown is incomplete — reload the
          page to try again.
        </Alert>
      )}

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

      {hasActivity && <ActivityFeed activity={activity} />}
    </div>
  )
}
