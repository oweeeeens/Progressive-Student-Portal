import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  GraduationCap,
  CalendarCheck,
  TrendingUp,
  TrendingDown,
  Minus,
  Activity,
  Award,
  ShieldAlert,
  Target,
  ChevronRight,
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
import { StudentHero } from '../components/StudentHero'
import { ChartCard, ChartCardRow } from '../components/charts/ChartCard'
import { ColumnChart } from '../components/charts/ColumnChart'
import { DataTable, fieldValue } from '../components/table/DataTable'
import { INTERVENTION_TYPE_LABELS, INTERVENTION_STATUS_VARIANTS } from '../components/InterventionDetailPanel'
import { describeTrendAgainstThreshold } from '../utils/chartInterpretation'
import './StudentHomePage.css'
import { Alert } from '../components/Alert'
import { LearnerInsights } from '../components/LearnerInsights'

const RISK_VARIANTS = { low: 'risk-low', medium: 'risk-medium', high: 'risk-high' }
const RISK_LABELS = { low: 'Low', medium: 'Medium', high: 'High' }
const BAND_ICONS = { at_risk: ShieldAlert, average: Activity, performing_well: Award }
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

// The student's ENTIRE portal, on one scrolling page: who they are, how they
// are doing, what to do about it, then the supporting detail. There is no
// student sub-navigation anywhere — this was once six routes behind two
// collapsible sidebar parents, which put the advice a flagged student most
// needs three clicks away from where they land. Nothing here is behind a
// click except the month calendar, which is simply too tall to sit open.
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
  const [attendanceDetail, setAttendanceDetail] = useState(null)
  const [interventions, setInterventions] = useState(null)
  const [grades, setGrades] = useState(null)
  const [currentPeriod, setCurrentPeriod] = useState(null)
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


  // One row per flagged thing, pairing each exit target with the advice for
  // the SAME factor. Both come from the same triggered-factor list on the
  // server (academicProgressCalculator), so they pair one-to-one — but the
  // join is written defensively anyway: a target with no message still
  // renders, and a message with no target is appended rather than dropped,
  // because silently losing advice is worse than an odd-looking row.
  const adviceRows = useMemo(() => {
    const messageFor = new Map((progress?.messages || []).map((m) => [m.factorKey, m.message]))
    const rows = (progress?.exitTargets || []).map((target) => ({
      factorKey: target.factorKey,
      target,
      scale: TARGET_BAR_SCALES[target.factorKey],
      message: messageFor.get(target.factorKey) || null,
    }))
    const covered = new Set(rows.map((r) => r.factorKey))
    for (const m of progress?.messages || []) {
      if (!covered.has(m.factorKey)) rows.push({ factorKey: m.factorKey, target: null, scale: null, message: m.message })
    }
    return rows.filter((r) => r.target || r.message)
  }, [progress])

  const hasAdvice = adviceRows.length > 0

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

  function toggleStat(key) {
    setOpenStat((current) => (current === key ? null : key))
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

      {/* 1. The student, and how they are doing. This page used to open with
          a banner and a row of context cards, which pushed the one thing a
          student comes here for below the fold. The record on file is further
          down now — it is reference, not the headline. */}
      <StudentHero
        student={student}
        progress={progress}
        currentPeriod={currentPeriod}
        riskLabels={RISK_LABELS}
        riskVariants={RISK_VARIANTS}
      />

      {/* 2. The four figures the whole page is about, full width.
          They used to sit in the left column of a split, sharing the row
          with the school's noticeboard. */}
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

          {/* WHO the advice above means.
                Every student-facing advisory in config/academicProgress.js
                says "talk to your adviser", and the page was telling a
                learner up to four times to go and see somebody it never
                named here. The name was on screen — but in "Your record on
                file", a separate panel much further down, which a learner
                has no reason to scroll to looking for a name nobody told
                them was there.

                Rendered only alongside advice, because that is what it
                answers: a learner with nothing flagged gets no "talk to
                your adviser" sentence and so needs no name beside it.
                Their adviser is still on the record panel below, as
                before — this adds a line, it does not move one.

                `student` arrives from a second request (GET /students/:id
                is the only call that joins adviser_name), so until it
                lands this renders nothing rather than making the advice
                wait on it. */}
          {hasAdvice && student && (
            <p className="advice-card__adviser">
                {student.adviser_name ? (
                  <>
                    Your adviser is <strong>{student.adviser_name}</strong>.
                  </>
                ) : (
                  // Deliberately not a dash. A dash would leave the advice
                  // sending a learner to see someone while the space where
                  // that person's name belongs sits empty — so this says
                  // the actionable version of the same fact instead.
                  <>Your section has no adviser assigned yet — ask the registrar who to speak to.</>
                )}
              </p>
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
              {/* ONE ROW PER FLAGGED THING, and this is the change that
                  matters here. The card used to make three separate passes
                  over the same four facts: a chip for each, then an advice
                  sentence for each, then a target for each. A learner
                  wanting to understand one problem had to find it in three
                  places, and the card was long not because it said much but
                  because it said the same four things three ways.

                  The advice now sits beside the target it is about, joined
                  on factorKey. The checks above stay — they are the summary,
                  and showing the cleared ones is how a student knows they
                  are flagged on four things out of four rather than four out
                  of twenty (see CheckStrip).

                  It also uses the width. TargetBar caps itself at 44rem
                  because a bar wider than that is hard to read against its
                  marker — which left most of the card empty to the right of
                  every bar. That space now carries the sentence. */}
              {adviceRows.map((row) => (
                <div className="advice-issue" key={row.factorKey}>
                  <div className="advice-issue__target">
                    {row.scale ? (
                      <TargetBar
                        label={row.target.measure}
                        current={row.target.current}
                        target={row.target.target}
                        {...row.scale}
                      />
                    ) : (
                      /* A rate of change has no honest position on a fixed
                         scale, so it keeps its sentence rather than being
                         forced into a bar with an invented axis — the same
                         rule TargetBar's own header states. */
                      <div className="advice-issue__trend">
                        <span className="advice-issue__measure">{row.target.measure}</span>
                        <p>
                          {row.target.text}
                          {row.target.currentText && (
                            <span className="advice-card__current"> — currently {row.target.currentText}</span>
                          )}
                        </p>
                      </div>
                    )}
                  </div>
                  {row.message && <p className="advice-issue__action">{row.message}</p>}
                </div>
              ))}
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
            <span>Every subject, every grading period</span>
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

      {/* 5b. Analytics for this one learner, addressed to them: their outlook,
          subjects, strongest and weakest components, this term so far, and
          absences (components/LearnerInsights.jsx, DO 015 ¶67/¶68/¶70). */}
      {student && (
        <section className="record-section">
          <h2>How You&apos;re Doing</h2>
          <LearnerInsights studentId={student.id} audience="learner" />
        </section>
      )}

      {/* 6. Reference: the record the school holds. It was above the fold
          before, which put a student's own guardian contact number ahead of
          the advice they came here for. */}
      <div className="student-home__split">
        <div className="student-home__identity">
          {/* The namecard identifies, it does not re-print a form. A student
              already knows their own address and guardian's phone number;
              reprinting all of it just pushes the advice they came for down
              the page. */}
          <section className="namecard">
            {/* No name bar here: the hero at the top of the page already
                says whose record this is, and printing it again two blocks
                later read as a second page starting. */}
            <header className="namecard__bar namecard__bar--quiet">
              <h2>Your record on file</h2>
              <span className="namecard__bar-meta">Held by the school</span>
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

            {/* The rest of the record (birth date, address, guardian,
                classes) lives on its own page, My Record — it was a
                disclosure here, at the very bottom of the page, where
                almost nobody found it. */}
            <div className="namecard__more">
              <Link to="/my-record" className="btn-subtle">
                <IdCard size={14} strokeWidth={1.75} />
                View your full record
              </Link>
            </div>
          </section>
        </div>

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
