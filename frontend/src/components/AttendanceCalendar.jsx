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
          return (
            <span
              key={dateStr}
              className={`attendance-calendar__cell${status ? ` is-${status}` : ''}`}
              title={status ? `${dateStr} — ${STATUS_LABEL[status]}` : dateStr}
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
