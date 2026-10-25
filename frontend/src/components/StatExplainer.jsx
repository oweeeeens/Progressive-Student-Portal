import { Check, AlertTriangle } from 'lucide-react'
import { ExplainerPanel } from './ExplainerPanel'

// U+2212. The arithmetic on this panel is written with it, so the signed
// figures have to be too.
const MINUS = '\u2212'

// "Why is my average 62?" — the panel that opens under the student's
// headline figures and shows the arithmetic behind whichever one they
// clicked, in the same terms the risk engine actually uses.
//
// This exists because a portal that only displays four numbers asks a
// student to trust them. Every figure here is recomputed from the SAME data
// the page already fetched (their finalized marks, their attendance counts,
// their period-by-period history), never from a second source, so the
// explanation can't drift from the number it explains. The thresholds and
// rules are quoted from what the server sent (which reads
// backend/config/riskConfig.js), never written down in this file.
//
// It is also the clearest answer to "how does your risk formula work?" that
// the system can give — the formula explaining itself, to the person it is
// about, in their own numbers.

// Rounds the way the rest of the page does, so a figure shown here is
// identical to the same figure in a chart or a table.
function round1(value) {
  return Math.round(value * 10) / 10
}

// A signed figure, using the typographic minus the arithmetic beside it
// uses — a hyphen next to a real minus on the same panel reads as a
// different character for the same operation.
function formatSigned(value) {
  if (value > 0) return `+${value}`
  if (value < 0) return `${MINUS}${Math.abs(value)}`
  return String(value)
}

// The period a figure belongs to: today's grading period when it has data,
// otherwise the most recent one that does. Without this fallback the panel
// would say "nothing recorded" during the gap between periods, while the
// tile above it still showed last period's number.
function resolvePeriod(preferredName, available) {
  if (preferredName && available.includes(preferredName)) return preferredName
  return available.length > 0 ? available[available.length - 1] : null
}

