import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  GraduationCap,
  CalendarCheck,
  CalendarRange,
  BookOpenCheck,
  BadgeCheck,
  TrendingUp,
  TrendingDown,
  Minus,
  Activity,
  Award,
  ShieldAlert,
  Target,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  IdCard,
} from 'lucide-react'
import { api } from '../api/client'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { StatusPill } from '../components/StatusPill'
import { StatCard, StatRow } from '../components/StatCard'
import { StatExplainer } from '../components/StatExplainer'
import { CheckStrip } from '../components/CheckStrip'
import { TargetBar } from '../components/TargetBar'
import { TrendIcon } from '../components/TrendIcon'
import { ContextCard, ContextCardRow } from '../components/ContextCard'
import { AnnouncementBanner } from '../components/AnnouncementBanner'
import { AnnouncementsPanel } from '../components/AnnouncementsPanel'
import { ChartCard, ChartCardRow } from '../components/charts/ChartCard'
import { ColumnChart } from '../components/charts/ColumnChart'
import { DataTable, fieldValue } from '../components/table/DataTable'
import { INTERVENTION_TYPE_LABELS, INTERVENTION_STATUS_VARIANTS } from '../components/InterventionDetailPanel'
import { describeTrendAgainstThreshold } from '../utils/chartInterpretation'
import './StudentHomePage.css'
import { Alert } from '../components/Alert'

const RISK_VARIANTS = { low: 'risk-low', medium: 'risk-medium', high: 'risk-high' }
const RISK_LABELS = { low: 'Low', medium: 'Medium', high: 'High' }
const BAND_ICONS = { at_risk: ShieldAlert, average: Activity, performing_well: Award }
const CATEGORY_LABELS = { grades: 'Grades', attendance: 'Attendance' }
// The two checks that are a VALUE on a fixed scale, so a bar can show where
// they sit against their target. The other two are rates of change, which
// have no position on such a scale — they keep their sentence rather than
// being drawn against an axis that would have to be invented. The scale's
// maximum is the measure's own ceiling (a grade out of 100, a rate out of
// 100%), never the student's current figure, which would make every bar
// look equally full.
const TARGET_BAR_SCALES = {
  low_grade: { max: 100, unit: '', gapNoun: 'points' },
  low_attendance: { max: 100, unit: '%', gapNoun: 'points' },
}
const CLOSED_STATUSES = ['resolved', 'escalated']
const ANNOUNCEMENTS_PAGE_SIZE = 5
// One panel serves all four figures, so one id is enough for every card's
// aria-controls — they are all pointing at the same region.
const STAT_EXPLAINER_ID = 'stat-explainer'

function formatDate(isoDateString) {
  if (!isoDateString) return '—'
  const [year, month, day] = isoDateString.split('T')[0].split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString(undefined, { dateStyle: 'medium' })
}

function formatPercent(v) {
  return v == null ? '—' : `${v}%`
}

