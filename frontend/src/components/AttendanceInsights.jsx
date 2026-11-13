import { CalendarClock, CalendarX2, Flame, MessageCircle } from 'lucide-react'
import { TargetBar } from './TargetBar'
import { rateOutlook, weekdaysRemaining, currentStreak, weekdayPattern } from '../utils/attendanceInsights'
import { todayDateString } from '../utils/dateUtils'

// "Where you stand" and "Your patterns" on the student's My Attendance.
//
// The page used to be figures, a table and a calendar: it said what had
// happened, and left the student to work out what it meant for them. These
// two sections answer the questions a learner actually brings to it —
// "am I OK?", "what do I need to do?", "is there a pattern?" and "who do I
// talk to?" — each from data the page already loaded, with the arithmetic in
// utils/attendanceInsights.js.
//
// Props:
//   summary            — this term: { periodName, rate, present, late, absent, total }
//   period             — the grading period row (for its end date), or null
//   requiredAttendance — the rate the risk formula checks (90 by default)
//   yearAttendance     — /students/:id/insights → attendance, or null
//   thresholds         — the same response's thresholds (12 / 9 absences)
//   records            — every daily record: [{ date, status }]
//   adviserName        — the adviser who takes the register, or null

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

function TermStanding({ summary, period, requiredAttendance }) {
  const attended = summary.present + summary.late
  const left = period?.end_date ? weekdaysRemaining(todayDateString(), period.end_date) : null
  const outlook = rateOutlook({ attended, total: summary.total, requiredPercent: requiredAttendance, weekdaysLeft: left })
  if (!outlook) return null

  let message
  if (outlook.status === 'meeting') {
    message =
      outlook.spare === 0
        ? `You're at the required ${requiredAttendance}%, with no room to spare — one more absence this term would take you below it.`
        : `You're above the required ${requiredAttendance}%. You could miss ${plural(outlook.spare, 'more day')} this term and still stay at or above it.`
  } else if (outlook.reachable) {
    message = `To get back to ${requiredAttendance}%, attend the next ${plural(outlook.needed, 'school day')} without missing one. Late still counts as attended.`
  } else {
    message = `${summary.periodName} has ${plural(left, 'weekday')} left, which isn't enough to reach ${requiredAttendance}% this term. Every day you attend still raises your rate, and next term starts fresh.`
  }

  return (
    <section className={`att-card${outlook.status === 'below' ? ' is-below' : ''}`} aria-labelledby="att-term">
      <h3 id="att-term">
        <CalendarClock size={18} strokeWidth={1.75} aria-hidden="true" />
        This term&apos;s attendance rate
      </h3>
      <TargetBar label={summary.periodName} current={summary.rate} target={requiredAttendance} unit="%" gapNoun="percentage points" />
      <p className="att-card__message">{message}</p>
      <p className="att-card__fine">
        Counted from {plural(summary.total, 'recorded school day')} this term. Present and Late count as attended;
        Absent and Excused count against the rate.
      </p>
    </section>
  )
}

function YearAbsences({ yearAttendance, thresholds }) {
  if (!yearAttendance || !thresholds) return null
  const alertAt = thresholds.ABSENCE_ALERT_DAYS
  const approachingAt = thresholds.ABSENCE_APPROACHING_DAYS
  const { absences, absent, excused, level } = yearAttendance
  const filled = Math.min(100, (absences / alertAt) * 100)
  const message =
    level === 'alert'
      ? `You've reached ${alertAt} absences this school year — the point where DepEd asks the school to follow up. Talk to your adviser about what is getting in the way.`
      : level === 'approaching'
        ? `You're getting close: ${plural(alertAt - absences, 'more absence')} would reach DepEd's mark of about ${alertAt} for the school year.`
        : absences === 0
          ? `No absences yet this school year.`
          : `You have ${plural(alertAt - absences, 'absence')} to spare before DepEd's mark of about ${alertAt} for the school year.`

  return (
    <section className={`att-card${level !== 'ok' ? ' is-below' : ''}`} aria-labelledby="att-year">
      <h3 id="att-year">
        <CalendarX2 size={18} strokeWidth={1.75} aria-hidden="true" />
        Absences this school year
      </h3>
      <div className="att-meter">
        <div className="att-meter__head">
          <span>So far</span>
          <span>
            <strong className={level !== 'ok' ? 'is-below' : undefined}>{absences}</strong> of about {alertAt}
          </span>
        </div>
        <div
          className="att-meter__track"
          role="meter"
          aria-valuemin={0}
          aria-valuemax={alertAt}
          aria-valuenow={Math.min(absences, alertAt)}
          aria-label={`${absences} absences this school year, of about ${alertAt}`}
        >
          <div className={`att-meter__fill is-${level}`} style={{ width: `${filled}%` }} />
          <div className="att-meter__mark" style={{ left: `${(approachingAt / alertAt) * 100}%` }} title={`Getting close from ${approachingAt}`} />
        </div>
      </div>
      <p className="att-card__message">{message}</p>
      <p className="att-card__fine">
        {plural(absent, 'day')} absent and {plural(excused, 'day')} excused — both count. DepEd Order No. 015, s. 2026
        (¶70) treats about {alertAt} absences in a school year as the point for a follow-up.
      </p>
    </section>
  )
}