function CalcRow({ label, value, isTotal = false }) {
  return (
    <div className={`stat-explainer__row${isTotal ? ' is-total' : ''}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  )
}

// --- one builder per figure --------------------------------------------------
// Each returns { title, subtitle, body } or null when there is nothing to
// explain yet. Kept as plain functions rather than four components so the
// panel's chrome is written once.

function explainAverage({ grades, currentPeriodName, passingGrade, averageGrade }) {
  const finalized = (grades || []).filter((g) => g.status === 'finalized')
  const periods = [...new Set(finalized.map((g) => g.grading_period_name))].reverse()
  const periodName = resolvePeriod(currentPeriodName, periods)
  const marks = finalized.filter((g) => g.grading_period_name === periodName)

  if (marks.length === 0) {
    return {
      title: 'Average grade',
      body: (
        <p>
          No finalized marks yet, so there is no average to work out. A mark counts once your adviser has entered it into
          the official record.
        </p>
      ),
    }
  }

  const total = marks.reduce((sum, g) => sum + Number(g.grade_value), 0)
  const average = round1(total / marks.length)

  return {
    title: 'Average grade',
    subtitle: `${periodName} · ${averageGrade ?? average}`,
    body: (
      <>
        <div className="stat-explainer__calc">
          {marks.map((g) => (
            <CalcRow key={g.id} label={g.subject_name} value={round1(Number(g.grade_value))} />
          ))}
          <CalcRow
            label={`${round1(total)} ÷ ${marks.length} ${marks.length === 1 ? 'subject' : 'subjects'}`}
            value={average}
            isTotal
          />
        </div>
        <p className="stat-explainer__rule">
          Only finalized marks count towards it — a mark still in review is left out until your adviser enters it into the
          official record.
          {passingGrade != null &&
            (average < passingGrade
              ? ` The passing grade is ${passingGrade}, so this is ${round1(passingGrade - average)} points below it.`
              : ` The passing grade is ${passingGrade}, so this is ${round1(average - passingGrade)} points clear of it.`)}
        </p>
      </>
    ),
  }
}

export function explainAttendance({ attendanceDetail, currentPeriodName, requiredAttendance, attendanceRate }) {
  const rows = attendanceDetail || []
  const periodName = resolvePeriod(
    currentPeriodName,
    rows.map((r) => r.periodName)
  )
  const row = rows.find((r) => r.periodName === periodName)

  if (!row || row.totalDays === 0) {
    return {
      title: 'Attendance rate',
      body: <p>No attendance has been recorded for you yet, so there is no rate to work out.</p>,
    }
  }

  const attended = row.present + row.late
  const rate = round1((attended / row.totalDays) * 100)

  return {
    title: 'Attendance rate',
    subtitle: `${periodName} · ${attendanceRate ?? rate}%`,
    body: (
      <>
        <div className="stat-explainer__calc">
          <CalcRow label="Present" value={row.present} />
          <CalcRow label="Late (still counts as attending)" value={row.late} />
          <CalcRow label="Absent" value={row.absent} />
          <CalcRow label="Excused" value={row.excused} />
          <CalcRow label={`${attended} attended ÷ ${row.totalDays} school days`} value={`${rate}%`} isTotal />
        </div>
        <p className="stat-explainer__rule">
          Arriving late still counts as attending. An excused absence still counts as a day missed, because the class time
          is missed either way.
          {requiredAttendance != null &&
            (rate < requiredAttendance
              ? ` The required rate is ${requiredAttendance}%, so this is ${round1(requiredAttendance - rate)} points below it.`
              : ` The required rate is ${requiredAttendance}%, so this is ${round1(rate - requiredAttendance)} points clear of it.`)}
        </p>
        <p className="stat-explainer__rule">
          This is the daily homeroom record — the official one the school reports on. Your subject teachers keep a separate
          record per class, further down this page.
        </p>
      </>
    ),
  }
}

function explainGradeTrend({ trend, checks }) {
  // The wording of the rule is the server's (it reads riskConfig), so the
  // threshold is never written down in the frontend.
  const declineRule = (checks || []).find((c) => c.factorKey === 'declining_grade')?.rule
  const points = (trend || []).filter((p) => p.averageGrade != null)

  if (points.length < 2) {
    return {
      title: 'Grade trend',
      body: (
        <p>
          A trend needs at least two grading periods to compare. You have {points.length === 1 ? 'one so far' : 'none yet'},
          so there is nothing to measure against.
        </p>
      ),
    }
  }

  const earliest = points[0]
  const latest = points[points.length - 1]
  // Exactly the formula in backend/services/riskCalculator.js:
  //   (most recent − earliest) ÷ number of periods with data.
  const change = round1(latest.averageGrade - earliest.averageGrade)
  const perPeriod = round1(change / points.length)

  return {
    title: 'Grade trend',
    subtitle: `${formatSigned(perPeriod)} points a period`,
    body: (
      <>
        <div className="stat-explainer__calc">
          {points.map((p) => (
            <CalcRow key={p.periodName} label={p.periodName} value={round1(p.averageGrade)} />
          ))}
          <CalcRow
            label={`(${round1(latest.averageGrade)} − ${round1(earliest.averageGrade)}) ÷ ${points.length} periods`}
            value={formatSigned(perPeriod)}
            isTotal
          />
        </div>
        <p className="stat-explainer__rule">
          The school measures the change across every period you have marks for, not just the last two.
          {declineRule ? ` ${declineRule.replace('Flagged when it falls', 'It is flagged when it falls')}.` : ''}
        </p>
      </>
    ),
  }
}

function explainStanding({ checks, levelsByTriggeredCount, bandLabel, riskLevelLabel }) {
  const list = checks || []
  const triggeredCount = list.filter((c) => c.triggered).length

  // The band boundaries the server derived from the scoring config, read
  // back as a sentence: "0–1 flagged is Low, 2 is Medium, 3 or more is High."
  const bandSentence = (levelsByTriggeredCount || [])
    .map((band) => {
      const label = band.level.charAt(0).toUpperCase() + band.level.slice(1)
      if (band.maxTriggered == null) return `${band.minTriggered} or more is ${label}`
      if (band.minTriggered === band.maxTriggered) return `${band.minTriggered} is ${label}`
      return `${band.minTriggered}–${band.maxTriggered} is ${label}`
    })
    .join(', ')

  return {
    title: riskLevelLabel ? 'Risk level' : 'Standing',
    subtitle: riskLevelLabel || bandLabel,
    body: (
      <>
        <p className="stat-explainer__lead">
          {triggeredCount === 0
            ? `None of the ${list.length} checks are flagged.`
            : `${triggeredCount} of the ${list.length} checks are flagged right now.`}
        </p>
        <ul className="stat-explainer__checks">
          {list.map((check) => (
            <li key={check.factorKey} className={check.triggered ? 'is-flagged' : 'is-clear'}>
              <span className="stat-explainer__check-icon">
                {check.triggered ? (
                  <AlertTriangle size={15} strokeWidth={2} aria-hidden="true" />
                ) : (
                  <Check size={15} strokeWidth={2} aria-hidden="true" />
                )}
              </span>
              <span className="stat-explainer__check-body">
                <strong>
                  {check.measure}: {check.currentText}
                </strong>
                <span className="stat-explainer__check-rule">
                  <span className="sr-only">{check.triggered ? 'Flagged. ' : 'Not flagged. '}</span>
                  {check.rule}
                </span>
              </span>
            </li>
          ))}
        </ul>
        {bandSentence && (
          <p className="stat-explainer__rule">
            The more checks that are flagged, the higher the level: {bandSentence}. Clearing any one of them lowers it.
          </p>
        )}
      </>
    ),
  }
}

const BUILDERS = {
  average: explainAverage,
  attendance: explainAttendance,
  gradeTrend: explainGradeTrend,
  standing: explainStanding,
}

export function StatExplainer({ statKey, onClose, id, ...data }) {
  const build = BUILDERS[statKey]
  if (!build) return null
  const content = build(data)
  if (!content) return null

  return (
    <ExplainerPanel id={id} title={content.title} subtitle={content.subtitle} onClose={onClose}>
      {content.body}
    </ExplainerPanel>
  )
}
