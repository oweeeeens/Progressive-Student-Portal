import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, ChevronDown, ChevronUp, CalendarCheck, CircleCheck, CircleX, Clock } from 'lucide-react'
import { api } from '../api/client'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { Alert } from '../components/Alert'
import { StatCard, StatRow } from '../components/StatCard'
import { AttendanceStatExplainer } from '../components/AttendanceStatExplainer'
import { DataTable } from '../components/table/DataTable'
import { AttendanceCalendar } from '../components/AttendanceCalendar'
import { useOwnStudentRecord } from '../hooks/useOwnStudentRecord'
import { humanize } from '../utils/humanize'
import { formatRegisterDate } from '../utils/dateUtils'
import { StatusPill } from '../components/StatusPill'
import { AttendanceInsights } from '../components/AttendanceInsights'
import './StudentAttendancePage.css'

// The student's attendance, on its own page: the official daily (SF2) record
// per grading period and the month calendar. This is the figure the school
// reports on and the one the risk formula reads (CLAUDE.md). A separate
// per-subject record was shown here until subject-level attendance was
// removed on 2026-11-11 to keep the System to its title.

// The same status colours the staff Attendance tab uses (AttendanceHistory).
const STATUS_VARIANTS = { present: 'positive', late: 'warning', absent: 'negative', excused: 'neutral' }
// One panel serves all four figures, so one id covers every card's
// aria-controls — they all point at the same region.
const ATTENDANCE_EXPLAINER_ID = 'attendance-stat-explainer'

// "1 Days present" is the kind of detail that makes a page look unfinished.
function dayWord(count) {
  return count === 1 ? 'Day' : 'Days'
}