// Turns an enum value into display text ("enrolled" -> "Enrolled").
function humanize(value) {
  if (!value) return '—'
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

// "SUPAN, MARK CYRUS S." — surname first with the middle name reduced to an
// initial, the DepEd form convention. It matches how the student's name is
// printed on the paper records this portal mirrors (SF10, report card), so
// the two can be read side by side without translation.
function formalName(student) {
  const middleInitial = student.middle_name ? ` ${student.middle_name.trim()[0].toUpperCase()}.` : ''
  return `${student.last_name}, ${student.first_name}${middleInitial}`
}

// The student's ENTIRE portal, on one scrolling page: the school's
// announcements, who they are, how they are doing, what to do about it, then
// the supporting detail. There is no student sub-navigation anywhere — this
// was once six routes behind two collapsible sidebar parents, which put the
// advice a flagged student most needs three clicks away from where they
// land. Nothing here is behind a click except the month calendar, which is
// simply too tall to sit open, and each announcement's full text.
export function StudentHomePage() {
  const [student, setStudent] = useState(null)
  const [progress, setProgress] = useState(null)
  const [trend, setTrend] = useState(null)
  // The passing grade and required attendance rate the two trend charts draw
  // their reference lines at, straight from the server's risk config — never
  // a number written down in this file (see myProgressController's trend
  // response).
  const [thresholds, setThresholds] = useState(null)
  // Which headline figure is currently explaining itself, or null. One at a
  // time: four panels open at once would push the advice below them off the
  // screen, which is the problem this page was rebuilt to fix.
  const [openStat, setOpenStat] = useState(null)
  const location = useLocation()
  const namecardRef = useRef(null)
  const [attendanceDetail, setAttendanceDetail] = useState(null)
  const [interventions, setInterventions] = useState(null)
  const [grades, setGrades] = useState(null)
  // The namecard's second half (address, guardian, contact), opened from
  // here or from the top bar's account menu.
  const [showRecord, setShowRecord] = useState(false)
  const [currentPeriod, setCurrentPeriod] = useState(null)
  const [latestAnnouncement, setLatestAnnouncement] = useState(null)
  const [announcements, setAnnouncements] = useState(null)
  const [announcementTotal, setAnnouncementTotal] = useState(0)
  const [announcementPage, setAnnouncementPage] = useState(1)
  const [expandedAnnouncementId, setExpandedAnnouncementId] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  // Everything about the student, fetched once. The my-progress/* endpoints
  // carry no :id — they resolve the caller's own record server-side (see
  // backend/controllers/myProgressController.js), so there is no student id
  // on the wire for the parts that do not need one.
  useEffect(() => {
    setLoading(true)
    Promise.all([
      api.get('/students?pageSize=1'),
      api.get('/my-progress/academic-progress'),
      api.get('/my-progress/trend'),
      api.get('/my-progress/attendance-detail'),
      api.get('/my-progress/interventions'),
    ])
      .then(([me, p, t, a, i]) => {
        const own = me.students[0] || null
        setProgress(p.myAcademicProgress)
        setTrend(t.periods)
        setThresholds({ passingGrade: t.passingGrade, attendanceRate: t.attendanceThreshold })
        setAttendanceDetail(a.periods)
        setInterventions(i.interventions)
        return own
      })
      // The parts that genuinely need the student's own id, resolved above.
      // The full record comes from the detail endpoint rather than the list
      // one because adviser_name is only joined on findById — the roster
      // query deliberately does not carry it (see studentModel).
      .then((own) => {
        if (!own) return null
        return Promise.all([
          // The grade history stays: the Average grade explainer lists the
          // finalized marks it is made of (see StatExplainer).
          api.get(`/students/${own.id}`),
          api.get(`/students/${own.id}/grades`),
        ]).then(([full, gr]) => {
          setStudent(full.student)
          setGrades(gr.grades)
        })
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  // School year and grading period for the context cards — the same endpoint
  // that feeds the TopBar period chip, so the two can never disagree.
  useEffect(() => {
    api
      .get('/grading-periods/current')
      .then((data) => setCurrentPeriod(data.gradingPeriod))
      .catch(() => setCurrentPeriod(null))
  }, [])

  // Opened from the top bar's account menu. The student's portal is one
  // page, so "Your record on file" is a disclosure to open and scroll to
  // rather than a route to visit. The state value is a timestamp, so
  // choosing the menu item twice in a row still fires.
  useEffect(() => {
    if (!location.state?.openRecord) return
    setShowRecord(true)
    namecardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [location.state?.openRecord])

  // The banner always shows the newest announcement, so it is fetched on its
  // own rather than read off the panel's current page — otherwise paging the
  // panel would change, or empty, the banner above it.
  useEffect(() => {
    api
      .get('/announcements?page=1&pageSize=1')
      .then((data) => setLatestAnnouncement(data.announcements[0] || null))
      .catch((err) => setError(err.message))
  }, [])

  useEffect(() => {
    api
      .get(`/announcements?page=${announcementPage}&pageSize=${ANNOUNCEMENTS_PAGE_SIZE}`)
      .then((data) => {
        setAnnouncements(data.announcements)
        setAnnouncementTotal(data.total)
      })
      .catch((err) => setError(err.message))
  }, [announcementPage])

  const messagesByCategory = useMemo(() => {
    const groups = { grades: [], attendance: [] }
    for (const m of progress?.messages || []) {
      if (groups[m.category]) groups[m.category].push(m)
    }
    return groups
  }, [progress])

  // Nulls stay null so a period with no data draws no bar at all, rather
  // than a zero-height one that would read as "scored nothing" (see the
  // missing-value handling in ColumnChart). One entry per grading period
  // that actually has an assessment — nothing here assumes three.
  const gradePoints = useMemo(() => (trend || []).map((p) => ({ label: p.periodName, value: p.averageGrade ?? null })), [trend])
  const attendancePoints = useMemo(
    () => (trend || []).map((p) => ({ label: p.periodName, value: p.attendanceRate ?? null })),
    [trend]
  )
  const gradeCount = gradePoints.filter((p) => p.value != null).length
  const attendanceCount = attendancePoints.filter((p) => p.value != null).length

  const trendSummary = useMemo(() => {
    if (!progress) return { label: '—', variant: undefined, icon: Minus }
    const t = progress.gradeTrend
    if (t == null) return { label: 'Not enough data', variant: undefined, icon: Minus }
    if (t >= 5) return { label: 'Improving', variant: 'positive', icon: TrendingUp }
    if (t <= -5) return { label: 'Declining', variant: 'negative', icon: TrendingDown }
    return { label: 'Steady', variant: 'info', icon: Minus }
  }, [progress])

  // Both thresholds come from the trend endpoint, which reads them from
  // config/riskConfig.js — nothing on this page writes either number down.
  // They drive the trend charts reference lines, their legends and their
  // recommendation sentences, and the explanation panels.
  const passingGrade = thresholds?.passingGrade ?? null
  const requiredAttendance = thresholds?.attendanceRate ?? null
  const attendanceThresholdText = requiredAttendance != null ? `${requiredAttendance}%` : '—'

  const BandIcon = progress ? BAND_ICONS[progress.band] : null
  const announcementPages = Math.max(Math.ceil(announcementTotal / ANNOUNCEMENTS_PAGE_SIZE), 1)

  function toggleStat(key) {
    setOpenStat((current) => (current === key ? null : key))
  }

  // Opening the banner's announcement means opening it in the panel below,
  // which is only guaranteed to hold the newest post on its first page.
  function handleBannerViewDetails(id) {
    setAnnouncementPage(1)
    setExpandedAnnouncementId(id)
  }

  if (loading) return <p>Loading your record…</p>
  if (error) return <Alert>{error}</Alert>
  if (!student) {
    return (
      <div className="empty-state">
        <p>No student record is linked to this account.</p>
        <p>Ask the registrar to connect your login to your student record.</p>
      </div>
    )
  }

  return (
    <div className="student-home">
      <Breadcrumbs items={[{ label: 'Home' }]} />

      {/* 1. The newest announcement, full width — the one thing on this page
          that is not about the student personally, so it sits above their
          record rather than competing with it. */}
      <AnnouncementBanner announcement={latestAnnouncement} onViewDetails={handleBannerViewDetails} />

      {/* 2. Standing context: which year, which period, am I enrolled. */}
      <ContextCardRow>
        <ContextCard
          icon={CalendarRange}
          label="Current School Year"
          value={currentPeriod?.schoolYearLabel || '—'}
          tone="primary"
        />
        <ContextCard icon={BookOpenCheck} label="Current Grading Period" value={currentPeriod?.name || '—'} tone="accent" />
        <ContextCard icon={BadgeCheck} label="Enrollment Status" value={humanize(student.enrollment_status)} tone="success" />
      </ContextCardRow>

      {/* 3. Who you are and how you are doing on the left, the school's
          noticeboard on the right. */}
      <div className="student-home__split">
        <div className="student-home__identity">
          {/* The namecard identifies, it does not re-print a form. A student
              already knows their own address and guardian's phone number;
              reprinting all of it just pushes the advice they came for down
              the page. */}
          <section className="namecard" ref={namecardRef}>
            <header className="namecard__bar">
              <h1>{formalName(student)}</h1>
              <span className="namecard__bar-meta">
                {[student.strand, student.section_name].filter(Boolean).join(' · ') || 'No section assigned'}
              </span>
            </header>
            <dl className="field-grid namecard__fields">
              <div>
                <dt>LRN</dt>
                <dd>{fieldValue(student.lrn)}</dd>
              </div>
              <div>
                <dt>Grade &amp; Section</dt>
                <dd>{student.section_name ? `Grade ${student.grade_level} – ${student.section_name}` : fieldValue(null)}</dd>
              </div>
              <div>
                <dt>Adviser</dt>
                <dd>{fieldValue(student.adviser_name)}</dd>
              </div>
              <div>
                <dt>Personal email</dt>
                <dd>{fieldValue(student.email)}</dd>
              </div>
            </dl>

            {/* The rest of what the school holds, behind a disclosure: a
                student rarely needs to re-read their own address, but they
                DO need a way to check it is right and spot what to ask the
                registrar to correct. Read-only by design — corrections go
                through the registrar, who owns the record. */}
            <div className="namecard__more">
              <button
                type="button"
                className="btn-subtle"
                onClick={() => setShowRecord((v) => !v)}
                aria-expanded={showRecord}
              >
                <IdCard size={14} strokeWidth={1.75} />
                {showRecord ? 'Hide record on file' : 'Your record on file'}
                {showRecord ? <ChevronUp size={14} strokeWidth={1.75} /> : <ChevronDown size={14} strokeWidth={1.75} />}
              </button>

              {showRecord && (
                <>
                  <dl className="field-grid namecard__fields">
                    <div>
                      <dt>Date of birth</dt>
                      <dd>{formatDate(student.date_of_birth)}</dd>
                    </div>
                    <div>
                      <dt>Sex</dt>
                      <dd>{fieldValue(humanize(student.sex))}</dd>
                    </div>
                    <div>
                      <dt>Address</dt>
                      <dd>{fieldValue(student.address)}</dd>
                    </div>
                    <div>
                      <dt>Guardian</dt>
                      <dd>{fieldValue(student.guardian_name)}</dd>
                    </div>
                    <div>
                      <dt>Guardian contact</dt>
                      <dd>{fieldValue(student.guardian_contact_number)}</dd>
                    </div>
                    <div>
                      <dt>Enrollment status</dt>
                      <dd>{humanize(student.enrollment_status)}</dd>
                    </div>
                  </dl>
                  <p className="form-note namecard__note">
                    Something wrong here? Ask the registrar to correct it — records are edited by the school, not from this
                    page.
                  </p>
                </>
              )}
            </div>
          </section>

          {progress && (
            <>
              {/* Each figure opens the arithmetic behind it. A number a
                  student cannot interrogate is one they can only take on
                  trust — and "why am I High Risk?" is the question this
                  page exists to answer. */}
              <StatRow compact>
                <StatCard
                  icon={GraduationCap}
                  value={
                    <>
                      {progress.averageGrade ?? '—'} <TrendIcon trend={progress.gradeTrend} />
                    </>
                  }
                  label="Average grade"
                  onClick={() => toggleStat('average')}
                  isExpanded={openStat === 'average'}
                  controls={STAT_EXPLAINER_ID}
                />
                <StatCard
                  icon={CalendarCheck}
                  value={
                    <>
                      {formatPercent(progress.attendanceRate)} <TrendIcon trend={progress.attendanceTrend} />
                    </>
                  }
                  label="Attendance rate"
                  onClick={() => toggleStat('attendance')}
                  isExpanded={openStat === 'attendance'}
                  controls={STAT_EXPLAINER_ID}
                />
                <StatCard
                  icon={trendSummary.icon}
                  value={trendSummary.label}
                  label="Grade trend"
                  variant={trendSummary.variant}
                  onClick={() => toggleStat('gradeTrend')}
                  isExpanded={openStat === 'gradeTrend'}
                  controls={STAT_EXPLAINER_ID}
                />
                <StatCard
                  icon={BandIcon || Activity}
                  value={progress.riskLevel ? RISK_LABELS[progress.riskLevel] : progress.bandLabel}
                  label={progress.riskLevel ? 'Risk level' : 'Standing'}
                  variant={
                    progress.riskLevel
                      ? RISK_VARIANTS[progress.riskLevel]
                      : progress.band === 'performing_well'
                        ? 'positive'
                        : 'info'
                  }
                  onClick={() => toggleStat('standing')}
                  isExpanded={openStat === 'standing'}
                  controls={STAT_EXPLAINER_ID}
                />
              </StatRow>

              {openStat && (
                <StatExplainer
                  id={STAT_EXPLAINER_ID}
                  statKey={openStat}
                  onClose={() => setOpenStat(null)}
                  grades={grades}
                  attendanceDetail={attendanceDetail}
                  trend={trend}
                  currentPeriodName={currentPeriod?.name}
                  passingGrade={passingGrade}
                  requiredAttendance={requiredAttendance}
                  averageGrade={progress.averageGrade}
                  attendanceRate={progress.attendanceRate}
                  gradeTrend={progress.gradeTrend}
                  checks={progress.checks}
                  levelsByTriggeredCount={progress.levelsByTriggeredCount}
                  bandLabel={progress.bandLabel}
                  riskLevelLabel={progress.riskLevel ? RISK_LABELS[progress.riskLevel] : null}
                />
              )}
            </>
          )}
        </div>

        <AnnouncementsPanel
          announcements={announcements}
          page={announcementPage}
          totalPages={announcementPages}
          onPageChange={setAnnouncementPage}
          expandedId={expandedAnnouncementId}
          onToggle={(id) => setExpandedAnnouncementId((current) => (current === id ? null : id))}
        />
      </div>

      {/* 4. Advice — the one card a flagged student actually needs. Flagged
          items and the concrete way out live together because they are the
          same conversation. */}
      {progress && (
        <section className="panel advice-card">
          <div className="advice-card__head">
            {BandIcon && <BandIcon size={22} strokeWidth={1.75} />}
            <h2>Where You Stand</h2>
            <StatusPill
              label={progress.riskLevel ? `${RISK_LABELS[progress.riskLevel]} Risk` : progress.bandLabel}
              variant={
                progress.riskLevel
                  ? RISK_VARIANTS[progress.riskLevel]
                  : progress.band === 'performing_well'
                    ? 'positive'
                    : 'neutral'
              }
            />
          </div>

          {/* Before any reading: every check the formula makes, and whether
              it is flagged. */}
          <CheckStrip checks={progress.checks} />

          {(messagesByCategory.grades.length > 0 || messagesByCategory.attendance.length > 0) && (
            <div className="advice-card__groups">
              {Object.entries(messagesByCategory).map(([category, entries]) =>
                entries.length === 0 ? null : (
                  <div key={category}>
                    <h3>{CATEGORY_LABELS[category]}</h3>
                    <ul>
                      {entries.map((m) => (
                        <li key={m.factorKey}>{m.message}</li>
                      ))}
                    </ul>
                  </div>
                )
              )}
            </div>
          )}

          {progress.note && <p className="advice-card__note">{progress.note}</p>}

          {progress.exitTargets?.length > 0 && (
            <div className="advice-card__targets">
              <h3>
                <Target size={16} strokeWidth={1.75} /> What would move you out of this band
              </h3>
              <p>
                {progress.exitTargets.length === 1
                  ? 'Reaching this would clear your current flag:'
                  : `You are flagged on ${progress.exitTargets.length} things. Clearing all of them moves you out of At Risk — each one you reach still lowers your risk level:`}
              </p>
              {/* A bar for the targets that are a position on a scale, so
                  the distance left to cover is visible rather than
                  arithmetic the reader has to do. */}
              {progress.exitTargets
                .filter((t) => TARGET_BAR_SCALES[t.factorKey])
                .map((t) => (
                  <TargetBar
                    key={t.factorKey}
                    label={t.measure}
                    current={t.current}
                    target={t.target}
                    {...TARGET_BAR_SCALES[t.factorKey]}
                  />
                ))}

              {/* The rest — the rate-of-change checks — stay as sentences.
                  The trend charts below show their shape over time. */}
              {progress.exitTargets.some((t) => !TARGET_BAR_SCALES[t.factorKey]) && (
                <ul>
                  {progress.exitTargets
                    .filter((t) => !TARGET_BAR_SCALES[t.factorKey])
                    .map((t) => (
                      <li key={t.factorKey}>
                        {t.text}
                        {t.currentText && <span className="advice-card__current"> — currently {t.currentText}</span>}
                      </li>
                    ))}
                </ul>
              )}
            </div>
          )}
        </section>
      )}

      {/* 5. Charts — the two trends side by side, subject comparison below.
          Bars, not lines, and on a full 0-100 axis: a bar states its value by
          LENGTH, so a cropped axis would make a 62 next to a 74 look like
          half the grade. Each bar is coloured by the same threshold its
          reference line is drawn at, so "below passing" is readable from
          position and from hue. */}
      <ChartCardRow>
        <ChartCard
          title="Grade Trend"
          description="Your average grade in each grading period, against the passing grade."
          legend={[
            { label: `At or above passing (${passingGrade ?? '—'})`, color: 'var(--chart-blue)' },
            { label: `Below passing (${passingGrade ?? '—'})`, color: 'var(--band-at-risk-high)' },
          ]}
          isEmpty={gradeCount === 0}
          emptyMessage="No finalized grades yet — your average appears once your adviser enters grades into the official record."
          interpretation={describeTrendAgainstThreshold(gradePoints, {
            subject: 'Your average',
            noun: 'points',
            threshold: passingGrade,
            thresholdLabel: `the passing grade of ${passingGrade}`,
          })}
        >
          <ColumnChart
            points={gradePoints}
            formatValue={(v) => String(Math.round(v * 10) / 10)}
            reference={
              passingGrade != null
                ? { value: passingGrade, label: `the passing grade of ${passingGrade}`, shortLabel: `Passing ${passingGrade}` }
                : null
            }
          />
        </ChartCard>

        <ChartCard
          title="Attendance Trend"
          description="Your attendance rate in each grading period, against the required rate."
          legend={[
            { label: `At or above required (${attendanceThresholdText})`, color: 'var(--chart-blue)' },
            { label: `Below required (${attendanceThresholdText})`, color: 'var(--band-at-risk-high)' },
          ]}
          isEmpty={attendanceCount === 0}
          emptyMessage="No attendance recorded yet — your rate appears once your adviser logs daily attendance."
          interpretation={describeTrendAgainstThreshold(attendancePoints, {
            subject: 'Your attendance',
            unit: '%',
            noun: 'points',
            threshold: requiredAttendance,
            thresholdLabel: `the required rate of ${attendanceThresholdText}`,
          })}
        >
          <ColumnChart
            points={attendancePoints}
            formatValue={formatPercent}
            reference={
              requiredAttendance != null
                ? {
                    value: requiredAttendance,
                    label: `the required rate of ${attendanceThresholdText}`,
                    shortLabel: `Required ${attendanceThresholdText}`,
                  }
                : null
            }
          />
        </ChartCard>
      </ChartCardRow>

      {/* 6. The detail lives on its own pages now — this is the pointer to
          it, so the overview still answers "where do I go for my marks?". */}
      <div className="record-section student-home__more">
        <Link to="/my-grades" className="student-home__more-link">
          <GraduationCap size={18} strokeWidth={1.75} />
          <span>
            <strong>My Grades</strong>
            <span>Every subject, every grading period, and your report card</span>
          </span>
          <ChevronRight size={16} strokeWidth={2} />
        </Link>
        <Link to="/my-attendance" className="student-home__more-link">
          <CalendarCheck size={18} strokeWidth={1.75} />
          <span>
            <strong>My Attendance</strong>
            <span>Your daily record, the month calendar, and attendance per subject</span>
          </span>
          <ChevronRight size={16} strokeWidth={2} />
        </Link>
      </div>

      {/* 7. Interventions */}
      <div className="record-section">
        <h2>Support Logged for You</h2>
        <DataTable
          columns={[
            { key: 'type', header: 'Type', render: (i) => INTERVENTION_TYPE_LABELS[i.interventionType] || i.interventionType },
            { key: 'logged', header: 'Date logged', render: (i) => formatDate(i.dateLogged) },
            {
              key: 'resolved',
              header: 'Resolved',
              // interventionModel.updateStatus keeps resolved_at when a closed
              // intervention is reopened, so the timestamp can outlive the
              // closure — only show it when the case is actually closed.
              render: (i) => (CLOSED_STATUSES.includes(i.status) ? formatDate(i.resolvedAt) : fieldValue(null)),
            },
            { key: 'notes', header: 'What was recommended', truncate: true, render: (i) => fieldValue(i.notes) },
            {
              key: 'status',
              header: 'Status',
              uniformValue: (i) => i.status,
              render: (i) => <StatusPill label={i.status} variant={INTERVENTION_STATUS_VARIANTS[i.status]} />,
            },
          ]}
          rows={interventions || []}
          rowKey={(i) => `${i.interventionType}-${i.dateLogged}`}
          emptyState={
            <>
              <p>No support has been logged for you.</p>
              <p>
                If your adviser or guidance counselor arranges something — a tutoring referral, a parent conference, an
                attendance follow-up — it will appear here with their notes.
              </p>
            </>
          }
        />
      </div>
    </div>
  )
}
