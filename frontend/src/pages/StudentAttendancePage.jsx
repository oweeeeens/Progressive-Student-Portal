import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, ChevronDown, ChevronUp, CalendarCheck, CircleCheck, CircleX, Clock } from 'lucide-react'
import { api } from '../api/client'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { Alert } from '../components/Alert'
import { StatCard, StatRow } from '../components/StatCard'
import { AttendanceStatExplainer } from '../components/AttendanceStatExplainer'
import { DataTable } from '../components/table/DataTable'
import { AttendanceCalendar } from '../components/AttendanceCalendar'
import { InlineRateBar } from '../components/InlineRateBar'
import { useOwnStudentRecord } from '../hooks/useOwnStudentRecord'
import { humanize } from '../utils/humanize'

// The student's attendance, on its own page: the official daily record per
// grading period, the month calendar behind a toggle, and the separate
// per-subject record their subject teachers keep.
//
// Both records are shown because they answer different questions and will
// legitimately disagree — the daily homeroom record is the SF2 figure the
// school reports on and the only one the risk formula reads (CLAUDE.md),
// while the subject record is what tells a student which particular class
// they are missing.

const ATTENDANCE_STATUSES = ['present', 'late', 'absent', 'excused']
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
  const [subjectAttendance, setSubjectAttendance] = useState(null)
  const [requiredAttendance, setRequiredAttendance] = useState(null)
  const [calendarRecords, setCalendarRecords] = useState(null)
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

  useEffect(() => {
    Promise.all([api.get('/my-progress/attendance-detail'), api.get('/my-progress/subject-attendance')])
      .then(([daily, bySubject]) => {
        setAttendanceDetail(daily.periods)
        setSubjectAttendance(bySubject.subjects)
        // The required rate travels with the data, from the same risk config
        // the formula checks — never written down in the frontend.
        setRequiredAttendance(bySubject.attendanceThreshold ?? null)
      })
      .catch((err) => {
        setError(err.message)
        // A failed request is not an empty record: resolve both lists so the
        // tables stop saying "loading" and say what actually happened.
        setAttendanceDetail([])
        setSubjectAttendance([])
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
      .then((data) => setCalendarRecords(data.records.map((r) => ({ date: r.attendance_date, status: r.status }))))
      .catch((err) => setError(err.message))
  }, [student])

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
    <div>
      <Breadcrumbs items={[{ label: 'Home', to: '/' }, { label: 'My Attendance' }]} />
      <h1>My Attendance</h1>

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
          <div className="panel" style={{ marginTop: 'var(--space-4)' }}>
            {calendarRecords && calendarRecords.length > 0 ? (
              <AttendanceCalendar records={calendarRecords} />
            ) : (
              <p className="form-note">No daily attendance has been recorded yet.</p>
            )}
            <div className="chart-legend" style={{ marginTop: 'var(--space-3)' }}>
              {ATTENDANCE_STATUSES.map((status) => (
                <span key={status} className="chart-legend__item">
                  <span className={`attendance-calendar__dot is-${status}`} />
                  {humanize(status)}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="record-section">
        <h2>Attendance by Subject</h2>
        <p className="record-section__note">
          Taken by each subject teacher for their own class. These counts can differ from the daily record above — you can
          be marked present in homeroom and still miss a subject period.
        </p>
        <DataTable illustration="calendar"
          columns={[
            {
              key: 'subject',
              header: 'Subject',
              render: (s) => (
                <>
                  <span className="cell-primary">{s.subjectName}</span>
                  <span className="cell-secondary">{s.teacherName}</span>
                </>
              ),
            },
            { key: 'present', header: 'Present', align: 'right', render: (s) => s.present },
            { key: 'absent', header: 'Absent', align: 'right', render: (s) => s.absent },
            { key: 'late', header: 'Late', align: 'right', render: (s) => s.late },
            { key: 'excused', header: 'Excused', align: 'right', render: (s) => s.excused },
            { key: 'sessions', header: 'Sessions', align: 'right', render: (s) => s.totalSessions },
            {
              key: 'rate',
              header: 'Rate',
              align: 'right',
              // The bar is the column: the number alone makes 25% and 87.5%
              // look like the same amount of text, and neither shows how far
              // either sits from the required line.
              render: (s) => <InlineRateBar value={s.attendanceRate} required={requiredAttendance} />,
            },
          ]}
          rows={subjectAttendance || []}
          rowKey={(s) => s.subjectName}
          error={error}
          legend={
            requiredAttendance != null
              ? `Rates below the required ${requiredAttendance}% are shown in red. Arriving late still counts as attending.`
              : null
          }
          emptyState={
            <>
              <p>No subject attendance recorded yet.</p>
              <p>This fills in as each of your subject teachers takes attendance for their class.</p>
            </>
          }
        />
      </div>
    </div>
  )
}
