import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import { BarChart } from './charts/BarChart'
import { ChartCard, ChartCardRow } from './charts/ChartCard'
import { SkeletonChart } from './Skeleton'
import { BAND_SEGMENT_SPEC, BAND_RANK } from '../utils/performanceBands'
import './BandTrend.css'

// How a cohort has MOVED across the school year's terms.
//
// WHY THIS EXISTS
//
// Academic Progress Tracking is the trend-based half of this product, and
// the page showed no trend at all: three tables, one grading period, a
// picker to change which period — and nothing that put two of them side by
// side. A reader could see that twelve learners are At Risk today and had
// no way to see whether that was fifteen last term or nine.
//
// TWO QUESTIONS, ANSWERED SEPARATELY
//
// The shape of the cohort each term is a chart. WHICH LEARNERS crossed a
// band is a list of names, because "three improved" is not actionable and
// "Carpio moved out of At Risk" is.
//
// ONE CARD PER TERM, SHARING A SCALE — which is exactly what ChartCardRow
// documents itself as being for. Not a stacked bar: BarChart's own header
// records why ("a stacked bar makes the reader measure segments against a
// moving start point"), and five bands stacked three times over would be
// arithmetic rather than reading.
//
// WHY THE NAMES SIT BELOW THE CHARTS AND NOT BESIDE THEM
//
// They were beside them, and it was wrong. Two columns side by side only
// works while their heights are similar, and this rail's height is set by
// how many learners moved — which is DATA, not layout. Thirteen movers in a
// 320px column ran to 737px against charts that stop at 236px, leaving a
// 999x501px hole under the charts and pushing the bands half a screen down.
// Stacked, each half takes the full width and the names wrap into columns,
// so the block is about 150px instead of 737px and the height no longer
// depends on the cohort.

const MOVEMENT_ICON = { improved: ArrowUpRight, slipped: ArrowDownRight }

// At most this many names per group before the rest become "+N more".
// School-wide a real school can produce a hundred movers, and wrapping them
// into columns only softens that — twenty rows of names is still a wall.
const MAX_NAMES = 12

// `periods` is the server's band trend, oldest first:
//   [{ periodId, periodName, counts: { at_risk_high, ... }, total }]
// `movement` is { improved: [...], slipped: [...], previousPeriodName } or
// null when there is no previous term to compare against. Each entry
// carries `toBand` so this can order by consequence — see byConsequence.
export function BandTrend({ periods, movement, scopeLabel, loading }) {
  if (loading) {
    return (
      <section className="band-trend">
        <SkeletonChart />
      </section>
    )
  }

  const withData = (periods || []).filter((p) => p.total > 0)
  // Nothing to draw. A school in its first term, or a section with no
  // finalized grades yet, gets no chart rather than three empty frames.
  if (withData.length === 0) return null

  // One shared maximum across the terms, so the bars mean the same thing in
  // every card. Without it each term scales to its own largest band and two
  // cards that look identical describe different numbers.
  const sharedMax = Math.max(...withData.map((p) => p.total))

  return (
    <section className="band-trend" aria-labelledby="band-trend-heading">
      <div className="band-trend__head">
        <h2 id="band-trend-heading">How this {scopeLabel} has moved</h2>
      </div>

      <ChartCardRow>
        {withData.map((period) => {
          const rows = BAND_SEGMENT_SPEC.map((segment) => ({
            key: segment.key,
            label: segment.label,
            value: period.counts[segment.key],
            color: segment.color,
            valueText: `${period.counts[segment.key]}`,
          }))
          return (
            <ChartCard key={period.periodId} title={period.periodName} description={`${period.total} assessed`}>
              <BarChart rows={rows} maxValue={sharedMax} />
            </ChartCard>
          )
        })}
      </ChartCardRow>

      {movement && <MovementBlock movement={movement} />}
    </section>
  )
}

// Orders a group so the most consequential movements survive the cap.
//
// This is what makes capping defensible at all. Truncating an arbitrary
// first twelve could cut a learner who fell into At Risk while keeping one
// who merely dropped to Average — so the destination decides: for a slip,
// the worst destination first; for an improvement, the best. Ties fall back
// to surname, so the order is stable rather than whatever the array held.
function byConsequence(direction) {
  return (a, b) => {
    const rankA = BAND_RANK[a.toBand] ?? 99
    const rankB = BAND_RANK[b.toBand] ?? 99
    if (rankA !== rankB) return direction === 'slipped' ? rankA - rankB : rankB - rankA
    return a.lastName.localeCompare(b.lastName)
  }
}

// Who crossed a band, by name. Deliberately NOT a count: the point of the
// closed loop is acting on a learner, and a number cannot be acted on.
function MovementBlock({ movement }) {
  const { improved, slipped, previousPeriodName } = movement
  const nothingMoved = improved.length === 0 && slipped.length === 0

  return (
    <section className="band-trend__movement" aria-labelledby="band-movement-heading">
      <h3 id="band-movement-heading">Since {previousPeriodName}</h3>

      {nothingMoved ? (
        // A real answer. "Nobody changed band" is a finding about a cohort,
        // not an empty space, and it is one a school would want to know.
        <p className="band-trend__none">
          <Minus size={14} strokeWidth={2} aria-hidden="true" />
          No learner changed band since {previousPeriodName}.
        </p>
      ) : (
        <div className="band-trend__groups">
          <MovementGroup kind="improved" label="Improved" learners={improved} />
          <MovementGroup kind="slipped" label="Slipped" learners={slipped} />
        </div>
      )}
    </section>
  )
}

function MovementGroup({ kind, label, learners }) {
  if (learners.length === 0) return null
  const Icon = MOVEMENT_ICON[kind]
  const ordered = [...learners].sort(byConsequence(kind))
  const shown = ordered.slice(0, MAX_NAMES)
  const hidden = ordered.length - shown.length

  return (
    <div className={`band-trend__group band-trend__group--${kind}`}>
      <p className="band-trend__group-head">
        <Icon size={14} strokeWidth={2.25} aria-hidden="true" />
        {label} ({learners.length})
      </p>
      <ul className="band-trend__list">
        {shown.map((learner) => (
          <li key={learner.studentId}>
            <span className="band-trend__name">
              {learner.lastName}, {learner.firstName}
            </span>
            {/* The direction is stated in words. The two band labels use the
                frozen ramp, and two shades of red are not a direction. */}
            <span className="band-trend__move">
              {learner.fromLabel} → {learner.toLabel}
            </span>
          </li>
        ))}
      </ul>
      {hidden > 0 && (
        // Says what was left out and why the rest are the ones kept, rather
        // than trailing off into an unexplained "...".
        <p className="band-trend__more">
          +{hidden} more, least consequential first omitted. Every learner appears in the bands below.
        </p>
      )}
    </div>
  )
}
