import { ExplainerPanel } from './ExplainerPanel'
import { explainAttendance } from './StatExplainer'

// Why each figure at the top of My Attendance says what it says.
//
// The rate's explanation is imported rather than rewritten: the same figure
// appears on the home page, and two pages explaining one number in two
// slightly different ways is how a product starts contradicting itself.
//
// The three day counts explain themselves differently — not with arithmetic,
// but with the days themselves. "3 days absent" is a number a student can
// only accept or dispute; "Mon 21 Sep, Tue 22 Sep, Thu 24 Sep" is something
// they can actually check against what they remember, and take to their
// adviser if it is wrong.

// How many days to print before summarising. A term's worth of present days
// is a wall of text nobody reads; the absences that matter are almost always
// far fewer than this.
const MAX_DAYS_LISTED = 15

const STATUS_LABELS = { present: 'present', absent: 'absent', late: 'late' }

// Dates arrive as plain YYYY-MM-DD strings, so they are built into a local
// date explicitly — passing the string to new Date() would read it as UTC
// and shift the day backwards for anyone east of Greenwich, which is every
// user of this system.
function formatDay(isoDate) {
  const [year, month, day] = isoDate.split('T')[0].split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
}

export function AttendanceStatExplainer({
  statKey,
  period,
  summary,
  records,
  requiredAttendance,
  attendanceDetail,
  onClose,
  id,
}) {
  if (statKey === 'rate') {
    const content = explainAttendance({
      attendanceDetail,
      currentPeriodName: period?.name,
      requiredAttendance,
      attendanceRate: summary?.rate,
    })
    if (!content) return null
    return (
      <ExplainerPanel id={id} title={content.title} subtitle={content.subtitle} onClose={onClose}>
        {content.body}
      </ExplainerPanel>
    )
  }

  const statusLabel = STATUS_LABELS[statKey]
  if (!statusLabel) return null

  // Only the days inside this grading period, so the list matches the count
  // on the card above it. A period with no dates configured in Academic
  // Setup can't be bounded, so every recorded day is shown and the panel
  // says so rather than quietly listing the wrong ones.
  const hasRange = Boolean(period?.start_date && period?.end_date)
  const days = (records || [])
    .filter((r) => r.status === statKey)
    .filter((r) => !hasRange || (r.date >= period.start_date && r.date <= period.end_date))
    .map((r) => r.date)
    .sort()

  const shown = days.slice(0, MAX_DAYS_LISTED)
  const remaining = days.length - shown.length

  return (
    <ExplainerPanel
      id={id}
      title={`Days ${statusLabel}`}
      subtitle={period?.name ? `${period.name} · ${days.length}` : String(days.length)}
      onClose={onClose}
    >
      {days.length === 0 ? (
        <p className="stat-explainer__lead">
          No days recorded as {statusLabel}
          {period?.name ? ` in ${period.name}` : ''}.
        </p>
      ) : (
        <>
          <ul className={`day-list day-list--${statKey}`}>
            {shown.map((date) => (
              <li key={date}>{formatDay(date)}</li>
            ))}
          </ul>
          {remaining > 0 && <p className="stat-explainer__rule">…and {remaining} more.</p>}
        </>
      )}

      <p className="stat-explainer__rule">
        {statKey === 'late'
          ? 'A late day still counts as attending when your rate is worked out — it is listed here so you can see it.'
          : statKey === 'absent'
            ? 'Every absence counts against your rate, excused or not, because the class time is missed either way.'
            : 'Days your adviser marked you present in homeroom.'}
        {!hasRange && ' This grading period has no dates set in Academic Setup, so every recorded day is listed.'}
      </p>
      <p className="stat-explainer__rule">
        If a day here looks wrong, your adviser keeps this record — ask them to check it.
      </p>
    </ExplainerPanel>
  )
}