function Patterns({ records }) {
  const streak = currentStreak(records)
  const pattern = weekdayPattern(records)

  return (
    <div className="att-patterns">
      <section className="att-card att-card--streak" aria-labelledby="att-streak">
        <h3 id="att-streak">
          <Flame size={18} strokeWidth={1.75} aria-hidden="true" />
          Current streak
        </h3>
        <p className="att-streak">
          <strong>{streak}</strong> {streak === 1 ? 'school day' : 'school days'} in a row
        </p>
        <p className="att-card__fine">
          {streak === 0
            ? 'Your most recent recorded day was an absence. Your streak starts again with the next day you attend.'
            : 'Counted back from your most recent recorded day. Being late still keeps the streak going.'}
        </p>
      </section>

      <section className="att-card" aria-labelledby="att-weekdays">
        <h3 id="att-weekdays">Which days you miss</h3>
        {pattern.totalMissed + pattern.totalLate === 0 ? (
          <p className="att-card__message">No absences or late days recorded — nothing to show here.</p>
        ) : (
          <>
            <ul className="att-weekdays" aria-label="Absences and late days by weekday">
              {pattern.days.map((d) => (
                <li key={d.name}>
                  <span className="att-weekdays__day">{d.short}</span>
                  {/* One dot per day, not a bar scaled to the busiest
                      weekday: with counts this small, a scaled bar made a
                      single absence fill the whole row. */}
                  <span className="att-weekdays__dots" aria-hidden="true">
                    {Array.from({ length: d.missed }, (_, k) => <span key={`m${k}`} className="att-dot att-dot--missed" />)}
                    {Array.from({ length: d.late }, (_, k) => <span key={`l${k}`} className="att-dot att-dot--late" />)}
                  </span>
                  <span className="att-weekdays__count">
                    {d.missed > 0 && `${d.missed} absent`}
                    {d.missed > 0 && d.late > 0 && ' · '}
                    {d.late > 0 && `${d.late} late`}
                    {d.missed === 0 && d.late === 0 && <span className="text-muted">—</span>}
                  </span>
                </li>
              ))}
            </ul>
            <p className="att-card__message">
              {pattern.highlight
                ? `${pattern.highlight.count} of your ${pattern.highlight.of} absences fell on a ${pattern.highlight.day}. If something keeps you away that day, it's worth telling your adviser.`
                : 'No single weekday stands out.'}
            </p>
          </>
        )}
      </section>
    </div>
  )
}

export function AttendanceInsights({ summary, period, requiredAttendance, yearAttendance, thresholds, records, adviserName }) {
  return (
    <>
      <div className="record-section">
        <h2>Where You Stand</h2>
        <div className="att-standing">
          {summary && <TermStanding summary={summary} period={period} requiredAttendance={requiredAttendance} />}
          <YearAbsences yearAttendance={yearAttendance} thresholds={thresholds} />
        </div>
      </div>

      {records && records.length > 0 && (
        <div className="record-section">
          <h2>Your Patterns</h2>
          <Patterns records={records} />
        </div>
      )}

      <p className="att-contact">
        <MessageCircle size={16} strokeWidth={1.75} aria-hidden="true" />
        {adviserName ? (
          <span>
            Your adviser, <strong>{adviserName}</strong>, takes this register. If a day is recorded wrong, or you were away
            for a reason, tell them so it can be corrected or marked excused.
          </span>
        ) : (
          <span>Your adviser takes this register. If a day is recorded wrong, tell them so it can be corrected.</span>
        )}
      </p>
    </>
  )
}