export function StudentAttendancePage() {
  const { student, loading: loadingStudent, error: studentError } = useOwnStudentRecord()
  const [attendanceDetail, setAttendanceDetail] = useState(null)
  const [requiredAttendance, setRequiredAttendance] = useState(null)
  // Every daily record on file (newest first), feeding both the calendar and
  // the list of missed days beside it.
  const [dailyRecords, setDailyRecords] = useState(null)
  // Open by default: this is the attendance page, and a month grid of
  // colour-coded days is the clearest thing on it. It was behind a click
  // only because it used to share the home page with everything else.
  const [showCalendar, setShowCalendar] = useState(true)
  // Which figure is currently explaining itself, or null.
  const [openStat, setOpenStat] = useState(null)
  // The grading periods, for their date ranges: they are what turns "3 days
  // absent" into the three actual days.
  const [gradingPeriods, setGradingPeriods] = useState([])
  const [error, setError] = useState(null)
  // { attendance, thresholds } for the school year, or null.
  const [yearInsights, setYearInsights] = useState(null)

  useEffect(() => {
    Promise.all([api.get('/my-progress/attendance-detail'), api.get('/my-progress/trend')])
      .then(([daily, trend]) => {
        setAttendanceDetail(daily.periods)
        // The required rate travels with the data, from the same risk config
        // the formula checks — never written down in the frontend.
        setRequiredAttendance(trend.attendanceThreshold ?? null)
      })
      .catch((err) => {
        setError(err.message)
        // A failed request is not an empty record: resolve the list so the
        // table stops saying "loading" and says what actually happened.
        setAttendanceDetail([])
      })
  }, [])

  useEffect(() => {
    api
      .get('/grading-periods')
      .then((data) => setGradingPeriods(data.gradingPeriods))
      .catch(() => setGradingPeriods([]))
  }, [])

  // The day-by-day records behind the calendar need the student's id.
  useEffect(() => {
    if (!student) return
    api
      .get(`/students/${student.id}/attendance/daily`)
      .then((data) => setDailyRecords(data.records))
      .catch((err) => setError(err.message))
    // This school year's absences against DepEd's ~12-absence mark, from the
    // same endpoint (and the same counting) as the learner's insights.
    // Optional: if it fails, "Where you stand" simply shows the term card.
    api
      .get(`/students/${student.id}/insights`)
      .then((data) => setYearInsights({ attendance: data.attendance, thresholds: data.thresholds }))
      .catch(() => setYearInsights(null))
  }, [student])

  // Reshaped once per data change, not every render: AttendanceCalendar
  // memoizes on this array's identity.
  const calendarRecords = useMemo(
    () => (dailyRecords ? dailyRecords.map((r) => ({ date: r.attendance_date, status: r.status })) : null),
    [dailyRecords]
  )
  const missedDays = useMemo(() => (dailyRecords || []).filter((r) => r.status !== 'present'), [dailyRecords])

  // The page's headline figures, from the most recent grading period that
  // has any attendance — the same "latest period with data" rule the rest of
  // the student view uses, so a gap between periods never blanks the page.
  const summary = useMemo(() => {
    const rows = (attendanceDetail || []).filter((p) => p.totalDays > 0)
    if (rows.length === 0) return null
    const period = rows[rows.length - 1]
    const attended = period.present + period.late
    return {
      periodName: period.periodName,
      // "Present" counts late too — the student did attend — which is the
      // same rule the server applies when it works out the rate the risk
      // formula reads.
      rate: Math.round((attended / period.totalDays) * 1000) / 10,
      present: period.present,
      absent: period.absent,
      late: period.late,
      total: period.totalDays,
    }
  }, [attendanceDetail])

  const summaryPeriod = summary ? gradingPeriods.find((p) => p.name === summary.periodName) || { name: summary.periodName } : null

  function toggleStat(key) {
    setOpenStat((current) => (current === key ? null : key))
  }

  if (loadingStudent) return <p>Loading your attendance…</p>
  if (studentError) return <Alert>{studentError}</Alert>
  if (!student) {
    return (
      <div className="empty-state">
        <p>No student record is linked to this account.</p>
        <p>Ask the registrar to connect your login to your student record.</p>
      </div>
    )
  }

  return (
    <div className="student-attendance">
      <Breadcrumbs items={[{ label: 'Home', to: '/' }, { label: 'My Attendance' }]} />
      <div className="page-header">
        <h1>My Attendance</h1>
      </div>

      {error && <Alert>{error}</Alert>}

      {summary && (
        <>
          {/* Each figure opens its own working, the same way the home and
              grades pages do. For the three day counts the working is the
              days themselves — a count can only be believed, a list of
              dates can be checked. */}
          <StatRow>
            <StatCard
              icon={CalendarCheck}
              value={`${summary.rate}%`}
              label={`Attendance rate · ${summary.periodName}`}
              variant={requiredAttendance != null && summary.rate < requiredAttendance ? 'negative' : 'positive'}
              onClick={() => toggleStat('rate')}
              isExpanded={openStat === 'rate'}
              controls={ATTENDANCE_EXPLAINER_ID}
            />
            <StatCard
              icon={CircleCheck}
              value={summary.present}
              label={`${dayWord(summary.present)} present · ${summary.periodName}`}
              variant="positive"
              onClick={() => toggleStat('present')}
              isExpanded={openStat === 'present'}
              controls={ATTENDANCE_EXPLAINER_ID}
            />
            <StatCard
              icon={CircleX}
              value={summary.absent}
              label={`${dayWord(summary.absent)} absent · ${summary.periodName}`}
              variant={summary.absent > 0 ? 'negative' : undefined}
              onClick={() => toggleStat('absent')}
              isExpanded={openStat === 'absent'}
              controls={ATTENDANCE_EXPLAINER_ID}
            />
            <StatCard
              icon={Clock}
              value={summary.late}
              label={`${dayWord(summary.late)} late · ${summary.periodName}`}
              variant={summary.late > 0 ? 'warning' : undefined}
              onClick={() => toggleStat('late')}
              isExpanded={openStat === 'late'}
              controls={ATTENDANCE_EXPLAINER_ID}
            />
          </StatRow>

          {openStat && (
            <AttendanceStatExplainer
              id={ATTENDANCE_EXPLAINER_ID}
              statKey={openStat}
              period={summaryPeriod}
              summary={summary}
              records={calendarRecords}
              requiredAttendance={requiredAttendance}
              attendanceDetail={attendanceDetail}
              onClose={() => setOpenStat(null)}
            />
          )}
        </>
      )}

      {/* What the figures mean for this learner: how far from the required
          rate, what it takes to get there, this year's absences against
          DepEd's mark, their streak and weekday pattern, and who to ask. */}
      {(summary || yearInsights) && (
        <AttendanceInsights
          summary={summary}
          period={summaryPeriod}
          requiredAttendance={requiredAttendance}
          yearAttendance={yearInsights?.attendance}
          thresholds={yearInsights?.thresholds}
          records={calendarRecords}
          adviserName={student.adviser_name}
        />
      )}

      <div className="record-section">
        <div className="record-section__header-row">
          <h2>Daily Attendance</h2>
          <button type="button" className="btn-subtle" onClick={() => setShowCalendar((v) => !v)} aria-expanded={showCalendar}>
            <CalendarDays size={14} strokeWidth={1.75} />
            {showCalendar ? 'Hide calendar' : 'View calendar'}
            {showCalendar ? <ChevronUp size={14} strokeWidth={1.75} /> : <ChevronDown size={14} strokeWidth={1.75} />}
          </button>
        </div>
        <p className="record-section__note">
          Taken by your adviser each morning. This is the official record the school reports on, and the one your
          attendance rate is worked out from.
        </p>

        <DataTable illustration="calendar"
          columns={[
            { key: 'period', header: 'Grading Period', render: (p) => p.periodName },
            { key: 'present', header: 'Present', align: 'right', render: (p) => p.present },
            { key: 'absent', header: 'Absent', align: 'right', render: (p) => p.absent },
            { key: 'late', header: 'Late', align: 'right', render: (p) => p.late },
            { key: 'excused', header: 'Excused', align: 'right', render: (p) => p.excused },
            { key: 'total', header: 'Total Days', align: 'right', render: (p) => <strong>{p.totalDays}</strong> },
            // Each term's own rate, by the same rule as the figures above
            // (Present and Late attended), so terms can be compared at a
            // glance instead of by dividing in your head.
            {
              key: 'rate',
              header: 'Rate',
              align: 'right',
              render: (p) => {
                if (!p.totalDays) return <span className="grade-cell__empty">—</span>
                const rate = Math.round(((p.present + p.late) / p.totalDays) * 1000) / 10
                const below = requiredAttendance != null && rate < requiredAttendance
                return <strong className={below ? 'is-below' : undefined}>{rate}%</strong>
              },
            },
          ]}
          rows={attendanceDetail || []}
          rowKey={(p) => p.periodName}
          error={error}
          emptyState={
            <>
              <p>No attendance recorded yet.</p>
              <p>Your daily attendance appears here once it has been taken.</p>
            </>
          }
        />

        {showCalendar && (
          <div className="panel mt-4">
            {calendarRecords && calendarRecords.length > 0 ? (
              // The compact month beside the days that need explaining. The
              // calendar carries its own status legend, so none is repeated
              // under it (there used to be two).
              <div className="attendance-split">
                <AttendanceCalendar records={calendarRecords} />
                <div className="attendance-split__aside">
                  <h3>Days you missed or were late</h3>
                  {missedDays.length === 0 ? (
                    <p className="attendance-split__note">None so far — every recorded day was present.</p>
                  ) : (
                    <ul className="attendance-split__list">
                      {missedDays.map((r) => (
                        <li key={r.id}>
                          <span>
                            {formatRegisterDate(r.attendance_date)}
                            {r.notes && <span className="attendance-split__note">{r.notes}</span>}
                          </span>
                          <StatusPill label={humanize(r.status)} variant={STATUS_VARIANTS[r.status]} />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ) : (
              <p className="form-note">No daily attendance has been recorded yet.</p>
            )}
          </div>
        )}
      </div>

    </div>
  )
}
