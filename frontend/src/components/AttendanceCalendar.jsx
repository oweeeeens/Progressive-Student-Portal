import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

const STATUS_LABEL = { present: 'Present', absent: 'Absent', late: 'Late', excused: 'Excused' }
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function pad(n) {
  return String(n).padStart(2, '0')
}

function buildMonthCells(year, month) {
  // month is 0-indexed
  const startOffset = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells = Array(startOffset).fill(null)
  for (let day = 1; day <= daysInMonth; day++) cells.push(day)
  return cells
}

function todayDateStr() {
  const now = new Date()
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

// `records`: [{ date: 'YYYY-MM-DD', status: 'present'|'absent'|'late'|'excused' }].
// Colors reuse the app's general success/danger/warning/neutral tokens —
// deliberately NOT the risk-level tokens, which CLAUDE.md reserves for
// actual risk indicators only, even where the hues happen to look similar.
export function AttendanceCalendar({ records }) {
  const recordsByDate = useMemo(() => {
    const map = {}
    for (const r of records) map[r.date] = r.status
    return map
  }, [records])

  const initialMonth = useMemo(() => {
    if (records.length === 0) return new Date()
    const latest = records.reduce((max, r) => (r.date > max ? r.date : max), records[0].date)
    return new Date(`${latest}T00:00:00`)
  }, [records])

  const [viewDate, setViewDate] = useState(initialMonth)
  const year = viewDate.getFullYear()
  const month = viewDate.getMonth()
  const cells = buildMonthCells(year, month)
  const todayStr = todayDateStr()

  // The summary pills above this calendar (AttendanceHistory.jsx) total the
  // whole selected grading period, which can span more than one calendar
  // month — without this, a viewer looking at just one month of that period
  // sees numbers that look like they don't add up against the pills, when
  // they're actually just a narrower slice of the same period. This tally
  // makes what's actually on screen self-explanatory on its own.
  const monthTally = useMemo(() => {
    const prefix = `${year}-${pad(month + 1)}-`
    const inMonth = records.filter((r) => r.date.startsWith(prefix))
    return {
      present: inMonth.filter((r) => r.status === 'present').length,
      absent: inMonth.filter((r) => r.status === 'absent').length,
      late: inMonth.filter((r) => r.status === 'late').length,
      excused: inMonth.filter((r) => r.status === 'excused').length,
    }
  }, [records, year, month])
  const monthTallyText = Object.entries(monthTally)
    .filter(([, count]) => count > 0)
    .map(([status, count]) => `${count} ${STATUS_LABEL[status].toLowerCase()}`)
    .join(', ')

  function changeMonth(delta) {
    setViewDate(new Date(year, month + delta, 1))
  }

  return (
    <div className="attendance-calendar">
      <div className="attendance-calendar__header">
        <button type="button" onClick={() => changeMonth(-1)} aria-label="Previous month">
          <ChevronLeft size={16} strokeWidth={1.75} />
        </button>
        <strong>{viewDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</strong>
        <button type="button" onClick={() => changeMonth(1)} aria-label="Next month">
          <ChevronRight size={16} strokeWidth={1.75} />
        </button>
      </div>

      <p className="attendance-calendar__month-tally">
        {monthTallyText ? `This month: ${monthTallyText}` : 'No records this month'}
      </p>

      <div className="attendance-calendar__weekdays">
        {WEEKDAY_LABELS.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>

      <div className="attendance-calendar__grid">
        {cells.map((day, index) => {
          if (day === null) {
            return <span key={`empty-${index}`} className="attendance-calendar__cell attendance-calendar__cell--empty" />
          }
          const dateStr = `${year}-${pad(month + 1)}-${pad(day)}`
          const status = recordsByDate[dateStr]
          // Weekend and "no data" are two different things, not one muted
          // look for both — a weekend isn't a school day at all (dimmed,
          // non-interactive), while an unrecorded weekday is a real gap
          // worth noticing (same neutral weight as any other cell, just no
          // status color). DepEd's school week is Mon-Fri; this app has no
          // separate holiday calendar, so Sat/Sun is the only "not a school
          // day" signal available.
          const dayOfWeek = new Date(year, month, day).getDay()
          const isWeekend = dayOfWeek === 0 || dayOfWeek === 6
          const isToday = dateStr === todayStr
          const classNames = ['attendance-calendar__cell']
          if (status) classNames.push(`is-${status}`)
          else if (isWeekend) classNames.push('is-weekend')
          if (isToday) classNames.push('is-today')
          return (
            <span
              key={dateStr}
              className={classNames.join(' ')}
              title={status ? `${dateStr} — ${STATUS_LABEL[status]}` : isWeekend ? `${dateStr} — Weekend` : `${dateStr} — No record`}
            >
              {day}
            </span>
          )
        })}
      </div>

      <div className="attendance-calendar__legend">
        {Object.entries(STATUS_LABEL).map(([key, label]) => (
          <span key={key} className="attendance-calendar__legend-item">
            <span className={`attendance-calendar__dot is-${key}`} /> {label}
          </span>
        ))}
      </div>
    </div>
  )
}
